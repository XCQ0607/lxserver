import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { setImmediate as flush } from 'node:timers/promises'
import { createSimilarSongResolver, fetchSimilarSongs, type SimilarDeps } from '../src/server/utils/similarSongs'
import { sourceRequestSignal } from '../src/server/sources/requestScope'

const seed = { source: 'tx', songId: 42, name: 'Seed', singer: 'Seed Artist' }
const radio = (n: number) => Array.from({ length: n }, (_, i) => ({ name: 'Track ' + i, singer: 'Band ' + i, duration: 210 }))
const hit = (i: number) => ({ source: 'tx', songmid: 'm' + i, name: 'Track ' + i, singer: 'Band ' + i, interval: '03:30' })
const never = () => new Promise<never>(() => {})
const deps = (options: Partial<SimilarDeps>): SimilarDeps => ({
  radio: async () => [], txSimilar: async () => [], search: async () => [], shuffle: list => [...list], ...options,
})

function clock(t: TestContext) {
  let now = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(performance, 'now', () => now)
  return async (ms: number) => { now += ms; t.mock.timers.tick(ms); await flush() }
}

test('ready radio tracks survive a hung lookup in provider rank order and stale completions cannot dispatch more work', async t => {
  const tick = clock(t)
  let release!: () => void
  let stalled: AbortSignal | undefined
  let finishEarlyMatch!: () => void
  const calls: string[] = []
  let result: Awaited<ReturnType<typeof fetchSimilarSongs>> | undefined
  const request = fetchSimilarSongs(seed, 30, deps({
    radio: async () => radio(6),
    search: async (source, keyword) => {
      calls.push(source + ':' + keyword)
      const i = Number(keyword.match(/^Track (\d+) /)?.[1])
      if (i === 5) {
        stalled = sourceRequestSignal()
        await new Promise<void>(r => { release = r })
        return []
      }
      if (i === 0) await new Promise<void>(r => { finishEarlyMatch = r })
      return [hit(i)]
    },
  })).then(value => { result = value })
  await flush()
  finishEarlyMatch()
  await flush()
  assert.equal(result, undefined)
  await tick(700)
  assert.deepEqual(result?.list.map(item => item.name), radio(5).map(item => item.name))
  assert.equal(stalled?.aborted, true)
  const count = calls.length
  release()
  await request
  await flush()
  assert.equal(calls.length, count)
})

test('even one ready radio track is not held for a stalled QQ or artist top-up', async t => {
  const tick = clock(t)
  const blocked: AbortSignal[] = []
  const wait = async () => { blocked.push(sourceRequestSignal()!); return never() }
  let result: Awaited<ReturnType<typeof fetchSimilarSongs>> | undefined
  void fetchSimilarSongs(seed, 30, deps({
    radio: async () => radio(1),
    search: async (_source, keyword) => keyword === 'Track 0 Band 0' ? [hit(0)] : wait(),
    txSimilar: wait,
  })).then(value => { result = value })
  await flush()
  assert.equal(result, undefined)
  await tick(300)
  assert.deepEqual(result?.list.map(item => item.name), ['Track 0'])
  assert.ok(blocked.length && blocked.every(s => s?.aborted))
})

test('radio, QQ seed lookup and artist fallback share an overall deadline', async t => {
  const tick = clock(t)
  const signals: AbortSignal[] = []
  let qqLaunched = false, releaseLookup!: () => void
  let result: Awaited<ReturnType<typeof fetchSimilarSongs>> | undefined
  void fetchSimilarSongs({ ...seed, source: 'wy' }, 30, deps({
    radio: async () => { signals.push(sourceRequestSignal()!); return never() },
    search: async (_source, keyword) => {
      signals.push(sourceRequestSignal()!)
      if (keyword === 'Seed Seed Artist') { await new Promise<void>(r => { releaseLookup = r }); return [ { ...hit(0), songId: 101, name: 'Seed', singer: 'Seed Artist' } ] }
      return never()
    },
    txSimilar: async () => { qqLaunched = true; return [] },
  })).then(value => { result = value })
  await flush()
  await tick(5500)
  await tick(1400)
  await tick(600)
  assert.deepEqual(result, { list: [], strategy: 'none' })
  assert.equal(signals.length, 3)
  assert.ok(signals.every(s => s?.aborted))
  releaseLookup()
  await flush()
  assert.equal(qqLaunched, false)
})

test('returning a radio batch closes the stalled SDK transport, not just its waiter', { timeout: 5000 }, async t => {
  const { httpFetch } = await import('../src/modules/utils/request.js')
  let started!: () => void, closed!: () => void
  const requested = new Promise<void>(resolve => { started = resolve })
  const disconnected = new Promise<void>(resolve => { closed = resolve })
  const server = http.createServer((_req, res) => { res.once('close', closed); started() })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') assert.fail('expected loopback TCP address')
  const result = await fetchSimilarSongs(seed, 30, deps({
    radio: async () => radio(6),
    search: async (_source, keyword) => {
      const i = Number(keyword.match(/^Track (\d+) /)?.[1])
      if (i === 0) { await httpFetch('http://127.0.0.1:' + address.port + '/metadata').promise; return [] }
      await requested
      return [hit(i)]
    },
  }))
  assert.deepEqual(result.list.map(item => item.name), radio(6).slice(1).map(item => item.name))
  await disconnected
})

test('five stalled primary lookups release their slots for the ready alternate before the radio deadline', async t => {
  const tick = clock(t)
  const primary: AbortSignal[] = []
  let alternates = 0, active = 0, peak = 0
  const result = fetchSimilarSongs({ ...seed, source: 'kw' }, 5, deps({
    radio: async () => radio(5),
    search: async (source, keyword) => {
      const i = Number(keyword.match(/^Track (\d+) /)?.[1])
      if (!Number.isFinite(i)) return []
      peak = Math.max(peak, ++active)
      if (source === 'kw') {
        const signal = sourceRequestSignal()!
        primary.push(signal)
        signal.addEventListener('abort', () => { active-- }, { once: true })
        return never()
      }
      alternates++
      active--
      return [hit(i)]
    },
  }))
  await flush()
  assert.equal(primary.length, 5)
  await tick(1100)
  const r = await result
  assert.equal(r.strategy, 'radio')
  assert.equal(r.list.length, 5)
  assert.equal(r.incomplete, undefined)
  assert.equal(alternates, 5)
  assert.ok(primary.every(signal => signal.aborted))
  assert.equal(peak, 5)
})

test('let a slower top-ranked match finish ahead of fast tail matches', async t => {
  const tick = clock(t)
  const request = fetchSimilarSongs(seed, 12, deps({
    radio: async () => radio(12),
    search: async (_source, keyword) => {
      const i = Number(keyword.match(/^Track (\d+) /)?.[1])
      if (i < 4) await new Promise(r => setTimeout(r, 900))
      return [hit(i)]
    },
  }))
  await flush()
  await tick(650)
  await tick(250)
  const r = await request
  assert.deepEqual(r.list.map(s => s.name), radio(12).map(s => s.name))
  assert.equal(r.incomplete, undefined)
})

test('even a large deadline-truncated pool expires and recovers its top ranks in one minute', async t => {
  const tick = clock(t)
  let recovered = false, calls = 0, now = 1000
  t.mock.method(Date, 'now', () => now)
  const lookup = createSimilarSongResolver(deps({
    radio: async () => { calls++; return radio(12) },
    search: async (_source, keyword) => {
      const i = Number(keyword.match(/^Track (\d+) /)?.[1])
      if (i < 4 && !recovered) return never()
      return [hit(i)]
    },
  }))
  const first = lookup(seed, 12)
  await flush()
  await tick(650)
  await tick(450)
  await tick(200)
  const r = await first
  assert.equal(r.incomplete, true)
  assert.deepEqual(r.list.map(s => s.name), radio(12).slice(4).map(s => s.name))
  recovered = true
  now += 30_000
  assert.deepEqual(await lookup(seed, 12), r)
  assert.equal(calls, 1)
  now += 31_000
  const restored = await lookup(seed, 12)
  assert.equal(restored.incomplete, undefined)
  assert.deepEqual(restored.list.map(s => s.name), radio(12).map(s => s.name))
  assert.equal(calls, 2)
  now += 120_000
  await lookup(seed, 12)
  assert.equal(calls, 2, 'complete pool uses normal TTL')
})

test('limit=1 keeps looking for a playable related track instead of returning unrelated catalog', async () => {
  const tracks = radio(30), calls = new Set<string>()
  const run = async (ready: number) => fetchSimilarSongs(seed, 1, deps({
    radio: async () => tracks,
    search: async (_source, keyword) => {
      const m = keyword.match(/^Track (\d+) /)
      if (!m) return []
      calls.add(m[1])
      return Number(m[1]) === ready ? [hit(ready)] : []
    },
  }))
  assert.deepEqual((await run(1)).list.map(s => s.name), ['Track 1'])
  assert.deepEqual([...calls], ['0', '1'], 'do not dispatch the lookahead gratuitously')
  calls.clear()
  assert.deepEqual((await run(-1)).list, [])
  assert.equal(calls.size, 6, 'bounded one extra wave')
})
