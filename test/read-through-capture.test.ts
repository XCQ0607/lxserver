import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { createServer, get, type IncomingMessage } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test, { type TestContext } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { attachReadThroughCapture, canCaptureReadThrough } from '../src/server/music/readThroughCapture'

const frame = Buffer.alloc(417)
frame.set([0xff, 0xfb, 0x90, 0x64]) // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
const audio = Buffer.concat(Array.from({ length: 4 }, () => frame))

const response = (statusCode = 200, extraHeaders: Record<string, string | undefined> = {}) => {
  return Object.assign(new PassThrough(), {
    statusCode, complete: false,
    headers: { 'content-type': 'audio/mpeg', 'content-length': String(audio.length), ...extraHeaders },
  }) as unknown as IncomingMessage & PassThrough
}

const temporary = async (t: TestContext) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lx-read-through-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const until = async (predicate: () => Promise<boolean>) => {
  for (let i = 0; i < 120; i++) {
    if (await predicate()) return
    await delay(5)
  }
  assert.fail('Expected async staging state not reached')
}

const receive = (upstream: IncomingMessage) => {
  const consumer = new PassThrough()
  const chunks: Buffer[] = []
  consumer.on('data', chunk => chunks.push(chunk))
  const forwarded = once(consumer, 'end').then(() => Buffer.concat(chunks))
  upstream.pipe(consumer)
  return forwarded
}

test('only a complete known-length MPEG response is eligible; Range, format and size gates are strict', () => {
  assert.equal(canCaptureReadThrough(response()), true)
  assert.equal(canCaptureReadThrough(response(206, { 'content-range': `bytes 0-${audio.length - 1}/${audio.length}` })), true)
  assert.equal(canCaptureReadThrough(response(206, { 'content-range': `bytes 0-${audio.length - 1}/${audio.length + 9}` })), false)
  assert.equal(canCaptureReadThrough(response(206, { 'content-range': `bytes 1-${audio.length}/${audio.length + 1}` })), false)
  assert.equal(canCaptureReadThrough(response(200, { 'content-range': `bytes 0-${audio.length - 1}/${audio.length}` })), false)
  assert.equal(canCaptureReadThrough(response(200, { 'content-encoding': 'gzip' })), false)
  assert.equal(canCaptureReadThrough(response(200, { 'content-length': '1e6' })), false)
  assert.equal(canCaptureReadThrough(response(200, { 'content-length': undefined })), false)
  assert.equal(canCaptureReadThrough(response(200, { 'content-type': 'application/octet-stream' })), false)
  assert.equal(canCaptureReadThrough(response(200, { 'transfer-encoding': 'chunked' })), false)
  assert.equal(canCaptureReadThrough(response(200, { 'content-length': String(33 * 1024 ** 2) }), Infinity), false)
  assert.equal(canCaptureReadThrough(response(), audio.length - 1), false)
})

test('one full 206 is forwarded unchanged and staged privately once; publication failure leaves no temporary file', async t => {
  const dir = await temporary(t)
  const titleTag = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0x20, 0]), Buffer.alloc(4096)])
  const bytes = Buffer.concat([titleTag, audio])
  const upstream = response(206, { 'content-length': String(bytes.length), 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` })
  let inspected = 0
  const options = {
    stagingDir: dir,
    publish: async ({ tempPath, bytes: length }: { tempPath: string; bytes: number }) => {
      assert.match(path.basename(tempPath), /^\.lx-readthrough-[a-f0-9]{32}\.part$/)
      assert.equal(length, bytes.length)
      assert.deepEqual(await readFile(tempPath), bytes)
      if (process.platform !== 'win32') assert.equal((await stat(tempPath)).mode & 0o777, 0o600)
      inspected++
      throw new Error('Independent verification rejected this fixture')
    },
  }
  assert.equal(attachReadThroughCapture(upstream, options), true)
  assert.equal(attachReadThroughCapture(upstream, options), false)
  const forwarded = receive(upstream)
  for (const edge of [[0, 2], [2, 7], [7, 908], [908, titleTag.length + 2], [titleTag.length + 2, bytes.length]]) {
    upstream.write(bytes.subarray(...edge as [number, number]))
  }
  upstream.complete = true
  upstream.end()
  assert.deepEqual(await forwarded, bytes)
  await until(async () => inspected === 1 && (await readdir(dir)).length === 0)
})

test('wrong media, incomplete bodies or a client abort do not publish and do not stop the playback consumer', async t => {
  const dir = await temporary(t)
  let published = 0
  const controller = new AbortController()
  for (const [bytes, complete, cancel] of [
    [Buffer.alloc(audio.length, 'x'), true, false],
    [audio.subarray(0, audio.length - 5), true, false],
    [audio, false, false],
    [audio, true, true],
  ] as const) {
    const upstream = response()
    assert.equal(attachReadThroughCapture(upstream, { stagingDir: dir, signal: controller.signal, publish: () => { published++ } }), true)
    const forwarded = receive(upstream)
    await until(async () => (await readdir(dir)).length === 1)
    if (cancel) controller.abort()
    upstream.complete = complete
    upstream.end(bytes)
    assert.deepEqual(await forwarded, bytes)
    await until(async () => (await readdir(dir)).length === 0)
    assert.equal(published, 0)
  }
})

test('disk-stage errors and a chunk above the short write buffer never slow or fail playback', async t => {
  const dir = await temporary(t)
  let published = 0
  const bytes = Buffer.alloc(300 * 1024)
  bytes.set(audio)
  for (const stagingDir of [dir, path.join(dir, 'missing')]) {
    const upstream = response(200, { 'content-length': String(bytes.length) })
    assert.equal(attachReadThroughCapture(upstream, { stagingDir, publish: () => { published++ } }), true)
    const forwarded = receive(upstream)
    if (stagingDir === dir) await until(async () => (await readdir(stagingDir)).length === 1)
    upstream.complete = true
    upstream.end(bytes)
    assert.deepEqual(await forwarded, bytes)
    await until(async () => (await readdir(dir)).length === 0)
    assert.equal(published, 0)
  }
})

test('one global capture slot is bounded and an already-aborted capture writes nothing', async t => {
  const dir = await temporary(t)
  const upstream = response()
  const controller = new AbortController()
  const options = { stagingDir: dir, signal: controller.signal, publish: () => assert.fail('not expected to publish') }
  assert.equal(attachReadThroughCapture(upstream, options), true)
  assert.equal(attachReadThroughCapture(response(), options), false)
  await until(async () => (await readdir(dir)).length === 1)
  controller.abort()
  await until(async () => (await readdir(dir)).length === 0)
  assert.equal(attachReadThroughCapture(response(), options), false)
  upstream.destroy()
})

test('an abort after EOF but before the asynchronous spool closes suppresses publication', async t => {
  const dir = await temporary(t)
  const upstream = response()
  const controller = new AbortController()
  let published = false
  assert.equal(attachReadThroughCapture(upstream, { stagingDir: dir, signal: controller.signal, publish: () => { published = true } }), true)
  // The capture has observed EOF and queued its final disk write at this point.
  upstream.once('end', () => controller.abort())
  const forwarded = receive(upstream)
  await until(async () => (await readdir(dir)).length === 1)
  upstream.complete = true
  upstream.end(audio)
  assert.deepEqual(await forwarded, audio)
  await until(async () => (await readdir(dir)).length === 0)
  assert.equal(published, false)
})

test('a real relay forwards native Range unchanged and publishes from one upstream GET', async t => {
  const dir = await temporary(t)
  let requests = 0
  const source = createServer((req, res) => {
    requests++
    assert.equal(req.headers.range, 'bytes=0-')
    res.writeHead(206, {
      'Content-Type': 'audio/mpeg', 'Content-Length': audio.length,
      'Content-Range': `bytes 0-${audio.length - 1}/${audio.length}`,
    })
    res.end(audio)
  })
  source.listen(0, '127.0.0.1')
  await once(source, 'listening')
  t.after(() => { source.close() })
  const upstreamAddress = source.address()
  assert.ok(upstreamAddress && typeof upstreamAddress === 'object')
  let published: Buffer | undefined
  const relay = createServer((req, res) => {
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableFinished) controller.abort() })
    get({ hostname: '127.0.0.1', port: upstreamAddress.port, headers: { Range: req.headers.range } }, upstream => {
      res.writeHead(upstream.statusCode || 500, upstream.headers)
      assert.equal(attachReadThroughCapture(upstream, {
        stagingDir: dir, signal: controller.signal, publish: async ({ tempPath }) => { published = await readFile(tempPath) },
      }), true)
      upstream.pipe(res)
    }).on('error', error => res.destroy(error))
  })
  relay.listen(0, '127.0.0.1')
  await once(relay, 'listening')
  t.after(() => { relay.close() })
  const relayAddress = relay.address()
  assert.ok(relayAddress && typeof relayAddress === 'object')

  const forwarded = await fetch(`http://127.0.0.1:${relayAddress.port}/`, { headers: { Range: 'bytes=0-' } })
  assert.equal(forwarded.status, 206)
  assert.equal(forwarded.headers.get('content-range'), `bytes 0-${audio.length - 1}/${audio.length}`)
  assert.deepEqual(Buffer.from(await forwarded.arrayBuffer()), audio)
  await until(async () => !!published && (await readdir(dir)).length === 0)
  assert.deepEqual(published, audio)
  assert.equal(requests, 1)
})
