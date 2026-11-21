import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as fileCache from '../music/fileCache'
import * as cacheUpgrade from '../music/cacheUpgrade'

export type ServerDownloadStatus = 'waiting' | 'downloading' | 'tagging' | 'paused' | 'finished' | 'exists' | 'error'

export interface ServerDownloadTask {
  id: string
  username: string
  songKey: string
  activeSongKey?: string
  songInfo: any
  quality: string
  requestedQuality: string
  cacheUpgrade?: true
  enableAutoSwitchApiSource?: boolean
  status: ServerDownloadStatus
  progress: number
  total: number
  received: number
  speed: number
  errorMsg: string
  enableOnlyDownloadMode: boolean
  cacheLyric: boolean
  embedLyric: boolean
  createdAt: number
  updatedAt: number
}

interface QueueInput {
  id?: string
  cacheUpgrade?: boolean
  songInfo: any
  quality?: string
  enableAutoSwitchApiSource?: boolean
  enableOnlyDownloadMode?: boolean
  cacheLyric?: boolean
  embedLyric?: boolean
}

interface ResolveResult {
  url: string
  quality?: string
  songInfo?: any
  requestedSource?: string
  downloadSource?: string
  sourceName?: string
}

type DownloadResolver = (task: ServerDownloadTask, signal: AbortSignal) => Promise<ResolveResult>

const DEFAULT_CONCURRENT = 3
const MAX_CONCURRENT_PER_USER = 5
const UPGRADE_PREFIX = 'lx_upgrade_'
const MAX_QUEUED_UPGRADES = 20
const MAX_ACCOUNT_UPGRADES = 4
const MAX_UPGRADE_HISTORY = 128
const UPGRADE_RETRY_MS = 10 * 60_000
const MAX_UPGRADE_AGE_MS = 30 * 60_000
let activeUpgrade: string | undefined
const tasks = new Map<string, ServerDownloadTask>()
const controllers = new Map<string, AbortController>()
const concurrencyByUser = new Map<string, number>()
let resolver: DownloadResolver | null = null
let initialized = false
let processing = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const taskMapKey = (username: string, id: string) => `${username}:${id}`
const getRuntimeDir = () => {
  const dir = path.join(global.lx.dataPath, 'runtime')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

const getQueueFile = () => path.join(getRuntimeDir(), 'server-download-queue.json')
const validStatuses = new Set<ServerDownloadStatus>(['waiting', 'downloading', 'tagging', 'paused', 'finished', 'exists', 'error'])

const normalizeConcurrency = (value: unknown) => {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENT
  return Math.min(MAX_CONCURRENT_PER_USER, Math.max(1, parsed))
}

export const getConcurrency = (username: string) => concurrencyByUser.get(username) || DEFAULT_CONCURRENT

const sanitizeId = (value: unknown) => {
  const id = String(value || '')
  return !id.startsWith(UPGRADE_PREFIX) && /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : `server_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const upgradeId = (username: string, song: any, quality: string) =>
  UPGRADE_PREFIX + createHash('sha256').update(JSON.stringify(
    [username, song.source, fileCache.normalizeSongId(song), cacheUpgrade.canonicalUpgradeQuality(quality)],
  )).digest('hex').slice(0, 32)

const pruneUpgrades = () => {
  const now = Date.now()
  const cutoff = now - MAX_UPGRADE_AGE_MS
  for (const [key, task] of tasks) {
    if (!task.cacheUpgrade || controllers.has(key)) continue
    const expired = ['error', 'finished', 'exists'].includes(task.status)
      ? now - task.updatedAt >= UPGRADE_RETRY_MS : task.createdAt < cutoff
    if (expired) tasks.delete(key)
  }
}

const saveNow = () => {
  if (!initialized) return
  const file = getQueueFile()
  const tempFile = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tempFile, JSON.stringify({
      version: 2,
      concurrencyByUser: Object.fromEntries(concurrencyByUser),
      tasks: Array.from(tasks.values()),
    }, null, 2), 'utf8')
    fs.renameSync(tempFile, file)
  } catch (err) {
    console.warn('[下载队列] 保存任务失败:', err)
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile) } catch (e) { }
  }
}

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, 150)
}

const loadTasks = () => {
  const file = getQueueFile()
  if (!fs.existsSync(file)) return
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const savedTasks = Array.isArray(data) ? data : data?.tasks
    if (!Array.isArray(savedTasks)) return
    if (!Array.isArray(data) && data?.concurrencyByUser && typeof data.concurrencyByUser === 'object') {
      for (const [username, value] of Object.entries(data.concurrencyByUser)) {
        concurrencyByUser.set(username, normalizeConcurrency(value))
      }
    }
    for (const raw of savedTasks) {
      if (!raw || !raw.username || !raw.songInfo) continue
      const savedStatus = validStatuses.has(raw.status) ? raw.status as ServerDownloadStatus : 'waiting'
      const status: ServerDownloadStatus = savedStatus === 'downloading' || savedStatus === 'tagging' ? 'waiting' : savedStatus
      const quality = String(raw.quality || raw.requestedQuality || '320k')
      const requestedQuality = String(raw.requestedQuality || quality)
      const isUpgrade = raw.cacheUpgrade === true
      const songInfo = isUpgrade ? cacheUpgrade.sanitizeCacheUpgradeSong(raw.songInfo) : raw.songInfo
      const now = Date.now()
      if (isUpgrade && (!songInfo || !cacheUpgrade.canUpgradeForAccount(raw.username) ||
          !cacheUpgrade.validateUpgradeInput(songInfo, requestedQuality) ||
          Number(raw.createdAt || 0) < now - MAX_UPGRADE_AGE_MS)) continue
      const id = isUpgrade ? upgradeId(raw.username, songInfo, requestedQuality) : sanitizeId(raw.id)
      const task: ServerDownloadTask = {
        id,
        ...(isUpgrade ? { cacheUpgrade: true as const, enableAutoSwitchApiSource: raw.enableAutoSwitchApiSource !== false } : {}),
        username: String(raw.username),
        songKey: String(raw.songKey || `${fileCache.normalizeSongId(songInfo)}_${requestedQuality}`),
        activeSongKey: status === 'waiting' ? undefined : raw.activeSongKey ? String(raw.activeSongKey) : undefined,
        songInfo,
        quality: status === 'waiting' ? requestedQuality : quality,
        requestedQuality,
        status,
        progress: status === 'waiting' ? 0 : Number(raw.progress || 0),
        total: status === 'waiting' ? 0 : Number(raw.total || 0),
        received: status === 'waiting' ? 0 : Number(raw.received || 0),
        speed: 0,
        errorMsg: status === 'waiting' ? '' : String(raw.errorMsg || ''),
        enableOnlyDownloadMode: !!raw.enableOnlyDownloadMode,
        cacheLyric: raw.cacheLyric !== false,
        embedLyric: raw.embedLyric !== false,
        createdAt: Number(raw.createdAt || now),
        updatedAt: isUpgrade ? Number(raw.updatedAt || raw.createdAt || now) : now,
      }
      tasks.set(taskMapKey(task.username, task.id), task)
    }
    console.log(`[下载队列] 已恢复 ${tasks.size} 个持久化下载任务`)
  } catch (err) {
    console.warn('[下载队列] 恢复队列任务失败:', err)
  }
}

const liveProgress = (task: ServerDownloadTask) => task.activeSongKey
  ? fileCache.cacheProgress.get(task.cacheUpgrade ? cacheUpgrade.getUpgradeProgressKey(task.activeSongKey, task.username)
    : fileCache.getProgressKey(task.activeSongKey, task.username))
  : undefined

const getPublicTask = (task: ServerDownloadTask) => {
  const live = task.status === 'downloading' ? liveProgress(task) : undefined
  const liveStatus = live?.status as ServerDownloadStatus | undefined
  return {
    id: task.id,
    songKey: task.activeSongKey || task.songKey,
    songInfo: task.songInfo,
    quality: task.quality,
    requestedQuality: task.requestedQuality,
    ...(task.cacheUpgrade ? { cacheUpgrade: true as const } : {}),
    status: liveStatus || task.status,
    progress: Number(live?.progress ?? task.progress ?? 0),
    total: Number(live?.total ?? task.total ?? 0),
    received: Number(live?.received ?? task.received ?? 0),
    speed: Number(live?.speed ?? task.speed ?? 0),
    errorMsg: String(live?.errorMsg || task.errorMsg || ''),
    createdAt: task.createdAt,
    updatedAt: Number(live?.updatedAt || task.updatedAt),
  }
}

const runTask = async (task: ServerDownloadTask) => {
  if (!resolver || task.status !== 'waiting') return
  const key = taskMapKey(task.username, task.id)
  const controller = new AbortController()
  controllers.set(key, controller)
  if (task.cacheUpgrade) activeUpgrade = key
  task.status = 'downloading'
  task.progress = 0
  task.total = 0
  task.received = 0
  task.speed = 0
  task.errorMsg = ''
  task.updatedAt = Date.now()
  scheduleSave()

  try {
    const original = task.songInfo
    if (task.cacheUpgrade) {
      if (!cacheUpgrade.canUpgradeForAccount(task.username)) throw new Error('Cache upgrade account is unavailable')
      if (cacheUpgrade.hasExactUpgradeCopy(original, task.requestedQuality, task.username)) {
        task.status = 'exists'
        task.progress = 100
        return
      }
    }
    const resolved = await resolver(task, controller.signal)
    if (controller.signal.aborted) return
    if (!resolved?.url) throw new Error('无法解析下载地址')
    if (task.cacheUpgrade) {
      if (resolved.quality && !cacheUpgrade.isSameUpgradeTier(resolved.quality, task.requestedQuality)) {
        throw new Error('Cache upgrade returned a different quality')
      }
      task.activeSongKey = fileCache.normalizeSongId(original) + '_' + task.requestedQuality
      const status = await cacheUpgrade.downloadCacheUpgrade(original, resolved.url, task.requestedQuality,
        task.username, controller.signal, {
          requestedSource: resolved.requestedSource,
          downloadSource: resolved.downloadSource,
          sourceName: resolved.sourceName,
        })
      if (controller.signal.aborted) return
      const progress = liveProgress(task)
      task.status = status
      task.progress = 100
      task.total = Number(progress?.total || 0)
      task.received = Number(progress?.received || task.total)
      return
    }
    task.songInfo = resolved.songInfo || task.songInfo
    task.quality = resolved.quality || task.requestedQuality
    task.activeSongKey = fileCache.normalizeSongId(task.songInfo) + '_' + task.quality
    task.updatedAt = Date.now()
    scheduleSave()

    await fileCache.downloadAndCache(task.songInfo, resolved.url, task.quality, task.username, controller.signal,
      task.enableOnlyDownloadMode, task.cacheLyric, task.embedLyric, {
      requestedSource: resolved.requestedSource,
      downloadSource: resolved.downloadSource,
      sourceName: resolved.sourceName,
    })

    if (controller.signal.aborted) return
    const progress = liveProgress(task)
    task.status = progress?.status === 'exists' ? 'exists' : 'finished'
    task.progress = 100
    task.total = Number(progress?.total || progress?.received || task.total || 0)
    task.received = Number(progress?.received || task.total || 0)
    task.speed = 0
    task.errorMsg = ''
  } catch (err: any) {
    if (controller.signal.aborted) {
      // pause/resume owns the requested state while the previous run unwinds.
    } else if (err?.message === 'Aborted') {
      task.status = 'paused'
      task.errorMsg = '已暂停'
    } else {
      task.status = 'error'
      task.errorMsg = err?.message || '下载失败'
    }
    task.speed = 0
  } finally {
    if (controllers.get(key) === controller) controllers.delete(key)
    if (activeUpgrade === key) activeUpgrade = undefined
    task.updatedAt = Date.now()
    scheduleSave()
    void processQueue()
  }
}

const processQueue = async () => {
  if (processing || !resolver) return
  processing = true
  try {
    pruneUpgrades()
    while (true) {
      const waiting = Array.from(tasks.values()).filter(task =>
        task.status === 'waiting' && !controllers.has(taskMapKey(task.username, task.id)))
      const waitingManual = waiting.filter(task => !task.cacheUpgrade)
      // Explicit downloads take priority. Let an automatic transfer unwind
      // before it can restart, but never make a manual download wait for it.
      if (waitingManual.length && activeUpgrade) {
        const automatic = tasks.get(activeUpgrade)
        if (automatic?.status === 'downloading') {
          automatic.status = 'waiting'
          automatic.activeSongKey = undefined
          controllers.get(activeUpgrade)?.abort()
        }
      }
      const activeByUser = new Map<string, number>()
      for (const key of controllers.keys()) {
        const active = tasks.get(key)
        if (!active || active.cacheUpgrade) continue
        activeByUser.set(active.username, (activeByUser.get(active.username) || 0) + 1)
      }
      const manual = waitingManual.find(task => (activeByUser.get(task.username) || 0) < getConcurrency(task.username))
      const next = manual || (!waitingManual.length && !controllers.size && !activeUpgrade ? waiting[0] : undefined)
      if (!next) break
      void runTask(next)
    }
  } finally {
    processing = false
  }
}

export const setConcurrency = (username: string, value: unknown) => {
  const concurrency = normalizeConcurrency(value)
  concurrencyByUser.set(username, concurrency)
  saveNow()
  void processQueue()
  return concurrency
}

export const initialize = (downloadResolver: DownloadResolver) => {
  resolver = downloadResolver
  if (!initialized) {
    initialized = true
    loadTasks()
    saveNow()
  }
  void processQueue()
}

export const enqueue = (username: string, inputs: QueueInput[]) => {
  inputs = inputs.map(input => {
    if (input?.cacheUpgrade !== true) return input
    const song = cacheUpgrade.sanitizeCacheUpgradeSong(input.songInfo)
    if (!song || !cacheUpgrade.canUpgradeForAccount(username) ||
        !cacheUpgrade.validateUpgradeInput(song, input.quality || '')) {
      throw new Error('Cache upgrade unavailable for account, track or quality')
    }
    return { ...input, songInfo: song }
  })
  pruneUpgrades()
  const added: ServerDownloadTask[] = []
  for (const input of inputs) {
    if (!input?.songInfo) continue
    const isUpgrade = input.cacheUpgrade === true
    const quality = input.quality || '320k'
    const id = isUpgrade ? upgradeId(username, input.songInfo, quality) : sanitizeId(input.id)
    const key = taskMapKey(username, id)
    const existing = tasks.get(key)
    if (existing) {
      if (['waiting', 'downloading', 'tagging'].includes(existing.status) ||
          (isUpgrade && (existing.status === 'paused' || Date.now() - existing.updatedAt < UPGRADE_RETRY_MS))) {
        if (isUpgrade) added.push(existing)
        continue
      }

      const now = Date.now()
      existing.songKey = fileCache.normalizeSongId(input.songInfo) + '_' + quality
      existing.activeSongKey = undefined
      existing.songInfo = input.songInfo
      existing.quality = quality
      existing.requestedQuality = quality
      if (isUpgrade) existing.enableAutoSwitchApiSource = input.enableAutoSwitchApiSource !== false
      existing.status = 'waiting'
      existing.progress = 0
      existing.total = 0
      existing.received = 0
      existing.speed = 0
      existing.errorMsg = ''
      existing.enableOnlyDownloadMode = !isUpgrade && !!input.enableOnlyDownloadMode
      existing.cacheLyric = input.cacheLyric !== false
      existing.embedLyric = input.embedLyric !== false
      existing.createdAt = now
      existing.updatedAt = now
      added.push(existing)
      continue
    }
    if (isUpgrade) {
      const automatic = Array.from(tasks.values()).filter(task => task.cacheUpgrade)
      const pending = automatic.filter(task => ['waiting', 'downloading', 'tagging'].includes(task.status))
      if (automatic.length >= MAX_UPGRADE_HISTORY || pending.length >= MAX_QUEUED_UPGRADES ||
          pending.filter(task => task.username === username).length >= MAX_ACCOUNT_UPGRADES) continue
    }
    const now = Date.now()
    const task: ServerDownloadTask = {
      id, username,
      ...(isUpgrade ? { cacheUpgrade: true as const, enableAutoSwitchApiSource: input.enableAutoSwitchApiSource !== false } : {}),
      songKey: fileCache.normalizeSongId(input.songInfo) + '_' + quality,
      songInfo: input.songInfo,
      quality,
      requestedQuality: quality,
      status: 'waiting', progress: 0, total: 0, received: 0, speed: 0, errorMsg: '',
      enableOnlyDownloadMode: !isUpgrade && !!input.enableOnlyDownloadMode,
      cacheLyric: input.cacheLyric !== false,
      embedLyric: input.embedLyric !== false,
      createdAt: now, updatedAt: now,
    }
    tasks.set(key, task)
    added.push(task)
  }
  saveNow()
  void processQueue()
  return added.map(task => getPublicTask(task))
}

export const list = (username: string, options: { id?: string; includeUpgrades?: boolean } = {}) => Array.from(tasks.values())
  .filter(task => task.username === username && (options.id ? task.id === options.id : options.includeUpgrades !== false || !task.cacheUpgrade))
  .sort((a, b) => a.createdAt - b.createdAt)
  .map(task => getPublicTask(task))

export const pause = (username: string, id?: string) => {
  for (const task of tasks.values()) {
    if (task.username !== username || (id && task.id !== id)) continue
    if (!['waiting', 'downloading', 'tagging'].includes(task.status)) continue
    task.status = 'paused'
    task.speed = 0
    task.errorMsg = '已暂停'
    task.updatedAt = Date.now()
    controllers.get(taskMapKey(username, task.id))?.abort()
  }
  saveNow()
}

export const resume = (username: string, id?: string) => {
  for (const task of tasks.values()) {
    if (task.username !== username || (id && task.id !== id)) continue
    if (task.status !== 'paused' && task.status !== 'error') continue
    if (task.cacheUpgrade && (!id || task.status !== 'paused' || Date.now() - task.createdAt >= MAX_UPGRADE_AGE_MS)) continue
    task.status = 'waiting'
    task.progress = 0
    task.total = 0
    task.received = 0
    task.speed = 0
    task.errorMsg = ''
    task.activeSongKey = undefined
    task.quality = task.requestedQuality
    task.updatedAt = Date.now()
  }
  saveNow()
  void processQueue()
}

export const remove = (username: string, options: { id?: string; all?: boolean; completed?: boolean }) => {
  for (const [key, task] of tasks) {
    if (task.username !== username || (task.cacheUpgrade && task.id !== options.id)) continue
    const shouldRemove = options.all || (options.id && task.id === options.id) || (options.completed && ['finished', 'exists'].includes(task.status))
    if (!shouldRemove) continue
    controllers.get(key)?.abort()
    tasks.delete(key)
  }
  saveNow()
  void processQueue()
}
