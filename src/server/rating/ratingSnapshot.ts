import { commitRatingFiles, recoverRatingTransaction, planRatingMigration } from './ratingMigration'
import { normalizeRatingHistory, validateRatingStorage } from './ratingValidation'
import { withRatingIdentityLock } from './ratingIdentityLock'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getUserDirname } from '@/user'
import { getUserConfig } from '@/user/data'

/**
 * 「我的评分」快照（第三种备份类型）。
 * 评星数据独立于歌单/不喜欢，存放在 <用户目录>/subsonic-meta.json，
 * 因此独立成一套快照目录 <用户目录>/rating/snapshot/，与另外两类并列展示。
 */
export interface RatingMeta {
  starredAlbums: string[]
  starredArtists: string[]
  starredArtistNames: string[]
  ratingOrigins?: Record<string, { channel: string, at: number }>
  ratings: Record<string, number>
  ratingHistory?: Record<string, any[]>
  ratingCatalog?: Record<string, any>
  localLinks?: { id: string, filename: string, platformId?: string }[]
}

export interface RatingSnapshotItem {
  id: string
  time: number
  size: number
  origin: 'imported' | 'auto'
}

interface RatingSnapshotInfo {
  imported: string[]
}

const metaLocks = new Map<string, Promise<unknown>>()

/**
 * 同一用户 subsonic-meta.json 的「读-改-写」串行化锁。
 * 避免 handleSetRating / handleStar / syncDislikeToRating 并发写同一文件互相覆盖。
 */
export function withMetaLock<T>(username: string, task: () => Promise<T>): Promise<T> {
    const prev = metaLocks.get(username) ?? Promise.resolve()
    const run = (): Promise<T> => task()
    // 前一个任务无论成功还是失败都要继续，避免一次异常卡死整条队列
    const next = prev.then(run, run)
    const tail = next.then(() => undefined, () => undefined)
    metaLocks.set(username, tail)
    tail.then(() => {
        if (metaLocks.get(username) === tail) metaLocks.delete(username)
    })
    return next
}

const emptyMeta = (): RatingMeta => ({ starredAlbums: [], starredArtists: [], starredArtistNames: [], ratings: {} })

const userDir = (username: string) => path.join(global.lx.userPath, getUserDirname(username))
const metaPath = (username: string) => path.join(userDir(username), 'subsonic-meta.json')
const ratingDir = (username: string) => path.join(userDir(username), 'rating')
const snapshotDir = (username: string) => path.join(ratingDir(username), 'snapshot')
const infoPath = (username: string) => path.join(ratingDir(username), 'snapshotInfo.json')

/**
 * 快照 id 直接来自外部输入（下载/删除/恢复接口的 id 参数、导入时的文件名），
 * 这里统一拒绝路径分隔符与上跳片段，避免拼进 snapshotPath 后发生路径穿越。
 */
export const isValidSnapshotId = (id: unknown): id is string => {
  if (typeof id !== 'string') return false
  if (!id || id.length > 200) return false
  if (id === '.' || id === '..' || id.includes('..')) return false
  return !/[\\/:*?"<>|]/.test(id)
}

const snapshotPath = (username: string, id: string) => {
  if (!isValidSnapshotId(id)) throw new Error('Invalid snapshot id')
  return path.join(snapshotDir(username), `snapshot_${id}`)
}

export function sanitizeRatingCatalog(value: any): Record<string, any> {
  const catalog: Record<string, any> = Object.create(null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return catalog
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || ['__proto__', 'constructor', 'prototype'].includes(id)) continue
    const row: any = { id }
    for (const key of ['name', 'singer', 'source', 'albumName', 'albumId', 'interval']) {
      const field = (raw as any)[key]
      if (typeof field === 'string' || typeof field === 'number') row[key] = String(field).slice(0, 500)
    }
    try { const url = new URL((raw as any).img); if (/^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash) row.img = url.href } catch {}
    catalog[id] = row
  }
  return catalog
}

/** 完整导出评分、描述及关联参照；不包含音频，不猜测或覆盖当前文件关联。 */
export function exportRatingBackup(username: string): RatingMeta & { type: string, restorePolicy: string } {
  recoverRatingTransaction(userDir(username))
  const meta = readMeta(username)
  let catalog = {}
  let tracks: any[] = []
  const catalogFile = path.join(ratingDir(username), 'songs.json')
  if (fs.existsSync(catalogFile)) catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
  const registryFile = path.join(userDir(username), 'subsonic-local-registry.json')
  if (fs.existsSync(registryFile)) tracks = Object.values(JSON.parse(fs.readFileSync(registryFile, 'utf8')).tracks || {})
  return { ...meta, type: 'lxRating_v1', restorePolicy: 'ratings-and-descriptions-current-links', ratingCatalog: sanitizeRatingCatalog(catalog),
    localLinks: [...new Map(tracks.map(t => [t.id, { id: t.id, filename: t.filename, platformId: t.platformId }])).values()] }
}

const normalizeMeta = (data: any): RatingMeta => ({
  ...(data?.ratingHistory ? { ratingHistory: normalizeRatingHistory(data.ratingHistory) } : {}),
  ...(data?.ratingCatalog ? { ratingCatalog: sanitizeRatingCatalog(data.ratingCatalog) } : {}),
  ...(Array.isArray(data?.localLinks) ? { localLinks: data.localLinks.filter((x: any) => x && typeof x.id === 'string' && typeof x.filename === 'string').map((x: any) => ({ id: x.id, filename: x.filename, platformId: x.platformId })) } : {}),
  ...(data?.ratingOrigins ? { ratingOrigins: data.ratingOrigins } : {}),
  starredAlbums: Array.isArray(data?.starredAlbums) ? data.starredAlbums : [],
  starredArtists: Array.isArray(data?.starredArtists) ? data.starredArtists : [],
  starredArtistNames: Array.isArray(data?.starredArtistNames) ? data.starredArtistNames : [],
  ratings: Object.fromEntries(Object.entries(data?.ratings && typeof data.ratings === 'object' && !Array.isArray(data.ratings) ? data.ratings : {}).filter(([id, value]) => !['__proto__', 'constructor', 'prototype'].includes(id) && Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5).map(([id, value]) => [id, Number(value)])),
})

/** 供 HTTP 导入入口复用：外部备份（含 lxRating_v1 标记）统一归一化为评分元数据后再落盘 */
export const normalizeRatingMeta = normalizeMeta

const readMeta = (username: string): RatingMeta => {
  recoverRatingTransaction(userDir(username))
  const file = metaPath(username)
  if (!fs.existsSync(file)) return emptyMeta()
  try {
    const data = validateRatingStorage(JSON.parse(fs.readFileSync(file, 'utf8')))
    const catalogFile = path.join(ratingDir(username), 'songs.json')
    const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : {}
    const before = JSON.stringify(data), beforeCatalog = JSON.stringify(catalog)
    const changes = planRatingMigration(userDir(username), data, catalog)
    if (JSON.stringify(data) !== before) changes.set(file, JSON.stringify(data))
    if (JSON.stringify(catalog) !== beforeCatalog) changes.set(catalogFile, JSON.stringify(catalog))
    commitRatingFiles(userDir(username), changes)
    return normalizeMeta(data)
  }
  catch { throw new Error('评分文件损坏，已停止操作并保留原文件，请从备份恢复') }
}

const writeMeta = (username: string, meta: RatingMeta) => {
  fs.mkdirSync(path.dirname(metaPath(username)), { recursive: true })
  const file = metaPath(username)
  fs.writeFileSync(file + '.restore.tmp', JSON.stringify(meta), 'utf8')
  fs.renameSync(file + '.restore.tmp', file)
}

const readInfo = (username: string): RatingSnapshotInfo => {
  try {
    if (fs.existsSync(infoPath(username))) {
      const data = JSON.parse(fs.readFileSync(infoPath(username), 'utf8'))
      if (Array.isArray(data.imported)) return { imported: data.imported }
    }
  } catch { /* ignore */ }
  return { imported: [] }
}

const writeInfo = (username: string, info: RatingSnapshotInfo) => {
  fs.mkdirSync(ratingDir(username), { recursive: true })
  fs.writeFileSync(infoPath(username), JSON.stringify(info), 'utf8')
}

const ensureDirs = (username: string) => fs.mkdirSync(snapshotDir(username), { recursive: true })

const md5 = (text: string) => createHash('md5').update(text).digest('hex')

/** 自动评分快照保留上限：导入快照永久保留，只清理超量的系统快照（保留最新 max 份） */
const cleanupAutoSnapshots = (username: string) => {
  try {
    const info = readInfo(username)
    const max = Math.max(1, Number(getUserConfig(username)?.maxSnapshotNum) || Number(global.lx.config.maxSnapshotNum) || 10)
    const entries = fs.readdirSync(snapshotDir(username))
      .filter(file => file.startsWith('snapshot_'))
      .map(file => ({
        id: file.slice('snapshot_'.length),
        mtime: fs.statSync(path.join(snapshotDir(username), file)).mtimeMs,
      }))
      .filter(entry => !info.imported.includes(entry.id))
      .sort((a, b) => b.mtime - a.mtime)
    for (const entry of entries.slice(max)) {
      try { fs.unlinkSync(snapshotPath(username, entry.id)) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** 按当前评分内容生成（或复用）一份系统快照，返回快照 id */
export const createRatingSnapshot = async (username: string): Promise<string> => {
  const meta = exportRatingBackup(username)
  const id = md5(JSON.stringify(meta))
  ensureDirs(username)
  const file = snapshotPath(username, id)
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(meta), 'utf8')
  else {
    // 复用内容相同的旧快照时刷新 mtime：清理按 mtime 只保留最新 N 份，不刷新会把刚复用的快照当成最旧的删掉
    const now = new Date()
    try { fs.utimesSync(file, now, now) } catch { /* ignore */ }
  }
  cleanupAutoSnapshots(username)
  return id
}

/** 保存用户导入的评分备份：按原文件名落盘、保留文件时间、显式登记来源 */
export const saveRatingImport = async (username: string, name: string, meta: RatingMeta, time: number): Promise<void> => {
  ensureDirs(username)
  const file = snapshotPath(username, name)
  fs.writeFileSync(file, JSON.stringify(meta), 'utf8')
  if (time) {
    const date = new Date(time)
    fs.utimesSync(file, date, date)
  }
  const info = readInfo(username)
  if (!info.imported.includes(name)) {
    info.imported.push(name)
    writeInfo(username, info)
  }
}

export const listRatingSnapshots = async (username: string): Promise<RatingSnapshotItem[]> => {
  ensureDirs(username)
  const info = readInfo(username)
  const list: RatingSnapshotItem[] = []
  for (const file of fs.readdirSync(snapshotDir(username))) {
    if (!file.startsWith('snapshot_')) continue
    const id = file.slice('snapshot_'.length)
    try {
      const stat = fs.statSync(snapshotPath(username, id))
      list.push({
        id,
        time: stat.mtimeMs,
        size: stat.size,
        origin: info.imported.includes(id) ? 'imported' : 'auto',
      })
    } catch { /* 文件已消失 */ }
  }
  return list.sort((a, b) => b.time - a.time)
}

export const readRatingSnapshot = async (username: string, id: string): Promise<RatingMeta | null> => {
  try {
    const file = snapshotPath(username, id)
    if (!fs.existsSync(file)) return null
    return normalizeMeta(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch { return null }
}

/** 回滚：把快照内容写回 subsonic-meta.json（Subsonic 每次请求会重新预读该文件，缓存自动刷新） */
export const restoreRatingSnapshot = async (username: string, id: string): Promise<void> => {
  const meta = await readRatingSnapshot(username, id)
  if (!meta) throw new Error('Rating snapshot not found')
  // 与 Subsonic 的评分/收藏写入共用锁，旧快照的收藏字段不参与恢复。
  await withRatingIdentityLock(username, () => withMetaLock(username, async () => {
    recoverRatingTransaction(userDir(username))
    const current = readMeta(username)
    const dir = userDir(username)
    recoverRatingTransaction(dir)
    const catalogFile = path.join(ratingDir(username), 'songs.json')
    const catalog = meta.ratingCatalog ? sanitizeRatingCatalog(meta.ratingCatalog) : (fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : {})
    const history = { ...(current.ratingHistory || meta.ratingHistory || {}) }
    for (const key of new Set([...Object.keys(current.ratings), ...Object.keys(meta.ratings)])) {
      const from = current.ratings[key] || 0, to = meta.ratings[key] || 0
      if (from !== to) history[key] = [...(history[key] || []), { from, to, channel: 'snapshot-restore', at: Date.now(), snapshotId: id }].slice(-30)
    }
    const restored = { ...current, ratings: { ...meta.ratings }, ratingOrigins: { ...(meta.ratingOrigins || {}) }, ratingHistory: history }
    const changes = planRatingMigration(dir, restored, catalog)
    changes.set(catalogFile, JSON.stringify(catalog))
    changes.set(metaPath(username), JSON.stringify(restored))
    commitRatingFiles(dir, changes)

  }))
}

export const deleteRatingSnapshot = async (username: string, id: string): Promise<boolean> => {
  const file = snapshotPath(username, id)
  if (!fs.existsSync(file)) return false
  fs.unlinkSync(file)
  const info = readInfo(username)
  const index = info.imported.indexOf(id)
  if (index >= 0) {
    info.imported.splice(index, 1)
    writeInfo(username, info)
  }
  return true
}
