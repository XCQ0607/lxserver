import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import { downloadInRanges } from '../src/server/music/parallelDownload'

const audio = Buffer.alloc(8 * 1024 * 1024 + 37)
for (let i = 0; i < audio.length; i++) audio[i] = i % 251

async function upstream(t: any, handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const address = server.address() as any
  const url = `http://localhost:${address.port}/audio`
  // Only these test servers permit loopback. Production retains resolvePublicUrl.
  const resolve = async (input: string) => ({ url: new URL(input), address: '127.0.0.1', family: 4 })
  return { url, resolve }
}

function head(req: http.IncomingMessage, res: http.ServerResponse, size = audio.length) {
  if (req.method !== 'HEAD') return false
  res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/flac', ETag: '"fixture"' })
  res.end()
  return true
}

test('four ranges reconstruct exact audio and retry only an interrupted segment', async t => {
  const attempts = new Map<string, number>()
  const { url, resolve } = await upstream(t, (req, res) => {
    if (head(req, res)) return
    const range = req.headers.range!
    attempts.set(range, (attempts.get(range) || 0) + 1)
    const [, a, b] = range.match(/bytes=(\d+)-(\d+)/)!
    const start = Number(a), end = Number(b)
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${audio.length}`, 'Content-Length': end - start + 1, ETag: '"fixture"' })
    if (start === 0 && attempts.get(range) === 1) {
      res.write(audio.subarray(0, 100))
      setImmediate(() => res.destroy())
    } else res.end(audio.subarray(start, end + 1))
  })
  let last = 0
  const result = await downloadInRanges(url, { resolve, signal: new AbortController().signal, progress(bytes, total) {
    assert.ok(bytes >= 0 && bytes <= total)
    last = bytes
  } })
  assert.ok(result)
  try {
    assert.deepEqual(fs.readFileSync(result.filePath), audio)
    assert.equal(last, audio.length)
    assert.equal(attempts.size, 4)
    assert.deepEqual([...attempts.values()].sort(), [1, 1, 1, 2])
  } finally { result.cleanup() }
  assert.equal(fs.existsSync(result.filePath), false)
})

test('ignored or incorrect ranges fall back without returning a corrupt file', async t => {
  for (const ignored of [true, false]) {
    const { url, resolve } = await upstream(t, (req, res) => {
      if (head(req, res)) return
      res.writeHead(ignored ? 200 : 206, { 'Content-Range': `bytes 0-0/${audio.length}`, ETag: '"fixture"' })
      res.end('x')
    })
    assert.equal(await downloadInRanges(url, { resolve, signal: new AbortController().signal, progress() {} }), null)
  }
})

test('small files skip ranges, cancellation rejects and stops sibling requests', async t => {
  let gets = 0
  const small = await upstream(t, (req, res) => {
    if (head(req, res, 1024)) return
    gets++; res.end()
  })
  assert.equal(await downloadInRanges(small.url, { resolve: small.resolve, signal: new AbortController().signal, progress() {} }), null)
  assert.equal(gets, 0)
  const controller = new AbortController()
  const large = await upstream(t, (req, res) => {
    if (head(req, res)) return
    const [, start, end] = req.headers.range!.match(/bytes=(\d+)-(\d+)/)!
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${audio.length}`, ETag: '"fixture"' })
    res.write(audio.subarray(0, 1024))
  })
  await assert.rejects(downloadInRanges(large.url, { resolve: large.resolve, signal: controller.signal, progress() { controller.abort(new Error('user cancelled')) } }), /cancelled|abort/i)
})

test('parallel tasks share the connection limit and revalidate redirect targets', async t => {
  let current = 0, maximum = 0, redirected = 0
  const { url, resolve } = await upstream(t, (req, res) => {
    if (req.url === '/audio') {
      redirected++
      res.writeHead(302, { Location: '/actual' }); res.end(); return
    }
    if (head(req, res)) return
    current++; maximum = Math.max(maximum, current)
    res.once('close', () => current--)
    const [, a, b] = req.headers.range!.match(/bytes=(\d+)-(\d+)/)!
    const start = Number(a), end = Number(b)
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${audio.length}`, ETag: '"fixture"' })
    setTimeout(() => res.end(audio.subarray(start, end + 1)), 10)
  })
  let validatedRedirects = 0
  const results = await Promise.all(Array.from({ length: 3 }, () => downloadInRanges(url, {
    signal: new AbortController().signal, progress() {},
    resolve: async input => { if (new URL(input).pathname === '/actual') validatedRedirects++; return resolve(input) },
  })))
  try {
    assert.ok(maximum > 1 && maximum <= 8, `peak connections: ${maximum}`)
    assert.equal(validatedRedirects, redirected)
    for (const result of results) {
      assert.ok(result)
      assert.deepEqual(fs.readFileSync(result.filePath), audio)
    }
  } finally { results.forEach(result => result?.cleanup()) }
})
