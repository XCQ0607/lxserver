import fs from 'node:fs'
import path from 'node:path'
import { resolveContainedPath } from '../auth/security'
import { DOWNLOAD_QUALITY_PRIORITY } from './downloadQuality'
import { indexManager, normalizeSongId, type CacheFolder, type CacheItem } from './fileCache'

// The input only filters indexed records in the authenticated cache scope. It is
// never used to construct a filesystem path or to invalidate a cache entry.
const parsePlaybackExclusions = (entries: readonly string[]) => {
    const excluded = new Set<string>()
    for (const entry of entries.slice(0, 8)) {
        if (entry.length > 4096) continue
        try {
            const pair: unknown = JSON.parse(entry)
            if (!Array.isArray(pair) || pair.length !== 2) continue
            const [folder, filename] = pair
            if (folder !== 'music' && folder !== 'cache') continue
            if (typeof filename !== 'string' || !filename || filename.includes('\0') ||
                path.isAbsolute(filename) || path.win32.isAbsolute(filename) ||
                filename.split(/[\\/]/).some(part => part === '.' || part === '..')) continue
            excluded.add(JSON.stringify([folder, filename]))
        } catch { /* Ignore malformed hints. */ }
    }
    return excluded
}

const sameTierQualities = (quality: string): string[] =>
    quality === 'hires' ? ['flac24bit'] : quality === 'flac24bit' ? ['hires'] : []

const MAX_MEMBERS = 8
const MAX_TITLE_MATCHES = 32
const MAX_DURATION_DELTA = 3
// Limit bucket arithmetic to sane finite integers, even on malformed requests.
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60
const playableExtensions = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus'])
const profile = (quality: string) => quality === 'flac24bit' ? 'hires' : quality
const rank = (quality: string) => DOWNLOAD_QUALITY_PRIORITY.findIndex(tier => tier === profile(quality))
const spatial = (quality: string) => quality === 'atmos' || quality === 'atmos_plus'

type SongKey = { id: string; source: string; signature: string | null; seconds: number }
type PlaybackHit = {
  exists: true
  url: string
  filename: string
  quality: string
  folder: CacheFolder
  memberIndex: number
  isCollision?: true
  interval?: string
  collisionSource?: string
  collisionSongmid?: string
}
type PlaybackSelection = PlaybackHit | { exists: false }

const fold = (text: string) => text.normalize('NFKC').toLowerCase()
const compact = (text: string) => fold(text).replace(/[\s·・,，.。!！?？:：;；'"‘’“”《》<>【】[\]()（）\-_/\\]/g, '')
const recordingSignature = (name: unknown, singer: unknown) => {
  if (typeof name !== 'string' || typeof singer !== 'string' || name.length > 512 || singer.length > 512) return null
  const title = compact(name)
  const artists = [...new Set(fold(singer).replace(/[（(\[【].*?[）)\]】]/g, ' ')
    .split(/[、,，/&／|;；]+| feat\.? | ft\.? /).map(compact).filter(Boolean))].sort()
  return title && artists.length ? JSON.stringify([title, artists]) : null
}

const durationSeconds = (interval: unknown) => {
  const bounded = (seconds: number) => seconds > 0 && seconds <= MAX_DURATION_SECONDS ? seconds : 0
  if (typeof interval === 'number') return bounded(interval)
  if (typeof interval !== 'string' || interval.length > 40) return 0
  const text = interval.trim()
  if (/^\d+(?:\.\d+)?$/.test(text)) return bounded(Number(text))
  const parts = text.split(':')
  if (parts.length < 2 || parts.length > 3 || !/^\d+$/.test(parts[0]) ||
      !parts.slice(1).every((part, i) => (i === parts.length - 2 ? /^\d{1,2}(?:\.\d+)?$/ : /^\d{1,2}$/).test(part) && Number(part) < 60)) return 0
  return bounded(parts.reduce((total, part) => total * 60 + Number(part), 0))
}

const matchingDuration = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= MAX_DURATION_DELTA

const readRequest = (input: unknown) => {
  if (!input || typeof input !== 'object') throw new TypeError('Invalid cache selection request')
  const body = input as Record<string, unknown>
  if (!Array.isArray(body.songs) || !body.songs.length || body.songs.length > MAX_MEMBERS ||
      typeof body.quality !== 'string' || rank(body.quality) < 0 ||
      (body.exactQuality !== undefined && typeof body.exactQuality !== 'boolean') ||
      (body.allowCrossSource !== undefined && typeof body.allowCrossSource !== 'boolean') ||
      (body.excludeFiles !== undefined && (!Array.isArray(body.excludeFiles) || body.excludeFiles.length > 8 ||
        body.excludeFiles.some(file => typeof file !== 'string' || file.length > 4096)))) {
    throw new TypeError('Invalid cache selection request')
  }
  const songs: SongKey[] = body.songs.map(song => {
    if (!song || typeof song !== 'object' || typeof song.source !== 'string' || !/^[a-z][a-z0-9]{0,15}$/.test(song.source)) {
      throw new TypeError('Invalid cache selection track')
    }
    const rawId = song.songmid || song.songId || song.id
    const idText = typeof rawId === 'number' && Number.isSafeInteger(rawId) ? String(rawId) : rawId
    if (typeof idText !== 'string' || !idText.trim() || idText.length > 384 || /[\x00-\x1f]/.test(idText) ||
        [song.name, song.singer].some(field => field !== undefined && (typeof field !== 'string' || field.length > 512))) {
      throw new TypeError('Invalid cache selection track')
    }
    return { id: normalizeSongId({ id: idText, source: song.source }), source: song.source,
      signature: recordingSignature(song.name, song.singer), seconds: durationSeconds(song.interval) }
  })
  return { songs, quality: body.quality, exact: body.exactQuality === true, allowCrossSource: body.allowCrossSource !== false,
    excluded: parsePlaybackExclusions((body.excludeFiles || []) as string[]) }
}

type PlaybackIndex = {
  revision: number
  byId: Map<string, CacheItem[]>
  byRecording: Map<string, Map<number, CacheItem[]>>
}
const playbackIndexes = new WeakMap<ReadonlyMap<string, CacheItem>, PlaybackIndex>()

// Build a view of the existing metadata index once per save/reload, not once per
// song. IDs are direct lookups; discovery inspects only nearby duration buckets.
const getView = (index: ReadonlyMap<string, CacheItem>, revision: number) => {
  const previous = playbackIndexes.get(index)
  if (previous?.revision === revision) return previous
  const view: PlaybackIndex = { revision, byId: new Map(), byRecording: new Map() }
  for (const item of index.values()) {
    if (!item || typeof item.id !== 'string' || typeof item.source !== 'string' || typeof item.quality !== 'string') continue
    const id = JSON.stringify([item.source, item.id])
    let ids = view.byId.get(id)
    if (!ids) view.byId.set(id, ids = [])
    ids.push(item)
    // Read-through offer metadata alone does not establish a cross-catalog
    // recording match; replay is limited to the exact ID that was resolved.
    if (item.readThrough) continue
    const signature = recordingSignature(item.name, item.singer)
    const seconds = durationSeconds(item.interval)
    if (!signature || !seconds) continue
    let buckets = view.byRecording.get(signature)
    if (!buckets) view.byRecording.set(signature, buckets = new Map())
    const durationBucket = Math.floor(seconds)
    let bucket = buckets.get(durationBucket)
    if (!bucket) buckets.set(durationBucket, bucket = [])
    if (bucket.length <= MAX_TITLE_MATCHES) bucket.push(item)
  }
  playbackIndexes.set(index, view)
  return view
}

type Candidate = { item: CacheItem; directory: string; folder: CacheFolder; memberIndex: number; crossId: boolean; order: number }

export function selectPlaybackCache(input: unknown, username: string): PlaybackSelection {
  const { songs, quality, exact, allowCrossSource, excluded } = readRequest(input)
  const [primary] = songs
  const scope = username === 'default' || !username ? '_open' : username
  const wanted = profile(quality)
  const wantedRank = rank(wanted)

  const candidate = (item: CacheItem, directory: string, folder: CacheFolder, memberIndex: number, crossId: boolean): Candidate | undefined => {
    if (!item.filename || typeof item.filename !== 'string' || item.audioContainer === 'encrypted' ||
        !playableExtensions.has(path.extname(item.filename).toLowerCase()) ||
        excluded.has(JSON.stringify([folder, item.filename]))) return
    const actualRank = rank(item.quality)
    if (actualRank < 0 || (exact && actualRank !== wantedRank) || actualRank < wantedRank) return
    // Spatial files need explicit compatible profiles, not a generic stereo quality fallback.
    if (actualRank !== wantedRank && spatial(item.quality) && !spatial(wanted)) return
    const storedSeconds = durationSeconds(item.interval)
    if (primary.seconds > 60 && ((storedSeconds > 0 && (storedSeconds < 60 || storedSeconds < primary.seconds * 0.5)) ||
        (item.size && item.size < 750 * 1024 && primary.seconds > 120 && item.quality === '128k'))) return
    if (crossId && (item.readThrough || recordingSignature(item.name, item.singer) !== primary.signature ||
        !matchingDuration(primary.seconds, storedSeconds))) return
    return { item, directory, folder, memberIndex, crossId, order: actualRank }
  }

  const verifyFile = ({ item, directory, folder, memberIndex, crossId }: Candidate): PlaybackHit | undefined => {
    try {
      const stat = fs.statSync(resolveContainedPath(directory, item.filename))
      if (!stat.isFile() || stat.size <= 0 || (item.size > 0 && stat.size < item.size)) return
      const url = `/api/music/cache/file/${encodeURIComponent(scope)}/${encodeURIComponent(item.filename)}?folder=${folder}`
      return { exists: true, url, filename: item.filename, quality: item.quality, folder, memberIndex,
        ...(crossId ? { isCollision: true, interval: item.interval, collisionSource: item.source, collisionSongmid: item.songmid } : {}) }
    } catch { /* Missing/stale files are simply ineligible. */ }
  }

  // No directory creation, repair, provider call, or OpenList fallback during selection.
  const indexes: Array<ReturnType<typeof indexManager.getPlaybackIndex> & { folder: CacheFolder }> = []
  const exactNames = [quality, ...sameTierQualities(quality)]
  for (const folder of ['music', 'cache'] as const) {
    const local = indexManager.getPlaybackIndex(scope, folder)
    indexes.push({ ...local, folder })
    const legacy = local.index.get(primary.id)
    // The requested tier on the primary source cannot be outranked. Read its
    // composite keys directly rather than rebuilding the recording view.
    for (const name of exactNames) {
      for (const item of [local.index.get(`${primary.id}_${name}`), legacy]) {
        if (item?.source !== primary.source || item.id !== primary.id || item.quality !== name) continue
        const ready = candidate(item, local.directory, folder, 0, false)
        const hit = ready && verifyFile(ready)
        if (hit) return hit
      }
    }
  }

  const candidates: Candidate[] = []
  const add = (...args: Parameters<typeof candidate>) => {
    const eligible = candidate(...args)
    if (eligible) candidates.push(eligible)
  }
  const knownMembers = new Map<string, number>()
  const memberKey = (track: { source: string; id: string }) => JSON.stringify([track.source, track.id])
  const agreeWithPrimary = (song: SongKey) => !!primary.signature && song.signature === primary.signature &&
    matchingDuration(primary.seconds, song.seconds)
  for (const [i, song] of songs.entries()) {
    if (i > 0 && (!allowCrossSource || song.source === primary.source || !agreeWithPrimary(song))) continue
    if (!knownMembers.has(memberKey(song))) knownMembers.set(memberKey(song), i)
  }
  const views = indexes.map(({ index, revision, directory, folder }) => ({ directory, folder, view: getView(index, revision) }))
  for (const { folder, directory, view } of views) {
    for (const [key, i] of knownMembers) {
      for (const item of view.byId.get(key) || []) add(item, directory, folder, i, i !== 0)
    }
  }
  // A matched local file can exist under an alternate provider not yet known to
  // this client. Validate the indexed recording, never just a claimed client alias.
  if (allowCrossSource && primary.signature && primary.seconds > 0) {
    const discovered: Array<{ item: CacheItem; directory: string; folder: CacheFolder }> = []
    const seenBySource = new Map<string, Set<string>>()
    let overflow = false
    for (const { folder, directory, view } of views) {
      const buckets = view.byRecording.get(primary.signature)
      for (let k = Math.floor(primary.seconds - MAX_DURATION_DELTA); k <= Math.floor(primary.seconds + MAX_DURATION_DELTA); ++k) {
        for (const item of buckets?.get(k) || []) {
          if (item.source === primary.source || !matchingDuration(primary.seconds, durationSeconds(item.interval))) continue
          let ids = seenBySource.get(item.source)
          if (!ids) seenBySource.set(item.source, ids = new Set())
          ids.add(item.id)
          if (discovered.length >= MAX_TITLE_MATCHES) { overflow = true; break }
          discovered.push({ item, directory, folder })
        }
        if (overflow) break
      }
      if (overflow) break
    }
    if (!overflow) for (const { item, directory, folder } of discovered) {
      if (!knownMembers.has(memberKey(item)) && seenBySource.get(item.source)?.size === 1) add(item, directory, folder, 0, true)
    }
  }

  candidates.sort((a, b) => a.order - b.order || Number(a.crossId) - Number(b.crossId) ||
    Number(a.folder === 'cache') - Number(b.folder === 'cache') || a.memberIndex - b.memberIndex ||
    Number(a.item.quality !== quality) - Number(b.item.quality !== quality))
  for (const eligible of candidates) {
    const hit = verifyFile(eligible)
    if (hit) return hit
  }
  return { exists: false }
}
