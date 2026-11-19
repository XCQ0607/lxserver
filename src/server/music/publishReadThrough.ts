import { randomBytes } from 'node:crypto'
import fs, { type Stats } from 'node:fs'
import path from 'node:path'
import { isCloudRestoreRunning } from '@/utils/backupPolicy'
import { resolveContainedPath } from '../auth/security'
import { DOWNLOAD_QUALITY_PRIORITY } from './downloadQuality'
import {
  extractNativeIds, extractSongMetadata, getCacheDir, getUserCacheLocation, indexManager, parseDurationSeconds,
  READ_THROUGH_CACHE_FILENAME, READ_THROUGH_STAGING_DIR, type CacheItem,
} from './fileCache'

const MAX_CAPTURE_BYTES = 32 * 1024 * 1024
const MAX_READY_BYTES = 256 * 1024 * 1024
const MAX_READY_ENTRIES = 128
const captureName = /^\.lx-readthrough-[a-f0-9]{32}\.part$/
const bitratesMpeg1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const bitratesMpeg2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const sampleRates = [44_100, 48_000, 32_000]
const spatialQuality = new Set(['atmos', 'atmos_plus'])
const platformSources = new Set(['tx', 'wy', 'kw', 'kg', 'mg'])

/** Structural, full-file MP3 admission. This validates frame boundaries, not acoustic identity. */
function inspectCompleteMp3(data: Buffer) {
  let offset = 0
  let end = data.length
  if (data.subarray(0, 3).toString('ascii') === 'ID3') {
    const version = data[3]
    const flags = data[5]
    const reservedFlags = version === 2 ? 0x3f : version === 3 ? 0x1f : 0x0f
    if (end < 10 || version < 2 || version > 4 || data[4] === 0xff || (flags & reservedFlags) ||
        data.subarray(6, 10).some(byte => byte >= 128)) return null
    offset = 10 + ((data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9])
    if (version === 4 && (flags & 0x10)) {
      if (offset + 10 > end || data.subarray(offset, offset + 3).toString('ascii') !== '3DI' ||
          !data.subarray(offset + 3, offset + 10).equals(data.subarray(3, 10))) return null
      offset += 10
    }
  }
  if (end >= 128 && data.subarray(end - 128, end - 125).toString('ascii') === 'TAG') end -= 128

  let frames = 0
  let totalSamples = 0
  let weightedBitrate = 0
  let sampleRate = 0
  while (offset < end) {
    if (offset + 4 > end) return null
    const a = data[offset], b = data[offset + 1], c = data[offset + 2], d = data[offset + 3]
    const version = (b >>> 3) & 3
    const layer = (b >>> 1) & 3
    const index = (c >>> 2) & 3
    if (a !== 0xff || (b & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || index === 3 || (d & 3) === 2) return null
    const kbps = (version === 3 ? bitratesMpeg1 : bitratesMpeg2)[c >>> 4]
    const rate = sampleRates[index] / (version === 3 ? 1 : version === 2 ? 2 : 4)
    if (!kbps || (sampleRate && rate !== sampleRate)) return null
    sampleRate = rate
    const samples = version === 3 ? 1152 : 576
    const frameLength = Math.floor(samples * 125 * kbps / rate) + ((c >>> 1) & 1)
    const mono = (d >>> 6) === 3
    const sideInfo = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17)
    if (frameLength <= 4 + ((b & 1) ? 0 : 2) + sideInfo || offset + frameLength > end) return null
    totalSamples += samples
    weightedBitrate += kbps * samples
    offset += frameLength
    frames++
  }
  if (frames < 4) return null
  const bitrate = Math.round(weightedBitrate / totalSamples)
  if (bitrate < 120) return null // No supported quality tier for noticeably lower bitrates.
  return { seconds: totalSamples / sampleRate, sampleRate, bitrate, quality: bitrate >= 320 ? '320k' : bitrate >= 192 ? '192k' : '128k' }
}

function sameFile(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

function sameDirectory(a: Stats, b: Stats) {
  return b.isDirectory() && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode
}

function policyAllowsPublish(username: string, signal?: AbortSignal) {
  const config = global.lx?.config
  return !signal?.aborted && !isCloudRestoreRunning() && config && !config['user.enableCacheSizeLimit'] &&
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

// Count reserved files on disk, not just their index entries: a crash between
// the media link and metadata commit can leave an orphan consuming capacity.
async function hasRoom(directory: string, incoming: number, signal?: AbortSignal) {
  let entries = 0
  let reservedBytes = 0
  const dir = await fs.promises.opendir(directory)
  for await (const entry of dir) {
    if (signal?.aborted) return false
    if (!READ_THROUGH_CACHE_FILENAME.test(entry.name)) continue
    const stat = await fs.promises.lstat(path.join(directory, entry.name)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (!stat) continue
    entries++
    reservedBytes += stat.size
    if (entries >= MAX_READY_ENTRIES || reservedBytes + incoming > MAX_READY_BYTES) return false
  }
  return true
}

/** Cache a complete authenticated capture. Never touches the provider, current play or an existing asset. */
export async function publishReadThrough(
  tempPath: string, bytes: number, song: any, username: string, expectedCacheDir: string, signal?: AbortSignal,
): Promise<boolean> {
  if (process.platform === 'win32') return false // No verified private ACL contract for this pilot.
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
    if (!rootStat.isDirectory() || !stageStat.isDirectory() || (stageStat.mode & 0o077)) return false
    const root = fs.realpathSync(cacheDir)
    if (root !== path.join(fs.realpathSync(path.dirname(cacheDir)), path.basename(cacheDir)) ||
        fs.realpathSync(stageDir) !== path.join(root, READ_THROUGH_STAGING_DIR)) return false

    handle = await fs.promises.open(candidate, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    const captured = await handle.stat()
    if (!captured.isFile() || captured.size !== bytes || captured.nlink !== 1 || (captured.mode & 0o077)) return false
    const data = Buffer.allocUnsafe(bytes)
    for (let position = 0; position < bytes;) {
      if (!policyAllowsPublish(username, signal)) return false
      const { bytesRead } = await handle.read(data, position, bytes - position, position)
      if (bytesRead === 0) return false
      position += bytesRead
    }
    const audio = inspectCompleteMp3(data)
    if (!audio || Math.abs(seconds - audio.seconds) > Math.min(3, Math.max(0.6, 0.04 * seconds))) return false
    if (!(await hasRoom(root, bytes, signal))) return false
    await handle.sync()

    // No await from this point until both the immutable link and the index
    // commit are settled. The capture singleton serializes quota accounting.
    if (!policyAllowsPublish(username, signal) || location !== getUserCacheLocation(username) ||
        fs.realpathSync(cacheDir) !== root || fs.realpathSync(stageDir) !== path.join(root, READ_THROUGH_STAGING_DIR) ||
        !sameDirectory(rootStat, fs.lstatSync(cacheDir)) || !sameDirectory(stageStat, fs.lstatSync(stageDir)) ||
        !sameFile(captured, fs.lstatSync(candidate)) ||
        hasEqualOrBetter(username, metadata, audio.quality, location)) return false
    const filename = `lx-readthrough-${randomBytes(16).toString('hex')}.mp3`
    const finalPath = path.join(root, filename)
    fs.linkSync(candidate, finalPath)
    newLink = finalPath
    const minute = Math.floor(Math.round(audio.seconds) / 60)
    const second = Math.round(audio.seconds) % 60
    const item: CacheItem = {
      ...metadata, songmid: metadata.id, origin: 'platform', folder: 'cache', readThrough: true,
      filename, mtime: captured.mtimeMs, size: bytes, interval: `${minute}:${String(second).padStart(2, '0')}`,
      ext: 'mp3', audioContainer: 'mp3', quality: audio.quality, bitrate: audio.bitrate, sampleRate: audio.sampleRate,
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
