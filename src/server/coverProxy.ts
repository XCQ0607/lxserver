import http from 'http'

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
function coverCacheSet(key: string, val: { ts: number, buf: Buffer, ct: string }) {
    coverImageCache.set(key, val)
    // 容量上限：超出时淘汰最旧条目，避免长期运行 Buffer 堆积导致 OOM 崩溃
    if (coverImageCache.size > COVER_CACHE_MAX) {
        const oldest = coverImageCache.keys().next().value
        if (oldest !== undefined) coverImageCache.delete(oldest)
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
 * 代理并返回一张封面图片。
 * - 命中新鲜缓存直接返回（X-Cache: HIT）
 * - 否则经信号量限流回源抓取，失败重试 3 次
 * - 全部失败且有过期缓存则降级返回（X-Cache: STALE），否则返回 204
 */
export async function proxyCoverImage(res: http.ServerResponse, picUrl: string) {
    const now = Date.now()
    const cached = coverImageCache.get(picUrl)
    // 命中新鲜缓存直接返回，避免重复回源被图片 CDN 限流
    if (cached && now - cached.ts < COVER_CACHE_TTL) {
        res.writeHead(200, {
            'Content-Type': cached.ct,
            'Cache-Control': 'public, max-age=1800',
            'X-Cache': 'HIT',
        })
        return res.end(cached.buf)
    }

    const doFetch = async (): Promise<{ buf: Buffer, ct: string } | null> => {
        if (res.destroyed || res.writableEnded) return null
        await coverAcquire()
        try {
            if (res.destroyed || res.writableEnded) return null
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 20000)
            const imgResp = await fetch(picUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
                signal: controller.signal,
            })
            clearTimeout(timer)
            if (!imgResp.ok) return null
            const buf = Buffer.from(await imgResp.arrayBuffer())
            if (buf.length === 0) return null
            // 读取上游真实的 Content-Type，兼容 jpeg、png、webp 等格式
            const upstreamCt = imgResp.headers.get('content-type')
            const ct = (upstreamCt && upstreamCt.startsWith('image/')) ? upstreamCt.split(';')[0].trim() : 'image/jpeg'
            return { buf, ct }
        } catch (e) {
            console.error('[CoverArt] proxy fetch failed:', picUrl, (e as Error)?.message)
            return null
        } finally {
            coverRelease()
        }
    }

    // 失败重试两次（限流常有短暂性），降低空白封面概率
    let result: { buf: Buffer, ct: string } | null = null
    for (let attempt = 0; attempt < 3 && !result; attempt++) {
        if (res.destroyed || res.writableEnded) return
        if (attempt > 0) await new Promise(r => setTimeout(r, 800 * attempt))
        result = await doFetch()
    }

    if (result) {
        coverCacheSet(picUrl, { ts: Date.now(), buf: result.buf, ct: result.ct })
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
