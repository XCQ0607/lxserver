/**
 * OpenList 音频备份 - SQLite 元数据库
 * 记录每个待备份/已备份音频文件的本地路径、远端路径与上传状态。
 * 状态机：pending -> uploading -> completed -> verified（失败记 failed）。
 * 使用 Node 内置 node:sqlite（DatabaseSync），与 sqlite 分支同源。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type BackupStatus = 'pending' | 'uploading' | 'completed' | 'verified' | 'failed' | 'deleted'

export type AttachmentCategory = 'image' | 'lyric' | 'other'
export type AttachmentStatus = 'pending' | 'uploading' | 'completed' | 'verified' | 'failed' | 'deleted'

export interface AttachmentRow {
  id: number
  backup_file_id: number
  user: string
  folder_type: string
  local_path: string | null
  remote_path: string
  category: AttachmentCategory
  size: number | null
  status: AttachmentStatus
  error: string | null
  deleted_at: number | null
  updated_at: number
}

export interface BackupFileRow {
  id: number
  user: string
  folder_type: string
  local_path: string
  remote_path: string
  size: number | null
  name: string | null
  source: string | null
  songmid: string | null
  quality: string | null
  singer: string | null
  album: string | null
  img: string | null
  status: BackupStatus
  error: string | null
  retry_count: number
  remote_mtime: number | null
  deleted_at: number | null
  created_at: number
  updated_at: number
}

export interface UpsertBackupInput {
  user: string
  folderType: string
  localPath: string
  remotePath: string
  size?: number | null
  name?: string | null
  source?: string | null
  songmid?: string | null
  quality?: string | null
  singer?: string | null
  album?: string | null
  img?: string | null
  mode?: string | null
  status?: BackupStatus
}

export interface UpsertAttachmentInput {
  backupFileId: number
  user: string
  folderType: string
  localPath: string | null
  remotePath: string
  category?: AttachmentCategory
  size?: number | null
  status?: AttachmentStatus
}

let dbInstance: DatabaseSync | null = null

function getDataPath(): string {
  const lp = (globalThis as any).lx?.dataPath
  return typeof lp === 'string' && lp ? lp : path.join(process.cwd(), 'data')
}

export function getBackupDb(): DatabaseSync {
  if (dbInstance) return dbInstance
  const dir = getDataPath()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, 'openlist-backup.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(`CREATE TABLE IF NOT EXISTS openlist_backup_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    folder_type TEXT NOT NULL,
    local_path TEXT NOT NULL,
    remote_path TEXT NOT NULL,
    size INTEGER,
    name TEXT,
    source TEXT,
    songmid TEXT,
    quality TEXT,
    mode TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user, folder_type, local_path)
  )`)
  // 老库兼容：补齐 mode 列
  try {
    db.exec(`ALTER TABLE openlist_backup_files ADD COLUMN mode TEXT`)
  } catch { /* 列已存在 */ }
  // 老库兼容：补齐 retry_count 列
  try {
    db.exec(`ALTER TABLE openlist_backup_files ADD COLUMN retry_count INTEGER DEFAULT 0`)
  } catch { /* 列已存在 */ }
  // 软删除支持：deleted_at 标记（NULL 表示未删除）
  try { db.exec(`ALTER TABLE openlist_backup_files ADD COLUMN deleted_at INTEGER`) } catch { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE openlist_backup_attachments ADD COLUMN deleted_at INTEGER`) } catch { /* 列已存在 */ }
  // 远端文件最后编辑时间（来自 OpenList getFileInfo 的 modified）
  try { db.exec(`ALTER TABLE openlist_backup_files ADD COLUMN remote_mtime INTEGER`) } catch { /* 列已存在 */ }
  // 媒体元数据：补全歌手/专辑/封面，使「上传→下载还原」能恢复完整媒体信息（跨设备同步亦依赖此）
  try { db.exec(`ALTER TABLE openlist_backup_files ADD COLUMN singer TEXT`) } catch { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE openlist_backup_files ADD COLUMN album TEXT`) } catch { /* 列已存在 */ }
  try { db.exec(`ALTER TABLE openlist_backup_files ADD COLUMN img TEXT`) } catch { /* 列已存在 */ }
  // 老数据迁移：原本仅 status='deleted'（硬删除）的记录补 deleted_at，保持隐藏
  try { db.exec(`UPDATE openlist_backup_files SET deleted_at = updated_at WHERE status = 'deleted' AND deleted_at IS NULL`) } catch { /* ignore */ }
  try { db.exec(`UPDATE openlist_backup_attachments SET deleted_at = updated_at WHERE status = 'deleted' AND deleted_at IS NULL`) } catch { /* ignore */ }
  db.exec(`CREATE TABLE IF NOT EXISTS openlist_backup_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_file_id INTEGER NOT NULL,
    user TEXT NOT NULL,
    folder_type TEXT NOT NULL,
    local_path TEXT,
    remote_path TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'image',
    size INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    updated_at INTEGER NOT NULL,
    UNIQUE(user, folder_type, local_path)
  )`)
  // 老库兼容：补齐附件唯一约束（已存在重复行则忽略，手动 upsert 仍能去重）
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_ol_att_uniq ON openlist_backup_attachments(user, folder_type, local_path)')
  } catch { /* 列已存在或存在重复行，忽略 */ }
  // 本地文件登记表：记录实际落盘的音频 / 缓存文件，作为「本地是否存在」的权威来源（软删除 deleted_at）
  db.exec(`CREATE TABLE IF NOT EXISTS openlist_local_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    source TEXT,
    folder_type TEXT NOT NULL,
    local_path TEXT NOT NULL,
    filename TEXT,
    file_created_at INTEGER,
    file_modified_at INTEGER,
    size INTEGER,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user, local_path)
  )`)
  dbInstance = db
  return db
}

export function ensureBackupTables(): void {
  getBackupDb()
}

export function closeBackupDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}

const ACTIVE_UPLOAD_STATUSES: BackupStatus[] = ['pending', 'uploading', 'failed']

/**
 * 返回当前仍有「活跃上传任务」的本地文件路径集合（未软删，且状态为 pending/uploading/failed）。
 * 供 fileCache 缓存清理使用：清理体积超限的缓存时跳过这些文件，
 * 避免本地缓存被清理后 OpenList 上传因「源文件不存在」而失败（error: 本地源文件已不存在...）。
 * completed/verified 不在此列：它们由上传流程在成功后自行清理本地（upload-delete 模式）。
 */
export function getActiveBackupLocalPaths(): Set<string> {
  const db = getBackupDb()
  const placeholders = ACTIVE_UPLOAD_STATUSES.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT local_path FROM openlist_backup_files WHERE deleted_at IS NULL AND status IN (${placeholders})`,
  ).all(...ACTIVE_UPLOAD_STATUSES) as Array<{ local_path: string }>
  const set = new Set<string>()
  for (const r of rows) if (r.local_path) set.add(r.local_path)
  return set
}

export function upsertBackupFile(input: UpsertBackupInput): BackupFileRow {
  const db = getBackupDb()
  const now = Date.now()
  const status = input.status ?? 'pending'
  const stmt = db.prepare(`INSERT INTO openlist_backup_files
    (user, folder_type, local_path, remote_path, size, name, source, songmid, quality, singer, album, img, mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user, folder_type, local_path) DO UPDATE SET
      remote_path = excluded.remote_path,
      size = excluded.size,
      name = excluded.name,
      source = excluded.source,
      songmid = excluded.songmid,
      quality = excluded.quality,
      singer = excluded.singer,
      album = excluded.album,
      img = excluded.img,
      -- 备份策略(mode)仅在建表时写入，冲突时保留原值，避免后续同步/全局开关变化静默覆盖用户设定的备份策略
      status = excluded.status,
      updated_at = excluded.updated_at,
      deleted_at = NULL`)
  // 未显式传 name 时，用本地路径的文件名兜底，保证 pending/uploading 记录也能显示文件名（而非整条路径）
  const name = input.name || (input.localPath ? path.basename(input.localPath) : null)
  stmt.run(
    input.user, input.folderType, input.localPath, input.remotePath,
    input.size ?? null, name, input.source ?? null,
    input.songmid ?? null, input.quality ?? null, input.singer ?? null, input.album ?? null, input.img ?? null,
    input.mode ?? null, status, now, now,
  )
  const row = getBackupByLocalPath(input.user, input.folderType, input.localPath)!
  // 若本地文件已存在则登记到本地文件表（下载/缓存落盘后由各路径登记，此处兜底；文件尚不存在时 upsertLocalFile 自动跳过）
  try { upsertLocalFile({ user: input.user, source: input.source, folderType: input.folderType, localPath: input.localPath }) } catch { /* ignore */ }
  return row
}

export function setBackupStatus(
  id: number,
  status: BackupStatus,
  opts: { error?: string | null; size?: number | null; name?: string | null; remotePath?: string | null; retryCount?: number | null; remoteMtime?: number | null } = {},
): void {
  const db = getBackupDb()
  const sets: string[] = ['status = ?', 'updated_at = ?']
  const params: any[] = [status, Date.now()]
  if (opts.error !== undefined) { sets.push('error = ?'); params.push(opts.error) }
  if (opts.size !== undefined) { sets.push('size = ?'); params.push(opts.size) }
  if (opts.name !== undefined) { sets.push('name = ?'); params.push(opts.name) }
  if (opts.remotePath !== undefined) { sets.push('remote_path = ?'); params.push(opts.remotePath) }
  if (opts.retryCount !== undefined) { sets.push('retry_count = ?'); params.push(opts.retryCount) }
  if (opts.remoteMtime !== undefined) { sets.push('remote_mtime = ?'); params.push(opts.remoteMtime) }
  params.push(id)
  db.prepare(`UPDATE openlist_backup_files SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function getBackupByLocalPath(user: string, folderType: string, localPath: string): BackupFileRow | null {
  const db = getBackupDb()
  const row = db.prepare(
    'SELECT * FROM openlist_backup_files WHERE user = ? AND folder_type = ? AND local_path = ?',
  ).get(user, folderType, localPath) as BackupFileRow | undefined
  return row ?? null
}

export function listBackupByStatus(status: BackupStatus): BackupFileRow[] {
  const db = getBackupDb()
  return db.prepare(
    'SELECT * FROM openlist_backup_files WHERE status = ? AND deleted_at IS NULL ORDER BY updated_at ASC',
  ).all(status) as unknown as BackupFileRow[]
}

export function listAllBackups(): BackupFileRow[] {
  const db = getBackupDb()
  return db.prepare('SELECT * FROM openlist_backup_files WHERE deleted_at IS NULL ORDER BY updated_at DESC').all() as unknown as BackupFileRow[]
}

export function getBackupById(id: number): BackupFileRow | null {
  const db = getBackupDb()
  const row = db.prepare('SELECT * FROM openlist_backup_files WHERE id = ?').get(id) as BackupFileRow | undefined
  return row ?? null
}

export function listBackupsByUser(user: string): BackupFileRow[] {
  const db = getBackupDb()
  return db.prepare('SELECT * FROM openlist_backup_files WHERE user = ? AND deleted_at IS NULL ORDER BY updated_at ASC').all(user) as unknown as BackupFileRow[]
}

export function listBackupsByUserFolder(user: string, folderType: string): BackupFileRow[] {
  const db = getBackupDb()
  return db.prepare(
    'SELECT * FROM openlist_backup_files WHERE user = ? AND folder_type = ? AND deleted_at IS NULL ORDER BY updated_at ASC',
  ).all(user, folderType) as unknown as BackupFileRow[]
}

// ---------- 附件（图片/歌词等非音频，依附于媒体文件）----------

export function upsertAttachment(input: UpsertAttachmentInput): AttachmentRow {
  const db = getBackupDb()
  const now = Date.now()
  const status = input.status ?? 'pending'
  const localPath = input.localPath ?? null
  // 附件表未声明 (user, folder_type, local_path) 唯一约束，不能依赖 ON CONFLICT；改为先查后写。
  const existing = localPath ? getAttachmentByLocalPath(input.user, input.folderType, localPath) : null
  if (existing) {
    db.prepare(`UPDATE openlist_backup_attachments SET
      backup_file_id = ?, user = ?, folder_type = ?, local_path = ?, remote_path = ?,
      category = ?, size = ?, status = ?, updated_at = ?, deleted_at = NULL
      WHERE id = ?`).run(
      input.backupFileId, input.user, input.folderType, localPath, input.remotePath,
      input.category ?? 'image', input.size ?? null, status, now, existing.id)
    return getAttachmentByLocalPath(input.user, input.folderType, localPath!)!
  }
  const info = db.prepare(`INSERT INTO openlist_backup_attachments
    (backup_file_id, user, folder_type, local_path, remote_path, category, size, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    input.backupFileId, input.user, input.folderType, localPath, input.remotePath,
    input.category ?? 'image', input.size ?? null, status, now)
  const id = Number((info as any).lastInsertRowid)
  return getAttachmentByLocalPath(input.user, input.folderType, localPath!)!
}

export function setAttachmentStatus(
  id: number,
  status: AttachmentStatus,
  opts: { error?: string | null; size?: number | null } = {},
): void {
  const db = getBackupDb()
  const sets: string[] = ['status = ?', 'updated_at = ?']
  const params: any[] = [status, Date.now()]
  if (opts.error !== undefined) { sets.push('error = ?'); params.push(opts.error) }
  if (opts.size !== undefined) { sets.push('size = ?'); params.push(opts.size) }
  params.push(id)
  db.prepare(`UPDATE openlist_backup_attachments SET ${sets.join(', ')} WHERE id = ?`).run(...params)
}

export function getAttachmentByLocalPath(user: string, folderType: string, localPath: string): AttachmentRow | null {
  if (!localPath) return null
  const db = getBackupDb()
  const row = db.prepare(
    'SELECT * FROM openlist_backup_attachments WHERE user = ? AND folder_type = ? AND local_path = ?',
  ).get(user, folderType, localPath) as AttachmentRow | undefined
  return row ?? null
}

export function listAttachments(backupFileId: number): AttachmentRow[] {
  const db = getBackupDb()
  return db.prepare(
    'SELECT * FROM openlist_backup_attachments WHERE backup_file_id = ? AND deleted_at IS NULL ORDER BY updated_at ASC',
  ).all(backupFileId) as unknown as AttachmentRow[]
}

export function listAttachmentsByUser(user: string): AttachmentRow[] {
  const db = getBackupDb()
  return db.prepare(
    'SELECT * FROM openlist_backup_attachments WHERE user = ? AND deleted_at IS NULL ORDER BY updated_at ASC',
  ).all(user) as unknown as AttachmentRow[]
}

export function deleteAttachmentsForParent(backupFileId: number): void {
  const db = getBackupDb()
  db.prepare('DELETE FROM openlist_backup_attachments WHERE backup_file_id = ?').run(backupFileId)
}

/** 统计某本地路径还被多少「活跃备份/附件」引用（排除指定备份行），用于删除本地副本前判断是否安全 */
export function countRefsToLocalPath(localPath: string, excludeBackupId: number): number {
  const db = getBackupDb()
  const a = db.prepare(
    "SELECT COUNT(*) AS c FROM openlist_backup_files WHERE local_path = ? AND id != ? AND status IN ('uploading','completed','verified')",
  ).get(localPath, excludeBackupId) as any
  const b = db.prepare(
    "SELECT COUNT(*) AS c FROM openlist_backup_attachments WHERE local_path = ?",
  ).get(localPath) as any
  return (a?.c || 0) + (b?.c || 0)
}

/** 统计某本地路径还被多少「活跃（未软删除）备份/附件」引用，排除指定的备份行与附件行（用于删除本地副本前安全判断） */
export function countLocalPathRefs(localPath: string, excludeBackupId: number, excludeAttachmentId: number): number {
  const db = getBackupDb()
  const a = db.prepare(
    'SELECT COUNT(*) AS c FROM openlist_backup_files WHERE local_path = ? AND id != ? AND deleted_at IS NULL',
  ).get(localPath, excludeBackupId) as any
  const b = db.prepare(
    'SELECT COUNT(*) AS c FROM openlist_backup_attachments WHERE local_path = ? AND id != ? AND deleted_at IS NULL',
  ).get(localPath, excludeAttachmentId) as any
  return (a?.c || 0) + (b?.c || 0)
}

/** 统计某远端路径还被多少「活跃（未软删除）备份/附件」引用，排除指定行（用于删除远端文件前判断是否仍有其它记录引用同一远端文件） */
export function countRemotePathRefs(remotePath: string, excludeBackupId: number, excludeAttachmentId: number): number {
  const db = getBackupDb()
  const a = db.prepare(
    'SELECT COUNT(*) AS c FROM openlist_backup_files WHERE remote_path = ? AND id != ? AND deleted_at IS NULL',
  ).get(remotePath, excludeBackupId) as any
  const b = db.prepare(
    'SELECT COUNT(*) AS c FROM openlist_backup_attachments WHERE remote_path = ? AND id != ? AND deleted_at IS NULL',
  ).get(remotePath, excludeAttachmentId) as any
  return (a?.c || 0) + (b?.c || 0)
}

// ---------- 本地文件登记表（openlist_local_files）----------

/** 查询某用户某本地路径的未软删记录 */
export function getLocalFile(user: string, localPath: string): any | null {
  const db = getBackupDb()
  const row = db.prepare('SELECT * FROM openlist_local_files WHERE user = ? AND local_path = ? AND deleted_at IS NULL').get(user, localPath) as any
  return row ?? null
}

/** 登记/更新一条本地文件记录：stat 取得创建/修改时间、文件名、大小；文件不存在则跳过。返回是否成功登记。 */
export function upsertLocalFile(input: { user: string; source?: string | null; folderType: string; localPath: string }): boolean {
  const lp = input.localPath
  if (!lp || !fs.existsSync(lp)) return false
  let st: fs.Stats
  try { st = fs.statSync(lp) } catch { return false }
  const db = getBackupDb()
  const now = Date.now()
  const filename = path.basename(lp)
  const created = (st.birthtimeMs && st.birthtimeMs > 0 && st.birthtimeMs !== st.mtimeMs) ? st.birthtimeMs : st.mtimeMs
  const modified = st.mtimeMs
  const existing = getLocalFile(input.user, lp)
  if (existing) {
    db.prepare(`UPDATE openlist_local_files SET source = ?, folder_type = ?, filename = ?, file_created_at = ?, file_modified_at = ?, size = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`)
      .run(input.source ?? null, input.folderType, filename, created, modified, st.size, now, existing.id)
  } else {
    db.prepare(`INSERT INTO openlist_local_files (user, source, folder_type, local_path, filename, file_created_at, file_modified_at, size, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(input.user, input.source ?? null, input.folderType, lp, filename, created, modified, st.size, now, now)
  }
  return true
}

/** 某用户某本地路径是否存在未软删的本地文件登记（用于前端展示「本地是否存在」） */
export function localFileExists(user: string, localPath: string): boolean {
  return !!getLocalFile(user, localPath)
}

/** 软删除指定用户+路径的本地文件登记 */
export function softDeleteLocalFile(user: string, localPath: string): void {
  const db = getBackupDb()
  db.prepare('UPDATE openlist_local_files SET deleted_at = ? WHERE user = ? AND local_path = ? AND deleted_at IS NULL').run(Date.now(), user, localPath)
}

/** 按路径软删（不需用户上下文，供 fileCache 等通用清理调用；仅匹配未软删记录） */
export function softDeleteLocalFileByPath(localPath: string): void {
  const db = getBackupDb()
  db.prepare('UPDATE openlist_local_files SET deleted_at = ? WHERE local_path = ? AND deleted_at IS NULL').run(Date.now(), localPath)
}

/** 列出需要二次校验（已上传但未 verified）的附件 */
export function listAttachmentsToVerify(): AttachmentRow[] {
  const db = getBackupDb()
  return db.prepare("SELECT * FROM openlist_backup_attachments WHERE status IN ('uploading','completed') AND deleted_at IS NULL").all() as unknown as AttachmentRow[]
}

/** 按状态列出附件（用于卡死回收：pending / 长时间 uploading） */
export function listAttachmentsByStatus(status: string): AttachmentRow[] {
  const db = getBackupDb()
  return db.prepare('SELECT * FROM openlist_backup_attachments WHERE status = ? AND deleted_at IS NULL').all(status) as unknown as AttachmentRow[]
}
