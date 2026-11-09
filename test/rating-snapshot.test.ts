import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

/** 用 vm 注入受控的 global.lx 与 @/ 别名依赖，隔离文件系统的真实用户目录 */
const nodeRequire = createRequire(import.meta.url)
type Api = Record<string, any>

const load = (userPath: string, maxSnapshotNum = 3): Api => {
  const source = fs.readFileSync(path.resolve('src/server/ratingSnapshot.ts'), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' }).code
  const mod = { exports: {} as Api }
  const require = (id: string): any => {
    if (id === '@/user') return { getUserDirname: (u: string) => u }
    if (id === '@/user/data') return { getUserConfig: () => ({ maxSnapshotNum }) }
    return nodeRequire(id)
  }
  const context = vm.createContext({
    module: mod,
    exports: mod.exports,
    require,
    global: { lx: { userPath, config: { maxSnapshotNum } } },
    console,
    process,
    Buffer,
    __dirname: path.resolve('src/server'),
    __filename: path.resolve('src/server/ratingSnapshot.ts'),
  })
  vm.runInContext(code, context)
  return mod.exports
}

const withUser = async (maxSnapshotNum: number, fn: (api: Api, userDir: string) => Promise<void> | void) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-rating-snap-'))
  try {
    const userDir = path.join(root, 'alice')
    fs.mkdirSync(userDir, { recursive: true })
    await fn(load(root, maxSnapshotNum), userDir)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const metaFile = (userDir: string) => path.join(userDir, 'subsonic-meta.json')
const snapshotDir = (userDir: string) => path.join(userDir, 'rating', 'snapshot')
const infoFile = (userDir: string) => path.join(userDir, 'rating', 'snapshotInfo.json')
const writeMeta = (userDir: string, ratings: Record<string, number>) =>
  fs.writeFileSync(metaFile(userDir), JSON.stringify({ ratings, starredAlbums: [], starredArtists: [], starredArtistNames: [] }), 'utf8')
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

test('S4 快照 id：路径穿越与非法字符全部拒绝', async () => {
  await withUser(3, (api) => {
    for (const id of ['abc', '2026-11-08', 'a'.repeat(32), '用户备份']) {
      assert.equal(api.isValidSnapshotId(id), true, `应接受 ${id}`)
    }
    for (const id of ['', '.', '..', '../evil', 'a..b', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'x'.repeat(201), null, 1, {}, []]) {
      assert.equal(api.isValidSnapshotId(id), false, `应拒绝 ${String(id)}`)
    }
  })
})

test('S9 内容去重：同一评分只生成一份快照，复用时刷新 mtime', async () => {
  await withUser(3, async (api, userDir) => {
    writeMeta(userDir, { a: 3 })
    const id1 = await api.createRatingSnapshot('alice')
    const file = path.join(snapshotDir(userDir), `snapshot_${id1}`)
    assert.ok(fs.existsSync(file))
    const old = new Date(Date.now() - 10 * 86_400_000)
    fs.utimesSync(file, old, old)
    const id2 = await api.createRatingSnapshot('alice')
    assert.equal(id2, id1)
    assert.ok(fs.statSync(file).mtimeMs > old.getTime() + 5 * 86_400_000)
    writeMeta(userDir, { a: 5 })
    const id3 = await api.createRatingSnapshot('alice')
    assert.notEqual(id3, id1)
  })
})

test('S9 配额清理：只清超量的 auto 快照，imported 永久保留', async () => {
  await withUser(2, async (api, userDir) => {
    writeMeta(userDir, { a: 1 })
    const first = await api.createRatingSnapshot('alice')
    // 错开 mtime，避免同毫秒导致清理顺序不稳定
    fs.utimesSync(path.join(snapshotDir(userDir), `snapshot_${first}`), new Date(1), new Date(1))
    for (const star of [2, 3, 4]) {
      writeMeta(userDir, { a: star })
      const id = await api.createRatingSnapshot('alice')
      fs.utimesSync(path.join(snapshotDir(userDir), `snapshot_${id}`), new Date(star * 1000), new Date(star * 1000))
    }
    const imported = 'my-import.json'
    await api.saveRatingImport('alice', imported, { ratings: { z: 5 }, starredAlbums: [], starredArtists: [], starredArtistNames: [] }, Date.now() - 86_400_000)
    const list = plain(await api.listRatingSnapshots('alice'))
    assert.ok(fs.existsSync(path.join(snapshotDir(userDir), `snapshot_${imported}`)))
    assert.equal(list.filter((x: any) => x.origin === 'auto').length, 2, 'auto 快照应只保留最新 2 份')
    assert.equal(list.find((x: any) => x.id === imported)?.origin, 'imported')
    assert.equal(JSON.parse(fs.readFileSync(infoFile(userDir), 'utf8')).imported.includes(imported), true)
  })
})

test('S9 索引兼容：旧版 snapshotInfo 无 imported 字段时降级为空数组', async () => {
  await withUser(3, async (api, userDir) => {
    writeMeta(userDir, { a: 1 })
    fs.mkdirSync(snapshotDir(userDir), { recursive: true })
    fs.writeFileSync(infoFile(userDir), '{ not json', 'utf8')
    await api.createRatingSnapshot('alice')
    const list = plain(await api.listRatingSnapshots('alice'))
    assert.equal(list[0].origin, 'auto')
    fs.writeFileSync(infoFile(userDir), JSON.stringify({ unrelated: 1 }), 'utf8')
    assert.equal(plain(await api.listRatingSnapshots('alice'))[0].origin, 'auto')
  })
})

test('S9 meta 损坏降级为空评分；读写与删除、回滚幂等', async () => {
  await withUser(3, async (api, userDir) => {
    fs.writeFileSync(metaFile(userDir), '{ broken', 'utf8')
    const id = await api.createRatingSnapshot('alice')
    const meta = plain(await api.readRatingSnapshot('alice', id))
    assert.deepEqual(meta.ratings, {})
    assert.equal(await api.readRatingSnapshot('alice', 'missing'), null)
    assert.equal(await api.readRatingSnapshot('alice', '../evil'), null)
    assert.equal(await api.deleteRatingSnapshot('alice', 'missing'), false)
    await assert.rejects(() => api.restoreRatingSnapshot('alice', 'missing'), /not found/)

    writeMeta(userDir, { song: 4 })
    const target = 'user-backup'
    await api.saveRatingImport('alice', target, { ratings: { song: 1 }, starredAlbums: [], starredArtists: [], starredArtistNames: [] }, 0)
    await api.saveRatingImport('alice', target, { ratings: { song: 1 }, starredAlbums: [], starredArtists: [], starredArtistNames: [] }, 0)
    assert.equal(JSON.parse(fs.readFileSync(infoFile(userDir), 'utf8')).imported.length, 1, '重复导入不应重复登记')

    await api.restoreRatingSnapshot('alice', target)
    assert.equal(JSON.parse(fs.readFileSync(metaFile(userDir), 'utf8')).ratings.song, 1)
    assert.equal(await api.deleteRatingSnapshot('alice', target), true)
    assert.equal(JSON.parse(fs.readFileSync(infoFile(userDir), 'utf8')).imported.length, 0)
    await assert.rejects(() => api.saveRatingImport('alice', '../evil', {}, 0), /Invalid snapshot id/)
  })
})
