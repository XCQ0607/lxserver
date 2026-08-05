import fs from 'fs'
import path from 'path'
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

// [Fix] 内网地址修复：无协议时默认补 http://（内网 WebDAV 多为 HTTP 服务），
// 避免 webdav 库内部 url-parse 无法解析无协议地址导致请求失败
const normalizeWebdavUrl = (url?: string): string => {
    const trimmed = (url || '').trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return 'http://' + trimmed
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
    private static REQUEST_TIMEOUT = 30000 // 单次远程请求超时（毫秒），防止 dav 服务无响应导致进程挂起
    private static LIST_DEPTH_LIMIT = 4 // 分层列举最大深度，避免单次 Depth:infinity 全树拉取触发 OOM

    private withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, label: string, ms: number = WebDAVSync.REQUEST_TIMEOUT): Promise<T> {
        const controller = new AbortController()
        const abortPromise = new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error(`WebDAV ${label} timed out after ${ms}ms`)), { once: true })
        })
        const timer = setTimeout(() => controller.abort(), ms)
        return Promise.race([run(controller.signal), abortPromise]).finally(() => {
            clearTimeout(timer)
            controller.abort()
        })
    }

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
                const options: any = {}
                if (this.config.username) options.username = this.config.username
                if (this.config.password) options.password = this.config.password
                this.client = createClient(normalizeWebdavUrl(this.config.url), options)
                console.log('WebDAV client initialized')
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

    private async scanFiles(): Promise<Map<string, string>> {
        const files = new Map<string, string>()
        const scanDir = (dir: string) => {
            const items = fs.readdirSync(dir)
            for (const item of items) {
                const fullPath = path.join(dir, item)
                const stat = fs.statSync(fullPath)
                if (stat.isDirectory()) {
                    scanDir(fullPath)
                } else {
                    const relativePath = path.relative(this.dataPath, fullPath)
                    if (!relativePath.includes('temp-') && !relativePath.endsWith('.log')) {
                        files.set(relativePath, this.getFileHash(fullPath))
                    }
                }
            }
        }
        scanDir(this.dataPath)

        // [新增] 扫描根目录下的 config.js
        const rootConfigPath = path.join(process.cwd(), 'config.js')
        if (fs.existsSync(rootConfigPath)) {
            files.set('config.js', this.getFileHash(rootConfigPath))
        }

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
        const prefix = this.syncPath.endsWith('/') ? this.syncPath : this.syncPath + '/'
        if (remoteFilename.startsWith(prefix)) {
            return remoteFilename.slice(prefix.length)
        }
        if (remoteFilename.startsWith(this.syncPath)) {
            return remoteFilename.slice(this.syncPath.length).replace(/^\/+/, '')
        }
        return remoteFilename.replace(/^\/+/, '')
    }

    // 分层列举远程目录（不使用 Depth:infinity），避免 dav 服务一次返回整个目录树导致 OOM 或挂起
    private async listRemoteFiles(remoteDir: string, depth = 0): Promise<any[]> {
        if (depth > WebDAVSync.LIST_DEPTH_LIMIT) return []
        let items: any[] = []
        try {
            items = await this.withTimeout(
                (signal) => this.client.getDirectoryContents(remoteDir, { deep: false, signal }),
                `list ${remoteDir}`
            )
        } catch (err: any) {
            // 目录不存在或单层列举失败时返回空，交由调用方按降级逻辑处理
            console.log(`[WebDAV] List ${remoteDir} failed: ${err.message}`)
            return []
        }
        const files: any[] = []
        for (const item of items) {
            if (item.type === 'file') {
                files.push(item)
            } else if (item.type === 'directory') {
                const subDir = item.filename.endsWith('/') ? item.filename : item.filename + '/'
                const subFiles = await this.listRemoteFiles(subDir, depth + 1)
                files.push(...subFiles)
            }
        }
        return files
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

        try {
            const isRootConfig = relativePath === 'config.js'
            const localPath = isRootConfig ? path.join(process.cwd(), 'config.js') : path.join(this.dataPath, relativePath)
            if (!fs.existsSync(localPath)) return false

            const stat = fs.statSync(localPath)
            const remotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`

            // 缓存已创建过的远程目录，避免每个文件重复发送 createDirectory 请求
            const remoteDir = path.dirname(remotePath)
            if (!this.ensuredDirs.has(remoteDir)) {
                await this.client.createDirectory(remoteDir, { recursive: true })
                this.ensuredDirs.add(remoteDir)
            }

            // 使用流式上传并监控进度
            const readStream = fs.createReadStream(localPath)
            const passThrough = new PassThrough()
            let uploadedBytes = 0

            passThrough.on('data', (chunk) => {
                uploadedBytes += chunk.length
                // 限制进度事件触发频率，例如每 1% 或每 100ms 触发一次，这里简单处理
                // 如果文件很小，可能瞬间完成
                this.emit('progress', {
                    type: 'file',
                    status: 'uploading',
                    file: relativePath,
                    current: uploadedBytes,
                    total: stat.size
                })
            })

            readStream.pipe(passThrough)

            await this.client.putFileContents(remotePath, passThrough)

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
            console.error(`[WebDAV] Failed to upload file ${relativePath}:`, err.message)
            this.emit('progress', {
                type: 'file',
                status: 'error',
                file: relativePath,
                error: err.message
            })
            this.addLog({
                timestamp: Date.now(),
                type: 'upload',
                file: relativePath,
                status: 'error',
                message: err.message,
            })
            return false
        }
    }

    async downloadFile(relativePath: string): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const remotePath = `${this.syncPath}/${relativePath.replace(/\\/g, '/')}`
            const isRootConfig = relativePath === 'config.js'
            const localPath = isRootConfig ? path.join(process.cwd(), 'config.js') : path.join(this.dataPath, relativePath)

            // 确保本地目录存在
            const localDir = path.dirname(localPath)
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true })
            }

            const content = await this.withTimeout<any>(
                (signal) => this.client.getFileContents(remotePath, { signal }) as any,
                `download ${remotePath}`
            )

            // 对比内容哈希，如果一致则跳过写入，避免触发文件系统监控
            if (fs.existsSync(localPath)) {
                const localContent = fs.readFileSync(localPath) as any
                const localHash = crypto.createHash('md5').update(localContent).digest('hex')
                const remoteHash = crypto.createHash('md5').update(content as any).digest('hex')

                if (localHash === remoteHash) {
                    // console.log(`File ${relativePath} is up to date, skipping write.`)
                    return true
                }
            }

            fs.writeFileSync(localPath, content)

            if (isRootConfig) {
                console.log('config.js restored from WebDAV, content changed.')
                // 这里可以发出事件提醒主进程，不过由于用户是手动触发恢复或启动时恢复，已经有重启逻辑覆盖
            }

            this.addLog({
                timestamp: Date.now(),
                type: 'download',
                file: relativePath,
                status: 'success',
            })
            return true
        } catch (err: any) {
            console.error(`[WebDAV] Failed to download file ${relativePath}:`, err.message)
            this.addLog({
                timestamp: Date.now(),
                type: 'download',
                file: relativePath,
                status: 'error',
                message: err.message,
            })
            return false
        }
    }

    async createBackup(): Promise<string | null> {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
            const zipName = `lx-sync-backup-${timestamp}.zip`
            const zipPath = path.join(this.dataPath, zipName)

            await new Promise<void>((resolve, reject) => {
                const output = fs.createWriteStream(zipPath)
                const archive = new ZipArchive({ zlib: { level: 9 } })

                let fileCount = 0

                // 监听文件添加事件
                archive.on('entry', (entry: any) => {
                    fileCount++
                    this.emit('progress', {
                        type: 'backup',
                        status: 'packing',
                        message: `正在打包文件: ${entry.name}`,
                        current: fileCount
                    })
                })

                output.on('close', () => resolve())
                archive.on('error', (err: Error) => reject(err))

                archive.pipe(output)
                archive.glob('**/*', {
                    cwd: this.dataPath,
                    ignore: ['temp-*.zip', '*.log', 'lx-sync-backup-*.zip'],
                })

                // [新增] 将根目录下的 config.js 也打包进去
                const rootConfigPath = path.join(process.cwd(), 'config.js')
                if (fs.existsSync(rootConfigPath)) {
                    archive.file(rootConfigPath, { name: 'config.js' })
                }

                archive.finalize()
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

            const zipPath = path.join(this.dataPath, zipName)
            const stat = fs.statSync(zipPath)
            const remotePath = `${this.backupPath}/${zipName}`

            // 使用流式上传并监控进度
            const readStream = fs.createReadStream(zipPath)
            const passThrough = new PassThrough()
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

            readStream.pipe(passThrough)

            try {
                await this.client.putFileContents(remotePath, passThrough)

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
            } finally {
                // 确保无论上传成功还是失败，总是及时清理本地临时 zip 文件
                if (fs.existsSync(zipPath)) {
                    try {
                        fs.unlinkSync(zipPath)
                    } catch (e) {
                        console.error('Failed to cleanup local backup zip:', e)
                    }
                }
            }

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
        }
    }

    async syncAllFiles(): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            const files = await this.scanFiles()
            const fileList = Array.from(files.keys())
            let count = 0
            const total = fileList.length

            this.emit('progress', { type: 'sync', status: 'start', total })

            let successCount = 0
            let failCount = 0

            // 使用受控并发（最多 5 个并发连接）加速批量文件上传
            await this.runConcurrent(fileList, 5, async (file) => {
                count++
                this.emit('progress', {
                    type: 'sync',
                    status: 'processing',
                    current: count,
                    total,
                    file
                })
                const ok = await this.uploadFile(file)
                if (ok) successCount++
                else failCount++
            })

            this.emit('progress', { type: 'sync', status: 'finish', total })
            if (failCount > 0) {
                console.warn(`[WebDAV] Sync all files finished with errors: ${successCount} succeeded, ${failCount} failed.`)
            } else {
                console.log(`[WebDAV] Sync all files finished successfully (${successCount} files).`)
            }
            return failCount === 0
        } catch (err) {
            console.error('Sync all files failed:', err)
            return false
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
            const items = await this.withTimeout<any[]>(
                (signal) => this.client.getDirectoryContents(`${this.backupPath}/`, { signal }),
                `list ${this.backupPath}`
            )
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

    async downloadLatestBackup(): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            this.emit('progress', { type: 'restore', status: 'start', message: '正在获取备份列表...' })

            const items = await this.withTimeout<any[]>(
                (signal) => this.client.getDirectoryContents(`${this.backupPath}/`, { signal }),
                `list ${this.backupPath}`
            )
            const backups = items
                .filter((item: any) => item.basename.startsWith('lx-sync-backup-'))
                .sort((a: any, b: any) => this.parseBackupTime(b) - this.parseBackupTime(a))

            if (backups.length === 0) return false

            const latestBackup = backups[0]

            this.emit('progress', {
                type: 'restore',
                status: 'downloading',
                message: `正在下载备份: ${latestBackup.basename}`
            })

            const content = await this.withTimeout<any>(
                (signal) => this.client.getFileContents(latestBackup.filename, { signal }) as any,
                `download backup ${latestBackup.basename}`
            )
            const zipPath = path.join(this.dataPath, 'temp-restore.zip')

            // 修复类型错误：使用 as any
            fs.writeFileSync(zipPath, content as any)

            this.emit('progress', {
                type: 'restore',
                status: 'extracting',
                message: '正在解压备份文件...'
            })

            await this.extractZip(zipPath, this.dataPath)
            fs.unlinkSync(zipPath)

            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: latestBackup.basename,
                status: 'success',
            })

            return true
        } catch (err: any) {
            this.addLog({
                timestamp: Date.now(),
                type: 'restore',
                file: 'latest-backup',
                status: 'error',
                message: err.message,
            })
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

        const extractedConfig = path.join(targetPath, 'config.js')
        const rootConfig = path.join(process.cwd(), 'config.js')

        if (fs.existsSync(extractedConfig) && path.resolve(extractedConfig) !== path.resolve(rootConfig)) {
            console.log(`[Restore] Moving extracted config.js from ${extractedConfig} to ${rootConfig}`)
            try {
                fs.copyFileSync(extractedConfig, rootConfig)
                fs.unlinkSync(extractedConfig)
            } catch (err: any) {
                console.error('[Restore] Failed to move config.js to root:', err.message)
            }
        }
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

    async restoreFromRemote() {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        // 1. 尝试恢复散文件
        try {
            const items = await this.listRemoteFiles(`${this.syncPath}/`)
            const files = items.filter((item: any) => item.type === 'file')

            if (files.length > 0) {
                console.log(`Restoring ${files.length} files from WebDAV (${this.syncPath})...`)
                const total = files.length
                let current = 0
                let hasConfig = false

                this.emit('progress', { type: 'restore', status: 'start', total, message: '开始从云端恢复数据...' })

                const remoteFileSet = new Set<string>()

                for (const file of files) {
                    current++
                    const relativePath = this.getRelativeRemotePath(file.filename)
                    if (relativePath === 'config.js') hasConfig = true
                    remoteFileSet.add(relativePath)

                    this.emit('progress', {
                        type: 'restore',
                        status: 'processing',
                        current,
                        total,
                        file: relativePath,
                        message: `正在恢复文件 (${current}/${total})`
                    })

                    await this.downloadFile(relativePath)
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
                const localFiles = await this.scanFiles()
                const missingOnRemote: string[] = []
                for (const relativePath of localFiles.keys()) {
                    if (!remoteFileSet.has(relativePath)) {
                        missingOnRemote.push(relativePath)
                    }
                }
                if (missingOnRemote.length > 0) {
                    console.log(`[WebDAV] Found ${missingOnRemote.length} local files missing on cloud, uploading missing files...`)
                    for (const file of missingOnRemote) {
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
                // 检查解压后根目录是否确实有了 config.js
                const rootConfigPath = path.join(process.cwd(), 'config.js')
                if (!fs.existsSync(rootConfigPath)) {
                    console.log('Backup restored but config.js is missing, saving current config and uploading...')
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
