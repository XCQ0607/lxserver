import http from 'http'
import { getProxyAgent } from '../../modules/utils/proxy.js'
import { resolvePublicUrl } from '../auth/security'

/**
 * 封面图片代理与缓存（图片显示核心实现）
 *
 * 崩溃防护（本模块核心目标之一）：
 * - handleGetCoverArt / proxyCoverImage 全链路 try/catch，fetch 异常不会冒泡到事件循环导致 worker 崩溃。
 * - 缓存带容量上限（COVER_CACHE_MAX），避免长期运行 Buffer 堆积引发 OOM 崩溃。
 *
 * - 内存缓存：按图片 URL 缓存抓取到的字节。客户端刷新时会并发重抓几十张 QQ 封面，
 *   若每次都回源易被图片 CDN 限流导致大量 204（封面空白）。缓存后刷新直接命中，规避限流。
 * - 并发信号量：QQ 图片 CDN 对服务端并发抓取限流极严（12 并发约 9 张失败）。
 *   限制同时回源数量，让封面排队抓取，绝大多数能成功；失败再重试。
 * - 失败重试 + 过期降级：降低空白封面概率，回源彻底失败时仍返回过期缓存而非消失。
 */

const coverImageCache = new Map<string, { ts: number, buf: Buffer, ct: string }>()
const COVER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const COVER_CACHE_MAX = 3000
const COVER_CACHE_MAX_BYTES = 100 * 1024 * 1024
const MAX_COVER_BYTES = 10 * 1024 * 1024
let coverCacheBytes = 0
function coverCacheSet(key: string, val: { ts: number, buf: Buffer, ct: string }) {
    const existing = coverImageCache.get(key)
    if (existing) {
        coverCacheBytes -= existing.buf.length
        coverImageCache.delete(key)
    }
    coverImageCache.set(key, val)
    coverCacheBytes += val.buf.length
    // 容量上限：超出条目数或总字节上限时淘汰最旧条目，避免长期运行 Buffer 堆积导致 OOM 崩溃
    while (coverImageCache.size > COVER_CACHE_MAX || coverCacheBytes > COVER_CACHE_MAX_BYTES) {
        const oldest = coverImageCache.keys().next().value
        if (oldest === undefined) break
        const evicted = coverImageCache.get(oldest)
        if (evicted) coverCacheBytes -= evicted.buf.length
        coverImageCache.delete(oldest)
    }
}

// 并发信号量：限制同时回源抓取数量
const coverSem = { active: 0, max: 2, waiters: [] as Array<() => void> }
function coverAcquire(): Promise<void> {
    return new Promise<void>((resolve) => {
        if (coverSem.active < coverSem.max) {
            coverSem.active++
            resolve()
        } else {
            coverSem.waiters.push(resolve)
        }
    })
}
function coverRelease() {
    coverSem.active = Math.max(0, coverSem.active - 1)
    const next = coverSem.waiters.shift()
    if (next) {
        coverSem.active++
        next()
    }
}

/**
 * 尽力而为地按请求尺寸改写上游图片 URL（OpenSubsonic coverArtScaling）。
 *
 * 服务端没有 sharp（生产镜像 `npm install --omit=dev` 不会装它），无法真正缩放字节；
 * 但腾讯/网易的图片尺寸本来就编码在 URL 里，改写它就能拿到对应尺寸的图。
 * 无法识别的域名原样返回——客户端仍能正常显示，只是图更大。
 */
function applyImageSize(url: string, size: number): string {
    if (!url || !/^https?:\/\//.test(url) || !(size > 0)) return url
    const s = Math.max(16, Math.min(Math.floor(size), 1500))
    // 腾讯：.../T002R800x800M000<mid>.jpg
    if (/y\.gtimg\.cn\/.*\/T\d{3}R\d+x\d+M/.test(url)) {
        return url.replace(/(T\d{3}R)\d+x\d+(M)/, `$1${s}x${s}$2`)
    }
    // 网易：追加或替换 ?param=WxH
    if (/music\.126\.net/.test(url)) {
        const param = `${s}y${s}`
        if (/[?&]param=/.test(url)) return url.replace(/([?&]param=)[^&]*/, `$1${param}`)
        return url + (url.includes('?') ? '&' : '?') + `param=${param}`
    }
    return url
}

/**
 * 代理并返回一张封面图片。
 * - 命中新鲜缓存直接返回（X-Cache: HIT）
 * - 否则经信号量限流回源抓取，失败重试 3 次
 * - 全部失败且有过期缓存则降级返回（X-Cache: STALE），否则返回 204
 * @param size 期望边长（px），>0 时对可识别的图片源改写尺寸
 */
export async function proxyCoverImage(res: http.ServerResponse, picUrl: string, size?: number) {
    // 尺寸作用在最终 URL 上，并按改写后的 URL 缓存（不同尺寸各自缓存一份）
    const finalUrl = size && size > 0 ? applyImageSize(picUrl, size) : picUrl
    try {
        await resolvePublicUrl(finalUrl)
    } catch {
        if (!res.headersSent && !res.destroyed && !res.writableEnded) {
            res.writeHead(204)
            res.end()
        }
        return
    }
    const now = Date.now()
    const cached = coverImageCache.get(finalUrl)
    // 命中新鲜缓存直接返回，避免重复回源被图片 CDN 限流
    if (cached && now - cached.ts < COVER_CACHE_TTL) {
        if (res.headersSent || res.destroyed || res.writableEnded) return
        res.writeHead(200, {
            'Content-Type': cached.ct,
            'Cache-Control': 'public, max-age=1800',
            'X-Cache': 'HIT',
        })
        return res.end(cached.buf)
    }

    const doFetch = async (fetchUrl: string): Promise<{ buf: Buffer, ct: string } | null> => {
        if (res.destroyed || res.writableEnded) return null
        await coverAcquire()
        let timer: ReturnType<typeof setTimeout> | undefined
        const controller = new AbortController()
        const onClose = () => controller.abort()
        res.once('close', onClose)
        try {
            if (res.destroyed || res.writableEnded) return null

            // 封面代理属于「应用」类出站请求，走独立的 app 代理开关
            let appAgent: any = undefined
            try { appAgent = await getProxyAgent(fetchUrl, 'app') } catch { /* ignore */ }

            // 开启 app 代理时改用 needle：原生 fetch 无法指定 agent
            if (appAgent) {
                let currentUrl = fetchUrl
                const needle = (await import('needle')).default
                for (let hop = 0; hop <= 3; hop++) {
                    await resolvePublicUrl(currentUrl)
                    const r: any = await needle('get', currentUrl, null, {
                        agent: appAgent,
                        response_timeout: 20000,
                        follow_max: 0,
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
                    } as any)
                    const status: number = r?.statusCode || 0
                    if ([301, 302, 303, 307, 308].includes(status) && r?.headers?.location) {
                        currentUrl = new URL(String(r.headers.location), currentUrl).href
                        continue
                    }
                    if (status < 200 || status >= 300) return null
                    const buf = Buffer.isBuffer(r?.body) ? r.body : Buffer.from(r?.raw || [])
                    if (buf.length === 0 || buf.length > MAX_COVER_BYTES) return null
                    const upstreamCt: string = r?.headers?.['content-type'] || ''
                    const ct = upstreamCt.startsWith('image/') ? upstreamCt.split(';')[0].trim() : 'image/jpeg'
                    return { buf, ct }
                }
                return null
            }

            timer = setTimeout(() => controller.abort(), 20000)
            let currentUrl = fetchUrl
            for (let hop = 0; hop <= 3; hop++) {
                await resolvePublicUrl(currentUrl)
                const imgResp = await fetch(currentUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
                    redirect: 'manual',
                    signal: controller.signal,
                })
                if ([301, 302, 303, 307, 308].includes(imgResp.status)) {
                    const loc = imgResp.headers.get('location')
                    await imgResp.body?.cancel().catch(() => {})
                    if (!loc) return null
                    currentUrl = new URL(loc, currentUrl).href
                    continue
                }
                if (!imgResp.ok) {
                    await imgResp.body?.cancel().catch(() => {})
                    return null
                }
                const declaredLen = Number(imgResp.headers.get('content-length'))
                if (Number.isFinite(declaredLen) && declaredLen > MAX_COVER_BYTES) {
                    await imgResp.body?.cancel().catch(() => {})
                    return null
                }
                const chunks: Buffer[] = []
                let totalBytes = 0
                if (imgResp.body) {
                    const reader = imgResp.body.getReader()
                    while (true) {
                        const { done, value } = await reader.read()
                        if (done) break
                        totalBytes += value.byteLength
                        if (totalBytes > MAX_COVER_BYTES) {
                            await reader.cancel().catch(() => {})
                            return null
                        }
                        chunks.push(Buffer.from(value))
                    }
                }
                const buf = Buffer.concat(chunks)
                if (buf.length === 0) return null
                // 读取上游真实的 Content-Type，兼容 jpeg、png、webp 等格式
                const upstreamCt = imgResp.headers.get('content-type')
                const ct = (upstreamCt && upstreamCt.startsWith('image/')) ? upstreamCt.split(';')[0].trim() : 'image/jpeg'
                return { buf, ct }
            }
            return null
        } catch (e) {
            console.error('[封面代理] 代理请求失败:', fetchUrl, (e as Error)?.message)
            return null
        } finally {
            res.off('close', onClose)
            if (timer) clearTimeout(timer)
            coverRelease()
        }
    }

    // 失败重试两次（限流常有短暂性），降低空白封面概率
    let result: { buf: Buffer, ct: string } | null = null
    for (let attempt = 0; attempt < 3 && !result; attempt++) {
        if (res.destroyed || res.writableEnded) return
        if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
        result = await doFetch(finalUrl)
    }

    // [回退] 改写尺寸后的 URL 未必被上游支持（实测腾讯对过小尺寸会返回空），
    // 此时改用原始 URL 再取一次，避免客户端要小图反而拿到空白封面
    if (!result && finalUrl !== picUrl) {
        for (let attempt = 0; attempt < 2 && !result; attempt++) {
            if (res.destroyed || res.writableEnded) return
            if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
            result = await doFetch(picUrl)
        }
    }

    if (result) {
        coverCacheSet(finalUrl, { ts: Date.now(), buf: result.buf, ct: result.ct })
        if (res.destroyed || res.writableEnded) return
        res.writeHead(200, {
            'Content-Type': result.ct,
            'Cache-Control': 'public, max-age=1800',
        })
        return res.end(result.buf)
    }

    // 回源彻底失败：若有过期缓存，降级返回避免封面彻底消失
    if (cached) {
        if (res.destroyed || res.writableEnded) return
        res.writeHead(200, {
            'Content-Type': cached.ct,
            'Cache-Control': 'public, max-age=300',
            'X-Cache': 'STALE',
        })
        return res.end(cached.buf)
    }

    if (!res.headersSent && !res.destroyed) {
        res.writeHead(204)
        res.end()
    }
}
