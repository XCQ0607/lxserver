import { withSourceRequestSignal } from '../sources/requestScope'
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
// 电台候选不足时尝试补充 QQ 的歌曲级关联推荐
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
  incomplete?: true // provider/time budget omitted possible higher-ranked matches
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
const normalizeText = (value: unknown): string => toSimplified(String(value ?? '').normalize('NFKC'))
  .toLowerCase()
  .replace(/[（(\[【].*?[）)\]】]/g, '')
  .replace(/[\s·・,，.。!！?？:：;；'"‘’“”《》<>\-_/\\]/g, '')

// Catalogs usually use 、 between performers. An unspaced slash or ampersand
// can belong to a single artist (AC/DC, B&O); don't take the first fragment.
const splitSingers = (value: unknown): string[] => String(value ?? '')
  .split(/[、,，|;；]+|\s+(?:[&/／]|和|feat\.?|ft\.?)\s+/i)
  .map(part => part.trim()).filter(Boolean)

const artistKey = (value: string): string => toSimplified(value.normalize('NFKC')).toLowerCase()
  .replace(/[\p{P}\p{Z}\s]+/gu, '')
const eastAsian = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const artistKeys = (artist: string): string[] => {
  const name = artist.normalize('NFKC').trim()
  const aliases = /^([^()]+)\(([^()]+)\)$/.exec(name)
  // A localized name can also be listed under its explicit transliteration.
  if (aliases && eastAsian.test(aliases[1]) !== eastAsian.test(aliases[2])) {
    return [name, aliases[1], aliases[2]].map(artistKey).filter(Boolean)
  }
  return [artistKey(name)].filter(Boolean)
}
const isSingerMatch = (a: unknown, b: unknown): boolean => {
  const left = splitSingers(a), right = splitSingers(b)
  const sameArtist = (x: string, y: string) => artistKeys(x).some(key => artistKeys(y).includes(key))
  // The first credit is the lead, not interchangeable with a featured guest.
  if (!left.length || !right.length || !sameArtist(left[0], right[0])) return false
  if (right.length === 1) return true
  // When the seed names co-performers require those credits, too; a solo
  // recording with the same lead and title isn't necessarily the same track.
  return left.length === right.length && left.every(x => right.some(y => sameArtist(x, y))) &&
    right.every(y => left.some(x => sameArtist(x, y)))
}

// Featured performers can be represented by explicit title annotations instead
// of linked artist runs. Never infer a performer from arbitrary title words.
const featureNote = /^(?:合作(?:音乐|音樂)人\s*[：:]\s*|(?:feat(?:uring)?|ft)\.?\s+)(.+)$/i
const recordingCredits = (title: unknown, singer: unknown): string => {
  const names = splitSingers(singer)
  if (!names.length) return '' // a featured guest cannot establish the lead
  for (const m of String(title ?? '').matchAll(/[（(\[【]([^）)\]】]*)[）)\]】]/g)) {
    const guest = featureNote.exec(m[1].trim())?.[1]
    if (guest) for (const name of splitSingers(guest)) {
      if (!names.some(n => artistKey(n) === artistKey(name))) names.push(name)
    }
  }
  return names.join('、')
}

const recordingMatches = (a: {name?: string | null, singer?: string | null, source?: string | null},
  b: {name?: string | null, singer?: string | null, source?: string | null}): boolean => {
  if (!titlesMatch(a.name, b.name)) return false
  const left = recordingCredits(a.name, a.singer), right = recordingCredits(b.name, b.singer)
  if (isSingerMatch(left, right)) return true
  // Kuwo renders every ampersand as 、, including one inside e.g. "C&K".
  // Only if the other side supplies that literal band spelling, compare the
  // entire ordered sequence after applying the same lossy SDK transformation.
  const kwBand = (kw: string, canonical: string) => /\S&\S/.test(canonical) &&
    splitSingers(kw).map(artistKey).join('|') === splitSingers(canonical.replace(/(\S)&(?=\S)/g, '$1、')).map(artistKey).join('|')
  return (a.source === 'kw' && kwBand(left, right)) || (b.source === 'kw' && kwBand(right, left))
}

const isSameSong = (song: any, seed: SimilarSeed): boolean => !!song?.name && recordingMatches(song, seed)

const isNumericId = (value: unknown): boolean => /^\d+$/.test(String(value ?? '')) && Number(value) > 0

// QQ 音乐「相似歌曲」：2026-11-13 实测 music.recommend.TrackRelationServer/GetSimilarSongs
// 免登录可用，按数字 songid 返回约 12 首；rcmusic.similarSongRadioServer 与网易 simiSong 免登录均返回空。
const fetchTxSimilarSongs = async (songId: string): Promise<any[]> => {
  const { statusCode, body } = await httpFetchAny('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    timeout: 15000,
    read_timeout: 15000,
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
    timeout: 15000,
    read_timeout: 15000,
    body: { context: YTM_CONTEXT, ...payload },
    headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://music.youtube.com' },
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

const runPageType = (run: any): string | undefined => run?.navigationEndpoint?.browseEndpoint
  ?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType

const artistRuns = (text: any): string => {
  // A single credit segment may contain both unlinked and linked names.
  // A bullet starts another metadata segment (usually album or duration).
  const segments: { names: string[], linked: boolean }[] = []
  let names: string[] = [], plain = '', linked = false
  const flushPlain = () => {
    const name = plain.replace(/^\s*(?:[,&、/]|和\s+|(?:feat|ft)\.?\s+)\s*|\s*(?:[,&、/]|\s+和|\s+(?:feat|ft)\.?)\s*$/gi, '').trim()
    if (name) names.push(name)
    plain = ''
  }
  const finish = () => {
    flushPlain()
    if (names.length) segments.push({ names, linked })
    names = []; linked = false
  }
  for (const run of text?.runs || []) {
    if (run.navigationEndpoint?.browseEndpoint) {
      if (runPageType(run) !== 'MUSIC_PAGE_TYPE_ARTIST') break
      flushPlain()
      if (run.text) { names.push(run.text); linked = true }
    } else {
      const parts = String(run.text || '').split('•')
      for (const [i, part] of parts.entries()) { if (i) finish(); plain += part }
    }
  }
  finish()
  return (segments.find(s => s.linked) || segments[0])?.names.join('、') || ''
}

const searchRows = (response: any) => collect(response, 'musicResponsiveListItemRenderer').map(item => {
  const columns = (item.flexColumns || []).map((c: any) => c.musicResponsiveListItemFlexColumnRenderer?.text)
  const titleId = columns[0]?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId
  const itemId = item.playlistItemData?.videoId
  return { id: itemId && titleId && itemId !== titleId ? '' : String(itemId || titleId || ''),
    title: runsText(columns[0]), artist: artistRuns(columns[1]),
    album: columns.slice(1).flatMap((column: any) => column?.runs || [])
      .find((run: any) => runPageType(run) === 'MUSIC_PAGE_TYPE_ALBUM')?.text || '' }
})

// The album of an uploaded track can name its original song. Require the
// original artist to be credited in the upload title: an ordinary album
// containing a title track by the same singer is not an upload signal.
const uploadTitleCredits = (name: string, artist: string): boolean => {
  const norm = (v: string) => toSimplified(v.normalize('NFKC')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const credit = norm(artist), title = norm(name)
  if (!credit || artistKey(artist).length < (eastAsian.test(credit) ? 2 : 3)) return false
  if (eastAsian.test(credit)) {
    return title.split(' ').includes(credit) ||
      // CJK names need not be space-delimited before an explicit credit cue.
      new RegExp('(?:^| )' + credit + '(?:经典|神级|现场|翻唱|演唱)').test(title)
  }
  // Latin artist names may be written without spaces, immediately before a
  // Chinese upload annotation, but never match inside another Latin name.
  return new RegExp('(?:^|[^\\p{Script=Latin}\\p{N}])' + credit.split(' ').join(' *') +
    '(?=$|[^\\p{Script=Latin}\\p{N}])', 'u').test(title)
}
export const creditedArtist = (rows: Array<{ artist: string }>, seed: SimilarSeed): string => {
  for (const row of rows) {
    const hit = splitSingers(row.artist).find(a => uploadTitleCredits(seed.name || '', a))
    if (hit) return hit
  }
  return ''
}
export const findOriginalOfUpload = (rows: Array<{ id: string, title: string, artist: string }>, seed: SimilarSeed): string => {
  if (!seed.album) return ''
  return rows.find(r => r.id && !isVariant(r.title) && titlesMatch(r.title, seed.album!)
    && creditedArtist([r], seed))?.id || ''
}

export const fetchYtmRadio = async (seed: SimilarSeed, post = ytmPost): Promise<RadioTrack[]> => {
  if (!seed.name || !seed.singer?.trim()) return []
  const query = [seed.name, splitSingers(seed.singer)[0]].filter(Boolean).join(' ')
  const rows = searchRows(await post('search', { query, params: YTM_SONG_FILTER }))
  const matches = rows.filter(r => r.id && recordingMatches({name:r.title, singer:r.artist}, seed))
  const seedAlbum = versionKey(seed.album)
  const albumMatch = seedAlbum && matches.find(r => versionKey(r.album) === seedAlbum)
  // Multiple distinct recordings, with explicit conflicting album metadata:
  // prefer the exact requested album; otherwise avoid launching the wrong radio.
  if (!albumMatch && seedAlbum && new Set(matches.map(r => r.id)).size > 1 &&
      new Set(matches.map(r => versionKey(r.album)).filter(Boolean)).size > 1) return []
  let videoId = (albumMatch || matches[0])?.id || ''
  // 用户上传的版本常把歌名写成别的（如「theweeknd神级现场」），真正的歌名在专辑名里：
  // 用「专辑名 + 歌名」再找一次，标题要等于专辑名，且原歌手名出现在上传的歌名 / 歌手里才算数
  const album = normalizeText(seed.album)
  if (!videoId && album && album !== normalizeText(seed.name)) {
    const retryRows = searchRows(await post('search', { query: `${seed.album} ${seed.name}`, params: YTM_SONG_FILTER }))
    videoId = findOriginalOfUpload(retryRows, seed)
    if (!videoId) {
      // 搜索结果不稳定，原曲不一定排得上来；但结果里通常已经出现了原歌手，用「专辑名 + 原歌手」再精确找一次
      const artist = creditedArtist([...retryRows, ...rows], seed)
      if (artist) videoId = findOriginalOfUpload(searchRows(await post('search', { query: `${seed.album} ${artist}`, params: YTM_SONG_FILTER })), seed)
    }
  }
  if (!videoId) return []

  const next = await post('next', { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true })
  const tracks: RadioTrack[] = []
  for (const item of collect(next, 'playlistPanelVideoRenderer')) {
    // 电台的第一首就是种子歌曲本身
    if (!item.videoId || item.videoId === videoId) continue
    // 只要正式发行的歌曲（ATV），跳过用户上传的视频 / 合辑
    const endpoint = item.navigationEndpoint?.watchEndpoint
    if (endpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV') continue
    const name = runsText(item.title)
    const singer = artistRuns(item.longBylineText) || artistRuns(item.shortBylineText)
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
// 没有括号也没有破折号、直接跟在歌名后面的版本后缀（「稻香 Live」「七里香 Acoustic」）。
// 只认结尾的独立单词，不误伤 Alive 这类本来的歌名
const VARIANT_SUFFIX = /\S\s+(acoustic|unplugged|karaoke|instrumental|demo|cover)\s*$|\S\s*(现场版|伴奏版|纯音乐版|演唱会版)\s*$/i
const isVariant = (value: unknown): boolean => {
  const name = toSimplified(String(value ?? ''))
  // 附注 = 括号里的内容，以及「歌名 - 附注」里破折号之后的部分
  const notes = `${bracketNotes(name)} ${name.split(/\s[-–—]\s/).slice(1).join(' ')}`
  return VARIANT_NOTE.test(notes) || VARIANT_TITLE.test(name) || VARIANT_SUFFIX.test(name)
}

// Preserve part/edition/subtitle identity. Only known non-recording annotations
// (soundtrack attribution, featured credit) may differ between catalogs.
const titlesMatch = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false
  if (versionKey(a) === versionKey(b)) return true
  if (isVariant(a) || isVariant(b)) return false
  const strip = (s: string) => s.replace(/[（(\[【]([^）)\]】]*)[）)\]】]/g, (note, text: string) =>
    (/(?:主题曲|主題曲|片尾曲|片头曲|插曲)/.test(text) || featureNote.test(text.trim())) ? '' : note)
  return versionKey(strip(a)) === versionKey(strip(b))
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

// Do not count placeholders as ready tracks: unusable rows would otherwise
// suppress QQ fallback and then be discarded by the player.
const playableId = (song: any): string | undefined => song?.source &&
  [song.songmid, song.songId, song.id, song.hash, song.copyrightId]
    .filter(id => typeof id === 'string' || typeof id === 'number')
    .map(id => String(id).trim()).find(id => id && id !== 'undefined' && id !== 'null' && id !== '0')

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
    const usable = candidates.filter(item => playableId(item) && typeof item?.name === 'string' && !isVariant(item.name) &&
      recordingMatches(item, track) &&
      (!track.duration || !parseSeconds(item.interval) || Math.abs(parseSeconds(item.interval) - track.duration) <= 8))
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

// These budgets cover metadata, never the media stream. Reserve time for fallback
// when radio is unavailable, but don't make playable radio wait for a weak top-up.
const TOTAL_MS = 7500
const RADIO_MS = 5500
const MATCH_GRACE_MS = 650
const PREFIX_GRACE_MS = 650
const FIRST_CATALOG_MS = 1100
const QQ_MS = 1400
const TOP_UP_MS = 250
const ARTIST_SOURCE_MS = 1000
const deadlineAfter = (ms: number, ceiling: number) => Math.min(performance.now() + ms, ceiling)

async function inWindow<T>(deadline: number, run: (control: AbortController) => Promise<T>): Promise<T> {
  const remaining = deadline - performance.now()
  if (remaining <= 0) throw new Error('Recommendation deadline reached')
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), remaining)
  try { return await run(control) }
  finally { clearTimeout(timer); control.abort() }
}

// Each worker has only one live lookup. Split the remaining radio time if
// a second catalog is available: a slow primary cannot consume both turns.
async function searchRadioCatalog<T>(parent: AbortSignal, deadline: number, run: () => Promise<T>): Promise<T> {
  if (parent.aborted) throw parent.reason
  return inWindow(deadline, async control => {
    const abort = () => control.abort()
    parent.addEventListener('abort', abort, { once: true })
    try { return await withSourceRequestSignal(control.signal, run) }
    finally { parent.removeEventListener('abort', abort) }
  })
}

const resolveRadioTracks = async (tracks: RadioTrack[], sources: string[], deps: SimilarDeps,
  control: AbortController, deadline: number, limit: number) => {
  const resolved: any[] = new Array(tracks.length).fill(null)
  const settled = new Set<number>()
  const names = new Set<string>()
  const head = Math.min(RESOLVE_CONCURRENCY, limit, tracks.length)
  const headReady = () => Array.from({ length: head }, (_, i) => settled.has(i)).every(Boolean)
  let cursor = 0, slots = limit, incomplete = false, inPrefixGrace = false
  let grace: ReturnType<typeof setTimeout> | undefined
  const finishOrWaitForHead = () => {
    if (headReady()) control.abort()
    else {
      inPrefixGrace = true
      grace = setTimeout(() => control.abort(), PREFIX_GRACE_MS)
    }
  }
  const worker = async () => {
    while (!control.signal.aborted && slots > 0 && cursor < tracks.length) {
      const index = cursor++
      slots--
      let failedSearch = false
      const scoped = { ...deps, search: async (...args: Parameters<SimilarDeps['search']>) => {
        const now = performance.now()
        const end = args[0] === sources[0] && sources.length > 1
          ? Math.min(now + FIRST_CATALOG_MS, now + (deadline - now) / 2)
          : deadline
        try { return await searchRadioCatalog(control.signal, end, () => deps.search(...args)) }
        catch (err) { failedSearch = true; throw err }
      } }
      const song = await resolveRadioTrack(tracks[index], sources, scoped)
      if (control.signal.aborted) { incomplete = true; break }
      settled.add(index)
      const key = song && normalizeText(song.name)
      if (key) {
        resolved[index] = song
        grace ??= setTimeout(finishOrWaitForHead, MATCH_GRACE_MS)
      }
      if (!key || names.has(key)) slots++ // try a lower-ranked candidate only for an unfilled slot
      if (key) names.add(key)
      else if (failedSearch) incomplete = true
      if (inPrefixGrace && headReady()) control.abort()
    }
  }
  try {
    await Promise.all(Array.from({ length: head }, worker))
    return { songs: resolved.filter(Boolean), incomplete } // rank, not completion order
  } finally { clearTimeout(grace) }
}

// 同一首种子歌的结果缓存一段时间：预读与正式续播、以及重复点播都会再问一次
const CACHE_TTL = 6 * 60 * 60 * 1000
const CACHE_MAX = 200
// Boundaries in the unsorted pool: radio results, then QQ track relations,
// then (only if necessary) the seed artist's catalog. Never shuffle across them.
type SimilarPool = SimilarResult & { radioEnd: number, similarEnd: number }

export const similarSongsCacheKey = (seed: SimilarSeed, limit: number): string => {
  const text = (s: unknown) => String(s ?? '').normalize('NFKC').trim().toLowerCase()
  // IDs are opaque. If absent, keep full credits and edition qualifiers so
  // different recordings do not share the same six-hour recommendation pool.
  return JSON.stringify([seed.source ?? '', String(seed.songId ?? ''), String(seed.songmid ?? ''),
    text(seed.name), text(seed.singer), text(seed.album), limit])
}

const orderSimilarPool = (pool: SimilarPool, shuffle: SimilarDeps['shuffle']): SimilarResult => {
  const list: any[] = []
  let start = 0
  for (const boundary of [pool.radioEnd, pool.similarEnd, pool.list.length]) {
    const end = Math.min(boundary, pool.list.length)
    // Keep variety among close neighbors, without giving a long-shot at
    // rank 30 the same chance to autoplay first as the provider's rank 1.
    for (let i = start; i < end; i += 3) list.push(...shuffle(pool.list.slice(i, Math.min(i + 3, end))))
    start = end
  }
  return { list, strategy: pool.strategy, ...(pool.incomplete && list.length ? { incomplete: true as const } : {}) }
}

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
 * 电台候选不足时补充 QQ 相似歌曲；仅在没有歌曲级推荐时返回同歌手歌曲。
 */
export const createSimilarSongResolver = (defaults: SimilarDeps) => {
  const resultCache = new Map<string, { expires: number, result: SimilarPool }>()
  return async (seed: SimilarSeed, limit = 30, deps: SimilarDeps = defaults): Promise<SimilarResult> => {
    const safeLimit = Math.min(Math.max(parseInt(String(limit)) || 30, 1), MAX_LIMIT)
    const cacheKey = deps === defaults ? similarSongsCacheKey(seed, safeLimit) : ''
    const cached = cacheKey ? resultCache.get(cacheKey) : undefined
    let result = cached && cached.expires > Date.now() ? cached.result : null
    if (!result) {
      result = await buildSimilarSongs(seed, safeLimit, deps)
      if (cacheKey && result.list.length) {
        if (resultCache.size >= CACHE_MAX) resultCache.delete(resultCache.keys().next().value as string)
        // A brief provider outage should not turn a catalog-only or thin answer
        // into this recording's recommendations for the rest of the day.
        const ttl = !result.incomplete && result.similarEnd >= Math.min(MIN_SIMILAR, safeLimit) ? CACHE_TTL : 60_000
        resultCache.set(cacheKey, { expires: Date.now() + ttl, result })
      }
    }
    return orderSimilarPool(result, deps.shuffle)
  }
}

export const fetchSimilarSongs = createSimilarSongResolver(defaultDeps)

const buildSimilarSongs = async (seed: SimilarSeed, safeLimit: number, deps: SimilarDeps) => {
  const deadline = performance.now() + TOTAL_MS
  const minCount = Math.min(safeLimit, MIN_SIMILAR)
  const list: any[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  const add = (song: any): boolean => {
    if (!song?.name || isSameSong(song, seed)) return false
    // 不推荐种子歌曲自己的其他版本（翻唱、DJ 版等），也不推荐任何衍生版本
    const baseName = normalizeText(song.name)
    if (!baseName || baseName === normalizeText(seed.name) || isVariant(song.name)) return false
    const rawId = playableId(song)
    if (!rawId) return false
    const idKey = `${song.source}_${rawId}`
    // 同名歌曲只留一首：另一位歌手的同名歌多半是同一首歌的翻唱
    const nameKey = baseName
    if (seenIds.has(idKey) || seenNames.has(nameKey)) return false
    seenIds.add(idKey)
    seenNames.add(nameKey)
    list.push(song)
    return true
  }

  const seedSource = SOURCES.includes(String(seed.source)) ? String(seed.source) : ''
  let strategy: SimilarResult['strategy'] = 'none'
  let incomplete = false
  try {
    const sources = [...new Set([seedSource, 'tx', 'kw'].filter(Boolean))]
    const radioDeadline = deadlineAfter(RADIO_MS, deadline)
    const radio = await inWindow(radioDeadline, async control => {
      const tracks = (await withSourceRequestSignal(control.signal, () => deps.radio(seed)))
        .filter(track => normalizeText(track.name) !== normalizeText(seed.name) && !isVariant(track.name))
        .slice(0, Math.min(MAX_LIMIT, safeLimit + RESOLVE_CONCURRENCY))
      return resolveRadioTracks(tracks, sources, deps, control, radioDeadline, safeLimit)
    })
    incomplete = radio.incomplete
    for (const song of radio.songs) add(song)
    if (list.length) strategy = 'radio'
  } catch (err: any) {
    incomplete = true
    console.warn('[相似歌曲] 获取歌曲电台失败:', err?.message || err)
  }

  const radioEnd = list.length
  const fillDeadline = radioEnd ? deadlineAfter(TOP_UP_MS, deadline) : deadline
  if (list.length < minCount) {
    try {
      const similar = await inWindow(deadlineAfter(QQ_MS, fillDeadline), async control => {
        const txSongId = await withSourceRequestSignal(control.signal, () => resolveTxSongId(seed, deps))
        return txSongId ? withSourceRequestSignal(control.signal, () => deps.txSimilar(txSongId)) : []
      })
      for (const song of similar) {
        add(song)
        if (list.length >= (radioEnd ? minCount : safeLimit)) break
      }
      if (list.length > radioEnd && !radioEnd) strategy = 'similar'
    } catch (err: any) {
      console.warn('[相似歌曲] 获取相似歌曲失败:', err?.message || err)
    }
  }

  const similarEnd = list.length
  const singer = splitSingers(seed.singer)[0]
  // An artist's catalog is not evidence of a song-to-song relationship.
  // Keep it as an explicitly labelled last resort, not padding for a short radio.
  const artistCap = Math.min(3, safeLimit)
  if (!similarEnd && singer) {
    const fallbackSources = [...new Set([seedSource, 'tx', 'kw'].filter(Boolean))]
    for (const source of fallbackSources) {
      if (performance.now() >= deadline) break
      const before = list.length
      try {
        const songs = await inWindow(deadlineAfter(ARTIST_SOURCE_MS, deadline), control =>
          withSourceRequestSignal(control.signal, () => deps.search(source, singer, 30)))
        for (const song of songs) {
          if (isSingerMatch(song.singer, singer)) add(song)
          if (list.length >= artistCap) break
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

  return { list: list.slice(0, safeLimit), strategy, radioEnd, similarEnd, ...(incomplete ? { incomplete: true as const } : {}) }
}
