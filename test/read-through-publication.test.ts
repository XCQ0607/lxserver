import nodeTest, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CacheItem } from '../src/server/music/fileCache'

const test: typeof nodeTest = nodeTest
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-read-through-publish-'))
process.once('exit', () => fs.rmSync(suiteRoot, { recursive: true, force: true }))
// The server's user-data module dereferences dataPath on import.
;(global as any).lx = { dataPath: suiteRoot, userPath: suiteRoot, config: { users: [], serverCacheLocation: 'data' } }
const {
  getCacheDir, indexManager, READ_THROUGH_CACHE_FILENAME, READ_THROUGH_STAGING_DIR, setUserCacheLocation,
  syncCacheIndex,
}: typeof import('../src/server/music/fileCache') = require('../src/server/music/fileCache')
const { publishReadThrough }: typeof import('../src/server/music/publishReadThrough') = require('../src/server/music/publishReadThrough')

function framedMp3(bitrate = 128, seconds = 2) {
  const index = ({ 128: 9, 192: 11, 256: 13, 320: 14 } as Record<number, number>)[bitrate]
  const frameLength = Math.floor(144_000 * bitrate / 44_100)
  const audio = Buffer.alloc(frameLength * Math.round(seconds * 44_100 / 1152))
  for (let i = 0; i < audio.length; i += frameLength) audio.set([0xff, 0xfb, index << 4, 0], i)
  return audio
}

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(suiteRoot, 'owner-'))
  const username = path.basename(root)
  const account = { name: username, disabled: false }
  ;(global as any).lx = { dataPath: root, config: { users: [account], serverCacheLocation: 'data' } }
  setUserCacheLocation(username, 'data')
  setUserCacheLocation('_open', 'data')
  const cacheDir = getCacheDir(username, false)
  const stage = path.join(cacheDir, READ_THROUGH_STAGING_DIR)
  fs.mkdirSync(stage, { mode: 0o700 })
  const temp = path.join(stage, '.lx-readthrough-' + '1'.repeat(32) + '.part')
  const indexPath = path.join(cacheDir, 'cache_index.json')
  const song = { source: 'tx', id: 'tx_1', name: 'Fixture', singer: 'Fixture Artist', interval: '0:02', quality: 'master' }
  const stageMusic = (audio = framedMp3()) => {
    fs.writeFileSync(temp, audio, { mode: 0o600 })
    return audio
  }
  const publish = (size: number, fields = {}, signal?: AbortSignal) =>
    publishReadThrough(temp, size, { ...song, ...fields }, username, cacheDir, signal)
  const finalNames = () => fs.readdirSync(cacheDir).filter(name => READ_THROUGH_CACHE_FILENAME.test(name))
  t.after(() => {
    indexManager.discard(username, 'cache', 'data')
    indexManager.discard(username, 'music', 'data')
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { cacheDir, indexPath, username, account, stageMusic, publish, temp, finalNames, song }
}

test('publishes the same bytes at the observed tier, never at the requested label', async t => {
  const { stageMusic, publish, temp, cacheDir, username, finalNames, indexPath } = fixture(t)
  const audio = stageMusic(Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]), framedMp3(192)]))
  const before = indexManager.getPlaybackIndex(username, 'cache').revision
  assert.equal(await publish(audio.length), true)
  assert.equal(indexManager.getPlaybackIndex(username, 'cache').revision, before + 1)
  const [filename] = finalNames()
  const saved = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
  assert.deepEqual(Object.keys(saved), ['tx_1_192k'])
  assert.equal(saved.tx_1_192k.filename, filename)
  assert.equal(saved.tx_1_192k.readThrough, true)
  assert.equal(saved.tx_1_192k.quality, '192k')
  assert.equal(saved.tx_1_192k.audioContainer, 'mp3')
  assert.equal(saved.tx_1_192k.bitrate, 192)
  assert.equal(saved.tx_1_192k.sampleRate, 44_100)
  fs.unlinkSync(temp) // Normal tee cleanup must not remove the published bytes.
  assert.deepEqual(fs.readFileSync(path.join(cacheDir, filename)), audio)
  stageMusic(audio)
  assert.equal(await publish(audio.length), false)
  assert.deepEqual(finalNames(), [filename])
  assert.deepEqual(JSON.parse(fs.readFileSync(indexPath, 'utf-8')), saved)
})

test('ignores incomplete media, unknown or mismatched duration, and false audio prefixes', async t => {
  const { stageMusic, publish, indexPath, finalNames } = fixture(t)
  const audio = stageMusic()
  assert.equal(await publish(audio.length - 1), false)
  assert.equal(await publish(audio.length, { interval: '' }), false)
  assert.equal(await publish(audio.length, { interval: '3:27' }), false)
  const truncated = stageMusic(audio.subarray(0, -1))
  assert.equal(await publish(truncated.length), false)
  const proxyError = stageMusic(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0]), Buffer.alloc(2000, 0x3c)]))
  assert.equal(await publish(proxyError.length), false)
  assert.deepEqual(finalNames(), [])
  assert.equal(fs.existsSync(indexPath), false)
})

test('enforces owner and secure staging paths, including symlinks and hardlinks', async t => {
  const { stageMusic, publish, temp, cacheDir, finalNames, song, username } = fixture(t)
  const audio = stageMusic()
  assert.equal(await publishReadThrough(temp, audio.length, song, '../' + username, cacheDir), false)
  assert.equal(await publishReadThrough(temp, audio.length, song, username, path.dirname(cacheDir)), false)
  const outside = path.join(cacheDir, 'outside.mp3')
  fs.renameSync(temp, outside)
  fs.symlinkSync(outside, temp)
  assert.equal(await publish(audio.length), false)
  fs.unlinkSync(temp)
  fs.linkSync(outside, temp)
  assert.equal(await publish(audio.length), false)
  assert.deepEqual(fs.readFileSync(outside), audio)
  assert.deepEqual(finalNames(), [])
})

test('a cancelled or newly disabled account and maintenance cannot commit an in-flight capture', async t => {
  const { stageMusic, publish, finalNames, account } = fixture(t)
  const audio = stageMusic()
  const controller = new AbortController()
  const cancelled = publish(audio.length, {}, controller.signal)
  controller.abort()
  assert.equal(await cancelled, false)
  const disabled = publish(audio.length)
  account.disabled = true
  assert.equal(await disabled, false)
  account.disabled = false
  const maintenance = publish(audio.length)
  global.lx.restoreMaintenance = true
  assert.equal(await maintenance, false)
  global.lx.restoreMaintenance = false
  global.lx.config['user.enableCacheSizeLimit'] = true
  assert.equal(await publish(audio.length), false)
  assert.deepEqual(finalNames(), [])
})

test('keeps an existing variant and leaves the index/unrelated media intact when publication fails', async t => {
  const { stageMusic, publish, username, finalNames, indexPath, song } = fixture(t)
  const audio = stageMusic()
  const old = Buffer.from('existing downloadable media')
  const musicPath = path.join(getCacheDir(username, true), 'managed.flac')
  fs.writeFileSync(musicPath, old)
  indexManager.update(username, {
    ...song, folder: 'music', quality: 'flac', filename: path.basename(musicPath), size: old.length,
    audioContainer: 'flac', ext: 'flac', album: '', mtime: 0,
  } as CacheItem, 'music')
  assert.equal(await publish(audio.length), false)
  assert.deepEqual(finalNames(), [])
  const corruptIndex = '{ broken index'
  fs.writeFileSync(indexPath, corruptIndex)
  assert.equal(await publish(audio.length, { id: 'tx_2' }), false)
  assert.deepEqual(finalNames(), [])
  assert.deepEqual(fs.readFileSync(musicPath), old)
  assert.equal(fs.readFileSync(indexPath, 'utf-8'), corruptIndex)
  assert.equal(indexManager.get(username, 'tx_2', 'cache', '128k', true), undefined)
})

test('respects configured user.cacheSizeLimit including disk orphans without adopting or evicting them', async t => {
  const { stageMusic, publish, username, cacheDir, finalNames } = fixture(t)
  const audio = stageMusic()
  global.lx.config['user.enableCacheSizeLimit'] = true
  global.lx.config['user.cacheSizeLimit'] = 1
  const orphan = 'lx-readthrough-' + '2'.repeat(32) + '.mp3'
  const file = path.join(cacheDir, orphan)
  fs.writeFileSync(file, '')
  fs.truncateSync(file, 1024 * 1024)
  assert.equal(await publish(audio.length), false)
  assert.deepEqual(finalNames(), [orphan])
  await syncCacheIndex(username, ['cache'])
  assert.equal(indexManager.getAll(username, 'cache').length, 0)
  assert.equal(fs.statSync(file).size, 1024 * 1024)
})

test('rejects malformed artwork and oversized native IDs before touching the index or publishing media', async t => {
  const { stageMusic, publish, finalNames, indexPath } = fixture(t)
  const audio = stageMusic()
  for (const fields of [
    { img: { url: 'not a string' } }, { img: 'a'.repeat(2049) },
    { meta: { picUrl: ['invalid'] } }, { songId: '1'.repeat(513) },
    { meta: { albumMid: 'm'.repeat(513) } },
  ]) {
    assert.equal(await publish(audio.length, fields), false)
    assert.deepEqual(finalNames(), [])
    assert.equal(fs.existsSync(indexPath), false)
  }
  const img = 'https://image.example/' + 'a'.repeat(2026)
  assert.equal(img.length, 2048)
  assert.equal(await publish(audio.length, { img, albumMid: 'm'.repeat(512) }), true)
  const saved = JSON.parse(fs.readFileSync(indexPath, 'utf8')).tx_1_128k
  assert.equal(saved.img, img)
  assert.equal(saved.nativeIds.albumMid.length, 512)
})


test('256 kbps is not labeled 320k, while actual 320 kbps retains its tier', async t => {
  for (const [bitrate, quality] of [[256, '192k'], [320, '320k']] as const) {
    const { stageMusic, publish, indexPath } = fixture(t)
    const audio = stageMusic(framedMp3(bitrate))
    assert.equal(await publish(audio.length), true)
    const item = JSON.parse(fs.readFileSync(indexPath, 'utf8'))[`tx_1_${quality}`]
    assert.equal(item.bitrate, bitrate)
    assert.equal(item.quality, quality)
  }
})

test('a complete capture atomically repairs a missing, empty or truncated same-key row without deleting old files', async t => {
  for (const state of ['missing', 'empty', 'truncated']) {
    const { stageMusic, publish, indexPath, cacheDir, username, song } = fixture(t)
    const oldPath = path.join(cacheDir, 'old.mp3')
    if (state !== 'missing') fs.writeFileSync(oldPath, state === 'empty' ? '' : 'partial')
    indexManager.update(username, { ...song, album: '', quality: '128k', filename: 'old.mp3', size: 10000,
      folder: 'cache', mtime: 0, ext: 'mp3' } as CacheItem, 'cache')
    const audio = stageMusic()
    assert.equal(await publish(audio.length), true)
    const saved = JSON.parse(fs.readFileSync(indexPath, 'utf8')).tx_1_128k
    assert.notEqual(saved.filename, 'old.mp3')
    assert.deepEqual(fs.readFileSync(path.join(cacheDir, saved.filename)), audio)
    if (state !== 'missing') assert.equal(fs.readFileSync(oldPath, 'utf8'), state === 'empty' ? '' : 'partial')
  }
})

nodeTest('publishes complete FLAC/Hi-Res captures and respects user.enableCacheSizeLimit', async t => {
  const { stageMusic, publish, indexPath } = fixture(t)
  const hiRes = fs.readFileSync(path.join(__dirname, 'fixtures/cache-upgrade/flac-24bit-96k.flac'))
  global.lx.config['user.enableCacheSizeLimit'] = true
  global.lx.config['user.cacheSizeLimit'] = 10
  stageMusic(hiRes)
  assert.equal(await publish(hiRes.length), true)
  const saved = JSON.parse(fs.readFileSync(indexPath, 'utf8')).tx_1_hires
  assert.equal(saved.ext, 'flac')
  assert.equal(saved.quality, 'hires')
  assert.equal(saved.bitDepth, 24)
})
