import crypto from 'node:crypto'
import sharp from 'sharp'

type Cover = { data: Buffer, mime?: string }
const cache = new Map<string, Cover>()
const pending = new Map<string, Promise<Cover>>()
const MAX_BYTES = 16 * 1024 * 1024
let cachedBytes = 0
let active = 0
const waiters: Array<() => void> = []

/** Call only after the source cover has passed its usual authorization/path checks. */
export async function coverThumbnail(cover: Cover, requestedSize: string | null): Promise<Cover> {
  const requested = Number(requestedSize)
  if (!Number.isFinite(requested) || requested <= 0 || cover.data.length > 16 * 1024 * 1024) return cover
  const size = [96, 192, 384, 768].find(bucket => bucket >= requested) || 768
  const key = crypto.createHash('sha256').update(cover.data).update(String(size)).digest('hex')
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  if (pending.has(key)) return pending.get(key)!
  // Do not accumulate an unbounded decoder queue under thumbnail request floods.
  if (pending.size >= 32) return cover
  const result = (async () => {
    if (active >= 2) await new Promise<void>(resolve => waiters.push(resolve))
    else active++
    try {
      const data = await sharp(cover.data, { limitInputPixels: 32 * 1024 * 1024, animated: false })
        .rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 }).toBuffer()
      const thumb = { data, mime: 'image/webp' }
      while (cache.size && cachedBytes + data.length > MAX_BYTES) {
        const oldest = cache.keys().next().value!
        cachedBytes -= cache.get(oldest)!.data.length
        cache.delete(oldest)
      }
      if (data.length <= MAX_BYTES) { cache.set(key, thumb); cachedBytes += data.length }
      return thumb
    } catch {
      return cover // Preserve artwork for unsupported or damaged embedded images.
    } finally {
      const next = waiters.shift()
      if (next) next()
      else active--
    }
  })()
  pending.set(key, result)
  try { return await result } finally { pending.delete(key) }
}
