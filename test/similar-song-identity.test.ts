import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchSimilarSongs, fetchYtmRadio, findOriginalOfUpload } from '../src/server/utils/similarSongs'

// Shapes from a WEB_REMIX song search: the title links to a recording; artist
// and album are distinct browse runs. Menu commands can refer to another video.
const artist = (text: string, type = 'ARTIST') => ({ text, navigationEndpoint: { browseEndpoint: {
  browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_' + type } },
} } })
const row = (id: string, title: string, credits: string[]) => ({ musicResponsiveListItemRenderer: {
  menu: { related: { videoId: 'unrelated-menu-action' } },
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title, navigationEndpoint: { watchEndpoint: { videoId: id } } }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [...credits.map(a => artist(a)), { text: ' • ' }, artist('Album', 'ALBUM')] } } },
  ], playlistItemData: { videoId: id },
} })
const radioItem = (id: string, type: string) => ({ playlistPanelVideoRenderer: {
  menu: { related: { videoId: 'x', musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } },
  videoId: id, title: { runs: [{ text: 'Next Song' }] },
  navigationEndpoint: { watchEndpoint: { videoId: id, watchEndpointMusicSupportedConfigs: {
    watchEndpointMusicConfig: { musicVideoType: type },
  } } },
  longBylineText: { runs: [artist('合作歌手'), { text: ' 和 ' }, artist('Another Singer'), { text: ' • ' }, artist('The Album', 'ALBUM')] },
  lengthText: { runs: [{ text: '3:20' }] },
} })

test('a song radio uses the seeded recording, not a substring artist, a guest-only credit, an alternate take or a menu video', async () => {
  const rows = [
    row('wrong-artist', 'Love', ['Young Adele']),
    row('guest-only', 'Love', ['Cover Artist', 'Adele']),
    row('wrong-version', 'Love (Live)', ['Adele']),
    row('right', 'Love', ['Adele']),
  ]
  const result = await fetchYtmRadio({ name: 'Love', singer: 'Adele' }, async (endpoint, payload) => {
    if (endpoint === 'search') return { contents: rows }
    assert.equal(payload.videoId, 'right')
    return { contents: [radioItem('right', 'MUSIC_VIDEO_TYPE_ATV'), radioItem('upload', 'MUSIC_VIDEO_TYPE_UGC'), radioItem('rec', 'MUSIC_VIDEO_TYPE_ATV')] }
  })
  assert.deepEqual(result, [{ name: 'Next Song', singer: '合作歌手、Another Singer', duration: 200 }])
})

test('an ambiguous title without recording evidence does not start a radio', async () => {
  const post = async (endpoint: string) => {
    assert.equal(endpoint, 'search', 'must not request radio for an unverified seed')
    return { contents: [row('a', 'Home', ['A']), row('b', 'Home', ['B'])] }
  }
  assert.deepEqual(await fetchYtmRadio({ name: 'Home', singer: '' }, post), [])
})

test('a missing song is not replaced by an unrelated title track from its own album', () => {
  assert.equal(findOriginalOfUpload([{ id: 'wrong', title: 'Help!', artist: 'The Beatles' }],
    { name: 'Yesterday', singer: 'The Beatles', album: 'Help!' }), '')
  assert.equal(findOriginalOfUpload([{ id: 'false-name-fragment', title: 'Help!', artist: 'Beat' }],
    { name: 'thebeatles经典现场', singer: 'Uploader', album: 'Help!' }), '')
})

test('playable recommendation mapping accepts a bilingual alias and excludes partial artists, wrong editions and wildly different durations', async () => {
  const song = (id: number, singer: string, name: string, interval: string) => ({ songId: id, source: 'kw', singer, name, interval })
  const lookup = await fetchSimilarSongs({ name: 'Seed', singer: 'Other' }, 1, {
    radio: async () => [{ name: 'Until Tomorrow (Part II)', singer: '五月天 (Mayday)', duration: 191 }],
    search: async (_, keyword) => keyword.includes('Until') ? [
      song(1, '五月天致敬乐队', 'Until Tomorrow (Part II)', '03:11'),
      song(2, 'Mayday', 'Until Tomorrow (Part I)', '03:11'),
      song(3, 'Mayday', 'Until Tomorrow (Part II)', '08:40'),
      song(4, 'Mayday', 'Until Tomorrow (Part II)', '03:12'),
    ] : [],
    txSimilar: async () => [], shuffle: list => list,
  })
  assert.deepEqual(lookup.list.map(s => s.songId), [4])
})

test('no recommendation is emitted when the catalog offers only a mislabeled edition, guest credit, or far longer recording', async () => {
  const lookup = await fetchSimilarSongs({ name: 'Seed', singer: 'Other' }, 3, {
    radio: async () => [{ name: 'Song (Part II)', singer: 'AC/DC', duration: 200 }],
    search: async (_, keyword) => keyword.includes('Song') ? [
      { source: 'kw', songId: 'a', name: 'Song (Part I)', singer: 'AC/DC', interval: '03:20' },
      { source: 'kw', songId: 'b', name: 'Song (Part II)', singer: 'AC', interval: '03:20' },
      { source: 'kw', songId: 'c', name: 'Song (Part II)', singer: 'AC/DC', interval: '06:50' },
      { source: 'kw', songId: 'd', name: 'Song (Part II)', singer: 'Other feat. AC/DC', interval: '03:20' },
    ] : [], txSimilar: async () => [], shuffle: list => list,
  })
  assert.deepEqual(lookup, { list: [], strategy: 'none' })
})

test('an unlinked performer before the separator survives a linked album after it', async () => {
  const rec = row('correct', 'Hello', [])
  rec.musicResponsiveListItemRenderer.flexColumns[1].musicResponsiveListItemFlexColumnRenderer.text.runs =
    [{ text: 'Adele' }, { text: ' • ' }, artist('25', 'ALBUM')]
  const albumOnly = row('wrong', 'Hello', [])
  albumOnly.musicResponsiveListItemRenderer.flexColumns[1].musicResponsiveListItemFlexColumnRenderer.text.runs =
    [artist('Adele', 'ALBUM'), { text: ' • ' }, { text: '2015' }]
  let requested = ''
  await fetchYtmRadio({ name: 'Hello', singer: 'Adele' }, async (endpoint, payload) => {
    if (endpoint === 'search') return { contents: [albumOnly, rec] }
    requested = String(payload.videoId)
    return {}
  })
  assert.equal(requested, 'correct')
})

test('a seed with explicit co-credits keeps its lead and all known performers', async () => {
  const rows = [row('reversed', 'Home', ['B', 'A']), row('solo', 'Home', ['A']), row('correct', 'Home', ['A', 'B'])]
  let requested = ''
  await fetchYtmRadio({ name: 'Home', singer: 'A feat. B' }, async (endpoint, payload) => {
    if (endpoint === 'search') return { contents: rows }
    requested = String(payload.videoId)
    return {}
  })
  assert.equal(requested, 'correct')
})

const selectedRadio = async (seed: Parameters<typeof fetchYtmRadio>[0], rows: any[]) => {
  let selected = ''
  await fetchYtmRadio(seed, async (endpoint, payload) => {
    if (endpoint === 'search') return {contents: rows}
    selected = String(payload.videoId)
    return {}
  })
  return selected
}

test('a guest explicitly credited in the recording title counts, but not a lookalike or reversed lead', async () => {
  const rows = [row('other-guest', 'Hello（合作音乐人：Other）', ['Pop Smoke']),
    row('wrong-lead', 'Hello (feat. Pop Smoke)', ['A Boogie wit da Hoodie']),
    row('correct', 'Hello（合作音乐人：A Boogie wit da Hoodie）', ['Pop Smoke'])]
  for (const name of ['Hello', 'Hello (feat. A Boogie wit da Hoodie)']) {
    assert.equal(await selectedRadio({name,singer:'Pop Smoke、A Boogie wit da Hoodie'}, rows), 'correct')
  }
  assert.equal(await selectedRadio({name:'Hello', singer:'Pop Smoke、A Boogie'}, rows), '')
})

test('plain lead and linked guest retain their positions; the guest is not the lead', async () => {
  const mixed = row('duet', 'Duet', [])
  mixed.musicResponsiveListItemRenderer.flexColumns[1].musicResponsiveListItemFlexColumnRenderer.text.runs =
    [{text:'Lead'}, {text:' & '}, artist('Guest'), {text:' • '}, artist('Album', 'ALBUM')]
  assert.equal(await selectedRadio({name:'Duet',singer:'Lead、Guest'}, [mixed]), 'duet')
  assert.equal(await selectedRadio({name:'Duet',singer:'Guest'}, [mixed]), '')
})

test('Kuwo formatting of a literal band ampersand matches the full band, not unrelated duets', async () => {
  const deps = (source: string) => ({
    radio: async () => [{name:'Song', singer:'C&K', duration:200}],
    txSimilar: async () => [], shuffle: <T>(a: T[]) => a,
    search: async (src: string, keyword: string) => src === source && keyword.startsWith('Song ') ? [
      {source:src, songmid:1, name:'Song',singer:'C、X',interval:'03:20'},
      {source:src, songmid:2, name:'Song',singer:'C、K',interval:'03:20'}] : [],
  })
  assert.deepEqual((await fetchSimilarSongs({name:'Seed',singer:'Other',source:'kw'}, 1, deps('kw'))).list.map(i=>i.songmid), [2])
  assert.deepEqual((await fetchSimilarSongs({name:'Seed',singer:'Other',source:'tx'}, 1, deps('tx'))).list, [])
  assert.equal(await selectedRadio({name:'Song', singer:'C、K', source:'kw'}, [row('band','Song',['C&K'])]), 'band')
})

test('the seed album disambiguates recordings with the same title and lead', async () => {
  const albums=['Both Sides Now','Clouds']
  const rows=albums.map(album=>{
    const rec=row(album,'Both Sides Now',['Joni Mitchell'])
    rec.musicResponsiveListItemRenderer.flexColumns[1].musicResponsiveListItemFlexColumnRenderer.text.runs =
      [artist('Joni Mitchell'), {text:' • '}, artist(album,'ALBUM')]
    return rec
  })
  assert.equal(await selectedRadio({name:'Both Sides Now',singer:'Joni Mitchell',album:'Clouds'},rows), 'Clouds')
})
