import { randomBytes } from 'node:crypto'
import fs, { type Stats } from 'node:fs'
import path from 'node:path'
import { isCloudRestoreRunning } from '@/utils/backupPolicy'
import { resolveContainedPath } from '../auth/security'
import { collectCacheMediaAsync } from './cacheCleanup'
import { inspectCompleteFlac, inspectCompleteMp3 } from './completeAudio'
import { DOWNLOAD_QUALITY_PRIORITY } from './downloadQuality'
import {
  extractNativeIds, extractSongMetadata, getCacheDir, getUserCacheLocation, indexManager, parseDurationSeconds,
  READ_THROUGH_CACHE_FILENAME, READ_THROUGH_STAGING_DIR, type CacheItem,
} from './fileCache'

const MAX_CAPTURE_BYTES = 96 * 1024 * 1024
const MIN_FREE_BYTES = 128 * 1024 * 1024
const captureName = /^\.lx-readthrough-[a-f0-9]{32}\.part$/
const spatialQuality = new Set(['atmos', 'atmos_plus'])
const platformSources = new Set(['tx', 'wy', 'kw', 'kg', 'mg'])

function sameFile(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

function sameDirectory(a: Stats, b: Stats) {
  return b.isDirectory() && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode
}

function policyAllowsPublish(username: string, signal?: AbortSignal) {
  const config = global.lx?.config
  return !signal?.aborted && !isCloudRestoreRunning() && config &&
    Array.isArray(config.users) && config.users.some(user => user.name === username && !user.disabled)
}

function hasEqualOrBetter(username: string, song: { source: string; id: string }, quality: string, location: string) {
  const comparedTiers = DOWNLOAD_QUALITY_PRIORITY.slice(0, DOWNLOAD_QUALITY_PRIORITY.findIndex(tier => tier === quality) + 1)
  for (const folder of ['music', 'cache'] as const) {
    const directory = getCacheDir(username, folder === 'music', location, false)
    const index = indexManager.load(username, folder, location, false)
    for (const tier of comparedTiers) {
      if (spatialQuality.has(tier)) continue
      const item = index.get(`${song.id}_${tier}`)
      if (!item || item.source !== song.source || item.audioContainer === 'encrypted') continue
      try {
        const file = fs.lstatSync(resolveContainedPath(directory, item.filename))
        if (file.isFile() && file.size > 0 && (!item.size || item.size === file.size)) return true
      } catch { /* Missing or unreadable copies are not playable. */ }
    }
  }
  return false
}

async function hasRoom(directory: string, incoming: number, signal?: AbortSignal) {
  const config = global.lx?.config
  if (config?.['user.enableCacheSizeLimit']) {
    const limit = Number(config['user.cacheSizeLimit']) * 1024 * 1024
    if (!Number.isFinite(limit) || limit <= 0) return false
    const files = await collectCacheMediaAsync(directory)
    if (signal?.aborted) return false
    if (incoming + files.reduce((sum, file) => sum + file.size, 0) > limit) return false
  }
  const disk = await fs.promises.statfs(directory)
  return !signal?.aborted && disk.bavail * disk.bsize > incoming + MIN_FREE_BYTES
}

/** Cache a complete authenticated capture. Never touches the provider, current play or an existing asset. */
export async function publishReadThrough(
  tempPath: string, bytes: number, song: any, username: string, expectedCacheDir: string, signal?: AbortSignal,
): Promise<boolean> {
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > MAX_CAPTURE_BYTES ||
      typeof username !== 'string' || !username || ['.', '..', 'open', '_open', 'default'].includes(username) ||
      /[\\/:\0]/.test(username) || !song || typeof song !== 'object' || !policyAllowsPublish(username, signal)) return false
  let handle: fs.promises.FileHandle | undefined
  let newLink: string | undefined
  try {
    const metadata = extractSongMetadata(song)
    if (!platformSources.has(metadata.source) || !metadata.id || metadata.id.length > 200 ||
        /[\x00-\x1f]/.test(metadata.id) ||
        [metadata.name, metadata.singer, metadata.album, metadata.interval].some(value => typeof value !== 'string' || value.length > 512) ||
        typeof metadata.img !== 'string' || metadata.img.length > 2048) return false
    // Reject the offer as a unit rather than publishing incomplete provider identity.
    const nativeIds = extractNativeIds(song)
    if (nativeIds && Object.values(nativeIds).some(value => value.length > 512)) return false
    const seconds = parseDurationSeconds(metadata.interval)
    if (!Number.isFinite(seconds) || seconds < 1) return false
    const location = getUserCacheLocation(username)
    const cacheDir = path.resolve(getCacheDir(username, false, location, false))
    const stageDir = path.join(cacheDir, READ_THROUGH_STAGING_DIR)
    const candidate = path.resolve(tempPath)
    if (cacheDir !== path.resolve(expectedCacheDir) || path.dirname(candidate) !== stageDir || !captureName.test(path.basename(candidate))) return false
    const rootStat = fs.lstatSync(cacheDir)
    const stageStat = fs.lstatSync(stageDir)
    if (!rootStat.isDirectory() || !stageStat.isDirectory() || (process.platform !== 'win32' && (stageStat.mode & 0o077))) return false
    const root = fs.realpathSync(cacheDir)
    if (root !== path.join(fs.realpathSync(path.dirname(cacheDir)), path.basename(cacheDir)) ||
        fs.realpathSync(stageDir) !== path.join(root, READ_THROUGH_STAGING_DIR)) return false

    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK || 0))
    handle = await fs.promises.open(candidate, openFlags)
    const captured = await handle.stat()
    if (!captured.isFile() || captured.size !== bytes || captured.nlink !== 1 || (process.platform !== 'win32' && (captured.mode & 0o077))) return false
    const data = Buffer.allocUnsafe(bytes)
    for (let position = 0; position < bytes;) {
      if (!policyAllowsPublish(username, signal)) return false
      const { bytesRead } = await handle.read(data, position, bytes - position, position)
      if (bytesRead === 0) return false
      position += bytesRead
    }
    const isFlac = data.toString('ascii', 0, 4) === 'fLaC'
    const ext = isFlac ? 'flac' : 'mp3'
    const parsed = isFlac ? await inspectCompleteFlac(data, signal) : inspectCompleteMp3(data)
    if (!parsed) return false
    const quality = isFlac ? parsed.quality : (parsed.bitrate >= 320 ? '320k' : parsed.bitrate >= 192 ? '192k' : '128k')
    if (Math.abs(seconds - parsed.seconds) > Math.min(3, Math.max(0.6, 0.04 * seconds))) return false
    if (!(await hasRoom(root, bytes, signal))) return false
    if (process.platform !== 'win32') await handle.sync()

    // No await from this point until both the immutable link and the index
    // commit are settled. The capture singleton serializes quota accounting.
    if (!policyAllowsPublish(username, signal) || location !== getUserCacheLocation(username) ||
        fs.realpathSync(cacheDir) !== root || fs.realpathSync(stageDir) !== path.join(root, READ_THROUGH_STAGING_DIR) ||
        !sameDirectory(rootStat, fs.lstatSync(cacheDir)) || !sameDirectory(stageStat, fs.lstatSync(stageDir)) ||
        !sameFile(captured, fs.lstatSync(candidate)) ||
        hasEqualOrBetter(username, metadata, quality, location)) return false
    const filename = `lx-readthrough-${randomBytes(16).toString('hex')}.${ext}`
    const finalPath = path.join(root, filename)
    fs.linkSync(candidate, finalPath)
    newLink = finalPath
    const minute = Math.floor(Math.round(parsed.seconds) / 60)
    const second = Math.round(parsed.seconds) % 60
    const item: CacheItem = {
      ...metadata, songmid: metadata.id, origin: 'platform', folder: 'cache', readThrough: true,
      filename, mtime: captured.mtimeMs, size: bytes, interval: `${minute}:${String(second).padStart(2, '0')}`,
      ext, audioContainer: ext, quality, bitrate: parsed.bitrate, sampleRate: parsed.sampleRate,
      bitDepth: 'bitDepth' in parsed ? Number(parsed.bitDepth) : undefined,
      hasLyric: false, nativeIds,
    }
    if (!indexManager.publishNew(username, item, 'cache', location)) return false
    newLink = undefined
    return true
  } catch {
    return false
  } finally {
    if (newLink) try { fs.unlinkSync(newLink) } catch { /* Reserved unindexed orphan; never import as media. */ }
    if (handle) await handle.close().catch(() => {})
  }
}
