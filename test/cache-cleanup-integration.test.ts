import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'
import { AsyncLocalStorage } from 'node:async_hooks'
import { cleanupCacheDirectory, CacheUsageGuard } from '../src/server/music/cacheCleanup'
import defaultConfig from '../src/defaultConfig'

// Execute the production orchestration without starting the server/native audio SDK.
const source = fs.readFileSync(path.join(__dirname, '../src/server/music/fileCache.ts'), 'utf8')
const orchestration = stripTypeScriptTypes(source.slice(source.indexOf('const cacheCleanupJobs ='), source.indexOf('// 启动 5 秒后')).replaceAll('export const', 'const'))

test('sweeps isolate both cache locations/users, update indexes and notify backup deletion', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cache-policy-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bases = { root: path.join(root, 'working'), data: path.join(root, 'data') }
  const indexes = new Map<string, Map<string, any>>()
  const notifications: string[] = []
  const protectedPaths = new Set<string>()
  const getDir = (user: string, music = false, location = 'root') => path.join(bases[location as keyof typeof bases], music ? 'music' : 'cache', user)
  const put = (user: string, location: string, music = false) => {
    const dir = getDir(user, music, location)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'song.mp3')
    fs.writeFileSync(file, 'audio')
    fs.writeFileSync(path.join(dir, 'song.lrc'), 'lyrics')
    fs.writeFileSync(path.join(dir, 'active.tmp'), 'partial')
    fs.utimesSync(file, new Date(0), new Date(0))
    fs.utimesSync(path.join(dir, 'song.lrc'), new Date(0), new Date(0))
    if (!music) indexes.set(`${location}:${user}`, new Map([['song', { filename: 'song.mp3', lyricFilename: 'song.lrc', hasLyric: true }]]))
    return file
  }
  const expired = put('alice', 'root')
  const protectedFile = put('alice', 'data')
  protectedPaths.add(protectedFile)
  const otherUser = put('bob', 'data')
  const music = put('alice', 'root', true)
  const lx = {
    dataPath: bases.data, config: { ...defaultConfig, 'cache.maxAgeDays': 14 },
    getActiveBackupLocalPaths: () => protectedPaths,
    softDeleteLocalFileByPath: (file: string) => notifications.push(file),
  }
  const context: any = { fs, path, console, global: { lx }, lx, process: { cwd: () => bases.root },
    CACHE_ROOTS: { ROOT: 'root', DATA: 'data' }, getCacheDir: getDir,
    cleanupCacheDirectory, cacheUsageGuard: new CacheUsageGuard(), getUserCacheLocation: () => 'root', isRemasterStage: () => false,
    indexManager: {
      load: (user: string, folder: string, location: string) => indexes.get(`${location}:${user}`),
      save: (user: string, folder: string, location: string) => fs.writeFileSync(path.join(getDir(user, false, location), 'cache_index.json'), JSON.stringify(Object.fromEntries(indexes.get(`${location}:${user}`)!))),
    },
  }
  vm.createContext(context)
  vm.runInContext(orchestration + ';global.run = cleanupAllCaches', context)
  await context.global.run()
  assert.ok(!fs.existsSync(expired) && !fs.existsSync(otherUser))
  assert.ok(fs.existsSync(protectedFile) && fs.existsSync(music))
  assert.equal(indexes.get('root:alice')!.size, 0)
  assert.equal(indexes.get('data:bob')!.size, 0)
  assert.equal(indexes.get('data:alice')!.size, 1)
  assert.equal(fs.readFileSync(path.join(path.dirname(expired), 'cache_index.json'), 'utf8'), '{}')
  assert.ok(fs.existsSync(path.join(path.dirname(expired), 'active.tmp')))
  assert.equal(notifications.length, 4)
  assert.ok(!notifications.includes(protectedFile))
})

test('retention is present in the startup configuration allowlist', () => {
  assert.equal(defaultConfig['cache.maxAgeDays'], 14)
})

test('production index loader preserves the Map held by a suspended index scan', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-shared-index-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'cache_index.json'), '{}')
  const code = stripTypeScriptTypes(source.slice(source.indexOf('class CacheIndexManager {'), source.indexOf('export const indexManager =')))
  const context: any = { fs, path, console, global: { lx: {} },
    isRemasterStage: () => false, getUserCacheLocation: () => 'root', getCacheDir: () => root, CACHE_ROOTS: { ROOT: 'root' },
  }
  vm.createContext(context)
  vm.runInContext(code + ';global.manager = new CacheIndexManager()', context)
  const manager = context.global.manager
  const scanIndex = manager.load('alice', 'cache', 'root')
  const cleanupIndex = manager.load('alice', 'cache', 'root')
  assert.equal(scanIndex, cleanupIndex)
  scanIndex.set('new_song', { id: 'new', filename: 'new.mp3' })
  manager.save('alice', 'cache', 'root')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'cache_index.json'), 'utf8')).new_song.filename, 'new.mp3')
  manager.discard('alice', 'cache', 'root')
  assert.notEqual(manager.load('alice', 'cache', 'root'), scanIndex)
})

test('production index scan skips a file removed after enumeration and continues scanning', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-index-race-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const name of ['gone.mp3', 'kept.mp3']) fs.writeFileSync(path.join(root, name), 'audio')
  const index = new Map(['gone', 'kept'].map(id => [id + '_128k', {
    id, source: 'local', filename: id + '.mp3', quality: '128k', size: 5, hasLyric: false,
    interval: '03:00', bitrate: 128000, hasCover: false, coverCheckedVersion: 4,
    coverCheckedMtime: fs.statSync(path.join(root, id + '.mp3')).mtimeMs, coverCheckedSize: 5,
    audioContainer: 'mp3',
  }]))
  const scan = source.slice(source.indexOf('export const syncCacheIndex ='), source.indexOf('    const userLoc = getUserCacheLocation(normalizedUsername)', source.indexOf('export const syncCacheIndex =')))
  let saved = false
  const context: any = { path, console, setImmediate, global: {},
    fs: { ...fs, promises: { ...fs.promises, stat: async (file: string) => {
      if (path.basename(file) === 'gone.mp3' && fs.existsSync(file)) fs.unlinkSync(file)
      return fs.promises.stat(file)
    } } },
    cleanupStaleTempFiles: () => {}, getCacheDir: () => root,
    indexManager: { load: () => index, save: () => { saved = true } },
    COVER_CHECK_VERSION: 4, needsQualityCorrection: () => false,
  }
  vm.createContext(context)
  vm.runInContext(stripTypeScriptTypes(scan.replace('export const', 'const') + '\n};global.run = syncCacheIndex;'), context)
  await context.global.run('alice', ['cache'])
  assert.equal(index.size, 1)
  assert.ok(index.has('local_kept_128k'))
  assert.ok(saved)
})

test('production download wrapper keeps file protection through async tagging and promise handoff', async () => {
  let clock = 0
  const guard = new CacheUsageGuard(() => clock)
  const file = path.resolve('cache/alice/song.flac')
  const scopeCode = source.slice(source.indexOf('const cacheWriteScope ='), source.indexOf('const downloadJobs ='))
  const wrapper = source.slice(source.indexOf('export const downloadAndCache ='), source.indexOf('const downloadAndCacheImpl ='))
  const timers: number[] = []
  let context: any
  context = {
    path, console, AsyncLocalStorage, cacheUsageGuard: guard, downloadJobs: new Map(),
    global: { lx: {} }, lx: {}, normalizeSongId: (song: any) => song.id,
    ensureDir: () => path.dirname(file), getUserCacheLocation: () => 'root',
    beginCloudBackup: () => () => {}, isRemasterStage: () => false,
    setTimeout: (_callback: () => void, ms: number) => { timers.push(ms); return { unref() {} } },
    downloadAndCacheImpl: async () => {
      context.protect(file)
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.ok(guard.protects(file))
      assert.ok(guard.protects(file.replace('.flac', '.lrc')))
    },
  }
  vm.createContext(context)
  vm.runInContext(stripTypeScriptTypes(scopeCode + wrapper.replace('export const', 'const') + ';global.run = downloadAndCache;global.protect = protectCachePath'), context)
  context.protect = context.global.protect
  await context.global.run({ id: 'song' }, '/audio', 'flac', 'alice')
  assert.ok(guard.protects(file))
  assert.deepEqual(timers, [31000])
  clock = 30001
  assert.ok(!guard.protects(file))
})
