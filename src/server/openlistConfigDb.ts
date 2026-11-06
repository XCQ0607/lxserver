/**
 * OpenList 配置的 SQLite 存储。
 * 与备份记录共用 openlist-backup.db：
 *  - openlist_config：全局配置（单行，id=1）
 *  - openlist_user_backup：按用户的同步规则（子表，user 唯一）
 *
 * 迁移策略：启动时若数据表尚无主记录，则把 config.js / 环境变量中的 openlist 配置写入；
 * 若数据表已有记录，则完全以数据库为准，忽略环境变量与 config.js 中的旧值。
 */
import { getBackupDb } from './openlistBackupDb'

export type OpenlistSyncMode = 'upload-delete' | 'upload' | 'sync' | 'download'

export interface OpenlistUserBackup {
  user: string
  enabled: boolean
  backupDownload?: boolean
  backupCache?: boolean
  backupSnapshot?: boolean
  mode?: OpenlistSyncMode
  downloadDir?: string
  cacheDir?: string
}

export interface OpenlistConfig {
  enable: boolean
  endpoint: string
  username: string
  password: string
  token: string
  root: string
  verifyInterval: number
  syncInterval: number
  includeNonAudio: boolean
  externalUrl: string
  backupSystemConfig: boolean
  userBackups: OpenlistUserBackup[]
}

export const DEFAULT_OPENLIST_CONFIG: OpenlistConfig = {
  enable: false,
  endpoint: '',
  username: '',
  password: '',
  token: '',
  root: '/lx_music',
  verifyInterval: 5,
  syncInterval: 60,
  includeNonAudio: false,
  externalUrl: '',
  backupSystemConfig: false,
  userBackups: [],
}

// 与具体连接绑定：连接被关闭（closeBackupDb）后重建的是新实例，需要重新建表
let ensuredDb: ReturnType<typeof getBackupDb> | null = null

const ensureTables = () => {
  const db = getBackupDb()
  if (ensuredDb === db) return
  db.exec(`CREATE TABLE IF NOT EXISTS openlist_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enable INTEGER NOT NULL DEFAULT 0,
    endpoint TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL DEFAULT '',
    password TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL DEFAULT '',
    root TEXT NOT NULL DEFAULT '/lx_music',
    verify_interval INTEGER NOT NULL DEFAULT 5,
    sync_interval INTEGER NOT NULL DEFAULT 60,
    include_non_audio INTEGER NOT NULL DEFAULT 0,
    external_url TEXT NOT NULL DEFAULT '',
    backup_system_config INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS openlist_user_backup (
    user TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    backup_download INTEGER NOT NULL DEFAULT 1,
    backup_cache INTEGER NOT NULL DEFAULT 1,
    backup_snapshot INTEGER NOT NULL DEFAULT 1,
    mode TEXT NOT NULL DEFAULT 'upload',
    download_dir TEXT,
    cache_dir TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  ensuredDb = db
}

/** 数据表中是否已有 OpenList 配置记录（决定启动迁移是否执行） */
export function hasOpenlistConfigRecord(): boolean {
  ensureTables()
  const row = getBackupDb().prepare('SELECT id FROM openlist_config WHERE id = 1').get() as any
  return !!row
}

/** 读取 OpenList 配置（数据库为准；无记录时返回默认值） */
export function loadOpenlistConfig(): OpenlistConfig {
  ensureTables()
  const db = getBackupDb()
  const row = db.prepare('SELECT * FROM openlist_config WHERE id = 1').get() as any
  if (!row) return { ...DEFAULT_OPENLIST_CONFIG, userBackups: [] }
  const userRows = db.prepare('SELECT * FROM openlist_user_backup ORDER BY user').all() as any[]
  return {
    enable: !!row.enable,
    endpoint: row.endpoint || '',
    username: row.username || '',
    password: row.password || '',
    token: row.token || '',
    root: row.root || '/lx_music',
    verifyInterval: Number(row.verify_interval) || 5,
    syncInterval: Number(row.sync_interval) || 60,
    includeNonAudio: !!row.include_non_audio,
    externalUrl: row.external_url || '',
    backupSystemConfig: !!row.backup_system_config,
    userBackups: userRows.map(r => ({
      user: r.user,
      enabled: !!r.enabled,
      backupDownload: !!r.backup_download,
      backupCache: !!r.backup_cache,
      backupSnapshot: !!r.backup_snapshot,
      mode: (r.mode || 'upload') as OpenlistSyncMode,
      downloadDir: r.download_dir || undefined,
      cacheDir: r.cache_dir || undefined,
    })),
  }
}

/**
 * 增量保存 OpenList 配置：只覆盖传入字段；用户规则按 user upsert，并删除本次未出现的用户。
 * 返回保存后的完整配置。
 */
export function saveOpenlistConfig(patch: Partial<OpenlistConfig>): OpenlistConfig {
  ensureTables()
  const db = getBackupDb()
  // 主记录与用户规则必须原子写入：否则迁移写完主记录后崩溃，下次启动会判定「已迁移」而永久丢失用户规则
  db.exec('BEGIN IMMEDIATE')
  try {
    const next: OpenlistConfig = { ...loadOpenlistConfig(), ...patch }
    const now = Date.now()
    db.prepare(`INSERT INTO openlist_config
      (id, enable, endpoint, username, password, token, root, verify_interval, sync_interval, include_non_audio, external_url, backup_system_config, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enable = excluded.enable,
        endpoint = excluded.endpoint,
        username = excluded.username,
        password = excluded.password,
        token = excluded.token,
        root = excluded.root,
        verify_interval = excluded.verify_interval,
        sync_interval = excluded.sync_interval,
        include_non_audio = excluded.include_non_audio,
        external_url = excluded.external_url,
        backup_system_config = excluded.backup_system_config,
        updated_at = excluded.updated_at`
    ).run(
      next.enable ? 1 : 0,
      next.endpoint,
      next.username,
      next.password,
      next.token,
      next.root,
      next.verifyInterval,
      next.syncInterval,
      next.includeNonAudio ? 1 : 0,
      next.externalUrl,
      next.backupSystemConfig ? 1 : 0,
      now,
    )

    const keep = new Set<string>()
    for (const u of next.userBackups) {
      if (!u.user) continue
      keep.add(u.user)
      db.prepare(`INSERT INTO openlist_user_backup
        (user, enabled, backup_download, backup_cache, backup_snapshot, mode, download_dir, cache_dir, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user) DO UPDATE SET
          enabled = excluded.enabled,
          backup_download = excluded.backup_download,
          backup_cache = excluded.backup_cache,
          backup_snapshot = excluded.backup_snapshot,
          mode = excluded.mode,
          download_dir = excluded.download_dir,
          cache_dir = excluded.cache_dir,
          updated_at = excluded.updated_at`
      ).run(
        u.user,
        u.enabled ? 1 : 0,
        u.backupDownload !== false ? 1 : 0,
        u.backupCache !== false ? 1 : 0,
        u.backupSnapshot !== false ? 1 : 0,
        u.mode || 'upload',
        u.downloadDir || null,
        u.cacheDir || null,
        now,
        now,
      )
    }
    const existing = db.prepare('SELECT user FROM openlist_user_backup').all() as any[]
    for (const row of existing) {
      if (!keep.has(row.user)) db.prepare('DELETE FROM openlist_user_backup WHERE user = ?').run(row.user)
    }
    db.exec('COMMIT')
    return next
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 事务可能已自动回滚 */ }
    throw e
  }
}

/** 把 config.js / 环境变量中的旧 openlist 配置迁移到数据表；已有记录时不做任何处理 */
export function migrateOpenlistConfigFromLegacy(legacy: any): boolean {
  if (hasOpenlistConfigRecord()) return false
  const rawUB = legacy?.['openlist.userBackups']
  // 旧版全局开关 openlist.keepLocalAfterUpload=false 时，未显式指定 mode 的规则迁移为 upload-delete
  const legacyDelete = legacy?.['openlist.keepLocalAfterUpload'] === false
  const userBackups: OpenlistUserBackup[] = []
  try {
    const arr = typeof rawUB === 'string' ? JSON.parse(rawUB) : rawUB
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (!e || !e.user) continue
        userBackups.push({
          user: String(e.user),
          enabled: e.enabled !== false,
          backupDownload: e.backupDownload !== false,
          backupCache: e.backupCache !== false,
          backupSnapshot: e.backupSnapshot !== false,
          mode: e.mode || (legacyDelete ? 'upload-delete' : 'upload'),
          downloadDir: e.downloadDir || undefined,
          cacheDir: e.cacheDir || undefined,
        })
      }
    }
  } catch { /* 非法 JSON 按空规则处理 */ }
  saveOpenlistConfig({
    enable: !!legacy?.['openlist.enable'],
    endpoint: String(legacy?.['openlist.endpoint'] || ''),
    username: String(legacy?.['openlist.username'] || ''),
    password: String(legacy?.['openlist.password'] || ''),
    token: String(legacy?.['openlist.token'] || ''),
    root: String(legacy?.['openlist.root'] || '/lx_music'),
    verifyInterval: Number(legacy?.['openlist.verifyInterval']) || 5,
    syncInterval: Number(legacy?.['openlist.syncInterval']) || 60,
    includeNonAudio: legacy?.['openlist.includeNonAudio'] === true,
    externalUrl: String(legacy?.['openlist.externalUrl'] || ''),
    backupSystemConfig: legacy?.['openlist.backupSystemConfig'] === true,
    userBackups,
  })
  return true
}

/** 迁移完成后清理 config.js 中的 openlist 残留键，避免配置再被写回文件 */
export function stripOpenlistKeysFromConfig(config: any): string[] {
  const removed: string[] = []
  for (const key of Object.keys(config || {})) {
    if (key === 'openlist.enable' || key.startsWith('openlist.')) {
      delete config[key]
      removed.push(key)
    }
  }
  return removed
}
