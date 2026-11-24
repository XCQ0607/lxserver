import { randomBytes } from 'node:crypto'
import fs, { type Stats } from 'node:fs'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { beginCloudBackup, isCloudRestoreRunning } from '@/utils/backupPolicy'
import { resolveContainedPath, resolvePublicUrl } from '../auth/security'
import { collectCacheMediaAsync } from './cacheCleanup'
import { inspectCompleteFlac, inspectCompleteMp3 } from './completeAudio'
import {
  cacheProgress, extractNativeIds, extractSongMetadata, getCacheDir, getProgressKey,
  getUserCacheLocation, indexManager, normalizeSongId, parseDurationSeconds,
} from './fileCache'

const MAX_BYTES = 96 * 1024 * 1024
const MAX_TOTAL_TIME_MS = 3 * 60_000
const MIN_FREE_BYTES = 128 * 1024 * 1024
const SUPPORTED_QUALITY = new Set(['320k', '192k', 'flac', 'hires', 'flac24bit'])
const MUSIC_SOURCES = new Set(['tx', 'wy', 'kw', 'kg', 'mg'])

export const getUpgradeProgressKey = (songKey: string, username: string) => getProgressKey(`lx-upgrade:${songKey}`, username)
export const canonicalUpgradeQuality = (quality: string) => quality === 'flac24bit' ? 'hires' : quality
export const isSameUpgradeTier = (a: string, b: string) => canonicalUpgradeQuality(a) === canonicalUpgradeQuality(b)
const upgradeAliases = (quality: string) =>
  quality === 'hires' ? ['flac24bit'] : quality === 'flac24bit' ? ['hires'] : []
export const requestedProviderQuality = (source: string, quality: string) =>
  canonicalUpgradeQuality(quality) === 'hires' && ['kw', 'kg', 'mg'].includes(source) ? 'flac24bit' : quality

/** Keep only the fields consumed by server-owned resolver and cache metadata. */
export function sanitizeCacheUpgradeSong(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const song = input as Record<string, unknown>
  const source = song.source
  if (typeof source !== 'string' || !MUSIC_SOURCES.has(source)) return null

  const readScalar = (value: unknown, max = 200) => {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) return undefined
    const text = String(value).trim()
    return text && text.length <= max && !/[\x00-\x1f]/.test(text) ? text : undefined
  }
  const rawMeta = song.meta && typeof song.meta === 'object' && !Array.isArray(song.meta) ? song.meta as Record<string, unknown> : {}
  const name = readScalar(song.name, 512), singer = readScalar(song.singer, 512)
  const interval = readScalar(song.interval, 20)
  const id = readScalar(rawMeta.songId ?? song.songmid ?? song.id)
  if (!id || !name || !singer || !interval || parseDurationSeconds(interval) <= 0) return null
  const canonicalId = normalizeSongId({ id, source })
  if (!canonicalId || canonicalId.length > 200) return null
  const meta: Record<string, string> = { songId: id.startsWith(source + '_') ? id.slice(source.length + 1) : id }
  if (!meta.songId) return null
  for (const key of ['id', 'hash', 'strMediaMid', 'copyrightId', 'albumId', 'albumMid', 'albumName']) {
    const value = readScalar(rawMeta[key], key === 'albumName' ? 512 : 200)
    if (value) meta[key] = value
  }
  return { id: canonicalId, source, name, singer, interval, meta }
}

export function canUpgradeForAccount(username: string) {
  return !!username && !['.', '..', 'open', '_open', 'default'].includes(username) && !/[\\/:\0]/.test(username) &&
    global.lx?.config?.users?.some(account => account.name === username && !account.disabled) === true
}

export function validateUpgradeInput(song: any, quality: string) {
  const id = song && normalizeSongId(song)
  const metadata = song && extractSongMetadata(song)
  return SUPPORTED_QUALITY.has(quality) && MUSIC_SOURCES.has(metadata?.source) &&
    !!id && id.length <= 200 && !/[\x00-\x1f]/.test(id) &&
    [metadata.name, metadata.singer, metadata.album].every(value => typeof value === 'string' && value.length <= 512) &&
    (typeof metadata.interval === 'string' && metadata.interval.length <= 20 || typeof metadata.interval === 'number') &&
    parseDurationSeconds(metadata.interval) >= 1
}

// Cache admission is non-destructive: an upgrade never deletes, relabels, or repairs an existing file.
export function hasExactUpgradeCopy(song: any, quality: string, username: string) {
  const id = normalizeSongId(song)
  const location = getUserCacheLocation(username)
  for (const folder of ['music', 'cache'] as const) {
    const index = indexManager.load(username, folder, location, false)
    for (const tier of [quality, ...upgradeAliases(quality)]) {
      const entry = index.get(`${id}_${tier}`)
      if (!entry?.filename || entry.source !== song.source || entry.audioContainer === 'encrypted' ||
          !isSameUpgradeTier(entry.quality, quality)) continue
      try {
        const file = fs.lstatSync(resolveContainedPath(getCacheDir(username, folder === 'music', location, false), entry.filename))
        if (file.isFile() && file.size > 0 && (!entry.size || entry.size === file.size)) return true
      } catch { /* Missing/unreadable entries are not hits. */ }
    }
  }
  return false
}

async function openAudioResponse(url: string, signal: AbortSignal, redirects = 0): Promise<IncomingMessage> {
  signal.throwIfAborted()
  // Use the existing public URL policy and pin the resolved address on every
  // hop. A configured source is not a license to fetch private hosts.
  const { url: parsed, address, family } = await resolvePublicUrl(url)
  signal.throwIfAborted()
  const protocol = parsed.protocol === 'https:' ? https : http
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = protocol.get(parsed, {
      signal, agent: false,
      lookup: ((_host: string, options: any, callback: any) => options.all
        ? callback(null, [{ address, family }]) : callback(null, address, family)) as any,
    }, resolve)
    request.once('error', reject)
    request.setTimeout(20_000, () => request.destroy(new Error('Media download timed out')))
  })
  const status = response.statusCode ?? 0
  if ([301, 302, 303, 307, 308].includes(status)) {
    response.destroy()
    if (redirects >= 5 || !response.headers.location) throw new Error('Invalid media redirect')
    return openAudioResponse(new URL(response.headers.location, parsed).href, signal, redirects + 1)
  }
  if (status !== 200 || response.headers['content-range'] ||
      (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
    response.destroy()
    throw new Error(`Unexpected media response (${status})`)
  }
  return response
}

async function hasRoom(directory: string, incoming: number) {
  const config = global.lx.config
  const limit = Number(config['user.cacheSizeLimit']) * 1024 * 1024
  if (config['user.enableCacheSizeLimit']) {
    if (!Number.isFinite(limit) || limit <= 0) return false
    const files = await collectCacheMediaAsync(directory)
    if (incoming + files.reduce((sum, file) => sum + file.size, 0) > limit) return false
  }
  const disk = await fs.promises.statfs(directory)
  return disk.bavail * disk.bsize > incoming + MIN_FREE_BYTES
}

function sameFile(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
}

interface Provenance { requestedSource?: string; downloadSource?: string; sourceName?: string }

/** Fetch and verify on the NAS. The final file is immutable and the previous variant is never touched. */
export async function downloadCacheUpgrade(song: any, url: string, requestedQuality: string, username: string,
  callerSignal: AbortSignal, provenance: Provenance,
  openResponse: (url: string, signal: AbortSignal) => Promise<IncomingMessage> = openAudioResponse): Promise<'exists' | 'finished'> {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(MAX_TOTAL_TIME_MS)])
  signal.throwIfAborted()
  if (!canUpgradeForAccount(username) || !validateUpgradeInput(song, requestedQuality) || isCloudRestoreRunning()) {
    throw new Error('Cache upgrade is unavailable for this account, track or quality')
  }
  if (hasExactUpgradeCopy(song, requestedQuality, username)) return 'exists'
  const location = getUserCacheLocation(username)
  const cacheDir = path.resolve(getCacheDir(username, false, location))
  const directoryStat = fs.lstatSync(cacheDir)
  if (!directoryStat.isDirectory()) throw new Error('Invalid playback cache location')
  const root = fs.realpathSync(cacheDir)
  if (root !== path.join(fs.realpathSync(path.dirname(cacheDir)), path.basename(cacheDir))) throw new Error('Invalid playback cache location')
  const temporary = path.join(root, `.lx-upgrade-${randomBytes(16).toString('hex')}.tmp`)
  const metadata = extractSongMetadata(song)
  const progressKey = getUpgradeProgressKey(`${metadata.id}_${requestedQuality}`, username)
  const release = beginCloudBackup()
  let tempOwned = false
  let newLink: string | undefined
  try {
    if (!(await hasRoom(root, 0))) throw new Error('Not enough cache space for an upgrade')
    const response = await openResponse(url, signal)
    const length = response.headers['content-length']
    const total = length === undefined ? 0 : Number(length)
    if (response.aborted || (length !== undefined && (!Number.isSafeInteger(total) || total <= 0 || total > MAX_BYTES))) {
      response.destroy()
      throw new Error('Invalid media size')
    }
    let received = 0
    cacheProgress.set(progressKey, { progress: 0, status: 'downloading', received, total, updatedAt: Date.now() })
    const meter = new Transform({
      transform(chunk: Buffer, _, done) {
        received += chunk.length
        if (received > MAX_BYTES) return done(new Error('Media exceeds cache upgrade size limit'))
        cacheProgress.set(progressKey, { progress: total ? Math.floor(received * 100 / total) : 0,
          status: 'downloading', received, total, updatedAt: Date.now() })
        done(null, chunk)
      },
    })
    const writer = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    writer.once('open', () => { tempOwned = true })
    await pipeline(response, meter, writer, { signal })
    if (!response.complete || !received || (total && total !== received)) throw new Error('Incomplete media download')
    cacheProgress.set(progressKey, { progress: 100, status: 'tagging', received, total: received, updatedAt: Date.now() })

    const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (process.platform === 'win32' ? 0 : (fs.constants.O_NONBLOCK || 0))
    const handle = await fs.promises.open(temporary, openFlags)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size !== received || stat.nlink !== 1) throw new Error('Unverifiable staged media')
      const data = await handle.readFile({ signal })
      const flac = data.toString('ascii', 0, 4) === 'fLaC'
      const ext = flac ? 'flac' : 'mp3'
      const format = flac ? await inspectCompleteFlac(data, signal) : inspectCompleteMp3(data)
      const expectedDuration = parseDurationSeconds(metadata.interval)
      if (!format || !isSameUpgradeTier(format.quality, requestedQuality) ||
          (!flac && format.bitrate < (requestedQuality === '320k' ? 300 : 185)) ||
          Math.abs(expectedDuration - format.seconds) > Math.min(3, Math.max(0.6, 0.04 * expectedDuration))) {
        throw new Error('Media quality, completeness or duration could not be verified')
      }
      if (!(await hasRoom(root, received))) throw new Error('Cache upgrade would exceed available space')
      if (process.platform !== 'win32') await handle.sync()

      // Commit synchronously after the final abort/location/identity checks. Never rename over an earlier file.
      signal.throwIfAborted()
      const current = fs.lstatSync(cacheDir)
      if (isCloudRestoreRunning() || !canUpgradeForAccount(username) || location !== getUserCacheLocation(username) ||
          fs.realpathSync(cacheDir) !== root || !current.isDirectory() || current.ino !== directoryStat.ino || current.dev !== directoryStat.dev ||
          !sameFile(stat, fs.lstatSync(temporary))) throw new Error('Cache upgrade permission or storage changed')
      if (hasExactUpgradeCopy(song, requestedQuality, username)) return 'exists'
      const filename = `lx-upgrade-${randomBytes(16).toString('hex')}.${ext}`
      const finalPath = path.join(root, filename)
      fs.linkSync(temporary, finalPath)
      newLink = finalPath
      const elapsed = Math.round(format.seconds)
      if (!indexManager.publishNew(username, {
        ...metadata, songmid: metadata.id, origin: 'platform', folder: 'cache', filename,
        interval: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
        mtime: stat.mtimeMs, size: received, ext, audioContainer: ext, quality: requestedQuality,
        bitrate: format.bitrate, sampleRate: format.sampleRate, bitDepth: 'bitDepth' in format ? Number(format.bitDepth) : undefined,
        hasLyric: false, nativeIds: extractNativeIds(song), ...provenance,
      }, 'cache', location, { replaceUnavailable: false })) throw new Error('Cache upgrade could not publish a new recording variant')
      newLink = undefined
      const status = { progress: 100, status: 'finished', received, total: received, updatedAt: Date.now() }
      cacheProgress.set(progressKey, status)
      setTimeout(() => { if (cacheProgress.get(progressKey) === status) cacheProgress.delete(progressKey) }, 30_000).unref()
      return 'finished'
    } finally {
      await handle.close().catch(() => {})
    }
  } finally {
    try {
      if (newLink) fs.unlinkSync(newLink)
    } finally {
      if (tempOwned) try { fs.unlinkSync(temporary) } catch { /* stale temporary cleanup can retry */ }
      if (cacheProgress.get(progressKey)?.status !== 'finished') cacheProgress.delete(progressKey)
      release()
    }
  }
}
