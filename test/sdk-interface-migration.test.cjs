const { test } = require('node:test')
const assert = require('node:assert/strict')
const { build } = require('esbuild')
const fs = require('node:fs/promises')
const path = require('node:path')
const Module = require('node:module')
const { deflateSync } = require('node:zlib')

async function load(name) {
  const result = await build({
    entryPoints: [path.resolve('src/modules/utils/musicSdk', name + '.js')],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
    plugins: [{ name: 'mock-transport', setup(b) {
      b.onLoad({ filter: /[\\/]utils[\\/]request\.js$/ }, () => ({ contents: 'export const httpFetch = (...args) => globalThis.__sdkMigrationHttp(...args)', loader: 'js' }))
      b.onLoad({ filter: /[\\/](mg|wy)[\\/]lyric\.js$/ }, async ({ path: p }) => ({ contents: await fs.readFile(p, 'utf8') + (p.includes(`${path.sep}mg${path.sep}`) ? '\nexport { mrcTools }' : '\nexport { parseTools }'), loader: 'js' }))
    } }],
  })
  const m = new Module(path.resolve('test/sdk-migration-bundle.cjs'), module)
  m.filename = path.resolve('test/sdk-migration-bundle.cjs')
  m.paths = module.paths
  m._compile(result.outputFiles[0].text, m.filename)
  return m.exports
}
const response = body => ({ promise: Promise.resolve({ statusCode: 200, body }), cancelHttp() {} })

test('Kugou keeps chain and collection ID, including redirect-only encoded IDs', async () => {
  const kg = (await load('kg/songList')).default
  const calls = []
  kg.getListDetailByGcidChain = async (...args) => { calls.push(args); return 'new detail' }
  assert.equal(await kg.getUserListDetail('https://m.kugou.com/share/?global_collection_id=abc_123&chain=xyz_456', 1), 'new detail')
  assert.deepEqual(calls[0], ['abc_123', 'xyz_456'])
  globalThis.__sdkMigrationHttp = () => ({ promise: Promise.resolve({ statusCode: 302, headers: { location: 'https://m.kugou.com/songlist/gcid_encoded123' } }), cancelHttp() {} })
  kg.decodeGcid = async id => { assert.equal(id, 'gcid_encoded123'); return 'decoded' }
  kg.getUserListDetail2 = async id => id
  assert.equal(await kg.getUserListDetail('https://t1.kugou.com/short', 1), 'decoded')
})

test('Kugou new endpoint reads all 50-song pages and keeps metadata', async () => {
  const kg = (await load('kg/songList')).default
  const pages = []
  kg.createHttp = async url => {
    const u = new URL(url), page = Number(u.searchParams.get('page'))
    pages.push(page)
    assert.equal(u.pathname, '/v2/zlist/list')
    assert.equal(u.searchParams.get('chain'), 'chain123')
    assert.equal(u.searchParams.get('pagesize'), '50')
    return { info: [{ count: 101, name: 'test', pic: 'https://img/{size}' }], list: { info: Array.from({ length: page < 3 ? 50 : 1 }, (_, n) => ({ hash: `${page}-${n}` })) } }
  }
  kg.getMusicInfos = async items => items
  const detail = await kg.getListDetailByGcidChain('collection', 'chain123')
  assert.equal(detail.list.length, 101)
  assert.equal(detail.total, 101)
  assert.deepEqual(pages, [1, 2, 3])
  assert.equal(detail.info.img, 'https://img/1000')
})

test('QQ singer uses plural mids, separate counts, and page 2 starts at limit', async () => {
  const singer = (await load('tx/singer')).default
  globalThis.__sdkMigrationHttp = (url, options) => {
    const req = options.body
    if (req.req_1) {
      assert.deepEqual(req.req_1.param.singer_mids, ['mid'])
      return response({ code: 0, req_1: { code: 0, data: { singer_list: [{ basic_info: { singer_mid: 'mid', name: 'artist' }, ex_info: { desc: '', genre: 1 }, pic: { pic: 'avatar' } }] } }, req_2: { code: 0, data: { total: 12 } }, req_3: { code: 0, data: { totalNum: 34 } } })
    }
    assert.equal(req.req.param.begin, 5)
    return response({ code: 0, req: { code: 0, data: { albumList: [], total: 12 } } })
  }
  assert.deepEqual((await singer.getInfo('mid')).count, { music: 34, album: 12 })
  assert.equal((await singer.getAlbumList('mid', 2, 5)).page, 2)
})

test('QQ lyric cancellation aborts the active request, including before lookup', async () => {
  const lyric = (await load('tx/lyric')).default
  let requests = 0, aborted = 0, rejectRequest
  globalThis.__sdkMigrationHttp = () => {
    requests++
    return { promise: new Promise((_, reject) => { rejectRequest = reject }), cancelHttp() { aborted++; rejectRequest(new Error('cancelled')) } }
  }
  const first = lyric.getLyric({ songId: 1 })
  first.cancelHttp()
  await assert.rejects(first.promise, /Cancel Request/)
  assert.equal(requests, 0)
  const second = lyric.getLyric({ songId: 1 })
  await new Promise(resolve => setImmediate(resolve))
  second.cancelHttp()
  await assert.rejects(second.promise, /cancelled/)
  assert.equal(aborted, 1)
})

test('QQ lyric retries reject at a bound instead of resolving to a request object', async () => {
  const lyric = (await load('tx/lyric')).default
  let requests = 0
  globalThis.__sdkMigrationHttp = () => { requests++; return response({ code: 0, req: { code: 500 } }) }
  await assert.rejects(lyric.getLyric({ songId: 1 }).promise, /Get lyric failed/)
  assert.equal(requests, 4)
})

test('QQ concurrent song-ID lookups share a promise and failed lookups can retry', async () => {
  const lyric = (await load('tx/lyric')).default
  let requests = 0
  globalThis.__sdkMigrationHttp = () => {
    requests++
    return response({ code: 0, req: { code: 0, data: { track_info: { id: 12, mid: 'mid', title: 'song', singer: [], interval: 120, file: { media_mid: 'media' } } } } })
  }
  assert.deepEqual(await Promise.all([lyric.getSongId({ songmid: 'mid' }), lyric.getSongId({ songmid: 'mid' })]), [12, 12])
  assert.equal(requests, 1)
  globalThis.__sdkMigrationHttp = () => response({ code: 500 })
  await assert.rejects(lyric.getSongId({ songmid: 'retry-mid' }))
  globalThis.__sdkMigrationHttp = () => response({ code: 0, req: { code: 0, data: { track_info: { id: 13, singer: [], file: { media_mid: 'media' } } } } })
  assert.equal(await lyric.getSongId({ songmid: 'retry-mid' }), 13)
})

test('Kuwo UTF-8 decoder handles ordinary and XOR word lyrics', async () => {
  const { decodeLyric } = await load('kw/util')
  const text = '[00:00.005]测试歌词'
  const header = Buffer.from('tp=content\r\n\r\n')
  assert.equal(await decodeLyric(Buffer.concat([header, deflateSync(Buffer.from(text))]), false), text)
  const key = Buffer.from('yeelion'), buf = Buffer.from(text)
  for (let i = 0; i < buf.length; i++) buf[i] ^= key[i % key.length]
  assert.equal(await decodeLyric(Buffer.concat([header, deflateSync(Buffer.from(buf.toString('base64')))]), true), text)
})

test('Netease and Migu preserve five milliseconds as .005', async () => {
  const { parseTools } = await load('wy/lyric')
  const { mrcTools } = await load('mg/lyric')
  assert.equal(parseTools.msFormat(5), '[00:00.005]')
  assert.equal(parseTools.msFormat(50, false), '[00:00.05]')
  assert.equal(parseTools.msFormat(5, false), '[00:00.00]')
  assert.match(mrcTools.parseLyric('[5,100](5,100)字').lyric, /^\[00:00\.005]/)
  globalThis.__sdkMigrationHttp = () => response('[00:01.50]一\n[00:02.50]二')
  assert.equal((await mrcTools.getLrc('https://example.test/lrc')).lyric, '[00:01.50]一\n[00:02.50]二')
})

test('Migu uses resource ID and returns a URL rather than a request object', async () => {
  const pic = (await load('mg/pic')).default
  globalThis.__sdkMigrationHttp = (url, options) => {
    assert.equal(options.form.resourceId, 'resource-id')
    return response({ code: '000000', resource: [{ songId: 'resource-id', copyrightId: 'copyright', songName: 'song', albumImgs: [{ img: 'https://image.test/cover.jpg' }] }] })
  }
  assert.equal(await pic.getPic({ songmid: 'resource-id', copyrightId: 'copyright' }), 'https://image.test/cover.jpg')
})

test('Netease EAPI artist pagination and new song shape keep quality and duration', async () => {
  const singer = (await load('wy/singer')).default
  const songs = singer.filterSongList([{ id: 1, name: 'song', ar: [{ name: 'artist' }], al: { id: 2, name: 'album', picUrl: 'pic' }, dt: 123000, h: { size: 300 }, privilege: { maxbr: 320000 } }])
  assert.equal(songs[0].interval, '02:03')
  assert.equal(songs[0].albumName, 'album')
  assert.equal(songs[0].img, 'pic')
  assert.ok(songs[0]._types['320k'])
})

test('Kuwo category feed excludes artists and keeps unlabeled playlists and cover sizing', async () => {
  const playlists = (await load('kw/songList')).default
  const result = playlists.filterList2([{ list: [
    { type: 'artist', id: '1', digest: 4 },
    { type: 'songlist', id: '2', digest: 8, img: 'https://img.test/star/albumcover/120/a.jpg' },
    { type: 'album', id: '3', digest: 13 },
  ] }])
  assert.deepEqual(result.map(v => v.id), ['digest-8__2', 'digest-13__3'])
  assert.match(result[0].img, /albumcover\/1000/)
})

test('Netease catalogue business errors stop after three attempts', async () => {
  const playlists = (await load('wy/songList')).default
  let attempts = 0
  globalThis.__sdkMigrationHttp = () => { attempts++; return response({ code: 500 }) }
  await assert.rejects(playlists.getTag(), /try max num/)
  assert.equal(attempts, 3)
})

test('Cross-source matching excludes a live version of a studio title', async () => {
  const sdk = (await load('index')).default
  sdk.searchMusic = async () => [{ list: [{ name: 'Song (Live)', singer: 'Artist', albumName: 'Album', interval: '03:00' }] }]
  const result = await sdk.findMusic({ name: 'Song', singer: 'Artist', albumName: 'Album', interval: '03:00', source: 'tx' })
  assert.deepEqual(result, [])
})
