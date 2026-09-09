import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { ZipArchive } from 'archiver'
import { Extract } from 'unzipper'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

interface WebDAVConfig {
    enable?: boolean
    url: string
    username: string
    password: string
    syncPath?: string
    backupPath?: string
    interval?: number
    backupInterval?: number
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
    private watchTimer: NodeJS.Timeout | null = null
    private backupTimer: NodeJS.Timeout | null = null
    private filesHash: Map<string, string> = new Map()
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
        }
        this.syncInterval = (config.interval || 60) * 60 * 1000
        this.backupInterval = (config.backupInterval || 24) * 60 * 60 * 1000
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

    private shouldIgnore(relativePath: string): boolean {
        const norm = relativePath.replace(/\\/g, '/').toLowerCase()
        const basename = path.basename(norm)

        // 忽略临时文件、日志、锁文件、操作系统隐匿文件
        if (basename.startsWith('.') || basename.startsWith('temp-')) return true
        if (basename.endsWith('.log') || basename.endsWith('.lock') || basename.endsWith('.tmp')) return true
        if (norm.startsWith('temp-') || norm.includes('/temp-')) return true

        // 忽略全量备份 zip（避免散文件同步备份 zip 造成循环与网络巨量浪费）
        if (basename.startsWith('lx-sync-backup-') && basename.endsWith('.zip')) return true

        // 忽略海量临时缓存目录 (subsonic 歌曲流缓存、在线搜索临时缓存、封面临时缓存等)
        if (norm === 'cache' || norm.startsWith('cache/')) return true
        if (norm === 'tmp' || norm.startsWith('tmp/')) return true
        if (norm === 'logs' || norm.startsWith('logs/')) return true

        return false
    }

    private async scanFiles(): Promise<Map<string, string>> {
        const files = new Map<string, string>()
        const scanDir = (dir: string) => {
            if (!fs.existsSync(dir)) return
            let items: string[] = []
            try {
                items = fs.readdirSync(dir)
            } catch (err) {
                console.warn(`[WebDAV] Unable to read directory ${dir}:`, err)
                return
            }

            for (const item of items) {
                const fullPath = path.join(dir, item)
                let stat: fs.Stats
                try {
                    stat = fs.statSync(fullPath)
                } catch {
                    continue
                }

                const relativePath = path.relative(this.dataPath, fullPath)
                if (this.shouldIgnore(relativePath)) {
                    continue
                }

                if (stat.isDirectory()) {
                    scanDir(fullPath)
                } else {
                    files.set(relativePath, this.getFileHash(fullPath))
                }
            }
        }
        scanDir(this.dataPath)
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

        this.filesHash = currentFiles
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
        return normRemote.replace(/^\/+/, '').replace(/\\/g, '/')
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
        if (!this.client) await this.initClient()
        if (!this.client) return false

        const localPath = path.join(this.dataPath, relativePath)
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
        if (!this.client) await this.initClient()
        if (!this.client) return false

        const defaultRemotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`
        const primaryRemotePath = rawRemotePath || defaultRemotePath
        const localPath = path.join(this.dataPath, relativePath)

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

                fs.writeFileSync(localPath, content)

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
                archive.glob('**/*', {
                    cwd: this.dataPath,
                    ignore: [
                        'temp-*.zip',
                        '*.log',
                        '*.lock',
                        '*.tmp',
                        'lx-sync-backup-*.zip',
                        'cache/**',
                        'tmp/**',
                        'logs/**'
                    ],
                })

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
        if (!this.client) await this.initClient()
        if (!this.client) return false

        let zipPath: string | null = null
        try {
            // 检查是否有文件变化
            if (!force) {
                const { changed, deleted } = await this.getChangedFiles()
                if (changed.length === 0 && deleted.length === 0) {
                    console.log('No changes detected, skipping backup')
                    return true
                }
            }

            this.emit('progress', { type: 'backup', status: 'preparing', message: '正在创建备份...' })

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
        if (!this.client) await this.initClient()
        if (!this.client) {
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
                if (ok) successCount++
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
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
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

            await this.extractZip(zipPath, this.dataPath)
            fs.unlinkSync(zipPath)

            // 检查解压后数据目录是否确实有了 config.js
            const targetConfigPath = global.lx?.configPath || path.join(this.dataPath, 'config.js')
            if (!fs.existsSync(targetConfigPath)) {
                console.log('Backup restored but config.js is missing in data dir, saving current config and uploading...')
                if (global.lx && global.lx.saveConfig) {
                    global.lx.saveConfig()
                }
                await this.uploadFile('config.js')
            }

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
        }
    }

    async downloadLatestBackup(): Promise<boolean> {
        return this.restoreBackupFile()
    }

    async restoreScatteredFiles(): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const items = await this.client.getDirectoryContents(`${this.syncPath}/`, { deep: true })
            const files = items.filter((item: any) => item.type === 'file')

            if (files.length === 0) {
                this.emit('progress', { type: 'restore', status: 'error', message: `云端散文件目录 (${this.syncPath}) 为空` })
                return false
            }

            console.log(`Restoring ${files.length} scattered files from WebDAV (${this.syncPath})...`)
            let current = 0
            let hasConfig = false

            this.emit('progress', { type: 'restore', status: 'start', total: files.length, message: '开始比对并增量恢复散文件...' })

            const remoteFileSet = new Set<string>()
            const localFiles = await this.scanFiles()
            const filesToDownload: { file: any; relativePath: string }[] = []

            for (const file of files) {
                const relativePath = this.getRelativeRemotePath(file.filename)
                if (this.shouldIgnore(relativePath)) {
                    continue
                }

                if (relativePath === 'config.js') hasConfig = true
                remoteFileSet.add(relativePath)

                // 如果本地存在该文件，且大小一致，跳过不必要下载
                const localPath = path.join(this.dataPath, relativePath)
                if (fs.existsSync(localPath)) {
                    const localStat = fs.statSync(localPath)
                    const remoteSize = file.size !== undefined ? Number(file.size) : NaN
                    if (!isNaN(remoteSize) && localStat.size === remoteSize) {
                        continue
                    }
                }
                filesToDownload.push({ file, relativePath })
            }

            if (filesToDownload.length === 0) {
                console.log(`All remote files are up to date locally, skipping restore download.`)
            } else {
                console.log(`Downloading ${filesToDownload.length} updated/new files from WebDAV (${this.syncPath})...`)
                const total = filesToDownload.length
                for (const item of filesToDownload) {
                    current++
                    this.emit('progress', {
                        type: 'restore',
                        status: 'processing',
                        current,
                        total,
                        file: item.relativePath,
                        message: `正在恢复散文件 (${current}/${total})`
                    })
                    await this.downloadFile(item.relativePath, item.file.filename)
                }
            }

            // 如果恢复的文件中没有 config.js，说明云端配置缺失，将当前内存配置（含环境变量）同步上去
            if (!hasConfig) {
                console.log('Cloud config.js not found, saving current memory config and uploading...')
                if (global.lx && global.lx.saveConfig) {
                    global.lx.saveConfig()
                }
                await this.uploadFile('config.js')
            }

            // 双向数据一致性补齐：检查本地是否存在但云端缺失的文件，自动补传至云端
            const missingOnRemote: string[] = []
            for (const relativePath of localFiles.keys()) {
                const normLocal = relativePath.replace(/\\/g, '/')
                if (!remoteFileSet.has(normLocal) && !this.shouldIgnore(normLocal)) {
                    missingOnRemote.push(normLocal)
                }
            }
            if (missingOnRemote.length > 0) {
                console.log(`[WebDAV] Found ${missingOnRemote.length} local files missing on cloud, uploading missing files...`)
                let uploadedCount = 0
                const uploadTotal = missingOnRemote.length
                for (const file of missingOnRemote) {
                    uploadedCount++
                    this.emit('progress', {
                        type: 'restore',
                        status: 'processing',
                        current: uploadedCount,
                        total: uploadTotal,
                        file,
                        message: `正在向云端补齐缺失文件 (${uploadedCount}/${uploadTotal})`
                    })
                    await this.uploadFile(file)
                }
            }

            this.emit('progress', { type: 'restore', status: 'finish', total: files.length, message: '散文件增量恢复完成' })
            return true
        } catch (err: any) {
            console.error(`[WebDAV] Restore scattered files failed:`, err.message)
            this.emit('progress', { type: 'restore', status: 'error', message: `恢复散文件失败: ${err.message}` })
            return false
        }
    }

    public async extractZip(zipPath: string, targetPath: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            fs.createReadStream(zipPath)
                .pipe(Extract({ path: targetPath }))
                .on('close', () => resolve())
                .on('error', (err) => reject(err))
        })
    }

    async syncChangedFiles() {
        const { changed, deleted } = await this.getChangedFiles()
        if (changed.length === 0 && deleted.length === 0) return

        if (changed.length > 0) {
            console.log(`Syncing ${changed.length} changed files to WebDAV...`)
            let failCount = 0
            await this.runConcurrent(changed, 5, async (file) => {
                const ok = await this.uploadFile(file)
                if (!ok) failCount++
            })
            if (failCount > 0) {
                console.error(`[WebDAV] Sync changed files completed with ${failCount} errors out of ${changed.length} files.`)
            }
        }

        if (deleted.length > 0) {
            console.log(`Deleting ${deleted.length} remote files...`)
            for (const file of deleted) {
                await this.deleteRemoteFile(file)
            }
        }
    }

    async restoreFromRemote(options?: { mode?: 'auto' | 'zip' | 'files'; targetFilename?: string }): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        const mode = options?.mode || 'auto'

        if (mode === 'zip') {
            return this.restoreBackupFile(options?.targetFilename)
        }

        if (mode === 'files') {
            return this.restoreScatteredFiles()
        }

        // 1. 尝试恢复散文件
        try {
            const items = await this.client.getDirectoryContents(`${this.syncPath}/`, { deep: true })
            const files = items.filter((item: any) => item.type === 'file')

            if (files.length > 0) {
                console.log(`Restoring ${files.length} files from WebDAV (${this.syncPath})...`)
                const total = files.length
                let current = 0
                let hasConfig = false

                this.emit('progress', { type: 'restore', status: 'start', total, message: '开始从云端恢复数据...' })

                const remoteFileSet = new Set<string>()
                const localFiles = await this.scanFiles()
                const filesToDownload: { file: any; relativePath: string }[] = []

                for (const file of files) {
                    const relativePath = this.getRelativeRemotePath(file.filename)
                    if (this.shouldIgnore(relativePath)) {
                        continue
                    }

                    if (relativePath === 'config.js') hasConfig = true
                    remoteFileSet.add(relativePath)

                    // 如果本地存在该文件，且大小一致，跳过不必要下载
                    const localPath = path.join(this.dataPath, relativePath)
                    if (fs.existsSync(localPath)) {
                        const localStat = fs.statSync(localPath)
                        const remoteSize = file.size !== undefined ? Number(file.size) : NaN
                        if (!isNaN(remoteSize) && localStat.size === remoteSize) {
                            continue
                        }
                    }
                    filesToDownload.push({ file, relativePath })
                }

                if (filesToDownload.length === 0) {
                    console.log(`All ${files.length} remote files are up to date locally, skipping restore download.`)
                } else {
                    console.log(`Downloading ${filesToDownload.length} updated/new files from WebDAV (${this.syncPath})...`)
                    const downloadTotal = filesToDownload.length
                    for (const item of filesToDownload) {
                        current++
                        this.emit('progress', {
                            type: 'restore',
                            status: 'processing',
                            current,
                            total: downloadTotal,
                            file: item.relativePath,
                            message: `正在恢复文件 (${current}/${downloadTotal})`
                        })
                        await this.downloadFile(item.relativePath, item.file.filename)
                    }
                }

                // 如果恢复的文件中没有 config.js，说明云端配置缺失，将当前内存配置（含环境变量）同步上去
                if (!hasConfig) {
                    console.log('Cloud config.js not found, saving current memory config and uploading...')
                    if (global.lx && global.lx.saveConfig) {
                        global.lx.saveConfig()
                    }
                    await this.uploadFile('config.js')
                }

                // 双向数据一致性补齐：检查本地是否存在但云端缺失的文件，自动补传至云端
                const missingOnRemote: string[] = []
                for (const relativePath of localFiles.keys()) {
                    const normLocal = relativePath.replace(/\\/g, '/')
                    if (!remoteFileSet.has(normLocal) && !this.shouldIgnore(normLocal)) {
                        missingOnRemote.push(normLocal)
                    }
                }
                if (missingOnRemote.length > 0) {
                    console.log(`[WebDAV] Found ${missingOnRemote.length} local files missing on cloud, uploading missing files...`)
                    let uploadedCount = 0
                    const uploadTotal = missingOnRemote.length
                    for (const file of missingOnRemote) {
                        uploadedCount++
                        this.emit('progress', {
                            type: 'restore',
                            status: 'processing',
                            current: uploadedCount,
                            total: uploadTotal,
                            file,
                            message: `正在向云端补齐缺失文件 (${uploadedCount}/${uploadTotal})`
                        })
                        await this.uploadFile(file)
                    }
                }

                this.emit('progress', { type: 'restore', status: 'finish', total, message: '数据恢复完成' })
                return true
            }
        } catch (err: any) {
            // 忽略远程同步目录不存在的错误，继续尝试恢复备份
            console.log(`Scattered files not found at ${this.syncPath} or error, trying backup...`, err.message)
        }

        // 2. 尝试恢复备份
        try {
            console.log('Downloading latest backup...')
            this.emit('progress', { type: 'restore', status: 'start', message: '正在从云端下载备份...' })
            const result = await this.downloadLatestBackup()
            if (result) {
                // 检查解压后数据目录是否确实有了 config.js
                const targetConfigPath = global.lx?.configPath || path.join(this.dataPath, 'config.js')
                if (!fs.existsSync(targetConfigPath)) {
                    console.log('Backup restored but config.js is missing in data dir, saving current config and uploading...')
                    if (global.lx && global.lx.saveConfig) {
                        global.lx.saveConfig()
                    }
                    await this.uploadFile('config.js')
                }
                this.emit('progress', { type: 'restore', status: 'finish', message: '备份恢复完成' })
                return true
            } else {
                // 如果未找到散文件也未找到备份，说明是第一次配置或云端为空
                // 主动全量上传本地所有文件到云端进行初始化（后台异步执行，不阻塞启动）
                console.log(`Cloud is empty, saving current config and uploading all files to initialize ${this.syncPath}...`)
                this.emit('progress', { type: 'restore', status: 'processing', message: '云端为空，正在后台同步本地全部数据到云端...' })

                // 保存当前内存中的配置（包含环境变量生效后的结果）到磁盘
                if (global.lx && global.lx.saveConfig) {
                    global.lx.saveConfig()
                }

                void this.syncAllFiles().then((res) => {
                    if (res) {
                        this.emit('progress', { type: 'restore', status: 'finish', message: '云端配置与全部数据初始化完成' })
                    }
                })
                return false
            }
        } catch (err: any) {
            console.error('Failed to restore from remote:', err)
            this.emit('progress', { type: 'restore', status: 'error', message: '恢复失败: ' + err.message })
            return false
        }
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

        // 初始化文件哈希
        void this.scanFiles().then(files => {
            this.filesHash = files
        })

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

        if (changed) {
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
