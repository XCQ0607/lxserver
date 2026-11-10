import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { DislikeDataManage } from '../src/modules/dislike/dislikeDataManage'
import { parseDislikeRules, filterDisliked } from '../src/modules/dislike/match'

const source = fs.readFileSync('src/server/integrations/subsonic.ts', 'utf8').replace(/\r/g, '')
function between(from: string, to: string) {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, from)
  return source.slice(a, b)
}
function dataManage() {
  return new DislikeDataManage({ snapshotInfo: {}, getSnapshotInfo: async () => ({ latest: null }) } as any)
}
function harness() {
  const dm = dataManage()
  const state = { snapshots: 0, ratings: {} as Record<string, number>, invalidations: 0, aliases: {} as Record<string,string> }
  const methods = between('    private async resolveDislikeTarget(', '    /** 按 dislike 规则过滤歌曲列表') +
    between('    async syncRatingsToDislike(', '    /**\n     * 手动补数据（不喜欢') +
    between('    async syncDislikesToRating(', '    /**\n     * 处理 Subsonic setRating')
  const context = vm.createContext({
    resolveStoredRatingId: async (_u: string, id: string) => state.aliases[id] || id,
    localRatingId: (track: any) => track.platformId || track.id,
    state, global: { lx: { config: { 'subsonic.dislikeRating': 1 } } },
    getUserSpace: () => ({ dislikeManage: { dislikeDataManage: dm, createSnapshot: async () => { state.snapshots++ } } }),
    withTimeout: (p: any) => p, LINK_SYNC_ITEM_TIMEOUT_MS: 8000, LINK_SYNC_BATCH_SIZE: 20,
    countDislikeRules: (r: string) => r.split('\n').filter(Boolean).length,
    invalidateDislikeCache: () => { state.invalidations++ },
    writeRatingUnlocked:async (_u:string,id:string,rating:number)=>{const unchanged=state.ratings[id]>0;if(!unchanged)state.ratings[id]=rating;return {id,meta:{ratings:state.ratings},unchanged}},
    recordRatingBackfillFailure:()=>{},
    flushRatingSnapshot:async()=> (state as any).snapshotFailure ? '快照失败' : undefined,
    readSubsonicMeta: () => ({ ratings: state.ratings }),
    writeSubsonicMeta: (_u: string, meta: any) => { state.ratings = meta.ratings },
    withRatingIdentityLock: async (_u: string, fn: () => any) => fn(),
    withMetaLock: async (_u: string, f: () => any) => f(), createRatingSnapshot: async () => {},
    getLocalTracks: async () => [], localMusic: (x: any) => x,
    splitSingers: (s: string) => s.split('、'), normalizeText: (s: string) => s,
    encodeAlbumRule: (a: string, s: string) => `!${a}@${s}`,
    musicSdk: { wy: { extendDetail: { getAlbumSongs: async () => ({ name: 'album', list: [{ singer: 'artist' }] }) } } },
    subsonicLog: { warn() {}, error() {} },
  })
  vm.runInContext(transformSync(`class Harness {
    onlineSongCache = new Map(); userRatingsCache = new Map(); songs = new Map();
    loadOnlineSongCache() {}
    async getSubsonicListData() { return { loveList: [], defaultList: [...this.songs.values()], userList: [] } }
    async filterDislikedSongs(_u, songs) { return songs.filter(s => s.name !== 'blocked') }
    async resolveSongMeta(_u, id) { if (id === 'fail') throw Error('offline'); const music = this.songs.get(id); return music ? { music } : null }
    async resolveSingerIdentity(_u, name, preset) { return { name, source: preset?.source || '', singerId: preset?.id || '' } }
    async resolveArtistKey() { return { name: 'artist' } }
    dislikeRuleKey(name, singer) { return name + '@' + singer }
    ${methods}
  }; globalThis.instance = new Harness()`, { loader: 'ts', format: 'cjs' }).code, context)
  return { instance: (context as any).instance, dm, state }
}
const song = (id: string) => ({ id, name: 'track-' + id, singer: 'artist', source: 'wy', songmid: id, img: 'cover', interval: '03:00', types: [{ type: '128k' }], _types: { '128k': {} } })

test('Subsonic 歌曲转换保留 Web 所需的已知资料字段', async () => {
  const { instance, dm } = harness()
  instance.songs.set('wy_1', song('wy_1'))
  const target = await instance.resolveDislikeTarget('alice', 'wy_1')
  await dm.addDislikeInfo(target.infos)
  const item = dm.dislikeRules.dislikeList[0] as any
  for (const key of ['id', 'source', 'songmid', 'name', 'singer', 'img', 'interval', 'types', '_types']) assert.deepEqual(item[key], (song('wy_1') as any)[key])
  assert.equal(item.dislikeRule, 'track-wy_1@artist')
})

test('已知限制：残缺字段不会凭空补齐，同规则不同来源不会合并资料', async () => {
  const { instance, dm } = harness()
  instance.songs.set('wy_1', { id: 'wy_1', name: 'track', singer: 'artist' })
  const target = await instance.resolveDislikeTarget('alice', 'wy_1')
  assert.equal(target.infos[0].img, undefined)
  await dm.addDislikeInfo([{ name: 'track', singer: 'artist', dislikeRule: '' }])
  await dm.addDislikeInfo([{ ...song('wy_1'), name: 'track', dislikeRule: '' }] as any)
  assert.equal(dm.dislikeRules.dislikeList.length, 2)
  assert.equal((dm.dislikeRules.dislikeList[0] as any).img, undefined)
})

test('歌手转换为名称规则，专辑转换为专辑规则，不展开歌曲', async () => {
  const { instance } = harness()
  const artist = await instance.resolveDislikeTarget('alice', 'art_tx_123')
  assert.equal(artist.infos[0].name, '')
  assert.equal(artist.infos[0].singer, 'artist')
  const album = await instance.resolveDislikeTarget('alice', 'alb_wy_123')
  assert.equal(album.infos.length, 0)
  assert.equal(album.album.albumName, 'album')
  assert.deepEqual(Array.from(album.album.singers), ['artist'])
})

test('手动正向同步全量分批、幂等、跳过高分、失败继续并生成一次快照', async () => {
  const { instance, state, dm } = harness()
  for (let n = 0; n < 43; n++) { const id = 'wy_' + n; instance.songs.set(id, song(id)); state.ratings[id] = 1 }
  state.ratings.fail = 1; state.ratings.high = 5
  const first = await instance.syncRatingsToDislike('alice')
  assert.equal(first.scanned, 44); assert.equal(first.batches, 3); assert.equal(first.failed, 1)
  assert.equal(first.added, 43); assert.equal(state.snapshots, 1); assert.equal(state.invalidations, 1)
  const second = await instance.syncRatingsToDislike('alice')
  assert.equal(second.added, 0); assert.equal(dm.dislikeRules.dislikeList.length, 43)
})

test('手动反向同步只补命中且缺失的评分，保留已有高分', async () => {
  const { instance, state } = harness()
  instance.songs.set('a', { ...song('a'), name: 'blocked' })
  instance.songs.set('b', { ...song('b'), name: 'blocked' })
  instance.songs.set('c', song('c')); state.ratings.a = 5
  const result = await instance.syncDislikesToRating('alice')
  assert.equal(result.added, 1); assert.equal(result.skipped, 1)
  assert.deepEqual(state.ratings, { a: 5, b: 1 })
})

for (const [name, rules, candidate, options, expected] of [
  ['版本归一化开', 'track@artist', { name: 'track (Live)', singer: 'artist' }, { normalizeName: true }, 0],
  ['版本归一化关', 'track@artist', { name: 'track (Live)', singer: 'artist' }, { normalizeName: false }, 1],
  ['纯歌名要求歌手', 'track', { name: 'track', singer: 'artist' }, { requireSinger: true }, 1],
  ['纯歌名不要求歌手', 'track', { name: 'track', singer: 'artist' }, { requireSinger: false }, 0],
  ['合唱任一歌手', '@artist', { name: 'track', singer: 'other、artist' }, { duetMode: 'any' }, 0],
  ['合唱全部歌手', '@artist', { name: 'track', singer: 'other、artist' }, { duetMode: 'all' }, 1],
  ['合唱仅主唱', '@artist', { name: 'track', singer: 'other、artist' }, { duetMode: 'primary' }, 1],
] as const) {
  test(`规则选项：${name}`, () => {
    const result = filterDisliked([candidate], parseDislikeRules(rules), (x: any) => x, options as any)
    assert.equal(result.length, expected)
  })
}

test('推荐过滤独立于普通列表隐藏开关', async () => {
  const method = between('    private async filterRecommendationEntries(', '    private async handleGetSimilarSongs')
  for (const hide of [false, true]) for (const exclude of [false, true]) {
    const context = vm.createContext({ global: { lx: { config: { 'subsonic.hideDisliked': hide, 'subsonic.dislikeNoRecommend': exclude } } } })
    vm.runInContext(transformSync(`class Harness {
      async getUserSubsonicMeta(){return {ratings:{}}}
      async filterDislikedEntries(_u, list) { return list.filter(x => x.music.id !== 'blocked') }
      musicToSongFlat(m) { return m }
      sendResponse(_res, data) { return data }
      ${method}
    }; globalThis.instance = new Harness()`, { loader: 'ts', format: 'cjs' }).code, context)
    const result = await (context as any).instance.renderRandomSongs({}, [{ music: { id: 'blocked' }, listId: 'default' }], 'json', 'randomSongs', 'alice')
    assert.equal(result.randomSongs.song.length, exclude ? 0 : 1)
  }
})

test('已知限制：同名歌曲规则不带来源，跨来源开关不能隔离歌曲规则', () => {
  const rules = parseDislikeRules('track@artist')
  for (const crossSource of [false, true]) {
    const result = filterDisliked([{ name: 'track', singer: 'artist', source: 'tx' }], rules, x => x, { crossSource })
    assert.equal(result.length, 0)
  }
})

test('手动正向同步把空解析计入失败，预览不写规则', async () => {
  const { instance, state, dm } = harness()
  state.ratings.missing = 1
  const preview = await instance.syncRatingsToDislike('alice', true)
  assert.equal(preview.candidates.length, 1)
  assert.equal(dm.dislikeRules.dislikeList.length, 0)
  assert.equal(state.snapshots, 0)
  const actual = await instance.syncRatingsToDislike('alice')
  assert.equal(actual.failed, 1)
  assert.equal(actual.added, 0)
})

test('手动正向补齐已有记录也必须保存快照并报告updated', async () => {
  const { instance, state, dm } = harness()
  const music = song('wy_1')
  await dm.addDislikeInfo([{ name: music.name, singer: music.singer, source: music.source, id: music.id }])
  instance.songs.set('wy_1', music); state.ratings.wy_1 = 1
  const actual = await instance.syncRatingsToDislike('alice')
  assert.equal(actual.added, 0)
  assert.equal(actual.updated, 1)
  assert.equal(state.snapshots, 1)
  assert.equal((dm.dislikeRules.dislikeList[0] as any).img, 'cover')
})


test('后台补分预览区分已有分、重复关联和真正待新增，快照失败返回警告',async()=>{
 const {instance,state}=harness();instance.songs.set('a',{...song('a'),name:'blocked'});instance.songs.set('b',{...song('b'),name:'blocked'});instance.songs.set('c',{...song('c'),name:'blocked'});state.aliases.b='a';state.ratings.a=5;
 const preview=await instance.syncDislikesToRating('alice',true);assert.equal(preview.candidates.length,1);assert.equal(preview.existing.length,1);assert.equal(preview.duplicates.length,1);assert.equal(state.ratings.c,undefined)
 ;(state as any).snapshotFailure=true;const result=await instance.syncDislikesToRating('alice');assert.equal(result.added,1);assert.equal(result.warning,'快照失败');assert.equal(state.ratings.a,5)
})
