/**
 * 切换歌曲命名格式后，把「存量文件」同步重命名为新格式。
 *
 * 三处一起改，缺一不可：
 *   1. 本地磁盘文件名（含 .lrc 与外部封面缓存）
 *   2. OpenList 备份库里的文件名相关字段（openlist_backup_files / openlist_local_files /
 *      openlist_backup_attachments 的 local_path、remote_path、name、cache_metadata）
 *   3. 云端实际文件名（走 OpenList 原生 /api/fs/rename，元数据操作，不重传音频字节）
 *   另外同步本地缓存索引的 filename / lyricFilename。
 *
 * 安全约束：
 * - 命名格式完全取自现有配置（用户级 settings.json 的 serverCacheNamingPattern 优先，
 *   其次是全局 cache.namingPattern），由 getFileName 复用现有全部 5 种格式与冲突后缀规则；
 * - 只读预览（plan）不写任何文件、不发写请求；
 * - 执行（apply）逐项幂等：每一步先检查当前状态，中途失败后重跑能收敛；
 * - 目标名冲突一律跳过，绝不覆盖、绝不删除任何已有音频；
 * - 只在管理员手动点击时执行，绝不自动迁移；
 * - 与同步/校验互斥（openlistTaskLock），避免改名中间态被同步当成新文件重复上传。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getBackupDb, getBackupByLocalPath, listAttachments } from './openlistBackupDb'
import { getClient, isOpenlistBusy } from './openlistBackup'
import { isTaskRunning, runExclusive } from './openlistTaskLock'
import type { OpenListClient } from './openlistClient'
import { OpenListNotFoundError } from './openlistClient'
import {
  CACHE_ROOTS, getCacheDir, getFileName, indexManager, getUserNamingPattern,
  migrateCoverCacheOnRename,
} from '@/server/music/fileCache'

export interface RenamePlanItem {
  user: string
  folder: 'cache' | 'music'
  location: string
  songId: string
  quality: string
  namingPattern: string
  oldFilename: string
  newFilename: string
  oldLocalPath: string
  newLocalPath: string
  oldRemotePath: string
  newRemotePath: string
  oldLyricFilename?: string
  newLyricFilename?: string
  backupRowId: number | null
  attachmentCount: number
  /** 同 stem 的附件（.lrc / 封面）需要一起改名 */
  attachments: Array<{ id: number, oldRemotePath: string, newRemotePath: string, newName: string, oldLocalPath: string | null, newLocalPath: string | null }>
  status: 'ready' | 'unchanged' | 'conflict' | 'missing-local'
  reason?: string
  /** 云端是否需要重命名；disabled 表示未启用 OpenList，只改本地与备份库 */
  cloud: 'pending' | 'disabled' | 'absent'
}

export interface RenamePlan {
  cloudEnabled: boolean
  warning: string
  namingPatterns: Record<string, string>
  scanned: number
  ready: number
  unchanged: number
  conflicts: number
  missing: number
  items: RenamePlanItem[]
  truncated: boolean
}

export interface RenameResult {
  renamed: number
  skipped: number
  failed: number
  conflicts: number
  cloudRenamed: number
  dbUpdated: number
  items: Array<{ user: string, folder: string, oldFilename: string, newFilename: string, status: 'ok' | 'failed' | 'conflict', reason?: string }>
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape', '.aac', '.opus', '.wma', '.alac', '.aiff', '.aif'])
const ATTACHMENT_EXTENSIONS = new Set(['.lrc', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.txt'])

const normalizeUser = (name: string) => (!name || name === 'default' || name === '_open') ? '_open' : name
const posixRel = (p: string) => p.replace(/\\/g, '/')

/** 扫描两个缓存位置的 cache/music 用户目录，返回真实存在的 (user, folder, location, dir) */
function* cacheScopes(targetUser?: string): Generator<{ user: string, dbUser: string, folder: 'cache' | 'music', location: string, dir: string }> {
  const seen = new Set<string>()
  for (const location of [CACHE_ROOTS.ROOT, CACHE_ROOTS.DATA]) {
    const base = location === CACHE_ROOTS.DATA ? global.lx.dataPath : process.cwd()
    for (const folder of ['cache', 'music'] as const) {
      const root = path.join(base, folder)
      if (seen.has(root) || !fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) continue
      seen.add(root)
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const dbUser = normalizeUser(entry.name)
        if (targetUser && entry.name !== targetUser && dbUser !== normalizeUser(targetUser)) continue
        // 与 getCacheDir/indexManager 的目录解析保持一致，且不在只读预览里创建目录
        const userDirName = dbUser === '_open' ? '_open' : entry.name
        const dir = path.join(root, userDirName)
        if (!fs.existsSync(dir)) continue
        yield { user: entry.name, dbUser, folder, location, dir }
      }
    }
  }
}

/** 云端文件清单（只读一次递归列举），用于冲突判断 */
async function cloudPathSet(cl: OpenListClient): Promise<{ paths: Set<string>, warning: string }> {
  try {
    const all = await cl.listFilesRecursive(cl.resolveRemotePath(''))
    return { paths: new Set(all.filter(f => !f.isDir).map(f => f.path)), warning: '' }
  } catch (e: any) {
    return { paths: new Set(), warning: '云端文件清单不可用（' + (e?.message || e) + '），执行时将逐项检查' }
  }
}

/**
 * 远端路径按配置独立推导，不依赖 client 实例：
 * 即使未启用 OpenList、或选择「本次不改云端」，备份库里的 remote_path 也必须跟着改名，
 * 否则下次同步会用旧名再上传一份，产生重复文件。
 */
const remoteFor = (user: string, folder: string, rel: string) => {
  const cfg: any = global.lx?.config || {}
  const root = String(cfg['openlist.root'] || '/').replace(/\/+$/, '') || '/'
  return `${root}/${user}/${folder}/${posixRel(rel)}`.replace(/\/+/g, '/')
}

/** 附件路径：把与音频同 stem 的 .lrc / 封面改成新 stem，扩展名保留 */
const siblingName = (name: string, oldStem: string, newStem: string): string => {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  if (stem !== oldStem) return name
  return newStem + ext
}

/** 只读预览：计算所有待重命名项、冲突与缺失，不改动任何东西 */
export async function planCacheRename(options: {
  user?: string, folder?: 'cache' | 'music', limit?: number, cloud?: boolean, all?: boolean
} = {}): Promise<RenamePlan> {
  const limit = options.all ? Number.MAX_SAFE_INTEGER
    : Number.isFinite(options.limit) ? Math.max(0, Math.min(2000, Math.floor(options.limit!))) : 200
  const cl = options.cloud === false ? null : getClient()
  const cloudPaths = cl ? await cloudPathSet(cl) : { paths: new Set<string>(), warning: '' }
  const db = getBackupDb()
  const result: RenamePlan = {
    cloudEnabled: !!cl, warning: cloudPaths.warning, namingPatterns: {},
    scanned: 0, ready: 0, unchanged: 0, conflicts: 0, missing: 0, items: [], truncated: false,
  }
  const candidates: RenamePlanItem[] = []

  for (const scope of cacheScopes(options.user)) {
    if (options.folder && scope.folder !== options.folder) continue
    const dbUser = scope.dbUser
    const pattern = getUserNamingPattern(scope.user)
    result.namingPatterns[scope.user] = pattern
    // 显式传 location 读取该位置的索引，不依赖 getUserCacheLocation 的当前值
    const items = indexManager.getAll(scope.user, scope.folder, scope.location)
    for (const item of items) {
      if (!AUDIO_EXTENSIONS.has('.' + String(item.ext || '').toLowerCase())) continue
      result.scanned++
      const songInfo = {
        id: item.id, songmid: item.songmid || item.id, name: item.name, singer: item.singer,
        source: item.source, quality: item.quality, albumName: item.album, albumId: item.albumId,
        img: item.img, interval: item.interval,
      }
      const newBaseName = getFileName(songInfo, item.quality, scope.folder === 'music', scope.user, pattern)
      const subPath = item.subPath || ''
      const newFilename = subPath
        ? posixRel(path.join(subPath, `${newBaseName}.${item.ext}`))
        : `${newBaseName}.${item.ext}`
      const oldFilename = item.filename
      const dir = scope.dir
      const oldLocalPath = path.join(dir, oldFilename)
      const newLocalPath = path.join(dir, newFilename)
      const oldRemotePath = remoteFor(dbUser, scope.folder, oldFilename)
      const newRemotePath = remoteFor(dbUser, scope.folder, newFilename)
      const oldStem = path.basename(oldFilename, path.extname(oldFilename))
      const newStem = path.basename(newFilename, path.extname(newFilename))

      let newLyricFilename: string | undefined
      let oldLyricFilename: string | undefined
      if (item.lyricFilename) {
        oldLyricFilename = item.lyricFilename
        const lyricBase = path.basename(item.lyricFilename)
        const renamed = siblingName(lyricBase, oldStem, newStem)
        newLyricFilename = posixRel(path.join(path.dirname(item.lyricFilename), renamed))
      }

      // 备份记录：优先按本地路径命中，否则按远端路径命中
      let row = getBackupByLocalPath(dbUser, scope.folder, oldLocalPath)
      if (!row) {
        row = (db.prepare(`SELECT * FROM openlist_backup_files WHERE user = ? AND folder_type = ?
          AND remote_path = ? AND deleted_at IS NULL LIMIT 1`).get(dbUser, scope.folder, oldRemotePath) as any) || null
      }
      const attachments = row ? listAttachments(row.id) : []
      const attachmentRenames = attachments.flatMap(att => {
        const attName = path.posix.basename(att.remote_path)
        if (!ATTACHMENT_EXTENSIONS.has(path.extname(attName).toLowerCase())) return []
        const nextName = siblingName(attName, oldStem, newStem)
        if (nextName === attName) return []
        return [{
          id: att.id,
          oldRemotePath: att.remote_path,
          newRemotePath: path.posix.join(path.posix.dirname(att.remote_path), nextName),
          newName: nextName,
          oldLocalPath: att.local_path,
          newLocalPath: att.local_path ? path.join(path.dirname(att.local_path), nextName) : null,
        }]
      })

      const entry: RenamePlanItem = {
        user: scope.user, folder: scope.folder, location: scope.location,
        songId: item.id, quality: item.quality || 'unknown', namingPattern: pattern,
        oldFilename, newFilename, oldLocalPath, newLocalPath, oldRemotePath, newRemotePath,
        oldLyricFilename, newLyricFilename,
        backupRowId: row?.id ?? null, attachmentCount: attachmentRenames.length,
        attachments: attachmentRenames,
        status: 'ready', cloud: cl ? 'pending' : 'disabled',
      }

      if (newFilename === oldFilename) {
        // 已是目标格式，但备份库/云端可能残留旧名（上次执行中断）：仍需修正，便于重跑收敛
        if (row && (row.local_path !== newLocalPath || row.remote_path !== newRemotePath)) {
          entry.oldLocalPath = row.local_path
          entry.oldRemotePath = row.remote_path
        } else {
          entry.status = 'unchanged'
        }
      }
      if (entry.status === 'ready') {
        const localOld = fs.existsSync(entry.oldLocalPath)
        const localNew = fs.existsSync(entry.newLocalPath)
        if (!localOld && !localNew) {
          entry.status = 'missing-local'
          entry.reason = '本地文件不存在'
        } else if (localOld && localNew) {
          entry.status = 'conflict'
          entry.reason = '目标文件名已被占用'
        } else if (cl && cloudPaths.paths.has(newRemotePath) && cloudPaths.paths.has(oldRemotePath)) {
          entry.status = 'conflict'
          entry.reason = '云端目标文件名已被占用'
        }
      }
      candidates.push(entry)
    }
  }

  // 同一目录下多个索引项映射到同一目标名 → 全部标冲突，避免互相覆盖
  const targetCounts = new Map<string, number>()
  for (const item of candidates) {
    if (item.status !== 'ready') continue
    const key = item.user + '/' + item.location + '/' + item.folder + '/' + item.newLocalPath
    targetCounts.set(key, (targetCounts.get(key) || 0) + 1)
  }
  for (const item of candidates) {
    if (item.status !== 'ready') continue
    const key = item.user + '/' + item.location + '/' + item.folder + '/' + item.newLocalPath
    if ((targetCounts.get(key) || 0) > 1) {
      item.status = 'conflict'
      item.reason = '多首歌曲映射到同一文件名'
    }
  }

  for (const item of candidates) {
    if (item.status === 'ready') result.ready++
    else if (item.status === 'unchanged') result.unchanged++
    else if (item.status === 'conflict') result.conflicts++
    else result.missing++
    if (result.items.length < limit) result.items.push(item)
    else result.truncated = true
  }
  return result
}

/**
 * 手动执行：逐项幂等，任何一步失败都不改动其余文件。
 *
 * 与同步/校验互斥执行：改名必然经过「云端已改 → 本地已改 → 备份库未改」的短窗口，
 * 此时若同步引擎扫描本地目录，会把新文件名当成新文件插入重复记录并再上传一份。
 * 因此开工前拒绝重叠任务，并在整个执行期间占用互斥闸门，阻止新的同步/校验插入。
 */
export async function applyCacheRename(options: {
  user?: string, folder?: 'cache' | 'music', limit?: number, cloud?: boolean
} = {}): Promise<RenameResult> {
  if (isOpenlistBusy() || isTaskRunning()) throw new Error('OpenList 正在同步或校验，请等待完成后再执行改名')
  return runExclusive(() => applyCacheRenameExclusive(options))
}

async function applyCacheRenameExclusive(options: {
  user?: string, folder?: 'cache' | 'music', limit?: number, cloud?: boolean
}): Promise<RenameResult> {
  const plan = await planCacheRename({ ...options, all: true })
  const cl = options.cloud === false ? null : getClient()
  const db = getBackupDb()
  const out: RenameResult = { renamed: 0, skipped: 0, failed: 0, conflicts: 0, cloudRenamed: 0, dbUpdated: 0, items: [] }
  const record = (item: RenamePlanItem, status: 'ok' | 'failed' | 'conflict', reason?: string) => {
    out.items.push({ user: item.user, folder: item.folder, oldFilename: item.oldFilename, newFilename: item.newFilename, status, reason })
  }

  for (const item of plan.items) {
    if (item.status === 'unchanged') { out.skipped++; continue }
    if (item.status === 'conflict' || item.status === 'missing-local') {
      out.conflicts++
      record(item, 'conflict', item.reason)
      continue
    }
    try {
      const localOld = fs.existsSync(item.oldLocalPath)
      const localNew = fs.existsSync(item.newLocalPath)
      if (localOld && localNew) { out.conflicts++; record(item, 'conflict', '目标文件名已被占用'); continue }

      // 1) 云端先行：音频与附件都用元数据 rename；失败则不改本地/数据库，保持三者一致。
      //    先统一检查占用，再统一执行，避免改到一半留下冲突；重跑时已改过的项 old 不存在，自动跳过。
      let cloudConflict = ''
      if (cl && item.cloud === 'pending' && item.oldRemotePath && item.oldRemotePath !== item.newRemotePath) {
        const renames = [
          { oldPath: item.oldRemotePath, newPath: item.newRemotePath, newName: path.posix.basename(item.newRemotePath) },
          ...item.attachments.map(att => ({ oldPath: att.oldRemotePath, newPath: att.newRemotePath, newName: att.newName })),
        ].filter(r => r.oldPath !== r.newPath)
        const pending: typeof renames = []
        for (const rename of renames) {
          let oldExists = false
          try { await cl.getFileInfo(rename.oldPath); oldExists = true } catch (e) {
            if (!(e instanceof OpenListNotFoundError)) throw e
          }
          if (!oldExists) continue
          let newExists = false
          try { await cl.getFileInfo(rename.newPath); newExists = true } catch (e) {
            if (!(e instanceof OpenListNotFoundError)) throw e
          }
          if (newExists) { cloudConflict = '云端目标文件名已被占用：' + rename.newName; break }
          pending.push(rename)
        }
        if (cloudConflict) { out.conflicts++; record(item, 'conflict', cloudConflict); continue }
        for (const rename of pending) {
          await cl.rename(rename.oldPath, rename.newName)
          out.cloudRenamed++
        }
      }

      // 2) 本地：音频 + .lrc + 外部封面缓存
      if (localOld) {
        const targetDir = path.dirname(item.newLocalPath)
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
        const oldStats = fs.statSync(item.oldLocalPath)
        fs.renameSync(item.oldLocalPath, item.newLocalPath)
        const newStats = fs.statSync(item.newLocalPath)
        migrateCoverCacheOnRename(item.oldFilename, item.newFilename, item.user, oldStats, newStats)
        if (item.oldLyricFilename && item.newLyricFilename && item.oldLyricFilename !== item.newLyricFilename) {
          const oldLrc = path.join(path.dirname(item.oldLocalPath), item.oldLyricFilename)
          const newLrc = path.join(path.dirname(item.newLocalPath), item.newLyricFilename)
          if (fs.existsSync(oldLrc) && !fs.existsSync(newLrc)) {
            if (!fs.existsSync(path.dirname(newLrc))) fs.mkdirSync(path.dirname(newLrc), { recursive: true })
            fs.renameSync(oldLrc, newLrc)
          }
        }
      }

      // 3) 备份库：主记录 + 本地文件登记 + 附件
      if (item.backupRowId) {
        const row = db.prepare('SELECT * FROM openlist_backup_files WHERE id = ?').get(item.backupRowId) as any
        if (row) {
          let metadata = ''
          try {
            const parsed = JSON.parse(row.cache_metadata || '{}')
            parsed.filename = item.newFilename
            if (item.newLyricFilename) parsed.lyricFilename = item.newLyricFilename
            metadata = JSON.stringify(parsed)
          } catch { metadata = row.cache_metadata || '' }
          db.prepare(`UPDATE openlist_backup_files SET local_path = ?, remote_path = ?, name = ?, cache_metadata = ?, updated_at = ? WHERE id = ?`)
            .run(item.newLocalPath, item.newRemotePath, path.basename(item.newLocalPath), metadata, Date.now(), row.id)
          db.prepare(`UPDATE openlist_local_files SET local_path = ?, filename = ?, updated_at = ? WHERE user = ? AND local_path = ?`)
            .run(item.newLocalPath, path.basename(item.newLocalPath), Date.now(), row.user, row.local_path)

          for (const att of item.attachments) {
            db.prepare('UPDATE openlist_backup_attachments SET local_path = ?, remote_path = ?, updated_at = ? WHERE id = ?')
              .run(att.newLocalPath ?? att.oldLocalPath, att.newRemotePath, Date.now(), att.id)
            // 本地附件文件（如 .lrc）与音频同 stem，随音频一起改名
            if (att.oldLocalPath && att.newLocalPath && fs.existsSync(att.oldLocalPath) && !fs.existsSync(att.newLocalPath)) {
              fs.renameSync(att.oldLocalPath, att.newLocalPath)
            }
          }
          out.dbUpdated++
        }
      }

      // 4) 本地缓存索引：直接改引用再 save，避免 update 重建 key 导致旧条目残留
      const index = indexManager.getAll(item.user, item.folder, item.location)
      const indexItem = index.find(i => i.filename === item.oldFilename || i.filename === item.newFilename)
      if (indexItem) {
        indexItem.filename = item.newFilename
        if (item.newLyricFilename) indexItem.lyricFilename = item.newLyricFilename
        indexManager.save(item.user, item.folder, item.location)
      }

      out.renamed++
      record(item, 'ok')
    } catch (e: any) {
      out.failed++
      record(item, 'failed', String(e?.message || e))
    }
  }
  return out
}
