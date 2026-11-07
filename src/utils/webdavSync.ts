import { hashBackupFile, backupFileVersion } from './backupFiles'
import { downloadWebdavFile, uploadWebdavFile } from './webdavTransfer'
import { webdavStatePath, readWebdavState, saveWebdavState, webdavManifestName, parseWebdavManifest, type WebdavFileVersion } from './webdavState'
import { WebdavRecovery, checkedBackupPath, type WebdavRestoreOptions, type RecoveryContext } from './webdavRecovery'
import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { ZipArchive } from 'archiver'
import crypto from 'crypto'
import { EventEmitter } from 'events'
import { pipeline } from 'stream/promises'
import { backupType, backupLocalPath, getBackupTypes, normalizeBackupTypes, scanBackupFiles, beginCloudBackup, beginCloudRestore, isCloudRestoreRunning, type BackupType } from './backupPolicy'

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
    retentionCount?: number
    retentionDays?: number
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
    private nextSyncAt = 0
    private nextZipAt = 0
    private recovery = new WebdavRecovery()
    private remoteVersions: Record<string, WebdavFileVersion> = {}
    private stateFile = ''
    private publishedManifest = ''
    private lastArchiveSnapshot = new Map<string, string>()
    public lastRestoreResult: any = null
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
            retentionCount: Math.max(1, Math.min(1000, Math.floor(config.retentionCount || 5))),
            retentionDays: Math.max(0, Math.min(3650, Math.floor(config.retentionDays || 0))),
        }
        this.syncInterval = (config.interval || 60) * 60 * 1000
        this.backupInterval = (config.backupInterval || 24) * 60 * 60 * 1000
        this.excludeCache = config.excludeCache ?? false
        this.excludeMusic = config.excludeMusic ?? false
        this.dataPath = dataPath
        this.loadState()
    }

    getRuntimeStatus() {
        const scheduled = this.isConfigured() && !isCloudRestoreRunning()
        return { running: this.syncing, restoring: this.restoring,
            nextSyncAt: scheduled && this.watchTimer ? this.nextSyncAt : 0,
            nextZipAt: scheduled && this.backupTimer ? this.nextZipAt : 0,
            lastActivity: this.syncLogs[0] || null,
            lastError: this.syncLogs.find(log => log.status === 'error') || null }
    }

    get isBusy() { return this.syncing || this.restoring }

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

    private getFileHash(filePath: string): string { return hashBackupFile(filePath) }
    private identity(includeTypes = false) {
        return JSON.stringify([this.config.url, this.config.username, this.syncPath, this.backupPath, this.context().configPath, this.context().config?.['snapshot.backupPath'], includeTypes ? this.selectedTypes() : null])
    }
    private loadState() {
        this.stateFile = webdavStatePath(this.dataPath, this.identity())
        const state = readWebdavState(this.stateFile)
        this.filesHash = new Map(state.files); this.backupHash = new Map(state.zip); this.remoteVersions = state.remote
        this.publishedManifest = (state as any).manifest || ''
    }
    private saveState() { saveWebdavState(this.stateFile, { files: [...this.filesHash], zip: [...this.backupHash], remote: this.remoteVersions, manifest: this.publishedManifest }) }
    private async loadRemoteManifest() {
        if (this.publishedManifest) return
        const remote = this.syncPath + '/' + webdavManifestName
        let info: any
        try { info = await this.client.stat(remote, { signal: AbortSignal.timeout(30_000) }) }
        catch (error: any) { if (Number(error.status || error.response?.status) === 404) return; throw error }
        if (Number(info.size) > 16 * 1024 * 1024) throw new Error('WebDAV 云端清单过大')
        const dir = path.join(this.dataPath, 'runtime', 'webdav-manifests'); fs.mkdirSync(dir, { recursive: true })
        const temp = path.join(dir, crypto.randomUUID() + '.json')
        try {
            await downloadWebdavFile(this.client, remote, temp, Number(info.size), undefined, info.etag)
            const versions = parseWebdavManifest(JSON.parse(fs.readFileSync(temp, 'utf8')))
            this.remoteVersions = { ...versions, ...this.remoteVersions }
        } finally { fs.rmSync(temp, { force: true }) }
    }
    private async publishManifest() {
        const value = JSON.stringify({ schema: 1, files: this.remoteVersions })
        const hash = crypto.createHash('sha256').update(value).digest('hex')
        const remote = this.syncPath + '/' + webdavManifestName
        if (hash === this.publishedManifest) {
            try { await this.client.stat(remote, { signal: AbortSignal.timeout(30_000) }); return }
            catch (error: any) { if (Number(error.status || error.response?.status) !== 404) throw error }
        }
        if (Buffer.byteLength(value) > 16 * 1024 * 1024) throw new Error('WebDAV 备份清单超过大小限制')
        const dir = path.join(this.dataPath, 'runtime', 'webdav-manifests'); fs.mkdirSync(dir, { recursive: true })
        const temp = path.join(dir, crypto.randomUUID() + '.json')
        try {
            fs.writeFileSync(temp, value, { mode: 0o600 }); await this.ensureRemoteDir(this.syncPath)
            await uploadWebdavFile(this.client, temp, remote, fs.statSync(temp).size)
            this.publishedManifest = hash; this.saveState()
        } finally { fs.rmSync(temp, { force: true }) }
    }
    private recoveryContext(): RecoveryContext { return { ...this.context(), client: this.client, types: this.selectedTypes(), syncPath: this.syncPath, backupPath: this.backupPath, identity: this.identity(true) } }
    async previewRestore(options: WebdavRestoreOptions = {}) {
        if (this.syncing || this.restoring) throw new Error('WebDAV 正在备份或恢复')
        this.restoring = true
        try {
            if (!this.client) await this.initClient()
            if (!this.client) throw new Error('WebDAV 客户端未初始化')
            return await this.recovery.prepare(this.recoveryContext(), options)
        } finally { this.restoring = false }
    }
    discardRestorePreview(token: string) { this.recovery.discard(token) }
    async restorePlanned(token: string, startup = false): Promise<boolean> { return this.performRestore({}, undefined, token, startup) }
    private async performRestore(options: WebdavRestoreOptions = {}, localZip?: string, token?: string, startup = false): Promise<boolean> {
        if (this.restoring || this.syncing) throw new Error('WebDAV 正在备份或恢复，请稍后重试')
        this.restoring = true
        this.lastRestoreResult = undefined
        let release: (() => void) | undefined
        try {
            release = beginCloudRestore()
            if (global.lx.pauseForRestore) global.lx.pauseForRestore()
            if (global.lx.pauseForRestore || startup) global.lx.restoreMaintenance = true
            if (!localZip && !this.client) await this.initClient()
            if (!localZip && !this.client) throw new Error('WebDAV 客户端未初始化')
            const context = this.recoveryContext()
            if (!token) token = (await this.recovery.prepare(context, options, localZip)).token
            this.emit('progress', { type: 'restore', status: 'downloading', message: '正在暂存并校验所选文件，完成前不会覆盖本地数据' })
            const result = await this.recovery.execute(context, token)
            this.lastRestoreResult = result
            if (result.errors.length) throw new Error(result.errors.join('；'))
            this.filesHash.clear(); this.backupHash.clear(); this.publishedManifest = ''; this.saveState()
            this.emit('progress', { type: 'restore', status: 'finish', message: '恢复完成，已保留恢复前副本；请重启服务完整加载数据' })
            this.addLog({ timestamp: Date.now(), type: 'restore', file: options.targetFilename || 'selected data', status: 'success' })
            return true
        } catch (error: any) {
            this.lastRestoreResult = { ...(this.lastRestoreResult || {}), errors: [error.message] }
            this.emit('progress', { type: 'restore', status: 'error', message: error.message })
            this.addLog({ timestamp: Date.now(), type: 'restore', file: 'selected data', status: 'error', message: error.message })
            return false
        } finally { this.restoring = false; release?.() }
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
        if (isCloudRestoreRunning() || this.shouldIgnore(relativePath)) return false
        if (!this.client) await this.initClient()
        if (!this.client) return false
        const local = this.localPath(relativePath), remote = this.syncPath + '/' + relativePath.replace(/\\/g, '/')
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const version = backupFileVersion(local), hash = this.getFileHash(local), size = fs.statSync(local).size
                if (!await this.ensureRemoteDir(path.posix.dirname(remote))) throw new Error('创建 WebDAV 目录失败')
                await uploadWebdavFile(this.client, local, remote, size, current => this.emit('progress', { type: 'file', status: 'uploading', file: relativePath, current, total: size }), hash)
                if (backupFileVersion(local) !== version) throw new Error('上传期间本地文件发生变化，未记录成功基线')
                this.filesHash.set(relativePath, hash); this.remoteVersions[relativePath] = { size, hash }; this.saveState()
                this.addLog({ timestamp: Date.now(), type: 'upload', file: relativePath, status: 'success' })
                return true
            } catch (error: any) {
                if (attempt < 3) { this.ensuredDirs.delete(path.posix.dirname(remote)); await new Promise(resolve => setTimeout(resolve, attempt * 600)); continue }
                this.addLog({ timestamp: Date.now(), type: 'upload', file: relativePath, status: 'error', message: error.message })
            }
        }
        return false
    }

    async downloadFile(relativePath: string, rawRemotePath?: string): Promise<boolean> {
        if (this.shouldIgnore(relativePath)) return false
        try {
            if (!this.client) await this.initClient()
            if (!this.client) return false
            const remote = rawRemotePath || this.syncPath + '/' + relativePath
            if (this.getRelativeRemotePath(remote) !== relativePath) throw new Error('云端路径不匹配')
            const info = await this.client.stat(remote, { signal: AbortSignal.timeout(30_000) })
            const local = this.localPath(relativePath), baseline = backupFileVersion(local), temporary = local + '.' + crypto.randomUUID() + '.tmp'
            try {
                await downloadWebdavFile(this.client, remote, temporary, Number(info.size), undefined, info.etag)
                if (backupFileVersion(local) !== baseline) throw new Error('下载期间本地文件已变化')
                fs.renameSync(temporary, local)
            } finally { fs.rmSync(temporary, { force: true }) }
            return true
        } catch (error: any) { this.addLog({ timestamp: Date.now(), type: 'download', file: relativePath, status: 'error', message: error.message }); return false }
    }

    async createBackup(): Promise<string | null> {
        if (isCloudRestoreRunning()) return null
        const releaseBackup = beginCloudBackup()
        const id = crypto.randomUUID(), zipName = 'lx-sync-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + id.slice(0, 8) + '.zip'
        const zipPath = path.join(this.dataPath, zipName), stage = path.join(this.dataPath, 'runtime', 'webdav-archives', id)
        try {
            const files = await this.scanFiles()
            if (!files.size) return null
            const manifest: Record<string, WebdavFileVersion> = {}
            fs.mkdirSync(stage, { recursive: true })
            for (const [relative, hash] of files) {
                const local = this.localPath(relative), version = backupFileVersion(local), target = path.join(stage, relative)
                fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(local, target)
                if (backupFileVersion(local) !== version || hashBackupFile(target) !== hash) throw new Error('创建快照期间文件已变化：' + relative)
                manifest[relative] = { hash, size: fs.statSync(target).size }
            }
            const archive = new ZipArchive({ zlib: { level: 4 } })
            let current = 0
            archive.on('entry', (entry: any) => this.emit('progress', { type: 'backup', status: 'packing', current: ++current, total: files.size + 1, file: entry.name }))
            const output = pipeline(archive, fs.createWriteStream(zipPath))
            for (const relative of files.keys()) archive.file(path.join(stage, relative), { name: relative.replace(/\\/g, '/') })
            archive.append(JSON.stringify({ schema: 1, files: manifest }), { name: webdavManifestName })
            await Promise.all([archive.finalize(), output])
            this.lastArchiveSnapshot = files
            return zipName
        } catch (error: any) {
            fs.rmSync(zipPath, { force: true }); this.emit('progress', { type: 'backup', status: 'error', message: error.message }); return null
        } finally { fs.rmSync(stage, { recursive: true, force: true }); releaseBackup() }
    }

    async uploadBackup(force = false): Promise<boolean> {
        if (this.syncing || this.restoring || isCloudRestoreRunning()) return false
        const releaseBackup = beginCloudBackup()
        this.syncing = true
        if (!this.client) await this.initClient()
        if (!this.client) { this.syncing = false; releaseBackup(); return false }

        let zipPath: string | null = null
        try {
            // 检查是否有文件变化
            if (!force) {
                const current = await this.scanFiles()
                const unchanged = current.size === this.backupHash.size && [...current].every(([file, hash]) => this.backupHash.get(file) === hash)
                if (unchanged && (await this.getBackupList()).length > 0) {
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
            await this.ensureRemoteDir(path.posix.dirname(remotePath))
            await uploadWebdavFile(this.client, zipPath, remotePath, stat.size, current => this.emit('progress', { type: 'backup', status: 'uploading', file: zipName, current, total: stat.size }))

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

            this.backupHash = new Map(this.lastArchiveSnapshot)
            this.saveState()

            // 成功上传后按配置清理历史 ZIP，始终保留最新一份
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
            releaseBackup()
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
        const releaseBackup = beginCloudBackup()
        this.syncing = true
        if (!this.client) await this.initClient()
        if (!this.client) {
            this.syncing = false
            releaseBackup()
            this.emit('progress', { type: 'sync', status: 'error', message: 'WebDAV 客户端未初始化' })
            return false
        }

        let total = 0
        let successCount = 0
        let failCount = 0

        try {
            await this.loadRemoteManifest()
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

            await this.publishManifest()
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
            releaseBackup()
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
            const parts = match[1].replace(/-[a-f0-9]{8}$/, '').split('T')
            if (parts.length === 2) {
                const timeStr = parts[1].replace(/(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)/, '$1:$2:$3.$4')
                const parsed = Date.parse(`${parts[0]}T${timeStr}`)
                if (!isNaN(parsed)) return parsed
            }
            const parsed = Date.parse(match[1])
            if (Number.isFinite(parsed)) return parsed
        }
        return 0
    }

    async cleanOldBackups() {
        if (!this.client) return

        try {
            const items = await this.client.getDirectoryContents(`${this.backupPath}/`)
            const backups = items
                .filter((item: any) => item.type === 'file' && /^lx-sync-backup-[a-zA-Z0-9T.-]+\.zip$/.test(item.basename))
                .sort((a: any, b: any) => this.parseBackupTime(b) - this.parseBackupTime(a) || b.basename.localeCompare(a.basename))

            const count = this.config.retentionCount || 5, days = this.config.retentionDays || 0
            for (let i = 1; i < backups.length; i++) {
                if (i >= count || (days > 0 && this.parseBackupTime(backups[i]) > 0 && this.parseBackupTime(backups[i]) < Date.now() - days * 86400000)) await this.client.deleteFile(checkedBackupPath(this.backupPath, backups[i].filename))
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
                .filter((item: any) => item.type === 'file' && /^lx-sync-backup-[a-zA-Z0-9T.-]+\.zip$/.test(item.basename))
                .sort((a: any, b: any) => this.parseBackupTime(b) - this.parseBackupTime(a) || b.basename.localeCompare(a.basename))

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
            if (Number(err.status || err.response?.status) === 404) return []
            throw err
        }
    }

    async deleteBackupFile(targetFilename: string): Promise<boolean> {
        if (!this.client) await this.initClient()
        if (!this.client) return false

        try {
            if (this.syncing || this.restoring || isCloudRestoreRunning()) throw new Error('正在备份或恢复，请稍后删除')
            const remotePath = checkedBackupPath(this.backupPath, targetFilename)
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

    async restoreBackupFile(targetFilename?: string): Promise<boolean> { return this.performRestore({ mode: 'zip', targetFilename }) }
    async downloadLatestBackup(): Promise<boolean> { return this.restoreBackupFile() }
    async restoreScatteredFiles(): Promise<boolean> { return this.performRestore({ mode: 'files' }) }
    public async restoreLocalBackup(zipPath: string): Promise<number> { return this.extractZip(zipPath, this.dataPath) }
    public async extractZip(zipPath: string, _targetPath: string): Promise<number> {
        if (!await this.performRestore({ mode: 'zip' }, zipPath)) throw new Error(this.lastRestoreResult?.errors?.join('；') || '恢复失败')
        return this.lastRestoreResult.restored
    }

    async syncChangedFiles(): Promise<void> {
        if (this.syncing || this.restoring || isCloudRestoreRunning()) return
        const releaseBackup = beginCloudBackup()
        this.syncing = true
        try {
            if (!this.client) await this.initClient()
            if (!this.client) throw new Error('WebDAV 客户端未初始化')
            await this.loadRemoteManifest()
            const { changed, deleted } = await this.getChangedFiles()
            await this.runConcurrent(changed, 5, async file => {
                await this.uploadFile(file)
            })
            for (const file of deleted) {
                if (this.shouldIgnore(file)) { this.filesHash.delete(file); continue }
                if (!this.config.mirrorDeletes || await this.deleteRemoteFile(file)) { this.filesHash.delete(file); if (this.config.mirrorDeletes) delete this.remoteVersions[file] }
            }
            this.saveState(); await this.publishManifest()
        } finally { this.syncing = false; releaseBackup() }
    }

    async restoreFromRemote(options: WebdavRestoreOptions & { startup?: boolean } = {}): Promise<boolean> { return this.performRestore(options, undefined, undefined, options.startup === true) }

    async testConnection(): Promise<{ success: boolean; message: string; checks?: Array<{ name: string; path: string; success: boolean; message: string }> }> {
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

            // 根目录列举可能失败，而实际挂载的子目录仍可用。仅检查配置目录，不写入测试文件。
            const checks = await Promise.all([
                { name: '同步目录', path: this.syncPath || '/' },
                { name: '备份目录', path: this.backupPath || '/' },
            ].map(async target => {
                const controller = new AbortController()
                const timer = setTimeout(() => controller.abort(), 10000)
                try {
                    await this.client.getDirectoryContents(target.path, { deep: false, signal: controller.signal })
                    return { ...target, success: true, message: '目录可读取' }
                } catch (err: any) {
                    const status = Number(err?.status || err?.response?.status)
                    const detail = String(err?.code || err?.cause?.code || '') + ' ' + String(err?.message || '')
                    let message = '目录读取失败，请检查 WebDAV 地址、服务端日志及网络连接'
                    if (status === 401) message = '认证失败，请检查已保存的用户名、密码或应用专用密码'
                    else if (status === 403) message = '没有列目录权限，请检查账号对该目录的访问权限'
                    else if (status === 404) message = '目录不存在或 URL 路径不正确；首次上传可能会自动创建目录'
                    else if (status === 405 || status === 501) message = '服务不支持列目录 (PROPFIND)，请检查 WebDAV 地址及代理的方法限制'
                    else if ([502, 503, 504].includes(status)) message = '网关或上游服务异常，请检查反向代理和存储挂载；列目录失败不代表上传一定失败'
                    else if (/timeout|timed out|aborted/i.test(detail)) message = '请求超时（每个目录最多等待 10 秒），请检查网络、代理和存储响应速度'
                    else if (/ENOTFOUND|EAI_AGAIN/.test(detail)) message = '域名解析失败，请检查服务器地址及服务器的 DNS'
                    else if (/ECONNREFUSED|ECONNRESET/.test(detail)) message = '连接被拒绝或中断，请检查端口、防火墙及服务状态'
                    else if (/CERT|TLS|SSL|SELF_SIGNED/i.test(detail)) message = 'TLS 证书校验失败，请检查证书有效期、域名和证书链'
                    // 不回显可能包含凭据、URL 或上游响应正文的原始错误。
                    return { ...target, success: false, message: `${Number.isFinite(status) && status > 0 ? `HTTP ${status}：` : ''}${message}` }
                } finally {
                    clearTimeout(timer)
                }
            }))
            const passed = checks.filter(check => check.success).length
            const summary = passed === checks.length ? '配置目录均可读取。' : passed ? '部分目录检查未通过。' : '配置目录读取检查未通过。'
            return {
                success: passed === checks.length,
                message: `${summary}本测试使用已保存配置，仅检查目录读取，不会创建或删除远端文件。上传、删除权限及完整恢复能力尚未验证；如已能正常备份，请结合各目录结果排查。`,
                checks,
            }
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
        if (isCloudRestoreRunning()) return
        if (!this.isConfigured()) return

        // 避免重复启动定时器
        this.stopAutoSync()

        console.log('Starting auto file change detection...')

        // 保留成功上传的基线；首次检查需要上传尚未备份的本地文件。

        // 按配置的时间间隔检查增量文件变化
        this.nextSyncAt = Date.now() + this.syncInterval
        this.nextZipAt = Date.now() + this.backupInterval
        this.watchTimer = setInterval(() => {
            this.nextSyncAt = Date.now() + this.syncInterval
            void this.syncChangedFiles().catch(error => console.error('[WebDAV] 增量备份失败:', error.message))
        }, this.syncInterval)

        // 每24小时创建备份（如果有变化）
        this.backupTimer = setInterval(() => {
            this.nextZipAt = Date.now() + this.backupInterval
            void this.uploadBackup().catch(error => console.error('[WebDAV] ZIP 备份失败:', error.message))
        }, this.backupInterval)
    }

    stopAutoSync() {
        this.nextSyncAt = 0
        this.nextZipAt = 0
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
        if (this.syncing || this.restoring) throw new Error('WebDAV 正在备份或恢复，不能切换配置')
        let changed = false
        if (config.retentionCount !== undefined) this.config.retentionCount = Math.max(1, Math.min(1000, Math.floor(config.retentionCount || 5)))
        if (config.retentionDays !== undefined) this.config.retentionDays = Math.max(0, Math.min(3650, Math.floor(config.retentionDays || 0)))
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
            this.loadState()
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
