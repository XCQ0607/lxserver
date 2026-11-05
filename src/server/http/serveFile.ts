import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const parseByteRange = (header: string, size: number): { start: number; end: number } | null => {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) return null
  const suffix = !match[1]
  const first = Number(suffix ? match[2] : match[1])
  const last = match[2] && !suffix ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || (suffix && first === 0)) return null
  const start = suffix ? Math.max(0, size - first) : first
  const end = suffix ? size - 1 : Math.min(last, size - 1)
  return start < size && start <= end ? { start, end } : null
}

export const serveFile = (req: IncomingMessage, res: ServerResponse, filename: string, contentType: string) => {
  let stat: fs.Stats
  try { stat = fs.statSync(filename) } catch { res.writeHead(404); res.end(); return }
  if (!stat.isFile()) { res.writeHead(404); res.end(); return }
  const headers: Record<string, string | number> = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes' }
  // Range has no meaning for HEAD; report the full representation without opening it.
  const range = req.method !== 'HEAD' && req.headers.range ? parseByteRange(req.headers.range, stat.size) : undefined
  if (range === null) {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': 0 })
    res.end()
    return
  }
  headers['Content-Length'] = range ? range.end - range.start + 1 : stat.size
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`
  res.writeHead(range ? 206 : 200, headers)
  if (req.method === 'HEAD' || stat.size === 0) { res.end(); return }
  const stream = fs.createReadStream(filename, range || undefined)
  const cleanup = () => stream.destroy()
  res.once('close', cleanup)
  stream.once('close', () => res.removeListener('close', cleanup))
  stream.once('error', () => res.destroy())
  stream.pipe(res)
}
