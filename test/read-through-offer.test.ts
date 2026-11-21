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
  let now = 0, checks = 0, spoolOccupied = false
  let blocked: Promise<void> | undefined
  const context = vm.createContext({
    process: { platform, env: { LX_READ_THROUGH_CACHE: '1' } }, crypto, path: path.posix,
    Date: { now: () => now }, setTimeout, clearTimeout,
    global: { lx: { config: { users: [{ name: 'alice' }] } } },
    fs: { promises: { mkdir: async () => { if (blocked) await blocked }, lstat: async () => ({ isDirectory: () => true, mode: 0o700 }),
      opendir: async () => {
        checks++;
        return { read: async () => spoolOccupied ? { name: 'active.part' } : null, close: async () => {} }
      } } },
    fileCache: { READ_THROUGH_STAGING_DIR: '.spool', getCacheDir: () => '/isolated/alice',
      extractSongMetadata: (s: typeof song) => ({ id: s.id, source: s.source, name: s.name, singer: s.singer, interval: s.interval, album: '' }),
      extractNativeIds: (s: typeof song) => s.meta },
  })
  script.runInContext(context)
  const issue = (track = song) => context.issueReadThroughOffer('alice', 'https://provider.example/song.mp3', track)
  return { context, issue, setNow: (value: number) => { now = value },
    getChecks: () => checks, setOccupied: (value: boolean) => { spoolOccupied = value },
    stall: (promise: Promise<void>) => { blocked = promise } }
}

test('normal song changes can issue a new offer after a fresh empty-spool check', async () => {
  const f = setup()
  const key = await f.issue()
  assert.match(key, /^[a-f0-9]{32}$/)
  const offer = f.context.readThroughOffers.get(key)
  assert.equal(offer.cacheDir, '/isolated/alice')
  assert.equal(offer.stagingDir, '/isolated/alice/.spool')
  assert.equal(offer.song.id, 'tx_mid')
  assert.equal(offer.song.meta.strMediaMid, song.meta.strMediaMid)
  assert.equal(await f.issue(), undefined, 'avoids two unconsumed offers per owner')
  f.setNow(4 * 60_000)
  f.setOccupied(true)
  assert.equal(await f.issue(), undefined, 'still fails closed if a transfer owns the spool')
  f.setOccupied(false)
  assert.match(await f.issue(), /^[a-f0-9]{32}$/)
  assert.equal(f.getChecks(), 3)
})

test('a stalled spindle does not block ordinary playback or allow stacked checks for its owner', async () => {
  const f = setup()
  let unblock!: () => void
  f.stall(new Promise<void>(resolve => { unblock = resolve }))
  const first = f.issue()
  assert.equal(await f.issue(), undefined)
  assert.equal(await first, undefined)
  assert.equal(f.getChecks(), 0)
  assert.equal(f.context.readThroughOffers.size, 0)
  unblock()
})

test('QQ native identity bounds and the Windows platform gate fail closed before preparing directories', async () => {
  for (const [platform, track] of [
    ['win32', song], ['linux', { ...song, meta: {} }],
    ['linux', { ...song, meta: { strMediaMid: 'x'.repeat(513) } }],
    ['linux', { ...song, meta: { strMediaMid: {} } }],
  ] as const) {
    const { issue, getChecks, context } = setup(platform)
    assert.equal(await issue(track as typeof song), undefined)
    assert.equal(context.readThroughOffers.size, 0)
    assert.equal(getChecks(), 0)
  }
})
