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
  const source = fs.readFileSync(path.resolve('src/server/rating/ratingSnapshot.ts'), 'utf8')
  const code = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' }).code
  const mod = { exports: {} as Api }
  const require = (id: string): any => {
    if (id === './ratingMigration' || id === '../../server/rating/ratingMigration') return nodeRequire(path.resolve('src/server/rating/ratingMigration.ts'))
    if (id === './ratingIdentityLock') return nodeRequire(path.resolve('src/server/rating/ratingIdentityLock.ts'))
    if (id === './ratingValidation') return nodeRequire(path.resolve('src/server/rating/ratingValidation.ts'))
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
    URL,
    __dirname: path.resolve('src/server'),
    __filename: path.resolve('src/server/rating/ratingSnapshot.ts'),
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

test('恢复评分快照保留当前收藏，并与并发写入串行', async () => {
  await withUser(3, async (api, userDir) => {
    writeMeta(userDir, { old: 1 })
    const id = await api.createRatingSnapshot('alice')
    const pending = api.withMetaLock('alice', async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      fs.writeFileSync(metaFile(userDir), JSON.stringify({ ratings: { newer: 5 }, starredAlbums: ['album'], starredArtists: ['artist'], starredArtistNames: ['name'] }))
    })
    await Promise.all([pending, api.restoreRatingSnapshot('alice', id)])
    const restored = JSON.parse(fs.readFileSync(metaFile(userDir), 'utf8'))
    assert.equal(restored.ratingHistory.old.at(-1).channel, 'snapshot-restore')
    delete restored.ratingHistory
    assert.deepEqual(restored, {
      ratings: { old: 1 }, ratingOrigins: {}, starredAlbums: ['album'], starredArtists: ['artist'], starredArtistNames: ['name'],
    })
  })
})

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

test('S9 meta 损坏阻止导出并保留原文件；读写与删除、回滚幂等', async () => {
  await withUser(3, async (api, userDir) => {
    fs.writeFileSync(metaFile(userDir), '{ broken', 'utf8')
    await assert.rejects(()=>api.createRatingSnapshot('alice'),/损坏/)
    assert.equal(fs.readFileSync(metaFile(userDir),'utf8'),'{ broken')
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


test('完整评分导出含描述及关联参照，回滚恢复描述而不覆盖收藏或文件关联',async()=>{
 await withUser(3,async(api,dir)=>{
  writeMeta(dir,{wy_1:4});fs.mkdirSync(path.join(dir,'rating'),{recursive:true})
  fs.writeFileSync(path.join(dir,'rating/songs.json'),JSON.stringify({wy_1:{name:'晴天',img:'https://example.com/a.jpg'}}))
  const registry=JSON.stringify({tracks:{a:{id:'local_a',filename:'a.wav',platformId:'wy_1'}}})
  fs.writeFileSync(path.join(dir,'subsonic-local-registry.json'),registry)
  const exported=api.exportRatingBackup('alice');assert.equal(exported.ratingCatalog.wy_1.name,'晴天');assert.equal(exported.localLinks[0].platformId,'wy_1')
  const id=await api.createRatingSnapshot('alice')
  fs.writeFileSync(path.join(dir,'rating/songs.json'),'{}');writeMeta(dir,{wy_1:1})
  await api.restoreRatingSnapshot('alice',id)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'rating/songs.json'),'utf8')).wy_1.name,'晴天')
  assert.equal(fs.readFileSync(path.join(dir,'subsonic-local-registry.json'),'utf8'),registry)
  assert.deepEqual(plain(api.normalizeRatingMeta({ratings:{a:6,b:'3',c:0,d:2}}).ratings),{d:2})
 })
})


test('恢复第二个文件失败时回滚歌曲描述与评分，不留下半恢复状态',async()=>{
 await withUser(3,async(api,dir)=>{
  writeMeta(dir,{wy_1:1});fs.mkdirSync(path.join(dir,'rating'),{recursive:true});const catalog=path.join(dir,'rating/songs.json');fs.writeFileSync(catalog,JSON.stringify({wy_1:{name:'旧描述'}}));const id=await api.createRatingSnapshot('alice')
  writeMeta(dir,{wy_1:5});fs.writeFileSync(catalog,JSON.stringify({wy_1:{name:'当前描述'}}));const before=fs.readFileSync(metaFile(dir),'utf8')
  const rename=fs.renameSync;let failed=false
  try {
   fs.renameSync=((from:any,to:any)=>{if(!failed&&String(to)===metaFile(dir)&&String(from).endsWith('.transaction.tmp')){failed=true;throw Error('模拟写入失败')}return rename(from,to)}) as any
   await assert.rejects(()=>api.restoreRatingSnapshot('alice',id),/模拟写入失败/)
  }finally{fs.renameSync=rename}
  assert.equal(fs.readFileSync(metaFile(dir),'utf8'),before);assert.equal(JSON.parse(fs.readFileSync(catalog,'utf8')).wy_1.name,'当前描述')
 })
})


test('评分历史导入只保留有效事件并限制30条，异常结构不会进入展示数据',async()=>{
 await withUser(3,async(api)=>{
  const bad=api.normalizeRatingMeta({ratings:{wy_1:4},ratingHistory:{wy_1:{broken:true},wy_2:[null,{},'bad',{from:0,to:9,at:1,channel:'web'}],wy_3:Array.from({length:50},(_,n)=>({from:0,to:4,at:n+1,channel:'web',url:'secret'}))}})
  assert.equal(bad.ratingHistory.wy_1,undefined);assert.equal(bad.ratingHistory.wy_2.length,0);assert.equal(bad.ratingHistory.wy_3.length,30);assert.equal(bad.ratingHistory.wy_3[0].url,undefined)
 })
})

test('恢复旧本地快照返回前完成身份迁移',async()=>{
 await withUser(3,async(api,dir)=>{
  writeMeta(dir,{local_old:2});const id=await api.createRatingSnapshot('alice')
  fs.writeFileSync(path.join(dir,'subsonic-local-registry.json'),JSON.stringify({tracks:{file:{id:'local_old',platformId:'wy_online'}}}))
  writeMeta(dir,{wy_online:5})
  await api.restoreRatingSnapshot('alice',id)
  const data=JSON.parse(fs.readFileSync(metaFile(dir),'utf8'))
  assert.equal(data.ratings.local_old,undefined);assert.equal(data.ratings.wy_online,2)
  assert.ok(!fs.existsSync(path.join(dir,'rating/transaction.json')))
 })
})
