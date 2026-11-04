import fs from 'node:fs'
import path from 'node:path'

export const BACKUP_TYPES = ['music', 'userFiles', 'snapshots', 'userData', 'system'] as const
export type BackupType = typeof BACKUP_TYPES[number]
export type BackupDestination = 'webdav' | 'openlist'
let cloudRestoreRunning = false
export const isCloudRestoreRunning = () => cloudRestoreRunning
export function beginCloudRestore(): () => void {
  if (cloudRestoreRunning) throw new Error('另一项云端恢复正在执行，请稍后重试')
  cloudRestoreRunning = true
  return () => { cloudRestoreRunning = false }
}
export interface BackupContext {
  dataPath: string
  configPath?: string
  config?: Record<string, any>
}

export const BACKUP_TYPE_INFO = [
  { id: 'music', label: '歌曲与歌词', description: 'data/music 内的歌曲、歌词、封面和音乐索引；不包含 cache 或外部歌曲目录。' },
  { id: 'userFiles', label: '用户音源文件', description: 'users/source 内的音源脚本、顺序和状态文件，以及上传的用户文件。' },
  { id: 'snapshots', label: '歌单与不喜欢快照', description: '快照正文、snapshotInfo.json；包含没有扩展名的快照及已配置的外部歌单快照目录。' },
  { id: 'userData', label: '用户数据', description: '用户设置、播放记录、收藏与其他 JSON 数据；不包含音源文件和快照。' },
  { id: 'system', label: '系统与账户', description: 'config.js、users.json、serverInfo.json 等系统 JSON；包含账号和连接凭据。' },
] as const

export function normalizeBackupTypes(value: unknown): BackupType[] {
  if (!Array.isArray(value) || value.some(v => !BACKUP_TYPES.includes(v as BackupType))) throw new Error('备份类型必须是有效类型组成的数组')
  return BACKUP_TYPES.filter(v => value.includes(v))
}

export function getBackupTypes(destination: BackupDestination, config: Record<string, any> = {}): BackupType[] {
  const raw = config[`backup.${destination}.types`]
  if (raw !== undefined) return normalizeBackupTypes(raw)
  // 旧配置迁移：不再备份 cache；保留原来是否排除 music 的选择。
  return BACKUP_TYPES.filter(type => !(destination === 'webdav' && type === 'music' && config['webdav.excludeMusic']))
}

export function backupType(relative: string): BackupType | null {
  const rel = relative.replace(/\\/g, '/')
  const segments = rel.split('/')
  if (!rel || path.posix.isAbsolute(rel) || segments.some(s => !s || s === '.' || s === '..' || s.includes(':') || s.includes('\0'))) return null
  const lower = rel.toLowerCase()
  if (segments.some(s => s.startsWith('.') || /^(runtime|cache|logs|tmp|backups)$/i.test(s))) return null
  if (/^users\/[^/]+\/music\//i.test(rel)) return null
  if (/\.(tmp|oltmp|part|log|lock|db|sqlite)(-(wal|shm))?$/i.test(rel) || /(^|\/)temp-|(^|\/)lx-sync-backup-/.test(lower)) return null
  if (lower.startsWith('music/')) return 'music'
  if (lower.startsWith('_snapshots/') || /^users\/[^/]+\/(list|dislike)\/snapshot(\/|info\.json$)/i.test(rel)) return 'snapshots'
  if (/^(users\/source|source|uploads)\//i.test(rel)) return 'userFiles'
  if (/^users\/[^/]+\//i.test(rel)) return 'userData'
  if (lower === 'config.js' || (!rel.includes('/') && lower.endsWith('.json'))) return 'system'
  return null
}

function contained(root: string, relative: string): string {
  const base = path.resolve(root)
  const target = path.resolve(base, relative)
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('备份路径超出数据目录')
  let current = target
  while (current !== base) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('备份路径不能包含符号链接')
    current = path.dirname(current)
  }
  return target
}

/** 云端始终保存相对路径，恢复时按本机配置重新定位，不使用云端提供的绝对路径。 */
export function backupLocalPath(relative: string, context: BackupContext): string {
  if (!backupType(relative)) throw new Error('不允许的备份文件路径：' + relative)
  const rel = relative.replace(/\\/g, '/')
  if (rel === 'config.js') return context.configPath || path.join(context.dataPath, rel)
  if (rel.startsWith('_snapshots/')) {
    const external = String(context.config?.['snapshot.backupPath'] || '')
    if (!external) throw new Error('此备份来自外部快照目录，请先配置 snapshot.backupPath 再恢复')
    const base = path.isAbsolute(external) ? external : path.join(context.dataPath, external)
    return contained(base, rel.slice('_snapshots/'.length))
  }
  return contained(context.dataPath, rel)
}

export function scanBackupFiles(context: BackupContext, types: readonly BackupType[]): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (dir: string, prefix = '') => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const rel = prefix + entry.name
      const local = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !/^(runtime|cache|logs|tmp|backups)$/i.test(entry.name)) walk(local, rel + '/')
      } else if (entry.isFile()) {
        const type = backupType(rel)
        if (type && types.includes(type)) files.set(rel, local)
      }
    }
  }
  walk(context.dataPath)
  if (types.includes('system') && context.configPath && fs.existsSync(context.configPath)) files.set('config.js', context.configPath)
  const snapshots = String(context.config?.['snapshot.backupPath'] || '')
  if (types.includes('snapshots') && snapshots) {
    const base = path.isAbsolute(snapshots) ? snapshots : path.join(context.dataPath, snapshots)
    // 外部快照目录只映射每个用户的 snapshot 子目录。
    if (fs.existsSync(base)) for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(path.join(base, entry.name, 'snapshot'), `_snapshots/${entry.name}/snapshot/`)
    }
  }
  return files
}
