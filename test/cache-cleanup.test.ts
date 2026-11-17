import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanupCacheDirectory, collectCacheMediaAsync, CacheUsageGuard } from '../src/server/music/cacheCleanup'

const day = 86400000
const now = Date.now()
const fixture = (t: any) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cache-cleanup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const put = (name: string, size = 100, age = 30) => {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.alloc(size))
    fs.utimesSync(file, new Date(now - age * day), new Date(now - age * day))
    return file
  }
  const deleted: string[] = []
  const clean = (options: { limitBytes?: number, retentionMs?: number, protectedPaths?: Set<string> } = {}) => cleanupCacheDirectory(path.join(root, 'cache'), {
    now, protectedPaths: new Set(), onDeleted: file => { deleted.push(file) }, ...options,
  })
  return { root, put, deleted, clean }
}

test('recursive media statistics and cleanup exclude downloads, indexes and partial files', async t => {
  const f = fixture(t)
  const audio = f.put('cache/u/album/song.ape')
  const lyric = f.put('cache/u/album/song.lrc', 20)
  const safe = ['music/u/song.mp3', 'cache/u/cache_index.json', 'cache/u/active.tmp', 'cache/u/readme.txt'].map(name => f.put(name))
  assert.equal((await collectCacheMediaAsync(path.join(f.root, 'cache'))).reduce((sum, file) => sum + file.size, 0), 120)
  assert.equal((await f.clean({ limitBytes: 50 })).totalSize, 0)
  assert.deepEqual(new Set(f.deleted), new Set([audio, lyric]))
  safe.forEach(file => assert.ok(fs.existsSync(file)))
})

test('size policy retains recently accessed files and deletes the least recently used pair', async t => {
  const f = fixture(t)
  const old = f.put('cache/old.mp3', 100, 30)
  const lyric = f.put('cache/old.lrc', 10, 30)
  const recent = f.put('cache/recent.mp3', 100, 40)
  fs.utimesSync(recent, new Date(now), new Date(now - 40 * day))
  await f.clean({ limitBytes: 150 })
  assert.deepEqual(new Set(f.deleted), new Set([old, lyric]))
  assert.ok(fs.existsSync(recent))
})

test('expiration protects an entire pair if either file was recently accessed', async t => {
  const f = fixture(t)
  const audio = f.put('cache/song.mp3')
  const lyric = f.put('cache/song.lrc', 10, 1)
  await f.clean({ retentionMs: 14 * day })
  assert.ok(fs.existsSync(audio) && fs.existsSync(lyric))
  assert.equal(f.deleted.length, 0)
})

test('both policies protect pending backup pairs', async t => {
  for (const options of [{ limitBytes: 1 }, { retentionMs: 14 * day }]) {
    const f = fixture(t)
    const audio = f.put('cache/song.mp3')
    const lyric = f.put('cache/song.lrc')
    await f.clean({ ...options, protectedPaths: new Set([audio]) })
    assert.ok(fs.existsSync(audio) && fs.existsSync(lyric))
  }
})

test('zero retention disables expiration but does not disable size limits', async t => {
  const f = fixture(t)
  const file = f.put('cache/song.mp3')
  await f.clean({ retentionMs: 0 })
  assert.ok(fs.existsSync(file))
  await f.clean({ retentionMs: 0, limitBytes: 50 })
  assert.ok(!fs.existsSync(file))
})

test('expiration removes old audio and lyrics together and reports every deletion', async t => {
  const f = fixture(t)
  const files = [f.put('cache/a/song.flac'), f.put('cache/a/song.lrc'), f.put('cache/orphan.lrc')]
  const result = await f.clean({ retentionMs: 14 * day })
  assert.equal(result.deletedCount, 3)
  assert.deepEqual(new Set(f.deleted), new Set(files))
})

test('directory links cannot extend cleanup into a download directory', async t => {
  const f = fixture(t)
  const safe = f.put('music/song.mp3')
  fs.mkdirSync(path.join(f.root, 'cache'))
  fs.symlinkSync(path.join(f.root, 'music'), path.join(f.root, 'cache', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await f.clean({ limitBytes: 1, retentionMs: day })
  assert.ok(fs.existsSync(safe))
  assert.equal(f.deleted.length, 0)
})

test('active transfers and their handoff window protect only their own audio/lyric group', async t => {
  const f = fixture(t)
  let clock = 0
  const guard = new CacheUsageGuard(() => clock)
  const audio = f.put('cache/song.mp3')
  const lyric = f.put('cache/song.lrc')
  const other = f.put('cache/other.mp3')
  const release = guard.acquire(audio)
  const clean = () => cleanupCacheDirectory(path.join(f.root, 'cache'), {
    limitBytes: 1, protectedPaths: new Set(), isProtected: file => guard.protects(file), onDeleted: () => {},
  })
  await clean()
  assert.ok(fs.existsSync(audio) && fs.existsSync(lyric))
  assert.ok(!fs.existsSync(other))
  release()
  release() // Releasing twice must not corrupt the active count.
  clock = 29999
  await clean()
  assert.ok(fs.existsSync(audio) && fs.existsSync(lyric))
  clock = 30001
  await clean()
  assert.ok(!fs.existsSync(audio) && !fs.existsSync(lyric))
})

test('backup protection is refreshed after asynchronous traversal and between deletion batches', async t => {
  const f = fixture(t)
  const protectedFile = f.put('cache/protected.mp3')
  for (let i = 0; i < 70; i++) f.put(`cache/${i}.mp3`)
  let refreshes = 0
  let yielded = false
  setImmediate(() => { yielded = true })
  await cleanupCacheDirectory(path.join(f.root, 'cache'), {
    limitBytes: 1, protectedPaths: new Set(),
    refreshProtectedPaths: () => { refreshes++; return new Set([protectedFile]) },
    onDeleted: () => { assert.ok(yielded) },
  })
  assert.ok(refreshes >= 3)
  assert.ok(fs.existsSync(protectedFile))
})
