import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
import { httpFetch } from '@/modules/utils/request.js'
import { filterMusicInfoItem } from '@/modules/utils/musicSdk/tx/singer.js'
import * as OpenCC from 'opencc-js'

const musicSdk = musicSdkRaw as any

// 电台给的歌名 / 歌手多为繁体，各平台搜索结果多为简体；zhConvert 的内置字表只覆盖高频字
// （如「約會」「孫」「煉」都不在表内），对不上歌，所以这里用完整的 OpenCC 词表。词表在首次使用时才构建。
let openccConverter: ((text: string) => string) | null = null
const toSimplified = (text: string): string => {
  const convert = openccConverter ?? (openccConverter = OpenCC.Converter({ from: 'hk', to: 'cn' }))
  return convert(text)
}
const httpFetchAny = httpFetch as any

const SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg']
const MAX_LIMIT = 50
// 相似歌曲少于这个数时，用同歌手歌曲补足，避免自动续播的队列断档
const MIN_SIMILAR = 5

export interface SimilarSeed {
  source?: string | null
  songId?: string | number | null
  songmid?: string | number | null
  name?: string | null
  singer?: string | null
  album?: string | null
}

export interface SimilarResult {
  list: any[]
  strategy: 'radio' | 'similar' | 'artist' | 'none'
}

// 电台推荐的一首歌：只有标题 / 歌手 / 时长，需要再到各平台搜索出可播放的条目
export interface RadioTrack {
  name: string
  singer: string
  duration: number // 秒，未知为 0
}

export interface SimilarDeps {
  radio: (seed: SimilarSeed) => Promise<RadioTrack[]>
  txSimilar: (songId: string) => Promise<any[]>
  search: (source: string, keyword: string, limit: number) => Promise<any[]>
  shuffle: <T>(list: T[]) => T[]
}

// 繁简统一后再比较：电台给的多为繁体，各平台搜索结果多为简体
const normalizeText = (value: unknown): string => toSimplified(String(value ?? ''))
  .toLowerCase()
  .replace(/[（(\[【].*?[）)\]】]/g, '')
  .replace(/[\s·・,，.。!！?？:：;；'"‘’“”《》<>\-_/\\]/g, '')

const splitSingers = (value: unknown): string[] => String(value ?? '')
  .split(/[、,，/&／|;；]+| 和 | feat\.? | ft\.? /i)
  .map(part => part.trim())
  .filter(Boolean)

const isSingerMatch = (a: unknown, b: unknown): boolean => {
  const left = splitSingers(a).map(normalizeText).filter(Boolean)
  const right = splitSingers(b).map(normalizeText).filter(Boolean)
  if (!left.length || !right.length) return false
  return left.some(l => right.some(r => l.includes(r) || r.includes(l)))
}

const isSameSong = (song: any, seed: SimilarSeed): boolean => {
  const name = normalizeText(song?.name)
  if (!name || name !== normalizeText(seed.name)) return false
  return !normalizeText(seed.singer) || isSingerMatch(song?.singer, seed.singer)
}

const isNumericId = (value: unknown): boolean => /^\d+$/.test(String(value ?? '')) && Number(value) > 0

// QQ 音乐「相似歌曲」：2026-11-13 实测 music.recommend.TrackRelationServer/GetSimilarSongs
// 免登录可用，按数字 songid 返回约 12 首；rcmusic.similarSongRadioServer 与网易 simiSong 免登录均返回空。
const fetchTxSimilarSongs = async (songId: string): Promise<any[]> => {
  const { statusCode, body } = await httpFetchAny('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    body: {
      comm: { cv: 4747474, ct: 24, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', uin: 0 },
      req: {
        module: 'music.recommend.TrackRelationServer',
        method: 'GetSimilarSongs',
        param: { songid: Number(songId) },
      },
    },
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)' },
  }).promise
  if (statusCode !== 200 || body?.code != 0 || body?.req?.code != 0) {
    throw new Error(`Get TX similar songs failed: ${body?.req?.code ?? body?.code ?? statusCode}`)
  }
  const songs: any[] = []
  for (const row of body.req.data?.vecSong || []) {
    const track = row?.track || row
    if (!track?.mid || !track?.file) continue
    try {
      songs.push({ ...(filterMusicInfoItem as any)(track), source: 'tx' })
    } catch {
      // 单条字段异常不影响其余结果
    }
  }
  return songs
}

const parseSeconds = (value: unknown): number => {
  if (typeof value === 'number') return value
  const parts = String(value ?? '').split(':').map(Number)
  if (!parts.length || parts.some(Number.isNaN)) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

// YouTube Music「歌曲电台」：2026-11-13 实测免登录可用，按一首歌返回约 50 首跨歌手的相关歌曲，
// 质量明显好于 QQ 相似歌曲（后者常只有几首，网易 simiSong 免登录为空，Deezer 在本地区搜索返回空）。
const YTM_CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20241106.01.00', hl: 'zh-CN', gl: 'HK' } }
// 搜索参数：只要「歌曲」类结果
const YTM_SONG_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF'

const ytmPost = async (endpoint: string, payload: Record<string, unknown>): Promise<any> => {
  const { statusCode, body } = await httpFetchAny(`https://music.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    body: { context: YTM_CONTEXT, ...payload },
    headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://music.youtube.com' },
    timeout: 15000,
  }).promise
  if (statusCode !== 200 || !body || typeof body !== 'object') throw new Error(`YouTube Music ${endpoint} failed: ${statusCode}`)
  return body
}

const collect = (node: any, key: string, out: any[] = []): any[] => {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out)
  } else if (node && typeof node === 'object') {
    for (const [k, value] of Object.entries(node)) {
      if (k === key) out.push(value)
      else collect(value, key, out)
    }
  }
  return out
}

const runsText = (node: any): string => (node?.runs || []).map((run: any) => run?.text || '').join('')

// 在搜索结果里找用户上传版本对应的原曲：标题等于专辑名，且原歌手名出现在上传的歌名 / 歌手里
export const findOriginalOfUpload = (rows: Array<{ id: string, title: string, artist: string }>, seed: SimilarSeed): string => {
  const album = normalizeText(seed.album)
  const credits = normalizeText(`${seed.name} ${seed.singer}`)
  if (!album) return ''
  for (const row of rows) {
    if (!row.id || normalizeText(row.title) !== album) continue
    const artists = splitSingers(row.artist).map(normalizeText).filter(isDistinctName)
    if (artists.some(name => credits.includes(name))) return row.id
  }
  return ''
}

// 搜索结果里第一个名字出现在上传的歌名 / 歌手里的歌手（即被翻传的原歌手）
export const creditedArtist = (rows: Array<{ artist: string }>, seed: SimilarSeed): string => {
  const credits = normalizeText(`${seed.name} ${seed.singer}`)
  for (const row of rows) {
    const hit = splitSingers(row.artist).find(name => isDistinctName(normalizeText(name)) && credits.includes(normalizeText(name)))
    if (hit) return hit
  }
  return ''
}

// 歌手名够不够长到可以拿去做子串匹配：中日韩名字两个字就算（王菲），拉丁字母至少三个
const isDistinctName = (name: string): boolean => name.length >= (/[^\x00-\x7f]/.test(name) ? 2 : 3)

const fetchYtmRadio = async (seed: SimilarSeed): Promise<RadioTrack[]> => {
  if (!seed.name) return []
  const query = [seed.name, splitSingers(seed.singer)[0]].filter(Boolean).join(' ')
  const found = await ytmPost('search', { query, params: YTM_SONG_FILTER })
  const rows = (response: any) => collect(response, 'musicResponsiveListItemRenderer').map((item: any) => {
    const columns = (item.flexColumns || []).map((column: any) => runsText(column?.musicResponsiveListItemFlexColumnRenderer?.text))
    return { id: String(collect(item, 'videoId')[0] || ''), title: String(columns[0] || ''), artist: String(columns[1] || '').split(' • ')[0] }
  })
  let videoId = ''
  for (const row of rows(found)) {
    // 标题对不上就不用：以错的歌做种子，整个电台都会跑偏
    if (!row.id || normalizeText(row.title) !== normalizeText(seed.name)) continue
    if (normalizeText(seed.singer) && !isSingerMatch(row.artist, seed.singer)) continue
    videoId = row.id
    break
  }
  // 用户上传的版本常把歌名写成别的（如「theweeknd神级现场」），真正的歌名在专辑名里：
  // 用「专辑名 + 歌名」再找一次，标题要等于专辑名，且原歌手名出现在上传的歌名 / 歌手里才算数
  const album = normalizeText(seed.album)
  if (!videoId && album && album !== normalizeText(seed.name)) {
    const retryRows = rows(await ytmPost('search', { query: `${seed.album} ${seed.name}`, params: YTM_SONG_FILTER }))
    videoId = findOriginalOfUpload(retryRows, seed)
    if (!videoId) {
      // 搜索结果不稳定，原曲不一定排得上来；但结果里通常已经出现了原歌手，用「专辑名 + 原歌手」再精确找一次
      const artist = creditedArtist([...retryRows, ...rows(found)], seed)
      if (artist) videoId = findOriginalOfUpload(rows(await ytmPost('search', { query: `${seed.album} ${artist}`, params: YTM_SONG_FILTER })), seed)
    }
  }
  if (!videoId) return []

  const next = await ytmPost('next', { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true })
  const tracks: RadioTrack[] = []
  for (const item of collect(next, 'playlistPanelVideoRenderer')) {
    // 电台的第一首就是种子歌曲本身
    if (collect(item, 'videoId')[0] === videoId) continue
    // 只要正式发行的歌曲（ATV），跳过用户上传的视频 / 合辑
    if (collect(item, 'musicVideoType')[0] !== 'MUSIC_VIDEO_TYPE_ATV') continue
    const name = runsText(item.title)
    const singer = runsText(item.longBylineText).split(' • ')[0]
    if (!name || !singer) continue
    tracks.push({ name, singer, duration: parseSeconds(runsText(item.lengthText)) })
  }
  return tracks
}

const searchSongs = async (source: string, keyword: string, limit: number): Promise<any[]> => {
  const api = musicSdk?.[source]?.musicSearch
  if (!api?.search) return []
  const data = await api.search(keyword, 1, Math.min(limit, api.limit || 20))
  return (data?.list || []).map((item: any) => ({ ...item, source }))
}

// 歌名括号里的附注，如「晴天 (Live)」里的 Live
const bracketNotes = (value: unknown): string => (String(value ?? '').match(/[（(\[【].*?[）)\]】]/g) || []).join(' ')
// 保留括号附注的比较键，用来区分同一首歌的不同版本
const versionKey = (value: unknown): string => normalizeText(String(value ?? '').replace(/[（()）\[\]【】]/g, ' '))
// 改编 / 衍生版本：DJ、Remix、不插电、Live、伴奏、加速、翻唱、「××版」等。续播只要原版。
const VARIANT_NOTE = /\b(dj|remix|mix|live|acoustic|unplugged|karaoke|instrumental|inst|sped\s*up|slowed|nightcore|cover|demo|version|ver|edit)\b|伴奏|纯音乐|现场|演唱会|不插电|加速|降调|翻唱|串烧|铃声|片段|版/i
const VARIANT_TITLE = /\b(dj|remix|nightcore)\b|dj版|伴奏|串烧/i
const isVariant = (value: unknown): boolean => {
  const name = toSimplified(String(value ?? ''))
  // 附注 = 括号里的内容，以及「歌名 - 附注」里破折号之后的部分
  const notes = `${bracketNotes(name)} ${name.split(/\s[-–—]\s/).slice(1).join(' ')}`
  return VARIANT_NOTE.test(notes) || VARIANT_TITLE.test(name)
}

// Fisher-Yates：每次请求给出不同的播放顺序
const shuffleList = <T>(list: T[]): T[] => {
  const result = [...list]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

const defaultDeps: SimilarDeps = { radio: fetchYtmRadio, txSimilar: fetchTxSimilarSongs, search: searchSongs, shuffle: shuffleList }

// 同时进行的平台搜索数，以及每首推荐最多尝试的平台数
const RESOLVE_CONCURRENCY = 5
const RESOLVE_SOURCES = 2

// 把电台推荐的一首歌对到某个平台上可播放的条目：歌名一致、歌手对得上，多个版本时取时长最接近的
const resolveRadioTrack = async (track: RadioTrack, sources: string[], deps: SimilarDeps): Promise<any | null> => {
  // 搜索词去掉括号里的附注（如「五月天 (Mayday)」「… - 电影主题曲」之类），否则容易搜不到
  const plain = (text: string) => text.replace(/[（(\[【].*?[）)\]】]/g, ' ').replace(/\s+/g, ' ').trim() || text
  const keyword = toSimplified([plain(track.name), plain(splitSingers(track.singer)[0] || '')].filter(Boolean).join(' '))
  for (const source of sources.slice(0, RESOLVE_SOURCES)) {
    let candidates: any[]
    try {
      candidates = await deps.search(source, keyword, 10)
    } catch {
      continue
    }
    const matches = candidates.filter(item => normalizeText(item?.name) === normalizeText(track.name) && isSingerMatch(item?.singer, track.singer))
    // 优先连括号附注都一致的版本，并剔除伴奏 / Live / Remix 之类的衍生版本
    const exact = matches.filter(item => versionKey(item?.name) === versionKey(track.name))
    const usable = (exact.length ? exact : matches).filter(item => !isVariant(item?.name))
    if (!usable.length) continue
    if (!track.duration) return usable[0]
    const distance = (item: any) => {
      const seconds = parseSeconds(item?.interval)
      return seconds ? Math.abs(seconds - track.duration) : 30
    }
    return usable.reduce((best, item) => (distance(item) < distance(best) ? item : best))
  }
  return null
}

const resolveRadioTracks = async (tracks: RadioTrack[], sources: string[], deps: SimilarDeps): Promise<any[]> => {
  const resolved: any[] = new Array(tracks.length).fill(null)
  let cursor = 0
  const worker = async () => {
    while (cursor < tracks.length) {
      const index = cursor++
      resolved[index] = await resolveRadioTrack(tracks[index], sources, deps)
    }
  }
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, tracks.length) }, worker))
  return resolved.filter(Boolean)
}

// 同一首种子歌的结果缓存一段时间：预读与正式续播、以及重复点播都会再问一次
const CACHE_TTL = 6 * 60 * 60 * 1000
const CACHE_MAX = 200
const resultCache = new Map<string, { expires: number, result: SimilarResult }>()

const resolveTxSongId = async (seed: SimilarSeed, deps: SimilarDeps): Promise<string | null> => {
  if (seed.source === 'tx' && isNumericId(seed.songId)) return String(seed.songId)
  if (!seed.name) return null
  const keyword = [seed.name, splitSingers(seed.singer)[0]].filter(Boolean).join(' ')
  const candidates = await deps.search('tx', keyword, 10)
  const seedMid = seed.source === 'tx' && seed.songmid ? String(seed.songmid) : ''
  const match = (seedMid && candidates.find(item => String(item.songmid) === seedMid)) ||
    candidates.find(item => isSameSong(item, seed))
  const id = match?.songId ?? match?.id
  return isNumericId(id) ? String(id) : null
}

/**
 * 以一首歌为种子取推荐歌曲（搜索播放结束后的自动续播用）。
 * 依次尝试：YouTube Music 歌曲电台（跨歌手的相关歌曲，再对回各平台）→ QQ 音乐相似歌曲 → 同歌手歌曲，
 * 前一级凑不够 MIN_SIMILAR 首才用后一级补足。
 */
export const fetchSimilarSongs = async (
  seed: SimilarSeed,
  limit = 30,
  deps: SimilarDeps = defaultDeps
): Promise<SimilarResult> => {
  const safeLimit = Math.min(Math.max(parseInt(String(limit)) || 30, 1), MAX_LIMIT)
  const cacheKey = deps === defaultDeps
    ? [seed.source, normalizeText(seed.name), normalizeText(splitSingers(seed.singer)[0]), normalizeText(seed.album), safeLimit].join('|')
    : ''
  const cached = cacheKey ? resultCache.get(cacheKey) : undefined
  let result = cached && cached.expires > Date.now() ? cached.result : null
  if (!result) {
    result = await buildSimilarSongs(seed, safeLimit, deps)
    if (cacheKey && result.list.length) {
      if (resultCache.size >= CACHE_MAX) resultCache.delete(resultCache.keys().next().value as string)
      resultCache.set(cacheKey, { expires: Date.now() + CACHE_TTL, result })
    }
  }
  // 缓存的是候选池，每次返回前重新打乱，同一首种子歌每次续播的顺序都不同
  return { ...result, list: deps.shuffle(result.list) }
}

const buildSimilarSongs = async (seed: SimilarSeed, safeLimit: number, deps: SimilarDeps): Promise<SimilarResult> => {
  const list: any[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const add = (song: any): boolean => {
    if (!song?.name || isSameSong(song, seed)) return false
    // 不推荐种子歌曲自己的其他版本（翻唱、DJ 版等），也不推荐任何衍生版本
    const baseName = normalizeText(song.name)
    if (!baseName || baseName === normalizeText(seed.name) || isVariant(song.name)) return false
    const rawId = song.songmid ?? song.songId ?? song.id ?? song.hash ?? song.copyrightId
    const idKey = rawId == null ? '' : `${song.source}_${rawId}`
    // 同名歌曲只留一首：另一位歌手的同名歌多半是同一首歌的翻唱
    const nameKey = baseName
    if ((idKey && seenIds.has(idKey)) || seenNames.has(nameKey)) return false
    if (idKey) seenIds.add(idKey)
    seenNames.add(nameKey)
    list.push(song)
    return true
  }

  const seedSource = SOURCES.includes(String(seed.source)) ? String(seed.source) : ''
  let strategy: SimilarResult['strategy'] = 'none'
  try {
    // 种子歌曲所在的平台优先：用户刚从那里播过，可播放的把握最大
    const sources = [...new Set([seedSource, 'tx', 'kw'].filter(Boolean))]
    const tracks = (await deps.radio(seed))
      .filter(track => normalizeText(track.name) !== normalizeText(seed.name) && !isVariant(track.name))
      .slice(0, safeLimit)
    for (const song of await resolveRadioTracks(tracks, sources, deps)) add(song)
    if (list.length) strategy = 'radio'
  } catch (err: any) {
    console.warn('[相似歌曲] 获取歌曲电台失败:', err?.message || err)
  }

  if (list.length < MIN_SIMILAR) {
    try {
      const txSongId = await resolveTxSongId(seed, deps)
      if (txSongId) {
        const before = list.length
        for (const song of await deps.txSimilar(txSongId)) add(song)
        if (list.length > before && strategy === 'none') strategy = 'similar'
      }
    } catch (err: any) {
      console.warn('[相似歌曲] 获取相似歌曲失败:', err?.message || err)
    }
  }

  const singer = splitSingers(seed.singer)[0]
  if (list.length < MIN_SIMILAR && singer) {
    const fallbackSources = [...new Set([seedSource, 'tx', 'kw'].filter(Boolean))]
    for (const source of fallbackSources) {
      const before = list.length
      try {
        for (const song of await deps.search(source, singer, 30)) {
          if (isSingerMatch(song.singer, singer)) add(song)
        }
      } catch (err: any) {
        console.warn(`[相似歌曲] ${source} 同歌手歌曲获取失败:`, err?.message || err)
      }
      if (list.length > before) {
        if (strategy === 'none') strategy = 'artist'
        break
      }
    }
  }

  return { list: list.slice(0, safeLimit), strategy }
}
