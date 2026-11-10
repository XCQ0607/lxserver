import { buildLyrics } from '../../utils/lrcTool'

export function normalizeDownloadLyricSong(song: any) {
  const meta = song.meta || {}
  const source = String(song.source || meta.source || '')
  let songmid = String(song.songmid || song.songId || meta.songmid || meta.songId || song.id || '')
  if (source && songmid.startsWith(`${source}_`)) songmid = songmid.slice(source.length + 1)
  const normalized = { ...meta, ...song, source, songmid, id: songmid }
  for (const key of ['hash', 'interval', 'copyrightId', 'albumId', 'lrcUrl', 'mrcUrl', 'trcUrl']) {
    normalized[key] = song[key] || meta[key] || ''
  }
  return normalized
}

/** Use the authenticated owner's existing lyrics before requesting the source. */
export async function resolveSongLyricData(song: any, owner: string, lookup: (song: any, owner: string) => any, sdk: any, preferLocal = true, strictIdentity = true): Promise<any> {
  const normalized = normalizeDownloadLyricSong(song)
  if (!normalized.source || !normalized.songmid) throw new Error('缺少歌曲平台或 ID')
  const local = (includeEmbedded = false) => {
    if (!preferLocal) return null
    try {
      const found = lookup({ ...normalized, strictIdentity, includeEmbedded }, owner)
      return found.exists && (found.content?.lyric || found.content?.lrc)?.trim() ? { ...found.content, _fromLocalCache: true } : null
    } catch { return null }
  }
  const cached = local()
  if (cached) return cached
  try {
    if (!sdk[normalized.source]?.getLyric) throw new Error('音源不支持歌词')
    const request = sdk[normalized.source].getLyric(normalized)
    const result = await (request.promise || request)
    if (!(result?.lyric || result?.lrc)?.trim()) throw new Error('音源未返回歌词')
    return result
  } catch (error) {
    const fallback = local(true)
    if (fallback) return fallback
    throw error
  }
}

export async function resolveDownloadLyrics(song: any, owner: string, lookup: (song: any, owner: string) => any, sdk: any): Promise<string> {
  const result = await resolveSongLyricData(song, owner, lookup, sdk)
  // Standard timed text remains readable by third-party players; omit the private awlrc payload.
  return buildLyrics(result, false)
}
