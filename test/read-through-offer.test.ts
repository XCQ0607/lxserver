import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

const source = fs.readFileSync(path.join(__dirname, '../src/server/server.ts'), 'utf8')
const start = source.indexOf('type ReadThroughOffer =')
const end = source.indexOf('const formatBytes =', start)
assert.ok(start >= 0 && end > start)
const script = new vm.Script(stripTypeScriptTypes(source.slice(start, end) + '\nObject.assign(globalThis, { issueReadThroughOffer, readThroughOffers });'))
const song = { id: 'tx_mid', source: 'tx', name: 'Song', singer: 'Artist', interval: '3:00', meta: { strMediaMid: 'original-media-mid' } }
function setup(platform = 'linux') {
  const pending: Array<() => Promise<void>> = []
  const context = vm.createContext({
    process: { platform, env: { LX_READ_THROUGH_CACHE: '1' } }, crypto, path,
    global: { lx: { config: { users: [{ name: 'alice' }] } } },
    setImmediate: (fn: () => Promise<void>) => { pending.push(fn) },
    fs: { promises: { mkdir: async () => {}, lstat: async () => ({ isDirectory: () => true, mode: 0o700 }),
      opendir: async () => ({ read: async () => null, close: async () => {} }) } },
    fileCache: { READ_THROUGH_STAGING_DIR: '.spool', getCacheDir: () => '/isolated/alice',
      extractSongMetadata: (s: typeof song) => ({ id: s.id, source: s.source, name: s.name, singer: s.singer, interval: s.interval, album: '' }),
      extractNativeIds: (s: typeof song) => s.meta },
  })
  script.runInContext(context)
  const issue = (track = song) => context.issueReadThroughOffer('alice', 'https://provider.example/song.mp3', track)
  return { context, pending, issue }
}
test('an unready spool returns ordinary playback immediately; only a ready directory yields a usable offer', async () => {
  const { context, pending, issue } = setup()
  assert.equal(issue(), undefined)
  assert.equal(context.readThroughOffers.size, 0)
  assert.equal(pending.length, 1)
  await pending.shift()!()
  const key = issue()
  assert.match(key, /^[a-f0-9]{32}$/)
  const offer = context.readThroughOffers.get(key)
  assert.equal(offer.cacheDir, '/isolated/alice')
  assert.equal(offer.stagingDir, '/isolated/alice/.spool')
  assert.equal(offer.song.id, 'tx_mid')
  assert.equal(offer.song.meta.strMediaMid, song.meta.strMediaMid)
  assert.equal(issue(), undefined) // Every new readiness cycle rechecks the empty spool.
})
test('QQ native identity bounds and the Windows platform gate fail closed before preparing directories', () => {
  for (const [platform, track] of [
    ['win32', song], ['linux', { ...song, meta: {} }],
    ['linux', { ...song, meta: { strMediaMid: 'x'.repeat(513) } }],
    ['linux', { ...song, meta: { strMediaMid: {} } }],
  ] as const) {
    const { issue, pending, context } = setup(platform)
    assert.equal(issue(track as typeof song), undefined)
    assert.equal(context.readThroughOffers.size, 0)
    assert.equal(pending.length, 0)
  }
})
