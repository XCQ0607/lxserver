import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import path from 'node:path'

// This trial allows one active capture and at most two unresolved finalization
// reservations per process. It never owns or backpressures the media response.
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024
const MAX_PENDING_BYTES = 256 * 1024
const IDLE_TIMEOUT_MS = 20_000
const CAPTURE_TIMEOUT_MS = 120_000
const FINALIZE_TIMEOUT_MS = 10_000
const MAX_PENDING_FINALIZATIONS = 2
let pendingFinalizations = 0
let active: symbol | undefined
const attached = new WeakSet<IncomingMessage>()

export interface ReadThroughCapture {
  tempPath: string
  bytes: number
  signal?: AbortSignal
}

interface ReadThroughCaptureOptions {
  /** Existing private directory outside ordinary media/index scans. */
  stagingDir: string
  maxBytes?: number
  signal?: AbortSignal
  /** Verify audio independently; honor capture.signal immediately before committing. */
  publish: (capture: ReadThroughCapture) => Promise<void> | void
}

type ResponseMetadata = { statusCode?: number; headers: IncomingHttpHeaders }

function eligibleLength({ statusCode, headers }: ResponseMetadata, maxBytes = MAX_CAPTURE_BYTES): number | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return null
  if (statusCode !== 200 && statusCode !== 206) return null
  if (headers['transfer-encoding']) return null
  if (headers['content-encoding'] && String(headers['content-encoding']).trim().toLowerCase() !== 'identity') return null
  if (String(headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'audio/mpeg') return null
  const length = headers['content-length']
  if (typeof length !== 'string' || !/^\d+$/.test(length)) return null
  const bytes = Number(length)
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > Math.min(maxBytes, MAX_CAPTURE_BYTES)) return null
  const contentRange = headers['content-range']
  if (statusCode === 206) {
    const range = typeof contentRange === 'string' && contentRange.match(/^bytes 0-(\d+)\/(\d+)$/i)
    if (!range || Number(range[1]) !== bytes - 1 || Number(range[2]) !== bytes) return null
  } else if (contentRange) return null
  return bytes
}

/** Header-only admission for one complete, identity-encoded response. */
export function canCaptureReadThrough(upstream: ResponseMetadata, maxBytes?: number): boolean {
  return eligibleLength(upstream, maxBytes) !== null
}

// Cheap content sniff, not a decoder. Require a valid Layer III frame header
// at the leading audio boundary, skipping a bounded ID3v2 tag if present.
function makePrefixCheck(length: number) {
  const prefix = Buffer.alloc(10)
  let needed = 4, collected = 0, skip = 0, allowTag = true, recognized = false
  return {
    get recognized() { return recognized },
    accept(chunk: Buffer): boolean {
      let offset = 0
      while (offset < chunk.length && !recognized) {
        if (skip) {
          const skipped = Math.min(skip, chunk.length - offset)
          offset += skipped
          skip -= skipped
          if (skip > 0) break
        }
        const toCopy = Math.min(needed - collected, chunk.length - offset)
        chunk.copy(prefix, collected, offset, offset + toCopy)
        collected += toCopy
        offset += toCopy
        if (collected < needed) break
        if (allowTag && needed === 4 && prefix[0] === 0x49 && prefix[1] === 0x44 && prefix[2] === 0x33) {
          needed = 10
          continue
        }
        if (needed === 10) {
          if (prefix[3] < 2 || prefix[3] > 4 || prefix[4] === 0xff) return false
          if (prefix.subarray(6, 10).some(value => value >= 128)) return false
          const size = (prefix[6] << 21) | (prefix[7] << 14) | (prefix[8] << 7) | prefix[9]
          skip = size + (prefix[3] === 4 && (prefix[5] & 0x10) ? 10 : 0)
          if (10 + skip + 4 > length) return false
          needed = 4
          collected = 0
          allowTag = false
          continue
        }
        const bitrate = prefix[2] >> 4
        if (prefix[0] !== 0xff || (prefix[1] & 0xe0) !== 0xe0 || (prefix[1] & 0x18) === 0x08 ||
            (prefix[1] & 0x06) !== 0x02 || bitrate === 0 || bitrate === 15 || (prefix[2] & 0x0c) === 0x0c) return false
        recognized = true
      }
      return true
    },
  }
}

/**
 * Tap an unread response synchronously before piping it to the media client.
 * The caller must supply the existing media pipe in the same turn. This tap
 * never pauses, drains, destroys or retries the upstream or the media client.
 */
export function attachReadThroughCapture(upstream: IncomingMessage, options: ReadThroughCaptureOptions): boolean {
  const length = eligibleLength(upstream, options.maxBytes)
  if (length === null || active || pendingFinalizations >= MAX_PENDING_FINALIZATIONS || options.signal?.aborted || attached.has(upstream) ||
      upstream.destroyed || upstream.readableDidRead || upstream.readableEnded) return false
  const expected = length

  let tempPath: string
  let sink: ReturnType<typeof createWriteStream>
  try {
    tempPath = path.join(options.stagingDir, `.lx-readthrough-${randomBytes(16).toString('hex')}.part`)
    sink = createWriteStream(tempPath, { flags: 'wx', mode: 0o600, highWaterMark: MAX_PENDING_BYTES })
  } catch { return false }
  const reservation = Symbol()
  active = reservation
  attached.add(upstream)

  let rejected = false, ended = false, ownsTemp = false, received = 0
  const prefix = makePrefixCheck(expected)
  const stopReading = () => {
    upstream.off('data', onData)
    upstream.off('end', onEnd)
    upstream.off('error', reject)
    upstream.off('aborted', reject)
    upstream.off('close', reject)
  }
  const reject = () => {
    if (rejected) return
    rejected = true
    stopReading()
    sink.destroy()
  }
  const idle = setTimeout(reject, IDLE_TIMEOUT_MS).unref()
  const limit = setTimeout(reject, CAPTURE_TIMEOUT_MS).unref()

  function onData(chunk: Buffer) {
    if (!Buffer.isBuffer(chunk) || received + chunk.length > expected ||
        sink.writableLength + chunk.length >= MAX_PENDING_BYTES || !prefix.accept(chunk)) {
      reject()
      return
    }
    received += chunk.length
    idle.refresh()
    // This sink is not in the playback pipe. Drop instead of waiting for drain.
    if (!sink.write(chunk)) reject()
  }

  function onEnd() {
    if (!upstream.complete || received !== expected || !prefix.recognized) {
      reject()
      return
    }
    ended = true
    stopReading()
    sink.end()
  }

  sink.once('open', () => { ownsTemp = true })
  sink.on('error', reject)
  sink.once('close', () => {
    clearTimeout(idle)
    clearTimeout(limit)
    stopReading()
    pendingFinalizations++
    void (async () => {
      let publicationFinished = true, removed = !ownsTemp, reservationReleased = false
      const releasePending = () => {
        if (!reservationReleased && publicationFinished && removed) {
          reservationReleased = true
          pendingFinalizations--
        }
      }
      const expires = Date.now() + FINALIZE_TIMEOUT_MS
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined
      const lifetime = new AbortController()
      const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal
      let onStop!: () => void
      const stopped = new Promise<void>(resolve => {
        onStop = resolve
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', onStop, { once: true })
      })
      // This deadline covers publication AND cleanup. A late publication is
      // invalidated by its signal before the reservation can be reused.
      const deadline = setTimeout(() => lifetime.abort(), FINALIZE_TIMEOUT_MS).unref()
      try {
        if (!rejected && ended && ownsTemp && sink.writableFinished && !signal.aborted) {
          publicationFinished = false
          const publication = Promise.resolve().then(() => options.publish({ tempPath, bytes: received, signal }))
            .finally(() => { publicationFinished = true; releasePending() })
          await Promise.race([publication, stopped])
        }
      } catch { /* Staging/verification failure does not affect the media pipe. */ }
      finally {
        lifetime.abort()
        options.signal?.removeEventListener('abort', reject)
        // Do not accumulate unlimited spools if filesystem cleanup itself stalls.
        // Retain a reservation until publication has settled AND unlink has
        // succeeded, even if the active capture slot was released on deadline.
        const cleanup = (ownsTemp ? unlink(tempPath).then(() => { removed = true }).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') removed = true
        }) : Promise.resolve()).finally(releasePending)
        // lifetime is now aborted, so use the independent wall-clock deadline
        // for cleanup rather than the already-resolved publication stop signal.
        const cleanupDeadline = new Promise<void>(resolve => {
          if (Date.now() >= expires) resolve()
          else cleanupTimer = setTimeout(resolve, expires - Date.now()).unref()
        })
        await Promise.race([cleanup, cleanupDeadline])
        clearTimeout(deadline)
        if (cleanupTimer) clearTimeout(cleanupTimer)
        signal.removeEventListener('abort', onStop)
        if (active === reservation) active = undefined
      }
    })()
  })
  options.signal?.addEventListener('abort', reject, { once: true })
  upstream.once('end', onEnd)
  upstream.once('aborted', reject)
  upstream.once('error', reject)
  upstream.once('close', reject)
  upstream.on('data', onData)
  return true
}
