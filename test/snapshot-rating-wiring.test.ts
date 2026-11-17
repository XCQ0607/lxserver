import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'

/**
 * 从真实源码抽出两段可独立执行的逻辑：
 *  1. server.ts 顶层的备份类型判定 / playList_v2 转换（上传快照分流的核心）
 *  2. /api/subsonic/sync-link 路由的业务校验与分流
 * 另外用 public/app.js 的真实判定表达式做前后端口径一致性校验，防止两类目录写串。
 */
const serverSource = fs.readFileSync(path.resolve('src/server/server.ts'), 'utf8')
const appSource = fs.readFileSync(path.resolve('public/app.js'), 'utf8')

const slice = (from: string, to: string): string => {
  const start = serverSource.indexOf(from)
  const end = serverSource.indexOf(to, start + from.length)
  assert.ok(start >= 0 && end > start, `无法从 server.ts 定位 ${from} ~ ${to}`)
  return serverSource.slice(start, end)
}

const runInVm = <T>(code: string, context: Record<string, unknown>, exportExpr: string): T => {
  const sandbox = vm.createContext({ console, ...context })
  vm.runInContext(transformSync(`${code}\nglobalThis.__export = ${exportExpr}`, {
    loader: 'ts', format: 'cjs', target: 'node20',
  }).code, sandbox)
  return (sandbox as any).__export as T
}

const kindBlock = slice('type SnapshotKind = ', 'async function validateOpenListConfig')
const kindApi = runInVm<{
  detectSnapshotKind: (parsed: unknown) => 'list' | 'dislike' | 'rating'
  toInternalListSnapshot: (parsed: unknown) => string | null
}>(kindBlock, {}, '{ detectSnapshotKind, toInternalListSnapshot }')

/** public/app.js 中真实的 isRatingBackup / kindLabel 判定，注入同一批样本比对 */
const frontStart = appSource.indexOf('        const isRatingBackup = ')
const frontEnd = appSource.indexOf('        // 目标用户由超管', frontStart)
assert.ok(frontStart >= 0 && frontEnd > frontStart, '无法从 public/app.js 定位导入类型判定')
const frontKind = new Function('jsonData', `${appSource.slice(frontStart, frontEnd)}\nreturn kindLabel`) as (data: unknown) => string

const samples: Array<{ name: string, value: unknown, kind: 'list' | 'dislike' | 'rating' }> = [
  { name: '非 JSON / 空值', value: null, kind: 'list' },
  { name: '原生歌单快照', value: { defaultList: [{ id: 'a' }], loveList: [], userList: [] }, kind: 'list' },
  { name: 'playList_v2 离线备份', value: { type: 'playList_v2', data: [{ id: 'default', list: [] }, { id: 'love', list: [] }] }, kind: 'list' },
  { name: '原生不喜欢快照', value: { dislikeList: ['a@歌手@歌曲'] }, kind: 'dislike' },
  { name: 'lxRating_v1 评分快照', value: { type: 'lxRating_v1', ratings: { a: 5 }, starredAlbums: [] }, kind: 'rating' },
  { name: '旧版评分快照（无 type）', value: { ratings: { a: 3 }, starredAlbums: [], starredArtists: [], starredArtistNames: [] }, kind: 'rating' },
  { name: 'type 优先于 dislikeList', value: { type: 'lxRating_v1', ratings: {}, dislikeList: [] }, kind: 'rating' },
  { name: '歌单字段优先于 ratings', value: { ratings: { a: 1 }, defaultList: [] }, kind: 'list' },
  { name: '空对象', value: {}, kind: 'list' },
  { name: '数组', value: [], kind: 'list' },
  { name: '字符串', value: 'not an object', kind: 'list' },
]

test('S19 备份类型判定：歌单 / 不喜欢 / 评分三类分流', () => {
  for (const s of samples) {
    assert.equal(kindApi.detectSnapshotKind(s.value), s.kind, `样本「${s.name}」应判为 ${s.kind}`)
  }
})

test('S19 前后端导入类型判定口径一致（避免上传到错误目录）', () => {
  const label: Record<string, string> = { list: '我的歌单', dislike: '我不喜欢', rating: '我的评分' }
  for (const s of samples) {
    assert.equal(frontKind(s.value), label[kindApi.detectSnapshotKind(s.value)], `样本「${s.name}」前后端判定不一致`)
  }
})

test('S19 playList_v2 转回内部结构：default / love / 其余列表', () => {
  const converted = kindApi.toInternalListSnapshot({
    type: 'playList_v2',
    data: [
      { id: 'default', list: [{ id: 'd' }] },
      { id: 'love', list: [{ id: 'l' }] },
      { id: 'custom', list: [{ id: 'c' }] },
    ],
  })
  assert.ok(converted)
  assert.deepEqual(JSON.parse(converted), {
    defaultList: [{ id: 'd' }],
    loveList: [{ id: 'l' }],
    userList: [{ id: 'custom', list: [{ id: 'c' }] }],
  })
})

test('S19 playList_v2 转换：非该格式返回 null，残缺 data 不抛异常', () => {
  assert.equal(kindApi.toInternalListSnapshot(null), null)
  assert.equal(kindApi.toInternalListSnapshot({ type: 'lxRating_v1', ratings: {} }), null)
  assert.equal(kindApi.toInternalListSnapshot({ type: 'playList_v2', data: 'bad' }), null)
  const partial = kindApi.toInternalListSnapshot({ type: 'playList_v2', data: [null, { id: 'default', list: [] }] })
  assert.ok(partial)
  assert.deepEqual(JSON.parse(partial).defaultList, [])
})

const syncLinkBody = slice(
  '          const { user, direction, preview, reconcile } = JSON.parse(await readBody(req))',
  '        } catch (err: any) {',
)

const runSyncLink = async (options: {
  body: unknown
  config?: Record<string, unknown>
  users?: string[]
}): Promise<{ ok: boolean, payload?: any, error?: string }> => {
  const written: string[] = []
  const res = { writeHead: () => {}, end: (text: string) => written.push(text) }
  const config = {
    users: (options.users ?? ['alice']).map(name => ({ name })),
    ...options.config,
  }
  const context = {
    req: {},
    global: { lx: { config } },
    readBody: async () => JSON.stringify(options.body),
    syncRatingsToDislike: async (user: string) => ({ direction: 'ratingToDislike', user, scanned: 1, added: 1, skipped: 0, failed: 0, threshold: 1, batches: 1 }),
    syncDislikesToRating: async (user: string) => ({ direction: 'dislikeToRating', user, scanned: 2, added: 0, skipped: 2, failed: 0, threshold: 1, batches: 1 }),
    res,
  }
  const run = runInVm<(user?: string) => Promise<void>>(
    `async function run() {\n${syncLinkBody}\n}`,
    context,
    'run',
  )
  try {
    await run()
    return { ok: true, payload: written.length ? JSON.parse(written[0]) : null }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

test('S20 /api/subsonic/sync-link：非法 direction / 缺用户被拒绝', async () => {
  const badDirection = await runSyncLink({ body: { user: 'alice', direction: 'unknown' } })
  assert.equal(badDirection.ok, false)
  assert.match(badDirection.error || '', /Invalid direction/)

  const noUser = await runSyncLink({ body: { direction: 'ratingToDislike' } })
  assert.equal(noUser.ok, false)
  assert.match(noUser.error || '', /Missing user/)
})

test('S20 /api/subsonic/sync-link：开关未开启时不得执行同步', async () => {
  const result = await runSyncLink({ body: { user: 'alice', direction: 'ratingToDislike' } })
  assert.equal(result.ok, false, '服务端必须独立校验开关，不能只依赖前端')
  assert.match(result.error || '', /联动开关未开启/)
})

test('S20 /api/subsonic/sync-link：未知用户不得创建用户空间', async () => {
  const result = await runSyncLink({
    body: { user: 'mallory', direction: 'ratingToDislike' },
    config: { 'subsonic.linkRatingToDislike': true },
  })
  assert.equal(result.ok, false)
  assert.match(result.error || '', /用户不存在/)
})

test('S20 /api/subsonic/sync-link：两个方向分别调用对应同步实现', async () => {
  const forward = await runSyncLink({
    body: { user: 'alice', direction: 'ratingToDislike' },
    config: { 'subsonic.linkRatingToDislike': true },
  })
  assert.equal(forward.ok, true, forward.error)
  assert.equal(forward.payload.direction, 'ratingToDislike')
  assert.equal(forward.payload.added, 1)

  const backward = await runSyncLink({
    body: { user: 'bob', direction: 'dislikeToRating' },
    config: { 'subsonic.linkDislikeToRating': true },
    users: ['alice', 'bob'],
  })
  assert.equal(backward.ok, true, backward.error)
  assert.equal(backward.payload.direction, 'dislikeToRating')
  assert.equal(backward.payload.user, 'bob')
})

test('S20 /api/subsonic/sync-link：_open 公开用户同样允许同步', async () => {
  const result = await runSyncLink({
    body: { user: '_open', direction: 'ratingToDislike' },
    config: { 'subsonic.linkRatingToDislike': true },
  })
  assert.equal(result.ok, true, result.error)
  assert.equal(result.payload.user, '_open')
})
