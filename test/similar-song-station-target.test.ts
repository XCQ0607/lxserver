import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { setImmediate as flush } from 'node:timers/promises'
import { createSimilarSongResolver, type SimilarDeps } from '../src/server/utils/similarSongs'
import { sourceRequestSignal } from '../src/server/sources/requestScope'

const seed = { source: 'tx', songId: 42, name: 'Seed', singer: 'Seed Artist' }
const track = (i: number) => ({ name: 'Track ' + i, singer: 'Band ' + i, duration: 210 })
const hit = (i: number) => ({ ...track(i), source: 'tx', songmid: 'm' + i, interval: '03:30' })
const never = () => new Promise<never>(() => {})
const knownTrack = (keyword: string) => Number(/^Track (\d+) /.exec(keyword)?.[1])
const deps = (overrides: Partial<SimilarDeps>): SimilarDeps => ({
  radio: async () => [], txSimilar: async () => [], search: async () => [], shuffle: list => [...list], ...overrides,
})

function clock(t: TestContext) {
  let now = 0
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(performance, 'now', () => now)
  return async (ms: number) => { now += ms; t.mock.timers.tick(ms); await flush() }
}

test('explicit station continues past ordinary first-match grace without sharing the thin cache', async t => {
  const tick = clock(t)
  let release!: () => void, rounds = 0, qqCalls = 0
  const tail = new Promise<void>(resolve => { release = resolve })
  const lookup = createSimilarSongResolver(deps({
    radio: async () => { rounds++; return Array.from({ length: 29 }, (_, i) => track(i)) },
    search: async (_source, q) => {
      const i = knownTrack(q)
      if (!Number.isFinite(i)) return []
      if (i >= 5) await tail
      return [hit(i)]
    },
    txSimilar: async () => { qqCalls++; return [] },
  }))
  const ordinary = lookup(seed, 48)
  await flush()
  await tick(651)
  assert.equal((await ordinary).list.length, 5)
  assert.equal(rounds, 1)
  assert.equal((await lookup(seed, 48, undefined, { target: NaN })).list.length, 5)
  assert.equal(rounds, 1, 'invalid targets fall back to the ordinary lookup')
  let filled
  const station = lookup(seed, 48, undefined, { target: 24 }).then(result => { filled = result; return result })
  await flush()
  await tick(651)
  assert.equal(filled, undefined, 'the station must not settle at the ordinary cutoff')
  assert.equal(rounds, 2, 'explicit station gets its own lookup/cache key')
  release()
  const result = await station
  assert.equal(result.strategy, 'radio')
  assert.equal(result.incomplete, undefined)
  assert.deepEqual(result.list.map(row => row.name), Array.from({ length: 29 }, (_, i) => track(i).name))
  assert.equal((await lookup(seed, 48, undefined, { target: 999 })).list.length, 29)
  assert.equal(rounds, 2, 'targets normalize to the station maximum before cache lookup')
  assert.equal(qqCalls, 0, '24 good song-level matches should not invoke fallback')
})

test('a thin station tries QQ up to the existing deadline and returns only distinct song-level matches', async t => {
  const tick = clock(t)
  const rows = Array.from({ length: 23 }, (_, i) => hit(i + 2))
  let fallbackSignal: AbortSignal | undefined, artistLookups = 0
  let filled
  const lookup = createSimilarSongResolver(deps({
    radio: async () => [track(0), track(1)],
    search: async (_source, q) => {
      const i = knownTrack(q)
      if (Number.isFinite(i)) return [hit(i)]
      artistLookups++
      return []
    },
    txSimilar: async () => {
      fallbackSignal = sourceRequestSignal()
      await new Promise<void>(resolve => setTimeout(resolve, 600))
      return [hit(0), { ...hit(1), name: 'Another title with the same ID' }, { ...hit(1), songmid: 'same-title' },
        { ...hit(25), name: 'Track 25 (Live)' }, ...rows]
    },
  }))
  const station = lookup(seed, 48, undefined, { target: 24 }).then(result => { filled = result; return result })
  await flush()
  assert.ok(fallbackSignal)
  await tick(300)
  assert.equal(filled, undefined, 'explicit QQ top-up outlives the ordinary 250ms budget')
  assert.equal(fallbackSignal.aborted, false)
  await tick(300)
  const result = await station
  assert.equal(result.strategy, 'radio')
  assert.deepEqual(result.list.map(row => row.name), Array.from({ length: 24 }, (_, i) => track(i).name))
  assert.equal(fallbackSignal.aborted, true)
  assert.equal(artistLookups, 0)
})

test('a short explicit station never pads a valid result with artist catalog songs', async () => {
  let artistLookups = 0
  const lookup = createSimilarSongResolver(deps({
    radio: async () => [track(0)],
    txSimilar: async () => [],
    search: async (_source, keyword) => {
      if (knownTrack(keyword) === 0) return [hit(0)]
      artistLookups++
      return [{ ...hit(97), singer: seed.singer }]
    },
  }))
  const result = await lookup(seed, 48, undefined, { target: 24 })
  assert.equal(result.strategy, 'radio')
  assert.deepEqual(result.list.map(row => row.name), ['Track 0'])
  assert.equal(artistLookups, 0, 'a song-level result suppresses the artist lookup')
})

test('station returns a thin valid batch without padding when YouTube or QQ times out', async t => {
  const tick = clock(t)
  let radioSignal: AbortSignal | undefined, qqSignal: AbortSignal | undefined, result
  const lookup = createSimilarSongResolver(deps({
    radio: async () => { radioSignal = sourceRequestSignal(); return never() },
    txSimilar: async () => { qqSignal = sourceRequestSignal(); return never() },
    search: async () => Array.from({ length: 10 }, (_, i) => ({ ...hit(i), singer: seed.singer })),
  }))
  const pending = lookup(seed, 48, undefined, { target: 24 }).then(value => { result = value })
  await flush()
  await tick(5500)
  assert.ok(radioSignal?.aborted)
  assert.equal(result, undefined)
  await tick(1400)
  await pending
  assert.ok(qqSignal?.aborted)
  assert.deepEqual(result?.list.map(row => row.name), ['Track 0', 'Track 1', 'Track 2'])
  assert.equal(result?.strategy, 'artist', 'same-artist still acts only as a capped last resort')
})

test('the station target and returned batch cannot exceed the requested limit', async () => {
  const lookup = createSimilarSongResolver(deps({ txSimilar: async () => Array.from({ length: 10 }, (_, i) => hit(i)) }))
  const result = await lookup(seed, 3, undefined, { target: 24 })
  assert.deepEqual(result.list.map(row => row.name), ['Track 0', 'Track 1', 'Track 2'])
  assert.equal(result.strategy, 'similar')
})

test('duplicate catalog IDs do not prematurely exhaust the station slots', async () => {
  const searched = new Set<number>()
  let qqCalls = 0
  const lookup = createSimilarSongResolver(deps({
    radio: async () => Array.from({ length: 12 }, (_, i) => track(i)),
    search: async (_source, keyword) => {
      const i = knownTrack(keyword)
      if (!Number.isFinite(i)) return []
      searched.add(i)
      return [{ ...hit(i), songmid: i < 7 ? 'shared' : 'm' + i }]
    },
    txSimilar: async () => { qqCalls++; return [] },
  }))
  const result = await lookup(seed, 8, undefined, { target: 5 })
  assert.deepEqual(result.list.map(row => row.name), [0, 7, 8, 9, 10, 11].map(i => track(i).name))
  assert.equal(searched.size, 12)
  assert.equal(qqCalls, 0, 'bounded lookahead can fill this target without QQ')
})
