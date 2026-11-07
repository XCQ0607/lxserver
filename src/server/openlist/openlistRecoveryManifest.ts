import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { OpenListClient, OpenListNotFoundError } from './openlistClient'
import { hashBackupFile } from '@/utils/backupFiles'
import { listAllBackups, listAttachments } from './openlistBackupDb'
import { backupType, getBackupTypes } from '@/utils/backupPolicy'

export interface RecoveryFile { relative: string; size: number; hash: string; object: string }
export interface RecoveryCache {
  user: string; folder: string; relative: string; size: number; hash: string
  source: string | null; songmid: string | null; quality: string | null; metadata: string | null
  attachments: Array<{ relative: string; hash?: string; size: number; category: string }>
}
export interface RecoveryManifest { schema: 1; fingerprint: string; createdAt: number; files: RecoveryFile[]; cache: RecoveryCache[] }
const validId = (id: string) => /^[0-9a-f-]{36}\.json$/.test(id)
const checkedRelative = (relative: string) => typeof relative === 'string' && !!relative && !relative.startsWith('/') && !relative.includes('\\') && relative.split('/').every(p => p && p !== '.' && p !== '..' && !p.includes(':'))
export async function readRecoveryManifest(cl: OpenListClient, id?: string): Promise<RecoveryManifest | null> {
  if (id && !validId(id)) throw new Error('历史备份 ID 无效')
  let manifest: RecoveryManifest
  try { manifest = await cl.readJSON(cl.resolveRemotePath(id ? '_system/recovery/history/' + id : '_system/recovery/latest.json')) }
  catch (e) { if (!id && e instanceof OpenListNotFoundError) return null; throw e }
  if (manifest?.schema !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.cache)) throw new Error('恢复清单格式无效')
  if (!Number.isFinite(manifest.createdAt) || manifest.fingerprint !== crypto.createHash('sha256').update(JSON.stringify({ files: manifest.files, cache: manifest.cache })).digest('hex')) throw new Error('恢复清单指纹无效')
  const seen = new Set<string>()
  for (const file of manifest.files) {
    if (!backupType(file.relative) || !/^[a-f0-9]{64}$/.test(file.hash) || file.object !== `_system/recovery/objects/${file.hash.slice(0, 2)}/${file.hash}` || !Number.isSafeInteger(file.size) || file.size < 0 || seen.has(file.relative)) throw new Error('恢复清单包含无效或重复文件')
    seen.add(file.relative)
  }
  for (const item of manifest.cache) {
    if (typeof item.user !== 'string' || !checkedRelative(item.user) || item.user.includes('/') || !['cache', 'music'].includes(item.folder) || !checkedRelative(item.relative) || !/^[a-f0-9]{64}$/.test(item.hash) || !Number.isSafeInteger(item.size) || item.size < 0 || !Array.isArray(item.attachments)) throw new Error('缓存恢复清单无效')
    for (const att of item.attachments) if (!checkedRelative(att.relative) || (att.hash !== undefined && !/^[a-f0-9]{64}$/.test(att.hash)) || !Number.isSafeInteger(att.size) || att.size < 0) throw new Error('缓存附件清单无效')
  }
  return manifest
}
export async function listRecoveryVersions(cl: OpenListClient) {
  try {
    const rows = await cl.listFilesRecursive(cl.resolveRemotePath('_system/recovery/history'))
    return rows.filter(f => !f.isDir && validId(f.name)).map(f => ({ id: f.name, modified: f.modified, size: f.size })).sort((a, b) => b.modified.localeCompare(a.modified))
  } catch (e) { if (e instanceof OpenListNotFoundError) return []; throw e }
}
async function pruneRecoveryHistory(cl: OpenListClient, current: RecoveryManifest) {
  const days = Math.min(3650, Math.max(1, Number(global.lx.config['openlist.historyRetentionDays']) || 7))
  const cutoff = Date.now() - days * 86_400_000
  const versions = await listRecoveryVersions(cl)
  const referenced = new Set(current.files.map(f => f.object))
  for (const version of versions) {
    const modified = Date.parse(version.modified)
    if (Number.isFinite(modified) && modified < cutoff) {
      await cl.remove(cl.resolveRemotePath('_system/recovery/history/' + version.id))
    } else {
      const manifest = await readRecoveryManifest(cl, version.id)
      for (const file of manifest!.files) referenced.add(file.object)
    }
  }
  const prefix = cl.resolveRemotePath('_system/recovery/objects/')
  let objects: Awaited<ReturnType<OpenListClient['listFilesRecursive']>> = []
  try { objects = await cl.listFilesRecursive(prefix.replace(/\/$/, '')) } catch (e) { if (!(e instanceof OpenListNotFoundError)) throw e }
  for (const object of objects) {
    if (object.isDir || !object.path.startsWith(prefix)) continue
    const relative = object.path.slice(cl.resolveRemotePath('').length)
    if (!/^_system\/recovery\/objects\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(relative)) continue
    if (!referenced.has(relative) && Date.parse(object.modified) < cutoff) await cl.remove(object.path)
  }
}
async function uploadJSON(cl: OpenListClient, relative: string, value: any) {
  const dir = path.join(global.lx.dataPath, 'backups', 'openlist-manifest-tmp')
  fs.mkdirSync(dir, { recursive: true })
  const temp = path.join(dir, crypto.randomUUID() + '.json')
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
    const remote = cl.resolveRemotePath(relative)
    await cl.mkdir(path.posix.dirname(remote)); await cl.upload(temp, remote)
  } finally { fs.rmSync(temp, { force: true }) }
}

/** Cloud metadata is independent of local SQLite; immutable content objects make history restorable. */
export async function publishRecoveryManifest(cl: OpenListClient): Promise<void> {
  const files: RecoveryFile[] = [], cache: RecoveryCache[] = []
  const previous = await readRecoveryManifest(cl)
  const dataPrefix = cl.resolveRemotePath('_data/')
  const rows = listAllBackups().filter(r => ['completed', 'verified'].includes(r.status) && r.local_hash && !r.deleted_at)
  const types = getBackupTypes('openlist', global.lx.config as any)
  for (const row of rows) {
    if (row.folder_type === 'data' && row.remote_path.startsWith(dataPrefix)) {
      const relative = row.remote_path.slice(dataPrefix.length)
      if (!backupType(relative) || !types.includes(backupType(relative)!)) continue
      const object = `_system/recovery/objects/${row.local_hash!.slice(0, 2)}/${row.local_hash}`
      const target = cl.resolveRemotePath(object)
      let exists = false
      try { exists = (await cl.getFileInfo(target)).size === row.size } catch (e) { if (!(e instanceof OpenListNotFoundError)) throw e }
      if (!exists) {
        await cl.mkdir(path.posix.dirname(target))
        if (fs.existsSync(row.local_path) && hashBackupFile(row.local_path) === row.local_hash) await cl.upload(row.local_path, target, undefined, row.local_hash!)
        else throw new Error('历史内容对象缺失且本地版本不可用，未回读云端文件：' + relative)
      }
      files.push({ relative, size: row.size!, hash: row.local_hash!, object })
    } else if (['cache', 'music'].includes(row.folder_type)) {
      const prefix = cl.resolveRemotePath(row.user + '/' + row.folder_type + '/')
      if (!row.remote_path.startsWith(prefix)) continue
      const attachments: RecoveryCache['attachments'] = []
      for (const att of listAttachments(row.id).filter(a => ['completed', 'verified'].includes(a.status) && !a.deleted_at)) {
        if (!att.remote_path.startsWith(prefix)) continue
        const relative = att.remote_path.slice(prefix.length)
        const prior = previous?.cache.find(c => c.user === row.user && c.folder === row.folder_type && c.relative === row.remote_path.slice(prefix.length))?.attachments.find(a => a.relative === relative && a.size === att.size)
        attachments.push({ relative, hash: att.local_hash || prior?.hash || undefined, size: att.size!, category: att.category })
      }
      cache.push({ user: row.user, folder: row.folder_type, relative: row.remote_path.slice(prefix.length), size: row.size!, hash: row.local_hash!, source: row.source, songmid: row.songmid, quality: row.quality, metadata: row.cache_metadata, attachments })
    }
  }
  files.sort((a, b) => a.relative.localeCompare(b.relative)); cache.sort((a, b) => (a.user + a.folder + a.relative).localeCompare(b.user + b.folder + b.relative))
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ files, cache })).digest('hex')
  if (previous?.fingerprint === fingerprint) { await pruneRecoveryHistory(cl, previous); return }
  const manifest: RecoveryManifest = { schema: 1, fingerprint, createdAt: Date.now(), files, cache }
  await uploadJSON(cl, '_system/recovery/history/' + crypto.randomUUID() + '.json', manifest)
  await uploadJSON(cl, '_system/recovery/latest.json', manifest)
  await pruneRecoveryHistory(cl, manifest)
}
