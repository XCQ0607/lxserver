import test, { after, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CacheFolder, CacheItem } from '../src/server/music/fileCache'

// Exercise the real index, settings and selection code against an isolated NAS
// directory. The unrelated startup temp-file sweep must not run in this fixture.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-playback-index-'))
const userPath = path.join(root, 'users')
fs.mkdirSync(userPath)
fs.writeFileSync(path.join(root, 'serverInfo.json'), '{"serverId":"test","version":2}')
const originalLx = global.lx
global.lx = { dataPath: root, userPath, config: { serverCacheLocation: 'data' } } as typeof global.lx
after(() => {
  global.lx = originalLx
  fs.rmSync(root, { recursive: true, force: true })
})
mock.timers.enable({ apis: ['setTimeout'] })
const { checkCache, getCacheDir, indexManager } = require('../src/server/music/fileCache') as typeof import('../src/server/music/fileCache')
const { selectPlaybackCache } = require('../src/server/music/playbackCacheSelection') as typeof import('../src/server/music/playbackCacheSelection')
mock.timers.reset()

const song = { id: 'tx_track', source: 'tx', name: 'A Song', singer: 'Singer A & Singer B', interval: '02:35' }
const alt = { ...song, id: 'kw_match', source: 'kw', singer: 'Singer B / Singer A', interval: '02:36' }
const fixtureAudio = 'complete audio fixture'
let counter = 0
function fixture() {
  const owner = 'user' + ++counter
  const put = (folder: CacheFolder, quality: string, filename: string, metadata: Partial<CacheItem> = {}, user = owner) => {
    const directory = getCacheDir(user, folder === 'music')
    const file = path.join(directory, filename)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, fixtureAudio)
    indexManager.update(user, {
      ...song, album: '', size: fixtureAudio.length, mtime: 0, ext: path.extname(filename).slice(1), folder, quality, filename, ...metadata,
    }, folder)
    return file
  }
  const select = (options = {}, user = owner) => selectPlaybackCache({ songs: [song], quality: 'flac', ...options }, user)
  return { owner, put, select }
}

test('one local decision prefers exact profiles, then the best eligible ready copy', async () => {
  const { owner, put, select } = fixture()
  put('cache', '320k', 'fallback.mp3')
  put('music', 'flac24bit', 'hires.flac')
  assert.equal((await select({ exactQuality: true })).exists, false)
  assert.deepEqual(await select(), {
    exists: true, folder: 'cache', filename: 'fallback.mp3', url: `/api/music/cache/file/${owner}/fallback.mp3?folder=cache`,
    quality: '320k', memberIndex: 0,
  })
  assert.equal((await select({ quality: 'hires', exactQuality: true })).exists, true)
  put('cache', 'flac', 'preferred.flac')
  put('music', 'flac', 'Album/owned.flac')
  assert.equal(((await select()) as { filename?: string }).filename, 'Album/owned.flac')
  assert.equal(((await select({ excludeFiles: ['["music","Album/owned.flac"]'] })) as { filename?: string }).filename, 'preferred.flac')
})

test('an exact primary hit uses index keys without scanning and still respects folder, aliases and exclusions', async t => {
  const { owner, put, select } = fixture()
  const preferred = put('music', 'flac24bit', 'owned.flac')
  put('cache', 'hires', 'fallback.flac')
  for (const folder of ['music', 'cache'] as const) {
    t.mock.method(indexManager.getPlaybackIndex(owner, folder).index, 'values', () => {
      assert.fail('a ready exact match must not enumerate the index')
    })
  }
  const exact = { quality: 'hires', exactQuality: true }
  assert.equal(((await select(exact)) as { filename?: string }).filename, 'owned.flac')
  assert.equal(((await select({ ...exact, excludeFiles: ['["music","owned.flac"]'] })) as { filename?: string }).filename, 'fallback.flac')
  fs.unlinkSync(preferred)
  assert.equal(((await select(exact)) as { filename?: string }).filename, 'fallback.flac')
})

test('cross-provider playback verifies the stored edition and honors source lock', async () => {
  const { put, select } = fixture()
  put('cache', 'flac', 'live.flac', { ...alt, id: 'kw_live', name: 'A Song (Live)' })
  put('cache', 'flac', 'different-artist.flac', { ...alt, id: 'kw_cover', singer: 'Singer A' })
  put('music', 'flac', 'different-duration.flac', { ...alt, id: 'kw_remaster', interval: '02:45' })
  assert.equal((await select({ songs: [song, { ...alt, id: 'kw_live' }] })).exists, false)
  put('cache', 'flac', 'matching.flac', alt)
  const member = await select({ songs: [song, alt] })
  assert.equal(member.exists && member.memberIndex, 1)
  const discovered = await select()
  assert.equal(discovered.exists && discovered.collisionSource, 'kw')
  assert.equal((await select({ songs: [song, alt], allowCrossSource: false })).exists, false)
  assert.equal((await select({ songs: [{ ...song, interval: '9'.repeat(40) }] })).exists, false)
  assert.equal((await select({ songs: [{ ...song, interval: '03:00' }] })).exists, false)
  put('music', 'flac', 'ambiguous.flac', { ...alt, id: 'kw_unverified_v2' })
  assert.equal((await select()).exists, false)
})

test('captured files are replayable for their resolved ID, not cross-catalog matches', async () => {
  const { owner, put, select } = fixture()
  put('cache', 'flac', 'captured.flac', { ...alt, readThrough: true, singer: song.singer })
  assert.equal((await select()).exists, false)
  assert.equal((await select({ songs: [song, alt] })).exists, false)
  assert.equal((await select({ songs: [alt] })).exists, true)
  assert.equal(checkCache({ ...song, quality: 'flac', exactQuality: true }, owner).exists, false)
})

test('selection ignores missing, incomplete, encrypted and out-of-scope entries without deleting them', async () => {
  const { owner, put, select } = fixture()
  const nonexistent = put('music', 'flac', 'missing.flac')
  fs.unlinkSync(nonexistent)
  const partial = put('cache', 'flac', 'partial.flac', { size: 1000 })
  put('cache', '320k', 'private.mp3', {}, 'other')
  put('music', '320k', 'encrypted.m4a', { audioContainer: 'encrypted' })
  const linked = put('music', '192k', 'external.mp3')
  const externalFile = path.join(root, 'external.mp3')
  fs.writeFileSync(externalFile, fixtureAudio)
  fs.unlinkSync(linked)
  fs.symlinkSync(externalFile, linked)
  assert.equal((await select()).exists, false)
  assert.ok(fs.statSync(partial).isFile())
  assert.ok(fs.lstatSync(linked).isSymbolicLink())
  assert.ok(indexManager.get(owner, song.id, 'music', 'flac', true))
  put('cache', '192k', 'ready.mp3')
  assert.equal(((await select()) as { filename?: string }).filename, 'ready.mp3')
  assert.equal((await select({}, 'other')).exists, true)
})

test('an empty or malformed lookup does not create account directories', async () => {
  const { owner, select } = fixture()
  assert.equal((await select()).exists, false)
  assert.equal(fs.existsSync(path.join(root, 'cache', owner)), false)
  assert.equal(fs.existsSync(path.join(root, 'music', owner)), false)
  assert.deepEqual(fs.readdirSync(userPath), [])
  await assert.rejects(() => select({ songs: Array(9).fill(song) }), TypeError)
  await assert.rejects(() => select({ songs: [{ ...song, source: '../music' }] }), TypeError)
})

test('file verification yields while filesystem work is pending and still selects the same ready file', async t => {
  const { put, select } = fixture()
  put('music', 'flac', 'ready.flac')
  const originalStat = fs.promises.stat.bind(fs.promises)
  let release!: () => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  t.mock.method(fs.promises, 'stat', async (...args: Parameters<typeof fs.promises.stat>) => {
    started()
    await gate
    return originalStat(...args)
  })
  let settled = false
  const pending = select({ exactQuality: true }).then(result => { settled = true; return result })
  await entered
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  release()
  assert.equal((await pending as { filename?: string }).filename, 'ready.flac')
})
