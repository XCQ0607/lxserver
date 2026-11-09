import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

/** 从 subsonic.ts 抽出评分歌单的两个私有方法，隔离其余依赖后放进 vm 执行 */
const source = fs.readFileSync(path.resolve('src/server/integrations/subsonic.ts'), 'utf8')
const start = source.indexOf('    private async getRatingPlaylistSongs')
const end = source.indexOf('    private async handleGetPlaylists', start)
assert.ok(start > 0 && end > start, '无法从 subsonic.ts 中定位评分歌单方法')
const methods = source.slice(start, end)

const harness = `
class Harness {
  onlineSongCache = new Map()
  meta = { ratings: {} }
  listData = { loveList: [], defaultList: [], userList: [] }
  disliked = new Set()
  loadOnlineSongCache() {}
  async getUserSubsonicMeta() { return this.meta }
  async getSubsonicListData() { return this.listData }
  async filterDislikedSongs(_u, arr) { return arr.filter(m => !this.disliked.has(m.id)) }
${methods}
}
globalThis.Harness = Harness
`

const build = (ratingPlaylists: boolean | undefined = undefined) => {
  const config: Record<string, any> = {}
  if (ratingPlaylists !== undefined) config['subsonic.ratingPlaylists'] = ratingPlaylists
  const context = vm.createContext({
    global: { lx: { config } },
    getLocalTracks: async () => [],
    localMusic: (x: any) => x,
    console,
  })
  vm.runInContext(transformSync(harness, { loader: 'ts', format: 'cjs', target: 'node20' }).code, context)
  return { instance: new (context as any).Harness(), config }
}

const song = (id: string) => ({ id, name: id })

test('S5 ratings 值域：非整数 / 越界 / 字符串评分不得让 getPlaylists 抛错', async () => {
  const { instance } = build()
  instance.meta = { ratings: { a: 1.5, b: 2.1, c: 0, d: 6, e: -1, f: '3', g: null, h: NaN, good: 3 } }
  instance.listData = {
    loveList: [],
    defaultList: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'good'].map(song),
    userList: [],
  }
  const groups = await instance.getRatingPlaylistSongs('alice')
  assert.equal(groups.get(3).length, 1, '只有整数 3 应进入 3 星歌单')
  for (const star of [1, 2, 4, 5]) assert.equal(groups.get(star).length, 0)
})

test('S8 开关：默认开启，显式 false 关闭', () => {
  assert.equal(build().instance.isRatingPlaylistEnabled(), true)
  assert.equal(build(true).instance.isRatingPlaylistEnabled(), true)
  assert.equal(build(false).instance.isRatingPlaylistEnabled(), false)
})

test('S8 1 星歌单 = 1 星歌曲 ∪ dislike 命中；关闭开关后不再并入', async () => {
  const enabled = build(true)
  enabled.instance.meta = { ratings: { a: 1 } }
  enabled.instance.listData = { loveList: [], defaultList: [song('a'), song('b')], userList: [] }
  enabled.instance.disliked = new Set(['b'])
  const on = await enabled.instance.getRatingPlaylistSongs('alice')
  assert.deepEqual(Array.from(on.get(1)).map((m: any) => m.id).sort(), ['a', 'b'])

  const disabled = build(false)
  disabled.instance.meta = { ratings: { a: 1 } }
  disabled.instance.listData = { loveList: [], defaultList: [song('a'), song('b')], userList: [] }
  disabled.instance.disliked = new Set(['b'])
  const off = await disabled.instance.getRatingPlaylistSongs('alice')
  assert.deepEqual(Array.from(off.get(1)).map((m: any) => m.id), ['a'])
})

test('S8 只读语义与配置契约：虚拟歌单不得被写入或删除', () => {
  assert.match(source, /RATING_PLAYLIST_PREFIX = 'rating_'/)
  assert.match(source, /if \(this\.isRatingPlaylistEnabled\(\)\)/)
  assert.match(source, /评星歌单为只读播放列表，请通过给歌曲评星来修改/)
  assert.match(source, /评星歌单为只读播放列表，不支持删除/)
  assert.match(source, /Rating playlists are disabled/)
  assert.match(source, /linkToDislike = .*\|\| this\.isRatingPlaylistEnabled\(\)/)
  const defaults = fs.readFileSync(path.resolve('src/defaultConfig.ts'), 'utf8')
  assert.match(defaults, /'subsonic\.ratingPlaylists': true/)
})

/** 从 handleGetPlaylists 抽出「生成评星歌单」的真实代码块，验证空星级是否会被跳过 */
const blockStart = source.indexOf('        // [新增] 评星歌单：1~5 星')
const blockEnd = source.indexOf("        if (format === 'json')", blockStart)
assert.ok(blockStart > 0 && blockEnd > blockStart, '无法从 subsonic.ts 中定位评星歌单生成块')
const ratingPlaylistBlock = source.slice(blockStart, blockEnd)

const playlistHarness = `
class PlaylistHarness {
  constructor(groups, enabled) {
    this.groups = groups
    this.enabled = enabled
    this.playlists = []
  }
  isRatingPlaylistEnabled() { return this.enabled }
  async getRatingPlaylistSongs() { return this.groups }
  async run() {
    const playlists = this.playlists
    const buildPlaylist = (id, name, musics) => ({ id, name, songCount: musics.length })
    const username = 'alice'
    const subsonicLog = { error() {} }
    const SubsonicHandler = { RATING_PLAYLIST_PREFIX: 'rating_' }
${ratingPlaylistBlock}
    return playlists
  }
}
globalThis.PlaylistHarness = PlaylistHarness
`

const buildPlaylists = async (counts: Record<number, number>, enabled = true): Promise<Array<{ id: string, name: string, songCount: number }>> => {
  const groups = new Map<number, any[]>()
  for (let star = 1; star <= 5; star++) {
    groups.set(star, Array.from({ length: counts[star] || 0 }, (_, i) => song(`${star}-${i}`)))
  }
  const context = vm.createContext({ console })
  vm.runInContext(transformSync(playlistHarness, { loader: 'ts', format: 'cjs', target: 'node20' }).code, context)
  const instance = new (context as any).PlaylistHarness(groups, enabled)
  // vm 里的数组来自另一个 realm，deepStrictEqual 会因原型不同而误判；先转成主 realm 的普通对象。
  return JSON.parse(JSON.stringify(await instance.run()))
}

test('S18 空星级不生成歌单：只暴露有歌曲的星级', async () => {
  const list = await buildPlaylists({ 1: 1, 3: 2 })
  assert.deepEqual(list.map(p => p.id), ['rating_1', 'rating_3'])
  assert.deepEqual(list.map(p => p.songCount), [1, 2])
  assert.match(list[0].name, /我不喜欢/)
})

test('S18 五个星级都为空时不生成任何评星歌单', async () => {
  assert.deepEqual(await buildPlaylists({}), [])
})

test('S18 关闭开关时不生成评星歌单', async () => {
  assert.deepEqual(await buildPlaylists({ 5: 1 }, false), [])
})

test('S18 五个星级都有歌曲时全部保留且顺序固定', async () => {
  const list = await buildPlaylists({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 })
  assert.deepEqual(list.map(p => p.id), ['rating_1', 'rating_2', 'rating_3', 'rating_4', 'rating_5'])
  assert.ok(list.every(p => p.songCount === 1))
})
