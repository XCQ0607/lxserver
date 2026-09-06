import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import crypto from 'crypto'
const { MusicTagger, MetaPicture } = require('music-tag-native')
import { getUserConfig } from '@/user'
import { formatPlayTime } from '@/utils/common'
import { buildLyrics } from '@/utils/lrcTool'
import { getLyricFetcher, embedLyricsIntoFile, getAudioMetadataUnsupportedStatus } from './fileCache'
import * as fileCache from './fileCache'

export interface CustomCacheItem {
    id: string
    songmid?: string
    name: string
    singer: string
    album: string
    albumId?: string
    img?: string
    interval?: string
    source: string
    quality: string
    filename: string
    subPath?: string
    folder: 'custom'
    mtime: number
    size: number
    lyricFilename?: string
    ext: string
    hasCover?: boolean
    coverType?: 'embedded' | 'cached' | 'remote' | 'none'
    hasLyric?: boolean
    hasEmbedLyric?: boolean
    bitrate?: number
    sampleRate?: number
    bitDepth?: number
}

// 获取用户配置的自定义音乐目录
export const getCustomMusicDir = (username: string): string | null => {
    if (!username || username === '_open' || username === 'default') return null
    try {
        const userCfg = getUserConfig(username)
        if (userCfg?.enableCustomMusicDir && userCfg?.customMusicDir) {
            const resolved = path.resolve(userCfg.customMusicDir)
            if (fs.existsSync(resolved)) {
                return resolved
            }
        }
    } catch (e) {
        console.error(`[CustomMusic] Failed to get customMusicDir for ${username}:`, e)
    }
    return null
}

const detectAudioContainer = (filePath: string) => {
    try {
        const fd = fs.openSync(filePath, 'r')
        const buffer = Buffer.alloc(16)
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
        fs.closeSync(fd)
        const head = buffer.subarray(0, bytesRead)
        if (head.subarray(0, 3).toString('ascii') === 'ID3' || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'mp3'
        if (head.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac'
        if (head.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg'
        if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav'
        if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4'
        if (head.subarray(0, 4).toString('ascii') === 'MAC ') return 'ape'
        return 'unknown'
    } catch (e) {
        return 'unknown'
    }
}

const detectImageMime = (data: Buffer | Uint8Array) => {
    const buffer = Buffer.from(data)
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif'
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
    if (buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp'
    return null
}

const detectQualityFromBitrate = (bitrate: number | undefined, ext: string, tagger?: any): string => {
    const nativeQuality = String(tagger?.quality || '').toLowerCase()
    const isLossless = ext === '.flac' || ext === '.wav' || ext === '.ape' || nativeQuality === 'sq' || nativeQuality === 'hires'
    const br = bitrate || 0

    if (isLossless) {
        const bitDepth = tagger?.bitDepth || 16
        const sampleRate = tagger?.sampleRate || 44100
        if (br > 4500 || sampleRate > 96000) return 'master'
        if (br > 1000 || bitDepth > 16 || sampleRate > 48000) return 'flac24bit'
        return 'flac'
    }

    if (br >= 240) return '320k'
    if (br >= 170) return '192k'
    return '128k'
}

class CustomIndexManager {
    private indexes: Map<string, Map<string, CustomCacheItem>> = new Map() // username -> (compositeKey -> CustomCacheItem)

    private getIndexFilePath(username: string): string | null {
        const customDir = getCustomMusicDir(username)
        if (!customDir) return null
        return path.join(customDir, 'custom_index.json')
    }

    load(username: string): Map<string, CustomCacheItem> {
        const file = this.getIndexFilePath(username)
        if (!file || !fs.existsSync(file)) {
            const empty = new Map<string, CustomCacheItem>()
            this.indexes.set(username, empty)
            return empty
        }
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
            const map = new Map<string, CustomCacheItem>(Object.entries(data))
            this.indexes.set(username, map)
            return map
        } catch (e) {
            const empty = new Map<string, CustomCacheItem>()
            this.indexes.set(username, empty)
            return empty
        }
    }

    save(username: string) {
        const file = this.getIndexFilePath(username)
        const index = this.indexes.get(username)
        if (!file || !index) return
        try {
            const obj = Object.fromEntries(index)
            fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf-8')
        } catch (e) {
            console.error(`[CustomIndexManager] Failed to save custom_index.json for ${username}:`, e)
        }
    }

    getAll(username: string): CustomCacheItem[] {
        const index = this.indexes.get(username) || this.load(username)
        return Array.from(index.values())
    }

    set(username: string, key: string, item: CustomCacheItem) {
        const index = this.indexes.get(username) || this.load(username)
        index.set(key, item)
    }

    remove(username: string, filenameOrKey: string): boolean {
        const index = this.indexes.get(username) || this.load(username)
        let deleted = false
        for (const [k, item] of Array.from(index.entries())) {
            if (item.filename === filenameOrKey || k === filenameOrKey) {
                index.delete(k)
                deleted = true
            }
        }
        if (deleted) this.save(username)
        return deleted
    }
}

export const customIndexManager = new CustomIndexManager()

// 同步自定义目录下的歌曲并生成/更新 custom_index.json
// 递归扫描目录下的所有音频文件（支持任意深层子目录）
const scanAllFilesRecursively = async (baseDir: string, currentDir: string = baseDir): Promise<{ relativePath: string; fullPath: string }[]> => {
    const extensions = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape']
    let results: { relativePath: string; fullPath: string }[] = []
    try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
        for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
            const fullPath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                const subResults = await scanAllFilesRecursively(baseDir, fullPath)
                results = results.concat(subResults)
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase()
                if (extensions.includes(ext)) {
                    const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/')
                    results.push({ relativePath: rel, fullPath })
                }
            }
        }
    } catch (e) {
        console.error(`[CustomMusic] Error reading dir ${currentDir}:`, e)
    }
    return results
}

// 安全解析并检验文件路径，防止路径遍历攻击
const resolveSafePath = (baseDir: string, relativePath: string): string | null => {
    const resolved = path.resolve(baseDir, relativePath)
    const normalizedBase = path.resolve(baseDir)
    if (resolved === normalizedBase || !resolved.startsWith(normalizedBase + path.sep)) {
        return null
    }
    return resolved
}

// 同步扫描并更新自定义目录索引
export const syncCustomIndex = async (username: string) => {
    const customDir = getCustomMusicDir(username)
    if (!customDir || !fs.existsSync(customDir)) {
        throw new Error('用户未开启或未配置自定义音乐目录')
    }

    const index = customIndexManager.load(username)
    const extensions = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape']

    // 递归深层扫描所有子目录中的音频文件
    const scannedFiles = await scanAllFilesRecursively(customDir)

    const foundRelPaths = new Set<string>()
    let updated = false

    for (const fileObj of scannedFiles) {
        const relPath = fileObj.relativePath
        const filePath = fileObj.fullPath
        foundRelPaths.add(relPath)

        const ext = path.extname(filePath).toLowerCase()
        const stats = await fs.promises.stat(filePath)

        const subDir = path.dirname(relPath).replace(/\\/g, '/')
        const subPath = subDir === '.' ? '' : subDir

        const existing = index.get(relPath)

        const lrcFilePath = filePath.substring(0, filePath.length - ext.length) + '.lrc'
        const hasLyricOnDisk = fs.existsSync(lrcFilePath)

        if (existing && existing.size === stats.size && existing.mtime === stats.mtimeMs && existing.hasLyric === hasLyricOnDisk) {
            continue
        }

        let songName = ''
        let singer = ''
        let album = ''
        let duration = ''
        let bitrate: number | undefined
        let sampleRate: number | undefined
        let bitDepth: number | undefined
        let hasEmbedCover = false
        let hasEmbedLyric = false
        let quality = '128k'

        const nameWithoutExt = path.basename(filePath, ext)

        if (nameWithoutExt.includes('_-_')) {
            const segs = nameWithoutExt.split('_-_')
            if (segs.length >= 4) {
                songName = segs[0]
                singer = segs[1]
            }
        } else if (nameWithoutExt.includes(' - ')) {
            const segs = nameWithoutExt.split(' - ')
            if (segs.length >= 2) {
                songName = segs[0]
                singer = segs[1]
                album = segs.slice(3).join(' - ')
            }
        }

        let tagger: any
        try {
            tagger = new MusicTagger()
            tagger.loadPath(filePath)
            if (tagger.title) songName = tagger.title
            if (tagger.artist) singer = tagger.artist
            if (tagger.album) album = tagger.album
            if (Array.isArray(tagger.pictures) && tagger.pictures.length > 0) {
                hasEmbedCover = tagger.pictures.some((pic: any) => pic && pic.data && detectImageMime(Buffer.from(pic.data)))
            }
            if (tagger.duration) duration = formatPlayTime(tagger.duration / 1000)
            bitrate = tagger.bitRate
            sampleRate = tagger.sampleRate
            bitDepth = tagger.bitDepth
            quality = detectQualityFromBitrate(tagger.bitRate, ext, tagger)

            const lyricsInTag = tagger.lyrics
            hasEmbedLyric = !!(lyricsInTag && lyricsInTag.trim().length > 10)
        } catch (e) {
        } finally {
            try { if (tagger) tagger.dispose() } catch (e) { }
        }

        if (!songName) songName = nameWithoutExt
        if (!singer) singer = '未知歌手'

        const id = existing?.id || `custom_${crypto.createHash('md5').update(relPath).digest('hex')}`

        const newItem: CustomCacheItem = {
            id,
            songmid: existing?.songmid || id,
            name: songName,
            singer: singer,
            album: album,
            albumId: existing?.albumId,
            img: existing?.img,
            interval: duration || existing?.interval || '',
            quality: quality,
            filename: relPath,
            folder: 'custom',
            subPath,
            source: existing?.source || 'custom',
            mtime: stats.mtimeMs,
            size: stats.size,
            ext: ext.replace('.', ''),
            hasCover: hasEmbedCover || !!existing?.hasCover,
            coverType: hasEmbedCover ? 'embedded' : (existing?.coverType || 'none'),
            hasLyric: hasLyricOnDisk,
            hasEmbedLyric,
            lyricFilename: hasLyricOnDisk ? path.basename(lrcFilePath) : undefined,
            bitrate,
            sampleRate,
            bitDepth
        }

        customIndexManager.set(username, relPath, newItem)
        updated = true
    }

    // 清理已从磁盘删除的文件索引及旧格式键
    for (const [k, item] of Array.from(index.entries())) {
        if (!foundRelPaths.has(item.filename) || k !== item.filename) {
            index.delete(k)
            updated = true
        }
    }

    if (updated || !fs.existsSync(path.join(customDir, 'custom_index.json'))) {
        customIndexManager.save(username)
    }

    return customIndexManager.getAll(username)
}

// 获取自定义音乐列表（带 songInfo 转换）
export const getCustomMusicList = async (username: string) => {
    const customDir = getCustomMusicDir(username)
    if (!customDir) return []

    const indexPath = path.join(customDir, 'custom_index.json')
    if (!fs.existsSync(indexPath)) {
        await syncCustomIndex(username)
    }

    const items = customIndexManager.getAll(username)
    return items.map(item => ({
        ...item,
        songInfo: {
            id: item.id,
            songmid: item.songmid || item.id,
            name: item.name,
            singer: item.singer,
            source: item.source,
            quality: item.quality,
            albumName: item.album,
            albumId: item.albumId,
            img: item.img,
            interval: item.interval,
            type: item.quality,
            types: {}
        },
        hasLyric: item.hasLyric || !!item.lyricFilename
    }))
}

// 获取自定义目录音频封面
export const getCustomCover = async (filename: string, username: string) => {
    const customDir = getCustomMusicDir(username)
    if (!customDir) return null
    const filePath = resolveSafePath(customDir, filename)
    if (!filePath || !fs.existsSync(filePath)) return null

    let tagger: any
    try {
        tagger = new MusicTagger()
        tagger.loadPath(filePath)
        const pics = tagger.pictures
        if (Array.isArray(pics)) {
            for (const pic of pics) {
                if (pic && pic.data) {
                    const data = Buffer.from(pic.data)
                    const mime = detectImageMime(data) || pic.mimeType || 'image/jpeg'
                    return { data, mime }
                }
            }
        }
    } catch (e) {
    } finally {
        try { if (tagger) tagger.dispose() } catch (e) { }
    }
    return null
}

// 流式服务自定义目录音频文件（支持 Range 206）
export const serveCustomFile = (req: http.IncomingMessage, res: http.ServerResponse, filename: string, username: string) => {
    const customDir = getCustomMusicDir(username)
    if (!customDir) {
        res.writeHead(404)
        res.end('Custom directory not found or not enabled')
        return
    }

    const filePath = resolveSafePath(customDir, filename)
    if (!filePath || !fs.existsSync(filePath)) {
        res.writeHead(404)
        res.end('File Not Found')
        return
    }

    const stat = fs.statSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.ape': 'audio/x-ape'
    }
    const contentType = mimeTypes[ext] || 'application/octet-stream'
    const range = req.headers.range

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
        const chunksize = end - start + 1
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType
        })
        fs.createReadStream(filePath, { start, end }).pipe(res)
    } else {
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes'
        })
        fs.createReadStream(filePath).pipe(res)
    }
}

// 删除自定义目录下的文件
export const removeCustomFile = (filename: string, username: string): boolean => {
    const customDir = getCustomMusicDir(username)
    if (!customDir) return false

    const filePath = resolveSafePath(customDir, filename)
    if (!filePath || !fs.existsSync(filePath)) return false

    try {
        fs.unlinkSync(filePath)
        const ext = path.extname(filePath)
        const lrcPath = filePath.substring(0, filePath.length - ext.length) + '.lrc'
        if (fs.existsSync(lrcPath)) {
            try { fs.unlinkSync(lrcPath) } catch (e) { }
        }
        customIndexManager.remove(username, filename)
        return true
    } catch (e) {
        console.error(`[CustomMusic] Failed to delete file ${filename}:`, e)
        return false
    }
}

// 手动关联自定义目录歌曲（更新 ID3 标签及 custom_index.json）
export const linkCustomSong = async (filename: string, songInfo: any, username: string) => {
    const customDir = getCustomMusicDir(username)
    if (!customDir) throw new Error('用户未启用或未配置自定义目录')

    const filePath = resolveSafePath(customDir, filename)
    if (!filePath || !fs.existsSync(filePath)) throw new Error('音频文件未找到: ' + filename)

    // 1. 尝试使用 MusicTagger 写入 ID3 标签
    try {
        const tagger = new MusicTagger()
        tagger.loadPath(filePath)
        if (songInfo.name) tagger.title = songInfo.name
        if (songInfo.singer) tagger.artist = songInfo.singer
        if (songInfo.albumName) tagger.album = songInfo.albumName
        tagger.save()
        tagger.dispose()
    } catch (e: any) {
        console.warn(`[CustomMusic] 写入音频标签失败: ${e.message}，继续更新索引`)
    }

    // 2. 更新 custom_index.json 中的元数据
    const index = customIndexManager.load(username)
    const existing = index.get(filename)
    const stats = fs.statSync(filePath)

    const updatedItem: CustomCacheItem = {
        ...(existing || {}),
        filename,
        subPath: existing?.subPath || '',
        folder: 'custom',
        source: songInfo.source || 'custom',
        id: songInfo.id || existing?.id || `custom_${crypto.createHash('md5').update(filename).digest('hex')}`,
        songmid: songInfo.songmid || songInfo.id || existing?.songmid,
        name: songInfo.name || existing?.name || path.basename(filename),
        singer: songInfo.singer || existing?.singer || '未知歌手',
        album: songInfo.albumName || songInfo.album || existing?.album || '',
        albumId: songInfo.albumId || existing?.albumId || '',
        img: songInfo.img || existing?.img || '',
        interval: songInfo.interval || existing?.interval || '',
        quality: existing?.quality || '128k',
        size: stats.size,
        mtime: stats.mtimeMs,
        ext: path.extname(filePath).replace('.', ''),
        hasCover: existing?.hasCover || !!songInfo.img,
        hasLyric: existing?.hasLyric || false,
        hasEmbedLyric: existing?.hasEmbedLyric || false
    }

    customIndexManager.set(username, filename, updatedItem)
    customIndexManager.save(username)

    return { success: true, message: '关联成功', data: updatedItem }
}

// 批量补全自定义目录音乐元信息（封面与ID3标签）
export const batchUpdateMetadata = async (filenames: string[], username: string) => {
    const customDir = getCustomMusicDir(username)
    if (!customDir) throw new Error('用户未启用或未配置自定义目录')

    let successCount = 0
    let failCount = 0
    const index = customIndexManager.load(username)

    for (const filename of filenames) {
        const item = index.get(filename)
        const filePath = resolveSafePath(customDir, filename)
        if (!filePath || !fs.existsSync(filePath)) {
            failCount++
            continue
        }

        try {
            let imageBuffer: Buffer | undefined
            let imageMime = 'image/jpeg'
            const imageUrl = item?.img
            if (imageUrl && imageUrl.startsWith('http') && !imageUrl.includes('logo.svg')) {
                const chunks: Buffer[] = []
                const p = imageUrl.startsWith('https') ? https : http
                imageBuffer = await new Promise<Buffer>((resolveI, rejectI) => {
                    const req = p.get(imageUrl, ires => {
                        if ((ires.statusCode || 500) >= 400) {
                            ires.resume()
                            rejectI(new Error(`Cover status: ${ires.statusCode}`))
                            return
                        }
                        imageMime = String(ires.headers['content-type'] || 'image/jpeg').split(';')[0]
                        ires.on('data', c => chunks.push(c))
                        ires.on('end', () => resolveI(Buffer.concat(chunks)))
                        ires.on('error', rejectI)
                    })
                    req.on('error', rejectI)
                    setTimeout(() => { req.destroy(); rejectI(new Error('Timeout')) }, 8000)
                }).catch(() => undefined)
            }

            let tagger: any
            try {
                tagger = new MusicTagger()
                tagger.loadPath(filePath)
                if (item?.name) tagger.title = item.name
                if (item?.singer) tagger.artist = item.singer
                if (item?.album) tagger.album = item.album
                if (imageBuffer && imageBuffer.length > 0) {
                    tagger.pictures = [new MetaPicture(imageMime, new Uint8Array(imageBuffer), 'Cover')]
                }
                tagger.save()
            } catch (e) {
                console.warn(`[CustomMusic] 批量写入标签失败: ${filename}`, e)
            } finally {
                try { if (tagger) tagger.dispose() } catch (e) { }
            }

            if (item) {
                if (imageBuffer && imageBuffer.length > 0) {
                    item.hasCover = true
                    item.coverType = 'embedded'
                }
                const stats = fs.statSync(filePath)
                item.mtime = stats.mtimeMs
                item.size = stats.size
                customIndexManager.set(username, filename, item)
            }
            successCount++
        } catch (e) {
            failCount++
        }
    }

    customIndexManager.save(username)
    return { successCount, failCount }
}

// 批量将歌词嵌入自定义目录音频标签 (USLT)
export const batchEmbedLyric = async (filenames: string[], username: string) => {
    const customDir = getCustomMusicDir(username)
    if (!customDir) throw new Error('用户未启用或未配置自定义目录')

    let successCount = 0
    let skippedCount = 0
    let failCount = 0
    const details: any[] = []
    const index = customIndexManager.load(username)

    for (const filename of filenames) {
        const filePath = resolveSafePath(customDir, filename)
        if (!filePath || !fs.existsSync(filePath)) {
            details.push({ filename, status: 'fail', reason: '文件不存在' })
            failCount++
            continue
        }

        try {
            const item = index.get(filename)
            // 检查现有嵌入歌词
            let checkTagger: any
            let existingLyrics = ''
            try {
                checkTagger = new MusicTagger()
                checkTagger.loadPath(filePath)
                existingLyrics = checkTagger.lyrics || ''
            } catch (checkError: any) {
                const unsupportedStatus = getAudioMetadataUnsupportedStatus(filePath)
                details.push({ filename, status: 'fail', reason: unsupportedStatus.error || '当前音频容器不支持嵌入歌词' })
                failCount++
                continue
            } finally {
                try { if (checkTagger) checkTagger.dispose() } catch (e) { }
            }

            if (existingLyrics && existingLyrics.trim().length > 10) {
                details.push({ filename, status: 'skipped', reason: '已有歌词标签' })
                skippedCount++
                continue
            }

            // 优先读取同名 .lrc 文件
            const ext = path.extname(filePath)
            const lrcPath = filePath.substring(0, filePath.length - ext.length) + '.lrc'
            let lyricText: string | null = null

            if (fs.existsSync(lrcPath)) {
                lyricText = fs.readFileSync(lrcPath, 'utf8')
            } else if (item && item.source && item.source !== 'unknown' && item.source !== 'custom') {
                const lyricFetcherFn = getLyricFetcher()
                if (lyricFetcherFn) {
                    lyricText = await lyricFetcherFn(item)
                }
            }

            if (!lyricText) {
                details.push({ filename, status: 'fail', reason: '无法获取歌词' })
                failCount++
                continue
            }

            const embedResult = embedLyricsIntoFile(filePath, lyricText)
            if (!embedResult.success) {
                details.push({ filename, status: 'fail', reason: embedResult.error || '歌词写入失败' })
                failCount++
                continue
            }

            if (item) {
                item.hasEmbedLyric = true
                customIndexManager.set(username, filename, item)
            }
            details.push({ filename, status: 'success' })
            successCount++
        } catch (itemErr: any) {
            details.push({ filename, status: 'fail', reason: itemErr.message || '未知错误' })
            failCount++
        }
    }

    customIndexManager.save(username)
    return { successCount, skippedCount, failCount, details }
}

// 为自定义目录保存歌词缓存 (.lrc 文件并同步索引)
export const saveCustomLyricCache = (songInfo: any, lyricsObj: any, username: string): boolean => {
    try {
        const customDir = getCustomMusicDir(username)
        if (!customDir) return false

        const index = customIndexManager.load(username)
        // 查找匹配项：优先 filename，其次 songmid/id
        let matchedItem: CustomCacheItem | undefined
        for (const item of Array.from(index.values())) {
            if (songInfo.filename && item.filename === songInfo.filename) {
                matchedItem = item
                break
            }
            if (songInfo.songmid && item.songmid === songInfo.songmid) {
                matchedItem = item
                break
            }
            if (songInfo.id && item.id === songInfo.id) {
                matchedItem = item
                break
            }
        }

        if (!matchedItem) return false

        const filePath = resolveSafePath(customDir, matchedItem.filename)
        if (!filePath || !fs.existsSync(filePath)) return false

        const ext = path.extname(filePath)
        const lrcPath = filePath.substring(0, filePath.length - ext.length) + '.lrc'
        const formattedLrc = buildLyrics(lyricsObj)
        if (!formattedLrc) return false

        fs.writeFileSync(lrcPath, formattedLrc, { encoding: 'utf-8' })
        matchedItem.hasLyric = true
        matchedItem.lyricFilename = path.relative(customDir, lrcPath).replace(/\\/g, '/')
        customIndexManager.set(username, matchedItem.filename, matchedItem)
        customIndexManager.save(username)
        return true
    } catch (e) {
        console.error('[CustomMusic] Failed to save custom lyric cache:', e)
        return false
    }
}

// 跨设备/分区安全重命名
const safeRenameFile = (src: string, dst: string) => {
    try {
        fs.renameSync(src, dst)
    } catch (err) {
        fs.copyFileSync(src, dst)
        fs.unlinkSync(src)
    }
}

// 自定义目录歌曲洗版替换：下载新音质并替换自定义目录目标文件，保留封面和歌词，并更新 custom_index.json
export const replaceCustomMusicItem = async (
    username: string,
    originalItem: CustomCacheItem,
    songInfo: any,
    url: string,
    quality: string,
    signal?: AbortSignal,
): Promise<CustomCacheItem> => {
    const userCfg = getUserConfig(username)
    if (!userCfg?.allowOperateCustomMusicDir) {
        throw new Error('未开启操作自定义音乐目录权限 (allowOperateCustomMusicDir)')
    }

    const customDir = getCustomMusicDir(username)
    if (!customDir) throw new Error('用户未开启或未配置自定义音乐目录')

    const index = customIndexManager.load(username)
    const currentItem = index.get(originalItem.filename)
    if (!currentItem) {
        throw new Error('原自定义目录文件已发生变化或已不存在')
    }
    if (quality === currentItem.quality) {
        throw new Error('实际音质与原音质相同，无需替换')
    }

    const oldAudioPath = resolveSafePath(customDir, currentItem.filename)
    if (!oldAudioPath || !fs.existsSync(oldAudioPath)) {
        throw new Error('原音频文件已不存在')
    }

    const stageId = crypto.randomBytes(12).toString('hex')
    const stageUsername = `.remaster-staging/${stageId}`
    const stageRoot = fileCache.getCacheDir(stageUsername, true)
    const stageCoverRoot = fileCache.getCoverCacheDir(stageUsername)
    const backupSuffix = `.remaster-${crypto.randomBytes(6).toString('hex')}.bak`
    const oldAudioBackup = oldAudioPath + backupSuffix

    const ext = path.extname(oldAudioPath)
    const oldLyricPath = oldAudioPath.substring(0, oldAudioPath.length - ext.length) + '.lrc'
    const hasOldLyric = fs.existsSync(oldLyricPath)
    const oldLyricBackup = oldLyricPath + backupSuffix

    let backedUpOldAudio = false
    let backedUpOldLyric = false
    let installedNewAudio = false
    let installedNewLyric = false
    let targetAudioPath = ''
    let targetLyricPath = ''
    let replacementItem: CustomCacheItem | null = null

    try {
        await fileCache.downloadAndCache(songInfo, url, quality, stageUsername, signal, true, true, true)
        if (signal?.aborted) throw new Error('Aborted')

        const stagedItems = fileCache.indexManager.getAll(stageUsername, 'music')
        const targetId = fileCache.normalizeSongId(songInfo)
        const downloadedItem = stagedItems.find(item => item.id === targetId) || stagedItems[0]
        if (!downloadedItem) throw new Error('新音质文件未写入暂存索引')

        const sourceAudioPath = path.join(stageRoot, downloadedItem.filename)
        const sourceStats = fs.existsSync(sourceAudioPath) ? fs.statSync(sourceAudioPath) : null
        if (!sourceStats?.isFile() || sourceStats.size <= 0) throw new Error('新音质文件无效或为空')

        // 提取原音频封面作为备用
        const originalCover = await getCustomCover(currentItem.filename, username)

        // 确定自定义目录中的目标音频文件名（保留其原相对子路径 subPath）
        const downloadedExt = path.extname(downloadedItem.filename) || `.${downloadedItem.ext || 'mp3'}`
        const subDir = currentItem.subPath || (path.dirname(currentItem.filename) === '.' ? '' : path.dirname(currentItem.filename).replace(/\\/g, '/'))
        const baseNameWithoutExt = path.basename(currentItem.filename, ext)
        const targetAudioFilename = subDir ? path.join(subDir, `${baseNameWithoutExt}${downloadedExt}`).replace(/\\/g, '/') : `${baseNameWithoutExt}${downloadedExt}`
        const targetLyricFilename = subDir ? path.join(subDir, `${baseNameWithoutExt}.lrc`).replace(/\\/g, '/') : `${baseNameWithoutExt}.lrc`

        targetAudioPath = resolveSafePath(customDir, targetAudioFilename)!
        targetLyricPath = resolveSafePath(customDir, targetLyricFilename)!

        // 备份旧音频
        fs.renameSync(oldAudioPath, oldAudioBackup)
        backedUpOldAudio = true

        // 备份旧歌词（若存在）
        if (hasOldLyric) {
            fs.renameSync(oldLyricPath, oldLyricBackup)
            backedUpOldLyric = true
        }

        // 写入新音频到目标位置
        fs.mkdirSync(path.dirname(targetAudioPath), { recursive: true })
        safeRenameFile(sourceAudioPath, targetAudioPath)
        installedNewAudio = true

        // 检查新音频封面，若缺失且原音频有封面，则写入封面标签
        let taggerCheck: any
        let finalHasCover = false
        try {
            taggerCheck = new MusicTagger()
            taggerCheck.loadPath(targetAudioPath)
            const pics = taggerCheck.pictures
            finalHasCover = Array.isArray(pics) && pics.some((p: any) => p && p.data)
        } catch (e) {
        } finally {
            try { if (taggerCheck) taggerCheck.dispose() } catch (e) { }
        }

        if (!finalHasCover && originalCover?.data?.length) {
            let tagger: any
            try {
                tagger = new MusicTagger()
                tagger.loadPath(targetAudioPath)
                tagger.pictures = [
                    new MetaPicture(originalCover.mime || 'image/jpeg', new Uint8Array(originalCover.data), 'Cover'),
                ]
                tagger.save()
                finalHasCover = true
            } catch (e) {
                console.warn(`[CustomMusic] 无法将原封面写入 ${targetAudioFilename}:`, e)
            } finally {
                try { if (tagger) tagger.dispose() } catch (e) { }
            }
        }

        // 处理歌词文件
        const sourceLyricPath = downloadedItem.lyricFilename ? path.join(stageRoot, downloadedItem.lyricFilename) : ''
        let finalHasLyric = false
        let finalLyricFilename: string | undefined

        if (sourceLyricPath && fs.existsSync(sourceLyricPath)) {
            fs.mkdirSync(path.dirname(targetLyricPath), { recursive: true })
            safeRenameFile(sourceLyricPath, targetLyricPath)
            installedNewLyric = true
            finalHasLyric = true
            finalLyricFilename = targetLyricFilename
        } else if (backedUpOldLyric && fs.existsSync(oldLyricBackup)) {
            fs.mkdirSync(path.dirname(targetLyricPath), { recursive: true })
            fs.copyFileSync(oldLyricBackup, targetLyricPath)
            installedNewLyric = true
            finalHasLyric = true
            finalLyricFilename = targetLyricFilename
        }

        const finalStats = fs.statSync(targetAudioPath)
        replacementItem = {
            ...currentItem,
            name: songInfo.name || currentItem.name,
            singer: songInfo.singer || currentItem.singer,
            album: songInfo.albumName || songInfo.album || currentItem.album,
            albumId: songInfo.albumId || currentItem.albumId,
            img: songInfo.img || currentItem.img,
            interval: songInfo.interval || currentItem.interval,
            quality: quality,
            filename: targetAudioFilename,
            subPath: subDir,
            folder: 'custom',
            source: currentItem.source || 'custom',
            mtime: finalStats.mtimeMs,
            size: finalStats.size,
            ext: downloadedExt.replace('.', ''),
            hasCover: finalHasCover,
            coverType: finalHasCover ? 'embedded' : 'none',
            hasLyric: finalHasLyric,
            hasEmbedLyric: downloadedItem.hasEmbedLyric ?? currentItem.hasEmbedLyric,
            lyricFilename: finalLyricFilename,
            bitrate: downloadedItem.bitrate,
            sampleRate: downloadedItem.sampleRate,
            bitDepth: downloadedItem.bitDepth,
        }

        // 如果文件名改变，移除旧键并设置新键
        if (targetAudioFilename !== currentItem.filename) {
            customIndexManager.remove(username, currentItem.filename)
        }
        customIndexManager.set(username, targetAudioFilename, replacementItem)
        customIndexManager.save(username)

        // 清理备份文件
        try {
            if (backedUpOldAudio && fs.existsSync(oldAudioBackup)) fs.unlinkSync(oldAudioBackup)
        } catch (cleanupErr) {
            console.warn('[CustomMusic] 清理旧音频备份失败:', cleanupErr)
        }
        try {
            if (backedUpOldLyric && fs.existsSync(oldLyricBackup)) fs.unlinkSync(oldLyricBackup)
        } catch (cleanupErr) {
            console.warn('[CustomMusic] 清理旧歌词备份失败:', cleanupErr)
        }

        return replacementItem
    } catch (err) {
        // 回滚操作
        try {
            if (installedNewAudio && targetAudioPath && fs.existsSync(targetAudioPath)) {
                fs.unlinkSync(targetAudioPath)
            }
            if (installedNewLyric && targetLyricPath && fs.existsSync(targetLyricPath)) {
                fs.unlinkSync(targetLyricPath)
            }
            if (backedUpOldAudio && fs.existsSync(oldAudioBackup) && !fs.existsSync(oldAudioPath)) {
                fs.renameSync(oldAudioBackup, oldAudioPath)
            }
            if (backedUpOldLyric && fs.existsSync(oldLyricBackup) && !fs.existsSync(oldLyricPath)) {
                fs.renameSync(oldLyricBackup, oldLyricPath)
            }
            customIndexManager.set(username, currentItem.filename, currentItem)
            customIndexManager.save(username)
        } catch (rollbackErr) {
            console.error('[CustomMusic] 洗版回滚失败:', rollbackErr)
        }
        throw err
    } finally {
        fileCache.indexManager.discard(stageUsername, 'music')
        try {
            if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true })
        } catch (e) { }
        try {
            if (fs.existsSync(stageCoverRoot)) fs.rmSync(stageCoverRoot, { recursive: true, force: true })
        } catch (e) { }
    }
}

