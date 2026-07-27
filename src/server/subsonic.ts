import http from 'http'
import https from 'https'
import crypto from 'crypto'
import { URL } from 'url'
import * as tunnel from 'tunnel'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { getUserSpace, getUserDirname } from '@/user'
import { callUserApiGetMusicUrl } from '@/server/userApi'
import { getSingerPic, getSingerDetail, getSingerMid } from '@/server/utils/singer'
import { fetchRecommendedAlbums } from '@/server/utils/recommendAlbums'
import { fetchGenres, fetchRadios, fetchPlaylistsByGenre, fetchRadioSongs, fetchPlaylistSongs, fetchSongsByGenre } from '@/server/utils/discovery'
import { checkCache, serveCacheFile, type CacheFolder } from '@/server/fileCache'
import fs from 'fs'
import path from 'path'
import { tryNormalizeUsername } from '@/utils/username'
// @ts-ignore
import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
const musicSdk = musicSdkRaw as any

/**
 * Subsonic 协议处理器
 * 实现了 OpenSubsonic 核心 API 集成
 * 实现了 OpenSubsonic 核心 API 集成
 *
 * 序列化策略：
 *  - JSON (f=json)：所有数据函数返回平铺的 JS 对象，sendResponse 直接 JSON.stringify
 *  - XML (默认)：数据函数返回 {attrs, children} 嵌套结构，toXml 负责渲染
 */
class SubsonicHandler {
    private readonly VERSION = '1.16.1'
    private readonly SERVER_VERSION = '1.0.0'

    // 预缓存歌曲 ID -> 封面 URL，避免 getCoverArt 重新请求 SDK
    private songPicUrlCache = new Map<string, string>()

    // 在线全网搜索歌曲缓存 (ID -> MusicInfo)，确保后续 getSong / getCoverArt / getLyrics 能精准查到歌曲元数据
    private onlineSongCache = new Map<string, LX.Music.MusicInfo>()

    private cacheOnlineSong(music: LX.Music.MusicInfo) {
        if (!music || !music.id) return
        if (this.onlineSongCache.size > 5000) {
            const firstKey = this.onlineSongCache.keys().next().value
            if (firstKey) this.onlineSongCache.delete(firstKey)
        }
        this.onlineSongCache.set(music.id, music)
    }

    // ─────────────────────────────────────────────
    // 鉴权
    // ─────────────────────────────────────────────

    private verifyAuth(params: URLSearchParams): string | null {
        const username = tryNormalizeUsername(params.get('u'))
        if (!username) return null

        const user = global.lx.config.users.find((user: any) => user.name === username)
        if (!user) return null

        // Token & Salt 方式 (推荐)
        const t = params.get('t')
        const s = params.get('s')
        if (t && s) {
            const hash = crypto.createHash('md5').update(user.password + s).digest('hex')
            if (hash === t.toLowerCase()) return user.name
        }

        // 明文密码方式 (包含 enc: 前缀处理)
        const p = params.get('p')
        if (p) {
            let password = p
            if (p.startsWith('enc:')) {
                password = Buffer.from(p.substring(4), 'hex').toString()
            }
            if (password === user.password) return user.name
        }

        return null
    }

    // ─────────────────────────────────────────────
    // 响应序列化
    // ─────────────────────────────────────────────

    /**
     * 发送 Subsonic 成功响应
     * @param res    HTTP 响应
     * @param data   JSON 模式：平铺的 JS 对象；XML 模式：带 attrs/children 结构的对象
     * @param format 'json' | null/其他
     */
    private sendResponse(res: http.ServerResponse, data: any, format: string) {
        const base: any = {
            status: 'ok',
            version: this.VERSION,
            type: 'lxserver',
            serverVersion: this.SERVER_VERSION,
            openSubsonic: true,
        }

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ 'subsonic-response': { ...base, ...data } }))
        } else {
            res.setHeader('Content-Type', 'text/xml; charset=utf-8')
            let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
            xml += `<subsonic-response xmlns="http://subsonic.org/restapi"`
            xml += ` status="${base.status}" version="${base.version}"`
            xml += ` type="${base.type}" serverVersion="${base.serverVersion}" openSubsonic="true">\n`
            xml += this.toXml(data)
            xml += '</subsonic-response>'
            res.end(xml)
        }
    }

    /** XML 渲染（仅 XML 路径使用）*/
    private toXml(obj: any, indent = '  '): string {
        let xml = ''
        for (const key in obj) {
            const val = obj[key]
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (!item) continue
                    xml += `${indent}<${key}${this.renderAttrs(item.attrs)}`
                    if (item.children) {
                        if (typeof item.children === 'string') {
                            xml += `>${this.escapeXml(item.children)}</${key}>\n`
                        } else {
                            xml += '>\n' + this.toXml(item.children, indent + '  ') + `${indent}</${key}>\n`
                        }
                    } else {
                        xml += ' />\n'
                    }
                }
            } else if (typeof val === 'object' && val !== null) {
                xml += `${indent}<${key}${this.renderAttrs(val.attrs)}`
                if (val.children) {
                    if (typeof val.children === 'string') {
                        xml += `>${this.escapeXml(val.children)}</${key}>\n`
                    } else {
                        xml += '>\n' + this.toXml(val.children, indent + '  ') + `${indent}</${key}>\n`
                    }
                } else {
                    xml += ' />\n'
                }
            }
        }
        return xml
    }

    private renderAttrs(attrs: any): string {
        if (!attrs) return ''
        let str = ''
        for (const k in attrs) {
            if (attrs[k] === undefined || attrs[k] === null) continue
            const v = String(attrs[k])
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
            str += ` ${k}="${v}"`
        }
        return str
    }

    private sendError(res: http.ServerResponse, code: number, message: string, format: string) {
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({
                'subsonic-response': {
                    status: 'failed',
                    version: this.VERSION,
                    type: 'lxserver',
                    serverVersion: this.SERVER_VERSION,
                    openSubsonic: true,
                    error: { code, message },
                },
            }))
        } else {
            res.setHeader('Content-Type', 'text/xml; charset=utf-8')
            res.end(
                `<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<subsonic-response xmlns="http://subsonic.org/restapi" status="failed" version="${this.VERSION}"` +
                ` type="lxserver" serverVersion="${this.SERVER_VERSION}" openSubsonic="true">` +
                `<error code="${code}" message="${this.escapeXml(message)}"/></subsonic-response>`,
            )
        }
    }

    private escapeXml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    // ─────────────────────────────────────────────
    // 路由分发
    // ─────────────────────────────────────────────

    async handleRequest(req: http.IncomingMessage, res: http.ServerResponse, urlObj: URL) {
        let params = urlObj.searchParams

        // [修复] 处理 POST 请求体中的参数 (如 Feishin 客户端)
        if (req.method === 'POST') {
            try {
                const bodyParams = await new Promise<URLSearchParams>((resolve) => {
                    let body = ''
                    req.on('data', chunk => { body += chunk })
                    req.on('end', () => {
                        resolve(new URLSearchParams(body))
                    })
                })
                // 合并 URL 参数和 Body 参数
                const mergedParams = new URLSearchParams(params.toString())
                bodyParams.forEach((v, k) => {
                    if (!mergedParams.has(k)) mergedParams.set(k, v)
                })
                params = mergedParams
            } catch (e) {
                console.error('[Subsonic] POST body parse error:', e)
            }
        }

        const format = params.get('f') === 'json' ? 'json' : 'xml'
        const username = this.verifyAuth(params)

        if (!username) {
            return this.sendError(res, 40, 'Wrong username or password', format)
        }

        const { pathname } = urlObj
        const method = pathname.split('/').pop()?.split('.')[0] || ''
        const logId = params.get('id')
        const logQuery = params.get('query')
        const logArtist = params.get('artist')
        const logTitle = params.get('title')
        let logDetails = `user=${username}`
        if (logId) logDetails += ` id=${logId}`
        if (logQuery) logDetails += ` query="${logQuery}"`
        if (logArtist) logDetails += ` artist="${logArtist}"`
        if (logTitle) logDetails += ` title="${logTitle}"`

        if (global.lx.config['subsonic.enableDebug']) {
            console.log(`[Subsonic Debug] ${req.method} /${method} (${format}) ${logDetails}`)
        }

        try {
            switch (method) {
                case 'ping':
                    return this.sendResponse(res, {}, format)

                case 'getLicense':
                    return this.handleGetLicense(res, format)

                case 'getPlaylists':
                    return this.handleGetPlaylists(res, username, format)

                case 'getPlaylist':
                    return this.handleGetPlaylist(res, username, params, format)

                case 'getAlbum':
                    return this.handleGetAlbum(res, username, params, format)

                case 'getSong':
                    return this.handleGetSong(res, username, params, format)

                case 'stream':
                case 'download':
                    return this.handleStream(req, res, username, params, format)

                case 'getCoverArt':
                    return this.handleGetCoverArt(req, res, username, params, format)

                case 'getUser':
                    return this.handleGetUser(res, username, params, format)

                case 'getMusicFolders':
                    return this.handleGetMusicFolders(res, format)

                case 'getMusicDirectory':
                    return this.handleGetMusicDirectory(res, username, params, format)

                case 'getGenres':
                    return this.handleGetGenres(res, username, format)

                case 'getInternetRadioStations':
                    return this.handleGetInternetRadioStations(res, format)

                case 'getAlbumList':
                    return this.handleGetAlbumList(res, username, params, format, false)

                case 'getAlbumList2':
                    return this.handleGetAlbumList(res, username, params, format, true)

                case 'getLyrics':
                    return this.handleGetLyrics(res, username, params, format)

                case 'getLyricsBySongId':
                    return this.handleGetLyricsBySongId(res, username, params, format)

                case 'getOpenSubsonicExtensions':
                    return this.handleGetOpenSubsonicExtensions(res, format)

                case 'getArtistInfo':
                case 'getArtistInfo2':
                    return this.handleGetArtistInfo(res, username, params, format)

                case 'getArtist':
                    return this.handleGetArtist(res, username, params, format)

                case 'getArtistList':
                case 'getArtists':
                    return this.handleGetArtists(res, username, format)

                case 'search':
                case 'search2':
                case 'search3':
                    return this.handleSearch(res, username, params, format, method)

                case 'getStarred':
                    return this.handleGetStarred(res, username, format, false)

                case 'getStarred2':
                    return this.handleGetStarred(res, username, format, true)

                case 'getRandomSongs':
                case 'getSongsByGenre':
                case 'getSongsByGenre2':
                    return this.handleGetRandomSongs(res, username, params, format)

                case 'getSimilarSongs':
                case 'getSimilarSongs2':
                    return this.handleGetSimilarSongs(res, username, params, format)

                case 'getTopSongs':
                    return this.handleGetTopSongs(res, username, params, format)

                case 'updatePlaylist':
                    return this.handleUpdatePlaylist(res, username, params, format)

                case 'scrobble':
                    return this.sendResponse(res, {}, format)

                case 'getNowPlaying':
                    return this.sendResponse(res, { nowPlaying: { entry: [] } }, format)

                case 'getScanStatus':
                    return this.sendResponse(res, format === 'json'
                        ? { scanStatus: { scanning: false, count: 0 } }
                        : { scanStatus: { attrs: { scanning: false, count: 0 } } }, format)

                default:
                    if (global.lx.config['subsonic.enableDebug']) {
                        console.warn(`[Subsonic Debug ⚠️ 未实现的接口] ${req.method} /${method} (${format}) ${logDetails}`)
                    }
                    return this.sendError(res, 0, 'Method not found: ' + method, format)
            }
        } catch (err: any) {
            console.error('[Subsonic] Error:', err)
            return this.sendError(res, 0, err.message || 'Internal server error', format)
        }
    }

    // ─────────────────────────────────────────────
    // 帮助函数
    // ─────────────────────────────────────────────

    private async getLibraryData(username: string, type: 'artists' | 'albums'): Promise<any[]> {
        const userDir = path.join(global.lx.userPath, getUserDirname(username))
        const libPath = path.join(userDir, 'library', `${type}.json`)
        if (!fs.existsSync(libPath)) return []
        try {
            const content = await fs.promises.readFile(libPath, 'utf8')
            return JSON.parse(content)
        } catch (e) {
            console.error(`[Subsonic] Error reading library ${type}:`, e)
            return []
        }
    }

    private parseDuration(interval: any): number {
        if (!interval) return 0
        if (typeof interval === 'number') return interval
        if (typeof interval === 'string') {
            if (interval.includes(':')) {
                const parts = interval.split(':')
                if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
                if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
            }
            return parseInt(interval) || 0
        }
        return 0
    }

    /**
     * 将 MusicInfo 映射为 Subsonic child/song 的平铺 JS 对象（适用于 JSON 响应）
     */
    private musicToSongFlat(music: LX.Music.MusicInfo, parentId: string, artistIdOverride?: string) {
        const meta = (music as any).meta || {}

        const id = music.id
        const singer = music.singer || 'Unknown Artist'
        const source = music.source

        // [优化] 深度提取专辑信息：兼容 SDK 原始对象结构
        const albumName = meta.albumName || (music as any).albumName || (music as any).album?.name || 'Unknown Album'
        // 针对 tx 平台优先使用 albumMid (00...) 构造 alb_ ID，因为封面构造依赖它
        const rawAlbumId = (music as any).albumMid || (music as any).album?.mid || meta.albumId || (music as any).albumId || (music as any).album?.id

        // [修复] 规范化 albumId：优先使用提取到的专辑 ID，只有完全没有时才回退到 parentId
        // 且如果 parentId 是歌手 ID，在有 rawAlbumId 的情况下绝不使用它
        const albumId = rawAlbumId ? `alb_${source}_${rawAlbumId}` : parentId

        // [修复] 提取图片 URL：兼容更多 SDK 字段名
        const picUrl = meta.picUrl || (music as any).pic || (music as any).img || (music as any).albumPicUrl || (music as any).album?.picUrl || null
        if (picUrl && typeof picUrl === 'string' && picUrl.startsWith('http')) {
            // [双向缓存] 同时缓存给歌曲 ID 和专辑 ID
            this.songPicUrlCache.set(id, picUrl)
            if (rawAlbumId) this.songPicUrlCache.set(`alb_${source}_${rawAlbumId}`, picUrl)
        }

        // [修复] 处理 Genre 发现逻辑
        let genreMatch = (music as any).genre || ''
        if (parentId.startsWith('genre_')) {
            genreMatch = parentId.replace('genre_', '')
        }

        // [关键修复] 歌手 ID 生成策略优化
        // 1. 如果指定了覆盖 ID（如在歌手详情页），优先使用
        // 2. 否则优先使用 singerId 字段构造规范 ID
        // 3. 兜底使用第一位歌手名构造 ID，避免多歌手符号（如 、）在大 ID 中导致客户端解析失败
        const primarySinger = (singer.split('、')[0] || 'Unknown Artist').trim()
        const defaultArtistId = (music as any).singerId ? `art_${source}_${(music as any).singerId}` : `artist_${primarySinger}`
        const finalArtistId = artistIdOverride || defaultArtistId

        return {
            id,
            parent: parentId,
            title: music.name,
            name: music.name,
            album: albumName,
            albumId: String(albumId),
            artist: singer,
            artistId: finalArtistId,
            track: (music as any).track || 0,
            year: (music as any).year || 0,
            genre: genreMatch,
            coverArt: (picUrl && typeof picUrl === 'string' && picUrl.startsWith('http')) ? picUrl : id,
            duration: this.parseDuration(music.interval),
            ...this.getBestQualityMeta(music),
            isVideo: false,
            // 某些客户端 (如 Feishin) 在特定视图下不喜欢非标准字段，可以保留但确保标准字段优先
            type: 'music',
        }
    }

    /**
     * 从歌曲元数据中检测并提取最佳音质配置
     */
    private parseByteSize(value: unknown): number | undefined {
        if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined
        if (typeof value !== 'string') return undefined

        const normalized = value.trim().replace(/,/g, '')
        const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(B|K|KB|KIB|M|MB|MIB|G|GB|GIB)?$/i)
        if (!match) return undefined

        const amount = Number(match[1])
        if (!Number.isFinite(amount) || amount <= 0) return undefined
        const unit = (match[2] || 'B').toUpperCase()
        const multipliers: Record<string, number> = {
            B: 1,
            K: 1024,
            KB: 1024,
            KIB: 1024,
            M: 1024 ** 2,
            MB: 1024 ** 2,
            MIB: 1024 ** 2,
            G: 1024 ** 3,
            GB: 1024 ** 3,
            GIB: 1024 ** 3,
        }
        return Math.round(amount * multipliers[unit])
    }

    private normalizeBitRate(value: unknown, rejectLosslessPlaceholder = false): number | undefined {
        const numeric = Number(value)
        if (!Number.isFinite(numeric) || numeric <= 0) return undefined
        const kbps = numeric > 10_000 ? numeric / 1000 : numeric
        const rounded = Math.round(kbps)
        if (rejectLosslessPlaceholder && rounded === 999) return undefined
        return rounded >= 8 && rounded <= 20_000 ? rounded : undefined
    }

    private getBestQualityMeta(music: LX.Music.MusicInfo) {
        const meta = (music as any).meta || {}
        const qualitySources = [
            (music as any).types,
            (music as any)._types,
            meta.qualitys,
            meta.types,
            meta._types,
            (music as any)._qualitys,
            meta._qualitys,
        ]
        const qMap: Record<string, { bitRate?: number, suffix: string, contentType: string }> = {
            'master': { suffix: 'flac', contentType: 'audio/flac' },
            'atmos_plus': { suffix: 'm4a', contentType: 'audio/mp4' },
            'atmos': { suffix: 'm4a', contentType: 'audio/mp4' },
            'hires': { suffix: 'flac', contentType: 'audio/flac' },
            'flac24bit': { suffix: 'flac', contentType: 'audio/flac' },
            'flac': { suffix: 'flac', contentType: 'audio/flac' },
            '320k': { bitRate: 320, suffix: 'mp3', contentType: 'audio/mpeg' },
            '192k': { bitRate: 192, suffix: 'mp3', contentType: 'audio/mpeg' },
            '128k': { bitRate: 128, suffix: 'mp3', contentType: 'audio/mpeg' },
        }

        const getQualityInfo = (q: string): any | null => {
            const matches: any[] = []
            for (const source of qualitySources) {
                if (Array.isArray(source)) {
                    const item = source.find((value: any) => value === q || value?.type === q || value?.name === q)
                    if (item != null) matches.push(typeof item === 'object' ? item : {})
                } else if (source && typeof source === 'object') {
                    const item = (source as any)[q]
                    if (item != null && item !== false) matches.push(typeof item === 'object' ? item : {})
                }
            }
            return matches.length > 0 ? Object.assign({}, ...matches) : null
        }

        // 尝试按优先级匹配最佳音质
        for (const q of ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k']) {
            const qualityInfo = getQualityInfo(q)
            if (qualityInfo == null) continue

            const size = this.parseByteSize(qualityInfo.size ?? qualityInfo.fileSize ?? qualityInfo.filesize)
            const duration = this.parseDuration(music.interval)
            const isLossless = ['master', 'hires', 'flac24bit', 'flac'].includes(q)
            const explicitBitRate = this.normalizeBitRate(
                qualityInfo.bitRate ?? qualityInfo.bitrate,
                isLossless,
            )
            const calculatedBitRate = size && duration > 0
                ? Math.round(size * 8 / duration / 1000)
                : undefined
            const musicBitRate = this.normalizeBitRate(
                (music as any).bitRate ?? (music as any).bitrate ?? meta.bitRate ?? meta.bitrate,
                isLossless,
            )
            const bitRate = explicitBitRate ?? calculatedBitRate ?? musicBitRate ?? qMap[q].bitRate

            return {
                suffix: qMap[q].suffix,
                contentType: qMap[q].contentType,
                ...(bitRate ? { bitRate } : {}),
                ...(size ? { size } : {}),
            }
        }

        // 若是在线全网检索歌曲，没抓到 types 信息的兜底返回 320k
        if (music.id && music.id.includes('_')) {
            return { bitRate: 320, suffix: 'mp3', contentType: 'audio/mpeg' }
        }

        // 兜底返回 128k
        return { bitRate: 128, suffix: 'mp3', contentType: 'audio/mpeg' }
    }

    /**
     * 将 MusicInfo 映射为 XML 渲染格式 {attrs, children?}
     */
    private musicToSongXml(music: LX.Music.MusicInfo, parentId: string, artistIdOverride?: string) {
        return { attrs: this.musicToSongFlat(music, parentId, artistIdOverride) }
    }

    private collectUniqueListSongs(listData: any): Array<{ music: LX.Music.MusicInfo, listId: string }> {
        const songs = new Map<string, { music: LX.Music.MusicInfo, listId: string }>()
        const collect = (list: LX.Music.MusicInfo[], listId: string) => {
            for (const music of list) {
                if (!music?.id || songs.has(music.id)) continue
                songs.set(music.id, { music, listId })
            }
        }

        collect(listData.loveList || [], 'love')
        collect(listData.defaultList || [], 'default')
        for (const list of listData.userList || []) {
            collect((list.list || []) as LX.Music.MusicInfo[], list.id)
        }
        return Array.from(songs.values())
    }

    private buildLocalAlbumGroups(entries: Array<{ music: LX.Music.MusicInfo, listId: string }>) {
        const groups = new Map<string, { album: any, songs: LX.Music.MusicInfo[] }>()

        for (const { music, listId } of entries) {
            const meta = (music as any).meta || {}
            const albumName = meta.albumName || (music as any).albumName || (music as any).album?.name || 'Unknown Album'
            const rawAlbumId = (music as any).albumMid || (music as any).album?.mid || meta.albumId || (music as any).albumId || (music as any).album?.id
            const albumId = rawAlbumId
                ? `alb_${music.source}_${rawAlbumId}`
                : `album_${Buffer.from(`${albumName}__${music.singer || 'Unknown Artist'}`).toString('base64url').slice(0, 24)}`
            const song = this.musicToSongFlat(music, albumId)
            let group = groups.get(albumId)
            if (!group) {
                group = {
                    album: {
                        id: albumId,
                        name: song.album || 'Unknown Album',
                        title: song.album || 'Unknown Album',
                        album: song.album || 'Unknown Album',
                        artist: song.artist || 'Unknown Artist',
                        artistId: song.artistId,
                        isDir: true,
                        coverArt: song.coverArt || albumId,
                        songCount: 0,
                        duration: 0,
                        created: new Date(0).toISOString(),
                        playCount: 0,
                        year: song.year || undefined,
                    },
                    songs: [],
                }
                groups.set(albumId, group)
            }
            group.songs.push(music)
            group.album.songCount = group.songs.length
            group.album.duration += Number(song.duration) || 0
        }

        return groups
    }

    private mapLibraryAlbum(album: any) {
        const source = album.source || 'wy'
        const primarySinger = (album.artistName || '').split('\u3001')[0] || 'LX Music'
        const artistId = album.singerId ? `art_${source}_${album.singerId}` : `artist_${primarySinger}`
        return {
            id: `alb_${source}_${album.id}`,
            name: album.name,
            title: album.name,
            album: album.name,
            artist: album.artistName || 'LX Music',
            artistId,
            isDir: true,
            coverArt: album.picUrl || album.meta?.picUrl || `alb_${source}_${album.id}`,
            songCount: (album.list || []).length,
            duration: (album.list || []).reduce((sum: number, music: any) => sum + this.parseDuration(music.interval), 0),
            created: new Date().toISOString(),
            playCount: 0,
            year: album.publishTime ? parseInt(String(album.publishTime).split(/[/-]/)[0]) : undefined,
        }
    }

    private getAlbumIdentity(album: any) {
        const source = String(album.source || String(album.id || '').match(/^alb_([^_]+)_/)?.[1] || '').toLowerCase()
        const name = String(album.name || album.title || album.album || '').trim().toLowerCase()
        const artist = String(album.artist || album.artistName || '').trim().toLowerCase()
        const primaryArtist = artist.split(/\u3001|,|\uFF0C|\/|&/)[0].trim()
        return `${source}\0${name}\0${primaryArtist}`
    }

    private mergeAlbumCatalog(
        libraryAlbums: any[],
        localAlbumGroups: Map<string, { album: any, songs: LX.Music.MusicInfo[] }>,
    ) {
        const albumsById = new Map<string, any>()
        const identityToId = new Map<string, string>()
        const localAlbumIds = new Set<string>()

        for (const [albumId, group] of localAlbumGroups) {
            const album = group.album
            albumsById.set(albumId, album)
            identityToId.set(this.getAlbumIdentity(album), albumId)
            localAlbumIds.add(albumId)
        }

        for (const libraryAlbum of libraryAlbums) {
            const album = this.mapLibraryAlbum(libraryAlbum)
            const identity = this.getAlbumIdentity(album)
            const existingId = albumsById.has(album.id) ? album.id : identityToId.get(identity)

            if (!existingId) {
                albumsById.set(album.id, album)
                identityToId.set(identity, album.id)
                continue
            }

            const existing = albumsById.get(existingId)
            if (localAlbumIds.has(existingId)) {
                albumsById.set(existingId, {
                    ...album,
                    ...existing,
                    id: existingId,
                    coverArt: existing.coverArt || album.coverArt,
                    year: album.year || existing.year,
                })
                continue
            }

            if ((album.songCount || 0) > (existing.songCount || 0)) {
                albumsById.delete(existingId)
                albumsById.set(album.id, album)
                identityToId.set(identity, album.id)
            }
        }

        return Array.from(albumsById.values())
    }

    /** 查找某个用户下所有列表中的某首歌 */
    private async findMusicById(username: string, id: string): Promise<{ music: LX.Music.MusicInfo, listId: string } | null> {
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        let music = listData.loveList.find((m: any) => m.id === id)
        if (music) return { music, listId: 'love' }

        music = listData.defaultList.find((m: any) => m.id === id)
        if (music) return { music, listId: 'default' }

        for (const listInfo of listData.userList) {
            const list = listInfo.list as LX.Music.MusicInfo[]
            music = list.find((m: any) => m.id === id)
            if (music) return { music, listId: listInfo.id }
        }

        // 检查本地专辑库
        try {
            const libAlbums = await this.getLibraryData(username, 'albums')
            for (const alb of libAlbums) {
                const source = alb.source || 'wy'
                for (const s of (alb.list || [])) {
                    const songId = `${source}_${s.songmid || s.songId}`
                    if (songId === id) {
                        return {
                            music: {
                                id: songId,
                                name: s.name,
                                singer: s.singer,
                                source: source,
                                songmid: s.songmid,
                                interval: s.interval || '0',
                                img: s.img,
                                meta: {
                                    picUrl: s.img,
                                    albumName: s.albumName || alb.name,
                                    albumId: s.albumMid || alb.id,
                                },
                            } as any,
                            listId: `alb_${source}_${alb.id}`,
                        }
                    }
                }
            }
        } catch (e) { }

        // 检查在线搜索缓存
        if (this.onlineSongCache.has(id)) {
            return { music: this.onlineSongCache.get(id)!, listId: 'online' }
        }

        return null
    }

    // ─────────────────────────────────────────────
    // 端点实现
    // ─────────────────────────────────────────────

    private handleGetLicense(res: http.ServerResponse, format: string) {
        if (format === 'json') {
            return this.sendResponse(res, {
                license: { valid: true, email: 'lxserver@lxmusic.com', licenseExpires: '2099-12-31T00:00:00.000Z' },
            }, format)
        }
        return this.sendResponse(res, {
            license: { attrs: { valid: true, email: 'lxserver@lxmusic.com', licenseExpires: '2099-12-31T00:00:00.000Z' } },
        }, format)
    }

    private handleGetMusicFolders(res: http.ServerResponse, format: string) {
        if (format === 'json') {
            return this.sendResponse(res, {
                musicFolders: { musicFolder: [{ id: 1, name: 'LX Music' }] },
            }, format)
        }
        return this.sendResponse(res, {
            musicFolders: { children: { musicFolder: [{ attrs: { id: 1, name: 'LX Music' } }] } },
        }, format)
    }

    private async handleGetPlaylists(res: http.ServerResponse, username: string, format: string) {
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()
        // console.log(`[Subsonic] handleGetPlaylists for ${username}: default=${listData.defaultList.length}, love=${listData.loveList.length}, userLists=${listData.userList.length}`)

        const buildPlaylist = (id: string, name: string, musics: any[], created?: string, coverArt?: string) => ({
            id,
            name,
            comment: '',
            owner: username,
            public: false,
            songCount: musics.length,
            duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
            created: created || new Date().toISOString(),
            changed: created || new Date().toISOString(),
            coverArt: coverArt || id,
        })

        const playlists: any[] = []

        if (listData.defaultList.length > 0) {
            const musics = listData.defaultList
            const coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            playlists.push(buildPlaylist('default', '默认列表', musics, undefined, coverArt))
        }
        {
            const musics = listData.loveList
            const coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            playlists.push(buildPlaylist('love', '我的收藏', musics, undefined, coverArt))
        }

        for (const list of listData.userList) {
            const musics = (list.list || []) as LX.Music.MusicInfo[]
            const coverArt = (list as any).Album || (list as any).picUrl || (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            playlists.push(buildPlaylist(
                list.id,
                list.name,
                musics,
                list.locationUpdateTime ? new Date(list.locationUpdateTime).toISOString() : undefined,
                coverArt,
            ))
        }

        if (format === 'json') {
            return this.sendResponse(res, { playlists: { playlist: playlists } }, format)
        }
        return this.sendResponse(res, {
            playlists: { children: { playlist: playlists.map(p => ({ attrs: p })) } },
        }, format)
    }

    private async handleGetPlaylist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        let musics: LX.Music.MusicInfo[] = []
        let listName = 'Unknown'
        let coverArt = 'logo'

        if (id === 'love') {
            musics = listData.loveList
            listName = '我的收藏'
            coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
        } else if (id === 'default') {
            musics = listData.defaultList
            listName = '默认列表'
            coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
        } else {
            const list = listData.userList.find((l: any) => l.id === id)
            if (list) {
                listName = list.name
                musics = (list.list || []) as LX.Music.MusicInfo[]
                coverArt = (list as any).Album || (list as any).picUrl || (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            }
        }

        const playlistMeta = {
            id,
            name: listName,
            comment: '',
            owner: username,
            public: false,
            songCount: musics.length,
            duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
            created: new Date().toISOString(),
            changed: new Date().toISOString(),
            coverArt,
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                playlist: {
                    ...playlistMeta,
                    entry: musics.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id)),
                },
            }, format)
        }

        return this.sendResponse(res, {
            playlist: {
                attrs: playlistMeta,
                children: {
                    entry: musics.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id)),
                },
            },
        }, format)
    }

    private async handleUpdatePlaylist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const playlistId = params.get('playlistId')
        const songIndexToRemove = params.get('songIndexToRemove')

        if (!playlistId) return this.sendError(res, 10, 'Required parameter is missing: playlistId', format)

        // 目前 lxserver 下暂时只实现了通过索引删除 (OpenSubsonic 核心规范)
        if (songIndexToRemove !== null) {
            const index = parseInt(songIndexToRemove)
            if (isNaN(index)) return this.sendError(res, 0, 'Invalid songIndexToRemove', format)

            try {
                const userSpace = getUserSpace(username)
                const musics = await userSpace.listManage.listDataManage.getListMusics(playlistId)

                if (index < 0 || index >= musics.length) {
                    return this.sendError(res, 0, 'Index out of bounds', format)
                }

                const songId = musics[index].id
                // console.log(`[Subsonic] Removing song at index ${index} (ID: ${songId}) from playlist ${playlistId}`)

                // 执行物理删除
                await userSpace.listManage.listDataManage.listMusicRemove(playlistId, [songId])
                // 创建快照持久化
                await userSpace.listManage.createSnapshot()

                return this.sendResponse(res, {}, format)
            } catch (err: any) {
                console.error('[Subsonic] updatePlaylist error:', err)
                return this.sendError(res, 0, err.message || 'Failed to remove song', format)
            }
        }

        // TODO: 支持 songIdToAdd 等其他参数
        return this.sendResponse(res, {}, format)
    }

    // getAlbum: 返回 album + song[] 格式（音流等客户端期望的格式）
    private async handleGetAlbum(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()
        const localAlbumGroup = this.buildLocalAlbumGroups(
            this.collectUniqueListSongs(listData),
        ).get(id)

        let musics: LX.Music.MusicInfo[] = []
        let listName = 'Unknown'
        let albumPublishTime: string | undefined

        if (id === 'love') {
            musics = listData.loveList
            listName = '我的收藏'
        } else if (id === 'default') {
            musics = listData.defaultList
            listName = '默认列表'
        } else if (localAlbumGroup) {
            musics = localAlbumGroup.songs
            listName = localAlbumGroup.album.name
        } else if (id.startsWith('lib-alb_')) {
            // 从本地收藏专辑库获取详情，将原始歌曲字段规范化为标准格式
            const realId = id.replace('lib-alb_', '')
            const libAlbums = await this.getLibraryData(username, 'albums')
            const album = libAlbums.find((a: any) => String(a.id) === realId || String(a.meta?.albumId) === realId)
            if (album) {
                listName = album.name
                albumPublishTime = album.publishTime
                // library 歌曲是原始字段，需要映射成 MusicInfo 兼容格式
                musics = (album.list || []).map((s: any) => ({
                    id: `${s.source}_${s.songmid || s.songId}`,
                    name: s.name,
                    singer: s.singer,
                    source: s.source,
                    songmid: s.songmid,
                    interval: s.interval || '0',
                    img: s.img,
                    meta: {
                        picUrl: s.img,
                        albumName: s.albumName || album.name,
                        albumId: s.albumMid || album.id,
                    },
                } as any))
            }
            /* 
            } else if (id.startsWith('alb_hot_')) {
                // [新增] 处理虚拟出的歌手热门歌曲专辑
                const fullArtId = id.replace('alb_hot_', '')
                let source = 'wy'
                let artistId = fullArtId
                if (fullArtId.startsWith('art_')) {
                    const parts = fullArtId.split('_')
                    source = parts[1]
                    artistId = parts.slice(2).join('_')
                }
                if (musicSdk[source]?.extendDetail) {
                    try {
                        // [修改] 统一使用 5 页 (500 首) 循环抓取
                        const MAX_PAGES = 5
                        const PAGE_SIZE = 100
                        let all: any[] = []
                        for (let p = 1; p <= MAX_PAGES; p++) {
                            const data = await musicSdk[source].extendDetail.getArtistSongs(artistId, p, PAGE_SIZE, 'hot')
                            const pageList = data.list || []
                            all = all.concat(pageList)
                            if (pageList.length < PAGE_SIZE) break
                        }
                        musics = all.map((s: any) => ({
                            ...s,
                            id: `${source}_${s.songmid || s.songId}`
                        }))
                        listName = '热门歌曲'
                    } catch (e) {
                        console.error(`[Subsonic] SDK getArtistSongs (for virtual album) error:`, e)
                    }
                }
            */
        } else if (id.startsWith('radio_tx_')) {
            // [新增] 处理电台详情，作为虚拟专辑返回
            const radioId = id.replace('radio_tx_', '')
            try {
                const songs = await fetchRadioSongs(radioId)
                listName = '官方电台' // 默认名，如果有缓存可以查找真实名
                musics = (songs || []).map((s: any) => ({
                    id: `tx_${s.songmid || s.mid}`,
                    name: s.songname || s.name,
                    singer: (s.singer || []).map((si: any) => si.name).join('、'),
                    source: 'tx',
                    songmid: s.songmid || s.mid,
                    interval: s.interval || 0,
                    img: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
                    meta: {
                        albumName: '官方电台',
                        albumId: id,
                        picUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : ''
                    }
                } as any))
            } catch (e) {
                console.error(`[Subsonic] Fetch radio songs failed:`, e)
            }
        } else if (id.startsWith('alb_tx_playlist_')) {
            // [新增] 处理虚拟出的歌单详情
            const dissid = id.replace('alb_tx_playlist_', '')
            try {
                const result = await fetchPlaylistSongs(dissid)
                listName = result.name
                musics = result.list as any
            } catch (e) {
                console.error(`[Subsonic] Fetch playlist detail failed:`, e)
            }
        } else if (id.startsWith('alb_')) {
            // [新增] 处理来自 SDK 的专辑详情
            const parts = id.split('_')
            const source = parts[1]
            const realId = parts.slice(2).join('_')
            // console.log(`[Subsonic] getAlbum SDK Route: source=${source}, realId=${realId}`)

            if (musicSdk[source]?.extendDetail?.getAlbumSongs) {
                try {
                    const data = await musicSdk[source].extendDetail.getAlbumSongs(realId)
                    // console.log(`[Subsonic] getAlbum SDK Response: name=${data?.name}, songCount=${data?.list?.length}`)
                    musics = (data.list || []).map((s: any) => ({
                        ...s,
                        id: `${source}_${s.songmid || s.songId}`,
                        source
                    }))
                    // [优化] 如果数据里没带专辑名，从第一首歌里提取
                    listName = data.name || (musics[0] as any)?.albumName || (musics[0] as any)?.meta?.albumName || 'Album Detail'
                    albumPublishTime = data.publishTime
                } catch (e: any) {
                    console.error(`[Subsonic] SDK getAlbumSongs error for ${id}:`, e?.message)
                }
            } else {
                console.warn(`[Subsonic] SDK missing extendDetail.getAlbumSongs for ${source}`)
            }
        } else if (id.startsWith('album_')) {
            // 聚合专辑 ID（由 getAlbumList/getAlbumList2 生成）
            const allMusicsMap = new Map<string, { music: LX.Music.MusicInfo, listId: string }[]>()
            const collectInto = (songs: LX.Music.MusicInfo[], listId: string) => {
                for (const m of songs) {
                    const albumName = (m as any).meta?.albumName || m.name
                    const singer = m.singer || 'Unknown'
                    const key = `album_${Buffer.from(`${albumName}__${singer}`).toString('base64url').slice(0, 24)}`
                    if (!allMusicsMap.has(key)) allMusicsMap.set(key, [])
                    allMusicsMap.get(key)!.push({ music: m, listId })
                }
            }
            collectInto(listData.loveList, 'love')
            collectInto(listData.defaultList, 'default')
            for (const list of listData.userList) collectInto((list.list || []) as LX.Music.MusicInfo[], list.id)

            const entries = allMusicsMap.get(id) || []
            musics = entries.map(e => e.music)
            if (musics.length > 0) {
                listName = (musics[0] as any).meta?.albumName || musics[0].name
            }
        } else if (id.includes('_')) {
            // 动态支持：如果客户端把某首歌的 id 当作专辑 id 来查
            const found = await this.findMusicById(username, id)
            if (found) {
                musics = [found.music]
                listName = found.music.name
            } else {
                // 如果在列表里没找到，尝试解析 ID 构造
                const parts = id.split('_')
                const source = parts[0]
                const songmid = parts.slice(1).join('_')
                if (musicSdk[source]) {
                    musics = [{ id, name: 'Unknown', singer: 'Unknown', source, songmid, interval: '0' } as any]
                    listName = 'Single Album'
                }
            }
        } else {
            const list = listData.userList.find((l: any) => l.id === id)
            if (list) {
                listName = list.name
                musics = (list.list || []) as LX.Music.MusicInfo[]
            }
        }

        const albumMeta = {
            id,
            name: listName,
            title: listName,
            album: listName,
            artist: (musics.length === 1) ? musics[0].singer : 'LX Music',
            artistId: (musics.length === 1) ? ((musics[0] as any).singerId ? `art_${musics[0].source}_${(musics[0] as any).singerId}` : `artist_${(musics[0].singer || '').split('、')[0]}`) : 'artist_lxmusic',
            songCount: musics.length,
            duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
            created: new Date().toISOString(),
            // [修复] 优先使用图片的真实 URL，而不是 ID，以规避后端 getCoverArt 抓取失败的问题
            coverArt: (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || id,
            isDir: true,
            playCount: 0,
            year: albumPublishTime ? parseInt(albumPublishTime.split(/[/-]/)[0]) : ((musics[0] as any)?.year || (musics[0] as any)?.meta?.year),
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                album: {
                    ...albumMeta,
                    song: musics.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id, albumMeta.artistId)),
                },
            }, format)
        }

        return this.sendResponse(res, {
            album: {
                attrs: albumMeta,
                children: {
                    song: musics.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id, albumMeta.artistId)),
                },
            },
        }, format)
    }

    private async handleGetSong(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        let music: LX.Music.MusicInfo | null = null
        let listId = 'online'

        const found = await this.findMusicById(username, id)
        if (found) {
            music = found.music
            listId = found.listId
        } else if (id.includes('_')) {
            // 在线歌曲 ID 动态元数据兜底 (处理 wy_1378492134, tx_... 等客户端请求非本地库歌曲)
            const parts = id.split('_')
            const source = parts[0]
            const songmid = parts.slice(1).join('_')
            const title = params.get('title') || params.get('name') || songmid
            const singer = params.get('artist') || params.get('singer') || 'Unknown Artist'
            music = {
                id,
                name: title,
                singer: singer,
                source: source,
                songmid: songmid,
                interval: '0',
                meta: {
                    songId: songmid,
                },
            } as any
        }

        if (!music) return this.sendError(res, 70, 'Song not found: ' + id, format)

        if (format === 'json') {
            return this.sendResponse(res, { song: this.musicToSongFlat(music, listId) }, format)
        }
        return this.sendResponse(res, { song: this.musicToSongXml(music, listId) }, format)
    }

    private async handleGetMusicDirectory(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        if (!id || id === '1' || id === 'root') {
            const dirs = [
                { id: 'love', parent: 'root', title: '我的收藏', isDir: true, coverArt: (listData.loveList[0] as any)?.meta?.picUrl || (listData.loveList[0] as any)?.img || 'logo' },
                { id: 'default', parent: 'root', title: '默认列表', isDir: true, coverArt: (listData.defaultList[0] as any)?.meta?.picUrl || (listData.defaultList[0] as any)?.img || 'logo' },
                { id: 'radios', parent: 'root', title: '官方电台', isDir: true },
                ...listData.userList.map((l: any) => ({
                    id: l.id,
                    parent: 'root',
                    title: l.name,
                    isDir: true,
                    coverArt: (l as any).Album || (l as any).picUrl || (l.list?.[0] as any)?.meta?.picUrl || (l.list?.[0] as any)?.img || 'logo',
                })),
            ]
            if (format === 'json') {
                return this.sendResponse(res, {
                    directory: { id: 'root', name: 'Music', child: dirs },
                }, format)
            }
            return this.sendResponse(res, {
                directory: {
                    attrs: { id: 'root', name: 'Music' },
                    children: { child: dirs.map(d => ({ attrs: d })) },
                },
            }, format)
        }

        if (id === 'radios') {
            // [新增] 返回官方电台列表
            // const radios = await fetchRadios()
            const radios: any[] = []
            const dirs = radios.map(r => ({
                id: r.id,
                parent: 'radios',
                title: r.name,
                name: r.name,
                isDir: true,
                coverArt: r.coverArt
            }))
            if (format === 'json') {
                return this.sendResponse(res, { directory: { id: 'radios', name: '官方电台', child: dirs } }, format)
            }
            return this.sendResponse(res, {
                directory: {
                    attrs: { id: 'radios', name: '官方电台' },
                    children: { child: dirs.map(d => ({ attrs: d })) }
                }
            }, format)
        }

        let musics: LX.Music.MusicInfo[] = []
        let dirName = 'Unknown'

        if (id.startsWith('radio_tx_')) {
            // [新增] 返回具体电台内的歌曲
            // const radioId = id.replace('radio_tx_', '')
            try {
                // const songs = await fetchRadioSongs(radioId)
                const songs: any[] = []
                dirName = '电台列表'
                musics = (songs || []).map((s: any) => ({
                    id: `tx_${s.songmid || s.mid}`,
                    name: s.songname || s.name,
                    singer: (s.singer || []).map((si: any) => si.name).join('、'),
                    source: 'tx',
                    songmid: s.songmid || s.mid,
                    interval: s.interval || 0,
                    img: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
                    meta: {
                        albumName: '官方电台',
                        albumId: id,
                        picUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : ''
                    }
                } as any))
            } catch (e) {
                console.error(`[Subsonic] Fetch radio songs failed:`, e)
            }
        } else if (id === 'love') {
            musics = listData.loveList
            dirName = '我的收藏'
        } else if (id === 'default') {
            musics = listData.defaultList
            dirName = '默认列表'
        } else {
            const list = listData.userList.find((l: any) => l.id === id)
            if (list) {
                dirName = list.name
                musics = (list.list || []) as LX.Music.MusicInfo[]
            }
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                directory: {
                    id,
                    name: dirName,
                    child: musics.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            directory: {
                attrs: { id, name: dirName },
                children: {
                    child: musics.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id)),
                },
            },
        }, format)
    }

    private async handleGetAlbumList(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
        isV2: boolean,
    ) {
        const type = params.get('type') || 'newest'
        const size = Math.min(parseInt(params.get('size') || '10'), 500)
        const offset = parseInt(params.get('offset') || '0')

        let albums: any[] = []

        // [推荐逻辑] 根据 type 处理推荐。只有 offset=0 时才展示推荐，便于发现
        if ((type === 'recent' || type === 'random' || type === 'byGenre') && offset === 0) {
            try {
                if (type === 'byGenre') {
                    const genreNameOrId = params.get('genre') || ''
                    // 尝试从 fetchGenres 中寻找 ID (如果传入的是名称)
                    let categoryId = genreNameOrId
                    if (isNaN(parseInt(genreNameOrId))) {
                        const genres = await fetchGenres()
                        const target = genres.find(g => g.value === genreNameOrId)
                        if (target) categoryId = target.id
                    }
                    if (categoryId) {
                        albums = await fetchPlaylistsByGenre(categoryId, size)
                    }
                } else {
                    const recommendations = await fetchRecommendedAlbums(type, size)
                    if (recommendations.length > 0) {
                        albums = recommendations
                    }
                }
            } catch (e) {
                console.error(`[Subsonic] Fetch recommended albums (${type}) failed:`, e)
            }
        }

        // 如果未命中推荐逻辑，或推荐获取为空，则回退到本地收藏库
        if (albums.length === 0) {
            const libAlbums = await this.getLibraryData(username, 'albums')
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()
            const localAlbumGroups = this.buildLocalAlbumGroups(
                this.collectUniqueListSongs(listData),
            )

            const mergedAlbums = this.mergeAlbumCatalog(libAlbums, localAlbumGroups)
            if (type === 'alphabeticalByName') {
                mergedAlbums.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
            } else if (type === 'alphabeticalByArtist') {
                mergedAlbums.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), 'zh-CN'))
            }
            albums = mergedAlbums.slice(offset, offset + size)
        }

        const wrapKey = isV2 ? 'albumList2' : 'albumList'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: { album: albums },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: { album: albums.map(alb => ({ attrs: alb })) },
            },
        }, format)
    }


    private async handleGetArtists(res: http.ServerResponse, username: string, format: string) {
        // [修改] 歌手列表首选来自收藏的歌手库
        const libArtists = await this.getLibraryData(username, 'artists')
        const artists = libArtists.map(artist => {
            const id = `art_${artist.source || 'wy'}_${artist.id}`
            return {
                id: id,
                name: artist.name,
                albumCount: 0,
                coverArt: id,
                artistImageUrl: artist.picUrl || artist.img,
            }
        })

        // 按首字母分组
        const indexMap = new Map<string, any[]>()
        for (const a of artists) {
            const firstChar = a.name[0]?.toUpperCase() || '#'
            const key = /[A-Z]/.test(firstChar) ? firstChar : '#'
            if (!indexMap.has(key)) indexMap.set(key, [])
            indexMap.get(key)!.push(a)
        }

        const indexArr = Array.from(indexMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, artistList]) => ({
                name,
                artist: artistList,
            }))

        if (format === 'json') {
            return this.sendResponse(res, {
                artists: { ignoredArticles: 'The An A Die Das Ein', index: indexArr },
            }, format)
        }

        return this.sendResponse(res, {
            artists: {
                attrs: { ignoredArticles: 'The An A Die Das Ein' },
                children: {
                    index: indexArr.map(idx => ({
                        attrs: { name: idx.name },
                        children: { artist: idx.artist.map(a => ({ attrs: a })) }
                    }))
                },
            },
        }, format)
    }


    private async handleGetArtist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        let source = 'wy'
        let artistId = ''
        let singerName = 'Unknown'

        // 严格解析规范 ID: art_source_id
        if (id.startsWith('art_')) {
            const parts = id.split('_')
            source = parts[1]
            artistId = parts.slice(2).join('_')
        } else if (id.startsWith('artist_')) {
            // 兼容旧版或 Fallback: 使用 getSingerMid 动态寻址
            singerName = decodeURIComponent(id.slice(7))
            const mid = await getSingerMid(singerName)
            if (mid) {
                source = 'tx' // 寻址成功后默认切换到 TX
                artistId = mid
            } else {
                artistId = singerName
            }
        } else {
            artistId = id
        }

        // 定义精准的平台 ID (用于封面和元数据绑定)
        const resolvedId = (source && artistId && artistId !== id) ? `art_${source}_${artistId}` : id

        // 调用 SDK 获取详情
        let albums: any[] = []
        let hotSongs: LX.Music.MusicInfo[] = []
        let artistPic = ''

        try {
            if (musicSdk[source]?.extendDetail) {
                // 1. 先抓取专辑列表 (顺序执行以保证稳定性)
                const albumData = await musicSdk[source].extendDetail.getArtistAlbums(artistId, 1).catch(() => ({ list: [] }))
                const rawAlbums = albumData.list || []

                // 2. 循环抓取多页歌曲 (最多 5 页，共 500 首)
                const fetchAllSongs = async () => {
                    const MAX_PAGES = 5
                    const PAGE_SIZE = 100
                    let all: any[] = []
                    for (let p = 1; p <= MAX_PAGES; p++) {
                        try {
                            const data = await musicSdk[source].extendDetail.getArtistSongs(artistId, p, PAGE_SIZE, 'hot')
                            const pageList = data.list || []
                            all = all.concat(pageList)
                            if (pageList.length < PAGE_SIZE) break
                        } catch (err) {
                            console.error(`[Subsonic] SDK getArtistSongs Error at page ${p}:`, err)
                            break
                        }
                    }
                    return all
                }

                const allSongsRaw = await fetchAllSongs()

                // [关键修复] 必须先恢复 singerName 才能进行 albums.map
                // 优先级：从热门歌曲中提取 > 从本地收藏库匹配 > 原有推断
                if (allSongsRaw.length > 0) {
                    singerName = allSongsRaw[0].singer
                    if ((allSongsRaw[0] as any).singerPic) artistPic = (allSongsRaw[0] as any).singerPic
                }

                if (singerName === 'Unknown' || !singerName) {
                    const libArtists = await this.getLibraryData(username, 'artists')
                    const localArt = libArtists.find(a => (a.source === source && a.id === artistId) || a.name === artistId)
                    if (localArt) singerName = localArt.name
                }

                if (albumData.list?.[0]?.singerPic) artistPic = albumData.list[0].singerPic
                if (albumData.list?.[0]?.singerName && (singerName === 'Unknown' || !singerName)) {
                    singerName = albumData.list[0].singerName
                }

                albums = rawAlbums.map((alb: any) => ({
                    id: `alb_${source}_${alb.id || alb.albumMid}`,
                    name: alb.name,
                    title: alb.name,
                    album: alb.name,
                    artist: singerName || alb.singerName || 'Unknown',
                    artistId: resolvedId,
                    songCount: alb.total || 0,
                    coverArt: alb.img || alb.picUrl || resolvedId,
                    isDir: true,
                    year: alb.publishTime ? parseInt(String(alb.publishTime).split(/[/-]/)[0]) : undefined,
                }))

                hotSongs = allSongsRaw.map((s: any) => ({
                    ...s,
                    id: `${source}_${s.songmid || s.songId}`
                }))
            }
        } catch (e) {
            console.error(`[Subsonic] SDK Artist load error:`, e)
        }

        /* 
        // 构造一个虚拟专辑放置热门歌曲，这在多数 Subsonic 客户端中不仅能显示歌曲，还能保持列表整洁
        if (hotSongs.length > 0) {
            albums.unshift({
                id: `alb_hot_${id}`, // 使用 alb_ 前缀确保可以被 handleGetAlbum 处理
                name: `${singerName} - 热门歌曲`,
                artist: singerName,
                artistId: id,
                songCount: hotSongs.length,
                coverArt: id // 歌手的照片
            })
        }
        */

        const artistInfo = {
            id,
            name: singerName,
            albumCount: albums.length,
            songCount: hotSongs.length,
            coverArt: resolvedId,
            artistImageUrl: artistPic || resolvedId
        }

        // 这里的关键：Subsonic getArtist 响应中可以包含 album 和 song
        // 音流等客户端会优先显示这些 song 在“歌曲”标签页或“热门”列表里
        // 这里的关键：Subsonic getArtist 响应中可以包含 album 和 song
        // 音流等客户端会优先显示这些 song 在“歌曲”标签页或“热门”列表里
        // [修复] 传入 id 作为 artistIdOverride，确保歌曲显示与当前歌手页面归属匹配
        if (format === 'json') {
            return this.sendResponse(res, {
                artist: {
                    ...artistInfo,
                    album: albums,
                    song: hotSongs.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id, id))
                },
            }, format)
        }
        return this.sendResponse(res, {
            artist: {
                attrs: artistInfo,
                children: {
                    album: albums.map(a => ({ attrs: a })),
                    song: hotSongs.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id, id))
                },
            },
        }, format)
    }


    private async handleGetArtistInfo(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id') || ''
        const artistName = params.get('artist') || ''

        const libArtists = await this.getLibraryData(username, 'artists')
        const artistEntry = libArtists.find(a =>
            (id && `art_${a.source || 'wy'}_${a.id}` === id) ||
            (artistName && a.name.toLowerCase() === artistName.toLowerCase())
        )

        const name = artistEntry?.name || artistName || id.replace('artist_', '')
        const detail = await getSingerDetail(name)

        const pic = detail?.pic || (artistEntry ? (artistEntry.picUrl || artistEntry.img) : '')

        const info = {
            biography: detail?.desc || (artistEntry ? `Artist: ${artistEntry.name} (Source: ${artistEntry.source})` : ''),
            musicBrainzId: '',
            lastFmUrl: '',
            smallImageUrl: pic,
            mediumImageUrl: pic,
            largeImageUrl: pic,
        }
        if (format === 'json') {
            return this.sendResponse(res, { artistInfo2: info }, format)
        }
        return this.sendResponse(res, { artistInfo2: { attrs: info } }, format)
    }

    private async handleGetGenres(res: http.ServerResponse, username: string, format: string) {
        const genres = await fetchGenres()
        // console.log(`[Subsonic] handleGetGenres found ${genres.length} genres`)
        if (format === 'json') {
            return this.sendResponse(res, { genres: { genre: genres } }, format)
        }
        return this.sendResponse(res, {
            genres: {
                children: {
                    genre: genres.map(g => ({ attrs: { songCount: g.songCount, albumCount: g.albumCount }, children: g.value }))
                }
            }
        }, format)
    }

    private async handleGetInternetRadioStations(res: http.ServerResponse, format: string) {
        // const radios = await fetchRadios()
        const radios: any[] = []
        if (format === 'json') {
            return this.sendResponse(res, { internetRadioStations: { internetRadioStation: radios } }, format)
        }
        return this.sendResponse(res, {
            internetRadioStations: {
                children: {
                    internetRadioStation: radios.map(r => ({ attrs: r }))
                }
            }
        }, format)
    }

    private async fetchOnlineSearchSongs(cleanQuery: string, sources: string[], limit: number = 30): Promise<{ music: LX.Music.MusicInfo, listId: string }[]> {
        if (!cleanQuery) return []
        const results: { music: LX.Music.MusicInfo, listId: string }[] = []
        const validSources = sources.filter(s => ['wy', 'tx', 'kw', 'kg', 'mg'].includes(s) && musicSdk[s]?.musicSearch?.search)
        // [限制] 单个平台最大获取数量上限
        const targetLimit = Math.min(limit, 50)

        await Promise.all(validSources.map(async source => {
            try {
                // 计算需要的页数 (网易云 wy 单页限制 20 条，如需要 50 条则自动抓取前 3 页)
                const pageSize = source === 'kg' ? Math.min(targetLimit, 100) : source === 'wy' ? 20 : 30
                const pagesToFetch = Math.min(Math.ceil(targetLimit / pageSize), 3) // 最多自动抓取前 3 页

                const allItems: any[] = []
                const existingIds = new Set<string>()

                for (let page = 1; page <= pagesToFetch; page++) {
                    const searchRes = await musicSdk[source].musicSearch.search(cleanQuery, page, pageSize)
                    const list = Array.isArray(searchRes?.list) ? searchRes.list : []
                    if (list.length === 0) break

                    for (const item of list) {
                        const songmid = String(item.songmid || item.id || '')
                        if (!songmid || existingIds.has(songmid)) continue
                        existingIds.add(songmid)
                        allItems.push(item)
                    }

                    if (allItems.length >= targetLimit) break
                }

                for (const item of allItems.slice(0, targetLimit)) {
                    const songmid = String(item.songmid || item.id || '')
                    const id = `${source}_${songmid}`
                    const hash = item.hash || item.meta?.hash || item.types?.[0]?.hash || ''
                    const music: LX.Music.MusicInfo = {
                        id,
                        name: item.name,
                        singer: item.singer,
                        source: source,
                        songmid: songmid,
                        hash: hash,
                        interval: item.interval || '0',
                        _interval: item._interval || item.interval || '0',
                        img: item.img,
                        types: item.types || item._types || [],
                        _types: item._types || item.types || {},
                        meta: {
                            ...(item.meta || {}),
                            hash: hash,
                            picUrl: item.img,
                            albumName: item.albumName || item.name,
                            albumId: item.albumId,
                            qualitys: item.types || item._types || [],
                            _types: item._types || item.types || {},
                        },
                    } as any
                    this.cacheOnlineSong(music)
                    results.push({ music, listId: 'online' })
                }
            } catch (err: any) {
                console.error(`[Subsonic] Online search error for source=${source}:`, err?.message || err)
            }
        }))
        return results
    }

    private async handleSearch(res: http.ServerResponse, username: string, params: URLSearchParams, format: string, method: string = 'search3') {
        let rawQuery = (params.get('query') || '').trim()
        if (rawQuery === '""' || rawQuery === "''") rawQuery = '' // 处理某些客户端发送的空占位符

        // 0. 解析搜索前缀与搜索模式
        let searchMode: 'local_only' | 'force_online' | 'fallback' | 'merge' = 'fallback'
        let targetOnlineSources: string[] = String(global.lx.config['subsonic.onlineSearchSources'] || 'wy,tx,kw,kg,mg').split(',').map(s => s.trim()).filter(Boolean)
        let cleanQuery = rawQuery

        const lowerQuery = rawQuery.toLowerCase()
        if (lowerQuery.startsWith('local:') || lowerQuery.startsWith('local：')) {
            searchMode = 'local_only'
            cleanQuery = rawQuery.slice(6).trim()
        } else if (lowerQuery.startsWith('online:') || lowerQuery.startsWith('online：') || lowerQuery.startsWith('net:') || lowerQuery.startsWith('net：')) {
            searchMode = 'force_online'
            const colonIdx = rawQuery.indexOf(':') !== -1 ? rawQuery.indexOf(':') : rawQuery.indexOf('：')
            cleanQuery = rawQuery.slice(colonIdx + 1).trim()
        } else {
            // 检查指定的音源前缀: wy:, tx:, kw:, kg:, mg:
            const knownSources = ['wy', 'tx', 'kw', 'kg', 'mg']
            let matchedPrefixSource = ''
            for (const s of knownSources) {
                if (lowerQuery.startsWith(`${s}:`) || lowerQuery.startsWith(`${s}：`)) {
                    matchedPrefixSource = s
                    break
                }
            }
            if (matchedPrefixSource) {
                searchMode = 'force_online'
                targetOnlineSources = [matchedPrefixSource]
                const colonIdx = rawQuery.indexOf(':') !== -1 ? rawQuery.indexOf(':') : rawQuery.indexOf('：')
                cleanQuery = rawQuery.slice(colonIdx + 1).trim()
            } else {
                // 没有前缀，遵循全局后台配置
                const isOnlineEnabled = global.lx.config['subsonic.onlineSearch'] !== false
                if (!isOnlineEnabled) {
                    searchMode = 'local_only'
                } else {
                    searchMode = (global.lx.config['subsonic.onlineSearchMode'] as any) || 'fallback'
                }
            }
        }

        const queryForFilter = cleanQuery.toLowerCase()

        // 1. 汇总所有本地歌曲 (去重)
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        const allSongsMap = new Map<string, { music: LX.Music.MusicInfo, listId: string }>()
        const collectSongs = (list: LX.Music.MusicInfo[], listId: string) => {
            for (const m of list) {
                if (!allSongsMap.has(m.id)) {
                    allSongsMap.set(m.id, { music: m, listId })
                }
            }
        }
        collectSongs(listData.loveList, 'love')
        collectSongs(listData.defaultList, 'default')
        for (const list of listData.userList) {
            collectSongs((list.list || []) as LX.Music.MusicInfo[], list.id)
        }

        // 补充本地收藏专辑库中的歌曲
        const libAlbums = await this.getLibraryData(username, 'albums')
        for (const alb of libAlbums) {
            const source = alb.source || 'wy'
            for (const s of (alb.list || [])) {
                const songId = `${source}_${s.songmid || s.songId}`
                if (!allSongsMap.has(songId)) {
                    allSongsMap.set(songId, {
                        music: {
                            id: songId,
                            name: s.name,
                            singer: s.singer,
                            source: source,
                            songmid: s.songmid,
                            interval: s.interval || '0',
                            img: s.img,
                            meta: {
                                picUrl: s.img,
                                albumName: s.albumName || alb.name,
                                albumId: s.albumMid || alb.id,
                            },
                        } as any,
                        listId: `alb_${source}_${alb.id}`,
                    })
                }
            }
        }
        const allLocalSongs = Array.from(allSongsMap.values())

        // 2. 汇总所有歌手 (去重)
        const allArtistsMap = new Map<string, any>()
        const libArtists = await this.getLibraryData(username, 'artists')
        for (const a of libArtists) {
            const id = `art_${a.source || 'wy'}_${a.id}`
            allArtistsMap.set(id, {
                id,
                name: a.name,
                coverArt: id,
                artistImageUrl: a.picUrl || a.img,
                albumCount: 0,
            })
        }
        for (const { music } of allLocalSongs) {
            const singer = music.singer || 'Unknown Artist'
            const primarySinger = (singer.split('、')[0] || 'Unknown Artist').trim()
            const source = music.source
            const artistId = (music as any).singerId ? `art_${source}_${(music as any).singerId}` : `artist_${primarySinger}`
            if (!allArtistsMap.has(artistId)) {
                allArtistsMap.set(artistId, {
                    id: artistId,
                    name: primarySinger,
                    coverArt: artistId,
                    albumCount: 0,
                })
            }
        }
        const allLocalArtists = Array.from(allArtistsMap.values())

        // 3. 汇总所有专辑 (去重)
        const allLocalAlbums = this.mergeAlbumCatalog(
            libAlbums,
            this.buildLocalAlbumGroups(allLocalSongs),
        )

        // 4. 执行本地检索过滤
        let matchedSongs = queryForFilter
            ? allLocalSongs.filter(({ music }) =>
                music.name.toLowerCase().includes(queryForFilter) ||
                music.singer.toLowerCase().includes(queryForFilter) ||
                ((music as any).meta?.albumName || '').toLowerCase().includes(queryForFilter)
            )
            : allLocalSongs

        let matchedArtists = queryForFilter
            ? allLocalArtists.filter(a => a.name.toLowerCase().includes(queryForFilter))
            : allLocalArtists

        let matchedAlbums = queryForFilter
            ? allLocalAlbums.filter(a => a.name.toLowerCase().includes(queryForFilter) || a.artist.toLowerCase().includes(queryForFilter))
            : allLocalAlbums

        // 5. 分页参数解析
        const artistCount = params.has('artistCount') ? parseInt(params.get('artistCount') || '20') : 20
        const artistOffset = parseInt(params.get('artistOffset') || '0')
        const albumCount = params.has('albumCount') ? parseInt(params.get('albumCount') || '20') : 20
        const albumOffset = parseInt(params.get('albumOffset') || '0')
        const songCount = params.has('songCount') ? parseInt(params.get('songCount') || '20') : 20
        const songOffset = parseInt(params.get('songOffset') || '0')

        // 6. 处理在线 API 搜索与模式融合
        if (cleanQuery && songCount > 0) {
            if (searchMode === 'force_online') {
                const onlineResults = await this.fetchOnlineSearchSongs(cleanQuery, targetOnlineSources, songCount)
                matchedSongs = onlineResults
            } else if (searchMode === 'merge') {
                const onlineResults = await this.fetchOnlineSearchSongs(cleanQuery, targetOnlineSources, songCount)
                const existingIds = new Set(matchedSongs.map(s => s.music.id))
                for (const item of onlineResults) {
                    if (!existingIds.has(item.music.id)) {
                        matchedSongs.push(item)
                        existingIds.add(item.music.id)
                    }
                }
            } else if (searchMode === 'fallback') {
                if (matchedSongs.length < songCount) {
                    const needed = songCount - matchedSongs.length
                    const onlineResults = await this.fetchOnlineSearchSongs(cleanQuery, targetOnlineSources, needed)
                    const existingIds = new Set(matchedSongs.map(s => s.music.id))
                    for (const item of onlineResults) {
                        if (!existingIds.has(item.music.id)) {
                            matchedSongs.push(item)
                            existingIds.add(item.music.id)
                        }
                    }
                }
            }
        }

        const pagedArtists = artistCount > 0 ? matchedArtists.slice(artistOffset, artistOffset + artistCount) : []
        const pagedAlbums = albumCount > 0 ? matchedAlbums.slice(albumOffset, albumOffset + albumCount) : []
        const pagedSongs = songCount > 0 ? matchedSongs.slice(songOffset, songOffset + songCount) : []

        const wrapKey = method === 'search' ? 'searchResult' : method === 'search2' ? 'searchResult2' : 'searchResult3'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: {
                    artist: pagedArtists,
                    album: pagedAlbums,
                    song: pagedSongs.map(({ music, listId }) => this.musicToSongFlat(music, listId)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: {
                    artist: pagedArtists.map(a => ({ attrs: a })),
                    album: pagedAlbums.map(a => ({ attrs: a })),
                    song: pagedSongs.map(({ music, listId }) => this.musicToSongXml(music, listId)),
                },
            },
        }, format)
    }

    private async handleGetStarred(res: http.ServerResponse, username: string, format: string, isV2 = true) {
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        // [汇总所有歌单歌曲]
        const allSongsMap = new Map<string, { music: LX.Music.MusicInfo, listId: string }>()
        const collect = (list: LX.Music.MusicInfo[], listId: string) => {
            for (const m of list) {
                if (!allSongsMap.has(m.id)) {
                    allSongsMap.set(m.id, { music: m, listId })
                }
            }
        }
        collect(listData.loveList, 'love')
        collect(listData.defaultList, 'default')
        for (const list of listData.userList) {
            collect((list.list || []) as LX.Music.MusicInfo[], list.id)
        }
        const allSongs = Array.from(allSongsMap.values())

        // [新增] 包含收藏的歌手和专辑
        const libArtists = await this.getLibraryData(username, 'artists')
        const libAlbums = await this.getLibraryData(username, 'albums')

        const mappedArtists = libArtists.map(a => {
            const id = `art_${a.source || 'wy'}_${a.id}`
            return {
                id,
                name: a.name,
                coverArt: id
            }
        })

        const mappedAlbums = libAlbums.map(a => {
            const source = a.source || 'wy'
            const primarySinger = (a.artistName || '').split('、')[0] || 'Unknown Artist'
            const artistId = a.singerId ? `art_${source}_${a.singerId}` : `artist_${primarySinger}`
            return {
                id: `alb_${source}_${a.id}`,
                name: a.name,
                artist: a.artistName,
                artistId: artistId,
                coverArt: a.picUrl || `alb_${source}_${a.id}`
            }
        })

        const wrapKey = isV2 ? 'starred2' : 'starred'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: {
                    song: allSongs.map(item => this.musicToSongFlat(item.music, item.listId)),
                    album: mappedAlbums,
                    artist: mappedArtists,
                },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: {
                    song: allSongs.map(item => this.musicToSongXml(item.music, item.listId)),
                    album: mappedAlbums.map(a => ({ attrs: a })),
                    artist: mappedArtists.map(a => ({ attrs: a })),
                },
            },
        }, format)
    }

    private async handleGetRandomSongs(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const size = Math.min(parseInt(params.get('size') || '10'), 100)
        const genreNameOrId = params.get('genre') || ''
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()


        const isGenreQuery = params.has('genre')
        const rootKey = isGenreQuery ? 'songsByGenre' : 'randomSongs'

        // [修改] 如果是流派发现，强制获取 100 首左右进行随机，忽略客户端的 size=10 限制
        const fetchSize = isGenreQuery ? 100 : size

        // [新增] 如果带了 genre 参数，则优先从云端拉取该流派的歌曲
        if (genreNameOrId) {
            try {
                let categoryId = genreNameOrId
                if (isNaN(parseInt(genreNameOrId))) {
                    const genres = await fetchGenres()
                    const target = genres.find(g => g.value === genreNameOrId)
                    if (target) categoryId = target.id
                }
                const cloudSongs = await fetchSongsByGenre(categoryId, fetchSize)
                if (cloudSongs.length > 0) {
                    const parentId = `genre_${genreNameOrId}`
                    const picked = cloudSongs.map((s: any) => ({ music: s, listId: parentId }))
                    return this.renderRandomSongs(res, picked, format, rootKey)
                }
            } catch (e) {
                console.error(`[Subsonic] fetchSongsByGenre failed:`, e)
            }
        }

        // 汇聚所有歌曲
        const all: { music: LX.Music.MusicInfo, listId: string }[] = []
        const addAll = (musics: LX.Music.MusicInfo[], listId: string) => {
            for (const m of musics) all.push({ music: m, listId })
        }
        addAll(listData.loveList, 'love')
        addAll(listData.defaultList, 'default')
        for (const list of listData.userList) addAll((list.list || []) as LX.Music.MusicInfo[], list.id)

        // Fisher-Yates 随机打乱，取前 size 条
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]]
        }
        const picked = all.slice(0, size)
        return this.renderRandomSongs(res, picked, format, rootKey)
    }

    private renderRandomSongs(res: http.ServerResponse, picked: { music: LX.Music.MusicInfo, listId: string }[], format: string, rootKey: string = 'randomSongs') {
        if (format === 'json') {
            return this.sendResponse(res, {
                [rootKey]: {
                    song: picked.map(({ music, listId }) => this.musicToSongFlat(music, listId)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            [rootKey]: {
                children: {
                    song: picked.map(({ music, listId }) => this.musicToSongXml(music, listId)),
                },
            },
        }, format)
    }

    private async handleGetSimilarSongs(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const id = params.get('id')
        const count = Math.min(parseInt(params.get('count') || '10'), 50)

        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        // 找到目标歌曲，优先从同一列表里挑相似（同歌手），找不到则随机
        const all: { music: LX.Music.MusicInfo, listId: string }[] = []
        const addAll = (musics: LX.Music.MusicInfo[], listId: string) => {
            for (const m of musics) all.push({ music: m, listId })
        }
        addAll(listData.loveList, 'love')
        addAll(listData.defaultList, 'default')
        for (const list of listData.userList) addAll((list.list || []) as LX.Music.MusicInfo[], list.id)

        // 找目标歌曲
        const target = id ? all.find(({ music }) => music.id === id) : null

        let candidates = all.filter(({ music }) => music.id !== id)

        if (target) {
            // 同歌手优先
            const sameSinger = candidates.filter(({ music }) => music.singer === target.music.singer)
            const others = candidates.filter(({ music }) => music.singer !== target.music.singer)
            candidates = [...sameSinger, ...others]
        }

        // 打乱并取前 count
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]]
        }
        const picked = candidates.slice(0, count)

        const wrapKey = 'similarSongs2'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: {
                    song: picked.map(({ music, listId }) => this.musicToSongFlat(music, listId)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: {
                    song: picked.map(({ music, listId }) => this.musicToSongXml(music, listId)),
                },
            },
        }, format)
    }

    private getStreamFormat(params: URLSearchParams) {
        const maxBitRateParam = params.get('maxBitRate') ?? params.get('maxBitrate')
        const maxBitRate = parseInt(maxBitRateParam || '0')
        let quality = 'flac'
        if (maxBitRate > 0 && maxBitRate < 320) {
            quality = '128k'
        } else if (maxBitRate >= 320 && maxBitRate < 1000) {
            quality = '320k'
        }
        return {
            quality,
            contentType: quality === 'flac' ? 'audio/flac' : 'audio/mpeg',
        }
    }

    private async handleStream(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        // 解析 source 和 songmid
        let source = ''
        let songmid = ''
        if (id.includes('_')) {
            const index = id.indexOf('_')
            source = id.substring(0, index)
            songmid = id.substring(index + 1)
        } else {
            source = id.split('-')[0] || ''
            songmid = id
        }

        try {
            const { quality, contentType } = this.getStreamFormat(params)

            // [新增] 处理电台流: 随机取一首歌播放
            if (id.startsWith('radio_tx_')) {
                const radioId = id.replace('radio_tx_', '')
                // console.log(`[Subsonic] Radio stream requested: ${id}`)
                const songs = await fetchRadioSongs(radioId)
                // console.log(`[Subsonic] Radio ${id} fetched ${songs?.length || 0} songs`)

                if (songs && songs.length > 0) {
                    // 随机取一首，提升电台体验
                    const s = songs[Math.floor(Math.random() * songs.length)]
                    const songmid = s.mid || s.songmid
                    // console.log(`[Subsonic] Radio ${id} picked song: ${s.name || s.songname} (${songmid})`)

                    const musicInfo: any = { source: 'tx', songmid, id: `tx_${songmid}`, meta: { songId: songmid } }
                    const result = await callUserApiGetMusicUrl('tx', musicInfo, quality, username)

                    if (result && result.url) {
                        return this.proxyAudioStream(req, res, result.url, contentType)
                    } else {
                        console.error(`[Subsonic] Radio ${id} failed to resolve music URL`)
                    }
                } else {
                    console.warn(`[Subsonic] Radio ${id} returned empty song list`)
                }
                return this.sendError(res, 0, 'Could not resolve radio track', format)
            }

            const found = await this.findMusicById(username, id)
            let musicInfo: any = found?.music || { source, songmid, id, meta: { songId: songmid } }
            musicInfo = {
                ...musicInfo,
                source,
                songmid,
                id,
                meta: {
                    ...(musicInfo.meta || {}),
                    songId: songmid,
                },
            }

            const localQualities = quality === 'flac'
                ? ['flac', 'flac24bit', 'hires', 'master']
                : [quality]
            let localFile: ReturnType<typeof checkCache> | undefined
            for (const localQuality of localQualities) {
                const candidate = checkCache({
                    ...musicInfo,
                    quality: localQuality,
                    exactQuality: true,
                }, username)
                if (candidate.exists && !candidate.isCollision) {
                    localFile = candidate
                    break
                }
            }
            if (
                localFile?.exists &&
                localFile.filename &&
                (localFile.folder === 'cache' || localFile.folder === 'music')
            ) {
                return serveCacheFile(
                    req,
                    res,
                    localFile.filename,
                    username,
                    localFile.folder as CacheFolder,
                )
            }

            let hash = musicInfo.hash || musicInfo.meta?.hash || ''
            if (source === 'kg' && !hash) {
                try {
                    const title = musicInfo.name || params.get('title') || params.get('name') || songmid
                    const searchRes = await musicSdk.kg.musicSearch.search(title, 1, 5)
                    const match = searchRes?.list?.find((item: any) => String(item.songmid || item.id || item.Audioid) === songmid) || searchRes?.list?.[0]
                    if (match) {
                        hash = match.hash || match.meta?.hash || match.types?.[0]?.hash || ''
                    }
                } catch (e) {
                    console.error('[Subsonic] Auto-resolve kg hash for stream failed:', e)
                }
            }

            musicInfo = {
                ...musicInfo,
                ...(hash ? { hash } : {}),
                meta: {
                    ...(musicInfo.meta || {}),
                    ...(hash ? { hash } : {}),
                }
            }

            const result = await callUserApiGetMusicUrl(source as any, musicInfo as any, quality, username)

            if (result && result.url) {
                return this.proxyAudioStream(req, res, result.url, contentType)
            } else {
                return this.sendError(res, 0, 'Could not resolve music URL', format)
            }
        } catch (err: any) {
            return this.sendError(res, 0, err.message || 'Stream error', format)
        }
    }

    private getAudioProxyAgent(targetUrl: string): http.Agent | undefined {
        const configProxy = global.lx.config['proxy.all.enabled']
            ? String(global.lx.config['proxy.all.address'] || '').trim()
            : ''
        const isHttpsTarget = targetUrl.startsWith('https:')
        const envProxy = isHttpsTarget
            ? process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY
            : process.env.HTTP_PROXY || process.env.ALL_PROXY
        const proxyAddress = configProxy || envProxy
        if (!proxyAddress) return undefined

        try {
            const proxyUrl = new URL(proxyAddress)
            if (proxyUrl.protocol.startsWith('socks')) {
                return new SocksProxyAgent(proxyAddress) as any
            }
            if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') return undefined

            const proxyOptions = {
                proxy: {
                    host: proxyUrl.hostname,
                    port: Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
                    proxyAuth: proxyUrl.username
                        ? `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`
                        : undefined,
                },
            }
            const isHttpsProxy = proxyUrl.protocol === 'https:'
            if (isHttpsTarget) {
                return (isHttpsProxy ? tunnel.httpsOverHttps : tunnel.httpsOverHttp)(proxyOptions)
            }
            return (isHttpsProxy ? tunnel.httpOverHttps : tunnel.httpOverHttp)(proxyOptions)
        } catch (err: any) {
            console.warn(`[Subsonic] Invalid audio proxy configuration: ${err.message}`)
            return undefined
        }
    }

    private proxyAudioStream(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        audioUrl: string,
        contentType: string,
    ): Promise<void> {
        return new Promise(resolve => {
            let activeRequest: http.ClientRequest | null = null
            let activeResponse: http.IncomingMessage | null = null
            let finished = false

            const finish = () => {
                if (finished) return
                finished = true
                resolve()
            }
            const fail = (statusCode: number, message: string) => {
                if (finished) return
                if (!res.headersSent) {
                    res.writeHead(statusCode, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                        'Pragma': 'no-cache',
                        'Expires': '0',
                    })
                    res.end(message)
                } else if (!res.destroyed) {
                    res.destroy()
                }
                finish()
            }
            const abortUpstream = () => {
                activeResponse?.destroy()
                activeRequest?.destroy()
            }

            req.once('aborted', abortUpstream)
            res.once('close', () => {
                if (!res.writableEnded) abortUpstream()
                finish()
            })

            const requestUpstream = (targetUrl: string, redirectCount: number) => {
                if (redirectCount > 5) {
                    fail(502, 'Too many upstream redirects')
                    return
                }

                let parsedUrl: URL
                try {
                    parsedUrl = new URL(targetUrl)
                } catch {
                    fail(502, 'Invalid upstream audio URL')
                    return
                }
                if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                    fail(502, 'Unsupported upstream audio protocol')
                    return
                }

                const requestHeaders: http.OutgoingHttpHeaders = {
                    'Accept': req.headers.accept || 'audio/*,*/*;q=0.8',
                    'Accept-Encoding': 'identity',
                    'User-Agent': req.headers['user-agent'] || 'LX Music Sync Server',
                    'Referer': `${parsedUrl.origin}/`,
                }
                if (req.headers.range) requestHeaders.Range = req.headers.range
                if (req.headers['if-range']) requestHeaders['If-Range'] = req.headers['if-range']

                const requestOptions: http.RequestOptions = {
                    protocol: parsedUrl.protocol,
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || undefined,
                    path: `${parsedUrl.pathname}${parsedUrl.search}`,
                    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
                    headers: requestHeaders,
                    agent: this.getAudioProxyAgent(targetUrl),
                }
                const transport = parsedUrl.protocol === 'https:' ? https : http
                activeRequest = transport.request(requestOptions, upstream => {
                    activeResponse = upstream
                    const statusCode = upstream.statusCode || 502
                    if ([301, 302, 303, 307, 308].includes(statusCode) && upstream.headers.location) {
                        const nextUrl = new URL(upstream.headers.location, targetUrl).href
                        upstream.resume()
                        requestUpstream(nextUrl, redirectCount + 1)
                        return
                    }

                    const responseHeaders: http.OutgoingHttpHeaders = {
                        'Content-Type': contentType,
                        'Cache-Control': 'private, max-age=300, no-transform',
                        'Access-Control-Allow-Origin': '*',
                    }
                    const copiedHeaders: Array<[keyof http.IncomingHttpHeaders, string]> = [
                        ['content-length', 'Content-Length'],
                        ['content-range', 'Content-Range'],
                        ['accept-ranges', 'Accept-Ranges'],
                        ['etag', 'ETag'],
                        ['last-modified', 'Last-Modified'],
                    ]
                    for (const [sourceHeader, targetHeader] of copiedHeaders) {
                        const value = upstream.headers[sourceHeader]
                        if (value !== undefined) responseHeaders[targetHeader] = value
                    }

                    res.writeHead(statusCode, responseHeaders)
                    if (req.method === 'HEAD') {
                        upstream.resume()
                        res.end()
                        finish()
                        return
                    }

                    upstream.once('error', err => {
                        if (finished) return
                        console.error(`[Subsonic] Upstream audio response failed: ${err.message}`)
                        fail(502, 'Upstream audio response failed')
                    })
                    upstream.once('end', finish)
                    upstream.pipe(res)
                })

                activeRequest.setTimeout(30_000, () => {
                    activeRequest?.destroy(new Error('Upstream audio request timed out'))
                })
                activeRequest.once('error', err => {
                    if (finished) return
                    console.error(`[Subsonic] Audio proxy request failed: ${err.message}`)
                    fail(502, 'Could not proxy music stream')
                })
                activeRequest.end()
            }

            requestUpstream(audioUrl, 0)
        })
    }

    private async handleGetCoverArt(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        let id = params.get('id')
        if (!id) {
            res.writeHead(204)
            return res.end()
        }

        // 0. 剥离前缀 (al-, ar-, tr-, sg-, mg-) 并处理 URL
        id = id.replace(/^(al-|ar-|tr-|sg-|mg-)/, '')
        if (id === 'logo') {
            const logoPath = path.join(global.lx.staticPath, 'music/assets/logo.svg')
            if (fs.existsSync(logoPath)) {
                res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
                return fs.createReadStream(logoPath).pipe(res)
            }
        }
        if (id.startsWith('http')) return this.proxyCoverImage(res, id)
        // console.log(`[CoverArt] Received Request: id=${id}, user=${username}`)

        // [新增] 兼容逻辑：处理不规范的 ID（如原始 albumMid）
        if (!id.includes('_')) {
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()
            const allMusics = [...listData.loveList, ...listData.defaultList, ...listData.userList.flatMap(l => (l.list || []) as LX.Music.MusicInfo[])]
            const matched = allMusics.find((m: any) => m.meta?.albumId === id || m.meta?.albumMid === id)
            if (matched) {
                const picUrl = (matched as any).meta?.picUrl || (matched as any).img
                if (picUrl) {
                    // console.log(`[CoverArt] Found cover via library cross-match for raw ID: ${id}`)
                    return this.proxyCoverImage(res, picUrl)
                }
            }
        }

        // 辅助：通过 SDK 获取封面（带超时保护）
        const getPicViaSDK = async (music: LX.Music.MusicInfo): Promise<string | null> => {
            const source = music.source as string
            const sdk = musicSdk[source]
            if (!sdk?.getPic) {
                // console.log(`[CoverArt] SDK not found or no getPic for source=${source}`)
                return null
            }
            try {
                const meta = (music as any).meta || {}
                // 剥离 source 前缀：'wy_604841' -> '604841'，确保平台 SDK 能识别
                const rawSongId = music.id.includes('_')
                    ? music.id.split('_').slice(1).join('_')
                    : music.id
                const songInfo = {
                    ...meta,
                    id: music.id,
                    name: music.name,
                    singer: music.singer,
                    source,
                    songmid: meta.songId || rawSongId,
                }
                // console.log(`[CoverArt] SDK getPic: source=${source}, songmid=${songInfo.songmid}, name=${music.name}`)
                const picUrl = await Promise.race([
                    sdk.getPic(songInfo),
                    new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
                ])
                // console.log(`[CoverArt] SDK getPic result: ${picUrl}`)
                return typeof picUrl === 'string' && picUrl.startsWith('http') ? picUrl : null
            } catch (e: any) {
                console.error(`[CoverArt] SDK getPic error:`, e?.message)
                return null
            }
        }



        // 1. 优先尝试从内存预缓存中获取 (用于 SDK 动态抓取的歌曲)
        if (this.songPicUrlCache.has(id)) {
            const cachedUrl = this.songPicUrlCache.get(id)
            if (cachedUrl) {
                // console.log(`[CoverArt] ✓ Cache Hit: ${id} -> ${cachedUrl}`)
                return this.proxyCoverImage(res, cachedUrl)
            }
        }

        // 2. 尝试从本地歌单库中查找
        let found = await this.findMusicById(username, id).catch(() => null)

        // [新增] 如果普通歌单没找到，去收藏专辑里找这首歌
        if (!found && id.includes('_')) {
            const libAlbums = await this.getLibraryData(username, 'albums')
            for (const alb of libAlbums) {
                const song = (alb.list || []).find((s: any) => `${s.source}_${s.songmid || s.songId}` === id)
                if (song) {
                    const source = alb.source || 'wy'
                    found = { music: { ...song, id, meta: { picUrl: song.img || song.meta?.picUrl } } as any, listId: `alb_${source}_${alb.id}` }
                    break
                }
            }
        }

        if (found) {
            const picUrl = (found.music as any)?.meta?.picUrl || (found.music as any)?.img || null
            // console.log(`[CoverArt] ✓ Library Match: ${found.music.name}, picUrl=${picUrl}`)
            if (picUrl) return this.proxyCoverImage(res, picUrl)
            const sdkPic = await getPicViaSDK(found.music)
            if (sdkPic) return this.proxyCoverImage(res, sdkPic)
            // console.log(`[CoverArt] SDK also returned nothing for song ${id}`)
        } else if (id.startsWith('alb_')) {
            // [新增] 处理 SDK 专辑封面
            const parts = id.split('_')
            const source = parts[1]
            const realId = parts.slice(2).join('_')
            // console.log(`[CoverArt] Album Route Parse: source=${source}, realId=${realId}`)
            if (musicSdk[source]?.getPic) {
                const pic = await musicSdk[source].getPic({ source, albumId: realId, albumMid: realId } as any)
                if (pic && typeof pic === 'string') {
                    // console.log(`[CoverArt] ✓ SDK Album Pic Success: ${pic}`)
                    return this.proxyCoverImage(res, pic)
                }
            }
        } else if (id.startsWith('art_')) {
            // [修改] 歌手封面逻辑优化：先查本地库，再查歌手图助手
            const parts = id.split('_')
            const source = parts[1]
            const realId = parts.slice(2).join('_')

            // 1. 尝试从本地歌手库 (artists.json) 获取 picUrl
            const libArtists = await this.getLibraryData(username, 'artists')
            const localArt = libArtists.find(a => (a.source === source && a.id === realId) || a.name === realId)
            if (localArt && (localArt.picUrl || localArt.img)) {
                return this.proxyCoverImage(res, localArt.picUrl || localArt.img)
            }

            // 2. 兜底尝试使用歌手名搜索照片
            const cover = await getSingerPic(localArt?.name || realId)
            if (cover) return this.proxyCoverImage(res, cover)
        } else if (id.includes('_')) {
            // 1.5 歌曲不在已加载的库中，解析 ID 直接尝试 SDK
            // console.log(`[CoverArt] Song ${id} not found in library, parsing for SDK...`)
            const parts = id.split('_')
            // 排除特殊前缀，获取真正的 source
            const source = ['alb', 'art', 'hot-songs'].includes(parts[0]) ? parts[1] : parts[0]
            const songmid = ['alb', 'art', 'hot-songs'].includes(parts[0]) ? parts.slice(2).join('_') : parts.slice(1).join('_')

            if (musicSdk[source]) {
                const music: any = { source, id, songmid, name: '', singer: '' }
                const sdkPic = await getPicViaSDK(music as any)
                if (sdkPic) return this.proxyCoverImage(res, sdkPic)
            }
        } else {
            // console.log(`[CoverArt] Path fallback for id: ${id}`)
        }

        // 2. 尝试作为歌手 ID 处理 (artist_歌手名)
        if (id.startsWith('artist_')) {
            const singerName = id.slice(7)
            if (singerName) {
                const cover = await getSingerPic(singerName)
                if (cover) return this.proxyCoverImage(res, cover)
            }
        }

        // 3. 尝试作为歌单 ID 处理
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        let listMusics: LX.Music.MusicInfo[] = []
        if (id === 'love') {
            listMusics = listData.loveList
        } else if (id === 'default') {
            listMusics = listData.defaultList
        } else {
            const list = listData.userList.find((l: any) => l.id === id)
            if (list) {
                if ((list as any).Album) return this.proxyCoverImage(res, (list as any).Album)
                listMusics = (list.list || []) as LX.Music.MusicInfo[]
            }
        }

        if (listMusics.length > 0) {
            // console.log(`[CoverArt] Treating as list, ${listMusics.length} songs`)
            for (const music of listMusics) {
                const picUrl = (music as any)?.meta?.picUrl || (music as any)?.img
                if (picUrl) return this.proxyCoverImage(res, picUrl)
            }
            const sdkPic = await getPicViaSDK(listMusics[0])
            if (sdkPic) return this.proxyCoverImage(res, sdkPic)
        }

        // 4. 兜底
        // console.log(`[CoverArt] No cover found for id=${id}, returning 204`)
        res.writeHead(204)
        res.end()
    }

    private async handleGetTopSongs(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const artist = (params.get('artist') || '').trim()
        const id = params.get('id') // OpenSubsonic 扩展参数
        const count = Math.min(parseInt(params.get('count') || '50'), 500)

        let picked: { music: LX.Music.MusicInfo, listId: string }[] = []

        // 1. 尝试从本地歌手库 (artists.json) 匹配
        const libArtists = await this.getLibraryData(username, 'artists')

        // 匹配逻辑增强：支持 ID 匹配或模糊名字匹配
        const artistEntry = libArtists.find(a =>
            (id && `art_${a.source || 'wy'}_${a.id}` === id) ||
            (artist && (a.name.toLowerCase().includes(artist.toLowerCase()) || artist.toLowerCase().includes(a.name.toLowerCase())))
        )

        if (artistEntry && artistEntry.source && artistEntry.id && musicSdk[artistEntry.source]?.extendDetail) {
            try {
                const source = artistEntry.source
                const MAX_PAGES = 5
                const PAGE_SIZE = 100
                let all: any[] = []
                for (let p = 1; p <= MAX_PAGES; p++) {
                    const data = await musicSdk[source].extendDetail.getArtistSongs(artistEntry.id, p, PAGE_SIZE, 'hot')
                    const pageList = data.list || []
                    all = all.concat(pageList)
                    if (pageList.length < PAGE_SIZE) break
                }
                picked = all.map((s: any) => ({
                    music: { ...s, id: `${source}_${s.songmid || s.songId}` } as LX.Music.MusicInfo,
                    listId: `art_${source}_${artistEntry.id}`
                }))
            } catch (e) {
                console.error(`[Subsonic] getTopSongs SDK error for ${artist || id}:`, e)
            }
        }

        // 2. 兜底逻辑：如果在 SDK/库里没找到，搜索本地所有播放列表
        if (picked.length === 0) {
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()
            const all: { music: LX.Music.MusicInfo, listId: string }[] = []
            const addAll = (musics: LX.Music.MusicInfo[], listId: string) => {
                for (const m of musics) {
                    if (!artist || m.singer.toLowerCase().includes(artist.toLowerCase())) {
                        all.push({ music: m, listId })
                    }
                }
            }
            addAll(listData.loveList, 'love')
            addAll(listData.defaultList, 'default')
            for (const list of listData.userList) addAll((list.list || []) as LX.Music.MusicInfo[], list.id)
            picked = all.slice(0, count)
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                topSongs: {
                    song: picked.map(({ music, listId }) => this.musicToSongFlat(music, listId)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            topSongs: {
                children: {
                    song: picked.map(({ music, listId }) => this.musicToSongXml(music, listId)),
                },
            },
        }, format)
    }

    /**
     * 将 Location 重定向到图片 URL
     * 减轻服务器负担，让客户端自行下载
     */
    private async proxyCoverImage(res: http.ServerResponse, picUrl: string) {
        res.writeHead(302, {
            'Location': picUrl,
            'Cache-Control': 'public, max-age=1800'
        })
        res.end()
    }

    private handleGetOpenSubsonicExtensions(res: http.ServerResponse, format: string) {
        const extensions = [
            { name: 'formPost', versions: [1] },
            { name: 'coverArtScaling', versions: [1] },
            { name: 'thumbnails', versions: [1] },
            { name: 'lyrics', versions: [1] },
            { name: 'songLyrics', versions: [1] },
        ]
        const data = { openSubsonicExtensions: format === 'json' ? extensions : { children: { extension: extensions.map(e => ({ attrs: e })) } } }
        return this.sendResponse(res, data, format)
    }

    private async handleGetLyrics(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const artist = params.get('artist') || ''
        const title = params.get('title') || ''
        const id = params.get('id')

        // [新增] 如果请求中带有 ID，优先使用 ID 通过 SDK 获取歌词
        if (id) {
            return this.handleGetLyricsBySongId(res, username, params, format, true)
        }

        // 尝试通过歌手和标题反查歌曲 ID
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()
        const all: LX.Music.MusicInfo[] = [
            ...listData.loveList,
            ...listData.defaultList,
            ...listData.userList.flatMap(l => (l.list || []) as LX.Music.MusicInfo[])
        ]

        const found = all.find(m =>
            m.name.toLowerCase() === title.toLowerCase() &&
            m.singer.toLowerCase().includes(artist.toLowerCase())
        )

        if (found) {
            params.set('id', found.id)
            return this.handleGetLyricsBySongId(res, username, params, format, true)
        }

        const lyricsData = {
            artist: artist,
            title: title,
            value: 'Lyrics not found in library. Please use getLyricsBySongId with a valid song ID.'
        }

        if (format === 'json') {
            return this.sendResponse(res, { lyrics: lyricsData }, format)
        }
        return this.sendResponse(res, {
            lyrics: {
                attrs: { artist: lyricsData.artist, title: lyricsData.title },
                children: lyricsData.value
            }
        }, format)
    }

    /**
     * 将原文 (lyric) 与翻译 (tlyric) 按时间戳交织合并为双行 LRC 格式
     * 排列顺序：最上方为原文 ➔ 最下方为翻译
     */
    private buildMergedLrc(rawLrc: string, transLrc?: string): string {
        const isTransEnabled = global.lx.config['subsonic.lyricTranslation'] !== false
        const effectiveTransLrc = isTransEnabled ? transLrc : ''

        if (!effectiveTransLrc) return rawLrc || ''

        const parseLrcMap = (lrc: string) => {
            const map = new Map<string, string[]>()
            if (!lrc) return map
            const lines = lrc.split(/\r?\n/)
            const timeRegex = /\[(\d{1,3}:\d{1,2}(?:\.\d{1,3})?)\]/g
            for (const line of lines) {
                const text = line.replace(/\[\d{1,3}:\d{1,2}(?:\.\d{1,3})?\]/g, '').trim()
                if (!text) continue
                timeRegex.lastIndex = 0
                const matches = [...line.matchAll(timeRegex)]
                for (const m of matches) {
                    const t = m[1]
                    if (!map.has(t)) map.set(t, [])
                    map.get(t)!.push(text)
                }
            }
            return map
        }

        const rawMap = parseLrcMap(rawLrc)
        const transMap = parseLrcMap(effectiveTransLrc || '')

        // 收集所有出现的时间戳标签
        const allTimeLabels = Array.from(new Set([...rawMap.keys(), ...transMap.keys()]))

        // 辅助时间戳转毫秒排序
        const labelToMs = (label: string) => {
            const parts = label.split(':')
            const secParts = (parts[1] || '0').split('.')
            const min = parseInt(parts[0]) || 0
            const sec = parseInt(secParts[0]) || 0
            const ms = parseInt((secParts[1] || '0').padEnd(3, '0')) || 0
            return min * 60000 + sec * 1000 + ms
        }

        allTimeLabels.sort((a, b) => labelToMs(a) - labelToMs(b))

        const outLines: string[] = []
        for (const t of allTimeLabels) {
            const raws = rawMap.get(t) || []
            const transs = transMap.get(t) || []

            // 排列顺序：原文在上，翻译在下
            for (const r of raws) outLines.push(`[${t}]${r}`)
            for (const tr of transs) outLines.push(`[${t}]${tr}`)
        }

        return outLines.join('\n')
    }

    private async handleGetLyricsBySongId(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
        legacyResponse = false,
    ) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        // 解析 source 和 songmid
        let source = ''
        let songmid = ''
        if (id.includes('_')) {
            const index = id.indexOf('_')
            source = id.substring(0, index)
            songmid = id.substring(index + 1)
        }

        if (!source || !musicSdk[source]) {
            return this.sendError(res, 70, 'Song or source not supported: ' + id, format)
        }

        try {
            // 尝试查找歌曲详情以丰富歌词请求元数据 (KG/MG 特别需要)
            const found = await this.findMusicById(username, id)
            const musicMeta = found?.music || {
                id,
                source,
                songmid,
                name: params.get('title') || '',
                singer: params.get('artist') || ''
            } as any

            let hash = (musicMeta as any).hash || (musicMeta as any).meta?.hash || ''
            if (source === 'kg' && !hash) {
                try {
                    const title = musicMeta.name || params.get('title') || params.get('name') || songmid
                    const searchRes = await musicSdk.kg.musicSearch.search(title, 1, 5)
                    const match = searchRes?.list?.find((item: any) => String(item.songmid || item.id || item.Audioid) === songmid) || searchRes?.list?.[0]
                    if (match) {
                        hash = match.hash || match.meta?.hash || match.types?.[0]?.hash || ''
                    }
                } catch (e) {
                    console.error('[Subsonic] Auto-resolve kg hash for lyric failed:', e)
                }
            }

            const songInfo = {
                songmid: (musicMeta as any).songmid || songmid,
                name: musicMeta.name || '',
                singer: musicMeta.singer || '',
                hash: hash,
                interval: (musicMeta as any).interval || '',
                _interval: (musicMeta as any)._interval || (musicMeta as any).interval || '',
                copyrightId: (musicMeta as any).copyrightId || (musicMeta as any).meta?.copyrightId || '',
                albumId: (musicMeta as any).albumId || (musicMeta as any).meta?.albumId || '',
                lrcUrl: (musicMeta as any).lrcUrl || (musicMeta as any).meta?.lrcUrl || '',
            }

            const requestObj = musicSdk[source].getLyric(songInfo)
            const lyricInfo = await requestObj.promise

            const rawLrc = lyricInfo.lyric || ''
            const transLrc = lyricInfo.tlyric || ''

            const mergedLrc = this.buildMergedLrc(rawLrc, transLrc)

            // 转换结构化歌词
            const lines = this.parseLrc(rawLrc)
            const tlines = transLrc ? this.parseLrc(transLrc) : []

            const structuredLyrics: any[] = [
                {
                    lang: 'und',
                    synced: lines.some(l => l.start !== undefined),
                    line: lines,
                    displayArtist: musicMeta.singer,
                    displayTitle: musicMeta.name,
                }
            ]

            if (tlines.length > 0) {
                structuredLyrics.push({
                    lang: 'zh',
                    synced: tlines.some(l => l.start !== undefined),
                    line: tlines,
                    displayArtist: musicMeta.singer,
                    displayTitle: musicMeta.name,
                })
            }

            // Keep the legacy and OpenSubsonic extension responses separate.
            // Some clients reject a getLyrics response when lyricsList is present.
            if (legacyResponse) {
                if (format === 'json') {
                    return this.sendResponse(res, {
                        lyrics: {
                            artist: musicMeta.singer,
                            title: musicMeta.name,
                            value: mergedLrc,
                        },
                    }, format)
                }
                return this.sendResponse(res, {
                    lyrics: {
                        attrs: { artist: musicMeta.singer, title: musicMeta.name },
                        children: mergedLrc,
                    },
                }, format)
            }

            if (format === 'json') {
                return this.sendResponse(res, {
                    lyricsList: { structuredLyrics },
                }, format)
            }

            // XML 模式逻辑
            const structuredLyricsXml = structuredLyrics.map(item => ({
                attrs: {
                    lang: item.lang,
                    synced: item.synced,
                    displayArtist: item.displayArtist,
                    displayTitle: item.displayTitle,
                },
                children: {
                    line: item.line.map((line: { value: string, start?: number }) => ({
                        attrs: line.start === undefined ? undefined : { start: line.start },
                        children: line.value,
                    })),
                },
            }))

            return this.sendResponse(res, {
                lyricsList: {
                    children: {
                        structuredLyrics: structuredLyricsXml,
                    },
                },
            }, format)

        } catch (err: any) {
            console.error(`[Subsonic] Lyric fetch error:`, err)
            return this.sendError(res, 0, 'Failed to fetch lyrics: ' + err.message, format)
        }
    }

    private parseLrc(lrc: string): { value: string, start?: number }[] {
        if (!lrc) return []
        const lines = lrc.split(/\r?\n/)
        const result: { value: string, start?: number }[] = []
        const timeRegex = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g
        const timestampPresenceRegex = /\[\d{1,3}:\d{1,2}(?:\.\d{1,3})?\]/
        const metadataRegex = /^\s*\[(?:ti|ar|al|by|offset|re|ve|length):/i
        const hasTimestamp = lines.some(line => timestampPresenceRegex.test(line))

        for (const line of lines) {
            if (metadataRegex.test(line)) continue

            timeRegex.lastIndex = 0 // 重置正则索引
            const matches = [...line.matchAll(timeRegex)]
            const text = line.replace(timeRegex, '').trim()
            if (!text) continue

            if (matches.length > 0) {
                for (const match of matches) {
                    const minutes = parseInt(match[1])
                    const seconds = parseInt(match[2])
                    const msStr = (match[3] || '0').padEnd(3, '0')
                    const ms = parseInt(msStr)
                    const startTime = minutes * 60000 + seconds * 1000 + ms
                    result.push({ value: text, start: startTime })
                }
            } else if (!hasTimestamp) {
                result.push({ value: text })
            }
        }
        return result.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    }

    private async handleGetUser(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const userInfo = {
            username,
            email: '',
            scrobblingEnabled: false,
            adminRole: true,
            settingsRole: true,
            downloadRole: true,
            uploadRole: false,
            playlistRole: true,
            coverArtRole: true,
            commentRole: false,
            podcastRole: false,
            shareRole: false,
            videoConversionRole: false,
            folder: [1],
        }
        if (format === 'json') {
            return this.sendResponse(res, { user: userInfo }, format)
        }
        return this.sendResponse(res, { user: { attrs: userInfo } }, format)
    }
}

export const subsonicHandler = new SubsonicHandler()
