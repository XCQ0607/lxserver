/**
 * OpenList 音频备份 / 同步管理器
 * 衔接：fileCache 落盘钩子 -> 按 per-user 配置判定是否上传 -> 上传(OpenListClient) -> 写入 SQLite。
 *
 * 四种同步模式（按「用户 + 目录」条目独立设置，字段 userBackups[].mode）：
 *  - upload-delete : 上传完成 verified 后删除本地副本，并注销缓存索引（避免应用误判本地仍在）
 *  - upload        : 仅上传，保留本地副本
 *  - sync          : 双向同步（本地新增->上传；远端新增->下载并补缓存；任一侧删除->另一侧级联；同名冲突较新者优先）
 *  - download      : 仅从 OpenList 拉取到本地并补缓存（本地为主，远端有更新时覆盖）
 *
 * 状态机：pending -> uploading -> completed -> verified（失败记 failed，删除记 deleted）。
 * 纯路径（不含域名/URL）存库，供后续定位与下载使用。
 */
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { OpenListClient, OpenListNotFoundError } from './openlistClient'
import { registerOpenListCacheFile, unregisterOpenListCacheFile, getCacheDir, getIndexItemByFilename } from '@/server/music/fileCache'
import { callUserApiGetMusicUrl } from '@/server/sources/userApi'
import { getUserDirname } from '@/user/data'
import { getUserSpace } from '@/user'
import { File } from '@/constants'
import { backupType, backupLocalPath, getBackupTypes, scanBackupFiles, beginCloudRestore, isCloudRestoreRunning } from '@/utils/backupPolicy'
import {
  ensureBackupTables,
  upsertBackupFile,
  setBackupStatus,
  getBackupByLocalPath,
  listBackupByStatus,
  listAllBackups,
  listBackupsByUserFolder,
  listAttachments,
  getAttachmentByLocalPath,
  upsertAttachment,
  setAttachmentStatus,
  listAttachmentsToVerify,
  listAttachmentsByStatus,
  getBackupById,
  getBackupDb,
  countLocalPathRefs,
  countRemotePathRefs,
  upsertLocalFile,
  softDeleteLocalFile,
  softDeleteLocalFileByPath,
  getActiveBackupLocalPaths,
  getLocalFile,
  linkAttachment,
  unlinkAttachment,
} from './openlistBackupDb'

type SyncMode = 'upload-delete' | 'upload' | 'sync' | 'download'

/** 失败自动重投的最大次数（超过后该记录保持 failed，需手动重试） */
const MAX_AUTO_RETRIES = 5
/** 单次上传内置重试次数（覆盖网络抖动 / token 过期） */
const UPLOAD_RETRY_TIMES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
/** 指数退避：1s, 2s, 4s ... 上限 8s */
function backoffMs(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** (attempt - 1))
}

interface UserBackupCfg {
  user: string
  enabled: boolean
  /** 是否备份该用户下载目录（默认 true；路径由后端自动拼接 userPath/<用户名>/music，无需手动填写） */
  backupDownload?: boolean
  /** 是否备份该用户缓存目录（默认 true；路径由后端自动拼接 userPath/<用户名>/cache） */
  backupCache?: boolean
  /** @deprecated 旧版手动填写的下载目录，仅作向后兼容；新版以 backupDownload 开关 + 自动拼接路径为准 */
  downloadDir?: string
  /** @deprecated 旧版手动填写的缓存目录，仅作向后兼容 */
  cacheDir?: string
  /** 是否备份该用户歌单快照目录（list/snapshot）；默认 true */
  backupSnapshot?: boolean
  mode?: SyncMode
}

interface BackupConfig {
  enable: boolean
  endpoint: string
  username: string
  password: string
  token: string
  root: string
  keepLocalAfterUpload: boolean
  verifyInterval: number
  includeNonAudio: boolean
  syncInterval: number
  externalUrl: string
  backupSystemConfig: boolean
  userBackups: UserBackupCfg[]
}

const AUDIO_EXT = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'ape', 'opus', 'wma', 'alac', 'dsf', 'dff', 'tta', 'wv']
const NON_AUDIO_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'heic', 'avif', 'jpe', 'tif', 'tiff', 'lrc', 'txt']

function getConfig(): BackupConfig {
  const c: any = (globalThis as any).lx?.config || {}
  return {
    enable: !!c['openlist.enable'],
    endpoint: normalizeTrailingSlash(c['openlist.endpoint'] || ''),
    username: c['openlist.username'] || '',
    password: c['openlist.password'] || '',
    token: c['openlist.token'] || '',
    root: c['openlist.root'] || '/lx_music',
    keepLocalAfterUpload: c['openlist.keepLocalAfterUpload'] !== false,
    verifyInterval: Number(c['openlist.verifyInterval'] || 5),
    includeNonAudio: c['openlist.includeNonAudio'] === true,
    syncInterval: Number(c['openlist.syncInterval'] || 60),
    externalUrl: normalizeTrailingSlash(String(c['openlist.externalUrl'] || c['openlist.endpoint'] || '')),
    backupSystemConfig: c['openlist.backupSystemConfig'] === true,
    userBackups: parseUserBackups(c['openlist.userBackups']),
  }
}

function parseUserBackups(raw: any): UserBackupCfg[] {
  if (!raw) return []
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(arr) ? (arr as UserBackupCfg[]) : []
  } catch {
    return []
  }
}

/** 去掉结尾斜杠（兼容用户误填的 / 或 \），用于规范化 externalUrl */
const normalizeTrailingSlash = (u: string) => u.replace(/[\\/]+$/, '')

/** 解析条目的有效模式：显式 mode 优先；否则沿用全局 keepLocalAfterUpload 的语义 */
function effectiveMode(entry: UserBackupCfg, cfg: BackupConfig): SyncMode {
  if (entry.mode) return entry.mode
  return cfg.keepLocalAfterUpload === false ? 'upload-delete' : 'upload'
}

/** 从已有备份行推断其模式（用于验证/删除环节） */
function effectiveModeFromRow(row: any, cfg: BackupConfig): SyncMode {
  if (row.folder_type === 'data') return 'upload'
  const entry = cfg.userBackups.find(u => u.user === row.user && u.enabled)
  if (entry) return effectiveMode(entry, cfg)
  if (row.mode) return row.mode as SyncMode
  return cfg.keepLocalAfterUpload === false ? 'upload-delete' : 'upload'
}

function normalizeUser(u?: string): string {
  return (u && u !== '_open' && u !== 'default') ? u : '_open'
}

function isAudio(name: string): boolean {
  const ext = (path.extname(name).split('.').pop() || '').toLowerCase()
  return AUDIO_EXT.includes(ext)
}

function categoryOf(ext: string): 'image' | 'lyric' | 'other' {
  const e = ext.toLowerCase()
  if (['lrc', 'txt'].includes(e)) return 'lyric'
  if (NON_AUDIO_EXT.includes(e)) return 'image'
  return 'other'
}

/** 将 OpenList 的 modified 字符串解析为毫秒时间戳；无法解析则返回 null */
function parseMod(e?: string): number | null {
  if (!e) return null
  const t = Date.parse(e)
  return Number.isNaN(t) ? null : t
}

let client: OpenListClient | null = null
let clientSig = ''
let verifyTimer: ReturnType<typeof setInterval> | null = null
let verifyRunning = false
let syncTimer: ReturnType<typeof setInterval> | null = null
let schedulerSignature = ''
let syncJob: Promise<SyncSummary> | null = null
let manualTransfers = 0

function hashFile(localPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex')
}

function folderEnabled(user: string, folder: string, cfg = getConfig()): boolean {
  const entry = cfg.userBackups.find(u => u.user === user && u.enabled)
  if (!entry) return user === '_system' && cfg.backupSystemConfig
  return folder === 'cache' ? ((global.lx.config as any)['backup.openlist.types'] !== undefined ? entry.backupCache === true : entry.backupCache !== false) : folder === 'music' ? entry.backupDownload !== false : entry.backupSnapshot !== false
}

function rowEnabled(row: any, cfg = getConfig()): boolean {
  if (row.folder_type === 'data') {
    const relative = row.remote_path.split('/_data/')[1]
    const type = relative ? backupType(relative) : null
    return cfg.enable && row.user === '_system' && !!type && getBackupTypes('openlist', global.lx.config as any).includes(type)
  }
  // 启用统一数据备份后，不再执行旧音乐/快照记录的上传即删策略。
  if ((global.lx.config as any)['backup.openlist.types'] !== undefined && row.folder_type !== 'cache') return false
  return cfg.enable && folderEnabled(row.user, row.folder_type, cfg)
}

function getClient(): OpenListClient | null {
  const cfg = getConfig()
  if (!cfg.enable || !cfg.endpoint) { client = null; clientSig = ''; return null }
  // 按配置签名缓存客户端：签名未变时复用，变化时才重建
  const sig = [cfg.endpoint, cfg.username, cfg.password, cfg.token, cfg.root].join('|')
  if (client && clientSig === sig) return client
  client = new OpenListClient({
    endpoint: cfg.endpoint,
    username: cfg.username,
    password: cfg.password,
    token: cfg.token,
    root: cfg.root,
  })
  clientSig = sig
  return client
}

/**
 * 解析某用户某目录类型的实际备份目录：
 *  - 对应开关（backupDownload/backupCache）显式为 false → 返回 null，表示不备份该目录；
 *  - 旧版显式填写的 downloadDir/cacheDir 若存在则继续沿用（向后兼容）；
 *  - 否则复用 fileCache.getCacheDir，得到应用真正写入缓存/下载文件的目录（与本地结构一致）。
 *    注意：缓存/下载目录不一定在 dataPath 下，可能位于运行目录（如 /server/cache/<user>）或
 *    data 根（data/cache/<user>），必须以应用自身的目录解析为准，不能自行拼接。
 */
function resolveSnapshotDir(user: string): string {
  const backupPathConf = ((global.lx.config as any)['snapshot.backupPath'] || '').trim()
  let dir: string
  if (backupPathConf) {
    const base = path.isAbsolute(backupPathConf) ? backupPathConf : path.join(global.lx.dataPath, backupPathConf)
    dir = path.join(base, user, File.listSnapshotDir)
  } else {
    const userDir = path.join(global.lx.userPath, getUserDirname(user))
    dir = path.join(userDir, File.listDir, File.listSnapshotDir)
  }
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  return dir
}

function resolveUserDir(entry: UserBackupCfg, folderType: 'cache' | 'music' | 'list', _cfg: BackupConfig): string | null {
  if (folderType === 'list') {
    if (entry.backupSnapshot === false) return null
    return resolveSnapshotDir(entry.user)
  }
  if (folderType === 'music' && entry.backupDownload === false) return null
  if (folderType === 'cache' && entry.backupCache === false) return null
  if (folderType === 'cache' && (global.lx.config as any)['backup.openlist.types'] !== undefined && entry.backupCache !== true) return null
  const legacy = folderType === 'music' ? entry.downloadDir : entry.cacheDir
  if (legacy && fs.existsSync(legacy)) return legacy
  try {
    return getCacheDir(entry.user, folderType === 'music')
  } catch {
    return null
  }
}

function isSubPath(child: string, parent: string): boolean {
  const np = path.normalize(parent)
  const nc = path.normalize(child)
  return nc === np || nc.startsWith(np + path.sep)
}

// ---------- 缓存索引联动 ----------

/** 删除本地文件时注销缓存条目，避免应用误判本地文件仍存在 */
function removeLocalCache(row: { user: string; folder_type: string; songmid: string | null; quality: string | null }): void {
  const uid = normalizeUser(row.user)
  if (row.songmid) {
    unregisterOpenListCacheFile(uid, row.songmid, row.folder_type as 'cache' | 'music', row.quality || undefined)
  }
}

/**
 * 下载/同步把远端文件落到本地后，登记为缓存条目，使应用能当作缓存文件使用。
 * 以「文件名(去扩展名)」作为缓存 id（v1 最佳努力；若远端文件名遵循命名约定则可被正确匹配）。
 * 返回用于回填备份行的 songmid。
 */
function registerDownloadedCache(user: string, folderType: 'cache' | 'music', localPath: string): string {
  const base = path.basename(localPath)
  const ext = path.extname(base)
  const row = getBackupByLocalPath(user, folderType, localPath)
  let metadata: any = {}
  try { metadata = JSON.parse(row?.cache_metadata || '{}') } catch { /* 旧记录无元数据 */ }
  // 优先使用上传记录里的规范化歌曲 ID，避免以文件名生成的缓存键无法匹配
  const id = (row && row.songmid) ? row.songmid : base.slice(0, Math.max(0, base.length - ext.length))
  let size = 0
  let mtime = Date.now()
  try {
    const st = fs.statSync(localPath)
    size = st.size
    mtime = st.mtimeMs
  } catch { /* ignore */ }
  registerOpenListCacheFile(normalizeUser(user), {
    id,
    songmid: id,
    ...metadata,
    name: metadata.name || id,
    singer: metadata.singer || '',
    album: metadata.album || '',
    albumId: metadata.albumId || '',
    img: metadata.img || '',
    interval: metadata.interval || 0,
    // source 与 quality 均从 openlist_backup_files 回填（上传时已持久化原始音源平台与音质），
    // 恢复后的缓存条目同时保留准确来源与音质，供按平台解析与精确音质检索的请求使用
    source: row?.source || '',
    requestedSource: metadata.requestedSource || '',
    downloadSource: metadata.downloadSource || '',
    sourceName: metadata.sourceName || '',
    origin: 'openlist',
    quality: row?.quality || 'unknown',
    filename: path.relative(getCacheDir(user, folderType === 'music'), localPath).replace(/\\/g, '/'),
    folder: folderType,
    mtime,
    size,
    ext: ext.replace('.', ''),
    hasCover: metadata.hasCover || false,
    hasLyric: metadata.hasLyric || false,
    audioContainer: metadata.audioContainer || '',
    bitrate: metadata.bitrate || 0,
    sampleRate: metadata.sampleRate || 0,
    bitDepth: metadata.bitDepth || 0,
    nativeIds: metadata.nativeIds,
  }, folderType)
  return id
}

// ---------- 上传（含附件）----------

/**
 * 本地源文件缺失时，按记录中保存的 source/songmid/quality 从音源重新拉取音频到 local_path。
 * 缓存目录为容器临时层（重启/重建会清空），文件可能在上传前被清理；此函数使上传具备自愈能力。
 * 无法重拉（缺元信息或音源不可达）时返回 false。
 */
async function refetchLocalFile(row: any): Promise<boolean> {
  if (!row.local_path || !row.source || !row.songmid) return false
  try {
    const base = row.name
      ? String(row.name).replace(/\.[^.]+$/, '')
      : path.basename(row.local_path, path.extname(row.local_path))
    const songInfo: any = { source: row.source, songmid: row.songmid, name: base, songname: base, singer: '' }
    const r = await callUserApiGetMusicUrl(row.source, songInfo, row.quality || 'flac', row.user)
    if (!r || !r.url) return false
    fs.mkdirSync(path.dirname(row.local_path), { recursive: true })
    const resp = await fetch(r.url, { signal: AbortSignal.timeout(300000) })
    if (!resp.ok) return false
    const buf = Buffer.from(await resp.arrayBuffer())
    fs.writeFileSync(row.local_path, buf)
    upsertLocalFile({ user: row.user, source: row.source, folderType: row.folder_type, localPath: row.local_path })
    return fs.existsSync(row.local_path)
  } catch {
    return false
  }
}

async function uploadOne(row: any, cl: OpenListClient, mode: SyncMode, retries = UPLOAD_RETRY_TIMES): Promise<boolean> {
  if (!rowEnabled(row) || getBackupById(row.id)?.deleted_at) return false
  // 本地源文件缺失时尝试按源重新拉取（缓存被清理 / 容器重建导致丢失 -> ENOENT 自愈）
  if (!row.local_path || !fs.existsSync(row.local_path)) {
    const ok = await refetchLocalFile(row)
    if (!ok) {
      setBackupStatus(row.id, 'failed', {
        error: '本地源文件已不存在且无法从音源重新下载（缓存已被清理），请重新播放该歌曲后再试',
        retryCount: (row.retry_count || 0) + 1,
      })
      return false
    }
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      setBackupStatus(row.id, 'uploading')
      const before = fs.statSync(row.local_path)
      const localHash = hashFile(row.local_path)
      await cl.mkdir(path.posix.dirname(row.remote_path))
      const info = await cl.upload(row.local_path, row.remote_path)
      const after = fs.statSync(row.local_path)
      if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || localHash !== hashFile(row.local_path) || info.size !== after.size) {
        throw new Error('上传期间本地文件发生变化或远端大小不一致，保留本地文件')
      }
      if (getBackupById(row.id)?.deleted_at) return false
      setBackupStatus(row.id, 'completed', {
        size: info.size,
        name: row.folder_type === 'data' ? row.name : info.name || path.basename(row.remote_path),
        remotePath: row.remote_path,
        localMtime: after.mtimeMs,
        localHash,
        remoteMtime: parseMod(info.modified),
        error: null,
      })
      return true
    } catch (e: any) {
      if (attempt >= retries) {
        setBackupStatus(row.id, 'failed', { error: String(e?.message || e), retryCount: (row.retry_count || 0) + 1 })
        return false
      }
      await sleep(backoffMs(attempt))
    }
  }
  return false
}

/**
 * 单文件从远端下载到本地（download / sync 模式），并补登记缓存索引。
 * 与 uploadOne 对称，失败记为 failed（带重试计数）。
 */
async function downloadOne(row: any, cl: OpenListClient, mode: SyncMode): Promise<boolean> {
  if (!rowEnabled(row) || getBackupById(row.id)?.deleted_at) return false
  try {
    setBackupStatus(row.id, 'uploading')
    fs.mkdirSync(path.dirname(row.local_path), { recursive: true })
    await cl.download(row.remote_path, row.local_path)
    const info = await cl.getFileInfo(row.remote_path)
    upsertLocalFile({ user: row.user, source: row.source, folderType: row.folder_type, localPath: row.local_path })
    const isAud = isAudio(row.local_path)
    let size = 0
    try { size = fs.statSync(row.local_path).size } catch { /* ignore */ }
    if (isAud) {
      const id = registerDownloadedCache(row.user, row.folder_type, row.local_path)
      setBackupStatus(row.id, 'verified', { size, remotePath: row.remote_path })
      await downloadAttachmentsForFile(row, cl)
    } else if (row.folder_type === 'list') {
      setBackupStatus(row.id, 'verified', { size, remotePath: row.remote_path })
      try { getUserSpace(row.user).listManage.snapshotDataManage.updateSnapshotDir() } catch { /* ignore */ }
    } else {
      setBackupStatus(row.id, 'completed', { size, remotePath: row.remote_path })
    }
    setBackupStatus(row.id, 'verified', { size, remoteMtime: parseMod(info.modified), localMtime: fs.statSync(row.local_path).mtimeMs, localHash: hashFile(row.local_path), error: null, retryCount: 0 })
    return true
  } catch (e: any) {
    setBackupStatus(row.id, 'failed', { error: String(e?.message || e), retryCount: (row.retry_count || 0) + 1 })
    return false
  }
}

/**
 * 单文件恢复时，按 backup_file_id 把关联附件（封面/歌词等）一并下载到音频旁。
 * 仅在附件记录存在时生效（上传侧需 openlist.includeNonAudio 才会登记附件），默认无副作用。
 * 已存在的本地附件直接登记、跳过下载，保证幂等。
 */
async function downloadAttachmentsForFile(row: any, cl: OpenListClient): Promise<void> {
  let atts: any[] = []
  try { atts = listAttachments(row.id) } catch { return }
  if (!atts.length) return
  const audioDir = path.dirname(row.local_path)
  for (const att of atts) {
    if (!att.remote_path) continue
    const localPath = att.local_path && path.isAbsolute(att.local_path)
      ? att.local_path
      : path.join(audioDir, path.basename(att.remote_path))
    try {
      if (!fs.existsSync(localPath)) {
        fs.mkdirSync(path.dirname(localPath), { recursive: true })
        await cl.download(att.remote_path, localPath)
      }
      upsertLocalFile({ user: row.user, source: row.source, folderType: row.folder_type, localPath })
      setAttachmentStatus(att.id, 'verified')
    } catch (e: any) {
      // 附件失败不应阻断主音频恢复
      console.warn('[openlist-backup] 附件恢复失败:', att.remote_path, e?.message || e)
    }
  }
}

/** 是否「缓存优先 + 优先使用 OpenList」：两者同时开启才走 OpenList 直链/取回 */
export function isOpenlistCacheFirstEnabled(): boolean {
  const c: any = (globalThis as any).lx?.config
  if (!c) return false
  if (c['subsonic.playCacheFirst'] === false) return false
  return c['subsonic.playCacheFirstUseOpenlist'] === true
}

/** 在 OpenList 备份中按「确定性缓存文件名 base」匹配 verified/completed 记录 */
function findOpenlistBackupRow(user: string, folderType: 'cache' | 'music', baseName: string): any | null {
  const rows = listBackupsByUserFolder(user, folderType)
  for (const row of rows) {
    if (row.status !== 'verified' && row.status !== 'completed') continue
    if (!row.remote_path) continue
    const rowBase = path.basename(row.local_path, path.extname(row.local_path))
    if (rowBase !== baseName) continue
    return row
  }
  return null
}

/**
 * 缓存未命中时，先查 OpenList 是否已有该文件的 verified 备份；有则直接取回到缓存目录并登记，
 * 跳过原始平台的回源下载与重新上传（环路/带宽规避）。按「缓存路径 base」匹配（缓存路径是确定性的）。
 * 命中返回 { size }，未命中/禁用/失败返回 null（调用方继续走原始下载）。
 */
export async function tryRestoreFromOpenlist(
  user: string,
  folderType: 'cache' | 'music',
  dir: string,
  baseName: string,
  quality: string,
  signal?: AbortSignal,
): Promise<{ size: number } | null> {
  const cfg = getConfig()
  if (!cfg.enable || !isOpenlistCacheFirstEnabled() || !folderEnabled(user, folderType, cfg)) return null
  const row = findOpenlistBackupRow(user, folderType, baseName)
  if (!row) return null
  try {
    const cl = getClient()
    if (!cl) return null
    const ext = path.extname(row.local_path) || path.extname(row.remote_path) || ''
    const finalPath = path.join(dir, baseName + ext)
    // 自定义目标目录不应复用另一目录的索引或附件绝对路径。
    if (path.resolve(finalPath) !== path.resolve(row.local_path)) return null
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    await cl.download(row.remote_path, finalPath, signal)
    if (signal?.aborted) return null
    upsertLocalFile({ user, source: row.source, folderType, localPath: finalPath })
    registerDownloadedCache(user, folderType, finalPath)
    await downloadAttachmentsForFile(row, cl)
    let size = 0
    try { size = fs.statSync(finalPath).size } catch { /* ignore */ }
    return { size }
  } catch (e: any) {
    console.warn('[openlist-backup] 缓存未命中时从 OpenList 取回失败:', row.remote_path, e?.message || e)
    return null
  }
}

/**
 * 缓存未命中且开启「优先使用 OpenList」时，返回该文件的最佳直链给客户端：
 *  - 网盘支持直链（raw_url 存在）→ 返回网盘直链
 *  - 否则用外网 url 拼接 /d/<remote_path>（外网 url 缺省等于内网 endpoint）
 * 未匹配/未开启/失败返回 null（调用方继续走原始回源）。
 */
export async function resolveOpenlistCacheEntry(
  user: string,
  folderType: 'cache' | 'music',
  baseName: string,
  song?: { id: string; source: string; quality: string },
): Promise<{ url: string; filename: string; quality: string } | null> {
  const cfg = getConfig()
  if (!cfg.enable) return null
  if (!folderEnabled(user, folderType, cfg)) return null
  if (!isOpenlistCacheFirstEnabled()) return null
  const row = song ? listBackupsByUserFolder(user, folderType).find(r =>
    ['verified', 'completed'].includes(r.status) && r.songmid === song.id && r.source === song.source && r.quality === song.quality,
  ) || findOpenlistBackupRow(user, folderType, baseName) : findOpenlistBackupRow(user, folderType, baseName)
  if (!row) return null
  try {
    const cl = getClient()
    if (!cl) return null
    const info = await cl.getFileInfo(row.remote_path)
    const filename = path.basename(row.remote_path)
    if (info?.rawUrl) return { url: info.rawUrl, filename, quality: row.quality || song?.quality || 'unknown' }
    const base = normalizeTrailingSlash(cfg.externalUrl || cfg.endpoint || '')
    if (!base) return null
    const p = row.remote_path.replace(/^\/+/, '')
    return { url: `${base}/d/${p.split('/').map((s: string) => encodeURIComponent(s)).join('/')}`, filename, quality: row.quality || song?.quality || 'unknown' }
  } catch {
    return null
  }
}

export async function resolveOpenlistCacheDirectUrl(user: string, folder: 'cache' | 'music', baseName: string): Promise<string | null> {
  return (await resolveOpenlistCacheEntry(user, folder, baseName))?.url || null
}

async function uploadAttachment(att: any, cl: OpenListClient): Promise<void> {
  if (!folderEnabled(att.user, att.folder_type)) return
  try {
    setAttachmentStatus(att.id, 'uploading')
    if (att.local_path && fs.existsSync(att.local_path)) {
      await cl.mkdir(path.posix.dirname(att.remote_path))
      const info = await cl.upload(att.local_path, att.remote_path)
      setAttachmentStatus(att.id, 'completed', { size: info.size })
    }
    const v = await cl.getFileInfo(att.remote_path)
    if (v && v.size != null) setAttachmentStatus(att.id, 'verified', { size: v.size })
  } catch (e: any) {
    setAttachmentStatus(att.id, 'failed', { error: String(e?.message || e) })
  }
}

// ---------- 并发上传队列 ----------
// 播放整张歌单会瞬间触发数十个上传，直接并发会把 OpenList（云盘挂载）打挂导致大量 hang。
// 这里限制同时进行的上传数量，失败/完成后自动推进下一个；并用 enqueuedIds 防止重复入队。
const MAX_CONCURRENT_UPLOADS = 2
const uploadQueue: Array<{ kind: 'file' | 'att'; id: number; row: any; cl: OpenListClient; mode?: SyncMode }> = []
const enqueuedIds = new Set<string>()
let activeUploads = 0

function enqueueUpload(row: any, cl: OpenListClient, mode: SyncMode): void {
  const key = `f:${row.id}`
  if (enqueuedIds.has(key)) return
  enqueuedIds.add(key)
  uploadQueue.push({ kind: 'file', id: row.id, row, cl, mode })
  pumpUploads()
}

function enqueueAttachment(att: any, cl: OpenListClient): void {
  const key = `a:${att.id}`
  if (enqueuedIds.has(key)) return
  enqueuedIds.add(key)
  uploadQueue.push({ kind: 'att', id: att.id, row: att, cl })
  pumpUploads()
}

function pumpUploads(): void {
  while (activeUploads < MAX_CONCURRENT_UPLOADS && uploadQueue.length) {
    const job = uploadQueue.shift()!
    activeUploads++
    void (async () => {
      try {
        if (job.kind === 'file') await uploadOne(job.row, job.cl, job.mode!)
        else await uploadAttachment(job.row, job.cl)
      } catch {
        /* uploadOne/uploadAttachment 内部已记录状态 */
      } finally {
        enqueuedIds.delete(job.kind === 'file' ? `f:${job.id}` : `a:${job.id}`)
        activeUploads--
        pumpUploads()
      }
    })()
  }
}

/** 上传音频时，扫描其所在目录的图片/歌词等非音频文件，作为该媒体文件的附件一并上传 */
function queueAttachmentsForFile(
  user: string,
  folderType: 'cache' | 'music',
  audioLocalPath: string,
  parentRow: any,
  dir: string,
  cl: OpenListClient,
  cfg: BackupConfig,
): void {
  if (!cfg.includeNonAudio) return
  const audioDir = path.dirname(audioLocalPath)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(audioDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    const ext = (path.extname(e.name).split('.').pop() || '').toLowerCase()
    if (!NON_AUDIO_EXT.includes(ext)) continue
    const audioStem = path.basename(audioLocalPath, path.extname(audioLocalPath)).toLowerCase()
    const stem = path.basename(e.name, path.extname(e.name)).toLowerCase()
    // 同名歌词/封面属于该音频；只有明确约定的目录封面才允许共享。
    if (stem !== audioStem && !(['cover', 'folder', 'front'].includes(stem) && categoryOf(ext) === 'image')) continue
    if (e.name === path.basename(audioLocalPath)) continue
    const full = path.join(audioDir, e.name)
    const rel = path.relative(dir, full).replace(/\\/g, '/')
    const remotePath = cl.resolveRemotePath(`${user}/${folderType}/${rel}`)
    const existing = getAttachmentByLocalPath(user, folderType, full)
    if (existing && ['uploading', 'completed', 'verified'].includes(existing.status) && !existing.deleted_at && existing.size === fs.statSync(full).size) {
      linkAttachment(parentRow.id, existing.id)
      continue
    }
    const att = upsertAttachment({
      backupFileId: parentRow.id,
      user,
      folderType,
      localPath: full,
      remotePath,
      category: categoryOf(ext),
    })
    enqueueAttachment(att, cl)
  }
}

// ---------- 落盘钩子（事件驱动上传）----------

/**
 * 由 fileCache 在音频文件写入并登记索引后调用。
 * 仅对包含「本地->远端」上传语义的模式（upload-delete/upload/sync）生效；download 模式不回推本地文件。
 */
export function onFileCached(
  user: string,
  folderType: 'cache' | 'music',
  localPath: string,
  meta: { source?: string; songmid?: string; quality?: string; origin?: 'openlist' | 'platform' | 'local' } = {},
): void {
  const cfg = getConfig()
  if (!cfg.enable) return
  if ((global.lx.config as any)['backup.openlist.types'] !== undefined && folderType === 'music') return
  if (!folderEnabled(user, folderType, cfg)) return
  // 来自 OpenList 回写的文件（独立字段 origin='openlist'）禁止再次回推，杜绝回写环路
  if (meta.origin === 'openlist') return
  const entry = cfg.userBackups.find((u) => u.user === user && u.enabled)
  if (!entry) return
  const dir = resolveUserDir(entry, folderType, cfg)
  if (!dir || !isSubPath(localPath, dir)) return

  const mode = effectiveMode(entry, cfg)
  if (mode === 'download') return

  const cl = getClient()
  if (!cl) return
  ensureBackupTables()

  const relative = path.relative(dir, localPath).replace(/\\/g, '/')
  const remotePath = cl.resolveRemotePath(`${user}/${folderType}/${relative}`)

  const existing = getBackupByLocalPath(user, folderType, localPath)
  if (existing && !existing.deleted_at && (['uploading', 'completed'].includes(existing.status) || (existing.status === 'verified' && !localChanged(existing)))) {
    return
  }

  const item = getIndexItemByFilename(path.basename(localPath), user)
  const row = upsertBackupFile({
    user,
    folderType,
    localPath,
    remotePath,
    source: meta.source || null,
    songmid: meta.songmid || null,
    quality: meta.quality || null,
    mode,
    status: 'pending',
    direction: 'upload',
    cacheMetadata: item ? JSON.stringify(item) : existing?.cache_metadata,
  })
  void enqueueUpload(row, cl, mode)
  if (cfg.includeNonAudio) {
    queueAttachmentsForFile(user, folderType, localPath, row, dir, cl, cfg)
  }
  lazyStartScheduler()
}

/**
 * 订阅通用「文件落盘」事件（由 fileCache 在音频写入后发出，事件本身与 openlist 无关），
 * 落盘即排程一次防抖全量同步。这样 fileCache 不直接依赖 openlist 实现，仅发中性事件。
 */
export function registerFileCacheSyncHook(): void {
  const lx = (globalThis as any).lx
  if (!lx || lx.openlistCacheHooksRegistered) return
  lx.openlistCacheHooksRegistered = true
  ;(lx.fileCachedListeners ??= []).push((info: { dir?: string }) => {
    const selectedData = lx.config?.['backup.openlist.types'] !== undefined
    // 播放缓存落盘已经由专用上传钩子处理，不要每播放一首歌就全盘扫描数据备份。
    if (!selectedData || info.dir && isSubPath(path.resolve(info.dir), path.resolve(lx.dataPath, 'music'))) lx.scheduleOpenlistSync?.()
  })
  ;(lx.fileCachedUploadListeners ??= []).push((info: any) => {
    onFileCached(info.user, info.folderType, info.localPath, info.meta)
  })
  // 以下为 fileCache 反向调用的统一出口，避免 fileCache 直接 import openlist 模块
  lx.cacheRestoreResolver = (user: string, folderType: 'cache' | 'music', dir: string, baseName: string, quality: string, signal?: AbortSignal) =>
    tryRestoreFromOpenlist(user, folderType, dir, baseName, quality, signal)
  lx.softDeleteLocalFileByPath = (localPath: string) => { if (getConfig().enable) softDeleteLocalFileByPath(localPath) }
  lx.getActiveBackupLocalPaths = () => {
    const cfg = getConfig()
    if (!cfg.enable) return new Set()
    const paths = getActiveBackupLocalPaths(MAX_AUTO_RETRIES)
    return new Set(listAllBackups().filter(row => rowEnabled(row, cfg) && paths.has(row.local_path)).map(row => row.local_path))
  }
}

// ---------- 验证轮询（确认网盘已落库，并按模式决定删本地/补缓存）----------

export async function verifyPending(): Promise<void> {
  if (verifyRunning || syncJob || manualTransfers || isCloudRestoreRunning()) return
  verifyRunning = true
  try {
    const cl = getClient()
    if (!cl) return
    const cfg = getConfig()
    const rows = [...listBackupByStatus('completed'), ...listBackupByStatus('uploading'), ...listBackupByStatus('verified')]
    for (const row of rows) {
      if (!rowEnabled(row, cfg) || enqueuedIds.has(`f:${row.id}`)) continue
      try {
        const info = await cl.getFileInfo(row.remote_path)
        if (row.status === 'verified' && !(effectiveModeFromRow(row, cfg) === 'upload-delete' && fs.existsSync(row.local_path))) {
          // 保留同步基线；远端变化应由同步引擎处理，不能在此覆盖基线。
          setBackupStatus(row.id, 'verified', { error: info.size === row.size ? null : '远端文件大小发生变化，等待同步确认' })
          continue
        }
        if (info && info.size != null) {
          // 仅当远端大小与本地文件一致时才确认上传成功，避免仅凭路径存在误判
          let sizeMatch = row.size != null && row.size === info.size
          if (row.local_path && fs.existsSync(row.local_path)) {
            try { sizeMatch = sizeMatch && !!row.local_hash && hashFile(row.local_path) === row.local_hash } catch { sizeMatch = false }
          }
          if (!sizeMatch) {
            setBackupStatus(row.id, 'failed', { error: '上传校验不一致，保留本地文件并重新上传', retryCount: (row.retry_count || 0) + 1 })
            continue
          }
          const mode = effectiveModeFromRow(row, cfg)
          if (mode === 'upload-delete' && row.local_path && fs.existsSync(row.local_path)) {
            if (!row.local_hash || !await cl.verifyFile(row.remote_path, row.local_hash) || hashFile(row.local_path) !== row.local_hash) {
              setBackupStatus(row.id, 'failed', { error: '远端内容校验失败，保留本地文件', retryCount: (row.retry_count || 0) + 1 })
              continue
            }
          }
          if (!rowEnabled(row) || getBackupById(row.id)?.deleted_at) continue
          setBackupStatus(row.id, 'verified', { size: info.size, remotePath: row.remote_path, remoteMtime: parseMod(info.modified), error: null, retryCount: 0 })
          if (mode === 'upload-delete' && row.local_path && fs.existsSync(row.local_path)) {
            try {
              fs.unlinkSync(row.local_path)
              removeLocalCache(row)
              softDeleteLocalFile(row.user, row.local_path)
              // 级联删除本地附件：仅当该附件自身已 verified 且未被其它备份引用时（避免附件仍在上传中被误删）
              for (const a of listAttachments(row.id)) {
                if (a.status === 'verified' && a.local_path && fs.existsSync(a.local_path) && countLocalPathRefs(a.local_path, row.id, a.id) === 0) {
                  try { fs.unlinkSync(a.local_path); softDeleteLocalFile(row.user, a.local_path) } catch { /* ignore */ }
                }
              }
            } catch { /* ignore */ }
          }
        }
      } catch (e: any) {
        const missingDataBackup = row.folder_type === 'data' && e instanceof OpenListNotFoundError && fs.existsSync(row.local_path)
        setBackupStatus(row.id, missingDataBackup ? 'failed' : row.status, { error: String(e?.message || e) })
      }
    }
    // 失败自动重投（限次，超过 MAX_AUTO_RETRIES 后保持 failed，由用户手动重试）
    for (const row of listBackupByStatus('failed')) {
      if (!rowEnabled(row, cfg)) continue
      if ((row.retry_count || 0) >= MAX_AUTO_RETRIES) continue
      const mode = effectiveModeFromRow(row, cfg)
      try {
        if (row.direction === 'download' || mode === 'download') {
          if (row.local_path) await downloadOne(row, cl, mode)
        } else {
          // 不再以「本地文件存在」为门禁：本地缺失时 uploadOne 会尝试按源重拉（缓存被清理/容器重建丢失的自愈）
          enqueueUpload(row, cl, mode)
        }
      } catch { /* ignore */ }
    }
    // 卡死回收：重启/并发打挂导致的 pending 或长时间 uploading 孤儿记录，重新入队重试
    const STALE_MS = 10 * 60 * 1000
    const now = Date.now()
    for (const row of listBackupByStatus('pending')) {
      if (!rowEnabled(row, cfg)) continue
      if (row.direction === 'download') await downloadOne(row, cl, effectiveModeFromRow(row, cfg))
      else enqueueUpload(row, cl, effectiveModeFromRow(row, cfg))
    }
    for (const row of listBackupByStatus('uploading')) {
      if (!rowEnabled(row, cfg) || enqueuedIds.has(`f:${row.id}`)) continue
      if (now - (row.updated_at || 0) > STALE_MS) {
        if (row.direction === 'download') await downloadOne(row, cl, effectiveModeFromRow(row, cfg))
        else enqueueUpload(row, cl, effectiveModeFromRow(row, cfg))
      }
    }
    for (const att of listAttachmentsByStatus('pending')) if (folderEnabled(att.user, att.folder_type, cfg)) enqueueAttachment(att, cl)
    for (const att of listAttachmentsByStatus('uploading')) {
      if (!folderEnabled(att.user, att.folder_type, cfg)) continue
      if (now - (att.updated_at || 0) > STALE_MS) enqueueAttachment(att, cl)
    }

    // 附件二次校验
    for (const att of listAttachmentsToVerify()) {
      if (!folderEnabled(att.user, att.folder_type) || enqueuedIds.has(`a:${att.id}`)) continue
      try {
        const info = await cl.getFileInfo(att.remote_path)
        if (info && info.size != null && info.size === att.size) setAttachmentStatus(att.id, 'verified', { size: info.size, error: null })
      } catch { /* ignore */ }
    }
    // 附件往往晚于音频完成上传，不能只在音频第一次 verified 时清理。
    for (const row of listBackupByStatus('verified')) {
      if (!rowEnabled(row, cfg) || effectiveModeFromRow(row, cfg) !== 'upload-delete' || fs.existsSync(row.local_path)) continue
      for (const att of listAttachments(row.id)) {
        if (att.status !== 'verified' || !att.local_path || !fs.existsSync(att.local_path) || countLocalPathRefs(att.local_path, row.id, att.id) > 0) continue
        const hash = hashFile(att.local_path)
        if (await cl.verifyFile(att.remote_path, hash) && fs.existsSync(att.local_path) && hashFile(att.local_path) === hash) {
          fs.unlinkSync(att.local_path)
          softDeleteLocalFile(row.user, att.local_path)
        }
      }
    }
  } catch (e) {
    console.warn('[openlist-backup] 验证轮询出错:', e)
  } finally {
    verifyRunning = false
  }
}

function lazyStartScheduler(): void {
  startVerifyScheduler()
}

export function startVerifyScheduler(): void {
  const cfg = getConfig()
  const signature = JSON.stringify([cfg.enable, cfg.verifyInterval, cfg.syncInterval])
  if (signature === schedulerSignature) return
  stopVerifyScheduler()
  schedulerSignature = signature
  if (!cfg.enable) return
  const delay = (minutes: number, fallback: number) => Number.isFinite(minutes) && minutes > 0 ? Math.min(2147483647, Math.max(60000, minutes * 60000)) : fallback * 60000
  verifyTimer = setInterval(() => { void verifyPending() }, delay(cfg.verifyInterval, 5))
  syncTimer = setInterval(() => { void runSyncNow().catch(e => console.warn('[OpenList] 定时同步失败:', e)) }, delay(cfg.syncInterval, 60))
  verifyTimer.unref()
  syncTimer.unref()
  void verifyPending()
}

export function stopVerifyScheduler(): void {
  if (verifyTimer) {
    clearInterval(verifyTimer)
    verifyTimer = null
  }
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
  schedulerSignature = ''
}

// ---------- 手动同步引擎（download / sync / upload 全量）----------

function walkLocal(dir: string, folderType: 'cache' | 'music' | 'list', out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkLocal(p, folderType, out)
    else if (e.isFile() && (folderType === 'list' ? e.name === 'snapshotInfo.json' || e.name.startsWith('snapshot_') : isAudio(e.name))) out.push(p)
  }
  return out
}

function walkLocalAll(dir: string, map = new Map<string, string>(), root = dir): Map<string, string> {
  if (!fs.existsSync(dir)) return map
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkLocalAll(p, map, root)
    else if (e.isFile()) map.set(path.relative(root, p).replace(/\\/g, '/'), p)
  }
  return map
}

function localChanged(row: any): boolean {
  if (!fs.existsSync(row.local_path)) return false
  const st = fs.statSync(row.local_path)
  return row.local_hash ? hashFile(row.local_path) !== row.local_hash : row.size !== st.size || row.local_mtime == null || st.mtimeMs !== row.local_mtime
}

async function downloadDirection(entry: UserBackupCfg, cl: OpenListClient, cfg: BackupConfig, folderType: 'cache' | 'music' | 'list', summary: SyncSummary): Promise<void> {
  const dir = resolveUserDir(entry, folderType, cfg)
  if (!dir) return
  const remoteBase = cl.resolveRemotePath(entry.user + '/' + folderType)
  let remoteFiles: Awaited<ReturnType<OpenListClient['listFilesRecursive']>>
  try { remoteFiles = await cl.listFilesRecursive(remoteBase) }
  catch (e) { if (e instanceof OpenListNotFoundError) return; throw e }
  const localMap = walkLocalAll(dir)
  const mode = effectiveMode(entry, cfg)
  for (const rf of remoteFiles) {
    if (rf.isDir) continue
    if (!rf.path.startsWith(remoteBase + '/')) throw new Error('远端文件不在配置的同步目录内')
    const rel = rf.path.slice(remoteBase.length + 1)
    const target = path.resolve(dir, rel)
    if (!isSubPath(target, path.resolve(dir)) || target === path.resolve(dir)) throw new Error('远端路径超出同步目录')
    // 不跟随本地目录联接，避免写入同步目录之外。
    let parent = target
    while (parent !== path.resolve(dir)) {
      if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('同步目标包含符号链接')
      parent = path.dirname(parent)
    }
    const isAud = isAudio(rel)
    const isListFile = folderType === 'list' && rel.endsWith('.json')
    if (!isAud && !isListFile) continue  // 附件由所属音频负责恢复
    const existing = getBackupByLocalPath(entry.user, folderType, target)
    if (existing?.deleted_at || existing?.status === 'deleted' || enqueuedIds.has('f:' + existing?.id)) continue
    if (localMap.has(rel)) {
      const rm = parseMod(rf.modified)
      const remoteChanged = existing ? rf.size !== existing.size || (rm != null && existing.remote_mtime != null && rm !== existing.remote_mtime) : true
      if (!remoteChanged) continue
      // 双侧均改动时较新者优先；时间不明确时保留本地，避免覆盖用户修改。
      if (mode === 'sync' && (!existing || localChanged(existing))) {
        if (rm == null || rm <= fs.statSync(target).mtimeMs) continue
      }
    }
    const row = upsertBackupFile({
      user: entry.user, folderType, localPath: target, remotePath: rf.path, mode,
      size: existing?.size, source: existing?.source, songmid: existing?.songmid,
      quality: existing?.quality, cacheMetadata: existing?.cache_metadata,
      direction: 'download', status: 'pending',
    })
    if (await downloadOne(row, cl, mode)) summary.downloaded++
    else summary.errors.push(entry.user + '/' + rel + ': 下载失败')
  }
}

async function uploadDirection(entry: UserBackupCfg, cl: OpenListClient, cfg: BackupConfig, folderType: 'cache' | 'music' | 'list', summary: SyncSummary): Promise<void> {
  const dir = resolveUserDir(entry, folderType, cfg)
  if (!dir) return
  const mode = effectiveMode(entry, cfg)
  for (const lp of walkLocal(dir, folderType)) {
    const rel = path.relative(dir, lp).replace(/\\/g, '/')
    const remotePath = cl.resolveRemotePath(entry.user + '/' + folderType + '/' + rel)
    const existing = getBackupByLocalPath(entry.user, folderType, lp)
    if ((existing?.deleted_at || existing?.status === 'deleted') && !localChanged(existing)) continue
    if (existing && (enqueuedIds.has('f:' + existing.id) || existing.status === 'uploading' || existing.status === 'completed')) continue
    if (existing?.status === 'failed' && existing.retry_count >= MAX_AUTO_RETRIES) continue
    const unchanged = existing?.status === 'verified' && !localChanged(existing) && existing.remote_path === remotePath
    const item = getIndexItemByFilename(path.basename(lp), entry.user)
    let row = existing
    if (!unchanged) {
      row = upsertBackupFile({
        user: entry.user, folderType, localPath: lp, remotePath, mode, direction: 'upload', status: 'pending',
        source: item?.source || existing?.source, quality: item?.quality || existing?.quality,
        songmid: item?.id || item?.songmid || existing?.songmid,
        cacheMetadata: item ? JSON.stringify(item) : existing?.cache_metadata,
      })
      enqueueUpload(row, cl, mode)
      summary.uploaded++
    }
    if (row && cfg.includeNonAudio && folderType !== 'list') queueAttachmentsForFile(entry.user, folderType, lp, row, dir, cl, cfg)
  }
}

async function deletionDetection(entry: UserBackupCfg, cl: OpenListClient, cfg: BackupConfig, folderType: 'cache' | 'music' | 'list', summary: SyncSummary): Promise<void> {
  for (const row of listBackupsByUserFolder(entry.user, folderType)) {
    if (!['verified', 'completed'].includes(row.status) || enqueuedIds.has('f:' + row.id)) continue
    if (listAttachments(row.id).some(a => enqueuedIds.has(`a:${a.id}`))) continue
    const localExists = fs.existsSync(row.local_path)
    let info: Awaited<ReturnType<OpenListClient['getFileInfo']>> | null = null
    try { info = await cl.getFileInfo(row.remote_path) }
    catch (e) {
      if (!(e instanceof OpenListNotFoundError)) throw e // 网络/权限错误绝不能解释为删除
    }
    if (!localExists && info) {
      // cache 是可淘汰的副本，缺失不代表用户希望删除云端。
      // 显式清理登记也保留远端；只有音乐/快照的已同步文件缺失才传播删除。
      const registered = getLocalFile(row.user, row.local_path)
      if (folderType === 'cache' || !registered || !row.local_hash) continue
      const rm = parseMod(info.modified)
      if (info.size !== row.size || (rm != null && row.remote_mtime != null && rm !== row.remote_mtime)) continue
      await cl.remove(row.remote_path)
    } else if (!info && localExists) {
      // 本地有尚未同步的新修改时保留它，让上传方向重建远端。
      if (localChanged(row)) continue
      fs.unlinkSync(row.local_path)
    } else if (info || localExists) continue
    softDeleteLocalFile(row.user, row.local_path)
    removeLocalCache(row)
    // 级联附件并留下墓碑，防止本轮扫描立即把删除操作反向补回。
    const deleted = await deleteOpenlistBackups([row.id], true)
    summary.errors.push(...deleted.remoteFailed)
    summary.deleted++
  }
}

interface SyncSummary {
  uploaded: number
  downloaded: number
  deleted: number
  errors: string[]
}

/** 把本服务的 config.js 上传到 OpenList（路径 <root>/_system/config.js），作为云端灾备；仅当全局开关开启时由 runSyncNow 调用 */
async function backupSystemConfigFile(cl: OpenListClient, _cfg: BackupConfig, summary: SyncSummary): Promise<void> {
  const lx = (globalThis as any).lx
  const configPath: string = lx?.configPath || process.env.CONFIG_PATH || path.join(lx?.dataPath || '.', 'config.js')
  if (!configPath || !fs.existsSync(configPath)) return
  const remotePath = cl.resolveRemotePath('_system/config.js')
  await cl.mkdir(path.posix.dirname(remotePath))
  const info = await cl.upload(configPath, remotePath)
  upsertBackupFile({
    user: '_system',
    folderType: 'system',
    localPath: configPath,
    remotePath,
    mode: 'upload',
    status: 'verified',
    size: info?.size ?? null,
  })
  summary.uploaded++
}

function dataBackupContext() {
  return { dataPath: global.lx.dataPath, configPath: global.lx.configPath, config: global.lx.config as any }
}

/** 数据备份使用统一的相对目录布局，与播放缓存和旧版按用户同步分开。 */
async function backupSelectedData(cl: OpenListClient, summary: SyncSummary): Promise<void> {
  const context = dataBackupContext()
  const types = getBackupTypes('openlist', context.config)
  for (const [relative, local] of scanBackupFiles(context, types)) {
    const existing = getBackupByLocalPath('_system', 'data', local)
    if ((existing?.deleted_at || existing?.status === 'deleted') && !localChanged(existing)) continue
    if (existing && (enqueuedIds.has(`f:${existing.id}`) || existing.status === 'completed' || existing.status === 'uploading')) continue
    if (existing?.status === 'failed' && existing.retry_count >= MAX_AUTO_RETRIES) continue
    const remotePath = cl.resolveRemotePath('_data/' + relative)
    if (existing?.status === 'verified' && existing.remote_path === remotePath && !localChanged(existing)) {
      try {
        const remote = await cl.getFileInfo(remotePath)
        const modified = parseMod(remote.modified)
        if (remote.size === existing.size && (modified == null || existing.remote_mtime == null || modified === existing.remote_mtime)) continue
      } catch (e: any) {
        if (!(e instanceof OpenListNotFoundError)) { summary.errors.push(relative + ': ' + (e?.message || e)); continue }
      }
    }
    const row = upsertBackupFile({ user: '_system', folderType: 'data', localPath: local, remotePath, name: relative, mode: 'upload', direction: 'upload', status: 'pending' })
    enqueueUpload(row, cl, 'upload')
    summary.uploaded++
  }
}

export async function restoreOpenlistData(): Promise<{ restored: number; errors: string[] }> {
  if (syncJob || verifyRunning || manualTransfers || activeUploads) throw new Error('OpenList 正在同步或校验，请稍后恢复')
  const cl = getClient()
  if (!cl) throw new Error('OpenList 未启用或未配置')
  const releaseRestore = beginCloudRestore()
  manualTransfers++
  const result = { restored: 0, errors: [] as string[] }
  try {
    const context = dataBackupContext()
    const types = getBackupTypes('openlist', context.config)
    const base = cl.resolveRemotePath('_data')
    const files = await cl.listFilesRecursive(base)
    // 先验证完整清单，避免先写一部分后才发现越界路径。
    const selected = files.filter(file => !file.isDir).map(file => {
      if (!file.path.startsWith(base + '/')) throw new Error('OpenList 备份文件超出数据目录')
      const relative = file.path.slice(base.length + 1)
      const type = backupType(relative)
      if (!type || !types.includes(type)) return null
      return { file, local: backupLocalPath(relative, context), relative }
    }).filter((item): item is NonNullable<typeof item> => !!item)
    // config.js 最后恢复，整个操作使用恢复开始时的类型和目标目录。
    selected.sort((a, b) => Number(a.relative === 'config.js') - Number(b.relative === 'config.js'))
    for (const { file, local, relative } of selected) {
      try {
        fs.mkdirSync(path.dirname(local), { recursive: true })
        await cl.download(file.path, local)
        const row = upsertBackupFile({ user: '_system', folderType: 'data', localPath: local, remotePath: file.path, name: relative, mode: 'upload', status: 'verified', direction: 'upload' })
        setBackupStatus(row.id, 'verified', { size: file.size, localMtime: fs.statSync(local).mtimeMs, localHash: hashFile(local), remoteMtime: parseMod(file.modified), error: null })
        result.restored++
      } catch (e: any) { result.errors.push(relative + ': ' + (e?.message || e)) }
    }
    return result
  } finally { manualTransfers--; releaseRestore() }
}

/**
 * 手动触发同步（UI 按钮调用）。可选按 user / folder 过滤。
 * 与定时同步串行执行，上传完成后才返回结果。
 */
export async function runSyncNow(opts: { user?: string; folder?: 'cache' | 'music' | 'list' } = {}): Promise<SyncSummary> {
  while (syncJob) await syncJob.catch(() => {})
  const job = runSyncImpl(opts)
  syncJob = job
  try { return await job } finally { if (syncJob === job) syncJob = null }
}

async function runSyncImpl(opts: { user?: string; folder?: 'cache' | 'music' | 'list' }): Promise<SyncSummary> {
  while (verifyRunning || manualTransfers || activeUploads || uploadQueue.length) await sleep(20)
  if (isCloudRestoreRunning()) throw new Error('云端恢复正在执行，请稍后备份')
  const cfg = getConfig()
  if (!cfg.enable) throw new Error('OpenList 未启用')
  const cl = getClient()
  if (!cl) throw new Error('OpenList 客户端不可用')
  const summary: SyncSummary = { uploaded: 0, downloaded: 0, deleted: 0, errors: [] }
  const selectedData = (global.lx.config as any)['backup.openlist.types'] !== undefined
  for (const entry of cfg.userBackups) {
    if (!entry.enabled) continue
    if (opts.user && entry.user !== opts.user) continue
    const mode = effectiveMode(entry, cfg)
    const folders: Array<'cache' | 'music' | 'list'> = opts.folder ? [opts.folder] : (selectedData ? ['cache'] : ['cache', 'music', 'list'])
    for (const ft of folders) {
      if (selectedData && ft !== 'cache') continue
      const dir = resolveUserDir(entry, ft, cfg)
      if (!dir) continue
      try {
        if (mode === 'sync') await deletionDetection(entry, cl, cfg, ft, summary)
        if (mode === 'download' || mode === 'sync') await downloadDirection(entry, cl, cfg, ft, summary)
        if (mode === 'sync') {
          await uploadDirection(entry, cl, cfg, ft, summary)
        } else if (mode === 'upload' || mode === 'upload-delete') {
          await uploadDirection(entry, cl, cfg, ft, summary)
        }
      } catch (e: any) {
        summary.errors.push(`${entry.user}/${ft}: ${e?.message || e}`)
      }
    }
  }
  if (selectedData && !opts.user && !opts.folder) await backupSelectedData(cl, summary)
  while (activeUploads || uploadQueue.length) await sleep(20)
  for (const row of listBackupByStatus('failed')) {
    if (rowEnabled(row, cfg) && (!opts.user || row.user === opts.user) && (!opts.folder || row.folder_type === opts.folder)) summary.errors.push(row.user + '/' + row.name + ': ' + row.error)
  }
  if (!selectedData && cfg.backupSystemConfig) {
    try {
      await backupSystemConfigFile(cl, cfg, summary)
    } catch (e: any) {
      summary.errors.push('system-config: ' + (e?.message || e))
    }
  }
  return summary
}

// ---------- 查询 ----------

export function listBackups(): any[] {
  ensureBackupTables()
  const db = getBackupDb()
  // 本地是否存在：由 openlist_local_files 表（排除软删除）通过 (user, local_path) 关联 JOIN 得出，
  // 不再依赖 fs.existsSync，也无需前端二次请求。
  const files = db.prepare(`
    SELECT f.*,
      (SELECT 1 FROM openlist_local_files l
        WHERE l.user = f.user AND l.local_path = f.local_path AND l.deleted_at IS NULL
        LIMIT 1) AS local_exists
    FROM openlist_backup_files f
    WHERE f.deleted_at IS NULL
    ORDER BY f.updated_at DESC
  `).all() as any[]
  return files.map((f) => ({ ...f, local_exists: !!f.local_exists, attachments: listAttachments(f.id) }))
}

/**
 * 单文件手动重试：沿用该记录的实际传输方向，成功落盘后才返回成功。
 * 返回 { ok, message }，前端据此给出明确提示（不再笼统报“未知错误”）。
 */
export async function retryBackup(id: number): Promise<{ ok: boolean; message?: string }> {
  const cfg = getConfig()
  const row = getBackupById(id)
  if (!row || row.deleted_at || row.status === 'deleted') return { ok: false, message: '备份记录不存在或已删除' }
  if (!rowEnabled(row, cfg)) return { ok: false, message: '该用户或目录未启用 OpenList 同步' }
  if (syncJob || verifyRunning || enqueuedIds.has('f:' + id)) return { ok: false, message: '文件正在同步或校验，请稍后重试' }
  const cl = getClient()
  if (!cl) return { ok: false, message: 'OpenList 客户端不可用' }
  const mode = effectiveModeFromRow(row, cfg)
  const download = row.direction === 'download' || mode === 'download'
  // 不以“路径存在”判断成功。上传必须重新传输并确认大小/本地指纹；下载必须完整落盘。
  enqueuedIds.add('f:' + id)
  manualTransfers++
  try {
    const ok = download ? await downloadOne(row, cl, mode) : await uploadOne(row, cl, mode)
    if (!ok) return { ok: false, message: getBackupById(id)?.error || '重试失败' }
    return { ok: true, message: download ? '已重新下载' : '已重新上传，等待校验' }
  } catch (e: any) {
    return { ok: false, message: String(e?.message || e) }
  } finally {
    enqueuedIds.delete('f:' + id)
    manualTransfers--
  }
}

/**
 * 批量软删除备份记录：将指定记录及依附于它们的附件记录标记为 deleted（deleted_at），
 * 同时物理删除缓存音频副本（folder_type=cache 的本地临时副本）与所有绑定附件的本地文件；
 * 音乐库文件（folder_type=music）仅软删除记录、不删除用户实际音频，避免误删聆听源。
 * 删除前用 countLocalPathRefs 确认本地文件未被其它活跃记录引用，避免误删共享文件。
 */
export async function deleteOpenlistBackups(ids: number[], skipMainRemote = false): Promise<{
  deleted: number
  remoteRemoved: number
  remoteFailed: string[]
}> {
  if (!skipMainRemote && (syncJob || verifyRunning || manualTransfers)) throw new Error('OpenList 正在同步或校验，请稍后删除')
  const db = getBackupDb()
  const cl = getClient()
  const ts = Date.now()
  const remoteFailed: string[] = []
  let deleted = 0
  let remoteRemoved = 0
  for (const id of ids) {
    const row = getBackupById(id)
    if (!row || row.deleted_at) continue
    if (enqueuedIds.has(`f:${id}`)) { remoteFailed.push(`${row.remote_path} (文件正在上传，请稍后删除)`); continue }
    const atts = listAttachments(id)
    if (atts.some(a => enqueuedIds.has(`a:${a.id}`))) { remoteFailed.push(`${row.remote_path} (附件正在上传，请稍后删除)`); continue }
    // 先软删除附件记录（避免后续远程引用计数把同属本记录的附件误判为「被其它活跃记录引用」）
    // 附件：删远端（仅当无其它活跃记录引用同一远端路径）+ 删本地
    for (const a of atts) {
      if (unlinkAttachment(id, a.id) > 0) continue
      db.prepare('UPDATE openlist_backup_attachments SET deleted_at = ?, status = ? WHERE id = ?').run(ts, 'deleted', a.id)
      if (a.remote_path) {
        if (cl && countRemotePathRefs(a.remote_path, id, a.id) === 0) {
          try {
            await cl.remove(a.remote_path)
            remoteRemoved++
          } catch (e: any) {
            remoteFailed.push(`${a.remote_path} (${e?.message || e})`)
          }
        }
      }
      if (a.local_path && fs.existsSync(a.local_path) && countLocalPathRefs(a.local_path, id, a.id) === 0) {
        try { fs.unlinkSync(a.local_path); softDeleteLocalFile(row.user, a.local_path) } catch { /* ignore */ }
      }
    }
    // 软删除主记录
    db.prepare(
      'UPDATE openlist_backup_files SET deleted_at = ?, status = ?, error = NULL WHERE id = ?',
    ).run(ts, 'deleted', id)
    // 主文件远端：删远端（仅当无其它活跃记录引用同一远端路径）
    if (row.remote_path && !skipMainRemote) {
      if (cl && countRemotePathRefs(row.remote_path, id, -1) === 0) {
        try {
          await cl.remove(row.remote_path)
          remoteRemoved++
        } catch (e: any) {
          remoteFailed.push(`${row.remote_path} (${e?.message || e})`)
        }
      } else if (!cl) {
        remoteFailed.push(`${row.remote_path} (OpenList 未连接，跳过远端删除)`)
      }
    }
    // 主文件本地：仅 cache 类型物理删除本地临时副本（music 为用户实际文件，仅软删记录）
    if (row.folder_type === 'cache' && row.local_path && fs.existsSync(row.local_path) && countLocalPathRefs(row.local_path, id, -1) === 0) {
      try { fs.unlinkSync(row.local_path); softDeleteLocalFile(row.user, row.local_path) } catch { /* ignore */ }
    }
    removeLocalCache(row)
    deleted++
  }
  if (remoteFailed.length) {
    console.warn(
      '[openlist] 删除备份记录时以下远端文件未能从网盘删除（记录已软删，但网盘文件残留）：\n' +
        remoteFailed.join('\n'),
    )
  }
  return { deleted, remoteRemoved, remoteFailed }
}
