import assert from 'node:assert/strict'
import test from 'node:test'
import { createSimilarSongResolver, fetchYtmRadio, type SimilarDeps, type SimilarSeed } from '../src/server/utils/similarSongs'

const song = (source: string, songId: number | string, songmid: string, name: string, singer: string, albumName = '') =>
  ({ source, songId, songmid, name, singer, albumName })
const seed = song('tx', 42, 'M', 'Seed', 'A')
const deps = (overrides: Partial<SimilarDeps>): SimilarDeps => ({
  radio: async () => [], txSimilar: async () => [], search: async () => [], shuffle: a => a, ...overrides,
})

test('artist fallback preserves Kuwo band credits rather than dropping the band or queuing a solo namesake', async () => {
  for (const [source, singer, destination, credit] of [
    ['tx', 'C&K', 'kw', 'C、K'], ['kw', 'C、K', 'tx', 'C&K'], ['kw', 'C、K', 'kw', 'C、K'],
    ['kw', 'Ann、Ben', 'tx', 'Ann、Ben'], ['tx', 'Ann feat. Ben', 'tx', 'Ann'],
  ]) {
    const result = await createSimilarSongResolver(deps({
      search: async (src, q) => src === destination && !q.startsWith('Seed') ? [
        song(src, 7, '7', 'Solo Song', singer.startsWith('C') ? 'C' : 'Ben'),
        song(src, 8, '8', 'Right Song', credit),
      ] : [],
    }))({ ...seed, source, singer })
    assert.deepEqual(result.list.map(row => row.songId), [8], source + ': ' + singer)
    assert.equal(result.strategy, 'artist')
  }
})

test('identical provider IDs exclude a relabelled seed; unrelated sources and distinct ID namespaces do not collide', async () => {
  const rows = [
    song('tx', '42', 'X', 'Seed relabelled by numeric ID', 'Other'),
    song('tx', 120, 'M', 'Seed relabelled by MID', 'Other'),
    song('kw', 42, 'M', 'Another source', 'Other'),
    song('tx', 121, '42', 'Another namespace', 'Other'),
    song('tx', 122, 'm', 'Lowercase opaque MID', 'Other'),
  ]
  const r = await createSimilarSongResolver(deps({ txSimilar: async () => rows }))(seed)
  assert.deepEqual(r.list.map(row => row.name), rows.slice(2).map(row => row.name))
})

test('a seed ID disguised as a radio pick cannot consume the only catalog slot', async () => {
  const r = await createSimilarSongResolver(deps({
    radio: async () => [{ name: 'Next', singer: 'B', duration: 0 }],
    search: async () => [song('tx', 42, 'M', 'Next', 'B'), song('tx', 45, 'N', 'Next', 'B')],
  }))(seed, 1)
  assert.deepEqual(r.list.map(row => row.songId), [45])
})

const browse = (text: string, type: string) => ({ text, navigationEndpoint: { browseEndpoint: {
  browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_' + type } },
} } })
const yt = (id: string, album: string) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId: id },
  flexColumns: [[{text: 'Seed'}], [browse('A', 'ARTIST'), {text: ' • '}, browse(album, 'ALBUM')]]
    .map(runs => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } })),
} })
test('a recording with a conflicting album is not used just because another search row omits its album', async () => {
  for (const exact of [false, true]) {
    const starts: unknown[] = []
    const rows = [yt('wrong', 'Wrong'), yt('unknown', ''), ...(exact ? [yt('right', 'Clouds')] : [])]
    await fetchYtmRadio({...seed, album: 'Clouds'}, async (endpoint, payload) => {
      if (endpoint === 'search') return { contents: rows }
      starts.push(payload.videoId); return {}
    })
    assert.deepEqual(starts, exact ? ['right'] : [])
  }
})

test('QQ fallback checks the recording album, treats duplicate IDs as one, and preserves authoritative QQ IDs', async () => {
  const relatedTo = async (s: SimilarSeed, rows: any[]) => {
    const ids: string[] = []
    await createSimilarSongResolver(deps({ search: async (_, q) => q.startsWith('Seed ') ? rows : [],
      txSimilar: async id => { ids.push(id); return [] } }))(s)
    return ids
  }
  const other = song('tx', 101, 'X', 'Seed', 'A', 'Elsewhere')
  const exact = song('tx', 102, 'R', 'Seed', 'A', 'Clouds')
  const noAlbum = song('tx', 103, 'U', 'Seed', 'A')
  const cross = { ...seed, source: 'kw', album: 'Clouds' }
  assert.deepEqual(await relatedTo(cross, [other, exact]), ['102'])
  assert.deepEqual(await relatedTo(cross, [other, noAlbum]), [])
  assert.deepEqual(await relatedTo({...cross, album:''}, [other, exact]), [])
  assert.deepEqual(await relatedTo(cross, [exact, {...exact}]), ['102'])
  assert.deepEqual(await relatedTo({...cross, source:'tx', songId:undefined, songmid:'X'}, [other, exact]), ['101'])
  assert.deepEqual(await relatedTo(seed, [other, exact]), ['42'])
})

test('concurrent requests share one build but each caller orders its own recommendations', async () => {
  let release!: () => void, calls = 0, order = 0
  const gate = new Promise<void>(done => { release = done })
  const resolve = createSimilarSongResolver(deps({
    radio: async () => { calls++; await gate; return [] },
    txSimilar: async () => [song('tx', 51, 'a', 'First', 'B'), song('tx', 52, 'b', 'Second', 'B')],
    shuffle: list => ++order % 2 ? list : list.reverse(),
  }))
  const a = resolve(seed, 2), b = resolve({...seed}, 2)
  release()
  const results = await Promise.all([a,b,resolve(seed, 2)])
  assert.equal(calls, 1)
  assert.equal(order, 3)
  assert.notDeepEqual(results[0].list.map(x => x.songId), results[1].list.map(x => x.songId))
  assert.deepEqual(results[0].list, results[2].list)
  await resolve(seed, 2)
  assert.equal(calls, 1)
})

test('empty or failed concurrent lookups do not suppress a subsequent retry', async () => {
  let calls = 0
  const resolve = createSimilarSongResolver(deps({
    radio: async () => { calls++; throw Error('radio unavailable') },
    txSimilar: async () => calls > 1 ? [song('tx', 60, 'r', 'Recovered', 'B')] : [],
  }))
  for (const result of await Promise.all([resolve(seed, 1), resolve(seed, 1)])) assert.deepEqual(result.list, [])
  assert.equal(calls, 1)
  assert.equal((await resolve(seed, 1)).list[0].name, 'Recovered')
  assert.equal(calls, 2)
})
