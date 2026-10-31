import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { ZipArchive } from 'archiver'
import { Open } from 'unzipper'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { pipeline } from 'stream/promises'
import { backupType, backupLocalPath, getBackupTypes, normalizeBackupTypes, scanBackupFiles, beginCloudRestore, isCloudRestoreRunning, type BackupType } from './backupPolicy'

interface WebDAVConfig {
    enable?: boolean
    url: string
    username: string
    password: string
    syncPath?: string
    backupPath?: string
    interval?: number
    backupInterval?: number
    excludeCache?: boolean  // 排除缓存目录 (data/cache)
    excludeMusic?: boolean  // 排除下载目录 (data/music)
    types?: BackupType[]
    mirrorDeletes?: boolean
}

interface SyncLog {
    timestamp: number
    type: 'upload' | 'download' | 'backup' | 'restore'
    file: string
    status: 'success' | 'error'
    message?: string
}

const normalizeRemotePath = (p?: string, defaultPath: string = ''): string => {
    let str = (p || '').trim()
    if (!str) str = defaultPath
    if (!str.startsWith('/')) str = '/' + str
    return str.replace(/\/+$/, '')
}

class WebDAVSync extends EventEmitter {
    private config: WebDAVConfig
    private dataPath: string
    private syncPath: string
    private backupPath: string
    private syncInterval: number // 文件增量变化检测与同步间隔（毫秒）
    private backupInterval: number // 全量备份间隔（毫秒）
    private excludeCache: boolean  // 是否排除缓存目录 (data/cache)
    private excludeMusic: boolean  // 是否排除下载目录 (data/music)
    private watchTimer: NodeJS.Timeout | null = null
    private backupTimer: NodeJS.Timeout | null = null
    private filesHash: Map<string, string> = new Map()
    private backupHash: Map<string, string> = new Map()
    private syncing = false
    private restoring = false
    private syncLogs: SyncLog[] = []
    private client: any = null
    private initPromise: Promise<boolean> | null = null
    private ensuredDirs: Set<string> = new Set()

    constructor(config: WebDAVConfig, dataPath: string) {
        super()
        this.syncPath = normalizeRemotePath(config.syncPath, '/lx-sync')
        this.backupPath = normalizeRemotePath(config.backupPath, '/lx-sync-backups')
        this.config = {
            enable: config.enable ?? false,
            url: config.url || '',
            username: config.username || '',
            password: config.password || '',
            syncPath: this.syncPath,
            backupPath: this.backupPath,
            types: config.types,
            mirrorDeletes: config.mirrorDeletes === true,
        }
        this.syncInterval = (config.interval || 60) * 60 * 1000
        this.backupInterval = (config.backupInterval || 24) * 60 * 60 * 1000
        this.excludeCache = config.excludeCache ?? false
        this.excludeMusic = config.excludeMusic ?? false
        this.dataPath = dataPath
    }

    async initClient(force = false): Promise<boolean> {
        if (!this.isConfigured()) return false
        if (this.client && !force) return true
        if (this.initPromise) return this.initPromise

        this.initPromise = (async () => {
            try {
                // 动态导入 webdav ESM 模块
                const { createClient } = await import('webdav')
                const isHttps = this.config.url.startsWith('https:')
                const agent = isHttps
                    ? new https.Agent({ keepAlive: true, maxSockets: 20, keepAliveMsecs: 60000, timeout: 60000 })
                    : new http.Agent({ keepAlive: true, maxSockets: 20, keepAliveMsecs: 60000, timeout: 60000 })

                const options: any = {
                    httpAgent: agent,
                    httpsAgent: agent,
                }
                if (this.config.username) options.username = this.config.username
                if (this.config.password) options.password = this.config.password
                this.client = createClient(this.config.url, options)
                console.log('WebDAV client initialized with Keep-Alive connection pooling')
                return true
            } catch (err) {
                console.error('Failed to initialize WebDAV client:', err)
                this.client = null
                return false
            } finally {
                this.initPromise = null
            }
        })()

        return this.initPromise
    }

    isConfigured(): boolean {
        return !!(this.config.enable && this.config.url && this.config.url.trim() !== '')
    }

    private addLog(log: SyncLog) {
        this.syncLogs.unshift(log)
        if (this.syncLogs.length > 100) {
            this.syncLogs = this.syncLogs.slice(0, 100)
        }
        this.emit('log', log)
    }

    getSyncLogs(): SyncLog[] {
        return this.syncLogs
    }

    private getFileHash(filePath: string): string {
        try {
            const buffer = fs.readFileSync(filePath)
            const hash = crypto.createHash('md5')
            hash.update(buffer as any)
            return hash.digest('hex')
        } catch {
            return ''
        }
    }

    private context() {
        return { dataPath: this.dataPath, configPath: global.lx?.configPath, config: global.lx?.config as any }
    }

    private selectedTypes(): BackupType[] {
        return this.config.types ?? getBackupTypes('webdav', { 'webdav.excludeMusic': this.excludeMusic })
    }

    private shouldIgnore(relativePath: string): boolean {
        const type = backupType(relativePath)
        return !type || !this.selectedTypes().includes(type)
    }

    private localPath(relativePath: string): string {
        return backupLocalPath(relativePath, this.context())
    }

    private async scanFiles(): Promise<Map<string, string>> {
        const files = new Map<string, string>()
        for (const [relative, local] of scanBackupFiles(this.context(), this.selectedTypes())) files.set(relative, this.getFileHash(local))
        return files
    }

    private async getChangedFiles(): Promise<{ changed: string[], deleted: string[] }> {
        const currentFiles = await this.scanFiles()
        const changed: string[] = []
        const deleted: string[] = []

        // 检查新增和修改的文件
        for (const [file, hash] of currentFiles) {
            if (!this.filesHash.has(file) || this.filesHash.get(file) !== hash) {
                changed.push(file)
            }
        }

        // 检查已删除的文件
        for (const [file] of this.filesHash) {
            if (!currentFiles.has(file)) {
                deleted.push(file)
            }
        }

        return { changed, deleted }
    }

    private getRelativeRemotePath(remoteFilename: string): string {
        // 重要：不主动进行 decodeURIComponent！
        // 因为如果文件在磁盘上本身就是 URL 编码过的
        // 且 WebDAV 返回的也是该路径，保持原字符才能与本地文件列表精确对应！
        const normSync = this.syncPath.replace(/\\/g, '/').replace(/\/+$/, '')
        const normRemote = remoteFilename.replace(/\\/g, '/')
        const prefix = normSync + '/'

        if (normRemote.startsWith(prefix)) {
            return normRemote.slice(prefix.length).replace(/\\/g, '/')
        }
        if (normRemote.startsWith(normSync)) {
            return normRemote.slice(normSync.length).replace(/^\/+/, '').replace(/\\/g, '/')
        }
        throw new Error('云端文件不在配置的同步目录内')
    }

    private async runConcurrent<T, R>(
        items: T[],
        concurrency: number,
        fn: (item: T, index: number) => Promise<R>
    ): Promise<R[]> {
        if (items.length === 0) return []
        const results: R[] = new Array(items.length)
        let index = 0
        const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (index < items.length) {
                const currentIndex = index++
                results[currentIndex] = await fn(items[currentIndex], currentIndex)
            }
        })
        await Promise.all(workers)
        return results
    }

    /**
     * 逐级安全确保远程目录存在（严格遵循 POSIX 路径与 WebDAV 规约）
     * 自动捕获 405 (MKCOL Method Not Allowed, 目录已存在)、409 (Conflict)、301 等并容错处理
     */
    async ensureRemoteDir(remoteDirPath: string): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        const normalizedDir = remoteDirPath.replace(/\\/g, '/').replace(/\/+$/, '')
        if (!normalizedDir || normalizedDir === '/' || this.ensuredDirs.has(normalizedDir)) {
            return true
        }

        const segments = normalizedDir.split('/').filter(Boolean)
        let cur = ''

        for (const seg of segments) {
            cur += '/' + seg
            if (this.ensuredDirs.has(cur)) continue

            try {
                // 部分 WebDAV 服务器调用 createDirectory 时若目录已存在会报 405
                await this.client.createDirectory(cur, { recursive: false })
            } catch (err: any) {
                const msg = String(err?.message || '')
                const status = err?.status || err?.response?.status
                // 405 (Method Not Allowed), 301, 409 (Conflict) 均表示目录已存在或无需再建
                if (status === 405 || status === 409 || msg.includes('405') || msg.includes('exists')) {
                    // benign - directory already exists
                } else {
                    // 其他错误打印提示但继续允许尝试后续操作
                    // console.warn(`[WebDAV] ensureRemoteDir warning for ${cur}:`, msg)
                }
            }
            this.ensuredDirs.add(cur)
        }

        return true
    }

    async deleteRemoteFile(relativePath: string): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const remotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`
            await this.client.deleteFile(remotePath)
            this.addLog({
                timestamp: Date.now(),
                type: 'upload', // 借用 upload 类型表示同步操作
                file: relativePath,
                status: 'success',
                message: 'Remote file deleted'
            })
            return true
        } catch (err: any) {
            // 如果远程文件已经不存在，也认为成功
            if (err.status === 404) return true
            console.error(`Failed to delete remote file ${relativePath}:`, err.message)
            return false
        }
    }

    async uploadFile(relativePath: string): Promise<boolean> {
        if (isCloudRestoreRunning()) return false
        if (this.shouldIgnore(relativePath)) return false
        if (!this.client) await this.initClient()
        if (!this.client) return false

        const localPath = this.localPath(relativePath)
        if (!fs.existsSync(localPath)) return false

        let stat: fs.Stats
        try {
            stat = fs.statSync(localPath)
        } catch {
            return false
        }

        const remotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`
        const remoteDir = path.posix.dirname(remotePath)

        // 确保远程父目录存在
        await this.ensureRemoteDir(remoteDir)

        // 重试机制：最多 3 次尝试，针对 423 Locked、405、网络波动进行智能退避
        const maxRetries = 3
        let lastError: any = null

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // 使用流式上传并监控进度
                const readStream = fs.createReadStream(localPath)
                const passThrough = new PassThrough()
                let uploadedBytes = 0

                passThrough.on('data', (chunk) => {
                    uploadedBytes += chunk.length
                    this.emit('progress', {
                        type: 'file',
                        status: 'uploading',
                        file: relativePath,
                        current: uploadedBytes,
                        total: stat.size
                    })
                })

                readStream.pipe(passThrough)
                await this.client.putFileContents(remotePath, passThrough, { overwrite: true })

                this.emit('progress', {
                    type: 'file',
                    status: 'success',
                    file: relativePath,
                    current: stat.size,
                    total: stat.size
                })

                this.addLog({
                    timestamp: Date.now(),
                    type: 'upload',
                    file: relativePath,
                    status: 'success',
                })
                return true
            } catch (err: any) {
                lastError = err
                const errMsg = String(err?.message || '')
                const status = err?.status || err?.response?.status

                // 如果是 423 Locked，等待锁释放
                const isLocked = status === 423 || errMsg.includes('423') || errMsg.includes('Locked')
                const isMethodNotAllowed = status === 405 || errMsg.includes('405')

                if (attempt < maxRetries) {
                    const delay = isLocked ? attempt * 1200 : attempt * 600
                    console.warn(`[WebDAV] Upload ${relativePath} attempt ${attempt} failed (${errMsg}), retrying in ${delay}ms...`)
                    if (isMethodNotAllowed) {
                        // 尝试重新确保父目录
                        this.ensuredDirs.delete(remoteDir)
                        await this.ensureRemoteDir(remoteDir)
                    }
                    await new Promise(r => setTimeout(r, delay))
                }
            }
        }

        console.error(`[WebDAV] Failed to upload file ${relativePath} after ${maxRetries} attempts:`, lastError?.message)
        this.emit('progress', {
            type: 'file',
            status: 'error',
            file: relativePath,
            error: lastError?.message || 'Upload failed'
        })
        this.addLog({
            timestamp: Date.now(),
            type: 'upload',
            file: relativePath,
            status: 'error',
            message: `重试${maxRetries}次失败: ${lastError?.message || '未知错误'}`
        })
        // 优雅跳过，返回 false，不阻断整个批量流程
        return false
    }

    async downloadFile(relativePath: string, rawRemotePath?: string): Promise<boolean> {
        if (this.shouldIgnore(relativePath)) return false
        if (!this.client) await this.initClient()
        if (!this.client) return false

        const defaultRemotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`
        const primaryRemotePath = rawRemotePath || defaultRemotePath
        const localPath = this.localPath(relativePath)

        // 确保本地目录存在
        const localDir = path.dirname(localPath)
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true })
        }

        const maxRetries = 3
        let lastError: any = null

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                let content: any = null
                try {
                    content = await this.client.getFileContents(primaryRemotePath) as any
                } catch (firstErr: any) {
                    // 如果因为 URL 编码差异导致 404，尝试自动回退 (如原始路径 vs decodeURIComponent vs encodeURI)
                    const status = firstErr?.status || firstErr?.response?.status
                    if (status === 404 || String(firstErr?.message).includes('404')) {
                        const candidates = new Set<string>()
                        candidates.add(defaultRemotePath)
                        try { candidates.add(decodeURIComponent(primaryRemotePath)) } catch { }
                        try { candidates.add(encodeURI(decodeURI(primaryRemotePath))) } catch { }

                        let recovered = false
                        for (const altPath of candidates) {
                            if (altPath === primaryRemotePath) continue
                            try {
                                content = await this.client.getFileContents(altPath) as any
                                recovered = true
                                break
                            } catch { }
                        }
                        if (!recovered) throw firstErr
                    } else {
                        throw firstErr
                    }
                }

                // 对比内容哈希，如果一致则跳过写入，避免触发文件系统监控
                if (fs.existsSync(localPath)) {
                    const localContent = fs.readFileSync(localPath) as any
                    const localHash = crypto.createHash('md5').update(localContent).digest('hex')
                    const remoteHash = crypto.createHash('md5').update(content).digest('hex')

                    if (localHash === remoteHash) {
                        return true
                    }
                }

                const temporary = localPath + '.' + crypto.randomUUID() + '.tmp'
                try { fs.writeFileSync(temporary, content); fs.renameSync(temporary, localPath) }
                finally { fs.rmSync(temporary, { force: true }) }

                if (relativePath === 'config.js') {
                    console.log('config.js restored from WebDAV, content updated in data directory.')
                }

                this.addLog({
                    timestamp: Date.now(),
                    type: 'download',
                    file: relativePath,
                    status: 'success',
                })
                return true
            } catch (err: any) {
                lastError = err
                if (attempt < maxRetries) {
                    await new Promise(r => setTimeout(r, attempt * 600))
                }
            }
        }

        console.error(`[WebDAV] Failed to download file ${relativePath} after ${maxRetries} attempts:`, lastError?.message)
        this.addLog({
            timestamp: Date.now(),
            type: 'download',
            file: relativePath,
            status: 'error',
            message: `下载失败: ${lastError?.message || '未知错误'}`,
        })
        return false
    }

    async createBackup(): Promise<string | null> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const zipName = `lx-sync-backup-${timestamp}.zip`
            const zipPath = path.join(this.dataPath, zipName)

            // 预扫描待备份的文件总数，以便提供精确的打包进度条
            const allFiles = await this.scanFiles()
            if (!allFiles.size) {
                this.emit('progress', { type: 'backup', status: 'finish', message: '所选类型没有可备份的文件' })
                return null
            }
            const totalFiles = Math.max(allFiles.size, 1)

            this.emit('progress', {
                type: 'backup',
                status: 'packing',
                message: `正在准备打包，共 ${totalFiles} 个文件...`,
                current: 0,
                total: totalFiles,
                percent: 2
            })

            await new Promise<void>((resolve, reject) => {
                const output = fs.createWriteStream(zipPath)
                // 压缩级别调优：对于音乐、封面及数据库等混合文件，level: 4 或 5 可在保留极佳压缩比的同时将打包装箱耗时提升 3~4 倍
                const archive = new ZipArchive({ zlib: { level: 4 } })

                let fileCount = 0

                // 监听文件添加事件
                archive.on('entry', (entry: any) => {
                    fileCount++
                    const packingPercent = Math.min(48, Math.round(5 + (fileCount / totalFiles) * 43))
                    this.emit('progress', {
                        type: 'backup',
                        status: 'packing',
                        message: `正在打包: ${entry.name}`,
                        current: fileCount,
                        total: totalFiles,
                        percent: packingPercent,
                        file: entry.name
                    })
                })

                output.on('close', () => resolve())
                archive.on('error', (err: Error) => reject(err))

                archive.pipe(output)
                for (const relative of allFiles.keys()) archive.file(this.localPath(relative), { name: relative.replace(/\\/g, '/') })

                archive.finalize()
            })

            this.emit('progress', {
                type: 'backup',
                status: 'packed',
                message: 'ZIP 压缩包创建完成，准备上传云端...',
                percent: 50
            })

            return zipName
        } catch (err) {
            console.error('Failed to create backup:', err)
            return null
        }
    }

    async uploadBackup(force = false): Promise<boolean> {
        if (this.syncing || this.restoring || isCloudRestoreRunning()) return false
        this.syncing = true
        if (!this.client) await this.initClient()
        if (!this.client) { this.syncing = false; return false }

        let zipPath: string | null = null
        try {
            // 检查是否有文件变化
            if (!force) {
                const current = await this.scanFiles()
                const unchanged = current.size === this.backupHash.size && [...current].every(([file, hash]) => this.backupHash.get(file) === hash)
                if (unchanged) {
                    console.log('No changes detected, skipping backup')
                    return true
                }
            }

            this.emit('progress', { type: 'backup', status: 'preparing', message: '正在创建备份...' })

            const backupSnapshot = await this.scanFiles()
            const zipName = await this.createBackup()
            if (!zipName) return false

            zipPath = path.join(this.dataPath, zipName)
            const stat = fs.statSync(zipPath)
            const remotePath = `${this.backupPath}/${zipName}`

            // 高性能流式上传：增大缓冲区至 1MB (1024 * 1024)，减少操作系统 I/O 切换与背压调度
            const readStream = fs.createReadStream(zipPath, { highWaterMark: 1024 * 1024 })
            const passThrough = new PassThrough({ highWaterMark: 1024 * 1024 })
            let uploadedBytes = 0

            // 节流控制，避免发送过多 SSE 消息
            let lastProgressTime = 0

            passThrough.on('data', (chunk) => {
                uploadedBytes += chunk.length
                const now = Date.now()
                if (now - lastProgressTime > 100 || uploadedBytes === stat.size) { // 至少间隔100ms
                    this.emit('progress', {
                        type: 'backup',
                        status: 'uploading',
                        file: zipName,
                        total: stat.size,
                        current: uploadedBytes
                    })
                    lastProgressTime = now
                }
            })

            // 确保远程备份目录存在
            const remoteDir = path.posix.dirname(remotePath)
            await this.ensureRemoteDir(remoteDir)

            readStream.pipe(passThrough)

            await this.client.putFileContents(remotePath, passThrough, { overwrite: true })

            this.emit('progress', {
                type: 'backup',
                status: 'success',
                file: zipName,
                total: stat.size,
                current: stat.size
            })

            this.addLog({
                timestamp: Date.now(),
                type: 'backup',
                file: zipName,
                status: 'success',
            })

            this.backupHash = backupSnapshot

            // 清理旧备份（保留最近5个）
            try {
                await this.cleanOldBackups()
            } catch (e) {
                console.error('Failed to clean old remote backups:', e)
            }

            return true
        } catch (err: any) {
            this.emit('progress', { type: 'backup', status: 'error', error: err.message })
            this.addLog({
                timestamp: Date.now(),
                type: 'backup',
                file: 'backup',
                status: 'error',
                message: err.message,
            })
            return false
        } finally {
            this.syncing = false
            // 确保无论上传成功还是失败，总是及时清理本地临时 zip 文件
            if (zipPath && fs.existsSync(zipPath)) {
                try {
                    fs.unlinkSync(zipPath)
                } catch (e) {
                    console.error('Failed to cleanup local backup zip:', e)
                }
            }
        }
    }

    async syncAllFiles(): Promise<boolean> {
        if (this.syncing || this.restoring || isCloudRestoreRunning()) return false
        this.syncing = true
        if (!this.client) await this.initClient()
        if (!this.client) {
            this.syncing = false
            this.emit('progress', { type: 'sync', status: 'error', message: 'WebDAV 客户端未初始化' })
            return false
        }

        let total = 0
        let successCount = 0
        let failCount = 0

        try {
            const files = await this.scanFiles()
            const fileList = Array.from(files.keys())
            let count = 0
            total = fileList.length

            if (total === 0) {
                this.emit('progress', { type: 'sync', status: 'finish', total: 0, message: '没有检测到需要同步的数据文件' })
                return true
            }

            this.emit('progress', { type: 'sync', status: 'start', total })

            // 适度并发（4 连接），兼顾吞吐量同时防止 WebDAV 服务端 423 Locked 冲突
            await this.runConcurrent(fileList, 4, async (file) => {
                const ok = await this.uploadFile(file)
                count++
                if (ok) { successCount++; this.filesHash.set(file, files.get(file)!) }
                else failCount++

                this.emit('progress', {
                    type: 'sync',
                    status: 'processing',
                    current: count,
                    total,
                    file
                })
            })

            if (failCount > 0) {
                console.warn(`[WebDAV] Sync all files finished: ${successCount} succeeded, ${failCount} skipped/failed.`)
            } else {
                console.log(`[WebDAV] Sync all files finished successfully (${successCount} files).`)
            }
            return failCount === 0
        } catch (err: any) {
            console.error('Sync all files failed:', err)
            this.emit('progress', { type: 'sync', status: 'error', message: err.message || '同步失败' })
            return false
        } finally {
            this.syncing = false
            // 无论如何，在最后必须发射 finish 或 error，保证前端进度条绝对不悬挂！
            this.emit('progress', {
                type: 'sync',
                status: 'finish',
                total,
                successCount,
                failCount,
                message: failCount > 0 ? `同步完成: ${successCount} 个成功，${failCount} 个失败/跳过` : `全部 ${total} 个文件同步成功`
            })
        }
    }

    private parseBackupTime(item: any): number {
        if (item.lastmod) {
            const parsed = Date.parse(item.lastmod)
            if (!isNaN(parsed)) return parsed
        }
        const match = item.basename?.match(/lx-sync-backup-(.+?)\.zip$/)
        if (match && match[1]) {
            const parts = match[1].split('T')
            if (parts.length === 2) {
                const timeStr = parts[1].replace(/(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/, '$1:$2:$3.$4')
                const parsed = Date.parse(`${parts[0]}T${timeStr}`)
                if (!isNaN(parsed)) return parsed
            }
        }
        return 0
    }

    async cleanOldBackups() {
        if (!this.client) return

        try {
            const items = await this.client.getDirectoryContents(`${this.backupPath}/`)
            const backups = items
                .filter((item: any) => item.basename.startsWith('lx-sync-backup-'))
                .sort((a: any, b: any) => this.parseBackupTime(b) - this.parseBackupTime(a))

            // 删除第6个及以后的备份
            for (let i = 5; i < backups.length; i++) {
                await this.client.deleteFile(backups[i].filename)
            }
        } catch (err) {
            console.error('Failed to clean old backups:', err)
        }
    }

    async getBackupList(): Promise<Array<{ filename: string; basename: string; size?: number; time: number; timeStr: string }>> {
        if (!this.client) await this.initClient()
        if (!this.client) return []

        try {
            const items = await this.client.getDirectoryContents(`${this.backupPath}/`)
            const backups = items
                .filter((item: any) => item.basename && item.basename.startsWith('lx-sync-backup-'))
                .sort((a: any, b: any) => this.parseBackupTime(b) - this.parseBackupTime(a))

            return backups.map((item: any) => {
                const time = this.parseBackupTime(item)
                let timeStr = ''
                if (time > 0) {
                    const d = new Date(time)
                    timeStr = d.toLocaleString('zh-CN', { hour12: false })
                } else {
                    timeStr = item.lastmod || '未知时间'
                }
                return {
                    filename: item.filename,
                    basename: item.basename,
                    size: item.size,
                    time,
                    timeStr,
                }
            })
        } catch (err: any) {
            console.error('[WebDAV] Failed to get backup list:', err.message)
            return []
        }
    }

    async deleteBackupFile(targetFilename: string): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const remotePath = targetFilename.startsWith('/') ? targetFilename : `${this.backupPath}/${targetFilename}`
            await this.client.deleteFile(remotePath)
            const basename = path.basename(remotePath)
            this.addLog({
                timestamp: Date.now(),
                type: 'backup',
                file: basename,
                status: 'success',
                message: `已删除云端备份: ${basename}`
            })
            return true
        } catch (err: any) {
            console.error(`[WebDAV] Failed to delete backup ${targetFilename}:`, err.message)
            this.addLog({
                timestamp: Date.now(),
                type: 'backup',
                file: targetFilename,
                status: 'error',
                message: `删除备份失败: ${err.message}`
            })
            return false
        }
    }

    async restoreBackupFile(targetFilename?: string): Promise<boolean> {
        if (this.restoring || this.syncing) throw new Error('WebDAV 正在备份或恢复，请稍后重试')
        this.restoring = true
        if (!this.client) await this.initClient()
        if (!this.client) { this.restoring = false; return false }

        let releaseRestore: (() => void) | undefined
        try {
            releaseRestore = beginCloudRestore()
            this.emit('progress', { type: 'restore', status: 'start', message: '正在检索备份数据...' })

            let targetItem: any = null
            if (targetFilename) {
                // 用户指定了恢复的文件名或路径
                const basename = path.basename(targetFilename)
                targetItem = {
                    filename: targetFilename.startsWith('/') ? targetFilename : `${this.backupPath}/${targetFilename}`,
                    basename
                }
            } else {
                const items = await this.client.getDirectoryContents(`${this.backupPath}/`)
                const backups = items
                    .filter((item: any) => item.basename.startsWith('lx-sync-backup-'))
                    .sort((a: any, b: any) => this.parseBackupTime(b) - this.parseBackupTime(a))

                if (backups.length === 0) {
                    this.emit('progress', { type: 'restore', status: 'error', message: '云端未找到任何全量备份文件' })
                    return false
                }
                targetItem = backups[0]
            }

            this.emit('progress', {
                type: 'restore',
                status: 'downloading',
                message: `正在下载备份: ${targetItem.basename}`
            })

            const content = await this.client.getFileContents(targetItem.filename)
            const zipPath = path.join(this.dataPath, 'temp-restore.zip')

            fs.writeFileSync(zipPath, content as any)

            this.emit('progress', {
                type: 'restore',
                status: 'extracting',
                message: '正在解压备份文件...'
            })

            const restored = await this.extractZip(zipPath, this.dataPath)
            if (!restored) throw new Error('ZIP 中没有当前所选类型的文件')
            fs.unlinkSync(zipPath)

            this.emit('progress', { type: 'restore', status: 'finish', message: '全量备份已成功恢复并还原！' })

            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: targetItem.basename,
                status: 'success',
            })

            return true
        } catch (err: any) {
            this.emit('progress', { type: 'restore', status: 'error', message: `备份恢复失败: ${err.message}` })
            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: targetFilename || 'backup',
                status: 'error',
                message: err.message,
            })
            return false
        } finally {
            this.restoring = false
            releaseRestore?.()
            fs.rmSync(path.join(this.dataPath, 'temp-restore.zip'), { force: true })
        }
    }

    async downloadLatestBackup(): Promise<boolean> {
        return this.restoreBackupFile()
    }

    async restoreScatteredFiles(): Promise<boolean> {
        if (this.restoring || this.syncing) throw new Error('WebDAV 正在备份或恢复，请稍后重试')
        this.restoring = true
        let releaseRestore: (() => void) | undefined
        try {
            releaseRestore = beginCloudRestore()
            if (!this.client) await this.initClient()
            if (!this.client) return false
            const items = await this.client.getDirectoryContents(this.syncPath + '/', { deep: true })
            const files = items.filter((item: any) => item.type === 'file').map((file: any) => ({ file, relative: this.getRelativeRemotePath(file.filename) })).filter((item: any) => !this.shouldIgnore(item.relative))
            if (!files.length) return false
            let count = 0
            for (const { file, relative } of files) {
                if (!await this.downloadFile(relative, file.filename)) throw new Error('恢复失败：' + relative)
                this.filesHash.set(relative, this.getFileHash(this.localPath(relative)))
                this.emit('progress', { type: 'restore', status: 'processing', current: ++count, total: files.length, file: relative })
            }
            this.emit('progress', { type: 'restore', status: 'finish', total: files.length, message: '已恢复所选类型；未删除本地其他文件，也未上传文件。重启服务后完整加载恢复的数据。' })
            return true
        } catch (err: any) {
            this.emit('progress', { type: 'restore', status: 'error', message: err.message })
            return false
        } finally { this.restoring = false; releaseRestore?.() }
    }

    public async restoreLocalBackup(zipPath: string): Promise<number> {
        if (this.restoring || this.syncing) throw new Error('WebDAV 正在备份或恢复，请稍后重试')
        const releaseRestore = beginCloudRestore()
        this.restoring = true
        try {
            const count = await this.extractZip(zipPath, this.dataPath)
            if (!count) throw new Error('ZIP 中没有当前所选类型的文件')
            return count
        } finally { this.restoring = false; releaseRestore() }
    }

    public async extractZip(zipPath: string, _targetPath: string): Promise<number> {
        const archive = await Open.file(zipPath)
        // 解压前检查全部条目，拒绝越界路径和符号链接。
        const selected = archive.files.filter(entry => entry.type === 'File' && !this.shouldIgnore(entry.path))
        const targets = selected.map(entry => {
            const mode = ((entry as any).externalFileAttributes >>> 16) & 0xf000
            if (mode === 0xa000) throw new Error('备份中不允许符号链接')
            return { entry, target: this.localPath(entry.path) }
        })
        for (const { entry, target } of targets) {
            fs.mkdirSync(path.dirname(target), { recursive: true })
            const temporary = target + '.' + crypto.randomUUID() + '.tmp'
            try {
                await pipeline(entry.stream(), fs.createWriteStream(temporary))
                if (fs.statSync(temporary).size !== entry.uncompressedSize) throw new Error('备份解压文件大小不一致：' + entry.path)
                fs.renameSync(temporary, target)
            } finally { fs.rmSync(temporary, { force: true }) }
        }
        return targets.length
    }

    async syncChangedFiles(): Promise<void> {
        if (this.syncing || this.restoring || isCloudRestoreRunning()) return
        this.syncing = true
        try {
            const { changed, deleted } = await this.getChangedFiles()
            await this.runConcurrent(changed, 5, async file => {
                const hash = this.getFileHash(this.localPath(file))
                if (await this.uploadFile(file)) this.filesHash.set(file, hash)
            })
            for (const file of deleted) {
                if (this.shouldIgnore(file)) { this.filesHash.delete(file); continue }
                if (!this.config.mirrorDeletes || await this.deleteRemoteFile(file)) this.filesHash.delete(file)
            }
        } finally { this.syncing = false }
    }

    async restoreFromRemote(options?: { mode?: 'auto' | 'zip' | 'files'; targetFilename?: string }): Promise<boolean> {
        const mode = options?.mode || 'auto'
        if (mode === 'zip') return this.restoreBackupFile(options?.targetFilename)
        if (mode === 'files') return this.restoreScatteredFiles()
        // 自动恢复只在散文件目录确实不存在/为空时使用 ZIP；权限和网络错误不能触发另一份旧备份覆盖。
        if (!this.client) await this.initClient()
        if (!this.client) return false
        try {
            const items = await this.client.getDirectoryContents(this.syncPath + '/', { deep: true })
            if (items.some((item: any) => item.type === 'file' && !this.shouldIgnore(this.getRelativeRemotePath(item.filename)))) return this.restoreScatteredFiles()
        } catch (err: any) {
            if ((err.status || err.response?.status) !== 404) return false
        }
        return this.restoreBackupFile(options?.targetFilename)
    }

    async testConnection(): Promise<{ success: boolean; message: string }> {
        // 检查配置是否完整
        if (!this.config.enable) {
            return {
                success: false,
                message: '请先在系统配置中启用 WebDAV 同步服务'
            };
        }
        if (!this.config.url || this.config.url.trim() === '') {
            return {
                success: false,
                message: '请先在系统配置中填写 WebDAV 服务器地址 (URL)'
            };
        }

        try {
            const initialized = await this.initClient();
            if (!initialized || !this.client) {
                return { success: false, message: 'WebDAV客户端初始化失败，请检查配置是否正确' };
            }

            // 增加 10 秒超时控制，避免请求无限挂起
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('连接超时，请检查 WebDAV 地址及网络连接')), 10000)
            )

            await Promise.race([
                this.client.getDirectoryContents('/'),
                timeoutPromise
            ])

            return { success: true, message: '连接成功！WebDAV配置正确' };
        } catch (err: any) {
            let errorMsg = '连接失败';
            if (err.message) {
                if (err.message.includes('401')) {
                    errorMsg = '认证失败，请检查用户名和密码';
                } else if (err.message.includes('404')) {
                    errorMsg = 'WebDAV路径不存在，请检查URL';
                } else if (err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
                    errorMsg = '无法连接到服务器，请检查URL和网络';
                } else {
                    errorMsg = err.message;
                }
            }
            return { success: false, message: errorMsg };
        }
    }

    startAutoSync() {
        if (!this.isConfigured()) return

        // 避免重复启动定时器
        this.stopAutoSync()

        console.log('Starting auto file change detection...')

        // 保留成功上传的基线；首次检查需要上传尚未备份的本地文件。

        // 按配置的时间间隔检查增量文件变化
        this.watchTimer = setInterval(() => {
            void this.syncChangedFiles()
        }, this.syncInterval)

        // 每24小时创建备份（如果有变化）
        this.backupTimer = setInterval(() => {
            void this.uploadBackup()
        }, this.backupInterval)
    }

    stopAutoSync() {
        if (this.watchTimer) {
            clearInterval(this.watchTimer)
            this.watchTimer = null
        }
        if (this.backupTimer) {
            clearInterval(this.backupTimer)
            this.backupTimer = null
        }
        console.log('Auto sync stopped')
    }

    updateConfig(config: Partial<WebDAVConfig>) {
        let changed = false
        if (config.types !== undefined && JSON.stringify(config.types) !== JSON.stringify(this.config.types)) {
            this.config.types = normalizeBackupTypes(config.types)
            changed = true
        }
        if (config.mirrorDeletes !== undefined) this.config.mirrorDeletes = config.mirrorDeletes
        if (config.enable !== undefined && config.enable !== this.config.enable) {
            this.config.enable = config.enable
            changed = true
        }
        if (config.url !== undefined && config.url !== this.config.url) {
            this.config.url = config.url
            changed = true
        }
        if (config.username !== undefined && config.username !== this.config.username) {
            this.config.username = config.username
            changed = true
        }
        if (config.password !== undefined && config.password !== this.config.password) {
            this.config.password = config.password
            changed = true
        }
        if (config.syncPath !== undefined) {
            const newSyncPath = normalizeRemotePath(config.syncPath, '/lx-sync')
            if (newSyncPath !== this.syncPath) {
                this.syncPath = newSyncPath
                this.config.syncPath = newSyncPath
                changed = true
            }
        }
        if (config.backupPath !== undefined) {
            const newBackupPath = normalizeRemotePath(config.backupPath, '/lx-sync-backups')
            if (newBackupPath !== this.backupPath) {
                this.backupPath = newBackupPath
                this.config.backupPath = newBackupPath
                changed = true
            }
        }
        if (config.interval !== undefined && (config.interval * 60 * 1000) !== this.syncInterval) {
            this.syncInterval = config.interval * 60 * 1000
            changed = true
        }
        if (config.backupInterval !== undefined && (config.backupInterval * 60 * 60 * 1000) !== this.backupInterval) {
            this.backupInterval = config.backupInterval * 60 * 60 * 1000
            changed = true
        }
        if (config.excludeCache !== undefined && config.excludeCache !== this.excludeCache) {
            this.excludeCache = config.excludeCache
            changed = true
        }
        if (config.excludeMusic !== undefined && config.excludeMusic !== this.excludeMusic) {
            this.excludeMusic = config.excludeMusic
            changed = true
        }

        if (changed) {
            this.filesHash.clear()
            this.backupHash.clear()
            this.client = null
            this.ensuredDirs.clear()
            this.stopAutoSync()
            if (this.isConfigured()) {
                void this.initClient(true).then(() => {
                    this.startAutoSync()
                })
            }
        }
    }
}

export default WebDAVSync
