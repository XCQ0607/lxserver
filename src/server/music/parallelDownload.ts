import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { resolvePublicUrl } from '../auth/security'

const MIN_SIZE = 8 * 1024 * 1024
// Across all browser downloads, not four unbounded connections per task.
let active = 0
const waiting: Array<() => void> = []
async function slot() {
  if (active >= 8) await new Promise<void>(resolve => waiting.push(resolve))
  else active++
  return () => { const next = waiting.shift(); if (next) next(); else active-- }
}

type Options = {
  signal: AbortSignal
  progress: (received: number, total: number) => void
  resolve?: typeof resolvePublicUrl
}

/** Null means the upstream does not safely support parallel ranges. */
export async function downloadInRanges(input: string, options: Options): Promise<{ filePath: string; total: number; cleanup: () => void } | null> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal.reason)
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) abort()
  let file: fs.promises.FileHandle | undefined
  let dir: string | undefined
  const cleanup = () => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) }
  const request = async (target: string, method: string, range?: string, redirects = 0): Promise<http.IncomingMessage> => {
    controller.signal.throwIfAborted()
    if (redirects > 5) throw new Error('Too many redirects')
    const { url, address, family } = await (options.resolve || resolvePublicUrl)(target)
    return new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        method, agent: false, signal: controller.signal,
        lookup: (_host: string, opts: any, callback: any) => opts.all ? callback(null, [{ address, family }]) : callback(null, address, family),
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: url.origin, 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) },
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
          res.on('error', () => {})
          res.resume()
          request(new URL(res.headers.location, url).href, method, range, redirects + 1).then(resolve, reject)
        } else resolve(res)
      })
      req.setTimeout(30000, () => req.destroy(new Error('Upstream timeout')))
      req.on('error', reject)
      req.end()
    })
  }
  try {
    const releaseProbe = await slot()
    let head: http.IncomingMessage
    try { head = await request(input, 'HEAD') } finally { releaseProbe() }
    const total = Number(head.headers['content-length'])
    const etag = head.headers.etag
    const contentType = String(head.headers['content-type'] || '')
    const supported = head.statusCode === 200 && Number.isSafeInteger(total) && total >= MIN_SIZE &&
      head.headers['accept-ranges'] === 'bytes' && !head.headers['content-encoding'] &&
      (contentType.startsWith('audio/') || contentType.startsWith('application/octet-stream'))
    head.on('error', () => {})
    head.resume()
    if (!supported) return null
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-ranges-'))
    const filePath = path.join(dir, 'audio')
    file = await fs.promises.open(filePath, 'w+')
    await file.truncate(total)
    const received = [0, 0, 0, 0]
    const chunkSize = Math.ceil(total / 4)
    const jobs = Array.from({ length: 4 }, async (_, index) => {
      const release = await slot()
      try {
        const start = index * chunkSize, end = Math.min(total - 1, start + chunkSize - 1)
        for (let attempt = 0; attempt < 3; attempt++) {
          let response: http.IncomingMessage | undefined
          try {
            received[index] = 0
            response = await request(input, 'GET', `bytes=${start}-${end}`)
            if (response.statusCode !== 206 || response.headers['content-range'] !== `bytes ${start}-${end}/${total}` ||
                (etag && response.headers.etag !== etag) || response.headers['content-encoding']) {
              throw new Error('Invalid upstream range response')
            }
            let offset = start
            for await (const value of response) {
              const chunk = Buffer.from(value)
              if (offset + chunk.length > end + 1) throw new Error('Oversized upstream range')
              let written = 0
              while (written < chunk.length) {
                const result = await file!.write(chunk, written, chunk.length - written, offset + written)
                if (!result.bytesWritten) throw new Error('Unable to write download segment')
                written += result.bytesWritten
              }
              offset += chunk.length
              received[index] += chunk.length
              options.progress(received.reduce((a, b) => a + b, 0), total)
            }
            if (offset !== end + 1) throw new Error('Truncated upstream range')
            return
          } catch (error) {
            response?.destroy()
            controller.signal.throwIfAborted()
            if (attempt === 2) throw error
          }
        }
      } finally { release() }
    })
    // Cancel siblings before cleanup; never close the file while writes are pending.
    const guarded = jobs.map(job => job.catch(error => { controller.abort(error); throw error }))
    const results = await Promise.allSettled(guarded)
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    await file.close()
    file = undefined
    return { filePath, total, cleanup }
  } catch (error) {
    controller.abort(error)
    if (file) await file.close()
    cleanup()
    if (options.signal.aborted) throw error
    // Range ignored, mismatched or unstable: retry using the existing single stream.
    return null
  } finally { options.signal.removeEventListener('abort', abort) }
}
