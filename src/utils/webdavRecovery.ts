import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Open } from 'unzipper'
import { pipeline } from 'node:stream/promises'
import { backupLocalPath, backupType, type BackupContext, type BackupType } from './backupPolicy'
import { hashBackupFile, backupFileVersion } from './backupFiles'
import { downloadWebdavFile } from './webdavTransfer'
import { parseWebdavManifest, webdavManifestName, type WebdavFileVersion } from './webdavState'
import { executeRestoreTransaction, type RestoreFile } from '@/server/backup/webdavRestoreTasks'
import { markRestoreDependencies, mergeRestoreDependency } from '@/server/backup/restoreDependencies'

export interface WebdavRestoreOptions { mode?: 'auto' | 'files' | 'zip'; targetFilename?: string; strategy?: 'missing' | 'overwrite'; keepCopies?: boolean }
export interface RecoveryContext extends BackupContext { client: any; types: BackupType[]; syncPath: string; backupPath: string; identity: string }
interface Plan { token: string; expires: number; identity: string; files: RestoreFile[]; etags: Record<string, string>; zip?: string; options: WebdavRestoreOptions; warnings: string[] }
export function checkedBackupPath(base: string, input: string) {
  const name = path.posix.basename(input)
  if (!/^lx-sync-backup-[a-zA-Z0-9T.-]+\.zip$/.test(name) || (input !== name && input !== base + '/' + name)) throw new Error('备份文件必须位于配置的 ZIP 目录内')
  return base + '/' + name
}
export class WebdavRecovery {
  private plans = new Map<string, Plan>()
  discard(token: string) {
    const plan = this.plans.get(token)
    if (!plan) return
    if (plan.zip) fs.rmSync(plan.zip, { force: true })
    this.plans.delete(token)
  }
  private directory(dataPath: string) { const dir = path.join(dataPath, 'runtime', 'webdav-preview'); fs.mkdirSync(dir, { recursive: true }); return dir }
  private cleanup() {
    for (const [id, plan] of this.plans) if (plan.expires < Date.now()) { if (plan.zip) fs.rmSync(plan.zip, { force: true }); this.plans.delete(id) }
  }
  private file(context: RecoveryContext, relative: string, remote: string, size: number, strategy: string, hash?: string): RestoreFile {
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('备份文件大小无效：' + relative)
    const local = backupLocalPath(relative, context), version = backupFileVersion(local)
    return { relative, local, remote, size, hash, version, action: version === 'missing' ? 'add' : strategy === 'missing' ? 'skip' : 'overwrite' }
  }
  async prepare(context: RecoveryContext, options: WebdavRestoreOptions = {}, localZip?: string) {
    this.cleanup()
    if (options.strategy && !['missing', 'overwrite'].includes(options.strategy)) throw new Error('恢复覆盖方式无效')
    if (options.mode && !['auto', 'files', 'zip'].includes(options.mode)) throw new Error('恢复来源无效')
    const token = crypto.randomUUID(), strategy = options.strategy || 'overwrite'
    const plan: Plan = { token, expires: Date.now() + 15 * 60_000, identity: context.identity, files: [], etags: {}, options: { ...options, strategy }, warnings: [] }
    let items: any[] = [], mode = localZip ? 'zip' : options.mode || 'auto'
    if (mode !== 'zip') {
      try { items = await context.client.getDirectoryContents(context.syncPath + '/', { deep: true, signal: AbortSignal.timeout(30_000) }) }
      catch (error: any) { if (mode !== 'auto' || Number(error.status || error.response?.status) !== 404) throw error }
      const prefix = context.syncPath + '/'
      items = items.filter(item => item.type === 'file' && item.filename.startsWith(prefix))
      if (mode === 'auto') mode = items.some(item => { const type = backupType(item.filename.slice(prefix.length)); return type && context.types.includes(type) }) ? 'files' : 'zip'
    }
    try {
      if (mode === 'files') {
        const manifest = items.find(item => item.filename === context.syncPath + '/' + webdavManifestName)
        let versions: Record<string, WebdavFileVersion> = {}
        if (manifest) {
          if (manifest.size > 16 * 1024 * 1024) throw new Error('备份清单过大')
          const temp = path.join(this.directory(context.dataPath), token + '.json')
          try { await downloadWebdavFile(context.client, manifest.filename, temp, Number(manifest.size)); versions = parseWebdavManifest(JSON.parse(fs.readFileSync(temp, 'utf8'))) }
          finally { fs.rmSync(temp, { force: true }) }
        } else plan.warnings.push('旧增量备份没有 SHA-256 清单，仅核对下载大小。')
        for (const item of items) {
          const relative = item.filename.slice((context.syncPath + '/').length), type = backupType(relative)
          if (!type || !context.types.includes(type)) continue
          const version = versions[relative]
          if (manifest && !version && !plan.warnings.includes('部分旧云端文件没有 SHA-256 记录，仅核对下载大小。')) plan.warnings.push('部分旧云端文件没有 SHA-256 记录，仅核对下载大小。')
          if (version && version.size !== Number(item.size)) throw new Error('云端大小与备份清单不一致：' + relative)
          plan.files.push(this.file(context, relative, item.filename, Number(item.size), strategy, version?.hash))
          if (item.etag) plan.etags[relative] = item.etag
        }
        if (manifest) this.checkCoverage(versions, plan.files, context.types)
      } else {
        let zip = localZip
        if (!zip) {
          let remote = options.targetFilename ? checkedBackupPath(context.backupPath, options.targetFilename) : ''
          if (!remote) {
            const backups = await context.client.getDirectoryContents(context.backupPath + '/', { signal: AbortSignal.timeout(30_000) })
            const candidates = backups.filter((item: any) => item.type === 'file' && /^lx-sync-backup-[a-zA-Z0-9T.-]+\.zip$/.test(item.basename)).sort((a: any, b: any) => Date.parse(b.lastmod || '') - Date.parse(a.lastmod || '') || b.basename.localeCompare(a.basename))
            if (!candidates.length) throw new Error('云端没有 ZIP 备份')
            remote = checkedBackupPath(context.backupPath, candidates[0].filename)
          }
          const info = await context.client.stat(remote, { signal: AbortSignal.timeout(30_000) })
          zip = path.join(this.directory(context.dataPath), token + '.zip')
          plan.zip = zip
          await downloadWebdavFile(context.client, remote, zip, Number(info.size), undefined, info.etag)
          plan.options.targetFilename = remote
        } else {
          // Own the uploaded ZIP for the lifetime of the plan, independently of the HTTP temp file.
          const owned = path.join(this.directory(context.dataPath), token + '.zip'); fs.copyFileSync(zip, owned); zip = owned; plan.zip = owned
        }
        const archive = await Open.file(zip!)
        const manifest = archive.files.find(entry => entry.path === webdavManifestName)
        let versions: Record<string, WebdavFileVersion> = {}
        if (manifest) {
          if (manifest.uncompressedSize > 16 * 1024 * 1024) throw new Error('ZIP 清单过大')
          versions = parseWebdavManifest(JSON.parse((await manifest.buffer()).toString('utf8')))
        } else plan.warnings.push('旧 ZIP 没有 SHA-256 清单，将检查解压大小。')
        const seen = new Set<string>()
        for (const entry of archive.files) {
          if (entry.path.split(/[\\/]/).some(segment => segment === '..') || path.posix.isAbsolute(entry.path)) throw new Error('ZIP 路径越界')
          if ((((entry as any).externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP 不允许符号链接')
          if (entry.type !== 'File') continue
          const relative = entry.path.replace(/\\/g, '/'), type = backupType(relative)
          if (!type || !context.types.includes(type)) continue
          const file = this.file(context, relative, entry.path, entry.uncompressedSize, strategy, versions[relative]?.hash)
          const canonical = process.platform === 'win32' ? file.local.toLowerCase() : file.local
          if (seen.has(canonical)) throw new Error('ZIP 包含重复恢复目标：' + relative)
          seen.add(canonical)
          if (manifest && (!versions[relative] || versions[relative].size !== entry.uncompressedSize)) throw new Error('ZIP 文件与清单不一致：' + relative)
          plan.files.push(file)
        }
        if (manifest) this.checkCoverage(versions, plan.files, context.types)
      }
      if (!plan.files.length) throw new Error('备份中没有当前所选类型的文件')
      if (strategy === 'missing') markRestoreDependencies(plan.files)
      this.plans.set(token, plan)
      const timer = setTimeout(() => { try { this.discard(token) } catch { /* Cleanup can be retried by the next preview. */ } }, 15 * 60_000)
      timer.unref()
      return this.summary(plan, context.types)
    } catch (error) { if (plan.zip) fs.rmSync(plan.zip, { force: true }); throw error }
  }
  private checkCoverage(versions: Record<string, WebdavFileVersion>, files: RestoreFile[], types: BackupType[]) {
    const present = new Set(files.map(file => file.relative))
    for (const relative of Object.keys(versions)) {
      const type = backupType(relative)
      if (type && types.includes(type) && !present.has(relative)) throw new Error('备份清单中的文件缺失：' + relative)
    }
  }
  private summary(plan: Plan, types: BackupType[]) {
    return { token: plan.token, types, source: plan.zip ? 'zip' : 'files', total: plan.files.length, added: plan.files.filter(f => f.action === 'add').length, overwritten: plan.files.filter(f => f.action === 'overwrite').length, merged: plan.files.filter(f => f.action === 'merge').length, skipped: plan.files.filter(f => f.action === 'skip').length, bytes: plan.files.filter(f => f.action !== 'skip').reduce((n, f) => n + f.size, 0), warnings: plan.warnings, files: plan.files.map(f => ({ path: f.relative, size: f.size, action: f.action })) }
  }
  async execute(context: RecoveryContext, token: string) {
    const plan = this.plans.get(token)
    if (!plan || plan.expires < Date.now() || plan.identity !== context.identity) throw new Error('预览过期或配置已变化，请重新预览')
    for (const file of plan.files) if (backupFileVersion(file.local) !== file.version) throw new Error('预览后本地文件已变化，请重新预览：' + file.relative)
    this.plans.delete(token)
    try {
      const archive = plan.zip ? await Open.file(plan.zip) : null
      return await executeRestoreTransaction({ files: plan.files, source: 'webdav:' + context.identity, options: plan.options, keepCopies: plan.options.keepCopies !== false,
        download: async (file, target, signal) => {
          if (archive) {
            const entry = archive.files.find(entry => entry.path === file.remote)!
            await pipeline(entry.stream(), fs.createWriteStream(target), { signal })
          } else await downloadWebdavFile(context.client, file.remote, target, file.size, signal, plan.etags[file.relative])
          if (fs.statSync(target).size !== file.size) throw new Error('恢复文件大小不一致：' + file.relative)
          if (file.hash && hashBackupFile(target) !== file.hash) throw new Error('恢复文件 SHA-256 不一致：' + file.relative)
        }, merge: (file, staged) => mergeRestoreDependency(file, staged, plan.files),
      })
    } finally { if (plan.zip) fs.rmSync(plan.zip, { force: true }) }
  }
}
