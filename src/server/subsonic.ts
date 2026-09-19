import http from 'http'
import crypto from 'crypto'
import { URL } from 'url'
import { getUserSpace, getUserDirname, getUserConfig } from '@/user'
import { callUserApiGetMusicUrl } from '@/server/userApi'
import { downloadAndCache, checkCache, serveCacheFile } from '@/server/fileCache'
import {
    getSingerPic, getSingerDetail, getSingerMid, nameSimilarity,
    resolveSingerSources, getOrderedSingerSources, normalizeName as normalizeSingerName,
} from '@/server/utils/singer'
import { fetchRecommendedAlbums } from '@/server/utils/recommendAlbums'
import { fetchRecommendedSongs } from '@/server/utils/recommendSongs'
import { filterDisliked, splitSingers, type DislikeRuleSet } from '@/modules/dislike/match'
import { encodeAlbumRule } from '@/modules/dislike/utils'
import { normalizeText } from '@/server/utils/songVersion'
import { buildQueryVariants, toSimplified } from '@/server/utils/zhConvert'
import { getCachedDislikeRuleSet, invalidateDislikeCache } from '@/server/utils/dislikeCache'
import { proxyCoverImage } from '@/server/coverProxy'
import { subsonicLog } from '@/utils/log4js'
import { fetchGenres, fetchRadios, fetchPlaylistsByGenre, fetchRadioSongs, fetchPlaylistSongs, fetchSongsByGenre } from '@/server/utils/discovery'
import fs from 'fs'
import path from 'path'
// @ts-ignore
import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
import txMusicInfo from '@/modules/utils/musicSdk/tx/musicInfo.js'
import wyMusicInfo from '@/modules/utils/musicSdk/wy/musicInfo.js'
import { getMusicInfo as kgGetMusicInfo } from '@/modules/utils/musicSdk/kg/musicInfo.js'
import { getMusicInfo as mgGetMusicInfo } from '@/modules/utils/musicSdk/mg/musicInfo.js'
import bdMusicInfo from '@/modules/utils/musicSdk/bd/musicInfo.js'
import { spawn } from 'child_process'
const musicSdk = musicSdkRaw as any

// ─────────────────────────────────────────────
// 服务端签名票据密钥
// ─────────────────────────────────────────────
// 需要下发给客户端、随后由客户端原样回传的「服务器内部值」用签名令牌承载（防篡改 + 可过期）。
// 密钥取自前端访问密码，不落 URL。
function serverTicketSecret(): string {
    return String((global.lx.config as any)?.['frontend.password'] || 'lxserver-ticket')
}

/** 把错误原因压成可安全回传给客户端的一小段文本（截断 + 打码常见密钥参数） */
function briefErrorText(err: any, max = 200): string {
    let s = String(err?.message || err || '').replace(/\s+/g, ' ').trim()
    s = s.replace(/((?:key|token|api[_-]?key|apikey|password|pass|sign)=)[^&\s'"]+/gi, '$1***')
    return s.length > max ? s.slice(0, max) + '…' : s
}

// ─────────────────────────────────────────────
// [transcoding] 转码决策票据
// ─────────────────────────────────────────────
// getTranscodeDecision 下发 transcodeParams，客户端原样回传给 getTranscodeStream。
// 规范要求该值是「服务器内部值、已正确转义」，因此这里做成签名令牌（防篡改 + 可过期）。
const TRANSCODE_PARAM_TTL = 30 * 60 * 1000

function signTranscodeParams(payload: Record<string, any>): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const sig = crypto.createHmac('sha256', serverTicketSecret()).update(body).digest('hex').slice(0, 16)
    return `${body}.${sig}`
}

function verifyTranscodeParams(token: string): Record<string, any> | null {
    const [body, sig] = String(token || '').split('.')
    if (!body || !sig) return null
    const expect = crypto.createHmac('sha256', serverTicketSecret()).update(body).digest('hex').slice(0, 16)
    if (expect.length !== sig.length) return null
    try {
        if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null
    } catch { return null }
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
        if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null
        return payload
    } catch { return null }
}

// 排行榜列表封面缓存：getBoards 接口不带封面，按需抓取榜单首歌封面并按榜单缓存，避免每次 getPlaylists 都实拉
const leaderboardCoverCache = new Map<string, { ts: number; url: string }>()
const leaderboardCoverInflight = new Map<string, Promise<string>>()
const LEADERBOARD_COVER_TTL = 30 * 60 * 1000

// 共享歌单(各音源歌单)封面缓存：getList 返回的歌单项含 img，列表阶段直接记录，getCoverArt 命中即用
const sharedPlaylistCoverCache = new Map<string, string>()

/** 给 Promise 加超时（超时即 reject 并清理定时器），避免单个音源挂住整个搜索请求 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
        Promise.resolve(p).then(
            v => { clearTimeout(timer); resolve(v) },
            e => { clearTimeout(timer); reject(e) },
        )
    })
}

/** 多源结果按源轮询交错取数，避免"响应最快的源"占满全部名额 */
function interleaveBySource<T>(groups: T[][], max: number): T[] {
    const out: T[] = []
    let i = 0
    let added = true
    while (out.length < max && added) {
        added = false
        for (const g of groups) {
            if (!g || i >= g.length) continue
            out.push(g[i])
            added = true
            if (out.length >= max) break
        }
        i++
    }
    return out
}

// ─────────────────────────────────────────────
// Subsonic 服务端转码:ffmpeg 可用性检测 + 并发限流
// ─────────────────────────────────────────────
let ffmpegProbeDone = false
let ffmpegAvailable = false
async function probeFfmpeg(): Promise<boolean> {
    if (ffmpegProbeDone) return ffmpegAvailable
    try {
        await new Promise<void>((resolve) => {
            const p = spawn('ffmpeg', ['-version'])
            p.on('error', () => resolve())
            p.on('close', () => resolve())
        })
        ffmpegAvailable = true
    } catch {
        ffmpegAvailable = false
    }
    ffmpegProbeDone = true
    return ffmpegAvailable
}

class TranscodeSemaphore {
    private active = 0
    private queue: Array<() => void> = []
    constructor(private max: number) {}
    async acquire(): Promise<void> {
        if (this.active < this.max) { this.active++; return }
        await new Promise<void>((resolve) => this.queue.push(resolve))
        this.active++
    }
    release(): void {
        this.active--
        const next = this.queue.shift()
        if (next) next()
    }
}
let transcodeSemaphore: TranscodeSemaphore | null = null
function getTranscodeSemaphore(max: number): TranscodeSemaphore {
    if (!transcodeSemaphore) transcodeSemaphore = new TranscodeSemaphore(max)
    return transcodeSemaphore
}

// 推荐结果缓存：同一类型短时间内共享一次 QQ 抓取结果，避免客户端并发请求（启动瞬间
// newest/recent/random 同时打来）重复访问。缓存成功后保留较长时间，并在 QQ 失败时
// 回退到上次成功结果，确保刷新/限流时每日推荐不消失。
const recommendCache = new Map<string, { ts: number, data: any[] }>()
const RECOMMEND_CACHE_TTL = 60 * 60 * 1000
async function cachedRecommend(type: string, size: number): Promise<any[]> {
    const key = `${type}:${size}`
    const cached = recommendCache.get(key)
    const now = Date.now()
    // 新鲜且非空的结果直接返回
    if (cached && cached.data.length > 0 && now - cached.ts < RECOMMEND_CACHE_TTL) {
        return cached.data
    }
    // 抓取最新结果（内部已有重试）
    const fresh = await fetchRecommendedAlbums(type, size).catch(() => [] as any[])
    if (fresh.length > 0) {
        recommendCache.set(key, { ts: now, data: fresh })
        return fresh
    }
    // 抓取失败：若有上次成功结果（即便已过期），回退返回，避免每日推荐空白
    if (cached && cached.data.length > 0) {
        subsonicLog.warn(`[Subsonic] recommend(${type}) 刷新失败，回退到上次缓存的 ${cached.data.length} 条`)
        return cached.data
    }
    return []
}

// 封面图片的缓存 / 并发限流 / 重试逻辑已抽到 @/server/coverProxy，
// 由 handleGetCoverArt 通过 this.proxyCover(res, url) 调用。

// ─────────────────────────────────────────────
// 图片字段提取助手（星标写回原生收藏时，从源头补齐歌手头像 / 专辑封面）
// ─────────────────────────────────────────────

/** 从歌手详情对象中提取头像地址，兼容各音源字段（wy/tx 均返回 avatar） */
function extractArtistImage(info: any): string {
    if (!info || typeof info !== 'object') return ''
    return info.avatar || info.img || info.pic || info.picUrl || info.imageUrl || info.cover || info.coverUrl || ''
}

/** 从专辑歌曲列表返回中提取专辑封面（best-effort：取首曲 img），兼容各音源字段 */
function extractAlbumImage(data: any): string {
    const first = data?.list?.[0]
    const candidates = [first?.img, first?.meta?.img, data?.info?.img, data?.img, data?.pic, data?.cover, data?.coverUrl]
    for (const v of candidates) {
        if (typeof v === 'string' && v) return v
    }
    return ''
}

// ─────────────────────────────────────────────
// 模块级：Subsonic 元数据 I/O 与双向同步
// 供 SubsonicHandler 与 server.ts 的媒体库收藏接口共用，
// 实现「音流星标 ↔ 网页前端原生收藏」双向互通。
// ─────────────────────────────────────────────

export interface SubsonicMeta {
    starredAlbums: string[]
    starredArtists: string[]
    starredArtistNames: string[]
    ratings: Record<string, number>
}

function normalizeSubsonicName(name: string): string {
    return (name || '').trim().toLowerCase()
}

export function getSubsonicMetaFilePath(username: string): string {
    return path.join(global.lx.userPath, getUserDirname(username), 'subsonic-meta.json')
}

export function readSubsonicMeta(username: string): SubsonicMeta {
    try {
        const filePath = getSubsonicMetaFilePath(username)
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            return {
                starredAlbums: Array.isArray(data.starredAlbums) ? data.starredAlbums : [],
                starredArtists: Array.isArray(data.starredArtists) ? data.starredArtists : [],
                // 兼容旧版元数据：starredArtistNames 可能为 undefined
                starredArtistNames: Array.isArray(data.starredArtistNames) ? data.starredArtistNames : [],
                ratings: data.ratings && typeof data.ratings === 'object' ? data.ratings : {},
            }
        }
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to read subsonic-meta.json:', e)
    }
    return { starredAlbums: [], starredArtists: [], starredArtistNames: [], ratings: {} }
}

export function writeSubsonicMeta(username: string, meta: SubsonicMeta) {
    try {
        const filePath = getSubsonicMetaFilePath(username)
        const dirPath = path.dirname(filePath)
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
        fs.writeFileSync(filePath, JSON.stringify(meta), 'utf8')
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to write subsonic-meta.json:', e)
    }
}

/**
 * 播放历史（scrobble 上报）条目。
 * 只存 id + 时间戳：scrobble 是高频写入（音流实测 1853 次/月量级），
 * 若写入时还要回源解析歌名会显著拖慢，歌名留给读取时按需解析。
 */
export interface ScrobbleEntry {
    id: string
    time: number
}

/** 播放队列状态（savePlayQueue / getPlayQueue 跨设备续播用） */
export interface PlayQueueState {
    ids: string[]
    current?: string
    /** [indexBasedQueue] 当前曲目的 0 基索引（按索引保存/读取队列时使用） */
    currentIndex?: number
    position?: number
    changed: number
    changedBy?: string
}

/** 书签条目（getBookmarks / createBookmark / deleteBookmark）：某首歌 + 播放位置 */
export interface BookmarkEntry {
    id: string
    /** 播放位置（毫秒） */
    position: number
    comment: string
    created: number
}

const MAX_SCROBBLES = 2000
const MAX_QUEUE_IDS = 1000

function getScrobbleFilePath(username: string): string {
    return path.join(global.lx.userPath, getUserDirname(username), 'subsonic-scrobbles.json')
}

function getPlayQueueFilePath(username: string): string {
    return path.join(global.lx.userPath, getUserDirname(username), 'subsonic-playqueue.json')
}

export function readScrobbles(username: string): ScrobbleEntry[] {
    try {
        const filePath = getScrobbleFilePath(username)
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            if (Array.isArray(data)) return data.filter(it => it && typeof it.id === 'string')
        }
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to read subsonic-scrobbles.json:', e)
    }
    return []
}

export function writeScrobbles(username: string, list: ScrobbleEntry[]) {
    try {
        const filePath = getScrobbleFilePath(username)
        const dirPath = path.dirname(filePath)
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
        // 只保留最近若干条，避免长期运行后文件无限增长
        const trimmed = list.length > MAX_SCROBBLES ? list.slice(list.length - MAX_SCROBBLES) : list
        fs.writeFileSync(filePath, JSON.stringify(trimmed), 'utf8')
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to write subsonic-scrobbles.json:', e)
    }
}

export function readPlayQueue(username: string): PlayQueueState | null {
    try {
        const filePath = getPlayQueueFilePath(username)
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            if (data && Array.isArray(data.ids)) return data as PlayQueueState
        }
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to read subsonic-playqueue.json:', e)
    }
    return null
}

export function writePlayQueue(username: string, state: PlayQueueState) {
    try {
        const filePath = getPlayQueueFilePath(username)
        const dirPath = path.dirname(filePath)
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
        fs.writeFileSync(filePath, JSON.stringify({ ...state, ids: state.ids.slice(0, MAX_QUEUE_IDS) }), 'utf8')
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to write subsonic-playqueue.json:', e)
    }
}

function getBookmarkFilePath(username: string): string {
    return path.join(global.lx.userPath, getUserDirname(username), 'subsonic-bookmarks.json')
}

export function readBookmarks(username: string): BookmarkEntry[] {
    try {
        const filePath = getBookmarkFilePath(username)
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            if (Array.isArray(data)) {
                return data
                    .filter(it => it && typeof it.id === 'string')
                    .map(it => ({
                        id: it.id,
                        position: Math.max(0, Math.floor(Number(it.position) || 0)),
                        comment: typeof it.comment === 'string' ? it.comment : '',
                        created: Number(it.created) || Date.now(),
                    }))
            }
        }
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to read subsonic-bookmarks.json:', e)
    }
    return []
}

export function writeBookmarks(username: string, list: BookmarkEntry[]) {
    try {
        const filePath = getBookmarkFilePath(username)
        const dirPath = path.dirname(filePath)
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
        fs.writeFileSync(filePath, JSON.stringify(list), 'utf8')
    } catch (e) {
        subsonicLog.error('[Subsonic] Failed to write subsonic-bookmarks.json:', e)
    }
}

/**
 * [playbackReport] 客户端实时播放状态（只存内存，重启即清空）。
 * 与写盘的 scrobble 历史不同：这里保存「正在播什么 + 精确位置」，
 * 仅当 state=stopped 且 ignoreScrobble≠true 时才额外落一条播放历史。
 */
interface PlaybackReportState {
    id: string
    positionMs: number
    state: string
    playbackRate: number
    updatedAt: number
}
const playbackReportState = new Map<string, PlaybackReportState>()

// 拼音首字母边界字：每个字母取汉语拼音中最靠前的那个汉字。
// 拼音没有 I / U / V 开头，故不在表内——与主流音乐客户端的索引一致。
const PY_INDEX_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'W', 'X', 'Y', 'Z']
const PY_INDEX_BOUNDS = ['吖', '八', '嚓', '哒', '妸', '发', '旮', '哈', '讥', '咔', '垃', '妈', '拏', '噢', '妑', '七', '呥', '仨', '他', '哇', '夕', '丫', '匝']
const pyCollator = typeof Intl !== 'undefined' ? new Intl.Collator('zh-Hans-CN') : null

/**
 * 取艺术家索引分组键：英文名取首字母，中文名按拼音首字母归入 A-Z，其余归入 “#”。
 *
 * [修复] 之前只认 [A-Z]，全部中文歌手都落进同一个 “#” 分组，
 * 客户端的字母索引 / 快速跳转形同虚设，列表看起来就是一整坨没排序。
 * 判定依赖 ICU 中文排序（本机与官方 node 镜像均启用 full-icu），
 * 相比 GB2312 区位码方案不依赖字符编码。
 */
/**
 * 歌手头像用的图片降尺寸。
 *
 * 头像此前是原图直出，实测单张达 17.9MB；而 coverArtScaling 扩展只是声明、并未真正生效
 * （size 参数被忽略），生产镜像又是 `npm install --omit=dev`、sharp 并未安装，
 * 无法在服务端缩放。因此改为改写上游 URL 自带的尺寸参数，零依赖地把头像压到小图：
 *  - 腾讯：尺寸就编码在路径里 (.../T002R800x800M000xxx.jpg) -> 改成 300x300
 *  - 网易：追加或替换 ?param=300y300
 * 仅用于歌手头像场景，专辑 / 歌曲封面仍走原图以保证清晰度。
 */
export function downscaleAvatarUrl(url: string, size = 300): string {
    if (!url || typeof url !== 'string') return url
    if (/y\.gtimg\.cn\/.*\/T\d{3}R\d+x\d+M/.test(url)) {
        return url.replace(/(T\d{3}R)\d+x\d+(M)/, `$1${size}x${size}$2`)
    }
    if (/music\.126\.net/.test(url)) {
        const param = `${size}y${size}`
        if (/[?&]param=/.test(url)) return url.replace(/([?&]param=)[^&]*/, `$1${param}`)
        return url + (url.includes('?') ? '&' : '?') + `param=${param}`
    }
    return url
}

export function getArtistIndexKey(name: string): string {
    const ch = (name || '').trim().charAt(0)
    if (!ch) return '#'
    if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase()
    if (!/[\u4e00-\u9fa5]/.test(ch)) return '#'
    if (pyCollator) {
        for (let i = PY_INDEX_BOUNDS.length - 1; i >= 0; i--) {
            if (pyCollator.compare(ch, PY_INDEX_BOUNDS[i]) >= 0) return PY_INDEX_LETTERS[i]
        }
    }
    return '#'
}

/**
 * 反向同步：网页前端原生收藏(媒体库 artists/albums)变更 -> Subsonic 星标。
 * added/removed 为原生条目 {id, source, name}。
 */
export function syncNativeLibraryToSubsonic(
    username: string,
    type: 'artists' | 'albums',
    added: { id: string, source: string, name?: string }[],
    removed: { id: string, source: string, name?: string }[],
) {
    const meta = readSubsonicMeta(username)
    const artistNames = new Set(meta.starredArtistNames)
    if (type === 'artists') {
        const set = new Set(meta.starredArtists)
        for (const a of added) {
            set.add(`art_${a.source}_${a.id}`)
            if (a.name) artistNames.add(normalizeSubsonicName(a.name))
        }
        for (const a of removed) {
            set.delete(`art_${a.source}_${a.id}`)
            if (a.name) artistNames.delete(normalizeSubsonicName(a.name))
        }
        meta.starredArtists = Array.from(set)
    } else {
        const set = new Set(meta.starredAlbums)
        for (const a of added) set.add(`alb_${a.source}_${a.id}`)
        for (const a of removed) set.delete(`alb_${a.source}_${a.id}`)
        meta.starredAlbums = Array.from(set)
    }
    meta.starredArtistNames = Array.from(artistNames)
    writeSubsonicMeta(username, meta)
    subsonicLog.debug(`[Subsonic] 原生收藏(${type}) -> 星标 同步完成: +${added.length} / -${removed.length} (user=${username})`)
}

/**
 * 同一用户 subsonic-meta.json 的「读-改-写」串行化锁。
 *
 * handleSetRating / handleStar / syncDislikeToRating 三处都会对同一个文件做读-改-写且互不互斥，
 * 而中间存在 await 会让出事件循环；Subsonic 客户端批量操作时容易并发发出 star 与 setRating，
 * 后写入者会整体覆盖前者的修改，导致用户刚设置的星标或评分丢失。
 * 这里按 username 串成 Promise 链，保证同一用户的读-改-写严格顺序执行。
 */
const metaLocks = new Map<string, Promise<unknown>>()

/**
 * 同一用户 subsonic-meta.json 的「读-改-写」串行化锁。
 * 避免 handleSetRating / handleStar / syncDislikeToRating 并发写同一文件互相覆盖。
 */
function withMetaLock<T>(username: string, task: () => Promise<T>): Promise<T> {
    const prev = metaLocks.get(username) ?? Promise.resolve()
    const run = (): Promise<T> => task()
    // 前一个任务无论成功还是失败都要继续，避免一次异常卡死整条队列
    const next = prev.then(run, run)
    const tail = next.then(() => undefined, () => undefined)
    metaLocks.set(username, tail)
    tail.then(() => {
        if (metaLocks.get(username) === tail) metaLocks.delete(username)
    })
    return next
}

/**
 * 双向联动：网页端「不喜欢」(dislike) <-> Subsonic 评分(rating)。
 * 网页给某首歌点「不喜欢」时，回写该用户 subsonic-meta.json 的 ratings 映射，
 * 使 Subsonic 客户端能看到这颗低星（与正向联动 handleSetRating 共用同一份存储）：
 *   rating > 0  -> ratings[id] = rating（低星，落入 dislike 区间）
 *   rating <= 0 -> 删除 ratings[id]（恢复未评）
 * id 即 Subsonic 歌曲 id（source_songId）。模块级函数，供 server.ts 的 /api/music/dislike 直接调用。
 */
export async function syncDislikeToRating(username: string, id: string, rating: number): Promise<void> {
    if (!id) return
    try {
        await withMetaLock(username, async () => {
            const meta = readSubsonicMeta(username)
            const r = Math.max(0, Math.min(5, Math.floor(rating)))
            if (r <= 0) {
                if (meta.ratings[id] === undefined) return
                delete meta.ratings[id]
            } else {
                meta.ratings[id] = r
            }
            writeSubsonicMeta(username, meta)
            subsonicLog.debug(`[Subsonic] dislike<->rating 同步: ${id} -> ${r} (user=${username})`)
        })
    } catch (e) {
        subsonicLog.error('[Subsonic] dislike<->rating 同步失败:', e)
    }
}

/**
 * Subsonic 协议处理器
 * 实现了 OpenSubsonic 核心 API 集成
 *
 * 序列化策略：
 *  - JSON (f=json)：所有数据函数返回平铺的 JS 对象，sendResponse 直接 JSON.stringify
 *  - XML (默认)：数据函数返回 {attrs, children} 嵌套结构，toXml 负责渲染
 */
class SubsonicHandler {
    private readonly VERSION = '1.16.1'
    private readonly SERVER_VERSION = '1.0.0'

    // 预缓存歌曲 ID -> 封面 URL，避免 getCoverArt 重新请求 SDK
    private static readonly MAX_SONG_PIC_CACHE = 5000
    private songPicUrlCache = new Map<string, string>()
    // In-flight Promise 复用：避免客户端并发请求同一未缓存专辑封面时重复调用 SDK
    private albumSongFetchInFlight = new Map<string, Promise<string | null>>()

    private setSongPicUrl(id: string, url: string) {
        if (this.songPicUrlCache.size >= SubsonicHandler.MAX_SONG_PIC_CACHE) {
            const firstKey = this.songPicUrlCache.keys().next().value
            if (firstKey) this.songPicUrlCache.delete(firstKey)
        }
        this.songPicUrlCache.set(id, url)
    }

    // 在线全网搜索歌曲缓存 (ID -> MusicInfo)，确保后续 getSong / getCoverArt / getLyrics 能精准查到歌曲元数据
    private onlineSongCache = new Map<string, LX.Music.MusicInfo>()
    // [修复] onlineSongCache 真正落盘持久化：之前只是内存 Map，重启即丢，导致 kw 等回源结果无法复用
    private onlineSongCacheLoaded = false

    // Subsonic 播放缓存后台任务跟踪：username -> { songKey, controller }，用于切歌时自动取消上一首未完成的下载
    private subsonicActiveTasks = new Map<string, { songKey: string, controller: AbortController }>()

    // 固定同一关键词的在线结果顺序，避免客户端翻页时出现重复或跳项。
    private onlineSearchCache = new Map<string, { expiresAt: number, results: { music: LX.Music.MusicInfo, listId: string }[] }>()

    // 当前用户 love 列表歌曲 id 集合缓存，用于歌曲序列化时标记 starred（按用户名隔离，避免并发串号）
    private loveIdSets = new Map<string, Set<string>>()
    // [修复] 每请求缓存当前用户的评星 map(id -> 1~5)，供歌曲序列化返回 userRating，
    // 否则客户端重载后看不到星标。与 loveIdSets 同源，避免每首歌读盘。
    private userRatingsCache = new Map<string, Record<string, number>>()
    private currentUsername = ''

    private getRuntimeDir(): string {
        const dir = path.join(global.lx.dataPath, 'runtime')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        return dir
    }

    private getOnlineSongCachePath(): string {
        return path.join(this.getRuntimeDir(), 'subsonic-online-cache.json')
    }

    private getSourceErrorLogPath(): string {
        return path.join(this.getRuntimeDir(), 'subsonic-source-errors.log')
    }

    private logSourceError(tag: string, detail: string, err?: any) {
        const ts = new Date().toISOString()
        const errMsg = err?.message ?? String(err ?? '')
        const errStack = err?.stack ?? ''
        const block = `[${ts}] [${tag}] ${detail}\n  message: ${errMsg}\n${errStack ? `  stack: ${errStack}\n` : ''}---\n`
        try {
            fs.appendFileSync(this.getSourceErrorLogPath(), block)
        } catch { /* 写错误日志失败不阻塞主流程 */ }
        // 控制台精简显示
        subsonicLog.warn(`[Subsonic] 音源错误 ${tag}: ${detail} (详见 subsonic-source-errors.log)`)
    }

    private loadOnlineSongCache() {
        if (this.onlineSongCacheLoaded) return
        this.onlineSongCacheLoaded = true
        try {
            const p = this.getOnlineSongCachePath()
            if (fs.existsSync(p)) {
                const arr = JSON.parse(fs.readFileSync(p, 'utf8'))
                if (Array.isArray(arr)) {
                    for (const m of arr) if (m && m.id) this.onlineSongCache.set(m.id, m)
                    subsonicLog.debug(`[Subsonic] onlineSongCache 已从磁盘加载 ${this.onlineSongCache.size} 条`)
                }
            }
        } catch (e) {
            subsonicLog.error('[Subsonic] 加载 onlineSongCache 失败:', e)
        }
    }

    private saveOnlineSongCacheTimer: NodeJS.Timeout | null = null

    // 磁盘持久化：使用 1 秒防抖批量落盘，避免搜索/加载大专辑时并发重复写盘
    // 采用「临时文件 + rename」做原子写：避免进程在写入中途被强杀导致文件损坏
    private saveOnlineSongCache() {
        if (this.saveOnlineSongCacheTimer) return
        this.saveOnlineSongCacheTimer = setTimeout(() => {
            this.saveOnlineSongCacheTimer = null
            try {
                const p = this.getOnlineSongCachePath()
                const dir = path.dirname(p)
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
                const arr = Array.from(this.onlineSongCache.values())
                const tmp = `${p}.${process.pid}.tmp`
                fs.writeFileSync(tmp, JSON.stringify(arr), 'utf8')
                fs.renameSync(tmp, p)
            } catch (e) {
                subsonicLog.error('[Subsonic] 保存 onlineSongCache 失败:', e)
            }
        }, 1000)
    }

    private cacheOnlineSong(music: LX.Music.MusicInfo) {
        if (!music || !music.id) return
        this.loadOnlineSongCache()
        if (this.onlineSongCache.size > 5000) {
            const firstKey = this.onlineSongCache.keys().next().value
            if (firstKey) this.onlineSongCache.delete(firstKey)
        }
        this.onlineSongCache.set(music.id, music)
        this.saveOnlineSongCache()
    }

    // ─────────────────────────────────────────────
    // 鉴权
    // ─────────────────────────────────────────────

    private verifyAuth(params: URLSearchParams): string | null {
        const u = params.get('u')
        if (!u) return null

        const user = global.lx.config.users.find((user: any) => user.name === u)
        if (!user) return null

        // Token & Salt 方式 (推荐)
        const t = params.get('t')
        const s = params.get('s')
        if (t && s) {
            const hash = crypto.createHash('md5').update(user.password + s).digest('hex')
            if (hash === t.toLowerCase()) return u
        }

        // 明文密码方式 (包含 enc: 前缀处理)
        const p = params.get('p')
        if (p) {
            let password = p
            if (p.startsWith('enc:')) {
                password = Buffer.from(p.substring(4), 'hex').toString()
            }
            if (password === user.password) return u
        }

        return null
    }

    // ─────────────────────────────────────────────
    // 响应序列化
    // ─────────────────────────────────────────────

    /**
     * 发送 Subsonic 成功响应
     * @param res    HTTP 响应
     * @param data   JSON 模式：平铺的 JS 对象；XML 模式：带 attrs/children 结构的对象
     * @param format 'json' | null/其他
     */
    private sendResponse(res: http.ServerResponse, data: any, format: string) {
        const base: any = {
            status: 'ok',
            version: this.VERSION,
            type: 'lxserver',
            serverVersion: this.SERVER_VERSION,
            openSubsonic: true,
        }

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ 'subsonic-response': { ...base, ...data } }))
        } else {
            res.setHeader('Content-Type', 'text/xml; charset=utf-8')
            let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
            xml += `<subsonic-response xmlns="http://subsonic.org/restapi"`
            xml += ` status="${base.status}" version="${base.version}"`
            xml += ` type="${base.type}" serverVersion="${base.serverVersion}" openSubsonic="true">\n`
            xml += this.toXml(data)
            xml += '</subsonic-response>'
            res.end(xml)
        }
    }

    /** XML 渲染（仅 XML 路径使用）*/
    private toXml(obj: any, indent = '  '): string {
        let xml = ''
        for (const key in obj) {
            const val = obj[key]
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (!item) continue
                    xml += `${indent}<${key}${this.renderAttrs(item.attrs)}`
                    if (item.children) {
                        if (typeof item.children === 'string') {
                            xml += `>${this.escapeXml(item.children)}</${key}>\n`
                        } else {
                            xml += '>\n' + this.toXml(item.children, indent + '  ') + `${indent}</${key}>\n`
                        }
                    } else {
                        xml += ' />\n'
                    }
                }
            } else if (typeof val === 'object' && val !== null) {
                xml += `${indent}<${key}${this.renderAttrs(val.attrs)}`
                if (val.children) {
                    if (typeof val.children === 'string') {
                        xml += `>${this.escapeXml(val.children)}</${key}>\n`
                    } else {
                        xml += '>\n' + this.toXml(val.children, indent + '  ') + `${indent}</${key}>\n`
                    }
                } else {
                    xml += ' />\n'
                }
            }
        }
        return xml
    }

    private renderAttrs(attrs: any): string {
        if (!attrs) return ''
        let str = ''
        for (const k in attrs) {
            const v = String(attrs[k])
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
            str += ` ${k}="${v}"`
        }
        return str
    }

    private sendError(res: http.ServerResponse, code: number, message: string, format: string) {
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({
                'subsonic-response': {
                    status: 'failed',
                    version: this.VERSION,
                    type: 'lxserver',
                    serverVersion: this.SERVER_VERSION,
                    openSubsonic: true,
                    error: { code, message },
                },
            }))
        } else {
            res.setHeader('Content-Type', 'text/xml; charset=utf-8')
            res.end(
                `<?xml version="1.0" encoding="UTF-8"?>\n` +
                `<subsonic-response xmlns="http://subsonic.org/restapi" status="failed" version="${this.VERSION}"` +
                ` type="lxserver" serverVersion="${this.SERVER_VERSION}" openSubsonic="true">` +
                `<error code="${code}" message="${this.escapeXml(message)}"/></subsonic-response>`,
            )
        }
    }

    private escapeXml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }

    // ─────────────────────────────────────────────
    // 路由分发
    // ─────────────────────────────────────────────

    async handleRequest(req: http.IncomingMessage, res: http.ServerResponse, urlObj: URL) {
        let params = urlObj.searchParams

        // [修复] 处理 POST 请求体中的参数 (如 Feishin 客户端)
        if (req.method === 'POST') {
            try {
                const bodyParams = await new Promise<URLSearchParams>((resolve) => {
                    let body = ''
                    req.on('data', chunk => { body += chunk })
                    req.on('end', () => {
                        resolve(new URLSearchParams(body))
                    })
                })
                // 合并 URL 参数和 Body 参数
                const mergedParams = new URLSearchParams(params.toString())
                for (const key of new Set(bodyParams.keys())) {
                    if (mergedParams.has(key)) continue
                    for (const value of bodyParams.getAll(key)) mergedParams.append(key, value)
                }
                params = mergedParams
            } catch (e) {
                subsonicLog.error('[Subsonic] POST body parse error:', e)
            }
        }

        const format = params.get('f') === 'json' ? 'json' : 'xml'
        const username = this.verifyAuth(params)

        if (!username) {
            return this.sendError(res, 40, 'Wrong username or password', format)
        }
        this.currentUsername = username

        const { pathname } = urlObj
        const method = pathname.split('/').pop()?.split('.')[0] || ''

        // [starred] 预先计算当前用户 love 列表歌曲 id 集合，供歌曲序列化标记 starred（排除热路径方法）
        if (!['ping', 'getLicense', 'stream', 'download', 'getCoverArt'].includes(method)) {
            try {
                const listData = await getUserSpace(username).listManage.getListData()
                this.loveIdSets.set(username, new Set((listData.loveList || []).map((m: any) => m.id)))
            } catch (e) {
                subsonicLog.error('[Subsonic] 计算 love 列表失败:', e)
            }
            // [修复] 预读用户评星 map，供歌曲序列化返回 userRating（客户端星标显示依赖它）
            try {
                const meta = await this.getUserSubsonicMeta(username)
                this.userRatingsCache.set(username, meta.ratings || {})
            } catch (e) {
                subsonicLog.error('[Subsonic] 读取用户评星失败:', e)
            }
        }

        const logId = params.get('id')
        const logQuery = params.get('query')
        const logArtist = params.get('artist')
        const logTitle = params.get('title')
        let logDetails = `user=${username}`
        if (logId) logDetails += ` id=${logId}`
        if (logQuery) logDetails += ` query="${logQuery}"`
        if (logArtist) logDetails += ` artist="${logArtist}"`
        if (logTitle) logDetails += ` title="${logTitle}"`

        if (global.lx.config['subsonic.enableDebug']) {
            subsonicLog.debug(`[Subsonic Debug] ${req.method} /${method} (${format}) ${logDetails}`)
            // [实测] 完整记录客户端发来的所有参数，用于确认真实请求到底带了哪些字段（密码脱敏）
            const rawParams: Record<string, string> = {}
            // 脱敏：明文密码(p / password) 与令牌认证(t=md5(密码+salt) / s=salt) 均不得落入日志
            const SENSITIVE_KEYS = new Set(['p', 'password', 't', 's'])
            params.forEach((v, k) => {
                rawParams[k] = SENSITIVE_KEYS.has(k) ? '***' : v
            })
            subsonicLog.debug(`[Subsonic RAW] /${method} ${JSON.stringify(rawParams)}`)
        }

        try {
            switch (method) {
                case 'ping':
                    return this.sendResponse(res, {}, format)

                case 'getLicense':
                    return this.handleGetLicense(res, format)

                case 'getPlaylists':
                    return this.handleGetPlaylists(res, username, format)

                case 'getPlaylist':
                    return this.handleGetPlaylist(res, username, params, format)

                case 'getAlbum':
                    return this.handleGetAlbum(res, username, params, format)

                case 'getSong':
                    return this.handleGetSong(res, username, params, format)

                case 'stream':
                case 'download':
                    return this.handleStream(req, res, username, params, format)

                case 'getCoverArt':
                    return this.handleGetCoverArt(req, res, username, params, format)

                case 'getUser':
                    return this.handleGetUser(res, username, params, format)

                case 'getMusicFolders':
                    return this.handleGetMusicFolders(res, format)

                case 'getMusicDirectory':
                    return this.handleGetMusicDirectory(res, username, params, format)

                case 'getAlbumInfo':
                case 'getAlbumInfo2':
                    return this.handleGetAlbumInfo(res, username, params, format)

                case 'getGenres':
                    return this.handleGetGenres(res, username, format)

                case 'getInternetRadioStations':
                    return this.handleGetInternetRadioStations(res, format)

                case 'getAlbumList':
                    return this.handleGetAlbumList(res, username, params, format, false)

                case 'getAlbumList2':
                    return this.handleGetAlbumList(res, username, params, format, true)

                case 'getTranscodeDecision':
                    return this.handleGetTranscodeDecision(res, username, params, format)

                case 'getTranscodeStream':
                    return this.handleGetTranscodeStream(req, res, username, params, format)

                case 'getLyrics':
                    return this.handleGetLyrics(res, username, params, format)

                case 'getLyricsBySongId':
                    return this.handleGetLyricsBySongId(res, username, params, format)

                case 'getOpenSubsonicExtensions':
                    return this.handleGetOpenSubsonicExtensions(res, format)

                case 'getArtistInfo':
                case 'getArtistInfo2':
                    return this.handleGetArtistInfo(res, username, params, format, method)

                case 'getArtist':
                    return this.handleGetArtist(res, username, params, format)

                case 'getArtistList':
                case 'getArtists':
                    return this.handleGetArtists(res, username, format)

                case 'search':
                case 'search2':
                case 'search3':
                    return this.handleSearch(res, username, params, format, method)

                case 'getStarred':
                    return this.handleGetStarred(res, username, format, false)

                case 'getStarred2':
                    return this.handleGetStarred(res, username, format, true)

                case 'star':
                    return this.handleStar(res, username, params, format, true)

                case 'unstar':
                    return this.handleStar(res, username, params, format, false)

                case 'setRating':
                    return this.handleSetRating(res, username, params, format)

                case 'getRandomSongs':
                case 'getSongsByGenre':
                case 'getSongsByGenre2':
                    return this.handleGetRandomSongs(res, username, params, format)

                case 'getSimilarSongs':
                case 'getSimilarSongs2':
                    return this.handleGetSimilarSongs(res, username, params, format, method)

                case 'getSonicSimilarTracks':
                    return this.handleGetSonicSimilarTracks(res, username, params, format)

                case 'getTopSongs':
                    return this.handleGetTopSongs(res, username, params, format)

                case 'getRecommendedSongs':
                case 'getDailySongs':
                case 'getSongsByTag':
                    return this.handleGetRecommendedSongs(res, username, params, format)

                case 'updatePlaylist':
                    return this.handleUpdatePlaylist(res, username, params, format)

                case 'createPlaylist':
                    return this.handleCreatePlaylist(res, username, params, format)

                case 'deletePlaylist':
                    return this.handleDeletePlaylist(res, username, params, format)

                case 'scrobble':
                    return this.handleScrobble(res, username, params, format)

                case 'reportPlayback':
                    return this.handleReportPlayback(res, username, params, format)

                case 'getBookmarks':
                    return this.handleGetBookmarks(res, username, format)

                case 'createBookmark':
                    return this.handleCreateBookmark(res, username, params, format)

                case 'deleteBookmark':
                    return this.handleDeleteBookmark(res, username, params, format)

                case 'getNowPlaying':
                    return this.handleGetNowPlaying(res, username, format)

                case 'savePlayQueue':
                    return this.handleSavePlayQueue(res, username, params, format)

                case 'getPlayQueue':
                    return this.handleGetPlayQueue(res, username, format)

                case 'savePlayQueueByIndex':
                    return this.handleSavePlayQueueByIndex(res, username, params, format)

                case 'getPlayQueueByIndex':
                    return this.handleGetPlayQueueByIndex(res, username, format)

                case 'getIndexes':
                    return this.handleGetIndexes(res, username, format)

                case 'startScan':
                    // [新增] 本服曲库是在线聚合、无常驻扫描任务，返回 ok 只是为了不让客户端
                    // 因 "Method not found" 报错；真实状态由 getScanStatus 统一返回（恒为未扫描）。
                case 'getScanStatus':
                    return this.sendResponse(res, format === 'json'
                        ? { scanStatus: { scanning: false, count: 0 } }
                        : { scanStatus: { attrs: { scanning: false, count: 0 } } }, format)

                default:
                    if (global.lx.config['subsonic.enableDebug']) {
                        subsonicLog.warn(`[Subsonic Debug ⚠️ 未实现的接口] ${req.method} /${method} (${format}) ${logDetails}`)
                    }
                    return this.sendError(res, 0, 'Method not found: ' + method, format)
            }
        } catch (err: any) {
            subsonicLog.error('[Subsonic] Error:', err)
            return this.sendError(res, 0, err.message || 'Internal server error', format)
        }
    }

    // ─────────────────────────────────────────────
    // 帮助函数
    // ─────────────────────────────────────────────

    private async getLibraryData(username: string, type: 'artists' | 'albums'): Promise<any[]> {
        const userDir = path.join(global.lx.userPath, getUserDirname(username))
        const libPath = path.join(userDir, 'library', `${type}.json`)
        if (!fs.existsSync(libPath)) return []
        try {
            const content = await fs.promises.readFile(libPath, 'utf8')
            return JSON.parse(content)
        } catch (e) {
            subsonicLog.error(`[Subsonic] Error reading library ${type}:`, e)
            return []
        }
    }

    /** 写回原生媒体库收藏文件（artists.json / albums.json），用于双向同步 */
    private async writeLibraryData(username: string, type: 'artists' | 'albums', data: any[]): Promise<void> {
        const userDir = path.join(global.lx.userPath, getUserDirname(username))
        const libPath = path.join(userDir, 'library', `${type}.json`)
        const dir = path.dirname(libPath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(libPath, JSON.stringify(data, null, 2), 'utf8')
    }

    /** 解析专辑信息（Subsonic 星标写回原生收藏时填充名称与封面；失败返回 name:null 不阻断星标） */
    private async resolveAlbumInfo(source: string, realId: string): Promise<{ name: string | null, picUrl: string }> {
        try {
            const sdk = (musicSdk as any)[source]
            if (sdk?.extendDetail?.getAlbumSongs) {
                const data = await sdk.extendDetail.getAlbumSongs(realId)
                const name = data?.name || data?.list?.[0]?.albumName || data?.list?.[0]?.meta?.albumName || null
                const picUrl = extractAlbumImage(data)
                return { name, picUrl }
            }
        } catch { /* 解析失败不阻断主流程 */ }
        return { name: null, picUrl: '' }
    }

    /** 星标写回原生收藏时取歌手头像；失败返回 '' 不阻断星标 */
    private async resolveArtistPicUrl(source: string, realId: string): Promise<string> {
        try {
            const sdk = (musicSdk as any)[source]
            if (sdk?.extendDetail?.getArtistDetail) {
                const info = await sdk.extendDetail.getArtistDetail(realId)
                return extractArtistImage(info)
            }
        } catch { /* 取图失败不阻断主流程 */ }
        return ''
    }

    private parseDuration(interval: any): number {
        if (!interval) return 0
        if (typeof interval === 'number') return interval
        if (typeof interval === 'string') {
            if (interval.includes(':')) {
                const parts = interval.split(':')
                if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1])
                if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
            }
            return parseInt(interval) || 0
        }
        return 0
    }

    /**
     * 将 MusicInfo 映射为 Subsonic child/song 的平铺 JS 对象（适用于 JSON 响应）
     */
    private musicToSongFlat(music: LX.Music.MusicInfo, parentId: string, artistIdOverride?: string, username?: string) {
        const meta = (music as any).meta || {}

        const id = music.id
        const singer = music.singer || 'Unknown Artist'
        const source = music.source

        // [缓存] 每首对外服务的歌曲都落入持久化 onlineSongCache（data/subsonic-online-cache.json，重启不丢）。
        // 这样客户端在「未播放的顶框」直接就歌曲评星时，服务端仅凭 setRating 的 id 也能离线还原出歌名/歌手，
        // 写进 dislike 规则，无需再走网络在线回源（本地 GFW 下会失败）。
        this.cacheOnlineSong(music)

        // [优化] 深度提取专辑信息：兼容 SDK 原始对象结构
        const albumName = meta.albumName || (music as any).albumName || (music as any).album?.name || 'Unknown Album'
        // 针对 tx 平台优先使用 albumMid (00...) 构造 alb_ ID，因为封面构造依赖它
        const rawAlbumId = (music as any).albumMid || (music as any).album?.mid || meta.albumId || (music as any).albumId || (music as any).album?.id

        // [修复] 规范化 albumId：优先使用提取到的专辑 ID，只有完全没有时才回退到 parentId
        // 且如果 parentId 是歌手 ID，在有 rawAlbumId 的情况下绝不使用它
        const albumId = rawAlbumId ? `alb_${source}_${rawAlbumId}` : parentId

        // [修复] 提取图片 URL：兼容更多 SDK 字段名
        const picUrl = meta.picUrl || (music as any).pic || (music as any).img || (music as any).albumPicUrl || (music as any).album?.picUrl || null
        if (picUrl && typeof picUrl === 'string' && picUrl.startsWith('http')) {
            // [双向缓存] 同时缓存给歌曲 ID 和专辑 ID
            this.setSongPicUrl(id, picUrl)
            if (rawAlbumId) this.setSongPicUrl(`alb_${source}_${rawAlbumId}`, picUrl)
        }

        // [修复] 处理 Genre 发现逻辑
        let genreMatch = (music as any).genre || ''
        if (parentId.startsWith('genre_')) {
            genreMatch = parentId.replace('genre_', '')
        }

        // [关键修复] 歌手 ID 生成策略优化
        // 1. 如果指定了覆盖 ID（如在歌手详情页），优先使用
        // 2. 否则优先使用 singerId 字段构造规范 ID
        // 3. 兜底使用第一位歌手名构造 ID，避免多歌手符号（如 、）在大 ID 中导致客户端解析失败
        const primarySinger = (singer.split('、')[0] || 'Unknown Artist').trim()
        const defaultArtistId = (music as any).singerId ? `art_${source}_${(music as any).singerId}` : `artist_${primarySinger}`
        const finalArtistId = artistIdOverride || defaultArtistId

        const starred = (username && this.loveIdSets.get(username)?.has(id)) ? new Date().toISOString() : undefined
        // [修复] 返回用户评星，客户端星标显示依赖 userRating 字段（0 表示未评）
        const userRating = username ? (this.userRatingsCache.get(username)?.[id] ?? 0) : 0

        return {
            id,
            parent: parentId,
            title: music.name,
            name: music.name,
            album: albumName,
            albumId: String(albumId),
            artist: singer,
            artistId: finalArtistId,
            track: (music as any).track || 0,
            year: (music as any).year || 0,
            genre: genreMatch,
            coverArt: (picUrl && typeof picUrl === 'string' && picUrl.startsWith('http')) ? picUrl : albumId,
            duration: this.parseDuration(music.interval),
            ...this.getBestQualityMeta(music),
            ...(starred ? { starred } : {}),
            userRating,
            isVideo: false,
            isDir: false,
            // 某些客户端 (如 Feishin) 在特定视图下不喜欢非标准字段，可以保留但确保标准字段优先
            type: 'music',
        }
    }

    /**
     * 从歌曲元数据中检测并提取最佳音质配置
     */
    private getBestQualityMeta(music: LX.Music.MusicInfo) {
        const meta = (music as any).meta || {}
        const qualitys = (music as any).types || (music as any)._types || meta.qualitys || meta.types || meta._types || (music as any)._qualitys || meta._qualitys || []

        const qMap: Record<string, { bitRate: number, suffix: string, contentType: string }> = {
            'master': { bitRate: 2304, suffix: 'Master', contentType: 'audio/flac' },
            'atmos_plus': { bitRate: 1500, suffix: 'Atmos+', contentType: 'audio/mp4' },
            'atmos': { bitRate: 1000, suffix: 'Atmos', contentType: 'audio/mp4' },
            'hires': { bitRate: 2304, suffix: 'Hi-Res', contentType: 'audio/flac' },
            'flac24bit': { bitRate: 2304, suffix: 'Hi-Res', contentType: 'audio/flac' },
            'flac': { bitRate: 999, suffix: '无损', contentType: 'audio/flac' },
            '320k': { bitRate: 320, suffix: '320k', contentType: 'audio/mpeg' },
            '192k': { bitRate: 192, suffix: '192k', contentType: 'audio/mpeg' },
            '128k': { bitRate: 128, suffix: '128k', contentType: 'audio/mpeg' },
        }

        const hasQuality = (q: string) => {
            if (Array.isArray(qualitys)) {
                return qualitys.some((item: any) => item === q || item?.type === q || item?.name === q)
            } else if (qualitys && typeof qualitys === 'object') {
                return Boolean((qualitys as any)[q])
            }
            return false
        }

        // 尝试按优先级匹配最佳音质
        for (const q of ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '192k', '128k']) {
            if (hasQuality(q)) {
                return { ...qMap[q], size: 0 }
            }
        }

        // 若是在线全网检索歌曲，没抓到 types 信息的兜底返回 320k
        if (music.id && music.id.includes('_')) {
            return { bitRate: 320, size: 0, suffix: '320k', contentType: 'audio/mpeg' }
        }

        // 兜底返回 128k
        return { bitRate: 128, size: 0, suffix: '128k', contentType: 'audio/mpeg' }
    }

    /**
     * 将 MusicInfo 映射为 XML 渲染格式 {attrs, children?}
     */
    private musicToSongXml(music: LX.Music.MusicInfo, parentId: string, artistIdOverride?: string, username?: string) {
        return { attrs: this.musicToSongFlat(music, parentId, artistIdOverride, username) }
    }

    /** 查找某个用户下所有列表中的某首歌 */
    private async findMusicById(username: string, id: string): Promise<{ music: LX.Music.MusicInfo, listId: string } | null> {
        // [修复] 读取前确保磁盘上的 onlineSongCache 已加载（之前只在 cacheOnlineSong 写入时触发，
        // 导致重启后首次读取发生在任何写入之前，落盘数据永远读不进来 -> 重启即丢）
        this.loadOnlineSongCache()
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        let music = listData.loveList.find((m: any) => m.id === id)
        if (music) return { music, listId: 'love' }

        music = listData.defaultList.find((m: any) => m.id === id)
        if (music) return { music, listId: 'default' }

        for (const listInfo of listData.userList) {
            const list = listInfo.list as LX.Music.MusicInfo[]
            music = list.find((m: any) => m.id === id)
            if (music) return { music, listId: listInfo.id }
        }

        // 检查本地专辑库
        try {
            const libAlbums = await this.getLibraryData(username, 'albums')
            for (const alb of libAlbums) {
                const source = alb.source || 'wy'
                for (const s of (alb.list || [])) {
                    const songId = `${source}_${s.songmid || s.songId}`
                    if (songId === id) {
                        return {
                            music: {
                                id: songId,
                                name: s.name,
                                singer: s.singer,
                                source: source,
                                songmid: s.songmid,
                                interval: s.interval || '0',
                                img: s.img,
                                meta: {
                                    picUrl: s.img,
                                    albumName: s.albumName || alb.name,
                                    albumId: s.albumMid || alb.id,
                                },
                            } as any,
                            listId: `alb_${source}_${alb.id}`,
                        }
                    }
                }
            }
        } catch (e) { }

        // 检查在线搜索缓存
        if (this.onlineSongCache.has(id)) {
            return { music: this.onlineSongCache.get(id)!, listId: 'online' }
        }

        return null
    }

    private getListParams(params: URLSearchParams, name: string): string[] {
        return params.getAll(name)
            .flatMap(value => value.split(','))
            .map(value => value.trim())
            .filter(Boolean)
    }

    private async resolveMusicIds(username: string, ids: string[]): Promise<LX.Music.MusicInfo[] | null> {
        const musics: LX.Music.MusicInfo[] = []
        for (const id of ids) {
            const result = await this.findMusicById(username, id)
            if (!result) return null
            musics.push(result.music)
        }
        return musics
    }

    // ─────────────────────────────────────────────
    // 端点实现
    // ─────────────────────────────────────────────

    private handleGetLicense(res: http.ServerResponse, format: string) {
        if (format === 'json') {
            return this.sendResponse(res, {
                license: { valid: true, email: 'lxserver@lxmusic.com', licenseExpires: '2099-12-31T00:00:00.000Z' },
            }, format)
        }
        return this.sendResponse(res, {
            license: { attrs: { valid: true, email: 'lxserver@lxmusic.com', licenseExpires: '2099-12-31T00:00:00.000Z' } },
        }, format)
    }

    private handleGetMusicFolders(res: http.ServerResponse, format: string) {
        const folders = [
            { id: '1', name: 'LX Music（按服务器设置）' },
            { id: 'local', name: '本地曲库' },
            { id: 'all', name: '全部在线平台' },
            { id: 'wy', name: '网易云音乐' },
            { id: 'tx', name: 'QQ 音乐' },
            { id: 'kw', name: '酷我音乐' },
            { id: 'kg', name: '酷狗音乐' },
            { id: 'mg', name: '咪咕音乐' },
        ]
        if (format === 'json') {
            return this.sendResponse(res, {
                musicFolders: { musicFolder: folders },
            }, format)
        }
        return this.sendResponse(res, {
            musicFolders: { children: { musicFolder: folders.map(folder => ({ attrs: folder })) } },
        }, format)
    }

    private async handleGetPlaylists(res: http.ServerResponse, username: string, format: string) {
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()
        // subsonicLog.debug(`[Subsonic] handleGetPlaylists for ${username}: default=${listData.defaultList.length}, love=${listData.loveList.length}, userLists=${listData.userList.length}`)

        const buildPlaylist = (id: string, name: string, musics: any[], created?: string, coverArt?: string) => ({
            id,
            name,
            comment: '',
            owner: username,
            public: false,
            songCount: musics.length,
            duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
            created: created || new Date().toISOString(),
            changed: created || new Date().toISOString(),
            coverArt: coverArt || id,
        })

        const playlists: any[] = []

        if (listData.defaultList.length > 0) {
            const musics = listData.defaultList
            const coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            playlists.push(buildPlaylist('default', '默认列表', musics, undefined, coverArt))
        }
        // 注意：love 列表在 getPlaylists 中与「歌单(用户自建播放列表)」平级展示。
        // 为避免与前端侧边栏折叠面板标题「我的收藏」(见 public/music/index.html) 重名，
        // 此处 love 列表命名为「我的喜爱」，与面板内部 ♥ 列表显示名称保持一致。
        {
            const musics = listData.loveList
            const coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            playlists.push(buildPlaylist('love', '我的喜爱', musics, undefined, coverArt))
        }

        for (const list of listData.userList) {
            const musics = (list.list || []) as LX.Music.MusicInfo[]
            const coverArt = (list as any).Album || (list as any).picUrl || (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            playlists.push(buildPlaylist(
                list.id,
                list.name,
                musics,
                list.locationUpdateTime ? new Date(list.locationUpdateTime).toISOString() : undefined,
                coverArt,
            ))
        }

        // [新增] 共享歌单(只读虚拟播放列表)：排行榜 / 歌单 / 都要，由 sharedListMode 决定
        // 仅在配置开启 subsonic.publicLeaderboards 时生效
        if (global.lx.config['subsonic.publicLeaderboards']) {
            const mode = global.lx.config['subsonic.sharedListMode'] || 'leaderboard'
            if (mode === 'leaderboard' || mode === 'both') {
                try {
                    const lbPlaylists = await this.getLeaderboardPlaylists()
                    playlists.push(...lbPlaylists)
                } catch (err) {
                    subsonicLog.error('[Subsonic] Append leaderboard playlists failed:', err)
                }
            }
            if (mode === 'playlist' || mode === 'both') {
                try {
                    const plPlaylists = await this.getSharedPlaylists()
                    playlists.push(...plPlaylists)
                } catch (err) {
                    subsonicLog.error('[Subsonic] Append shared playlists failed:', err)
                }
            }
        }

        if (format === 'json') {
            return this.sendResponse(res, { playlists: { playlist: playlists } }, format)
        }
        return this.sendResponse(res, {
            playlists: { children: { playlist: playlists.map(p => ({ attrs: p })) } },
        }, format)
    }

    private async handleGetPlaylist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        // [新增] 排行榜(榜单)虚拟只读播放列表
        if (id.startsWith('lb_')) {
            return this.handleGetLeaderboardPlaylist(res, username, id, format)
        }
        // [新增] 共享歌单(歌单)虚拟只读播放列表
        if (id.startsWith('pl_')) {
            return this.handleGetSharedPlaylist(res, username, id, format)
        }

        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        let musics: LX.Music.MusicInfo[] = []
        let listName = 'Unknown'
        let coverArt = 'logo'

        if (id === 'love') {
            musics = listData.loveList
            listName = '我的收藏'
            coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
        } else if (id === 'default') {
            musics = listData.defaultList
            listName = '默认列表'
            coverArt = (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
        } else {
            const list = listData.userList.find((l: any) => l.id === id)
            if (list) {
                listName = list.name
                musics = (list.list || []) as LX.Music.MusicInfo[]
                coverArt = (list as any).Album || (list as any).picUrl || (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || 'logo'
            }
        }

        // [dislike] 命中不喜欢规则的歌曲从歌单中剔除
        if (global.lx.config['subsonic.hideDisliked']) {
            musics = await this.filterDislikedSongs(username, musics)
        }

        const playlistMeta = {
            id,
            name: listName,
            comment: '',
            owner: username,
            public: false,
            songCount: musics.length,
            duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
            created: new Date().toISOString(),
            changed: new Date().toISOString(),
            coverArt,
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                playlist: {
                    ...playlistMeta,
                    entry: musics.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id, undefined, username)),
                },
            }, format)
        }

        return this.sendResponse(res, {
            playlist: {
                attrs: playlistMeta,
                children: {
                    entry: musics.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id, undefined, username)),
                },
            },
        }, format)
    }

    private async handleUpdatePlaylist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const playlistId = params.get('playlistId')
        if (!playlistId) return this.sendError(res, 10, 'Required parameter is missing: playlistId', format)
        if (playlistId.startsWith('lb_')) return this.sendError(res, 0, '排行榜为只读播放列表，不支持修改', format)
        if (playlistId.startsWith('pl_')) return this.sendError(res, 0, '共享歌单为只读播放列表，不支持修改', format)

        try {
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()
            const userList = listData.userList.find(list => list.id === playlistId)
            if (playlistId !== 'default' && playlistId !== 'love' && !userList) {
                return this.sendError(res, 70, 'Playlist not found', format)
            }

            const currentMusics = await userSpace.listManage.listDataManage.getListMusics(playlistId)
            const removeIndexes = this.getListParams(params, 'songIndexToRemove').map(Number)
            if (removeIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= currentMusics.length)) {
                return this.sendError(res, 0, 'Invalid songIndexToRemove', format)
            }
            // The original Subsonic API removes by zero-based index. A number of
            // clients use the OpenSubsonic-style songIdToRemove extension instead.
            const requestedRemoveIds = this.getListParams(params, 'songIdToRemove')

            const addIds = [...new Set(this.getListParams(params, 'songIdToAdd'))]
            const addMusics = await this.resolveMusicIds(username, addIds)
            if (addMusics === null) return this.sendError(res, 70, 'Song not found', format)

            const addIndexValues = this.getListParams(params, 'songIndexToAdd')
            const addIndex = addIndexValues.length ? Number(addIndexValues[0]) : null
            if (addIndex !== null && (!Number.isInteger(addIndex) || addIndex < 0)) {
                return this.sendError(res, 0, 'Invalid songIndexToAdd', format)
            }

            let changed = false
            const name = params.get('name')
            if (name !== null) {
                if (!userList) return this.sendError(res, 0, 'Built-in playlists cannot be renamed', format)
                if (!name.trim()) return this.sendError(res, 0, 'Playlist name cannot be empty', format)
                await userSpace.listManage.listDataManage.userListsUpdate([{
                    ...userList,
                    name: name.trim(),
                    locationUpdateTime: Date.now(),
                }])
                changed = true
            }

            const removeIds = [...new Set([
                ...removeIndexes.map(index => currentMusics[index].id),
                ...requestedRemoveIds,
            ])]
            if (removeIds.length) {
                await userSpace.listManage.listDataManage.listMusicRemove(playlistId, removeIds)
                changed = true
            }

            if (addMusics.length) {
                const location = getUserConfig(username)['list.addMusicLocationType']
                await userSpace.listManage.listDataManage.listMusicAdd(playlistId, addMusics, location)
                if (addIndex !== null) {
                    await userSpace.listManage.listDataManage.listMusicUpdatePosition(
                        playlistId,
                        addIndex,
                        addMusics.map(music => music.id),
                    )
                }
                changed = true
            }

            if (changed) await userSpace.listManage.createSnapshot()
            return this.sendResponse(res, {}, format)
        } catch (err: any) {
            subsonicLog.error('[Subsonic] updatePlaylist error:', err)
            return this.sendError(res, 0, err.message || 'Failed to update playlist', format)
        }
    }

    private async handleCreatePlaylist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const name = params.get('name')?.trim()
        if (!name) return this.sendError(res, 10, 'Required parameter is missing: name', format)

        try {
            const songIds = [...new Set(this.getListParams(params, 'songId'))]
            const musics = await this.resolveMusicIds(username, songIds)
            if (musics === null) return this.sendError(res, 70, 'Song not found', format)

            const userSpace = getUserSpace(username)
            const playlistId = `subsonic_${crypto.randomUUID()}`
            await userSpace.listManage.listDataManage.userListCreate({
                id: playlistId,
                name,
                position: -1,
                locationUpdateTime: Date.now(),
            })
            if (musics.length) {
                const location = getUserConfig(username)['list.addMusicLocationType']
                await userSpace.listManage.listDataManage.listMusicAdd(playlistId, musics, location)
            }
            await userSpace.listManage.createSnapshot()

            return this.handleGetPlaylist(res, username, new URLSearchParams({ id: playlistId }), format)
        } catch (err: any) {
            subsonicLog.error('[Subsonic] createPlaylist error:', err)
            return this.sendError(res, 0, err.message || 'Failed to create playlist', format)
        }
    }

    private async handleDeletePlaylist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)
        if (id.startsWith('lb_')) return this.sendError(res, 0, '排行榜为只读播放列表，不支持删除', format)
        if (id.startsWith('pl_')) return this.sendError(res, 0, '共享歌单为只读播放列表，不支持删除', format)
        if (id === 'default' || id === 'love') {
            return this.sendError(res, 0, 'Built-in playlists cannot be deleted', format)
        }

        try {
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()
            if (!listData.userList.some(list => list.id === id)) {
                return this.sendError(res, 70, 'Playlist not found', format)
            }
            await userSpace.listManage.listDataManage.userListsRemove([id])
            await userSpace.listManage.createSnapshot()
            return this.sendResponse(res, {}, format)
        } catch (err: any) {
            subsonicLog.error('[Subsonic] deletePlaylist error:', err)
            return this.sendError(res, 0, err.message || 'Failed to delete playlist', format)
        }
    }

    // ─────────────────────────────────────────────
    // [新增] 排行榜(榜单) → 只读 Subsonic 播放列表
    // 将指定平台榜单(含热歌榜)暴露为 Subsonic 播放列表，
    // 音流等客户端无需 web 页面即可浏览/播放榜单。榜单为只读，不可增删改。
    // ─────────────────────────────────────────────
    private getLeaderboardSource(): string {
        return global.lx.config['subsonic.leaderboardSource'] || 'tx'
    }

    private async getLeaderboardPlaylists(): Promise<any[]> {
        const source = this.getLeaderboardSource()
        // 系统级 owner：不属于任何具体用户，使其在音流「我的歌单」(owner==我) 过滤中被排除，
        // 但保留在「全部歌单」中；public:true 确保跨用户可见。
        const owner = 'lxserver'
        try {
            const lb = (musicSdk as any)[source]?.leaderboard
            if (!lb || typeof lb.getBoards !== 'function') return []
            const result = await lb.getBoards()
            const list = Array.isArray(result?.list) ? result.list : []
            return list.map((board: any) => {
                const bangid = String(board.bangid)
                const id = `lb_${source}_${bangid}`
                return {
                    id,
                    name: `榜单·${board.name}`,
                    comment: '排行榜(只读)',
                    owner,
                    public: true,
                    songCount: 0,
                    duration: 0,
                    created: new Date().toISOString(),
                    changed: new Date().toISOString(),
                    // coverArt 用榜单歌单 id 作为令牌（lb_<source>_<bangid>），
                    // 由 getCoverArt 按需拉取该榜单首歌封面并代理返回；不再统一用 'logo'（SVG 部分客户端不渲染）
                    coverArt: id,
                }
            })
        } catch (err) {
            subsonicLog.error('[Subsonic] getLeaderboardPlaylists error:', err)
            return []
        }
    }

    /**
     * 解析排行榜封面令牌 lb_<source>_<bangid>，按需抓取该榜单首歌封面（带缓存与并发复用）。
     * getBoards 接口不返回封面，故列表项 coverArt 用令牌占位，由 getCoverArt 在客户端真正请求时才拉取。
     */
    private async getLeaderboardCoverUrl(token: string): Promise<string> {
        const m = /^lb_([^_]+)_(.+)$/.exec(token)
        if (!m) return 'logo'
        const source = m[1]
        const bangid = m[2]
        const key = `${source}_${bangid}`
        const now = Date.now()
        const cached = leaderboardCoverCache.get(key)
        if (cached && now - cached.ts < LEADERBOARD_COVER_TTL) return cached.url
        let inflight = leaderboardCoverInflight.get(key)
        if (!inflight) {
            inflight = (async () => {
                try {
                    const lb = (musicSdk as any)[source]?.leaderboard
                    if (!lb || typeof lb.getList !== 'function') return 'logo'
                    const data: any = await lb.getList(bangid, 1)
                    const list: any[] = data?.list || []
                    const img = list[0]?.img
                    return (typeof img === 'string' && img) ? img : 'logo'
                } catch {
                    return 'logo'
                } finally {
                    leaderboardCoverInflight.delete(key)
                }
            })()
            leaderboardCoverInflight.set(key, inflight)
        }
        const url = await inflight
        leaderboardCoverCache.set(key, { ts: now, url })
        return url
    }

    private async handleGetLeaderboardPlaylist(res: http.ServerResponse, username: string, id: string, format: string) {
        const parts = id.split('_') // ['lb', source, bangid...]
        const source = parts[1]
        const bangid = parts.slice(2).join('_')
        try {
            const lb = (musicSdk as any)[source]?.leaderboard
            if (!lb) return this.sendError(res, 70, 'Leaderboard source not found', format)

            const result = await lb.getBoards()
            const boards = Array.isArray(result?.list) ? result.list : []
            const board = boards.find((b: any) => String(b.bangid) === bangid)
            const listName = board ? `榜单·${board.name}` : '排行榜'

            const data = await lb.getList(bangid, 1)
            let musics: LX.Music.MusicInfo[] = (data?.list || []).map((s: any) => {
                const m = this.normalizeLeaderboardSong(s, source)
                this.cacheOnlineSong(m)
                return m
            })

            // [dislike] 排行榜同理剔除不喜欢的歌曲
            if (global.lx.config['subsonic.hideDisliked']) {
                musics = await this.filterDislikedSongs(username, musics)
            }

            const coverArt = (musics[0] as any)?.img || 'logo'

            const playlistMeta = {
                id,
                name: listName,
                comment: '排行榜(只读)',
                owner: 'lxserver',
                public: true,
                songCount: musics.length,
                duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
                created: new Date().toISOString(),
                changed: new Date().toISOString(),
                coverArt,
            }

            if (format === 'json') {
                return this.sendResponse(res, {
                    playlist: {
                        ...playlistMeta,
                        entry: musics.map((m: any) => this.musicToSongFlat(m, id, undefined, username)),
                    },
                }, format)
            }
            return this.sendResponse(res, {
                playlist: {
                    attrs: playlistMeta,
                    children: {
                        entry: musics.map((m: any) => this.musicToSongXml(m, id, undefined, username)),
                    },
                },
            }, format)
        } catch (err: any) {
            subsonicLog.error('[Subsonic] handleGetLeaderboardPlaylist error:', err)
            return this.sendError(res, 0, '获取排行榜失败: ' + (err?.message || err), format)
        }
    }

    /** 补齐榜单歌曲的 LX 标准 id 与封面，确保音流可解析并播放 */
    private normalizeLeaderboardSong(song: any, source: string): any {
        const songmid = song.songmid || song.songId || song.id
        song.id = `${source}_${songmid}`
        song.source = source
        if (!song.meta) song.meta = {}
        if (!song.meta.picUrl && song.img) song.meta.picUrl = song.img
        return song
    }

    /** 将指定平台的热门/最新歌单暴露为 Subsonic 只读虚拟播放列表（共享歌单「歌单」模式）。 */
    private async getSharedPlaylists(): Promise<any[]> {
        const source = this.getLeaderboardSource() // 复用共享歌单平台选择
        const sort = global.lx.config['subsonic.sharedListSort'] === 'new' ? 'new' : 'hot'
        const owner = 'lxserver'
        try {
            const sl = (musicSdk as any)[source]?.songList
            if (!sl || typeof sl.getList !== 'function') return []
            const res: any = await sl.getList(sort, '', 1)
            const list: any[] = res?.list || []
            return list.map((item: any) => {
                const plId = String(item.id ?? item.dissid ?? item.tid ?? item.listId)
                const id = `pl_${source}_${plId}`
                const img = typeof item.img === 'string' && item.img
                    ? (item.img.startsWith('//') ? `https:${item.img}` : item.img)
                    : 'logo'
                // 记录封面，便于客户端以 pl_ id 请求 getCoverArt 时直接命中
                sharedPlaylistCoverCache.set(id, img)
                return {
                    id,
                    name: `歌单·${item.name || item.dissname || '未知歌单'}`,
                    comment: '歌单(只读)',
                    owner,
                    public: true,
                    songCount: 0,
                    duration: 0,
                    created: new Date().toISOString(),
                    changed: new Date().toISOString(),
                    coverArt: img,
                }
            })
        } catch (err) {
            subsonicLog.error('[Subsonic] getSharedPlaylists error:', err)
            return []
        }
    }

    private async handleGetSharedPlaylist(res: http.ServerResponse, username: string, id: string, format: string) {
        const parts = id.split('_') // ['pl', source, plId...]
        const source = parts[1]
        const plId = parts.slice(2).join('_')
        try {
            const sl = (musicSdk as any)[source]?.songList
            if (!sl || typeof sl.getListDetail !== 'function') return this.sendError(res, 70, 'Playlist source not found', format)
            const detail: any = await sl.getListDetail(plId, 1)
            const list: any[] = detail?.list || []
            let musics: LX.Music.MusicInfo[] = list.map((s: any) => {
                const m = this.normalizeLeaderboardSong(s, source)
                this.cacheOnlineSong(m)
                return m
            })
            if (global.lx.config['subsonic.hideDisliked']) {
                musics = await this.filterDislikedSongs(username, musics)
            }
            const coverArt = (musics[0] as any)?.img || detail?.info?.img || 'logo'
            const playlistMeta = {
                id,
                // SDK 的歌单名在 info.name（旧接口在顶层 name），都要兼容
                name: `歌单·${detail?.info?.name || detail?.name || plId}`,
                comment: '歌单(只读)',
                owner: 'lxserver',
                public: true,
                songCount: musics.length,
                duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
                created: new Date().toISOString(),
                changed: new Date().toISOString(),
                coverArt,
            }
            if (format === 'json') {
                return this.sendResponse(res, {
                    playlist: {
                        ...playlistMeta,
                        entry: musics.map((m: any) => this.musicToSongFlat(m, id, undefined, username)),
                    },
                }, format)
            }
            return this.sendResponse(res, {
                playlist: {
                    attrs: playlistMeta,
                    children: {
                        entry: musics.map((m: any) => this.musicToSongXml(m, id, undefined, username)),
                    },
                },
            }, format)
        } catch (err: any) {
            subsonicLog.error('[Subsonic] handleGetSharedPlaylist error:', err)
            return this.sendError(res, 0, '获取歌单失败: ' + (err?.message || err), format)
        }
    }

    /**
     * [getAlbumInfo / getAlbumInfo2] 专辑信息（notes + 封面 URL）。
     * 本服曲库是在线聚合，官方 albumInfo 的 notes 大多没有数据源，因此：
     *  - 本地收藏专辑（lib-alb_*）取它的描述；
     *  - 封面用平台 CDN 直链（能构造时，目前仅 tx）；构造不出则留空。
     */
    private async handleGetAlbumInfo(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        let notes = ''
        let coverSource = ''
        let coverMid = ''
        // 兜底封面：本地专辑 / 歌曲自带的封面 URL（一般是平台 CDN 直链，客户端可直接取，无需本服鉴权）
        let directImg = ''

        if (id.startsWith('lib-alb_')) {
            const realId = id.replace('lib-alb_', '')
            try {
                const libAlbums = await this.getLibraryData(username, 'albums')
                const album: any = libAlbums.find((a: any) =>
                    String(a.id) === realId || String(a.meta?.albumId) === realId || String(a.meta?.albumMid) === realId)
                if (album) {
                    notes = String(album.desc || album.description || '').trim()
                    coverSource = album.source || ''
                    coverMid = String(album.meta?.albumId || album.meta?.albumMid || album.id || '')
                    directImg = String(album.img || album.meta?.picUrl || '').trim()
                }
            } catch (e: any) {
                subsonicLog.error(`[Subsonic] getAlbumInfo 读取本地专辑失败 (${id}):`, e?.message || e)
            }
        }

        // 先按「歌曲 id」解析（本地列表 / 在线缓存都能命中）：这样既能拿到它所属专辑的 mid，
        // 又能拿到歌曲自带的封面直链（非 tx 平台构造不出专辑封面时兜底用）
        if (!coverMid) {
            const found = await this.findMusicById(username, id).catch(() => null)
            const m: any = found?.music
            if (m) {
                coverSource = coverSource || m.source || ''
                coverMid = String(m.meta?.albumMid || m.meta?.albumId || m.albumId || '')
                directImg = directImg || String(m.img || m.meta?.picUrl || '').trim()
            }
        }
        // 兜底：兼容 <source>_<albumMid> 形式的专辑 id（如 alb_tx_xxx）
        if (!coverMid) {
            const us = id.indexOf('_')
            if (us > 0) {
                coverSource = coverSource || id.slice(0, us)
                coverMid = id.slice(us + 1).replace(/^alb[_a-z]*_/, '')
            }
        }

        // 优先按平台规则构造专辑封面（目前仅 tx）；构造不出则退用自带的封面直链
        let imageUrl = (coverSource && coverMid) ? (this.buildAlbumCoverUrl(coverSource, coverMid) || '') : ''
        if (!imageUrl) imageUrl = directImg
        const info = {
            notes,
            musicBrainzId: '',
            smallImageUrl: imageUrl,
            mediumImageUrl: imageUrl,
            largeImageUrl: imageUrl,
        }
        if (format === 'json') return this.sendResponse(res, { albumInfo: info }, format)
        return this.sendResponse(res, { albumInfo: { attrs: info } }, format)
    }

    // getAlbum: 返回 album + song[] 格式（音流等客户端期望的格式）
    private async handleGetAlbum(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        let musics: LX.Music.MusicInfo[] = []
        let listName = 'Unknown'
        let albumPublishTime: string | undefined

        if (id === 'love') {
            musics = listData.loveList
            listName = '我的收藏'
        } else if (id === 'default') {
            musics = listData.defaultList
            listName = '默认列表'
        } else if (id.startsWith('lib-alb_')) {
            // 从本地收藏专辑库获取详情，将原始歌曲字段规范化为标准格式
            const realId = id.replace('lib-alb_', '')
            const libAlbums = await this.getLibraryData(username, 'albums')
            const album = libAlbums.find((a: any) => String(a.id) === realId || String(a.meta?.albumId) === realId)
            if (album) {
                listName = album.name
                albumPublishTime = album.publishTime
                // library 歌曲是原始字段，需要映射成 MusicInfo 兼容格式
                musics = (album.list || []).map((s: any) => ({
                    id: `${s.source}_${s.songmid || s.songId}`,
                    name: s.name,
                    singer: s.singer,
                    source: s.source,
                    songmid: s.songmid,
                    interval: s.interval || '0',
                    img: s.img,
                    meta: {
                        picUrl: s.img,
                        albumName: s.albumName || album.name,
                        albumId: s.albumMid || album.id,
                    },
                } as any))

                // [修复] 本地专辑可能只存了名称/封面而没有 list（如 Subsonic 星标回写），
                // 表现就是专辑 0 首。这里用 albumId 向音源补全整张专辑。
                if (musics.length === 0) {
                    const albSource = album.source || 'wy'
                    const albMid = String(album.meta?.albumId || album.id || '')
                    if (albMid && musicSdk[albSource]?.extendDetail?.getAlbumSongs) {
                        try {
                            const data = await musicSdk[albSource].extendDetail.getAlbumSongs(albMid)
                            musics = (data.list || []).map((s: any) => ({
                                ...s,
                                id: `${albSource}_${s.songmid || s.songId}`,
                                source: albSource,
                            })) as any
                            if (data.name) listName = data.name
                            albumPublishTime = data.publishTime || album.publishTime
                        } catch (e: any) {
                            subsonicLog.error(`[Subsonic] 本地专辑补全失败 (${albMid}):`, e?.message)
                        }
                    }
                }
            }
            /* 
            } else if (id.startsWith('alb_hot_')) {
                // [新增] 处理虚拟出的歌手热门歌曲专辑
                const fullArtId = id.replace('alb_hot_', '')
                let source = 'wy'
                let artistId = fullArtId
                if (fullArtId.startsWith('art_')) {
                    const parts = fullArtId.split('_')
                    source = parts[1]
                    artistId = parts.slice(2).join('_')
                }
                if (musicSdk[source]?.extendDetail) {
                    try {
                        // [修改] 统一使用 5 页 (500 首) 循环抓取
                        const MAX_PAGES = 5
                        const PAGE_SIZE = 100
                        let all: any[] = []
                        for (let p = 1; p <= MAX_PAGES; p++) {
                            const data = await musicSdk[source].extendDetail.getArtistSongs(artistId, p, PAGE_SIZE, 'hot')
                            const pageList = data.list || []
                            all = all.concat(pageList)
                            if (pageList.length < PAGE_SIZE) break
                        }
                        musics = all.map((s: any) => ({
                            ...s,
                            id: `${source}_${s.songmid || s.songId}`
                        }))
                        listName = '热门歌曲'
                    } catch (e) {
                        subsonicLog.error(`[Subsonic] SDK getArtistSongs (for virtual album) error:`, e)
                    }
                }
            */
        } else if (id.startsWith('radio_tx_')) {
            // [新增] 处理电台详情，作为虚拟专辑返回
            const radioId = id.replace('radio_tx_', '')
            try {
                const songs = await fetchRadioSongs(radioId)
                listName = '官方电台' // 默认名，如果有缓存可以查找真实名
                musics = (songs || []).map((s: any) => ({
                    id: `tx_${s.songmid || s.mid}`,
                    name: s.songname || s.name,
                    singer: (s.singer || []).map((si: any) => si.name).join('、'),
                    source: 'tx',
                    songmid: s.songmid || s.mid,
                    interval: s.interval || 0,
                    img: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
                    meta: {
                        albumName: '官方电台',
                        albumId: id,
                        picUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : ''
                    }
                } as any))
            } catch (e) {
                subsonicLog.error(`[Subsonic] Fetch radio songs failed:`, e)
            }
        } else if (id.startsWith('alb_tx_playlist_')) {
            // [新增] 处理虚拟出的歌单详情
            const dissid = id.replace('alb_tx_playlist_', '')
            try {
                const result = await fetchPlaylistSongs(dissid)
                listName = result.name
                musics = result.list as any
            } catch (e) {
                subsonicLog.error(`[Subsonic] Fetch playlist detail failed:`, e)
            }
        } else if (id.startsWith('alb_')) {
            // [新增] 处理来自 SDK 的专辑详情
            const parts = id.split('_')
            const source = parts[1]
            const realId = parts.slice(2).join('_')
            // subsonicLog.debug(`[Subsonic] getAlbum SDK Route: source=${source}, realId=${realId}`)

            if (musicSdk[source]?.extendDetail?.getAlbumSongs) {
                try {
                    const data = await musicSdk[source].extendDetail.getAlbumSongs(realId)
                    // subsonicLog.debug(`[Subsonic] getAlbum SDK Response: name=${data?.name}, songCount=${data?.list?.length}`)
                    musics = (data.list || []).map((s: any) => ({
                        ...s,
                        id: `${source}_${s.songmid || s.songId}`,
                        source
                    }))
                    // [优化] 如果数据里没带专辑名，从第一首歌里提取
                    listName = data.name || (musics[0] as any)?.albumName || (musics[0] as any)?.meta?.albumName || 'Album Detail'
                    albumPublishTime = data.publishTime
                } catch (e: any) {
                    subsonicLog.error(`[Subsonic] SDK getAlbumSongs error for ${id}:`, e?.message)
                }
            } else {
                subsonicLog.warn(`[Subsonic] SDK missing extendDetail.getAlbumSongs for ${source}`)
            }

            // [兜底] 单曲专辑（无专辑信息的歌以 alb_<source>_<songId> 出现在播放历史里）：
            // SDK 取不到曲目时按单曲解析，避免点进去一片空白
            if (!musics || musics.length === 0) {
                const single = await this.findMusicById(username, `${source}_${realId}`).catch(() => null)
                if (single) {
                    musics = [single.music]
                    if (!listName || listName === 'Album Detail') {
                        listName = String((single.music as any)?.name || '单曲')
                    }
                }
            }
        } else if (id.startsWith('album_')) {
            // 聚合专辑 ID（由 getAlbumList/getAlbumList2 生成）
            const allMusicsMap = new Map<string, { music: LX.Music.MusicInfo, listId: string }[]>()
            const collectInto = (songs: LX.Music.MusicInfo[], listId: string) => {
                for (const m of songs) {
                    const albumName = (m as any).meta?.albumName || m.name
                    const singer = m.singer || 'Unknown'
                    const key = `album_${Buffer.from(`${albumName}__${singer}`).toString('base64url').slice(0, 24)}`
                    if (!allMusicsMap.has(key)) allMusicsMap.set(key, [])
                    allMusicsMap.get(key)!.push({ music: m, listId })
                }
            }
            collectInto(listData.loveList, 'love')
            collectInto(listData.defaultList, 'default')
            for (const list of listData.userList) collectInto((list.list || []) as LX.Music.MusicInfo[], list.id)

            const entries = allMusicsMap.get(id) || []
            musics = entries.map(e => e.music)
            if (musics.length > 0) {
                listName = (musics[0] as any).meta?.albumName || musics[0].name
            }

            // [修复] 聚合专辑原本只含用户收藏的那几首，表现就是"每张专辑只有 1-2 首"。
            // 这里用收藏曲目里的 albumMid 向音源补全整张专辑；
            // 收藏标记由 musicToSong* 依据 loveIdSets 自动补上，因此无需保留本地优先。
            const seed = musics.find(m => (m as any).meta?.albumId || (m as any).albumMid || (m as any).album?.mid)
            const albumMid = seed ? String((seed as any).meta?.albumId || (seed as any).albumMid || (seed as any).album?.mid) : ''
            const albumSource = seed?.source
            if (albumMid && albumSource && musicSdk[albumSource]?.extendDetail?.getAlbumSongs) {
                try {
                    const data = await musicSdk[albumSource].extendDetail.getAlbumSongs(albumMid)
                    const fullList = (data.list || []).map((s: any) => ({
                        ...s,
                        id: `${albumSource}_${s.songmid || s.songId}`,
                        source: albumSource,
                    }))
                    // 仅当在线结果更完整时才替换，避免接口异常时反而丢数据
                    if (fullList.length > musics.length) {
                        musics = fullList as any
                        if (data.name) listName = data.name
                        albumPublishTime = data.publishTime || albumPublishTime
                    }
                } catch (e: any) {
                    subsonicLog.error(`[Subsonic] 聚合专辑补全失败 (${id}):`, e?.message)
                }
            }
        } else if (id.includes('_')) {
            // 动态支持：如果客户端把某首歌的 id 当作专辑 id 来查
            const found = await this.findMusicById(username, id)
            if (found) {
                musics = [found.music]
                listName = found.music.name
            } else {
                // 如果在列表里没找到，尝试解析 ID 构造
                const parts = id.split('_')
                const source = parts[0]
                const songmid = parts.slice(1).join('_')
                if (musicSdk[source]) {
                    musics = [{ id, name: 'Unknown', singer: 'Unknown', source, songmid, interval: '0' } as any]
                    listName = 'Single Album'
                }
            }
        } else {
            const list = listData.userList.find((l: any) => l.id === id)
            if (list) {
                listName = list.name
                musics = (list.list || []) as LX.Music.MusicInfo[]
            }
        }

        // [dislike] 命中不喜欢规则的歌曲从专辑曲目中剔除
        if (global.lx.config['subsonic.hideDisliked']) {
            musics = await this.filterDislikedSongs(username, musics)
        }

        const albumMeta = {
            id,
            name: listName,
            title: listName,
            album: listName,
            artist: (musics.length === 1) ? musics[0].singer : 'LX Music',
            artistId: (musics.length === 1) ? ((musics[0] as any).singerId ? `art_${musics[0].source}_${(musics[0] as any).singerId}` : `artist_${(musics[0].singer || '').split('、')[0]}`) : 'artist_lxmusic',
            songCount: musics.length,
            duration: musics.reduce((sum: number, m: any) => sum + this.parseDuration(m.interval), 0),
            created: new Date().toISOString(),
            // [修复] 优先使用图片的真实 URL，而不是 ID，以规避后端 getCoverArt 抓取失败的问题
            coverArt: (musics[0] as any)?.meta?.picUrl || (musics[0] as any)?.img || id,
            isDir: true,
            playCount: 0,
            year: albumPublishTime ? parseInt(albumPublishTime.split(/[/-]/)[0]) : ((musics[0] as any)?.year || (musics[0] as any)?.meta?.year),
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                album: {
                    ...albumMeta,
                    song: musics.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id, albumMeta.artistId, username)),
                },
            }, format)
        }

        return this.sendResponse(res, {
            album: {
                attrs: albumMeta,
                children: {
                    song: musics.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id, albumMeta.artistId, username)),
                },
            },
        }, format)
    }

    private async handleGetSong(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        let music: LX.Music.MusicInfo | null = null
        let listId = 'online'

        const found = await this.findMusicById(username, id)
        if (found) {
            music = found.music
            listId = found.listId
        } else if (id.includes('_')) {
            // 在线歌曲 ID 动态元数据兜底 (处理 wy_1378492134, tx_... 等客户端请求非本地库歌曲)
            const parts = id.split('_')
            const source = parts[0]
            const songmid = parts.slice(1).join('_')
            const title = params.get('title') || params.get('name') || songmid
            const singer = params.get('artist') || params.get('singer') || 'Unknown Artist'
            music = {
                id,
                name: title,
                singer: singer,
                source: source,
                songmid: songmid,
                interval: '0',
                meta: {
                    songId: songmid,
                },
            } as any
        }

        if (!music) return this.sendError(res, 70, 'Song not found: ' + id, format)

        if (format === 'json') {
            return this.sendResponse(res, { song: this.musicToSongFlat(music, listId, undefined, username) }, format)
        }
        return this.sendResponse(res, { song: this.musicToSongXml(music, listId, undefined, username) }, format)
    }

    private async handleGetMusicDirectory(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        if (!id || id === '1' || id === 'root') {
            const dirs = [
                { id: 'love', parent: 'root', title: '我的收藏', isDir: true, coverArt: (listData.loveList[0] as any)?.meta?.picUrl || (listData.loveList[0] as any)?.img || 'logo' },
                { id: 'default', parent: 'root', title: '默认列表', isDir: true, coverArt: (listData.defaultList[0] as any)?.meta?.picUrl || (listData.defaultList[0] as any)?.img || 'logo' },
                { id: 'radios', parent: 'root', title: '官方电台', isDir: true },
                ...listData.userList.map((l: any) => ({
                    id: l.id,
                    parent: 'root',
                    title: l.name,
                    isDir: true,
                    coverArt: (l as any).Album || (l as any).picUrl || (l.list?.[0] as any)?.meta?.picUrl || (l.list?.[0] as any)?.img || 'logo',
                })),
            ]
            if (format === 'json') {
                return this.sendResponse(res, {
                    directory: { id: 'root', name: 'Music', child: dirs },
                }, format)
            }
            return this.sendResponse(res, {
                directory: {
                    attrs: { id: 'root', name: 'Music' },
                    children: { child: dirs.map(d => ({ attrs: d })) },
                },
            }, format)
        }

        if (id === 'radios') {
            // [新增] 返回官方电台列表
            // const radios = await fetchRadios()
            const radios: any[] = []
            const dirs = radios.map(r => ({
                id: r.id,
                parent: 'radios',
                title: r.name,
                name: r.name,
                isDir: true,
                coverArt: r.coverArt
            }))
            if (format === 'json') {
                return this.sendResponse(res, { directory: { id: 'radios', name: '官方电台', child: dirs } }, format)
            }
            return this.sendResponse(res, {
                directory: {
                    attrs: { id: 'radios', name: '官方电台' },
                    children: { child: dirs.map(d => ({ attrs: d })) }
                }
            }, format)
        }

        let musics: LX.Music.MusicInfo[] = []
        let dirName = 'Unknown'

        if (id.startsWith('radio_tx_')) {
            // [新增] 返回具体电台内的歌曲
            // const radioId = id.replace('radio_tx_', '')
            try {
                // const songs = await fetchRadioSongs(radioId)
                const songs: any[] = []
                dirName = '电台列表'
                musics = (songs || []).map((s: any) => ({
                    id: `tx_${s.songmid || s.mid}`,
                    name: s.songname || s.name,
                    singer: (s.singer || []).map((si: any) => si.name).join('、'),
                    source: 'tx',
                    songmid: s.songmid || s.mid,
                    interval: s.interval || 0,
                    img: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
                    meta: {
                        albumName: '官方电台',
                        albumId: id,
                        picUrl: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : ''
                    }
                } as any))
            } catch (e) {
                subsonicLog.error(`[Subsonic] Fetch radio songs failed:`, e)
            }
        } else if (id === 'love') {
            musics = listData.loveList
            dirName = '我的收藏'
        } else if (id === 'default') {
            musics = listData.defaultList
            dirName = '默认列表'
        } else {
            const list = listData.userList.find((l: any) => l.id === id)
            if (list) {
                dirName = list.name
                musics = (list.list || []) as LX.Music.MusicInfo[]
            }
        }

        // [dislike] 过滤不喜欢的歌曲
        if (global.lx.config['subsonic.hideDisliked']) {
            musics = await this.filterDislikedSongs(username, musics)
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                directory: {
                    id,
                    name: dirName,
                    child: musics.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id, undefined, username)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            directory: {
                attrs: { id, name: dirName },
                children: {
                    child: musics.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id, undefined, username)),
                },
            },
        }, format)
    }

    /**
     * 补全本地专辑库（library/albums.json）中缺失的曲目列表。
     *
     * Subsonic 星标写回原生收藏时只存了名称与封面，没有 list，导致专辑显示 0 首
     * （例如「太阳之子」）。这里对缺 list 的专辑用 albumId 向音源拉一次并写回，
     * 使列表的 songCount 与详情页都正确。单次最多补全 MAX_FILL 张，避免拖慢接口。
     */
    private async ensureLibraryAlbumSongs(username: string): Promise<void> {
        let libAlbums: any[]
        try {
            libAlbums = await this.getLibraryData(username, 'albums')
        } catch {
            return
        }
        if (!Array.isArray(libAlbums) || libAlbums.length === 0) return

        const MAX_FILL = 20         // 单次请求最多「成功补全」的专辑数
        const MAX_ATTEMPTS = 20     // 单次请求最多发起的回源次数（原实现只统计成功数，音源全挂时会遍历整个库）
        const REQ_TIMEOUT = 8000    // 单次回源超时(ms)，无超时会挂住整个 getAlbumList
        const FAIL_COOLDOWN = 10 * 60 * 1000  // 失败冷却 10 分钟，冷却期内不再重复回源

        // 带超时的 Promise 包装：超时后清理定时器，避免遗留句柄
        const withTimeout = (p: Promise<any>, ms: number): Promise<any> =>
            new Promise<any>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
                Promise.resolve(p).then(
                    v => { clearTimeout(timer); resolve(v) },
                    e => { clearTimeout(timer); reject(e) },
                )
            })

        let filled = 0
        let attempted = 0
        let dirty = false
        const now = Date.now()

        for (const alb of libAlbums) {
            if (filled >= MAX_FILL || attempted >= MAX_ATTEMPTS) break
            if (Array.isArray(alb?.list) && alb.list.length > 0) continue
            const source = alb.source || 'wy'
            const albMid = String(alb?.meta?.albumId || alb?.id || '')
            if (!albMid) continue
            // 失败冷却：近期回源失败的专辑在冷却期内直接跳过，避免每次请求都重复打音源
            const failedAt = Number(alb?.fillFailedAt || 0)
            if (failedAt && now - failedAt < FAIL_COOLDOWN) continue
            const sdk = (musicSdk as any)[source]
            if (!sdk?.extendDetail?.getAlbumSongs) continue

            attempted++
            try {
                const data = await withTimeout(sdk.extendDetail.getAlbumSongs(albMid), REQ_TIMEOUT)
                const list = (data?.list || []).map((s: any) => ({
                    source,
                    singer: s.singer,
                    name: s.name,
                    albumName: s.albumName || alb.name || data.name,
                    albumId: s.albumMid || albMid,
                    albumMid: s.albumMid || albMid,
                    interval: s.interval,
                    img: s.img,
                    songId: s.songId,
                    songmid: s.songmid || s.songId,
                }))
                if (list.length === 0) {
                    // 空结果同样视为失败：记录时间戳并写回，冷却期内不再重试
                    alb.fillFailedAt = now
                    dirty = true
                    continue
                }
                alb.list = list
                if (alb.fillFailedAt !== undefined) delete alb.fillFailedAt
                if (!alb.name && data.name) alb.name = data.name
                if (!alb.picUrl && list[0]?.img) alb.picUrl = list[0].img
                dirty = true
                filled++
            } catch (e: any) {
                // 记录失败时间，使后续请求在冷却期内跳过该专辑（原实现失败不记忆，会每次重复回源）
                alb.fillFailedAt = now
                dirty = true
                subsonicLog.error(`[Subsonic] 专辑库补全失败 (${source}/${albMid}):`, e?.message)
            }
        }

        if (dirty) {
            try {
                await this.writeLibraryData(username, 'albums', libAlbums)
                subsonicLog.debug(`[Subsonic] 已补全 ${filled} 张本地专辑的曲目列表 (user=${username})`)
            } catch (e) {
                subsonicLog.error('[Subsonic] 写回专辑库失败:', e)
            }
        }
    }

    private async handleGetAlbumList(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
        isV2: boolean,
    ) {
        const type = params.get('type') || 'newest'
        const size = Math.min(parseInt(params.get('size') || '10'), 500)
        const offset = parseInt(params.get('offset') || '0')
        if (global.lx.config['subsonic.enableDebug']) {
            subsonicLog.debug(`[Subsonic Debug] [AlbumList] type=${type} offset=${offset} size=${size}`)
        }
        let albums: any[] = []

        // [推荐逻辑] 根据 type 处理推荐。
        // 推荐池按固定容量拉取（与客户端请求的 size 无关），翻页时从同一份池里 slice，
        // 避免"只有第一页有推荐、第二页突然变成本地收藏"的数据断层。
        const RECOMMEND_POOL_SIZE = Math.max(20, Math.min(500, global.lx.config['subsonic.recommendPoolSize'] ?? 100))
        let recommendPool: any[] = []

        // [播放历史] recent / frequent 优先使用真实播放记录（scrobble）。
        // 之前这两个 type 返回的都是在线推荐的新专辑，与用户实际听过的内容毫无关系，
        // 导致客户端「最近播放」页面显示的并不是自己听过的东西。
        if (type === 'recent' || type === 'frequent') {
            try {
                const history = readScrobbles(username)
                if (history.length) {
                    recommendPool = await this.buildPlayedAlbums(username, history, type, RECOMMEND_POOL_SIZE)
                }
            } catch (e) {
                subsonicLog.error(`[Subsonic] 播放历史构造专辑列表失败(${type}):`, e)
                recommendPool = []
            }
        }

        if (recommendPool.length === 0 && (type === 'recent' || type === 'newest' || type === 'random' || type === 'byGenre')) {
            try {
                if (type === 'byGenre') {
                    const genreNameOrId = params.get('genre') || ''
                    // 尝试从 fetchGenres 中寻找 ID (如果传入的是名称)
                    let categoryId = genreNameOrId
                    if (isNaN(parseInt(genreNameOrId))) {
                        const genres = await fetchGenres()
                        const target = genres.find(g => g.value === genreNameOrId)
                        if (target) categoryId = target.id
                    }
                    if (categoryId) {
                        recommendPool = await fetchPlaylistsByGenre(categoryId, RECOMMEND_POOL_SIZE)
                    }
                } else {
                    // recent/newest 取新专辑；random 取随机推荐。recent/newest 取不到(空或抛错)时回退到 random
                    const rType = (type === 'random') ? 'random' : 'recent'
                    try {
                        recommendPool = await cachedRecommend(rType, RECOMMEND_POOL_SIZE)
                    } catch (e) {
                        subsonicLog.error(`[Subsonic] recommend (${rType}) failed:`, e)
                    }
                    if (recommendPool.length === 0 && rType === 'recent') {
                        try {
                            recommendPool = await cachedRecommend('random', RECOMMEND_POOL_SIZE)
                        } catch (e) {
                            subsonicLog.error(`[Subsonic] recommend fallback (random) failed:`, e)
                        }
                    }
                }
            } catch (e) {
                subsonicLog.error(`[Subsonic] Fetch recommended albums (${type}) failed:`, e)
            }
        }

        // 分页：推荐池独立翻页，不与本地收藏库拼接。
        // 本地收藏有专门的入口（客户端的收藏/媒体库），无需在推荐列表里重复出现；
        // 推荐池翻完即为空，客户端自然停止滚动。
        if (recommendPool.length > 0) {
            albums = recommendPool.slice(offset, offset + size)
        } else {
            // 推荐池为空（type 不是推荐类，或推荐接口失败）→ 回退到本地收藏库
            // 补全本地专辑库缺失的曲目列表（星标回写可能只存了名称/封面，导致 0 首）
            await this.ensureLibraryAlbumSongs(username)
            const libAlbums = await this.getLibraryData(username, 'albums')

            const buildAlbum = (album: any) => {
                const source = album.source || 'wy'
                const primarySinger = (album.artistName || '').split('、')[0] || 'LX Music'
                const artistId = album.singerId ? `art_${source}_${album.singerId}` : `artist_${primarySinger}`
                return {
                    id: `alb_${source}_${album.id}`,
                    name: album.name,
                    title: album.name,
                    album: album.name,
                    artist: album.artistName || 'LX Music',
                    artistId: artistId,
                    isDir: true,
                    coverArt: album.picUrl || album.meta?.picUrl || this.buildAlbumCoverUrl(source, String(album.id)) || `alb_${source}_${album.id}`,
                    songCount: (album.list || []).length,
                    duration: (album.list || []).reduce((s: number, m: any) => s + this.parseDuration(m.interval), 0),
                    created: new Date().toISOString(),
                    playCount: 0,
                    year: album.publishTime ? parseInt(String(album.publishTime).split(/[/-]/)[0]) : undefined,
                }
            }

            let pool = libAlbums.map(buildAlbum)

            // [兜底] 用户未必单独收藏过专辑（NAS 实测 library/albums.json 是空的），
            // 推荐接口又整批失败时，从本地歌曲反推专辑；还不够就用在线歌曲缓存补齐，
            // 避免「最近发行」这类标签页直接空白
            if (pool.length < RECOMMEND_POOL_SIZE) {
                const seen = new Set<string>(pool.map(a => String(a.id)))
                for (const a of await this.buildLocalAlbums(username, true)) {
                    if (seen.has(String(a.id))) continue
                    seen.add(String(a.id))
                    pool.push(a)
                }
            }

            if (type === 'random') {
                for (let i = pool.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1))
                    ;[pool[i], pool[j]] = [pool[j], pool[i]]
                }
            }

            albums = pool.slice(offset, offset + size)
        }

        const wrapKey = isV2 ? 'albumList2' : 'albumList'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: { album: albums },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: { album: albums.map(alb => ({ attrs: alb })) },
            },
        }, format)
    }


    /**
     * 从本地数据反推出专辑列表，作为在线推荐失败时的兜底。
     *
     * 实测 NAS 上腾讯 musicu 推荐接口会整批失败（日志里 getArtistAlbums、source=tx 搜索批量报错），
     * 而用户未必单独收藏过专辑（NAS 上该用户的 library/ 目录就是空的），
     * 原逻辑会一路回退到空列表，客户端「最近发行」直接一片空白。
     *
     * 只收录带 albumId 的条目：没有 albumId 的专辑点进去拿不到曲目，宁可不显示。
     */
    private async buildLocalAlbums(username: string, includeOnlineCache: boolean): Promise<any[]> {
        const collect = (songs: any[], out: Map<string, any>) => {
            for (const m of songs) {
                if (!m) continue
                const source = m.source || 'wy'
                const albumName = String((m as any)?.meta?.albumName || (m as any)?.albumName || '').trim()
                const albumId = String((m as any)?.meta?.albumId || (m as any)?.albumId || '').trim()
                if (!albumId || !albumName || albumName === 'Unknown Album') continue
                const key = `${source}_${albumId}`
                const exist = out.get(key)
                if (exist) {
                    exist.songCount += 1
                    continue
                }
                const primarySinger = String(m.singer || '').split('、')[0] || 'LX Music'
                out.set(key, {
                    id: `alb_${source}_${albumId}`,
                    name: albumName,
                    title: albumName,
                    album: albumName,
                    artist: m.singer || 'LX Music',
                    artistId: (m as any).singerId ? `art_${source}_${(m as any).singerId}` : `artist_${primarySinger}`,
                    isDir: true,
                    coverArt: (m as any)?.meta?.picUrl || (m as any)?.img || `alb_${source}_${albumId}`,
                    songCount: 1,
                    duration: this.parseDuration(m.interval),
                    created: new Date().toISOString(),
                    playCount: 0,
                })
            }
        }

        const out = new Map<string, any>()
        try {
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()
            collect(listData.loveList || [], out)
            collect(listData.defaultList || [], out)
            for (const l of (listData.userList || [])) collect((l as any).list || [], out)
            const libAlbums = await this.getLibraryData(username, 'albums')
            for (const alb of libAlbums) collect((alb as any).list || [], out)
        } catch (e) {
            subsonicLog.error('[Subsonic] 本地歌曲聚合专辑失败:', e)
        }

        // 最后手段：在线歌曲缓存（持久化的历史搜索结果，NAS 上有数千首）。
        // 它的内容不是「新发行」，优先级最低，仅用于保证列表非空。
        if (includeOnlineCache && out.size < 20) {
            this.loadOnlineSongCache()
            collect(Array.from(this.onlineSongCache.values()), out)
        }

        return Array.from(out.values())
    }

    /**
     * 聚合出「歌手维度」目录。
     *
     * 歌手来源不再只依赖 library/artists.json（用户显式收藏的歌手，通常只有个位数），
     * 而是从本地所有歌曲（我的收藏 / 默认列表 / 全部歌单 / 收藏专辑库）反向聚合，
     * 保证音流等客户端的「歌手」标签页有内容且 albumCount / songCount 为真实值。
     */
    private async buildArtistDirectory(username: string) {
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()
        const libArtists = await this.getLibraryData(username, 'artists')
        const libAlbums = await this.getLibraryData(username, 'albums')
        const meta = await this.getUserSubsonicMeta(username)
        const starredArtistSet = new Set<string>(meta.starredArtists || [])
        const starredArtistNameSet = new Set<string>(meta.starredArtistNames || [])

        // 1. 汇总本地所有歌曲
        const allSongs: LX.Music.MusicInfo[] = []
        const pushList = (list: any) => {
            for (const m of (list || [])) allSongs.push(m as LX.Music.MusicInfo)
        }
        pushList(listData.loveList)
        pushList(listData.defaultList)
        for (const l of (listData.userList || [])) pushList((l as any).list)
        // 本地收藏专辑库里的曲目（原始字段，映射成 MusicInfo 兼容格式）
        for (const alb of libAlbums) {
            const albSource = alb.source || 'wy'
            for (const s of (alb.list || [])) {
                allSongs.push({
                    id: `${s.source || albSource}_${s.songmid || s.songId}`,
                    name: s.name,
                    singer: s.singer,
                    source: s.source || albSource,
                    songmid: s.songmid,
                    interval: s.interval || '0',
                    img: s.img,
                    meta: {
                        picUrl: s.img,
                        albumName: s.albumName || alb.name,
                        albumId: s.albumMid || alb.id,
                    },
                } as any)
            }
        }

        // 2. 聚合歌手
        const artistsMap = new Map<string, {
            id: string
            name: string
            source: string
            singerId: string
            picUrl: string
            albumKeys: Set<string>
            songCount: number
            starred: boolean
            songs: LX.Music.MusicInfo[]
        }>()

        const ensure = (id: string, name: string, source: string, singerId: string, picUrl: string) => {
            let entry = artistsMap.get(id)
            if (!entry) {
                entry = {
                    id,
                    name,
                    source,
                    singerId,
                    picUrl: picUrl || '',
                    albumKeys: new Set<string>(),
                    songCount: 0,
                    starred: false,
                    songs: [],
                }
                artistsMap.set(id, entry)
            }
            if (!entry.picUrl && picUrl) entry.picUrl = picUrl
            return entry
        }

        // 2a. 用户显式收藏的歌手（即使名下没有本地曲目也要出现在列表里）
        for (const a of libArtists) {
            const source = a.source || 'wy'
            const id = `art_${source}_${a.id}`
            const entry = ensure(id, a.name, source, String(a.id), a.picUrl || a.img || '')
            if (starredArtistSet.has(id) || starredArtistNameSet.has(this.normalizeArtistName(a.name))) {
                entry.starred = true
            }
        }

        // 2b. 从本地曲目反推歌手
        for (const m of allSongs) {
            const singer = m.singer || ''
            const primary = (singer.split('、')[0] || '').trim()
            if (!primary || primary === 'Unknown Artist') continue
            const source = m.source
            const singerId = (m as any).singerId
            const id = singerId ? `art_${source}_${singerId}` : `artist_${primary}`
            const entry = ensure(id, primary, source, singerId ? String(singerId) : '', (m as any).meta?.picUrl || (m as any).img || '')

            const albumKey = (m as any).meta?.albumName || (m as any).albumName || (m as any).album?.name || ''
            if (albumKey && albumKey !== 'Unknown Album') entry.albumKeys.add(albumKey)
            entry.songCount += 1
            entry.songs.push(m)
            if (starredArtistSet.has(id) || starredArtistNameSet.has(this.normalizeArtistName(primary))) {
                entry.starred = true
            }
        }

        // [修复] 同名条目合并：收藏歌手库用规范 id（art_源_平台ID），本地曲目反推用名字型 id（artist_名字），
        // 两者会在客户端变成两个同名歌手，且收藏那条通常是 0 专辑 0 歌曲（点进去一片空白）。
        // 这里把同名条目并入规范条目：曲目 / 专辑 / 星标 / 头像合并，保留规范 id 以便继续走平台数据。
        const buckets = new Map<string, any[]>()
        for (const entry of artistsMap.values()) {
            const key = normalizeSingerName(toSimplified(entry.name || ''))
            if (!key) continue
            if (!buckets.has(key)) buckets.set(key, [])
            buckets.get(key)!.push(entry)
        }

        const mergedList: any[] = []
        for (const group of buckets.values()) {
            if (group.length === 1) {
                mergedList.push(group[0])
                continue
            }
            // 主条目优先取规范 id（art_ 前缀，能走平台数据），其次取本地曲目最多的
            const sorted = group.slice().sort((a, b) => {
                const av = a.id.startsWith('art_') ? 0 : 1
                const bv = b.id.startsWith('art_') ? 0 : 1
                if (av !== bv) return av - bv
                return (b.songCount || 0) - (a.songCount || 0)
            })
            const main = sorted[0]
            const seenSongs = new Set<string>((main.songs || []).map((s: any) => String(s?.id || '')))
            for (const other of sorted.slice(1)) {
                for (const s of other.songs || []) {
                    const sid = String(s?.id || '')
                    if (sid && seenSongs.has(sid)) continue
                    if (sid) seenSongs.add(sid)
                    main.songs.push(s)
                }
                for (const k of other.albumKeys || []) main.albumKeys.add(k)
                main.starred = main.starred || other.starred
                if (!main.picUrl && other.picUrl) main.picUrl = other.picUrl
                if (!main.singerId && other.singerId) main.singerId = other.singerId
            }
            main.songCount = main.songs.length
            mergedList.push(main)
        }

        return mergedList
    }

    /**
     * 歌手列表接口：收藏歌手 + 本地曲目反推出的歌手聚合，albumCount / songCount 取真实值。
     */
    private async handleGetArtists(res: http.ServerResponse, username: string, format: string) {
        // [修改] 歌手列表 = 收藏歌手 + 本地曲目反推出的歌手，albumCount / songCount 取真实值
        const entries = await this.buildArtistDirectory(username)

        const artists = entries
            .filter(a => a.name && a.name !== 'Unknown Artist')
            .map(a => ({
                id: a.id,
                name: a.name,
                albumCount: a.albumKeys.size,
                songCount: a.songCount,
                coverArt: a.id,
                // 头像字段同样降尺寸：客户端直连时会直接下载，原图实测有 17.9MB
                artistImageUrl: a.picUrl ? downscaleAvatarUrl(a.picUrl) : undefined,
                ...(a.starred ? { starred: new Date().toISOString() } : {}),
            }))
            .sort((x, y) => x.name.localeCompare(y.name, 'zh-Hans-CN'))

        // 按索引分组：中文按拼音首字母归入 A-Z，
        // 避免中文歌手全部挤在 “#” 里导致客户端字母索引失效
        const indexMap = new Map<string, any[]>()
        for (const a of artists) {
            const key = getArtistIndexKey(a.name)
            if (!indexMap.has(key)) indexMap.set(key, [])
            indexMap.get(key)!.push(a)
        }

        // “#” 组排在最后（与 Navidrome 等服务端实现一致），其余按字母顺序
        const indexArr = Array.from(indexMap.entries())
            .sort((a, b) => ((a[0] === '#' ? 1 : 0) - (b[0] === '#' ? 1 : 0)) || a[0].localeCompare(b[0]))
            .map(([name, artistList]) => ({
                name,
                artist: artistList,
            }))

        if (format === 'json') {
            return this.sendResponse(res, {
                artists: { ignoredArticles: 'The An A Die Das Ein', index: indexArr },
            }, format)
        }

        return this.sendResponse(res, {
            artists: {
                attrs: { ignoredArticles: 'The An A Die Das Ein' },
                children: {
                    index: indexArr.map(idx => ({
                        attrs: { name: idx.name },
                        children: { artist: idx.artist.map(a => ({ attrs: a })) }
                    }))
                },
            },
        }, format)
    }


    private async handleGetArtist(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        // [修复] 收藏元数据：用于判断当前歌手是否已收藏（客户端爱心高亮）
        const meta = await this.getUserSubsonicMeta(username)
        const starredArtistSet = new Set(meta.starredArtists)
        const starredArtistNameSet = new Set(meta.starredArtistNames)

        let source = 'wy'
        let artistId = ''
        let singerName = 'Unknown'

        // 严格解析规范 ID: art_source_id
        if (id.startsWith('art_')) {
            const parts = id.split('_')
            source = parts[1]
            artistId = parts.slice(2).join('_')
        } else if (id.startsWith('artist_')) {
            // 名字型 id：先不在线寻址，交给下面的「本地优先」逻辑
            singerName = decodeURIComponent(id.slice(7))
        } else {
            artistId = id
        }

        // 本地「歌手维度」聚合数据，两个用途：
        // 1) 在线接口取不到时用它兜底，保证歌手页不空白（否则只有客户端本地收藏的那几首）；
        // 2) 名字型 id(artist_<名字>) 若本地目录里有规范 id(source+singerId)，直接复用，
        //    不再依赖在线寻址——寻址走音源搜索接口，偶发失败会让整页专辑/歌曲栏空白。
        const directory = await this.buildArtistDirectory(username)
        const localEntry = directory.find(a => a.id === id)
            || (singerName && singerName !== 'Unknown' ? directory.find(a => a.name === singerName) : undefined)
        if (localEntry && (!singerName || singerName === 'Unknown')) singerName = localEntry.name

        if (!artistId && singerName && singerName !== 'Unknown') {
            if (localEntry?.source && localEntry?.singerId) {
                source = localEntry.source
                artistId = String(localEntry.singerId)
            } else {
                // [修复] 之前这里把源写死成 'tx'，违反 singer.sourcePriority：
                // getSingerMid 若命中的是 wy，却拿 wy 的 mid 去请求 tx 的专辑接口，必然失败或串台。
                const detail = await getSingerDetail(singerName)
                if (detail) {
                    source = detail.source
                    artistId = detail.mid
                    if (detail.matchedName) singerName = detail.matchedName
                } else {
                    artistId = singerName // 退化：按名字查（多数源会失败，最终靠本地兜底）
                }
            }
        }

        // 定义精准的平台 ID (用于封面和元数据绑定)
        const resolvedId = (source && artistId && artistId !== id) ? `art_${source}_${artistId}` : id

        // 调用 SDK 获取详情
        let albums: any[] = []
        let hotSongs: LX.Music.MusicInfo[] = []
        let artistPic = ''

        // [跨源合并] 歌手名未知时（例如直接点 art_tx_<mid> 进来），先向主源要一次详情拿名字，
        // 否则无法按名字到其它平台寻址
        if ((!singerName || singerName === 'Unknown') && artistId && musicSdk[source]?.extendDetail?.getArtistDetail) {
            const d = await musicSdk[source].extendDetail.getArtistDetail(artistId).catch(() => null)
            if (d?.name) singerName = d.name
            if (d?.avatar || d?.pic) artistPic = d.avatar || d.pic
        }

        // 参与抓取的「源 + 该源自己的 mid」：
        // 1) 主源（id 里带的那个平台）永远排第一；
        // 2) singer.sourcePriority 配了多个源时，按歌手名到其它平台再寻址一轮，
        //    把那些平台的专辑/歌曲也合并进来——各平台 mid 不通用，必须各自寻址。
        //    只配了 1 个源时行为不变（单源）。
        const sourceTargets: Array<{ source: string, id: string }> = []
        if (artistId && artistId !== singerName) sourceTargets.push({ source, id: artistId })
        if (singerName && singerName !== 'Unknown' && getOrderedSingerSources().length > 1) {
            const hits = await resolveSingerSources(singerName).catch(() => [] as any[])
            for (const h of hits) {
                if (!sourceTargets.some(t => t.source === h.source)) {
                    sourceTargets.push({ source: h.source, id: h.mid })
                }
            }
        }

        // 单个源上抓取：专辑多页（最多 5 页 × 50）+ 热门歌曲多页（最多 5 页 × 100）
        const fetchSourceData = async (src: string, sid: string) => {
            const sdk = musicSdk[src]?.extendDetail
            if (!sdk) return { albums: [] as any[], songs: [] as any[], pic: '', name: '' }

            const fetchAllAlbums = async () => {
                const MAX_PAGES = 5
                const PAGE_SIZE = 50
                let all: any[] = []
                for (let p = 1; p <= MAX_PAGES; p++) {
                    try {
                        const data = await sdk.getArtistAlbums(sid, p, PAGE_SIZE)
                        const pageList = data.list || []
                        all = all.concat(pageList)
                        if (pageList.length < PAGE_SIZE) break
                    } catch (err) {
                        subsonicLog.error(`[Subsonic] SDK getArtistAlbums(${src}) Error at page ${p}:`, err)
                        break
                    }
                }
                return all
            }
            const fetchAllSongs = async () => {
                const MAX_PAGES = 5
                const PAGE_SIZE = 100
                let all: any[] = []
                for (let p = 1; p <= MAX_PAGES; p++) {
                    try {
                        const data = await sdk.getArtistSongs(sid, p, PAGE_SIZE, 'hot')
                        const pageList = data.list || []
                        all = all.concat(pageList)
                        if (pageList.length < PAGE_SIZE) break
                    } catch (err) {
                        subsonicLog.error(`[Subsonic] SDK getArtistSongs(${src}) Error at page ${p}:`, err)
                        break
                    }
                }
                return all
            }

            const [rawAlbums, allSongsRaw] = await Promise.all([
                fetchAllAlbums().catch(() => [] as any[]),
                fetchAllSongs().catch(() => [] as any[]),
            ])

            return {
                albums: rawAlbums,
                songs: allSongsRaw,
                pic: rawAlbums[0]?.singerPic || (allSongsRaw[0] as any)?.singerPic || '',
                name: rawAlbums[0]?.singerName || '',
            }
        }

        try {
            const perSource = await Promise.all(sourceTargets.map(t => fetchSourceData(t.source, t.id)))

            // [修复] 歌手名取 SDK 返回的官方名，并只保留主歌手：
            // 之前无条件取 allSongsRaw[0].singer，热歌首曲若为合唱，整页名字会串成「黄霄雲、刘端端」
            for (const r of perSource) {
                if (!r.name) continue
                singerName = splitSingers(r.name)[0] || r.name
                break
            }
            if ((!singerName || singerName === 'Unknown') && localEntry?.name) singerName = localEntry.name
            if (!singerName) {
                const libArtists = await this.getLibraryData(username, 'artists')
                const localArt = libArtists.find(a => (a.source === source && a.id === artistId) || a.name === artistId)
                if (localArt) singerName = localArt.name
            }

            // 封面：主源优先，任一个有图即可
            if (!artistPic) {
                for (const r of perSource) {
                    if (r.pic) { artistPic = r.pic; break }
                }
            }

            // 合并各源结果：专辑按归一化专辑名去重，歌曲按「归一歌名 + 主歌手」去重，主源版本胜出
            const seenAlbum = new Set<string>()
            const seenSong = new Set<string>()
            for (let i = 0; i < perSource.length; i++) {
                const src = sourceTargets[i].source

                for (const alb of perSource[i].albums) {
                    const key = normalizeSingerName(alb.name)
                    if (!key || seenAlbum.has(key)) continue
                    seenAlbum.add(key)
                    albums.push({
                        id: `alb_${src}_${alb.id || alb.albumMid}`,
                        name: alb.name,
                        title: alb.name,
                        album: alb.name,
                        artist: singerName || alb.singerName || 'Unknown',
                        artistId: resolvedId,
                        songCount: alb.total || 0,
                        coverArt: alb.img || alb.picUrl || resolvedId,
                        isDir: true,
                        year: alb.publishTime ? parseInt(String(alb.publishTime).split(/[/-]/)[0]) : undefined,
                    })
                }

                for (const s of perSource[i].songs) {
                    const dedupKey = `${normalizeSingerName(s.name)}@${normalizeSingerName(splitSingers(s.singer || '')[0] || '')}`
                    if (seenSong.has(dedupKey)) continue
                    seenSong.add(dedupKey)
                    hotSongs.push({ ...s, id: `${src}_${s.songmid || s.songId}` } as any)
                }
            }
        } catch (e) {
            subsonicLog.error(`[Subsonic] SDK Artist load error:`, e)
        }

        // [歌手维度兜底] 在线数据缺失时，用本地聚合出的专辑 / 曲目填充，避免歌手页空白
        if (localEntry) {
            if (albums.length === 0) {
                const groupMap = new Map<string, LX.Music.MusicInfo[]>()
                for (const m of localEntry.songs) {
                    const key = (m as any).meta?.albumName || (m as any).albumName || '未知专辑'
                    if (!groupMap.has(key)) groupMap.set(key, [])
                    groupMap.get(key)!.push(m)
                }
                albums = Array.from(groupMap.entries()).map(([name, songs]) => {
                    const first = songs[0] as any
                    const albumMid = first.meta?.albumId || first.albumMid || first.album?.mid
                    // 有 albumMid 就用 alb_ 前缀（点开走 SDK 补全整张专辑），否则退回聚合 ID
                    const albId = albumMid
                        ? `alb_${first.source || source}_${albumMid}`
                        : `album_${Buffer.from(`${name}__${singerName}`).toString('base64url').slice(0, 24)}`
                    return {
                        id: albId,
                        name,
                        title: name,
                        album: name,
                        artist: singerName,
                        artistId: resolvedId,
                        songCount: songs.length,
                        coverArt: first.meta?.picUrl || first.img || albId,
                        isDir: true,
                    }
                })
            }
            if (hotSongs.length === 0) hotSongs = localEntry.songs
        }

        /* 
        // 构造一个虚拟专辑放置热门歌曲，这在多数 Subsonic 客户端中不仅能显示歌曲，还能保持列表整洁
        if (hotSongs.length > 0) {
            albums.unshift({
                id: `alb_hot_${id}`, // 使用 alb_ 前缀确保可以被 handleGetAlbum 处理
                name: `${singerName} - 热门歌曲`,
                artist: singerName,
                artistId: id,
                songCount: hotSongs.length,
                coverArt: id // 歌手的照片
            })
        }
        */

        // [dislike] 歌手页的热门歌曲同样过滤
        if (global.lx.config['subsonic.hideDisliked']) {
            hotSongs = await this.filterDislikedSongs(username, hotSongs)
        }

        const artistStarred = starredArtistSet.has(resolvedId) ||
            starredArtistNameSet.has(this.normalizeArtistName(singerName))
        const artistInfo = {
            id,
            name: singerName,
            albumCount: albums.length,
            songCount: hotSongs.length,
            coverArt: resolvedId,
            // [修复] 没有封面时不能把 ID 令牌塞进 artistImageUrl（它是 URL 字段），
            // 否则客户端会把它当图片直链去请求而必然失败；应留空让客户端回落到 coverArt
            artistImageUrl: artistPic || undefined,
            ...(artistStarred ? { starred: new Date().toISOString() } : {}),
        }

        // 这里的关键：Subsonic getArtist 响应中可以包含 album 和 song
        // 音流等客户端会优先显示这些 song 在“歌曲”标签页或“热门”列表里
        // 这里的关键：Subsonic getArtist 响应中可以包含 album 和 song
        // 音流等客户端会优先显示这些 song 在“歌曲”标签页或“热门”列表里
        // [修复] 传入 id 作为 artistIdOverride，确保歌曲显示与当前歌手页面归属匹配
        if (format === 'json') {
            return this.sendResponse(res, {
                artist: {
                    ...artistInfo,
                    album: albums,
                    song: hotSongs.map((m: LX.Music.MusicInfo) => this.musicToSongFlat(m, id, id, username))
                },
            }, format)
        }
        return this.sendResponse(res, {
            artist: {
                attrs: artistInfo,
                children: {
                    album: albums.map(a => ({ attrs: a })),
                    song: hotSongs.map((m: LX.Music.MusicInfo) => this.musicToSongXml(m, id, id, username))
                },
            },
        }, format)
    }


    private async handleGetArtistInfo(res: http.ServerResponse, username: string, params: URLSearchParams, format: string, method?: string) {
        const id = params.get('id') || ''
        const artistName = params.get('artist') || ''

        const libArtists = await this.getLibraryData(username, 'artists')
        const artistEntry = libArtists.find(a =>
            (id && `art_${a.source || 'wy'}_${a.id}` === id) ||
            (artistName && a.name.toLowerCase() === artistName.toLowerCase())
        )

        const name = artistEntry?.name || artistName || id.replace('artist_', '')
        const detail = await getSingerDetail(name)

        const pic = detail?.pic || (artistEntry ? (artistEntry.picUrl || artistEntry.img) : '')

        const info = {
            biography: detail?.desc || (artistEntry ? `Artist: ${artistEntry.name} (Source: ${artistEntry.source})` : ''),
            musicBrainzId: '',
            lastFmUrl: '',
            smallImageUrl: pic,
            mediumImageUrl: pic,
            largeImageUrl: pic,
        }
        // [修复] 根元素此前恒为 artistInfo2，导致 getArtistInfo(v1) 也返回 v2 的结构
        const wrapKey = method === 'getArtistInfo2' ? 'artistInfo2' : 'artistInfo'
        if (format === 'json') {
            return this.sendResponse(res, { [wrapKey]: info }, format)
        }
        return this.sendResponse(res, { [wrapKey]: { attrs: info } }, format)
    }

    private async handleGetGenres(res: http.ServerResponse, username: string, format: string) {
        const genres = await fetchGenres()
        // subsonicLog.debug(`[Subsonic] handleGetGenres found ${genres.length} genres`)
        if (format === 'json') {
            return this.sendResponse(res, { genres: { genre: genres } }, format)
        }
        return this.sendResponse(res, {
            genres: {
                children: {
                    genre: genres.map(g => ({ attrs: { songCount: g.songCount, albumCount: g.albumCount }, children: g.value }))
                }
            }
        }, format)
    }

    private async handleGetInternetRadioStations(res: http.ServerResponse, format: string) {
        // const radios = await fetchRadios()
        const radios: any[] = []
        if (format === 'json') {
            return this.sendResponse(res, { internetRadioStations: { internetRadioStation: radios } }, format)
        }
        return this.sendResponse(res, {
            internetRadioStations: {
                children: {
                    internetRadioStation: radios.map(r => ({ attrs: r }))
                }
            }
        }, format)
    }

    private async fetchOnlineSearchSongs(cleanQuery: string, sources: string[], limit: number = 30): Promise<{ music: LX.Music.MusicInfo, listId: string }[]> {
        if (!cleanQuery) return []
        const validSources = sources.filter(s => ['wy', 'tx', 'kw', 'kg', 'mg'].includes(s) && musicSdk[s]?.musicSearch?.search)
        const cacheKey = `${cleanQuery.toLowerCase()}::${validSources.join(',')}`
        const cached = this.onlineSearchCache.get(cacheKey)
        if (cached && cached.expiresAt > Date.now()) return cached.results

        const sourceResults = new Map<string, { music: LX.Music.MusicInfo, listId: string }[]>()
        // 每个平台一次取足上限，后续 songOffset 分页复用同一批稳定结果。
        const targetLimit = 50

        await Promise.all(validSources.map(async source => {
            const results: { music: LX.Music.MusicInfo, listId: string }[] = []
            sourceResults.set(source, results)
            try {
                // 计算需要的页数 (网易云 wy 单页限制 20 条，如需要 50 条则自动抓取前 3 页)
                const pageSize = source === 'kg' ? Math.min(targetLimit, 100) : source === 'wy' ? 20 : 30
                const pagesToFetch = Math.min(Math.ceil(targetLimit / pageSize), 3) // 最多自动抓取前 3 页

                const allItems: any[] = []
                const existingIds = new Set<string>()

                // [新增] 简繁变体补搜：原词命中不足时换个字形再搜一轮
                // （实测「黄霄雲」(繁) 各源合计仅 5 条，「黄霄云」(简) 有 203 条）
                for (const kw of buildQueryVariants(cleanQuery)) {
                    for (let page = 1; page <= pagesToFetch; page++) {
                        const searchRes = await musicSdk[source].musicSearch.search(kw, page, pageSize)
                        const list = Array.isArray(searchRes?.list) ? searchRes.list : []
                        if (list.length === 0) break

                        for (const item of list) {
                            const songmid = String(item.songmid || item.id || '')
                            if (!songmid || existingIds.has(songmid)) continue
                            existingIds.add(songmid)
                            allItems.push(item)
                        }

                        if (allItems.length >= targetLimit) break
                    }
                    if (allItems.length >= targetLimit) break
                }

                for (const item of allItems.slice(0, targetLimit)) {
                    const songmid = String(item.songmid || item.id || '')
                    const id = `${source}_${songmid}`
                    const hash = item.hash || item.meta?.hash || item.types?.[0]?.hash || ''
                    const music: LX.Music.MusicInfo = {
                        id,
                        name: item.name,
                        singer: item.singer,
                        source: source,
                        songmid: songmid,
                        hash: hash,
                        interval: item.interval || '0',
                        _interval: item._interval || item.interval || '0',
                        img: item.img,
                        types: item.types || item._types || [],
                        _types: item._types || item.types || {},
                        meta: {
                            ...(item.meta || {}),
                            hash: hash,
                            picUrl: item.img,
                            albumName: item.albumName || item.name,
                            albumId: item.albumId,
                            qualitys: item.types || item._types || [],
                            _types: item._types || item.types || {},
                        },
                    } as any
                    this.cacheOnlineSong(music)
                    results.push({ music, listId: 'online' })
                }
            } catch (err: any) {
                subsonicLog.error(`[Subsonic] Online search error for source=${source}:`, err?.message || err)
            }
        }))

        const interleaved: { music: LX.Music.MusicInfo, listId: string }[] = []
        const maxLength = Math.max(0, ...validSources.map(source => sourceResults.get(source)?.length || 0))
        for (let index = 0; index < maxLength; index++) {
            for (const source of validSources) {
                const item = sourceResults.get(source)?.[index]
                if (item) interleaved.push(item)
            }
        }
        if (this.onlineSearchCache.size >= 100) {
            const firstKey = this.onlineSearchCache.keys().next().value
            if (firstKey) this.onlineSearchCache.delete(firstKey)
        }
        this.onlineSearchCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, results: interleaved })
        return interleaved
    }

    /**
     * 在线搜索歌手（各源 extendSearch.searchSinger），映射为 Subsonic artist 结构。
     * 各源并发、单源 8s 超时、按规范 id 去重，失败静默跳过（不影响其它源）。
     */
    /**
     * 歌手名与查询词的相关度(0~1)：先做简繁/标点归一再比较，完全相等为 1，否则取字符命中率。
     * 音源会把联想兜底结果一并返回（搜「黄霄云」会带回「周兴哲」这类完全无关的歌手），据此剔除。
     */
    private artistRelevance(query: string, name: string): number {
        const q = normalizeSingerName(toSimplified(query || ''))
        const n = normalizeSingerName(toSimplified(name || ''))
        if (!q || !n) return 0
        if (q === n) return 1
        return nameSimilarity(q, n)
    }

    private async fetchOnlineSearchArtists(query: string, sources: string[], limit: number): Promise<any[]> {
        const max = Math.max(1, Math.min(limit || 20, 50))
        // 跨源合并与否由 singer.sourcePriority 决定：只配了 1 个源时保持单源行为
        const orderedSources = getOrderedSingerSources()
        const mergeAcrossSources = orderedSources.length > 1
        const sourceRank = new Map<string, number>()
        orderedSources.forEach((s, i) => sourceRank.set(s, i))

        const groups = await Promise.all(sources.map(async (src): Promise<any[]> => {
            const sdk = (musicSdk as any)[src]
            if (!sdk?.extendSearch?.searchSinger) return []
            const rows: any[] = []
            const seen = new Set<string>()
            try {
                // [新增] 简繁变体补搜（同歌曲搜索）
                for (const kw of buildQueryVariants(query)) {
                    const data: any = await withTimeout(sdk.extendSearch.searchSinger(kw, 1, max), 8000)
                    for (const item of (data?.list || [])) {
                        const mid = String(item.mid || item.id || '')
                        if (!mid) continue
                        const id = `art_${src}_${mid}`
                        if (seen.has(id)) continue
                        seen.add(id)
                        const name = item.name || ''
                        rows.push({
                            id,
                            name,
                            title: name,
                            albumCount: item.albumSize ?? 0,
                            coverArt: id,               // 交给 getCoverArt 的 art_ 分支解析
                            artistImageUrl: item.picUrl ? downscaleAvatarUrl(item.picUrl) : undefined,
                            isDir: true,
                            _source: src,
                            _score: this.artistRelevance(query, name),
                        })
                    }
                    if (rows.length >= max) break
                }
            } catch { /* 单源失败忽略 */ }
            return rows
        }))

        const all = groups.flat()
        if (!all.length) return []

        // 相关性保留线：音源会把联想兜底结果一起返回，名字与查询毫无交集的
        //（搜「黄霄云」带回「周兴哲」这类）低于此线丢掉；
        // 名字相关的（「黄霄雲的人」「黄霄云的面包」）保留，靠排序让真身排最前。
        const MIN_SCORE = 0.3
        let kept: any[] = all.filter(a => a._score > MIN_SCORE)
        // 全部判为无关时回填原始结果，避免拼音/生僻写法被误伤导致搜空
        if (!kept.length) kept = all
        // 排序：先按相关度降序，同相关度按作品量降序（真身通常专辑/歌曲最多）
        kept.sort((a, b) => (b._score - a._score) || ((b.albumCount || 0) - (a.albumCount || 0)))

        // 同名多源合并：归一化姓名相同的不同平台条目合成一条，按 singer.sourcePriority 选代表
        if (mergeAcrossSources) {
            const byName = new Map<string, any>()
            for (const item of kept) {
                const key = normalizeSingerName(toSimplified(item.name || ''))
                if (!key) continue
                const exist = byName.get(key)
                if (!exist) {
                    byName.set(key, item)
                    continue
                }
                const ra = sourceRank.has(exist._source) ? sourceRank.get(exist._source)! : 99
                const rb = sourceRank.has(item._source) ? sourceRank.get(item._source)! : 99
                if (rb < ra) byName.set(key, item)
            }
            kept = Array.from(byName.values())
        }

        return kept.slice(0, max).map(({ _source, _score, ...rest }) => rest)
    }

    /**
     * 在线搜索专辑（各源 extendSearch.searchAlbum），映射为 Subsonic album 结构。
     * id 采用 alb_<source>_<albumMid>，点进去即可走 handleGetAlbum 的 SDK 分支。
     */
    private async fetchOnlineSearchAlbums(query: string, sources: string[], limit: number): Promise<any[]> {
        const max = Math.max(1, Math.min(limit || 20, 50))
        const seen = new Set<string>()
        const groups = await Promise.all(sources.map(async (src): Promise<any[]> => {
            const sdk = (musicSdk as any)[src]
            if (!sdk?.extendSearch?.searchAlbum) return []
            const rows: any[] = []
            try {
                // [新增] 简繁变体补搜（同歌曲搜索）
                for (const kw of buildQueryVariants(query)) {
                    const data: any = await withTimeout(sdk.extendSearch.searchAlbum(kw, 1, max), 8000)
                    for (const item of (data?.list || [])) {
                        const mid = String(item.mid || item.id || '')
                        if (!mid) continue
                        const id = `alb_${src}_${mid}`
                        if (seen.has(id)) continue
                        seen.add(id)
                        const artistName = item.artistName || ''
                        const artistId = item.artistId
                            ? `art_${src}_${item.artistId}`
                            : (artistName ? `artist_${artistName}` : id)
                        rows.push({
                            id,
                            name: item.name || '',
                            title: item.name || '',
                            album: item.name || '',
                            artist: artistName,
                            artistId,
                            isDir: true,
                            coverArt: item.picUrl || id,
                            songCount: item.size || 0,
                            duration: 0,
                            created: new Date().toISOString(),
                            playCount: 0,
                        })
                    }
                    if (rows.length >= max) break
                }
            } catch { /* 单源失败忽略 */ }
            return rows
        }))
        return interleaveBySource(groups, max)
    }

    private async handleSearch(res: http.ServerResponse, username: string, params: URLSearchParams, format: string, method: string = 'search3') {
        let rawQuery = (params.get('query') || '').trim()
        if (rawQuery === '""' || rawQuery === "''") rawQuery = '' // 处理某些客户端发送的空占位符

        // 0. 解析搜索前缀与搜索模式
        let searchMode: 'local_only' | 'force_online' | 'fallback' | 'merge' = 'fallback'
        let targetOnlineSources: string[] = String(global.lx.config['subsonic.onlineSearchSources'] || 'wy,tx,kw,kg,mg').split(',').map(s => s.trim()).filter(Boolean)
        let cleanQuery = rawQuery

        const lowerQuery = rawQuery.toLowerCase()
        if (lowerQuery.startsWith('local:') || lowerQuery.startsWith('local：')) {
            searchMode = 'local_only'
            cleanQuery = rawQuery.slice(6).trim()
        } else if (lowerQuery.startsWith('online:') || lowerQuery.startsWith('online：') || lowerQuery.startsWith('net:') || lowerQuery.startsWith('net：')) {
            searchMode = 'force_online'
            const colonIdx = rawQuery.indexOf(':') !== -1 ? rawQuery.indexOf(':') : rawQuery.indexOf('：')
            cleanQuery = rawQuery.slice(colonIdx + 1).trim()
        } else {
            // 检查指定的音源前缀: wy:, tx:, kw:, kg:, mg:
            const knownSources = ['wy', 'tx', 'kw', 'kg', 'mg']
            let matchedPrefixSource = ''
            for (const s of knownSources) {
                if (lowerQuery.startsWith(`${s}:`) || lowerQuery.startsWith(`${s}：`)) {
                    matchedPrefixSource = s
                    break
                }
            }
            if (matchedPrefixSource) {
                searchMode = 'force_online'
                targetOnlineSources = [matchedPrefixSource]
                const colonIdx = rawQuery.indexOf(':') !== -1 ? rawQuery.indexOf(':') : rawQuery.indexOf('：')
                cleanQuery = rawQuery.slice(colonIdx + 1).trim()
            } else if (lowerQuery.startsWith('all:') || lowerQuery.startsWith('all：')) {
                searchMode = 'force_online'
                const colonIdx = rawQuery.indexOf(':') !== -1 ? rawQuery.indexOf(':') : rawQuery.indexOf('：')
                cleanQuery = rawQuery.slice(colonIdx + 1).trim()
            } else {
                const requestedSource = (params.get('source') || params.get('musicFolderId') || '').trim().toLowerCase()
                if (requestedSource === 'local') {
                    searchMode = 'local_only'
                } else if (requestedSource === 'all') {
                    searchMode = 'force_online'
                } else if (knownSources.includes(requestedSource)) {
                    searchMode = 'force_online'
                    targetOnlineSources = [requestedSource]
                } else {
                    // 没有明确指定音源时，遵循全局后台配置
                    const isOnlineEnabled = global.lx.config['subsonic.onlineSearch'] !== false
                    if (!isOnlineEnabled) {
                        searchMode = 'local_only'
                    } else {
                        searchMode = (global.lx.config['subsonic.onlineSearchMode'] as any) || 'fallback'
                    }
                }
            }
        }

        const queryForFilter = cleanQuery.toLowerCase()

        // 1. 汇总所有本地歌曲 (去重)
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        const allSongsMap = new Map<string, { music: LX.Music.MusicInfo, listId: string }>()
        const collectSongs = (list: LX.Music.MusicInfo[], listId: string) => {
            for (const m of list) {
                if (!allSongsMap.has(m.id)) {
                    allSongsMap.set(m.id, { music: m, listId })
                }
            }
        }
        collectSongs(listData.loveList, 'love')
        collectSongs(listData.defaultList, 'default')
        for (const list of listData.userList) {
            collectSongs((list.list || []) as LX.Music.MusicInfo[], list.id)
        }

        // 补充本地收藏专辑库中的歌曲
        const libAlbums = await this.getLibraryData(username, 'albums')
        for (const alb of libAlbums) {
            const source = alb.source || 'wy'
            for (const s of (alb.list || [])) {
                const songId = `${source}_${s.songmid || s.songId}`
                if (!allSongsMap.has(songId)) {
                    allSongsMap.set(songId, {
                        music: {
                            id: songId,
                            name: s.name,
                            singer: s.singer,
                            source: source,
                            songmid: s.songmid,
                            interval: s.interval || '0',
                            img: s.img,
                            meta: {
                                picUrl: s.img,
                                albumName: s.albumName || alb.name,
                                albumId: s.albumMid || alb.id,
                            },
                        } as any,
                        listId: `alb_${source}_${alb.id}`,
                    })
                }
            }
        }
        const allLocalSongs = Array.from(allSongsMap.values())

        // 2. 汇总所有歌手 (去重)
        const allArtistsMap = new Map<string, any>()
        const libArtists = await this.getLibraryData(username, 'artists')
        for (const a of libArtists) {
            const id = `art_${a.source || 'wy'}_${a.id}`
            allArtistsMap.set(id, {
                id,
                name: a.name,
                coverArt: id,
                artistImageUrl: a.picUrl || a.img,
                albumCount: 0,
            })
        }
        for (const { music } of allLocalSongs) {
            const singer = music.singer || 'Unknown Artist'
            const primarySinger = (singer.split('、')[0] || 'Unknown Artist').trim()
            const source = music.source
            const artistId = (music as any).singerId ? `art_${source}_${(music as any).singerId}` : `artist_${primarySinger}`
            if (!allArtistsMap.has(artistId)) {
                allArtistsMap.set(artistId, {
                    id: artistId,
                    name: primarySinger,
                    coverArt: artistId,
                    albumCount: 0,
                })
            }
        }
        const allLocalArtists = Array.from(allArtistsMap.values())

        // 3. 汇总所有专辑 (去重)
        const allAlbumsMap = new Map<string, any>()
        for (const alb of libAlbums) {
            const source = alb.source || 'wy'
            const primarySinger = (alb.artistName || '').split('、')[0] || 'LX Music'
            const artistId = alb.singerId ? `art_${source}_${alb.singerId}` : `artist_${primarySinger}`
            const albId = `alb_${source}_${alb.id}`
            allAlbumsMap.set(albId, {
                id: albId,
                name: alb.name,
                title: alb.name,
                album: alb.name,
                artist: alb.artistName || 'LX Music',
                artistId: artistId,
                isDir: true,
                coverArt: alb.picUrl || alb.meta?.picUrl || albId,
                songCount: (alb.list || []).length,
                duration: (alb.list || []).reduce((s: number, m: any) => s + this.parseDuration(m.interval), 0),
                created: new Date().toISOString(),
                playCount: 0,
                year: alb.publishTime ? parseInt(String(alb.publishTime).split(/[/-]/)[0]) : undefined,
            })
        }
        for (const { music } of allLocalSongs) {
            const meta = (music as any).meta || {}
            const albumName = meta.albumName || (music as any).albumName || (music as any).album?.name
            const rawAlbumId = (music as any).albumMid || (music as any).album?.mid || meta.albumId || (music as any).albumId || (music as any).album?.id
            if (albumName && albumName !== 'Unknown Album') {
                const source = music.source
                const albId = rawAlbumId ? `alb_${source}_${rawAlbumId}` : `album_${Buffer.from(`${albumName}__${music.singer}`).toString('base64url').slice(0, 24)}`
                if (!allAlbumsMap.has(albId)) {
                    const primarySinger = (music.singer || '').split('、')[0] || 'Unknown Artist'
                    const artistId = (music as any).singerId ? `art_${source}_${(music as any).singerId}` : `artist_${primarySinger}`
                    const picUrl = meta.picUrl || (music as any).img || (music as any).pic
                    allAlbumsMap.set(albId, {
                        id: albId,
                        name: albumName,
                        title: albumName,
                        album: albumName,
                        artist: music.singer || 'Unknown Artist',
                        artistId: artistId,
                        isDir: true,
                        coverArt: picUrl || albId,
                        songCount: 1,
                        duration: this.parseDuration(music.interval),
                        created: new Date().toISOString(),
                        playCount: 0,
                    })
                } else {
                    // [修复] 同一专辑的多首收藏需要累加，否则 songCount 恒为 1
                    const exist = allAlbumsMap.get(albId)!
                    exist.songCount += 1
                    exist.duration += this.parseDuration(music.interval)
                }
            }
        }
        const allLocalAlbums = Array.from(allAlbumsMap.values())

        // 4. 执行本地检索过滤
        let matchedSongs = queryForFilter
            ? allLocalSongs.filter(({ music }) =>
                music.name.toLowerCase().includes(queryForFilter) ||
                music.singer.toLowerCase().includes(queryForFilter) ||
                ((music as any).meta?.albumName || '').toLowerCase().includes(queryForFilter)
            )
            : allLocalSongs

        let matchedArtists = queryForFilter
            ? allLocalArtists.filter(a => a.name.toLowerCase().includes(queryForFilter))
            : allLocalArtists

        let matchedAlbums = queryForFilter
            ? allLocalAlbums.filter(a => a.name.toLowerCase().includes(queryForFilter) || a.artist.toLowerCase().includes(queryForFilter))
            : allLocalAlbums

        // 5. 分页参数解析
        const artistCount = params.has('artistCount') ? parseInt(params.get('artistCount') || '20') : 20
        const artistOffset = parseInt(params.get('artistOffset') || '0')
        const albumCount = params.has('albumCount') ? parseInt(params.get('albumCount') || '20') : 20
        const albumOffset = parseInt(params.get('albumOffset') || '0')
        const songCount = params.has('songCount') ? parseInt(params.get('songCount') || '20') : 20
        const songOffset = parseInt(params.get('songOffset') || '0')
        const requestedSongEnd = Math.max(0, songOffset) + Math.max(0, songCount)

        // 6. 处理在线 API 搜索与模式融合
        if (cleanQuery && songCount > 0) {
            if (searchMode === 'force_online') {
                const onlineResults = await this.fetchOnlineSearchSongs(cleanQuery, targetOnlineSources, requestedSongEnd)
                matchedSongs = onlineResults
            } else if (searchMode === 'merge') {
                const onlineResults = await this.fetchOnlineSearchSongs(cleanQuery, targetOnlineSources, requestedSongEnd)
                const existingIds = new Set(matchedSongs.map(s => s.music.id))
                for (const item of onlineResults) {
                    if (!existingIds.has(item.music.id)) {
                        matchedSongs.push(item)
                        existingIds.add(item.music.id)
                    }
                }
            } else if (searchMode === 'fallback') {
                if (matchedSongs.length < requestedSongEnd) {
                    const needed = requestedSongEnd - matchedSongs.length
                    const onlineResults = await this.fetchOnlineSearchSongs(cleanQuery, targetOnlineSources, needed)
                    const existingIds = new Set(matchedSongs.map(s => s.music.id))
                    for (const item of onlineResults) {
                        if (!existingIds.has(item.music.id)) {
                            matchedSongs.push(item)
                            existingIds.add(item.music.id)
                        }
                    }
                }
            }
        }

        // [新增] 在线歌手/专辑搜索：Subsonic 客户端搜索页有「艺人 / 专辑」两栏，
        // 此前它们只从本地库取（未收藏时恒为空）。这里在本地区结果不足时并发补在线结果。
        if (cleanQuery && searchMode !== 'local_only') {
            const needArtists = artistCount > 0 && matchedArtists.length < artistOffset + artistCount
            const needAlbums = albumCount > 0 && matchedAlbums.length < albumOffset + albumCount
            if (needArtists || needAlbums) {
                const [onlineArtists, onlineAlbums] = await Promise.all([
                    needArtists
                        ? this.fetchOnlineSearchArtists(cleanQuery, targetOnlineSources, artistOffset + artistCount)
                        : Promise.resolve([] as any[]),
                    needAlbums
                        ? this.fetchOnlineSearchAlbums(cleanQuery, targetOnlineSources, albumOffset + albumCount)
                        : Promise.resolve([] as any[]),
                ])
                const artistIds = new Set(matchedArtists.map((a: any) => a.id))
                for (const a of onlineArtists) {
                    if (!artistIds.has(a.id)) { matchedArtists.push(a); artistIds.add(a.id) }
                }
                const albumIds = new Set(matchedAlbums.map((a: any) => a.id))
                for (const a of onlineAlbums) {
                    if (!albumIds.has(a.id)) { matchedAlbums.push(a); albumIds.add(a.id) }
                }
            }
        }

        // [新增] 跨源同名去重：同一首歌常会被多个音源各返回一次（搜一次出现 5 份），
        // 按「歌名 + 主歌手」归一后只保留一份，优先保留 subsonic.source.priority 中更靠前的源。
        // 只合并"同名同歌手"的跨源重复，不合并不同版本（Live/Remix 等歌名本身不同）。
        if (matchedSongs.length > 1) {
            const rawPriority = global.lx.config['subsonic.source.priority']
            const priority: string[] = Array.isArray(rawPriority) ? rawPriority : ['kw', 'tx', 'wy', 'mg', 'kg']
            const rankOf = (src: string) => {
                const i = priority.indexOf(src)
                return i < 0 ? priority.length : i
            }
            const picked = new Map<string, { item: any, rank: number }>()
            const order: string[] = []
            for (const it of matchedSongs as any[]) {
                const m = it.music || it
                const key = `${normalizeText(String(m.name || ''))}@${normalizeText(String((m.singer || '').split('、')[0] || ''))}`
                const rank = rankOf(String(m.source || ''))
                const prev = picked.get(key)
                if (!prev) {
                    picked.set(key, { item: it, rank })
                    order.push(key)
                } else if (rank < prev.rank) {
                    picked.set(key, { item: it, rank })
                }
            }
            const beforeCount = matchedSongs.length
            if (order.length !== beforeCount) {
                matchedSongs = order.map(k => picked.get(k)!.item)
                subsonicLog.debug(`[Subsonic] 跨源去重: ${beforeCount} → ${matchedSongs.length} (query=${cleanQuery})`)
            } else {
                subsonicLog.debug(`[Subsonic] 跨源去重: 无重复 ${beforeCount} 条 (query=${cleanQuery}) 样例key=${Array.from(picked.keys()).slice(0, 3).join(' | ')}`)
            }
        }

        // [dislike] 命中不喜欢规则的歌曲从搜索结果中剔除（放在分页之前，避免过滤后每页数量不足）
        // matchedSongs 的元素是 { music, listId }，需取出 music 过滤后再映射回去
        if (global.lx.config['subsonic.hideDisliked']) {
            const entries = matchedSongs as Array<{ music: LX.Music.MusicInfo, listId: string }>
            const kept = await this.filterDislikedSongs(username, entries.map(e => e.music))
            if (kept.length !== entries.length) {
                const keptIds = new Set(kept.map(m => m.id))
                matchedSongs = entries.filter(e => keptIds.has(e.music.id)) as any
            }
        }

        const pagedArtists = artistCount > 0 ? matchedArtists.slice(artistOffset, artistOffset + artistCount) : []
        const pagedAlbums = albumCount > 0 ? matchedAlbums.slice(albumOffset, albumOffset + albumCount) : []
        const pagedSongs = songCount > 0 ? matchedSongs.slice(songOffset, songOffset + songCount) : []

        const wrapKey = method === 'search' ? 'searchResult' : method === 'search2' ? 'searchResult2' : 'searchResult3'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: {
                    artist: pagedArtists,
                    album: pagedAlbums,
                    song: pagedSongs.map(({ music, listId }) => this.musicToSongFlat(music, listId, undefined, username)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: {
                    artist: pagedArtists.map(a => ({ attrs: a })),
                    album: pagedAlbums.map(a => ({ attrs: a })),
                    song: pagedSongs.map(({ music, listId }) => this.musicToSongXml(music, listId, undefined, username)),
                },
            },
        }, format)
    }

    /**
     * 按歌曲 id 从各音源在线回源取单曲信息（github/dev 移植自 feat/subsonic）
     * 支持 tx / wy / kg / mg / kw / bd；xm 等无「按 id 取单曲」接口的源返回 null 降级。
     */
    private async resolveMusicById(id: string): Promise<LX.Music.MusicInfo | null> {
        const idx = id.indexOf('_')
        if (idx <= 0) return null
        const source = id.slice(0, idx)
        const songId = id.slice(idx + 1)
        if (!songId) return null
        try {
            let music: any = null
            switch (source) {
                case 'tx':
                    music = await txMusicInfo(songId)
                    break
                case 'wy': {
                    // wy/musicInfo.js 返回的是 requestObj，真实数据在 .promise 里
                    const raw: any = await (wyMusicInfo(songId) as any).promise
                    if (raw) {
                        music = {
                            id: `wy_${songId}`,
                            name: raw.name,
                            singer: raw.artists ? raw.artists.map((a: any) => a.name).join('、') : '',
                            source: 'wy',
                            songmid: songId,
                            interval: raw.dt ? String(Math.round(raw.dt / 1000)) : '0',
                            img: raw.album?.picUrl ?? null,
                            meta: {
                                albumName: raw.album?.name,
                                albumId: raw.album?.id,
                                picUrl: raw.album?.picUrl,
                            },
                        }
                    }
                    break
                }
                case 'kg':
                    music = await kgGetMusicInfo(songId)
                    break
                case 'mg':
                    music = await mgGetMusicInfo(songId)
                    break
                case 'kw': {
                    // kw 有 getMusicInfo(songInfo)：www.kuwo.cn/api/www/music/musicInfo?mid=<songmid>
                    // 返回 data 含 name / artist / album / pic / duration
                    const info: any = await musicSdk.kw.getMusicInfo({ songmid: songId }).catch((e: any) => {
                        this.logSourceError('kw', `getMusicInfo kw_${songId}`, e)
                        return null
                    })
                    if (info && info.name) {
                        const artist = info.artist
                        const singer = Array.isArray(artist)
                            ? artist.map((a: any) => a?.name || a).join('、')
                            : (typeof artist === 'string' ? artist : (artist?.name || ''))
                        music = {
                            id: `kw_${songId}`,
                            name: info.name,
                            singer,
                            source: 'kw',
                            songmid: songId,
                            interval: info.duration ? String(Math.round(Number(info.duration) > 100000 ? Number(info.duration) / 1000 : Number(info.duration))) : '0',
                            img: info.pic || null,
                            meta: {
                                albumName: info.album || '',
                                albumId: info.albumid ?? '',
                                picUrl: info.pic || null,
                            },
                        }
                    }
                    break
                }
                case 'bd': {
                    // bd 有 getMusicInfo(songmid)：baidu.ting.song.getSongLink -> result.songinfo
                    const info: any = await (bdMusicInfo.getMusicInfo(songId) as any).promise.catch((e: any) => {
                        this.logSourceError('bd', `getMusicInfo bd_${songId}`, e)
                        return null
                    })
                    if (info && info.title) {
                        music = {
                            id: `bd_${songId}`,
                            name: info.title,
                            singer: info.author || '',
                            source: 'bd',
                            songmid: songId,
                            interval: info.file_duration ? String(Math.round(Number(info.file_duration))) : '0',
                            img: info.pic_big || info.pic_small || null,
                            meta: {
                                albumName: info.album_title || '',
                                albumId: info.album_id || '',
                                picUrl: info.pic_big || info.pic_small || null,
                            },
                        }
                    }
                    break
                }
                default:
                    return null
            }
            if (!music) {
                if (global.lx.config['subsonic.enableDebug']) {
                    subsonicLog.debug(`[Subsonic][trace] resolveMusicById ${id}: 回源未取到音乐信息(source=${source})`)
                }
                return null
            }
            if (!music.source) music.source = source
            if (!music.id) music.id = `${source}_${music.songmid || music.songId || songId}`
            if (!music.songmid) music.songmid = music.songId || songId
            if (!music.name) {
                subsonicLog.warn(`[Subsonic] resolveMusicById ${id} 取回结果缺少歌名，已放弃（不写入收藏）`)
                return null
            }
            if (global.lx.config['subsonic.enableDebug']) {
                subsonicLog.debug(`[Subsonic][trace] resolveMusicById ${id}: 成功取到 name=${music.name}, singer=${music.singer || '(空)'}`)
            }
            return music as LX.Music.MusicInfo
        } catch (e) {
            this.logSourceError('resolveMusicById', `回源 ${id}`, e)
            return null
        }
    }

    /** 统一元数据解析原语：本地/缓存 -> 在线回源；命中即回写 onlineSongCache */
    private async resolveSongMeta(username: string, id: string): Promise<{ music: LX.Music.MusicInfo, listId: string } | null> {
        const debug = !!global.lx.config['subsonic.enableDebug']
        if (debug) subsonicLog.debug(`[Subsonic][trace] resolveSongMeta ${id}: 第1步 查持久化(歌单/专辑库) + 内存/磁盘 onlineSongCache`)
        const found = await this.findMusicById(username, id)
        if (found) {
            this.cacheOnlineSong(found.music)
            if (debug) subsonicLog.debug(`[Subsonic][trace] resolveSongMeta ${id}: 第1步命中 listId=${found.listId}, name=${found.music.name || '(空)'}`)
            return found
        }
        if (debug) subsonicLog.debug(`[Subsonic][trace] resolveSongMeta ${id}: 第1步未命中 -> 第2步 在线回源(network)`)
        const resolved = await this.resolveMusicById(id)
        if (resolved) {
            this.cacheOnlineSong(resolved)
            if (debug) subsonicLog.debug(`[Subsonic][trace] resolveSongMeta ${id}: 第2步回源成功 name=${resolved.name}, 已写 onlineSongCache(内存+磁盘)`)
            return { music: resolved, listId: 'online' }
        }
        if (debug) subsonicLog.debug(`[Subsonic][trace] resolveSongMeta ${id}: 第2步回源失败 -> 返回 null(将在 stream 中降级为 Unknown)`)
        return null
    }

    /**
     * star / unstar：歌曲 → 「我的收藏(love)」列表
     * （github/dev 移植自 feat/subsonic：歌曲经 resolveSongMeta 解析，支持在线回源）
     */
    /** 用户维度 Subsonic 扩展元数据：星标专辑 / 星标歌手（委托模块级函数，便于 server.ts 反向同步共用） */
    private async getUserSubsonicMeta(username: string): Promise<{ starredAlbums: string[], starredArtists: string[], starredArtistNames: string[], ratings: Record<string, number> }> {
        return readSubsonicMeta(username)
    }

    private async saveUserSubsonicMeta(username: string, meta: { starredAlbums: string[], starredArtists: string[], starredArtistNames: string[], ratings: Record<string, number> }) {
        writeSubsonicMeta(username, meta)
    }

    /** 歌手名归一化：去空格 + 小写，用于跨大小写/音源匹配 */
    private normalizeArtistName(name: string): string {
        return (name || '').trim().toLowerCase()
    }

    /**
     * 将歌手 id 解析为 (规范 art_ id, 歌手名) 两件套，供 star / getStarred 统一使用。
     * - art_源_id：规范 id，直接返回 id；并尽量从本地歌手库反查名字（保证 unstar 时名字集合一致）。
     * - artist_名字：兜底 id（歌曲/专辑映射在无 singerId 时生成），用 getSingerMid 寻址归一为 art_tx_mid；
     *   寻址失败时退回原名（artist_名字），仍按名字匹配。
     */
    private async resolveArtistKey(username: string, id: string): Promise<{ canonical: string | null, name?: string }> {
        if (id.startsWith('art_')) {
            let name: string | undefined
            try {
                const libArtists = await this.getLibraryData(username, 'artists')
                const found = libArtists.find((a: any) => `art_${a.source || 'wy'}_${a.id}` === id)
                if (found?.name) name = found.name
            } catch { /* 忽略，反查名字非必须 */ }
            return { canonical: id, name }
        }
        if (id.startsWith('artist_')) {
            const name = decodeURIComponent(id.slice(7))
            try {
                const mid = await getSingerMid(name)
                if (mid) return { canonical: `art_tx_${mid}`, name }
            } catch { /* 寻址失败，退回原名 */ }
            return { canonical: id, name }
        }
        return { canonical: id, name: undefined }
    }

    private async handleStar(res: http.ServerResponse, username: string, params: URLSearchParams, format: string, isStar: boolean) {
        // 收集 id / albumId / artistId（均允许逗号分隔的多个值）
        const ids: string[] = []
        for (const key of ['id', 'albumId', 'artistId']) {
            for (const value of params.getAll(key)) {
                for (const one of value.split(',')) {
                    const trimmed = one.trim()
                    if (trimmed) ids.push(trimmed)
                }
            }
        }
        if (!ids.length) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        const userSpace = getUserSpace(username)
        const meta = await this.getUserSubsonicMeta(username)
        const starredAlbums = new Set(meta.starredAlbums)
        const starredArtists = new Set(meta.starredArtists)
        // 歌手名集合：用于跨音源 / artist_名字 兜底 id 的星标匹配
        const starredArtistNames = new Set(meta.starredArtistNames)
        const location = (global.lx.config['list.addMusicLocationType'] || 'bottom') as 'top' | 'bottom'
        let loveChanged = false
        let metaChanged = false
        // 记录本次操作的增量。循环里存在网络 await（解析专辑/歌手/歌曲），
        // 不能长时间持锁，因此只在写回时加锁，并把增量与「最新 meta」合并，避免覆盖并发写入。
        const addedAlbums = new Set<string>()
        const removedAlbums = new Set<string>()
        const addedArtists = new Set<string>()
        const removedArtists = new Set<string>()
        const addedArtistNames = new Set<string>()
        const removedArtistNames = new Set<string>()
        const action = isStar ? 'star' : 'unstar'
        const debug = !!global.lx.config['subsonic.enableDebug']
        const debugLog = (msg: string) => { if (debug) console.log(msg) }

        // 原生媒体库收藏（用于双向同步：音流星标 -> 网页前端收藏）
        const nativeArtists = await this.getLibraryData(username, 'artists')
        const nativeAlbums = await this.getLibraryData(username, 'albums')
        let nativeArtistsDirty = false
        let nativeAlbumsDirty = false

        for (const id of ids) {
            if (id.startsWith('alb_')) {
                if (isStar) { starredAlbums.add(id); addedAlbums.add(id) } else { starredAlbums.delete(id); removedAlbums.add(id) }
                metaChanged = true
                subsonicLog.debug(`[Subsonic] ${action} 专辑 ${id} (user=${username})`)
                debugLog(`[Subsonic Debug] ${action} 专辑 ${id} -> ${isStar ? '已星标' : '已取消星标'} (user=${username})`)
                // 双向同步：写回原生媒体库收藏
                const m = id.match(/^alb_([a-zA-Z0-9]+)_(.+)$/)
                if (m) {
                    const source = m[1]
                    const realId = m[2]
                    if (isStar) {
                        if (!nativeAlbums.some((a: any) => String(a.id) === realId && a.source === source)) {
                            const { name, picUrl } = await this.resolveAlbumInfo(source, realId)
                            if (name) {
                                nativeAlbums.push({ id: realId, source, name, picUrl, artistName: '' })
                                nativeAlbumsDirty = true
                            } else {
                                subsonicLog.warn(`[Subsonic] ${action} 专辑 ${id} 跳过原生同步：无法解析专辑名 (user=${username})`)
                            }
                        }
                    } else {
                        const idx = nativeAlbums.findIndex((a: any) => String(a.id) === realId && a.source === source)
                        if (idx >= 0) { nativeAlbums.splice(idx, 1); nativeAlbumsDirty = true }
                    }
                }
                continue
            }
            if (id.startsWith('art_') || id.startsWith('artist_')) {
                // 统一解析：art_规范id 或 artist_名字兜底id -> 规范id + 歌手名
                const { canonical, name } = await this.resolveArtistKey(username, id)
                if (!canonical) {
                    subsonicLog.warn(`[Subsonic] ${action} 歌手 ${id} 跳过：无法解析歌手标识，未做任何改动 (user=${username})`)
                    continue
                }
                if (isStar) { starredArtists.add(canonical); addedArtists.add(canonical) } else { starredArtists.delete(canonical); removedArtists.add(canonical) }
                if (name) {
                    const nk = this.normalizeArtistName(name)
                    if (isStar) { starredArtistNames.add(nk); addedArtistNames.add(nk) } else { starredArtistNames.delete(nk); removedArtistNames.add(nk) }
                }
                metaChanged = true
                subsonicLog.debug(`[Subsonic] ${action} 歌手 ${id} -> 规范=${canonical}${name ? `, 名=${name}` : ''} (user=${username})`)
                debugLog(`[Subsonic Debug] ${action} 歌手 ${id} -> ${isStar ? '已星标' : '已取消星标'} (规范=${canonical}${name ? `, 名=${name}` : ''}) (user=${username})`)
                // 双向同步：写回原生媒体库收藏（仅规范 art_ 前缀可映射回原生 id）
                const m = canonical.match(/^art_([a-zA-Z0-9]+)_(.+)$/)
                if (m) {
                    const source = m[1]
                    const realId = m[2]
                    if (isStar) {
                        if (!nativeArtists.some((a: any) => String(a.id) === realId && a.source === source)) {
                            const picUrl = await this.resolveArtistPicUrl(source, realId)
                            nativeArtists.push({ id: realId, source, name: name || '', picUrl })
                            nativeArtistsDirty = true
                        }
                    } else {
                        const idx = nativeArtists.findIndex((a: any) => String(a.id) === realId && a.source === source)
                        if (idx >= 0) { nativeArtists.splice(idx, 1); nativeArtistsDirty = true }
                    }
                }
                continue
            }
            try {
                const hit = await this.resolveSongMeta(username, id)
                const resolved = hit?.music || null
                if (!resolved) {
                    subsonicLog.warn(`[Subsonic] ${action} 歌曲 ${id} 跳过：findMusicById 未命中 且 resolveMusicById 失败，未做任何改动 (user=${username})`)
                    continue
                }
                if (!this.loveIdSets.has(username)) this.loveIdSets.set(username, new Set())
                if (isStar) {
                    await userSpace.listManage.listDataManage.listMusicAdd('love', [resolved], location)
                    this.loveIdSets.get(username)!.add(resolved.id)
                } else {
                    await userSpace.listManage.listDataManage.listMusicRemove('love', [resolved.id])
                    this.loveIdSets.get(username)!.delete(resolved.id)
                }
                const fromSource = hit!.listId === 'online'
                debugLog(`[Subsonic Debug] ${action} 歌曲 ${id} -> ${isStar ? '已加入' : '已移出'}我的收藏(love) 《${resolved.name}》${fromSource ? ' (从源取回)' : ''}(user=${username})`)
                this.cacheOnlineSong(resolved)
                loveChanged = true
            } catch (e) {
                subsonicLog.error(`[Subsonic] ${action} song error (${id}):`, e)
            }
        }

        if (metaChanged) {
            await withMetaLock(username, async () => {
                // 与「写回时刻的最新 meta」合并，而不是用循环开始前读到的旧快照整体覆盖，
                // 否则会丢失并发的 star / setRating 写入。
                const fresh = await this.getUserSubsonicMeta(username)
                const merge = (base: string[], add: Set<string>, del: Set<string>): string[] =>
                    Array.from(new Set([...(base || []).filter((x: string) => !del.has(x)), ...add]))
                await this.saveUserSubsonicMeta(username, {
                    starredAlbums: merge(fresh.starredAlbums, addedAlbums, removedAlbums),
                    starredArtists: merge(fresh.starredArtists, addedArtists, removedArtists),
                    starredArtistNames: merge(fresh.starredArtistNames, addedArtistNames, removedArtistNames),
                    ratings: fresh.ratings,
                })
            })
        }
        if (nativeArtistsDirty) await this.writeLibraryData(username, 'artists', nativeArtists)
        if (nativeAlbumsDirty) await this.writeLibraryData(username, 'albums', nativeAlbums)
        if (loveChanged) {
            try {
                await userSpace.listManage.createSnapshot()
            } catch (e) {
                subsonicLog.error('[Subsonic] createSnapshot error:', e)
            }
        }

        debugLog(`[Subsonic Debug] ${action} 完成: id 数=${ids.length}, 收藏变更=${loveChanged}, 星标元数据变更=${metaChanged} (user=${username})`)
        return this.sendResponse(res, {}, format)
    }

    /**
     * 设置歌曲评分 (Subsonic setRating)
     * 参数: id(歌曲id), rating(0-5, 0 表示清除评分)
     * 评分按用户持久化到 subsonic meta 的 ratings 映射中。
     */
    // ─────────────────────────────────────────────
    // dislike 联动（Subsonic 评分 → lx-music 原生「不喜欢」规则）
    // 规则形态（与 modules/dislike/utils.ts 的 filterRules 保持一致）：
    //   歌名@歌手   精确屏蔽一首歌
    //   歌名        屏蔽所有同名（翻唱 / 多版本）
    //   @歌手       屏蔽该歌手全部歌曲
    //   !<source>:<albumId>@<singer>  专辑维度（lxserver 扩展，老客户端向后兼容）
    // ─────────────────────────────────────────────

    /** 把 (歌名, 歌手) 归一化成规则行 key，规则同 filterRules */
    private dislikeRuleKey(name: string, singer: string): string {
        const n = (name || '').replaceAll('@', '#').trim().toLowerCase()
        const s = (singer || '').replaceAll('@', '#').trim().toLowerCase()
        if (n && s) return `${n}@${s}`
        if (n) return n
        if (s) return `@${s}`
        return ''
    }

    /** 读取当前用户的 dislike 规则集（已解析出歌曲 / 歌手 / 专辑三维，带解析缓存） */
    private async getDislikeRuleSet(username: string): Promise<DislikeRuleSet | null> {
        const userSpace = getUserSpace(username) as any
        return getCachedDislikeRuleSet(username, async () => {
            return userSpace.dislikeManage?.dislikeDataManage?.getDislikeRulesString() || ''
        })
    }

    /** 批量写入 dislike 规则（infos 可携带完整 MusicInfo 字段，原样落盘到 snapshot） */
    private async addDislikeRules(username: string, infos: LX.Dislike.DislikeSongInfo[]): Promise<number> {
        const valid = infos.filter(i => this.dislikeRuleKey(i.name, i.singer))
        if (valid.length === 0) return 0
        try {
            const userSpace = getUserSpace(username) as any
            await userSpace.dislikeManage.dislikeDataManage.addDislikeInfo(valid)
            await userSpace.dislikeManage.createSnapshot()
            invalidateDislikeCache(username)
            return valid.length
        } catch (e) {
            subsonicLog.error('[Subsonic] 写入 dislike 规则失败:', e)
            return 0
        }
    }

    /** 写入专辑维度的 dislike 规则（!<专辑名>@<歌手>，按歌手拆多条） */
    private async addDislikeAlbum(username: string, album: { albumName: string, singers: string[] }): Promise<number> {
        try {
            const userSpace = getUserSpace(username) as any
            const infos = (album.singers || []).map(singer => ({ albumName: album.albumName, singer }))
            if (infos.length === 0) return 0
            await userSpace.dislikeManage.dislikeDataManage.addDislikeAlbums(infos)
            await userSpace.dislikeManage.createSnapshot()
            invalidateDislikeCache(username)
            return infos.length
        } catch (e) {
            subsonicLog.error('[Subsonic] 写入专辑 dislike 失败:', e)
            return 0
        }
    }

    /** 按规则行 key 移除 dislike（原生没有单条删除，只能整体覆盖） */
    private async removeDislikeRules(username: string, keys: Set<string>): Promise<number> {
        if (keys.size === 0) return 0
        try {
            // 规则串已被 filterRules 统一小写，比较时一并小写
            const lowerKeys = new Set(Array.from(keys).map(k => k.trim().toLowerCase()).filter(Boolean))
            const userSpace = getUserSpace(username) as any
            const rules = userSpace.dislikeManage.dislikeDataManage.getDislikeRulesString()
            const lines = String(rules || '').split('\n').filter(l => l.trim())
            const remain = lines.filter(l => !lowerKeys.has(l.trim().toLowerCase()))
            const removed = lines.length - remain.length
            if (removed > 0) {
                await userSpace.dislikeManage.dislikeDataManage.overwirteDislikeInfo(remain.join('\n'))
                await userSpace.dislikeManage.createSnapshot()
                invalidateDislikeCache(username)
            }
            return removed
        } catch (e) {
            subsonicLog.error('[Subsonic] 移除 dislike 规则失败:', e)
            return 0
        }
    }

    /**
     * 把 Subsonic 的 id 解析成 dislike 目标（歌曲 / 歌手 / 专辑三个维度）：
     * - 歌曲 id       → 单条「歌名@歌手」
     * - art_/artist_  → 单条「@歌手」，屏蔽该歌手全部歌曲
     * - alb_ 专辑     → 专辑规则「!<source>:<albumId>@<singer>」，不展开成曲目
     *
     * 同时返回规则行 key 集合，供写入与移除共用。
     */
    /**
     * 按优先级链补全歌手的 source + id：
     *   1. 入口自带（art_ 前缀的 id 本身就含 source + 歌手 ID）
     *   2. 本地收藏歌手库 library/artists.json
     *   3. 按名字在线查询 getSingerMid（tx / wy，有同名风险）
     * 都拿不到时返回空，退回纯名字规则。
     */
    private async resolveSingerIdentity(
        username: string,
        name: string,
        preset?: { source: string, id: string },
    ): Promise<{ name: string, source: string, singerId: string }> {
        if (preset?.id) return { name, source: preset.source, singerId: preset.id }
        if (!name) return { name, source: '', singerId: '' }

        // 2. 本地收藏歌手库
        try {
            const lib = await this.getLibraryData(username, 'artists')
            const hit = lib.find((a: any) => this.normalizeArtistName(a.name) === this.normalizeArtistName(name))
            if (hit?.id) return { name, source: hit.source || 'wy', singerId: String(hit.id) }
        } catch { /* 库不可读不阻断 */ }

        // 3. 在线按名查询（tx / wy）
        try {
            const mid = await getSingerMid(name)
            if (mid) return { name, source: 'tx', singerId: mid }
        } catch { /* 查询失败不阻断 */ }

        return { name, source: '', singerId: '' }
    }

    /**
     * 根据 Subsonic 歌曲 id 解析出对应的「歌名 / 歌手 / 规则 key」，供写回 dislike 使用。
     */
    private async resolveDislikeTarget(username: string, id: string): Promise<{
        infos: Array<{ name: string, singer: string }>
        album?: { albumName: string, singers: string[] }
        singer?: { name: string, source: string, singerId: string }
        keys: Set<string>
    }> {
        // 歌手维度
        if (id.startsWith('art_') || id.startsWith('artist_')) {
            let name = ''
            let preset: { source: string, id: string } | undefined

            if (id.startsWith('artist_')) {
                // 兜底 id：只有歌手名，需要走补全链
                name = decodeURIComponent(id.slice(7))
            } else {
                // art_ 前缀：id 本身就含 source + 歌手 ID，不要只取名字把 ID 丢掉
                const m = id.match(/^art_([a-zA-Z0-9]+)_(.+)$/)
                if (m) preset = { source: m[1], id: m[2] }
                name = (await this.resolveArtistKey(username, id)).name || ''
            }

            const identity = await this.resolveSingerIdentity(username, name, preset)
            const infos = identity.name ? [{ name: '', singer: identity.name }] : []
            return {
                infos,
                singer: identity,
                keys: new Set(infos.map(i => this.dislikeRuleKey(i.name, i.singer)).filter(Boolean)),
            }
        }

        // 专辑维度（排除虚拟歌单 alb_tx_playlist_）
        if (id.startsWith('alb_') && !id.startsWith('alb_tx_playlist_')) {
            const parts = id.split('_')
            const source = parts[1]
            const albumId = parts.slice(2).join('_')
            if (!source || !albumId) return { infos: [], keys: new Set() }
            // 取专辑名 + 全部歌手（合辑多位歌手）：按歌手拆多条写入，匹配时由开关控制 contains/exact。
            let albumName = ''
            const singerSet = new Set<string>()
            try {
                const sdk = (musicSdk as any)[source]
                const data = await sdk?.extendDetail?.getAlbumSongs?.(albumId)
                const list: any[] = data?.list || []
                albumName = normalizeText(String(data?.name || list?.[0]?.album?.name || '').trim())
                for (const s of list) {
                    const raw = String(s?.singer || s?.singerName || s?.album?.singer || '').trim()
                    if (!raw) continue
                    for (const n of splitSingers(raw)) singerSet.add(n)
                }
            } catch { /* 取不到不阻断，仅少一层校验 */ }
            if (!albumName) return { infos: [], keys: new Set() }
            const singers = [...singerSet]
            const keys = new Set(singers.map(s => encodeAlbumRule(albumName, s)))
            const album = { albumName, singers }
            return { infos: [], album, keys }
        }

        // 歌曲维度
        const hit = await this.resolveSongMeta(username, id)
        // 构造完整的 DislikeSongInfo，保留 MusicInfo 所有原始字段（img/types/_types/songmid 等），
        // 使 snapshot 条目与 lx-music 客户端写入的格式一致，方便客户端侧展示/管理。
        const infos: LX.Dislike.DislikeSongInfo[] = hit?.music ? [{
            ...(hit.music as any),       // 展开所有 MusicInfo 字段（songmid/img/types/_types/meta 等）
            name: hit.music.name || '',
            singer: hit.music.singer || '',
            source: hit.music.source,
            interval: hit.music.interval,
            pic: (hit.music as any).img || (hit.music as any).meta?.picUrl || undefined,
        }] : []
        let singerIdentity: { name: string, source: string, singerId: string } | undefined
        if (hit?.music) {
            const rawSingerId = (hit.music as any).singerId
            singerIdentity = await this.resolveSingerIdentity(
                username,
                (hit.music.singer || '').split('、')[0] || '',
                rawSingerId ? { source: hit.music.source, id: String(rawSingerId) } : undefined,
            )
        }
        return {
            infos,
            singer: singerIdentity,
            keys: new Set(infos.map(i => this.dislikeRuleKey(i.name, i.singer)).filter(Boolean)),
        }
    }

    /** 按 dislike 规则过滤歌曲列表（歌曲 / 歌手 / 专辑三维） */
    private async filterDislikedSongs(username: string, musics: LX.Music.MusicInfo[]): Promise<LX.Music.MusicInfo[]> {
        if (!musics || musics.length === 0) return musics
        const ruleSet = await this.getDislikeRuleSet(username)
        if (!ruleSet) return musics
        const crossSource = global.lx.config['subsonic.dislikeCrossSource'] === true
        const duetMode = (global.lx.config['subsonic.dislikeDuetMode'] || 'any') as 'any' | 'all' | 'primary'
        const normalizeName = global.lx.config['subsonic.dislikeNormalizeName'] !== false
        const requireSinger = global.lx.config['subsonic.dislikeRequireSinger'] !== false
        return filterDisliked(musics, ruleSet, (m) => ({
            name: m.name,
            singer: m.singer,
            source: m.source,
            albumId: (m as any).meta?.albumId ?? (m as any).albumId ?? (m as any).album?.id,
            albumName: (m as any).meta?.albumName,
        }), { crossSource, duetMode, normalizeName, requireSinger })
    }

    /** 按 dislike 规则过滤 { music, listId } 形式的列表（随机 / 搜索 / 相似等入口） */
    private async filterDislikedEntries(username: string, entries: Array<{ music: LX.Music.MusicInfo, listId: string }>) {
        if (!entries || entries.length === 0) return entries
        const kept = await this.filterDislikedSongs(username, entries.map(e => e.music))
        if (kept.length === entries.length) return entries
        const keptIds = new Set(kept.map(m => m.id))
        return entries.filter(e => keptIds.has(e.music.id))
    }

    /**
     * 处理 Subsonic setRating：写回评分，并按配置把低分（<=阈值）联动为「不喜欢」。
     */
    private async handleSetRating(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)
        const rating = parseInt(params.get('rating') || '0', 10)
        if (isNaN(rating) || rating < 0 || rating > 5) {
            return this.sendError(res, 0, 'Rating must be between 0 and 5', format)
        }
        // 读-改-写整体串行化，避免与并发的 star / dislike 联动互相覆盖
        await withMetaLock(username, async () => {
            const meta = await this.getUserSubsonicMeta(username)
            if (rating === 0) {
                delete meta.ratings[id]
            } else {
                meta.ratings[id] = rating
            }
            await this.saveUserSubsonicMeta(username, meta)
            // [修复] 立即刷新内存评星缓存，保证本次请求之后的歌曲序列化能带上最新 userRating
            this.userRatingsCache.set(username, meta.ratings || {})
        })
        subsonicLog.debug(`[Subsonic] setRating ${id} -> ${rating} (user=${username})`)

        // [dislike 联动] 0 < rating <= dislikeRating 视为「不喜欢」，写回 lx-music 原生 dislike 规则；
        // 提高评分或清除评分则移除此前写入的规则。需 linkRatingToDislike 开启才联动，否则仅记录评分。
        const threshold = global.lx.config['subsonic.dislikeRating'] ?? 1
        if (global.lx.config['subsonic.linkRatingToDislike'] && threshold > 0) {
            try {
                const target = await this.resolveDislikeTarget(username, id)
                // [调试] 打印解析到的维度与身份信息，便于确认各入口能拿到什么
                if (global.lx.config['subsonic.enableDebug']) {
                    subsonicLog.debug(`[Subsonic] dislike 解析 id=${id}`, JSON.stringify({
                        dimension: target.album ? 'album' : (id.startsWith('art_') || id.startsWith('artist_') ? 'singer' : 'song'),
                        song: target.infos,
                        singer: target.singer || null,
                        album: target.album || null,
                        keys: Array.from(target.keys),
                    }))
                }
                if (rating > 0 && rating <= threshold) {
                    let added = await this.addDislikeRules(username, target.infos)
                    if (target.album) added += await this.addDislikeAlbum(username, target.album)
                    subsonicLog.debug(`[Subsonic] setRating 联动 dislike：写入 ${added} 条规则 (id=${id}, user=${username})`)
                } else {
                    const removed = await this.removeDislikeRules(username, target.keys)
                    if (removed > 0) {
                        subsonicLog.debug(`[Subsonic] setRating 联动 dislike：移除 ${removed} 条规则 (id=${id}, user=${username})`)
                    }
                }
            } catch (e) {
                subsonicLog.error('[Subsonic] setRating 联动 dislike 失败:', e)
            }
        }

        return this.sendResponse(res, {}, format)
    }

    private async handleGetStarred(res: http.ServerResponse, username: string, format: string, isV2 = true) {
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()
        const meta = await this.getUserSubsonicMeta(username)
        const starredAlbumSet = new Set(meta.starredAlbums)
        const starredArtistSet = new Set(meta.starredArtists)
        const starredArtistNameSet = new Set(meta.starredArtistNames)

        // [汇总所有歌单歌曲]
        const allSongsMap = new Map<string, { music: LX.Music.MusicInfo, listId: string }>()
        const collect = (list: LX.Music.MusicInfo[], listId: string) => {
            for (const m of list) {
                if (!allSongsMap.has(m.id)) {
                    allSongsMap.set(m.id, { music: m, listId })
                }
            }
        }
        collect(listData.loveList, 'love')
        // 只返回我的收藏里的歌，不再汇总其他歌单
        const allSongs = Array.from(allSongsMap.values())

        // [新增] 包含收藏的歌手和专辑
        const libArtists = await this.getLibraryData(username, 'artists')
        const libAlbums = await this.getLibraryData(username, 'albums')

        // [已星标歌手] 优先来自本地歌手库匹配；库为空或歌手不在库中时，用已存名字兜底合成条目
        const seenArtistNames = new Set<string>()
        const mappedArtists: Array<{ id: string, name: string, coverArt: string }> = []
        const pushArtist = (id: string, name: string) => {
            const nk = this.normalizeArtistName(name)
            if (seenArtistNames.has(nk)) return
            seenArtistNames.add(nk)
            mappedArtists.push({ id, name, coverArt: id })
        }

        for (const a of libArtists) {
            const canonical = `art_${a.source || 'wy'}_${a.id}`
            // 兼容：art_规范id 命中，或 artist_名字 兜底 / 跨音源按歌手名命中
            if (starredArtistSet.has(canonical) || starredArtistNameSet.has(this.normalizeArtistName(a.name))) {
                pushArtist(canonical, a.name)
            }
        }
        // 兜底：已星标但根本不在本地歌手库（例如从歌曲点星标、库为空）的歌手，用名字合成
        for (const name of meta.starredArtistNames) {
            pushArtist(`artist_${encodeURIComponent(name)}`, name)
        }

        const mappedAlbums = libAlbums
            .filter(a => starredAlbumSet.has(`alb_${(a.source || 'wy')}_${a.id}`))
            .map(a => {
                const source = a.source || 'wy'
                const primarySinger = (a.artistName || '').split('、')[0] || 'Unknown Artist'
                const artistId = a.singerId ? `art_${source}_${a.singerId}` : `artist_${primarySinger}`
                return {
                    id: `alb_${source}_${a.id}`,
                    name: a.name,
                    artist: a.artistName,
                    artistId: artistId,
                    coverArt: a.picUrl || `alb_${source}_${a.id}`
                }
            })

        // [dislike] 收藏列表同样过滤不喜欢的歌曲
        let filteredSongs = allSongs
        if (global.lx.config['subsonic.hideDisliked']) {
            filteredSongs = await this.filterDislikedEntries(username, allSongs)
        }

        const wrapKey = isV2 ? 'starred2' : 'starred'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: {
                    song: filteredSongs.map(item => this.musicToSongFlat(item.music, item.listId, undefined, username)),
                    album: mappedAlbums,
                    artist: mappedArtists,
                },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: {
                    song: filteredSongs.map(item => this.musicToSongXml(item.music, item.listId, undefined, username)),
                    album: mappedAlbums.map(a => ({ attrs: a })),
                    artist: mappedArtists.map(a => ({ attrs: a })),
                },
            },
        }, format)
    }

    private async handleGetRandomSongs(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const size = Math.min(parseInt(params.get('size') || '10'), 100)
        const genreNameOrId = params.get('genre') || ''
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()


        const isGenreQuery = params.has('genre')
        const rootKey = isGenreQuery ? 'songsByGenre' : 'randomSongs'

        // [修改] 如果是流派发现，强制获取 100 首左右进行随机，忽略客户端的 size=10 限制
        const fetchSize = isGenreQuery ? 100 : size

        // [新增] 如果带了 genre 参数，则优先从云端拉取该流派的歌曲
        if (genreNameOrId) {
            try {
                let categoryId = genreNameOrId
                if (isNaN(parseInt(genreNameOrId))) {
                    const genres = await fetchGenres()
                    const target = genres.find(g => g.value === genreNameOrId)
                    if (target) categoryId = target.id
                }
                const cloudSongs = await fetchSongsByGenre(categoryId, fetchSize)
                if (cloudSongs.length > 0) {
                    const parentId = `genre_${genreNameOrId}`
                    // [修复] 多取是为了随机多样性，但最终必须按客户端的 size 截断，
                    // 否则 size=10 也会把 100 首全部塞给客户端
                    const shuffled = cloudSongs.slice()
                    for (let i = shuffled.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1))
                        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
                    }
                    const picked = shuffled.slice(0, size).map((s: any) => ({ music: s, listId: parentId }))
                    return this.renderRandomSongs(res, picked, format, rootKey, username)
                }
            } catch (e) {
                subsonicLog.error(`[Subsonic] fetchSongsByGenre failed:`, e)
            }
        }

        // 汇聚所有歌曲
        const all: { music: LX.Music.MusicInfo, listId: string }[] = []
        const addAll = (musics: LX.Music.MusicInfo[], listId: string) => {
            for (const m of musics) all.push({ music: m, listId })
        }
        addAll(listData.loveList, 'love')
        addAll(listData.defaultList, 'default')
        for (const list of listData.userList) addAll((list.list || []) as LX.Music.MusicInfo[], list.id)

        // Fisher-Yates 随机打乱，取前 size 条
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]]
        }
        const picked = all.slice(0, size)
        return this.renderRandomSongs(res, picked, format, rootKey, username)
    }

    private async renderRandomSongs(res: http.ServerResponse, picked: { music: LX.Music.MusicInfo, listId: string }[], format: string, rootKey: string = 'randomSongs', username?: string) {
        // [dislike] 随机歌曲 / 流派歌曲 / 每日推荐等入口共用此渲染。
        // 这里受 dislikeNoRecommend 控制（与列表剔除 hideDisliked 相互独立）：
        // 即使不隐藏歌曲，也可以让它们不再出现在推荐里。
        let list = picked
        if (username && global.lx.config['subsonic.dislikeNoRecommend']) {
            list = await this.filterDislikedEntries(username, picked)
        }

        if (format === 'json') {
            return this.sendResponse(res, {
                [rootKey]: {
                    song: list.map(({ music, listId }) => this.musicToSongFlat(music, listId, undefined, username)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            [rootKey]: {
                children: {
                    song: list.map(({ music, listId }) => this.musicToSongXml(music, listId, undefined, username)),
                },
            },
        }, format)
    }

    /**
     * 每日推荐歌曲 (lx-server 扩展接口)
     * 对应 Subsonic 客户端里常见的「每日推荐 / For You」入口。非官方标准方法，
     * 通过 getRecommendedSongs / getDailySongs 调用（getSongsByTag 作为别名同样映射到此）。
     * 返回当天稳定的推荐歌曲列表，每首均为可直接播放的在线歌曲。
     */
    private async handleGetRecommendedSongs(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const size = Math.min(parseInt(params.get('size') || '20'), 100)
        try {
            // 取当天全部候选（最多 100），再按「不喜欢」阈值排除：评分落在 (0, threshold] 视为不喜欢。
            // 阈值取自 subsonic.dislikeRating（可配置），避免此处硬编码导致管理员改阈值后语义不一致。
            const all = await fetchRecommendedSongs(100)
            const meta = await this.getUserSubsonicMeta(username)
            const threshold = global.lx.config['subsonic.dislikeRating'] ?? 1
            const songs = all.filter((s: any) => {
                const r = meta.ratings[s.id] || 0
                return !(threshold > 0 && r > 0 && r <= threshold)
            }).slice(0, size)
            const picked = songs.map((s: any) => ({ music: s, listId: 'recommended' }))
            return this.renderRandomSongs(res, picked, format, 'recommendedSongs', username)
        } catch (e) {
            subsonicLog.error('[Subsonic] getRecommendedSongs 出错:', e)
            return this.renderRandomSongs(res, [], format, 'recommendedSongs', username)
        }
    }

    /**
     * 挑「相似歌曲」候选：同歌手(3 分) + 同专辑(2 分) 分层排序、层内随机；目标歌不在库时退化为随机。
     * getSimilarSongs/2 与 getSonicSimilarTracks 共用同一套挑选逻辑，避免两处漂移。
     */
    private async pickSimilarEntries(username: string, id: string | null, count: number): Promise<Array<{ music: LX.Music.MusicInfo, listId: string }>> {
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()

        // 找到目标歌曲，优先从同一列表里挑相似（同歌手），找不到则随机
        const all: { music: LX.Music.MusicInfo, listId: string }[] = []
        const addAll = (musics: LX.Music.MusicInfo[], listId: string) => {
            for (const m of musics) all.push({ music: m, listId })
        }
        addAll(listData.loveList, 'love')
        addAll(listData.defaultList, 'default')
        for (const list of listData.userList) addAll((list.list || []) as LX.Music.MusicInfo[], list.id)

        // 找目标歌曲：本地列表里没有时用统一解析器兜底（在线缓存中的歌也能命中）
        let target = id ? all.find(({ music }) => music.id === id) : null
        if (!target && id) {
            const found = await this.findMusicById(username, id).catch(() => null)
            if (found) target = { music: found.music, listId: found.listId }
        }

        const candidates = all.filter(({ music }) => music.id !== id)
        const shuffle = <T>(arr: T[]): T[] => {
            const a = arr.slice()
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1))
                ;[a[i], a[j]] = [a[j], a[i]]
            }
            return a
        }

        let picked: { music: LX.Music.MusicInfo, listId: string }[] = []
        if (target) {
            const singerKey = (s: string) => normalizeSingerName(toSimplified(s || ''))
            const targetSingers = new Set(splitSingers(target.music.singer || '').map(singerKey).filter(Boolean))
            const targetAlbum = singerKey((target.music as any).albumName || (target.music as any).album || '')

            // [修复] 之前先排「同歌手优先」再整体打乱，优先顺序被洗掉，
            // 导致返回歌与目标毫无关系（搜「孙尚香」回来「青花」）。
            // 改为分层：同歌手(3) + 同专辑(2) 计分，层内随机、层间按分排序。
            const layers = new Map<number, { music: LX.Music.MusicInfo, listId: string }[]>()
            for (const c of candidates) {
                const singers = splitSingers(c.music.singer || '').map(singerKey)
                let score = 0
                if (singers.some(s => targetSingers.has(s))) score += 3
                const album = singerKey((c.music as any).albumName || (c.music as any).album || '')
                if (targetAlbum && album === targetAlbum) score += 2
                if (!layers.has(score)) layers.set(score, [])
                layers.get(score)!.push(c)
            }
            for (const score of Array.from(layers.keys()).sort((a, b) => b - a)) {
                picked = picked.concat(shuffle(layers.get(score)!))
                if (picked.length >= count) break
            }
            picked = picked.slice(0, count)
        } else {
            // 目标歌不在本地曲库：退化为随机（与旧行为一致）
            picked = shuffle(candidates).slice(0, count)
        }

        // [dislike] 相似歌曲属于推荐性质，受 dislikeNoRecommend 控制
        if (global.lx.config['subsonic.dislikeNoRecommend']) {
            picked = await this.filterDislikedEntries(username, picked)
        }
        return picked
    }

    /**
     * [sonicSimilarity] getSonicSimilarTracks：与目标歌「相似」的曲目（id 必填，count 默认 10）。
     * 注意：本服没有声学分析（AudioMuse 之类），similarity 是由「同歌手/同专辑」启发式排序
     * 归一化得到的**排序分**，并非声学相似度；目的只是让客户端拿到排序稳定、可用的相似列表。
     */
    private async handleGetSonicSimilarTracks(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)
        const count = Math.min(Math.max(1, parseInt(params.get('count') || '10') || 10), 50)
        const picked = await this.pickSimilarEntries(username, id, count)

        const matched = picked.map(({ music, listId }, i) => ({
            // 单调递减的排序分：第一位接近 1，末尾不低于 0.1
            similarity: Math.max(0.1, Number((1 - i * (0.9 / Math.max(1, picked.length))).toFixed(3))),
            song: format === 'json'
                ? this.musicToSongFlat(music, listId, undefined, username)
                : this.musicToSongXml(music, listId, undefined, username),
        }))

        if (format === 'json') {
            return this.sendResponse(res, {
                sonicMatch: matched.map(m => ({ entry: m.song, similarity: m.similarity })),
            }, format)
        }
        return this.sendResponse(res, {
            sonicMatch: matched.map(m => ({ attrs: { similarity: m.similarity }, children: { entry: m.song } })),
        }, format)
    }

    private async handleGetSimilarSongs(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
        method?: string,
    ) {
        const id = params.get('id')
        const count = Math.min(parseInt(params.get('count') || '10'), 50)

        const picked = await this.pickSimilarEntries(username, id, count)

        // [修复] 根元素此前恒为 similarSongs2，导致 getSimilarSongs(v1) 也返回 v2 的结构
        const wrapKey = method === 'getSimilarSongs2' ? 'similarSongs2' : 'similarSongs'

        if (format === 'json') {
            return this.sendResponse(res, {
                [wrapKey]: {
                    song: picked.map(({ music, listId }) => this.musicToSongFlat(music, listId, undefined, username)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            [wrapKey]: {
                children: {
                    song: picked.map(({ music, listId }) => this.musicToSongXml(music, listId, undefined, username)),
                },
            },
        }, format)
    }

    /**
     * 按音质优先级 + 平台优选解析音流（仅用于 Subsonic stream）。
     * 不是"失败降级"，而是主动按优先级选择最优可用方案：
     *  - 音质优先级：subsonic.quality.priority（默认 flac > 320k > 128k），受客户端 maxBitrate 上界约束。
     *    clientCapMode=hard 时仅选 ≤ maxBitrate 的最高优先级音质；soft 时若 ≤ 上限都取不到，再向上突破选更高优先级。
     *  - 平台优选：客户端所选源(requested)必优先；若开启跨平台，再按 subsonic.source.priority 顺序优选其它平台。
     *  - 同源多脚本：subsonic.source.autoSwitchCustom 开启时，callUserApiGetMusicUrl 内部循环同平台所有自定义源脚本。
     * 客户端规则(source 选择 / maxBitrate 上界)始终优先于后台默认值；subsonic.quality.enabled=false 时退化为单次解析。
     */
    /**
     * 计算某平台在给定客户端 maxBitrate 下的音质尝试顺序(高优先级在前)：
     *  - 优先用该平台的逐源覆盖 subsonic.quality.sources.<src>.priority，否则用全局 subsonic.quality.priority。
     *  - clientCapMode=hard：仅保留 ≤ maxBitrate 的音质；soft：先 ≤ 上限、再突破上限选更高优先级。
     * 该顺序同时供源站回源(resolveStreamUrl)与本地缓存探测(playCacheFirst)复用，保证两者一致。
     */
    private getQualityPriorityOrder(src: string, maxBitrate: number): string[] {
        const cfg = global.lx.config
        const asList = (v: any, fb: string[]): string[] => {
            const arr = Array.isArray(v) ? v.map(String) : String(v || '').split(',').map((s: string) => s.trim()).filter(Boolean)
            return arr.length ? arr : fb
        }
        const globalPriority = asList(cfg['subsonic.quality.priority'], ['flac', '320k', '128k'])
        const srcOverride = (cfg['subsonic.quality.sources'] as any)?.[src]
        const pri = asList(srcOverride, globalPriority)
        const cap = maxBitrate === 0 || maxBitrate >= 320 ? Infinity : maxBitrate
        const KBPS: Record<string, number> = { master: 9999, hires: 9999, flac24bit: 9999, flac: 9999, '320k': 320, '192k': 192, '128k': 128 }
        const withinCap = (q: string) => (KBPS[q] ?? 128) <= cap
        const inCap = pri.filter(withinCap)
        const overCap = pri.filter(q => !withinCap(q))
        if (cfg['subsonic.quality.clientCapMode'] === 'soft') return [...inCap, ...overCap]
        // hard 模式：当 maxBitrate 低于所有已知音质（如 64/96 < 最小 128）时 inCap 为空，
        // 会让音质循环与缓存探测循环都不执行，最终 stream 抛「所有候选失败」。
        // 此时回退到优先级列表中码率最低的一项，保证至少保留一个候选。
        if (inCap.length === 0 && pri.length > 0) {
            return [pri.reduce((lo, q) => (KBPS[q] ?? 128) < (KBPS[lo] ?? 128) ? q : lo)]
        }
        return inCap
    }

    private async resolveStreamUrl(
        source: string,
        songmid: string,
        id: string,
        musicInfo: any,
        requestedQuality: string,
        maxBitrate: number,
        username: string,
    ): Promise<{ url: string, quality: string, selected?: string }> {
        const cfg = global.lx.config
        // 总开关关闭 → 退化为单次解析（服务端硬策略，客户端无法 override 打开）
        if (cfg['subsonic.quality.enabled'] === false) {
            const r = await callUserApiGetMusicUrl(source as any, musicInfo as any, requestedQuality, username)
            if (!r?.url) throw new Error('Could not resolve music URL')
            return { url: r.url, quality: r.type || requestedQuality }
        }

        const asList = (v: any, fb: string[]): string[] => {
            const arr = Array.isArray(v) ? v.map(String) : String(v || '').split(',').map((s: string) => s.trim()).filter(Boolean)
            return arr.length ? arr : fb
        }
        const autoSwitchCustom = cfg['subsonic.source.autoSwitchCustom'] !== false

        // 平台优选顺序：客户端所选源优先，其余按 subsonic.source.priority
        const sourcesToTry: string[] = [source]
        if (cfg['subsonic.source.crossPlatform'] !== false) {
            const srcPriority: string[] = asList(cfg['subsonic.source.priority'], ['kw', 'tx', 'wy', 'mg', 'kg'])
            for (const s of srcPriority) if (s !== source && !sourcesToTry.includes(s)) sourcesToTry.push(s)
        }

        for (const trySource of sourcesToTry) {
            const excludeApiSources: string[] = []

            // 跨平台时按歌名+歌手搜索替身；同源直接用原 songmid
            let candidates: { music: any }[]
            if (trySource === source) {
                candidates = [{ music: musicInfo }]
            } else {
                const name = musicInfo?.name
                const singer = musicInfo?.singer
                if (!name) continue
                const query = singer ? `${name} ${singer}` : name
                let list: any[] = []
                try {
                    const searchRes: any = await (musicSdk as any)[trySource]?.musicSearch?.search?.(query, 1, 5)
                    list = searchRes?.list || []
                } catch (e: any) {
                    if (cfg['subsonic.enableDebug']) subsonicLog.debug(`[Subsonic] quality-select crossPlatform ${source}->${trySource} search failed: ${e?.message || e}`)
                    continue
                }
                if (list.length === 0) continue
                // 没有任何一条通过歌名/歌手校验时不得回退 list[0]，
                // 否则会用不相干歌曲的 songmid 去解析播放地址，导致用户听到完全不同的歌。
                const match = list.find((it: any) => this.matchSongAcrossSources(it, musicInfo))
                if (!match) continue
                const tSongmid = String(match?.songmid || match?.id || '')
                if (!tSongmid) continue
                candidates = [{
                    music: {
                        source: trySource,
                        songmid: tSongmid,
                        id: `${trySource}_${tSongmid}`,
                        name: match.name,
                        singer: match.singer,
                        meta: { ...(match.meta || {}), songId: tSongmid },
                    },
                }]
            }

            const order = this.getQualityPriorityOrder(trySource, maxBitrate)
            for (const cand of candidates) {
                for (const q of order) {
                    try {
                        const r = await callUserApiGetMusicUrl(
                            trySource as any, cand.music as any, q, username,
                            undefined, autoSwitchCustom,
                            excludeApiSources.length ? excludeApiSources : undefined,
                        )
                        if (r?.url) {
                            const selected = trySource === source
                                ? (q !== requestedQuality ? `quality:${source}/${q}` : undefined)
                                : `source:${source}->${trySource}/${q}`
                            return { url: r.url, quality: r.type || q, selected }
                        }
                    } catch (err: any) {
                        // 收集本次失败过的自定义源，避免后续音质/平台重复试死源
                        const atts = err?.attempts
                        if (Array.isArray(atts)) {
                            for (const a of atts) {
                                if (a?.sourceId && !excludeApiSources.includes(a.sourceId)) excludeApiSources.push(a.sourceId)
                                if (a?.name && !excludeApiSources.includes(a.name)) excludeApiSources.push(a.name)
                            }
                        }
                    }
                }
            }
        }

        throw new Error('Could not resolve music URL (all quality/source candidates failed)')
    }

    /** 跨平台重锚时判断搜索结果是否匹配原曲：歌名归一化相等/包含 + 歌手部分匹配 */
    private matchSongAcrossSources(it: any, musicInfo: any): boolean {
        const norm = (s: string) => String(s || '').toLowerCase().replace(/[\s\-_()（）【】\[\]、，,。.]/g, '')
        const n1 = norm(it?.name)
        const n2 = norm(musicInfo?.name)
        if (!n1 || !n2) return false
        if (n1 !== n2 && !n1.includes(n2) && !n2.includes(n1)) return false
        const s1 = norm(it?.singer)
        const s2 = norm(musicInfo?.singer)
        if (s1 && s2 && !s1.includes(s2) && !s2.includes(s1)) return false
        return true
    }

    /**
     * [transcoding] getTranscodeDecision：告知客户端「这份媒体能否直放 / 是否需要转码」。
     * 本服音源是「在线直链 + 可选 ffmpeg 转码」，因此：
     *  - canDirectPlay 恒为 true：我们总能把音源直链交给客户端（客户端自己 seek）；
     *  - canTranscode 取决于本机 ffmpeg 是否可用；
     *  - transcodeParams 是签名令牌，getTranscodeStream 用它拿回本次决策（目标格式/码率）。
     * 注：本实现不解析请求体里的 ClientInfo（直放恒可行，无需按能力协商）。
     */
    private async handleGetTranscodeDecision(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const mediaId = (params.get('mediaId') || '').trim()
        if (!mediaId) return this.sendError(res, 10, 'Required parameter is missing: mediaId', format)
        const mediaType = (params.get('mediaType') || 'song').trim() || 'song'

        let ffmpegOk = false
        try { ffmpegOk = await probeFfmpeg() } catch { ffmpegOk = false }

        const targetFormat = String(global.lx.config['subsonic.transcode.format'] || 'mp3').toLowerCase()
        const targetBitrate = 320 // kbps
        const transcodeParams = signTranscodeParams({
            id: mediaId,
            type: mediaType,
            format: targetFormat,
            bitrate: targetBitrate,
            exp: Date.now() + TRANSCODE_PARAM_TTL,
        })

        const sourceStream = { protocol: 'http', container: '', codec: '', audioChannels: 2, audioBitrate: 0, audioProfile: '', audioSamplerate: 0, audioBitdepth: 0 }
        const transcodeStreamInfo = { protocol: 'http', container: targetFormat, codec: targetFormat, audioChannels: 2, audioBitrate: targetBitrate * 1000, audioProfile: '', audioSamplerate: 48000, audioBitdepth: 16 }

        subsonicLog.debug(`[Subsonic] getTranscodeDecision: ${mediaId} ffmpeg=${ffmpegOk} (user=${username})`)

        if (format === 'json') {
            return this.sendResponse(res, {
                transcodeDecision: {
                    canDirectPlay: true,
                    canTranscode: ffmpegOk,
                    transcodeReason: [],
                    errorReason: '',
                    transcodeParams,
                    sourceStream,
                    transcodeStream: transcodeStreamInfo,
                },
            }, format)
        }
        return this.sendResponse(res, {
            transcodeDecision: {
                attrs: {
                    canDirectPlay: true,
                    canTranscode: ffmpegOk,
                    errorReason: '',
                    transcodeParams,
                },
                children: {
                    sourceStream: { attrs: sourceStream },
                    transcodeStream: { attrs: transcodeStreamInfo },
                },
            },
        }, format)
    }

    /**
     * [transcoding] getTranscodeStream：按 transcodeParams（决策令牌）返回转码后的媒体流。
     * ffmpeg 不可用时 transcodeStream 内部会降级为 302 直链。
     */
    private async handleGetTranscodeStream(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const mediaId = (params.get('mediaId') || '').trim()
        if (!mediaId) return this.sendError(res, 10, 'Required parameter is missing: mediaId', format)
        const decision = verifyTranscodeParams(params.get('transcodeParams') || '')
        if (!decision) return this.sendError(res, 10, 'Invalid or expired transcodeParams', format)

        const offset = Math.max(0, Math.floor(Number(params.get('offset') || 0)) || 0)
        const targetFormat = String(decision.format || 'mp3').toLowerCase()
        const bitrate = Math.max(32, Math.min(Number(decision.bitrate) || 320, 999))

        // 解析歌曲信息（本地列表 / 在线缓存 / 回源）
        let musicInfo: any = null
        try {
            const hit = await this.resolveSongMeta(username, mediaId)
            musicInfo = hit?.music || null
        } catch { /* 回退到前缀解析 */ }
        if (!musicInfo) {
            const us = mediaId.indexOf('_')
            const src = us > 0 ? mediaId.slice(0, us) : ''
            const mid = us > 0 ? mediaId.slice(us + 1) : mediaId
            musicInfo = { source: src, songmid: mid, id: mediaId, meta: { songId: mid } }
        }
        const source = musicInfo.source || ''
        const songmid = String(musicInfo.songmid || musicInfo.meta?.songId || '')
        if (!source || !songmid) return this.sendError(res, 0, 'Could not resolve media', format)

        let result: { url: string, quality: string } | null = null
        try {
            result = await this.resolveStreamUrl(source, songmid, mediaId, musicInfo, 'flac', 0, username)
        } catch (e: any) {
            return this.sendError(res, 0, 'Could not resolve music URL: ' + briefErrorText(e), format)
        }
        if (!result?.url) return this.sendError(res, 0, 'Could not resolve music URL', format)

        subsonicLog.debug(`[Subsonic] getTranscodeStream: ${mediaId} -> ${targetFormat}@${bitrate}k offset=${offset}s (user=${username})`)
        await this.transcodeStream(req, res, result.url, bitrate, format, offset, targetFormat)
    }

    private async handleStream(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        // 解析 source 和 songmid
        let source = ''
        let songmid = ''
        if (id.includes('_')) {
            const index = id.indexOf('_')
            source = id.substring(0, index)
            songmid = id.substring(index + 1)
        } else {
            source = id.split('-')[0] || ''
            songmid = id
        }

        try {
            const maxBitrate = parseInt(params.get('maxBitrate') || '0')
            // [transcodeOffset] 客户端要求从第 N 秒开始（单位：秒）。
            // 仅在服务端转码链路上生效；直接 302 到音源直链时无法携带偏移（客户端自行 seek）。
            const timeOffsetSec = Math.max(0, Math.floor(Number(params.get('timeOffset') || 0)) || 0)
            let quality = '128k'
            if (maxBitrate === 0 || maxBitrate >= 320) {
                quality = 'flac' // 优先请求最高音质，SDK 会自动降级
            } else if (maxBitrate > 128) {
                quality = '320k'
            }

            // [新增] 处理电台流: 随机取一首歌播放
            if (id.startsWith('radio_tx_')) {
                const radioId = id.replace('radio_tx_', '')
                // subsonicLog.debug(`[Subsonic] Radio stream requested: ${id}`)
                let failReason = ''
                const songs = await fetchRadioSongs(radioId)
                // subsonicLog.debug(`[Subsonic] Radio ${id} fetched ${songs?.length || 0} songs`)

                if (songs && songs.length > 0) {
                    // 随机取一首，提升电台体验
                    const s = songs[Math.floor(Math.random() * songs.length)]
                    const songmid = s.mid || s.songmid
                    // subsonicLog.debug(`[Subsonic] Radio ${id} picked song: ${s.name || s.songname} (${songmid})`)

                    const musicInfo: any = { source: 'tx', songmid, id: `tx_${songmid}`, meta: { songId: songmid } }
                    const result = await callUserApiGetMusicUrl('tx', musicInfo, quality, username)

                    if (result && result.url) {
                        if (global.lx.config['subsonic.cacheOnPlay'] && username) {
                            const songKey = `tx_${songmid}_${quality}`
                            const previous = this.subsonicActiveTasks.get(username)
                            if (previous && previous.songKey !== songKey) {
                                subsonicLog.debug(`[Subsonic] User ${username} switched radio track, aborting previous background cache task: ${previous.songKey}`)
                                previous.controller.abort()
                            }

                            const controller = new AbortController()
                            this.subsonicActiveTasks.set(username, { songKey, controller })

                            void downloadAndCache(musicInfo, result.url, quality, username, controller.signal, false, true, true, {
                                requestedSource: 'tx',
                                downloadSource: 'tx',
                                sourceName: 'tx',
                            }).catch((err: any) => {
                                if (err?.message !== 'Aborted') {
                                    subsonicLog.error('[Subsonic] radio cacheOnPlay failed:', err?.message || err)
                                }
                            }).finally(() => {
                                if (this.subsonicActiveTasks.get(username)?.controller === controller) {
                                    this.subsonicActiveTasks.delete(username)
                                }
                            })
                        }
                        res.writeHead(302, { Location: result.url })
                        return res.end()
                    } else {
                        failReason = '音源未能解析出可播放链接'
                        subsonicLog.error(`[Subsonic] Radio ${id} failed to resolve music URL`)
                    }
                } else {
                    failReason = '上游取歌接口未返回歌曲（QQ 电台接口可能已失效）'
                    subsonicLog.warn(`[Subsonic] Radio ${id} returned empty song list`)
                }
                return this.sendError(res, 0, 'Could not resolve radio track' + (failReason ? `: ${failReason}` : ''), format)
            }

            // [新增] 本地缓存优先播放：受 subsonic.playCacheFirst 开关控制(默认开启)。
            // 按音质优先级顺序(受 maxBitrate 上界约束)精确探测缓存，命中即直接回传本地文件，跳过源站回源与优先级优选；
            // 与 resolveStreamUrl 共用 getQualityPriorityOrder，保证"缓存命中"与"回源优选"的音质语义一致（不串音质）。
            if (global.lx.config['subsonic.playCacheFirst'] !== false) {
                const cacheOrder = this.getQualityPriorityOrder(source, maxBitrate)
                for (const q of cacheOrder) {
                    const c = checkCache({ source, songmid, id, quality: q, exactQuality: true }, username, false)
                    if (c.exists && c.filename) {
                        subsonicLog.debug(`[Subsonic] Stream hit local cache for ${id} (${c.quality || q}): ${c.filename} (${c.folder})`)
                        return serveCacheFile(req, res, c.filename, username)
                    }
                }
            }

            // [修复] 像 star 一样：先用 findMusicById 查本地/缓存，查不到再在线回源补全真实元数据
            // （否则仅用 Subsonic 的不完整信息会导致缓存文件名为 Unknown - Unknown - ...）
            let musicInfo: any
            try {
                const hit = await this.resolveSongMeta(username, id)
                musicInfo = hit?.music || null
            } catch (e) {
                this.logSourceError('resolveSongMeta', `stream ${id}`, e)
                musicInfo = null
            }
            if (!musicInfo) {
                musicInfo = { source, songmid, id, meta: { songId: songmid } }
            }
            // [诊断] 打印回源结果与客户端的歌曲元数据参数，便于排查 kw 等源仍为 Unknown 的问题
            if (global.lx.config['subsonic.enableDebug']) {
                subsonicLog.debug(`[Subsonic] stream resolve ${id}: name=${musicInfo.name || '(空)'} singer=${musicInfo.singer || '(空)'} album=${musicInfo.meta?.albumName || '(空)'}`)
                subsonicLog.debug(`[Subsonic] stream params: name=${params.get('name') || ''} title=${params.get('title') || ''} artist=${params.get('artist') || ''} album=${params.get('album') || ''}`)
            }
            // [修复] 客户端（音流）通常在 stream 请求里附带真实元数据（name/artist/album），
            // 用于补充 Subsonic 自身不完整的歌曲信息（kw 等无 getMusicInfo 的源尤其依赖它）
            if (!musicInfo.name) {
                const cName = params.get('name') || params.get('title') || ''
                if (cName) {
                    musicInfo = {
                        ...musicInfo,
                        name: cName,
                        singer: params.get('artist') || musicInfo.singer || '',
                        source,
                        songmid,
                        id,
                        img: musicInfo.img || null,
                        meta: {
                            ...(musicInfo.meta || {}),
                            songId: songmid,
                            albumName: params.get('album') || musicInfo.meta?.albumName || '',
                        },
                    }
                    subsonicLog.debug(`[Subsonic] stream ${id}: 已用客户端参数补全 name=${cName}`)
                    // [修复] 把客户端补全后的结果也落盘，否则重启后还得再靠客户端参数补全一次，
                    // 一旦客户端未带参数就会再次缺失
                    this.cacheOnlineSong(musicInfo)
                }
            }

            let hash = musicInfo.hash || musicInfo.meta?.hash || ''
            if (source === 'kg' && !hash) {
                try {
                    const title = musicInfo.name || params.get('title') || params.get('name') || songmid
                    const searchRes = await musicSdk.kg.musicSearch.search(title, 1, 5)
                    const match = searchRes?.list?.find((item: any) => String(item.songmid || item.id || item.Audioid) === songmid) || searchRes?.list?.[0]
                    if (match) {
                        hash = match.hash || match.meta?.hash || match.types?.[0]?.hash || ''
                    }
                } catch (e) {
                    this.logSourceError('kg-hash', `auto-resolve hash kw_${songmid}`, e)
                }
            }

            musicInfo = {
                ...musicInfo,
                source,
                songmid,
                id,
                ...(hash ? { hash } : {}),
                meta: {
                    ...(musicInfo.meta || {}),
                    songId: songmid,
                    ...(hash ? { hash } : {}),
                }
            }

            const transcodeEnabled = global.lx.config['subsonic.transcode.enabled']
            const onQualityMiss = global.lx.config['subsonic.transcode.onQualityMiss'] !== false
            // 仅当客户端设了上限(maxBitrate>0)且音源缺对应低音质时,才走服务端转码兜底(默认关,需手动开启)
            const wantTranscode = !!transcodeEnabled && onQualityMiss && maxBitrate > 0

            let result: { url: string, quality: string, selected?: string } | null = null
            let needTranscode = false
            try {
                result = await this.resolveStreamUrl(source, songmid, id, musicInfo, quality, maxBitrate, username)
                // soft 模式可能突破上限返回高音质；若实际音质超出客户端上限且要转码,则转码兜底
                if (wantTranscode && this.isQualityOverCap(result.quality, maxBitrate)) {
                    needTranscode = true
                }
            } catch (e: any) {
                // 所有候选失败(hard 模式无低音质 / 音源无此曲):尝试取最高可用音质转码兜底
                if (wantTranscode) {
                    const hi = await this.resolveHighestQuality(source, songmid, id, musicInfo, username)
                    if (hi && hi.url) {
                        result = hi
                        needTranscode = true
                    } else {
                        throw e
                    }
                } else {
                    throw e
                }
            }

            if (result && result.url) {
                // [诊断] 打印缓存触发决策，便于排查 Subsonic 播放不缓存问题
                if (global.lx.config['subsonic.enableDebug']) {
                    subsonicLog.debug(`[Subsonic] stream cacheOnPlay: enabled=${global.lx.config['subsonic.cacheOnPlay']} user=${username} url=${String(result.url).slice(0, 90)}${result.selected ? ' selected=' + result.selected : ''}`)
                }
                // [新增] 播放时触发服务器缓存保存：受 subsonic.cacheOnPlay 开关控制
                // 后台落盘到该用户缓存目录；已在播放的上一首若未下载完成，在切换新歌曲时自动 abort 中断，避免连切刷歌堆积带宽
                if (global.lx.config['subsonic.cacheOnPlay'] && username) {
                    const songKey = `${source}_${songmid}_${result.quality}`
                    const previous = this.subsonicActiveTasks.get(username)
                    if (previous && previous.songKey !== songKey) {
                        subsonicLog.debug(`[Subsonic] User ${username} switched track, aborting previous background cache task: ${previous.songKey}`)
                        previous.controller.abort()
                    }

                    const controller = new AbortController()
                    this.subsonicActiveTasks.set(username, { songKey, controller })

                    void downloadAndCache(musicInfo, result.url, result.quality, username, controller.signal, false, true, true, {
                        requestedSource: source,
                        downloadSource: source,
                        sourceName: source,
                    }).then(() => {
                        subsonicLog.debug(`[Subsonic] cacheOnPlay: cache task done for ${musicInfo.id} (${quality})`)
                    }).catch((err: any) => {
                        if (err?.message !== 'Aborted') {
                            subsonicLog.error('[Subsonic] cacheOnPlay failed:', err?.message || err)
                        }
                    }).finally(() => {
                        if (this.subsonicActiveTasks.get(username)?.controller === controller) {
                            this.subsonicActiveTasks.delete(username)
                        }
                    })
                }
                // 转码兜底:服务端拉高音质 -> ffmpeg 降码率 -> 流式发给客户端(节省客户端流量)
                if (needTranscode) {
                    await this.transcodeStream(req, res, result.url, maxBitrate, format, timeOffsetSec)
                    return
                }
                res.writeHead(302, { Location: result.url })
                res.end()
            } else {
                return this.sendError(res, 0, 'Could not resolve music URL', format)
            }
        } catch (err: any) {
            return this.sendError(res, 0, err.message || 'Stream error', format)
        }
    }

    /**
     * 判断实际音质是否超出客户端 maxBitrate 上限(用于决定是否转码兜底)。
     * maxBitrate=0 表示客户端要最高音质,永不转码。
     */
    private isQualityOverCap(quality: string, maxBitrate: number): boolean {
        if (maxBitrate === 0) return false
        const KBPS: Record<string, number> = { master: 9999, hires: 9999, flac24bit: 9999, flac: 9999, '320k': 320, '192k': 192, '128k': 128 }
        const b = KBPS[String(quality).toLowerCase()] ?? 128
        return b > maxBitrate
    }

    /**
     * 取最高可用音质(突破上限),用于转码兜底时拉取高音质源。
     * maxBitrate=0 时 getQualityPriorityOrder 返回全部优先级,resolveStreamUrl 会取最高可用。
     */
    private async resolveHighestQuality(
        source: string, songmid: string, id: string, musicInfo: any, username: string,
    ): Promise<{ url: string, quality: string, selected?: string } | null> {
        try {
            const r = await this.resolveStreamUrl(source, songmid, id, musicInfo, 'flac', 0, username)
            return r && r.url ? r : null
        } catch {
            return null
        }
    }

    /**
     * 服务端流式转码:边从音源下载高码率,边经 ffmpeg 降到目标码率,实时转发给客户端。
     * 用于「音源无客户端请求的低音质」场景,既满足客户端低码率需求,又节省其下行流量。
     * 客户端断开时中止 ffmpeg 进程;ffmpeg 缺失则降级为 302 直链(避免播放失败)。
     */
    private async transcodeStream(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        url: string,
        maxBitrate: number,
        format: string,
        timeOffsetSec = 0,
        formatOverride?: string,
    ): Promise<void> {
        const cfg = global.lx.config
        const targetFormat = String(formatOverride || cfg['subsonic.transcode.format'] || 'mp3').toLowerCase()
        const maxConcurrent = Math.max(1, Number(cfg['subsonic.transcode.maxConcurrent'] ?? 2) || 2)

        // ffmpeg 可用性检测:缺失则降级 302 直链,避免播放失败
        let ok = false
        try { ok = await probeFfmpeg() } catch { ok = false }
        if (!ok) {
            subsonicLog.warn(`[Subsonic] transcode enabled but ffmpeg unavailable, fallback 302 -> ${String(url).slice(0, 60)}`)
            res.writeHead(302, { Location: url })
            res.end()
            return
        }

        const sem = getTranscodeSemaphore(maxConcurrent)
        await sem.acquire()
        subsonicLog.info(`[Subsonic] transcode start: target=${maxBitrate}k format=${targetFormat} url=${String(url).slice(0, 60)}`)

        // [transcodeOffset] 从指定秒数开始转码（-ss 放在 -i 前做快速定位），用于客户端在转码流里跳转
        const args = [
            ...(timeOffsetSec > 0 ? ['-ss', String(timeOffsetSec)] : []),
            '-i', url, '-b:a', `${maxBitrate}k`, '-ar', '48000', '-f', targetFormat, '-',
        ]
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        const contentType = targetFormat === 'mp3' ? 'audio/mpeg'
            : targetFormat === 'opus' ? 'audio/ogg'
            : targetFormat === 'aac' ? 'audio/aac'
            : 'application/octet-stream'

        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' })

        let cleaned = false
        const cleanup = () => {
            if (cleaned) return
            cleaned = true
            sem.release()
            try { if (!proc.killed) proc.kill('SIGKILL') } catch { /* ignore */ }
        }

        proc.stdout.pipe(res)
        proc.on('error', () => {
            cleanup()
            subsonicLog.error(`[Subsonic] transcode ffmpeg error (url=${String(url).slice(0, 60)})`)
        })
        proc.on('close', () => cleanup())
        // 客户端断开:中止转码,释放并发额度
        req.on('close', () => cleanup())
        if (cfg['subsonic.enableDebug']) {
            proc.stderr.on('data', (d: Buffer) => subsonicLog.debug(`[Subsonic][ffmpeg] ${d.toString().slice(0, 200)}`))
        } else {
            proc.stderr.resume() // 排空 stderr,避免子进程因管道满而阻塞
        }
    }

    /**
     * 封面代理：把当前请求要求的尺寸（coverArtScaling）透传给 proxyCoverImage。
     * 尺寸挂在 res 上而不是实例字段，避免并发请求之间互相串尺寸。
     */
    private async proxyCover(res: http.ServerResponse, url: string) {
        return proxyCoverImage(res, url, (res as any).__coverSize || 0)
    }

    private async handleGetCoverArt(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        // [coverArtScaling] 客户端实际会带 size（实测 92/120 次请求带），此前被完全忽略
        const coverSize = Math.max(0, Math.min(parseInt(params.get('size') || '0') || 0, 1500))
        ;(res as any).__coverSize = coverSize

        let id = params.get('id')
        if (!id) {
            res.writeHead(204)
            return res.end()
        }

        try {
            // 0. 剥离前缀 (al-, ar-, tr-, sg-, mg-) 并处理 URL
            id = id.replace(/^(al-|ar-|tr-|sg-|mg-)/, '')
            if (id === 'logo') {
                const logoPath = path.join(global.lx.staticPath, 'music/assets/logo.svg')
                if (fs.existsSync(logoPath)) {
                    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
                    return fs.createReadStream(logoPath).pipe(res)
                }
            }
            // 处理作为 coverArt 传入的直链 URL（客户端可能对其做 percent-encode 后再作为 id 传回）
            let coverUrl = id
            if (!coverUrl.startsWith('http') && (coverUrl.startsWith('https%3A') || coverUrl.startsWith('http%3A'))) {
                try { coverUrl = decodeURIComponent(coverUrl) } catch { /* 解码失败保持原值 */ }
            }
            if (coverUrl.startsWith('http')) return this.proxyCover(res, coverUrl)

            // [新增] 排行榜虚拟歌单封面：coverArt 形如 lb_<source>_<bangid>，getBoards 接口不带图，
            // 按需拉取该榜单首歌封面（带缓存）后代理返回；失败回退 logo。
            if (id.startsWith('lb_')) {
                const url = await this.getLeaderboardCoverUrl(id)
                if (url && url !== 'logo') {
                    return this.proxyCover(res, url.startsWith('//') ? `https:${url}` : url)
                }
                const logoPath = path.join(global.lx.staticPath, 'music/assets/logo.svg')
                if (fs.existsSync(logoPath)) {
                    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
                    return fs.createReadStream(logoPath).pipe(res)
                }
                return res.end()
            }

            // [新增] 共享歌单(歌单)虚拟歌单封面：coverArt 形如 pl_<source>_<plId>，列表阶段已记录歌单 img
            if (id.startsWith('pl_')) {
                const url = sharedPlaylistCoverCache.get(id)
                if (url && url !== 'logo') {
                    return this.proxyCover(res, url.startsWith('//') ? `https:${url}` : url)
                }
                const logoPath = path.join(global.lx.staticPath, 'music/assets/logo.svg')
                if (fs.existsSync(logoPath)) {
                    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
                    return fs.createReadStream(logoPath).pipe(res)
                }
                return res.end()
            }

            // [新增] 兼容逻辑：处理不规范的 ID（如原始 albumMid）
            if (!id.includes('_')) {
                const userSpace = getUserSpace(username)
                const listData = await userSpace.listManage.getListData()
                const allMusics = [...listData.loveList, ...listData.defaultList, ...listData.userList.flatMap(l => (l.list || []) as LX.Music.MusicInfo[])]
                const matched = allMusics.find((m: any) => m.meta?.albumId === id || m.meta?.albumMid === id)
                if (matched) {
                    const picUrl = (matched as any).meta?.picUrl || (matched as any).img
                    if (picUrl) {
                        return this.proxyCover(res, picUrl)
                    }
                }
            }

            // 辅助：通过 SDK 获取封面（带超时保护）
            const getPicViaSDK = async (music: LX.Music.MusicInfo): Promise<string | null> => {
                const source = music.source as string
                const sdk = musicSdk[source]
                if (!sdk?.getPic) {
                    return null
                }
                try {
                    const meta = (music as any).meta || {}
                    // 剥离 source 前缀：'wy_604841' -> '604841'，确保平台 SDK 能识别
                    const rawSongId = music.id.includes('_')
                        ? music.id.split('_').slice(1).join('_')
                        : music.id
                    const songInfo = {
                        ...meta,
                        id: music.id,
                        name: music.name,
                        singer: music.singer,
                        source,
                        songmid: meta.songId || rawSongId,
                    }
                    const picUrl = await Promise.race([
                        sdk.getPic(songInfo),
                        new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
                    ])
                    return typeof picUrl === 'string' && picUrl.startsWith('http') ? picUrl : null
                } catch (e: any) {
                    console.error(`[CoverArt] SDK getPic error:`, e?.message)
                    return null
                }
            }



            // 1. 优先尝试从内存预缓存中获取 (用于 SDK 动态抓取的歌曲)
            if (this.songPicUrlCache.has(id)) {
                const cachedUrl = this.songPicUrlCache.get(id)
                if (cachedUrl) {
                    return this.proxyCover(res, cachedUrl)
                }
            }

            // 2. 尝试从本地歌单库中查找
            let found = await this.findMusicById(username, id).catch(() => null)

            // [新增] 如果普通歌单没找到，去收藏专辑里找这首歌
            if (!found && id.includes('_')) {
                const libAlbums = await this.getLibraryData(username, 'albums')
                for (const alb of libAlbums) {
                    const song = (alb.list || []).find((s: any) => `${s.source}_${s.songmid || s.songId}` === id)
                    if (song) {
                        const source = alb.source || 'wy'
                        found = { music: { ...song, id, meta: { picUrl: song.img || song.meta?.picUrl } } as any, listId: `alb_${source}_${alb.id}` }
                        break
                    }
                }
            }

            if (found) {
                const picUrl = (found.music as any)?.meta?.picUrl || (found.music as any)?.img || null
                if (picUrl) return this.proxyCover(res, picUrl)
                const sdkPic = await getPicViaSDK(found.music)
                if (sdkPic) return this.proxyCover(res, sdkPic)
            } else if (id.startsWith('alb_')) {
                // [修复] 专辑封面：绝不能直接调歌曲 getPic（专辑对象无 songmid/hash，会读取 undefined.length 崩溃）。
                // 优先用本地专辑库的 picUrl；没有则落到函数末尾的 204 兜底。
                const parts = id.split('_')
                const source = parts[1]
                const realId = parts.slice(2).join('_')
                try {
                    const libAlbums = await this.getLibraryData(username, 'albums')
                    const alb = libAlbums.find((a: any) =>
                        `${(a.source || 'wy')}_${a.id}` === id || String(a.id) === realId)
                    const localPic = alb?.picUrl || alb?.img
                    if (localPic) return this.proxyCover(res, localPic)
                } catch (e) {
                    console.error(`[CoverArt] read album library failed for ${id}:`, (e as Error)?.message)
                }
                // [修复] 云端/推荐专辑不进本地库，按专辑 mid 直接构造封面 URL（修复首页推荐专辑缺图）
                const cloudCover = this.buildAlbumCoverUrl(source, realId)
                if (cloudCover) return this.proxyCover(res, cloudCover)
                // [补齐] NetEase(wy) 等源的专辑封面无法仅凭 id 拼 URL，走 SDK 取专辑详情拿真实 picUrl（带 In-flight 复用）
                const getAlbumSongs = musicSdk[source]?.extendDetail?.getAlbumSongs
                if (getAlbumSongs) {
                    try {
                        let fetchPromise = this.albumSongFetchInFlight.get(id)
                        if (!fetchPromise) {
                            fetchPromise = (async () => {
                                try {
                                    const data = await getAlbumSongs(realId)
                                    const firstSong = (data?.list || [])[0]
                                    const cover = firstSong?.img || firstSong?.picUrl || firstSong?.meta?.picUrl || firstSong?.al?.picUrl
                                    return cover || null
                                } catch (e) {
                                    console.error(`[CoverArt] SDK getAlbumSongs failed for ${id}:`, (e as Error)?.message)
                                    return null
                                } finally {
                                    this.albumSongFetchInFlight.delete(id)
                                }
                            })()
                            this.albumSongFetchInFlight.set(id, fetchPromise)
                        }
                        const albumCover = await fetchPromise
                        if (albumCover) {
                            this.setSongPicUrl(id, albumCover)
                            return this.proxyCover(res, albumCover)
                        }
                    } catch (e) {
                        console.error(`[CoverArt] resolve albumCover failed for ${id}:`, (e as Error)?.message)
                    }
                }
                // 注：musicSdk 各源未统一暴露专辑封面接口（kg 的 getAlbumInfo 未挂到 SDK 对象上），
                // 此处不再强行调用歌曲 getPic，避免崩溃；专辑库有 picUrl 或可按 mid 构造时才返回封面。
            } else if (id.startsWith('art_')) {
                // [修改] 歌手封面逻辑优化：先查本地库，再查歌手图助手
                const parts = id.split('_')
                const source = parts[1]
                const realId = parts.slice(2).join('_')

                // 1. 尝试从本地歌手库 (artists.json) 获取 picUrl
                const libArtists = await this.getLibraryData(username, 'artists')
                const localArt = libArtists.find(a => (a.source === source && a.id === realId) || a.name === realId)
                if (localArt && (localArt.picUrl || localArt.img)) {
                    return this.proxyCover(res, downscaleAvatarUrl(localArt.picUrl || localArt.img))
                }

                // 2. 兜底尝试使用歌手名搜索照片
                const cover = await getSingerPic(localArt?.name || realId)
                if (cover) return this.proxyCover(res, downscaleAvatarUrl(cover))
            } else if (id.includes('_')) {
                // 1.5 歌曲不在已加载的库中，解析 ID 直接尝试 SDK
                const parts = id.split('_')
                // 排除特殊前缀，获取真正的 source
                const source = ['alb', 'art', 'hot-songs'].includes(parts[0]) ? parts[1] : parts[0]
                const songmid = ['alb', 'art', 'hot-songs'].includes(parts[0]) ? parts.slice(2).join('_') : parts.slice(1).join('_')

                if (musicSdk[source]) {
                    const music: any = { source, id, songmid, name: '', singer: '' }
                    const sdkPic = await getPicViaSDK(music as any)
                    if (sdkPic) return this.proxyCover(res, sdkPic)
                }
            }

            // 2. 尝试作为歌手 ID 处理 (artist_歌手名)
            if (id.startsWith('artist_')) {
                const singerName = id.slice(7)
                if (singerName) {
                    const cover = await getSingerPic(singerName)
                    if (cover) return this.proxyCover(res, downscaleAvatarUrl(cover))
                }
            }

            // 3. 尝试作为歌单 ID 处理
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()

            let listMusics: LX.Music.MusicInfo[] = []
            if (id === 'love') {
                listMusics = listData.loveList
            } else if (id === 'default') {
                listMusics = listData.defaultList
            } else {
                const list = listData.userList.find((l: any) => l.id === id)
                if (list) {
                    if ((list as any).Album) return this.proxyCover(res, (list as any).Album)
                    listMusics = (list.list || []) as LX.Music.MusicInfo[]
                }
            }

            if (listMusics.length > 0) {
                for (const music of listMusics) {
                    const picUrl = (music as any)?.meta?.picUrl || (music as any)?.img
                    if (picUrl) return this.proxyCover(res, picUrl)
                }
                const sdkPic = await getPicViaSDK(listMusics[0])
                if (sdkPic) return this.proxyCover(res, sdkPic)
            }

            // 4. 兜底
            res.writeHead(204)
            res.end()
        } catch (e: any) {
            subsonicLog.error('[Subsonic] handleGetCoverArt error:', e?.message || e)
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
            if (!res.writableEnded) res.end(JSON.stringify({ error: 'cover art error' }))
        }
    }

    /**
     * 按歌曲 id 取出可直接返回的条目：JSON 用平铺对象，XML 需要包成 { attrs }。
     * 先查本地列表，其次在线歌曲缓存（findMusicById 内部会加载 onlineSongCache）。
     */
    private async songEntryById(username: string, id: string, format: string): Promise<any | null> {
        const found = await this.findMusicById(username, id)
        if (!found) return null
        const flat = this.musicToSongFlat(found.music, found.listId, undefined, username)
        return format === 'json' ? flat : { attrs: flat }
    }

    /**
     * [playbackReport] reportPlayback：客户端按状态变化上报播放时间线。
     * 约定（OpenSubsonic）：state ∈ starting|playing|paused|stopped；
     *  - 服务端不得凭「预计播放结束」自行判定已播完，只有收到 stopped 才算一次播放；
     *  - ignoreScrobble=true 时只更新 now-playing 状态，不产生 scrobble/播放次数副作用。
     * 本实现：所有状态都记入内存态 now-playing（含精确位置）；仅 stopped 且未 ignoreScrobble 时落一条播放历史。
     */
    private async handleReportPlayback(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const mediaId = (params.get('mediaId') || '').trim().replace(/^(al-|ar-|tr-|sg-|mg-)/, '')
        if (!mediaId) return this.sendError(res, 10, 'Required parameter is missing: mediaId', format)
        const state = (params.get('state') || '').trim()
        if (!state) return this.sendError(res, 10, 'Required parameter is missing: state', format)
        const mediaType = (params.get('mediaType') || 'song').trim() || 'song'
        const positionMs = Math.max(0, Math.floor(Number(params.get('positionMs') || 0)) || 0)
        const playbackRate = Number(params.get('playbackRate') || 1) || 1
        const ignoreScrobble = params.get('ignoreScrobble') === 'true'

        playbackReportState.set(username, { id: mediaId, positionMs, state, playbackRate, updatedAt: Date.now() })

        if (!ignoreScrobble && state === 'stopped' && mediaType === 'song') {
            const list = readScrobbles(username)
            list.push({ id: mediaId, time: Date.now() })
            writeScrobbles(username, list)
        }

        subsonicLog.debug(`[Subsonic] reportPlayback: state=${state} mediaId=${mediaId} pos=${positionMs}ms rate=${playbackRate} ignore=${ignoreScrobble} (user=${username})`)
        return this.sendResponse(res, {}, format)
    }

    /** [书签] getBookmarks：返回该用户的全部书签（歌 + 位置） */
    private async handleGetBookmarks(res: http.ServerResponse, username: string, format: string) {
        const list = readBookmarks(username)
        if (format === 'json') {
            const out: any[] = []
            for (const b of list) {
                const entry = await this.songEntryById(username, b.id, format)
                if (!entry) continue
                out.push({ entry, position: b.position, username, comment: b.comment, created: new Date(b.created).toISOString() })
            }
            return this.sendResponse(res, { bookmarks: { bookmark: out } }, format)
        }
        const out: any[] = []
        for (const b of list) {
            const entry = await this.songEntryById(username, b.id, format)
            if (!entry) continue
            out.push({
                attrs: { position: b.position, username, comment: b.comment, created: new Date(b.created).toISOString() },
                children: { entry: { attrs: entry.attrs } },
            })
        }
        return this.sendResponse(res, { bookmarks: { children: { bookmark: out } } }, format)
    }

    /** [书签] createBookmark：新建/覆盖某首歌的书签（id + position 必填，comment 可选） */
    private async handleCreateBookmark(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)
        if (!params.has('position')) return this.sendError(res, 10, 'Required parameter is missing: position', format)
        const position = Math.max(0, Math.floor(Number(params.get('position')) || 0))
        const comment = params.get('comment') || ''
        const list = readBookmarks(username).filter(b => b.id !== id)
        list.push({ id, position, comment, created: Date.now() })
        writeBookmarks(username, list)
        subsonicLog.debug(`[Subsonic] createBookmark: ${id} @${position}ms (user=${username})`)
        return this.sendResponse(res, {}, format)
    }

    /** [书签] deleteBookmark：删除某首歌的书签 */
    private async handleDeleteBookmark(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)
        writeBookmarks(username, readBookmarks(username).filter(b => b.id !== id))
        return this.sendResponse(res, {}, format)
    }

    /**
     * scrobble：客户端上报播放。
     * [修复] 之前这里直接返回空成功、什么都不记录，服务端无从得知用户听过什么
     * （音流在高频调用，NAS 实例日志里 1853 次）。现在落盘为播放历史。
     */
    private async handleScrobble(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        // [修复] 必须剥离客户端加的 id 前缀（al-/ar-/tr-/sg-/mg-，与 getCoverArt 一致）：
        // 带前缀的 id 存进播放历史后会解析不出歌曲，导致「最近播放」漏掉这些歌
        const ids = params.getAll('id')
            .flatMap(v => String(v).split(','))
            .map(s => s.trim().replace(/^(al-|ar-|tr-|sg-|mg-)/, ''))
            .filter(Boolean)
        if (!ids.length) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        const timeParam = params.get('time')
        const parsed = timeParam ? Number(timeParam) : NaN
        // 客户端可能传毫秒(13 位)或秒(10 位)时间戳
        const eventTime = Number.isFinite(parsed) && parsed > 0
            ? (String(Math.floor(parsed)).length >= 13 ? parsed : parsed * 1000)
            : Date.now()

        const list = readScrobbles(username)
        for (const id of ids) list.push({ id, time: eventTime })
        writeScrobbles(username, list)

        subsonicLog.debug(`[Subsonic] scrobble: ${ids.length} 首 (${ids.slice(0, 3).join(', ')}) time=${new Date(eventTime).toISOString()} (user=${username})`)
        return this.sendResponse(res, {}, format)
    }

    /**
     * getNowPlaying：最近的播放活动。用 scrobble 历史近似（15 分钟窗口），
     * 同一首歌只保留最近一条；按 ID 解析出完整歌曲条目返回。
     */
    private async handleGetNowPlaying(res: http.ServerResponse, username: string, format: string) {
        const since = Date.now() - 15 * 60 * 1000
        const latest = new Map<string, number>()
        for (const it of readScrobbles(username)) {
            if (it.time < since) continue
            latest.set(it.id, it.time)
        }
        // [playbackReport] 实时上报的播放状态优先（含精确位置），15 分钟窗口内有效
        const reported = playbackReportState.get(username)
        const reportedActive = !!reported && Date.now() - reported.updatedAt < 15 * 60 * 1000 && reported.state !== 'stopped'
        if (reportedActive && reported) latest.set(reported.id, reported.updatedAt)
        const entries = Array.from(latest.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)

        const songs: any[] = []
        for (const [id, time] of entries) {
            const entry = await this.songEntryById(username, id, format)
            if (!entry) continue
            const extra: any = {
                userName: username,
                minutesAgo: Math.max(0, Math.round((Date.now() - time) / 60000)),
                playerId: 0,
                playerName: 'lxserver',
            }
            // [playbackReport] 正在播放的那首附带精确位置（GetNowPlaying 的 timeline 字段）
            if (reportedActive && reported && reported.id === id) extra.positionMs = reported.positionMs
            songs.push(format === 'json' ? { ...entry, ...extra } : { attrs: { ...entry.attrs, ...extra } })
        }

        // toXml 的数组必须挂在 children 下，否则会渲染成空元素 <nowPlaying />
        return this.sendResponse(res, format === 'json'
            ? { nowPlaying: { entry: songs } }
            : { nowPlaying: { children: { entry: songs } } }, format)
    }

    /** savePlayQueue：保存当前播放队列，用于跨设备 / 重连后续播 */
    private async handleSavePlayQueue(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const ids = params.getAll('id')
            .flatMap(v => String(v).split(','))
            .map(s => s.trim())
            .filter(Boolean)
        const current = params.get('current') || (ids.length ? ids[ids.length - 1] : '')
        const position = Math.max(0, Math.floor(Number(params.get('position') || 0)) || 0)

        writePlayQueue(username, {
            ids,
            current,
            // 同时记录索引，供 getPlayQueueByIndex 使用（indexBasedQueue 扩展）
            currentIndex: Math.max(0, ids.indexOf(current)),
            position,
            changed: Date.now(),
            changedBy: params.get('c') || '',
        })

        subsonicLog.debug(`[Subsonic] savePlayQueue: ${ids.length} 首 current=${current} position=${position}ms (user=${username})`)
        return this.sendResponse(res, {}, format)
    }

    /** getPlayQueue：读取上次保存的播放队列（含当前曲目下标与播放位置） */
    private async handleGetPlayQueue(res: http.ServerResponse, username: string, format: string) {
        const state = readPlayQueue(username)
        const ids = state?.ids || []
        const entries: any[] = []
        for (const id of ids) {
            const entry = await this.songEntryById(username, id, format)
            if (entry) entries.push(entry)
        }

        const currentIndex = state?.current ? Math.max(0, ids.indexOf(state.current)) : 0
        const position = state?.position || 0
        const changed = new Date(state?.changed || 0).toISOString()
        const changedBy = state?.changedBy || ''

        if (format === 'json') {
            return this.sendResponse(res, {
                playQueue: { entry: entries, current: currentIndex, position, username, changed, changedBy },
            }, format)
        }
        return this.sendResponse(res, {
            playQueue: {
                attrs: { current: currentIndex, position, username, changed, changedBy },
                children: { entry: entries },
            },
        }, format)
    }

    /**
     * [indexBasedQueue] savePlayQueueByIndex：按「索引」保存播放队列。
     * 与 savePlayQueue 的区别：用 currentIndex 而不是歌曲 id 表达当前曲目，
     * 因此允许队列里存在重复曲目。不带任何 id 的调用 = 清空队列（此时不得带 currentIndex）。
     */
    private async handleSavePlayQueueByIndex(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const ids = params.getAll('id')
            .flatMap(v => String(v).split(','))
            .map(s => s.trim())
            .filter(Boolean)
        const changedBy = params.get('c') || ''

        if (!ids.length) {
            if (params.has('currentIndex')) {
                return this.sendError(res, 10, 'currentIndex must not be set when clearing the play queue', format)
            }
            writePlayQueue(username, { ids: [], current: '', position: 0, changed: Date.now(), changedBy })
            return this.sendResponse(res, {}, format)
        }

        const currentIndex = Number(params.get('currentIndex'))
        if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex > ids.length - 1) {
            // 规范要求：currentIndex 越界必须返回错误码 10
            return this.sendError(res, 10, 'Required parameter is missing or invalid: currentIndex', format)
        }
        const position = Math.max(0, Math.floor(Number(params.get('position') || 0)) || 0)

        writePlayQueue(username, {
            ids,
            current: ids[currentIndex],
            currentIndex,
            position,
            changed: Date.now(),
            changedBy,
        })
        subsonicLog.debug(`[Subsonic] savePlayQueueByIndex: ${ids.length} 首 currentIndex=${currentIndex} position=${position}ms (user=${username})`)
        return this.sendResponse(res, {}, format)
    }

    /** [indexBasedQueue] getPlayQueueByIndex：读取播放队列（索引语义，含 currentIndex） */
    private async handleGetPlayQueueByIndex(res: http.ServerResponse, username: string, format: string) {
        const state = readPlayQueue(username)
        const ids = state?.ids || []
        const entries: any[] = []
        for (const id of ids) {
            const entry = await this.songEntryById(username, id, format)
            if (entry) entries.push(entry)
        }

        const currentIndex = typeof state?.currentIndex === 'number'
            ? state.currentIndex
            : (state?.current ? Math.max(0, ids.indexOf(state.current)) : 0)
        const position = state?.position || 0
        const changed = new Date(state?.changed || 0).toISOString()
        const changedBy = state?.changedBy || ''

        if (format === 'json') {
            return this.sendResponse(res, {
                playQueueByIndex: { entry: entries, currentIndex, position, username, changed, changedBy },
            }, format)
        }
        return this.sendResponse(res, {
            playQueueByIndex: {
                attrs: { currentIndex, position, username, changed, changedBy },
                children: { entry: entries },
            },
        }, format)
    }

    /**
     * getIndexes：目录浏览的根索引（旧式 / 部分客户端依赖，音流实测未调用）。
     * 按首字母分组为 index，非 A-Z 归入 “#”（与多数服务端实现一致）。
     */
    private async handleGetIndexes(res: http.ServerResponse, username: string, format: string) {
        const directory = await this.buildArtistDirectory(username)
        // 与 getArtists 使用同一套索引分组（中文按拼音首字母），保持一致
        const buckets = new Map<string, any[]>()
        for (const a of directory) {
            const key = getArtistIndexKey(a.name)
            if (!buckets.has(key)) buckets.set(key, [])
            buckets.get(key)!.push(a)
        }
        const keys = Array.from(buckets.keys())
            .sort((a, b) => ((a === '#' ? 1 : 0) - (b === '#' ? 1 : 0)) || a.localeCompare(b))

        const child: any[] = []
        for (const key of keys) {
            const items = buckets.get(key)
            if (!items || !items.length) continue
            const artists = items.map(a => ({
                attrs: {
                    id: a.id,
                    name: a.name,
                    albumCount: a.albumKeys?.size ?? 0,
                },
            }))
            child.push({ attrs: { name: key }, children: { artist: artists } })
        }

        const lastModified = Date.now()
        if (format === 'json') {
            const childJson = child.map(c => ({
                name: c.attrs.name,
                artist: c.children.artist.map((x: any) => x.attrs),
            }))
            return this.sendResponse(res, {
                indexes: { lastModified, ignoredArticles: '', child: childJson },
            }, format)
        }
        return this.sendResponse(res, {
            indexes: { attrs: { lastModified, ignoredArticles: '' }, children: { child } },
        }, format)
    }

    /**
     * 基于真实播放历史(scrobble)构造专辑列表，结构与推荐池保持一致：
     * - recent   (最近播放)：按专辑最后一次播放时间降序
     * - frequent (最常播放)：按专辑累计播放次数降序
     * 只回溯最近若干条，避免历史很长时逐首解析过慢。
     */
    private async buildPlayedAlbums(username: string, history: ScrobbleEntry[], type: 'recent' | 'frequent', limit: number) {
        const stats = new Map<string, { count: number, lastTime: number, song: any, duration: number, songIds: Set<string> }>()

        let unresolved = 0
        let noAlbum = 0
        for (const item of history.slice(-400)) {
            // 兼容历史脏数据：旧版本写入时未剥离客户端前缀（tr- / ar- 等）
            const rawId = String(item.id || '').replace(/^(al-|ar-|tr-|sg-|mg-)/, '')
            const song = await this.songEntryById(username, rawId, 'json')
            if (!song) { unresolved++; continue }
            let albumId = String(song.albumId || song.parent || '').trim()
            // [修复] albumId 退化成列表 id（love / 歌单 id）会产生 id=love 的脏专辑条目。
            // 这类歌、以及没有专辑信息的单曲，统一表示为「单曲专辑」alb_<source>_<songId>：
            // 既保证听过的歌都出现在列表里，点进去也至少能播这一首
            if (!albumId || !albumId.startsWith('alb_')) {
                const sid = String(song.id || '')
                const idx = sid.indexOf('_')
                const src = idx > 0 ? sid.slice(0, idx) : String(song.source || 'wy')
                const songId = idx > 0 ? sid.slice(idx + 1) : sid
                if (!songId) { noAlbum++; continue }
                albumId = `alb_${src}_${songId}`
                noAlbum++
            }
            const cur = stats.get(albumId)
            if (!cur) {
                stats.set(albumId, { count: 1, lastTime: item.time, song, duration: Number(song.duration) || 0, songIds: new Set([String(song.id || '')]) })
            } else {
                cur.count++
                cur.duration += Number(song.duration) || 0
                if (song.id) cur.songIds.add(String(song.id))
                if (item.time > cur.lastTime) {
                    cur.lastTime = item.time
                    cur.song = song
                }
            }
        }
        if (unresolved || noAlbum) {
            subsonicLog.debug(`[Subsonic] 播放历史构造专辑：解析失败 ${unresolved} 条、无专辑信息 ${noAlbum} 条（已跳过）`)
        }

        const list = Array.from(stats.entries()).map(([albumId, s]) => ({
            id: albumId,
            name: s.song.album || '未知专辑',
            title: s.song.album || '未知专辑',
            album: s.song.album || '未知专辑',
            artist: s.song.artist || '未知歌手',
            artistId: s.song.artistId || `artist_${s.song.artist || ''}`,
            isDir: true,
            coverArt: s.song.coverArt || albumId,
            // [修复] 之前恒为 0：客户端在专辑上显示「0 首」，看起来像数据不对。
            // songCount 是该专辑里实际播放过的不同曲目数（播放次数放在 playCount）
            songCount: s.songIds.size,
            duration: s.duration,
            created: new Date(s.lastTime).toISOString(),
            playCount: s.count,
        }))

        list.sort(type === 'frequent'
            ? (a, b) => (b.playCount - a.playCount) || (Date.parse(b.created) - Date.parse(a.created))
            : (a, b) => Date.parse(b.created) - Date.parse(a.created))

        return list.slice(0, limit)
    }

    private async handleGetTopSongs(
        res: http.ServerResponse,
        username: string,
        params: URLSearchParams,
        format: string,
    ) {
        const artist = (params.get('artist') || '').trim()
        const id = params.get('id') // OpenSubsonic 扩展参数
        const count = Math.min(parseInt(params.get('count') || '50'), 500)

        let picked: { music: LX.Music.MusicInfo, listId: string }[] = []

        // 1. 尝试从本地歌手库 (artists.json) 匹配
        const libArtists = await this.getLibraryData(username, 'artists')

        // 匹配逻辑增强：支持 ID 匹配或模糊名字匹配
        const artistEntry = libArtists.find(a =>
            (id && `art_${a.source || 'wy'}_${a.id}` === id) ||
            (artist && (a.name.toLowerCase().includes(artist.toLowerCase()) || artist.toLowerCase().includes(a.name.toLowerCase())))
        )

        if (artistEntry && artistEntry.source && artistEntry.id && musicSdk[artistEntry.source]?.extendDetail) {
            try {
                const source = artistEntry.source
                const MAX_PAGES = 5
                const PAGE_SIZE = 100
                let all: any[] = []
                for (let p = 1; p <= MAX_PAGES; p++) {
                    const data = await musicSdk[source].extendDetail.getArtistSongs(artistEntry.id, p, PAGE_SIZE, 'hot')
                    const pageList = data.list || []
                    all = all.concat(pageList)
                    if (pageList.length < PAGE_SIZE) break
                }
                picked = all.map((s: any) => ({
                    music: { ...s, id: `${source}_${s.songmid || s.songId}` } as LX.Music.MusicInfo,
                    listId: `art_${source}_${artistEntry.id}`
                }))
            } catch (e) {
                subsonicLog.error(`[Subsonic] getTopSongs SDK error for ${artist || id}:`, e)
            }
        }

        // 2. 兜底逻辑：如果在 SDK/库里没找到，搜索本地所有播放列表
        if (picked.length === 0) {
            const userSpace = getUserSpace(username)
            const listData = await userSpace.listManage.getListData()
            const all: { music: LX.Music.MusicInfo, listId: string }[] = []
            const addAll = (musics: LX.Music.MusicInfo[], listId: string) => {
                for (const m of musics) {
                    if (!artist || m.singer.toLowerCase().includes(artist.toLowerCase())) {
                        all.push({ music: m, listId })
                    }
                }
            }
            addAll(listData.loveList, 'love')
            addAll(listData.defaultList, 'default')
            for (const list of listData.userList) addAll((list.list || []) as LX.Music.MusicInfo[], list.id)
            picked = all.slice(0, count)
        }

        // [dislike] 热门歌曲同样过滤
        if (global.lx.config['subsonic.hideDisliked']) {
            picked = await this.filterDislikedEntries(username, picked)
        }
        // [修复] 尊重客户端的 count：SDK 分支此前会把抓到的全部返回（最多 500 首）
        picked = picked.slice(0, count)

        if (format === 'json') {
            return this.sendResponse(res, {
                topSongs: {
                    song: picked.map(({ music, listId }) => this.musicToSongFlat(music, listId, undefined, username)),
                },
            }, format)
        }
        return this.sendResponse(res, {
            topSongs: {
                children: {
                    song: picked.map(({ music, listId }) => this.musicToSongXml(music, listId, undefined, username)),
                },
            },
        }, format)
    }

    /**
     * 按平台 + 专辑 mid 直接构造封面 URL（用于云端/推荐专辑，未进本地库）
     */
    private buildAlbumCoverUrl(source: string, mid: string): string | null {
        if (!mid) return null
        switch (source) {
            case 'tx':
                return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg?max_age=2592000`
            default:
                return null
        }
    }

    private handleGetOpenSubsonicExtensions(res: http.ServerResponse, format: string) {
        const extensions = [
            { name: 'formPost', versions: [1] },
            // [修复] 原先声明的 'lyrics' / 'coverArtScaling' 都不是 OpenSubsonic 官方扩展名。
            // 官方歌词扩展叫 songLyrics，客户端据此决定是否调用 getLyricsBySongId —— 声明错名字等于该接口白做。
            // 封面缩放仍通过 getCoverArt 的 size 参数生效，只是官方没有对应扩展名可声明，故不再虚报。
            { name: 'songLyrics', versions: [1] },
            // [新增] 播放时间线上报（reportPlayback / getNowPlaying 附带位置）
            { name: 'playbackReport', versions: [1] },
            // [新增] 相似曲目（getSonicSimilarTracks；本服为启发式排序，非声学分析）
            { name: 'sonicSimilarity', versions: [1] },
            // [新增] 按索引保存/读取播放队列（savePlayQueueByIndex / getPlayQueueByIndex）
            { name: 'indexBasedQueue', versions: [1] },
            // [新增] stream 支持 timeOffset（秒），转码链路可从指定位置开始
            { name: 'transcodeOffset', versions: [1] },
            // [新增] 转码决策/转码流（getTranscodeDecision / getTranscodeStream）
            { name: 'transcoding', versions: [1] }
        ]
        const data = { openSubsonicExtensions: format === 'json' ? extensions : { children: { extension: extensions.map(e => ({ attrs: e })) } } }
        return this.sendResponse(res, data, format)
    }

    private async handleGetLyrics(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const artist = params.get('artist') || ''
        const title = params.get('title') || ''
        const id = params.get('id')

        // [新增] 如果请求中带有 ID，优先使用 ID 通过 SDK 获取歌词
        if (id) {
            return this.handleGetLyricsBySongId(res, username, params, format)
        }

        // 尝试通过歌手和标题反查歌曲 ID
        const userSpace = getUserSpace(username)
        const listData = await userSpace.listManage.getListData()
        const all: LX.Music.MusicInfo[] = [
            ...listData.loveList,
            ...listData.defaultList,
            ...listData.userList.flatMap(l => (l.list || []) as LX.Music.MusicInfo[])
        ]

        const found = all.find(m =>
            m.name.toLowerCase() === title.toLowerCase() &&
            m.singer.toLowerCase().includes(artist.toLowerCase())
        )

        if (found) {
            params.set('id', found.id)
            return this.handleGetLyricsBySongId(res, username, params, format)
        }

        const lyricsData = {
            artist: artist,
            title: title,
            value: 'Lyrics not found in library. Please use getLyricsBySongId with a valid song ID.'
        }

        if (format === 'json') {
            return this.sendResponse(res, { lyrics: lyricsData }, format)
        }
        return this.sendResponse(res, {
            lyrics: {
                attrs: { artist: lyricsData.artist, title: lyricsData.title },
                children: lyricsData.value
            }
        }, format)
    }

    /**
     * 将原文 (lyric) 与翻译 (tlyric) 按时间戳交织合并为双行 LRC 格式
     * 排列顺序：最上方为原文 ➔ 最下方为翻译
     */
    private buildMergedLrc(rawLrc: string, transLrc?: string): string {
        const isTransEnabled = global.lx.config['subsonic.lyricTranslation'] !== false
        const effectiveTransLrc = isTransEnabled ? transLrc : ''

        if (!effectiveTransLrc) return rawLrc || ''

        const parseLrcMap = (lrc: string) => {
            const map = new Map<string, string[]>()
            if (!lrc) return map
            const lines = lrc.split(/\r?\n/)
            const timeRegex = /\[(\d{1,3}:\d{1,2}(?:\.\d{1,3})?)\]/g
            for (const line of lines) {
                const text = line.replace(/\[\d{1,3}:\d{1,2}(?:\.\d{1,3})?\]/g, '').trim()
                if (!text) continue
                timeRegex.lastIndex = 0
                const matches = [...line.matchAll(timeRegex)]
                for (const m of matches) {
                    const t = m[1]
                    if (!map.has(t)) map.set(t, [])
                    map.get(t)!.push(text)
                }
            }
            return map
        }

        const rawMap = parseLrcMap(rawLrc)
        const transMap = parseLrcMap(effectiveTransLrc || '')

        // 收集所有出现的时间戳标签
        const allTimeLabels = Array.from(new Set([...rawMap.keys(), ...transMap.keys()]))

        // 辅助时间戳转毫秒排序
        const labelToMs = (label: string) => {
            const parts = label.split(':')
            const secParts = (parts[1] || '0').split('.')
            const min = parseInt(parts[0]) || 0
            const sec = parseInt(secParts[0]) || 0
            const ms = parseInt((secParts[1] || '0').padEnd(3, '0')) || 0
            return min * 60000 + sec * 1000 + ms
        }

        allTimeLabels.sort((a, b) => labelToMs(a) - labelToMs(b))

        const outLines: string[] = []
        for (const t of allTimeLabels) {
            const raws = rawMap.get(t) || []
            const transs = transMap.get(t) || []

            // 排列顺序：原文在上，翻译在下
            for (const r of raws) outLines.push(`[${t}]${r}`)
            for (const tr of transs) outLines.push(`[${t}]${tr}`)
        }

        return outLines.join('\n')
    }

    private async handleGetLyricsBySongId(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const id = params.get('id')
        if (!id) return this.sendError(res, 10, 'Required parameter is missing: id', format)

        // 解析 source 和 songmid
        let source = ''
        let songmid = ''
        if (id.includes('_')) {
            const index = id.indexOf('_')
            source = id.substring(0, index)
            songmid = id.substring(index + 1)
        }

        if (!source || !musicSdk[source]) {
            return this.sendError(res, 70, 'Song or source not supported: ' + id, format)
        }

        try {
            // 尝试查找歌曲详情以丰富歌词请求元数据 (KG/MG 特别需要)
            const found = await this.findMusicById(username, id)
            const musicMeta = found?.music || {
                id,
                source,
                songmid,
                name: params.get('title') || '',
                singer: params.get('artist') || ''
            } as any

            let hash = (musicMeta as any).hash || (musicMeta as any).meta?.hash || ''
            if (source === 'kg' && !hash) {
                try {
                    const title = musicMeta.name || params.get('title') || params.get('name') || songmid
                    const searchRes = await musicSdk.kg.musicSearch.search(title, 1, 5)
                    const match = searchRes?.list?.find((item: any) => String(item.songmid || item.id || item.Audioid) === songmid) || searchRes?.list?.[0]
                    if (match) {
                        hash = match.hash || match.meta?.hash || match.types?.[0]?.hash || ''
                    }
                } catch (e) {
                    subsonicLog.error('[Subsonic] Auto-resolve kg hash for lyric failed:', e)
                }
            }

            const songInfo = {
                songmid: (musicMeta as any).songmid || songmid,
                name: musicMeta.name || '',
                singer: musicMeta.singer || '',
                hash: hash,
                interval: (musicMeta as any).interval || '',
                _interval: (musicMeta as any)._interval || (musicMeta as any).interval || '',
                copyrightId: (musicMeta as any).copyrightId || (musicMeta as any).meta?.copyrightId || '',
                albumId: (musicMeta as any).albumId || (musicMeta as any).meta?.albumId || '',
                lrcUrl: (musicMeta as any).lrcUrl || (musicMeta as any).meta?.lrcUrl || '',
            }

            const requestObj = musicSdk[source].getLyric(songInfo)
            const lyricInfo = await requestObj.promise

            const rawLrc = lyricInfo.lyric || ''
            const transLrc = lyricInfo.tlyric || ''

            const mergedLrc = this.buildMergedLrc(rawLrc, transLrc)

            // 转换结构化歌词
            const lines = this.parseLrc(rawLrc)
            const tlines = transLrc ? this.parseLrc(transLrc) : []

            const structuredLyrics: any[] = [
                {
                    lang: 'und',
                    synced: lines.some(l => l.start !== undefined),
                    line: lines,
                    displayArtist: musicMeta.singer,
                    displayTitle: musicMeta.name,
                }
            ]

            if (tlines.length > 0) {
                structuredLyrics.push({
                    lang: 'zh',
                    synced: tlines.some(l => l.start !== undefined),
                    line: tlines,
                    displayArtist: musicMeta.singer,
                    displayTitle: musicMeta.name,
                })
            }

            if (format === 'json') {
                return this.sendResponse(res, {
                    lyricsList: { structuredLyrics },
                    // 兼容标准 Subsonic getLyrics (同频时间戳双行/多行歌词)
                    lyrics: {
                        artist: musicMeta.singer,
                        title: musicMeta.name,
                        value: mergedLrc
                    }
                }, format)
            }

            // XML 模式逻辑
            return this.sendResponse(res, {
                lyrics: {
                    attrs: { artist: musicMeta.singer, title: musicMeta.name },
                    children: mergedLrc
                },
            }, format)

        } catch (err: any) {
            subsonicLog.error(`[Subsonic] Lyric fetch error:`, err)
            return this.sendError(res, 0, 'Failed to fetch lyrics: ' + err.message, format)
        }
    }

    private parseLrc(lrc: string): { value: string, start?: number }[] {
        if (!lrc) return []
        const lines = lrc.split(/\r?\n/)
        const result: { value: string, start?: number }[] = []
        const timeRegex = /\[(\d+):(\d+)\.(\d+)\]/g

        for (const line of lines) {
            const text = line.replace(/\[\d+:\d+\.\d+\]/g, '').trim()
            if (!text && line.includes(']')) continue

            timeRegex.lastIndex = 0 // 重置正则索引
            const matches = [...line.matchAll(timeRegex)]
            if (matches.length > 0) {
                for (const match of matches) {
                    const minutes = parseInt(match[1])
                    const seconds = parseInt(match[2])
                    const msStr = match[3].padEnd(3, '0')
                    const ms = parseInt(msStr)
                    const startTime = minutes * 60000 + seconds * 1000 + ms
                    result.push({ value: text, start: startTime })
                }
            } else if (text) {
                result.push({ value: text })
            }
        }
        return result.sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    }

    private async handleGetUser(res: http.ServerResponse, username: string, params: URLSearchParams, format: string) {
        const userInfo = {
            username,
            email: '',
            scrobblingEnabled: false,
            adminRole: true,
            settingsRole: true,
            downloadRole: true,
            uploadRole: false,
            playlistRole: true,
            coverArtRole: true,
            commentRole: false,
            podcastRole: false,
            shareRole: false,
            videoConversionRole: false,
            folder: [1],
        }
        if (format === 'json') {
            return this.sendResponse(res, { user: userInfo }, format)
        }
        return this.sendResponse(res, { user: { attrs: userInfo } }, format)
    }
}

export const subsonicHandler = new SubsonicHandler()
