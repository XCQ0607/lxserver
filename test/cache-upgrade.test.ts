import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { inspectCompleteFlac } from '../src/server/music/completeAudio'
import type { CacheItem } from '../src/server/music/fileCache'

const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cache-upgrade-'))
process.once('exit', () => fs.rmSync(dataPath, { recursive: true, force: true }))
;(global as any).lx = { dataPath, userPath: dataPath, config: { users: [], serverCacheLocation: 'data' } }
const { getCacheDir, indexManager, setUserCacheLocation, syncCacheIndex }:
  typeof import('../src/server/music/fileCache') = require('../src/server/music/fileCache')
const { selectPlaybackCache }: typeof import('../src/server/music/playbackCacheSelection') = require('../src/server/music/playbackCacheSelection')
const { downloadCacheUpgrade, sanitizeCacheUpgradeSong }:
  typeof import('../src/server/music/cacheUpgrade') = require('../src/server/music/cacheUpgrade')

// Generated from two seconds of a 437 Hz sine wave; no third-party recordings.
const regular = fs.readFileSync(path.join(__dirname, 'fixtures/cache-upgrade/flac-16bit-44k.flac'))
const hiRes = fs.readFileSync(path.join(__dirname, 'fixtures/cache-upgrade/flac-24bit-96k.flac'))

async function fixture(t: TestContext, respond: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const user = { name: 'account-' + Math.random().toString(36).slice(2), disabled: false }
  global.lx.config.users = [user] as any
  global.lx.config['user.enableCacheSizeLimit'] = false
  setUserCacheLocation(user.name, 'data')
  const directory = getCacheDir(user.name, false)
  const old = Buffer.from('existing lower-quality content')
  fs.writeFileSync(path.join(directory, 'older.flac'), old)
  const song = { source: 'tx', id: 'tx_994000', name: 'Fixture', singer: 'Fixture Artist', interval: '0:02' }
  indexManager.update(user.name, {
    ...song, folder: 'cache', quality: 'flac', filename: 'older.flac', size: old.length,
    audioContainer: 'flac', ext: 'flac', album: '', mtime: 0,
  } as CacheItem, 'cache')
  const server = http.createServer(respond)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  assert.ok(addr && typeof addr !== 'string')
  const verifyExisting = () => assert.deepEqual(fs.readFileSync(path.join(directory, 'older.flac')), old)
  t.after(() => { server.closeAllConnections(); server.close(); verifyExisting() })
  const upgrade = (quality = 'hires', signal = new AbortController().signal, fields = {}) =>
    downloadCacheUpgrade({ ...song, ...fields }, `http://127.0.0.1:${addr.port}/fixture`, quality, user.name, signal,
      { downloadSource: 'tx' }, fixtureResponse)
  const fixtureUrl = `http://127.0.0.1:${addr.port}/fixture`
  return { user, directory, song, upgrade, fixtureUrl }
}

const fixtureResponse = (url: string, signal: AbortSignal) => new Promise<http.IncomingMessage>((resolve, reject) => {
  const request = http.get(url, { signal }, response => {
    if (response.statusCode !== 200) {
      response.destroy()
      reject(new Error('Unexpected media response'))
      return
    }
    resolve(response)
  })
  request.on('error', reject)
})
const unixStorage = { skip: process.platform === 'win32' }

test('checks every FLAC frame and samples instead of trusting stream metadata or the source label', async () => {
  const std = await inspectCompleteFlac(regular)
  assert.equal(std?.quality, 'flac')
  const hires = await inspectCompleteFlac(hiRes)
  assert.equal(hires?.quality, 'hires')
  assert.equal(hires.bitDepth, 24)
  assert.equal(hires.seconds, 2)
  assert.equal(await inspectCompleteFlac(hiRes.subarray(0, -1)), null)
  const corrupted = Buffer.from(hiRes)
  corrupted[corrupted.length - 60] ^= 0x20
  assert.equal(await inspectCompleteFlac(corrupted), null)
  const changedHeader = Buffer.from(regular)
  changedHeader[20] ^= 1
  assert.equal(await inspectCompleteFlac(changedHeader), null)
})

test('publishes higher-quality bytes as a next-play variant and never rewrites the lower cache', unixStorage, async t => {
  let requests = 0
  const { user, directory, song, upgrade } = await fixture(t, (_req, res) => {
    requests++
    res.writeHead(200, { 'content-length': hiRes.length }).end(hiRes)
  })
  const before = await selectPlaybackCache({ songs: [song], quality: 'hires' }, user.name)
  assert.equal(before.exists && before.filename, 'older.flac')
  assert.equal(await upgrade('flac24bit'), 'finished')
  const after = await selectPlaybackCache({ songs: [song], quality: 'hires', exactQuality: true }, user.name)
  assert.ok(after.exists && !after.isCollision)
  assert.notEqual(after.filename, 'older.flac')
  assert.deepEqual(fs.readFileSync(path.join(directory, after.filename)), hiRes)
  assert.equal(await upgrade('hires'), 'exists')
  assert.equal(requests, 1)
  assert.equal(indexManager.get(user.name, song.id, 'cache', 'flac', true)?.filename, 'older.flac')
  assert.equal(indexManager.get(user.name, song.id, 'cache', 'flac24bit', true)?.downloadSource, 'tx')

  const unindexed = 'lx-upgrade-' + '1'.repeat(32) + '.flac'
  fs.writeFileSync(path.join(directory, unindexed), hiRes)
  await syncCacheIndex(user.name, ['cache'])
  assert.equal(indexManager.getAll(user.name, 'cache').some(item => item.filename === unindexed), false)
})

test('rejected quality, duration, or partial response leaves only old bytes and no new index entry', unixStorage, async t => {
  let served = regular, code = 200
  const { user, song, directory, upgrade } = await fixture(t, (_req, res) => res.writeHead(code).end(served))
  await assert.rejects(upgrade(), /could not be verified/)
  served = hiRes.subarray(0, -1000)
  await assert.rejects(upgrade(), /could not be verified/)
  served = hiRes
  code = 206
  await assert.rejects(upgrade(), /Unexpected media response/)
  code = 200
  await assert.rejects(upgrade('hires', undefined, { interval: '3:00' }), /could not be verified/)
  assert.equal(indexManager.get(user.name, song.id, 'cache', 'hires', true), undefined)
  assert.equal(fs.readdirSync(directory).filter(file => file.startsWith('lx-upgrade') || file.startsWith('.lx-upgrade')).length, 0)
})

test('abort, insufficient quota, disabled account and unverifiable profiles cannot publish or evict', unixStorage, async t => {
  let transfer: () => void = () => {}
  const began = new Promise<void>(resolve => { transfer = resolve })
  let held = false
  let requests = 0
  const { user, directory, upgrade } = await fixture(t, (_req, res) => {
    requests++
    if (held) {
      res.write(hiRes.subarray(0, 64))
      transfer()
    } else res.end(hiRes)
  })
  global.lx.config['user.enableCacheSizeLimit'] = true
  global.lx.config['user.cacheSizeLimit'] = 0.01
  await assert.rejects(upgrade(), /exceed available space/)
  global.lx.config['user.enableCacheSizeLimit'] = false
  user.disabled = true
  await assert.rejects(upgrade(), /unavailable/)
  user.disabled = false
  await assert.rejects(upgrade('atmos'), /unavailable/)
  assert.equal(requests, 1)
  held = true
  const controller = new AbortController()
  const download = upgrade('hires', controller.signal)
  await began
  controller.abort()
  await assert.rejects(download, { name: 'AbortError' })
  assert.equal(fs.readdirSync(directory).filter(file => file.startsWith('lx-upgrade') || file.startsWith('.lx-upgrade')).length, 0)
})

test('allows only bounded provider identity metadata, never a URL, local path or client alternate', () => {
  const result = sanitizeCacheUpgradeSong({
    source: 'tx', id: 'tx_001', name: 'Fixture', singer: 'Artist', interval: '0:02',
    url: 'https://ignore.invalid/', _alternates: [{ id: 'alternate' }], folder: 'music',
    meta: { songId: '001', strMediaMid: 'native', id: 12, injected: { ignored: true }, url: 'https://ignore.invalid/' },
  })
  assert.deepEqual(result, { source: 'tx', id: 'tx_001', name: 'Fixture', singer: 'Artist', interval: '0:02',
    meta: { songId: '001', id: '12', strMediaMid: 'native' } })
  assert.equal(sanitizeCacheUpgradeSong({ ...result, interval: 'bogus' }), null)
})

test('production transport rejects private provider URL before issuing a media request', unixStorage, async t => {
  let requests = 0
  const { user, song, fixtureUrl } = await fixture(t, (_req, res) => { requests++; res.end(hiRes) })
  await assert.rejects(downloadCacheUpgrade(song, fixtureUrl, 'hires', user.name,
    new AbortController().signal, {}), { code: 'ERR_PRIVATE_UPSTREAM' })
  assert.equal(requests, 0)
})
