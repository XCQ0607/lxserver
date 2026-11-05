import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type http from 'node:http'
import { getUserDirname } from '@/user'
import { getCacheList, getCacheDir, getUserCacheLocation, syncCacheIndex } from './fileCache'
import { getCustomMusicDir, syncCustomIndex } from './customMusicManager'
import { withCacheBrowseLocation } from './cacheBrowseLocation'

const { MusicTagger } = require('music-tag-native')
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)
export const isLocalSong = (id: string) => id.startsWith('local_')
export const isLocalEntity = (id: string) => /^(local_|lalb_|lart_)/.test(id)
const mime: Record<string, string> = { mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', ape: 'audio/x-ape' }

export interface LocalTrack {
  id: string
  root: string
  filename: string
  size: number
  mtime: number
  title: string
  artist: string
  album: string
  albumArtist: string
  albumId: string
  artistId: string
  duration: number
  suffix: string
  contentType: string
  bitRate: number
  samplingRate: number
  bitDepth: number
  track: number
  discNumber: number
  year: number
  genre: string
  platformId?: string
}
interface Registry { tracks: Record<string, LocalTrack> }
export interface LocalPlaylist { name: string; ids: string[]; created: string; changed: string; standalone: boolean }
interface UserState { playlists: Record<string, LocalPlaylist>; starred: Record<string, string> }
const locks = new Map<string, Promise<unknown>>()
const catalogs = new Map<string, { key: string; at: number; tracks: LocalTrack[] }>()
const scans = new Map<string, { scanning: boolean; count: number; error?: string }>()
const pending = new Map<string, Promise<LocalTrack[]>>()

function userFile(user: string, name: string) {
  return path.join(global.lx.userPath, getUserDirname(user), name)
}
function read<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (err: any) {
    if (err.code === 'ENOENT') return fallback
    throw err // Never overwrite corrupt user state with an empty library.
  }
}
function write(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
  fs.renameSync(tmp, file)
}
export function readLocalState(user: string): UserState {
  return read(userFile(user, 'subsonic-local-state.json'), { playlists: {}, starred: {} })
}
export async function editLocalState<T>(user: string, fn: (state: UserState) => Promise<T> | T): Promise<T> {
  const previous = locks.get(user) || Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const state = readLocalState(user)
    const result = await fn(state)
    write(userFile(user, 'subsonic-local-state.json'), state)
    return result
  })
  locks.set(user, next)
  try { return await next } finally { if (locks.get(user) === next) locks.delete(user) }
}

/** Resolve symlinks as well as '..'; every access stays within the selected root. */
export function localFile(track: Pick<LocalTrack, 'root' | 'filename'>): string | null {
  try {
    const root = fs.realpathSync(track.root)
    const file = fs.realpathSync(path.resolve(root, track.filename))
    const relative = path.relative(root, file)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
    return fs.statSync(file).isFile() ? file : null
  } catch { return null }
}
const duration = (value: unknown) => {
  const parts = String(value || '0').split(':').map(Number)
  return parts.every(Number.isFinite) ? parts.reduce((a, b) => a * 60 + b, 0) : 0
}

/** Main roots follow persistent user settings; browsing overrides never affect this catalog. */
export function getLocalTracks(user: string, force = false): Promise<LocalTrack[]> {
  return withCacheBrowseLocation('/rest/', () => {
    const location = getUserCacheLocation(user)
    const custom = getCustomMusicDir(user)
    const key = JSON.stringify([location, custom, getCacheDir(user, false, location), getCacheDir(user, true, location)])
    const cached = catalogs.get(user)
    if (!force && cached?.key === key && Date.now() - cached.at < 30_000) return Promise.resolve(cached.tracks)
    const pendingKey = `${user}:${key}`
    const existing = pending.get(pendingKey)
    if (existing) return existing
    const task = withCacheBrowseLocation(`/api/music/cache/list?browseLocation=${location}`, async () => {
      scans.set(user, { scanning: true, count: cached?.tracks.length || 0 })
      try {
        if (force) await syncCacheIndex(user)
        const items: Array<{ item: any; root: string }> = (await getCacheList(user)).map(item => ({
          item, root: getCacheDir(user, item.folder === 'music', location),
        }))
        if (custom) {
          for (const item of await syncCustomIndex(user)) items.push({ item, root: custom })
          if (getCustomMusicDir(user) !== custom) throw new Error('Custom music directory changed during scan; retry the request')
        }
        const file = userFile(user, 'subsonic-local-registry.json')
        const registry = read<Registry>(file, { tracks: {} })
        const tracks: LocalTrack[] = []
        const seen = new Set<string>()
        for (const { item, root } of items) {
          const resolved = localFile({ root, filename: item.filename })
          if (!resolved || seen.has(resolved)) continue
          seen.add(resolved)
          const old = registry.tracks[resolved]
          let track: LocalTrack
          const platformId = ['wy', 'tx', 'kw', 'kg', 'mg', 'bd'].includes(item.source) ? item.id : undefined
          if (old && old.mtime === item.mtime && old.size === item.size) {
            track = { ...old, root, filename: item.filename, platformId }
          } else {
            track = {
              id: old?.id || `local_${crypto.randomUUID()}`, root, filename: item.filename,
              size: item.size, mtime: item.mtime, title: item.name, artist: item.singer || '未知歌手',
              album: item.album || '未知专辑', albumArtist: item.singer || '未知歌手',
              albumId: '', artistId: '', duration: duration(item.interval), suffix: item.ext,
              contentType: mime[item.ext] || 'application/octet-stream', bitRate: item.bitrate || 0,
              samplingRate: item.sampleRate || 0, bitDepth: item.bitDepth || 0,
              track: 0, discNumber: 0, year: 0, genre: '', platformId,
            }
            let tag: any
            try {
              tag = new MusicTagger()
              tag.loadPath(resolved)
              track.title = tag.title || track.title
              track.artist = tag.artist || track.artist
              track.album = tag.album || track.album
              track.duration = tag.duration ? tag.duration / 1000 : track.duration
              track.bitRate = tag.bitRate || track.bitRate
              track.samplingRate = tag.sampleRate || track.samplingRate
              track.bitDepth = tag.bitDepth || track.bitDepth
              track.albumArtist = tag.albumArtist || track.artist
              track.track = tag.trackNumber || 0
              track.discNumber = tag.discNumber || 0
              track.year = tag.year || 0
              track.genre = tag.genre || ''
            } catch { /* Existing scanner metadata remains usable. */ }
            finally { tag?.dispose() }
          }
          track.artistId = `lart_${hash(track.albumArtist.trim().toLowerCase())}`
          // Keep editions in different directories separate, including unknown albums.
          track.albumId = `lalb_${hash(JSON.stringify([path.dirname(resolved), track.album, track.albumArtist]))}`
          registry.tracks[resolved] = track
          tracks.push(track)
        }
        write(file, registry)
        catalogs.set(user, { key, tracks, at: Date.now() })
        scans.set(user, { scanning: false, count: tracks.length })
        return tracks
      } catch (err: any) {
        scans.set(user, { scanning: false, count: cached?.tracks.length || 0, error: err.message })
        throw err
      } finally { pending.delete(pendingKey) }
    })
    pending.set(pendingKey, task)
    return task
  })
}
export const getLocalScanStatus = (user: string) => scans.get(user) || { scanning: false, count: 0 }
export async function findLocalTrack(user: string, id: string) {
  return (await getLocalTracks(user)).find(track => track.id === id)
}
export function localMusic(track: LocalTrack): LX.Music.MusicInfo {
  return { id: track.id, name: track.title, singer: track.artist, source: 'local', interval: String(track.duration),
    meta: { albumName: track.album, localTrack: track } } as any
}
export function localSong(track: LocalTrack, user: string) {
  const { root, filename, platformId, mtime, ...data } = track
  const state = readLocalState(user)
  return { ...data, duration: Math.floor(track.duration), name: track.title, parent: track.albumId, isDir: false, isVideo: false, type: 'music',
    coverArt: track.id, path: filename.replace(/\\/g, '/'), created: new Date(mtime).toISOString(),
    comment: platformId ? 'NAS 本地 · 已关联在线平台' : 'NAS 本地 · 未关联在线平台',
    lxStorage: 'local', lxLinked: !!platformId,
    ...(state.starred[track.id] ? { starred: state.starred[track.id] } : {}),
  }
}
export function localAlbums(tracks: LocalTrack[]) {
  const groups = new Map<string, LocalTrack[]>()
  for (const track of tracks) {
    if (!groups.has(track.albumId)) groups.set(track.albumId, [])
    groups.get(track.albumId)!.push(track)
  }
  return [...groups].map(([id, songs]) => ({ id, name: songs[0].album, title: songs[0].album,
    artist: songs[0].albumArtist, artistId: songs[0].artistId, coverArt: songs[0].id,
    songCount: songs.length, duration: Math.floor(songs.reduce((n, t) => n + t.duration, 0)),
    year: songs[0].year, genre: songs[0].genre, isDir: true,
    created: new Date(songs.reduce((time, t) => Math.max(time, t.mtime), 0)).toISOString(),
  }))
}
export function localArtists(tracks: LocalTrack[]) {
  const groups = new Map<string, LocalTrack[]>()
  for (const track of tracks) {
    if (!groups.has(track.artistId)) groups.set(track.artistId, [])
    groups.get(track.artistId)!.push(track)
  }
  return [...groups].map(([id, songs]) => ({ id, name: songs[0].albumArtist,
    albumCount: new Set(songs.map(t => t.albumId)).size, songCount: songs.length, coverArt: songs[0].id }))
}
export function localLyrics(track: LocalTrack): string {
  const file = localFile(track)
  if (!file) return ''
  const lyric = track.filename.replace(/\.[^.]+$/, '.lrc')
  const lyricFile = localFile({ root: track.root, filename: lyric })
  if (lyricFile) {
    const text = fs.readFileSync(lyricFile, 'utf8').replace(/^\uFEFF/, '')
    if (text.trim()) return text
  }
  let tag: any
  try { tag = new MusicTagger(); tag.loadPath(file); return tag.lyrics || '' }
  catch { return '' } finally { tag?.dispose() }
}
export function localCover(track: LocalTrack): { data: Buffer; mime: string } | null {
  const file = localFile(track)
  if (!file) return null
  let tag: any
  try {
    tag = new MusicTagger(); tag.loadPath(file)
    const picture = tag.pictures?.find((p: any) => p.data?.length)
    if (picture) return { data: Buffer.from(picture.data), mime: picture.mimeType || 'image/jpeg' }
  } catch { /* Try an adjacent cover image. */ } finally { tag?.dispose() }
  for (const name of ['cover.jpg', 'folder.jpg', 'cover.png', 'folder.png']) {
    const cover = localFile({ root: track.root, filename: path.join(path.dirname(track.filename), name) })
    if (cover) return { data: fs.readFileSync(cover), mime: name.endsWith('.png') ? 'image/png' : 'image/jpeg' }
  }
  return null
}

export function serveLocalTrack(req: http.IncomingMessage, res: http.ServerResponse, track: LocalTrack, download: boolean) {
  const file = localFile(track)
  if (!file) { res.writeHead(404); res.end(); return }
  const size = fs.statSync(file).size
  let start = 0, end = size - 1
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, size - Number(match[2]))
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
    } else start = -1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return
    }
  }
  if (download) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`)
  res.setHeader('Content-Type', track.contentType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Length', Math.max(0, end - start + 1))
  if (req.headers.range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  res.statusCode = req.headers.range ? 206 : 200
  if (req.method === 'HEAD' || size === 0) { res.end(); return }
  const stream = fs.createReadStream(file, { start, end })
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

/** Preserve local entries when the online playlist is replaced; append newly synced online IDs. */
export function mergeLocalPlaylist(online: string[], overlay?: LocalPlaylist): string[] {
  if (!overlay) return online
  if (overlay.standalone) return overlay.ids
  const present = new Set(online)
  const ids = overlay.ids.filter(id => isLocalSong(id) || present.has(id))
  const seen = new Set(ids)
  return [...ids, ...online.filter(id => !seen.has(id))]
}
