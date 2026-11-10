import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

const source = fs.readFileSync('src/server/integrations/subsonic.ts', 'utf8')
const start = source.indexOf('    private async handleSetRating(')
const end = source.indexOf('    private async handleGetStarred(', start)
const reverseStart = source.indexOf('export async function syncDislikeToRating(')
const reverseEnd = source.indexOf('/**', reverseStart)
function build(config: Record<string, any> = {}) {
  const state = { ratings: {} as Record<string, number>, adds: 0, removes: 0, snapshots: 0, fail: false }
  const context = vm.createContext({
    global: { lx: { config } }, state,
    withTimeout: (promise:any) => promise, LINK_SYNC_ITEM_TIMEOUT_MS:8000,
    resolveStoredRatingId: async (_u: string, id: string) => id,
    withRatingIdentityLock: async (_u: string, fn: () => any) => fn(),
    withMetaLock: async (_u: string, fn: () => any) => fn(),
    createRatingSnapshot: async () => { state.snapshots++ },
    writeRating: async (_u: string, id: string, rating: number, channel:string, _song:any, options:any={}) => { if (state.fail && channel==='web-dislike-link') throw Error('disk failure');if(options.onlyMissing&&state.ratings[id]>0)return {id,meta:{ratings:state.ratings},unchanged:true};if (rating) state.ratings[id] = rating; else delete state.ratings[id]; state.snapshots++; return { id, meta: { ratings: state.ratings } } },
    readSubsonicMeta: () => ({ ratings: state.ratings }),
    writeSubsonicMeta: (_u: string, meta: any) => { if (state.fail) throw Error('disk failure'); state.ratings = meta.ratings },
    subsonicLog: { debug() {}, warn() {}, error() {} },
  })
  vm.runInContext(transformSync(`
class Harness {
  userRatingsCache = new Map()
  async getUserSubsonicMeta() { return { ratings: state.ratings } }
  async saveUserSubsonicMeta(_u, meta) { state.ratings = meta.ratings }
  async resolveSongMeta() {return null}
  async getRatingMetadata() {return null}
  async resolveDislikeTarget() { if (state.fail) throw Error('offline'); return { infos: [{ name: 'song' }], keys: new Set(['song']) } }
  async addDislikeRules() { state.adds++; return 1 }
  async removeDislikeRules() { state.removes++; return 1 }
  sendResponse() { return { ok: true } }
  sendError(_r, _code, message) { return { ok: false, message } }
${source.slice(source.indexOf('    async applyRatingLink('), start)}
${source.slice(start, end)}
}
${source.slice(reverseStart, reverseEnd).replace('export async', 'async')}
globalThis.instance = new Harness()
globalThis.reverse = syncDislikeToRating
`, { loader: 'ts', format: 'cjs' }).code, context)
  return { state, instance: (context as any).instance, reverse: (context as any).reverse }
}

test('评分歌单开启也不能绕过关闭的正向联动', async () => {
  const { state, instance } = build({ 'subsonic.ratingPlaylists': true, 'subsonic.linkRatingToDislike': false })
  await instance.handleSetRating({}, 'alice', new URLSearchParams({ id: 'wy_1', rating: '1' }), 'json')
  assert.equal(state.ratings.wy_1, 1)
  assert.equal(state.snapshots, 1)
  assert.equal(state.adds, 0)
})

test('联动仅补充低分规则，提高或清除评分不删除手工规则', async () => {
  const { state, instance } = build({ 'subsonic.linkRatingToDislike': true })
  for (const rating of ['1', '5', '0']) await instance.handleSetRating({}, 'alice', new URLSearchParams({ id: 'wy_1', rating }), 'json')
  assert.equal(state.adds, 1)
  assert.equal(state.removes, 0)
  assert.equal(state.ratings.wy_1, undefined)
})

test('联动解析失败返回部分成功提示，评分保留供重试', async () => {
  const { state, instance } = build({ 'subsonic.linkRatingToDislike': true })
  state.fail = true
  const result = await instance.handleSetRating({}, 'alice', new URLSearchParams({ id: 'wy_1', rating: '1' }), 'json')
  assert.equal(result.ok, false)
  assert.match(result.message, /评分已保存/)
  assert.equal(state.ratings.wy_1, 1)
})

test('反向联动保留高分，取消不喜欢保留评分，仅缺失评分补 1 星', async () => {
  const { state, reverse } = build()
  state.ratings.wy_1 = 5
  await reverse('alice', 'wy_1', 1)
  await reverse('alice', 'wy_1', 0)
  assert.equal(state.ratings.wy_1, 5)
  await reverse('alice', 'wy_2', 1)
  assert.equal(state.ratings.wy_2, 1)
})

for (const threshold of [0, 1, 2]) {
  for (const enabled of [false, true]) {
    for (const visible of [false, true]) {
      test(`开关矩阵：阈值 ${threshold} 联动 ${enabled} 评分歌单 ${visible}`, async () => {
        const { state, instance } = build({ 'subsonic.dislikeRating': threshold, 'subsonic.linkRatingToDislike': enabled, 'subsonic.ratingPlaylists': visible })
        await instance.handleSetRating({}, 'alice', new URLSearchParams({ id: 'wy_1', rating: '2' }), 'json')
        assert.equal(state.ratings.wy_1, 2)
        assert.equal(state.adds, enabled && threshold >= 2 ? 1 : 0)
        assert.equal(state.snapshots, 1)
      })
    }
  }
}

test('Web歌手/专辑不喜欢不能被误写成歌曲评分', async () => {
  const server = fs.readFileSync('src/server/server.ts', 'utf8')
  const start = server.indexOf('            const dislikeAutoRating =')
  const end = server.indexOf('            if (!isAdd && removeKeys.size', start)
  assert.ok(start >= 0 && end > start)
  for (const type of ['song', 'singer', 'album']) {
    const calls: any[] = []
    const context = vm.createContext({
      readRatingPreferences: () => ({ dislikeAutoRating: true }),
      readRatings: () => ({ ratings: {} }),
      type, id: 'real-id', source: 'tx', verified: 'test', isAdd: true,
      global: { lx: { config: { 'subsonic.linkDislikeToRating': true, 'subsonic.dislikeRating': 1 } } },
      payload: { id: 'real-id', source: 'tx' }, resolveRatingId: async () => 'tx_real-id',
      require: () => ({ syncDislikeToRating: async (...args: any[]) => calls.push(args) }), console,
    })
    await vm.runInContext(transformSync(`(async () => { ${server.slice(start, end)} })()`, { loader: 'ts', format: 'cjs' }).code, context)
    assert.equal(calls.length, type === 'song' ? 1 : 0)
    if (type === 'song') assert.deepEqual(calls[0].slice(0,3), ['test', 'tx_real-id', 1])
  }
})


test('自动补分写盘失败向调用方抛出，不伪报成功',async()=>{
 const {state,reverse}=build();state.fail=true;await assert.rejects(()=>reverse('alice','wy_1',1),/disk failure/)
})
