import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'

// Run the actual persistent queue against a temporary data directory. Use a
// deferred transfer seam so a paused task cannot accidentally write media.
const text = fs.readFileSync(path.join(__dirname, '../src/server/task/serverDownloadQueue.ts'), 'utf8')
const code = new vm.Script(stripTypeScriptTypes(text.replace(/^import .*$/gm, '')
  .replace(/^export /gm, '') + '\n;({initialize, enqueue, pause, remove, resume, list})'))

function fixture(t: { after: (fn: () => void) => void }, settings: { exact?: boolean; reject?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-server-queue-'))
  const timers = new Set<NodeJS.Timeout>()
  const transfers: Array<{ song: any; url: string; quality: string; owner: string; signal: AbortSignal }> = []
  const upgrades: Array<{ song: any; url: string; quality: string; owner: string; signal: AbortSignal }> = []
  const queue = code.runInNewContext({
    fs, path, createHash, AbortController, console: { log() {}, warn() {} }, global: { lx: { dataPath: root } },
    setTimeout: (fn: () => void, ms: number) => {
      const timer = setTimeout(() => { timers.delete(timer); fn() }, ms)
      timers.add(timer)
      return timer
    },
    clearTimeout: (timer: NodeJS.Timeout) => { timers.delete(timer); clearTimeout(timer) },
    cacheUpgrade: {
      canUpgradeForAccount: (user: string) => ['alice', 'bob'].includes(user),
      canonicalUpgradeQuality: (quality: string) => quality === 'flac24bit' ? 'hires' : quality,
      isSameUpgradeTier: (a: string, b: string) => a === b || [a, b].every(tier => ['hires', 'flac24bit'].includes(tier)),
      sanitizeCacheUpgradeSong: (song: any) => song?.id ? { id: song.id, source: song.source } : null,
      validateUpgradeInput: (song: { id: string }, quality: string) => !!song.id && ['flac', 'hires', 'flac24bit'].includes(quality),
      hasExactUpgradeCopy: () => !!settings.exact,
      getUpgradeProgressKey: (key: string) => `upgrade:${key}`,
      downloadCacheUpgrade: async (song: any, url: string, quality: string, owner: string, signal: AbortSignal) => {
        upgrades.push({ song, url, quality, owner, signal })
        if (settings.reject) throw new Error('Invalid media')
        return 'finished'
      },
    },
    fileCache: {
      normalizeSongId: (song: { id: string }) => song.id,
      cacheProgress: new Map(), getProgressKey: (key: string) => key,
      downloadAndCache: async (song: any, url: string, quality: string, owner: string, signal: AbortSignal) => {
        transfers.push({ song, url, quality, owner, signal })
      },
    },
  }) as typeof import('../src/server/task/serverDownloadQueue')
  t.after(() => {
    for (const timer of timers) clearTimeout(timer)
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { queue, transfers, upgrades }
}

const song = { id: 'tx_1', source: 'tx' }
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('pausing an active NAS queue item cancels resolution and lets a resume hand off exactly one transfer', async t => {
  const { queue, transfers } = fixture(t)
  const inputs: Array<{ task: any; signal: AbortSignal }> = []
  const url = 'https://audio.example.test/file'
  queue.initialize(async (task, signal) => {
    inputs.push({ task, signal })
    if (inputs.length > 1) return { url, quality: 'hires' }
    return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  queue.enqueue('alice', [{
    id: 'task', songInfo: { ...song, explicitQuality: 'hires' }, quality: 'flac',
  }])
  assert.equal(inputs[0].task.requestedQuality, 'flac', 'explicit provider request for manual jobs remains unchanged')
  assert.ok(inputs[0].signal instanceof AbortSignal)
  queue.pause('alice', 'task')
  assert.equal(inputs[0].signal.aborted, true)
  assert.equal(queue.list('alice')[0].status, 'paused')
  assert.equal(transfers.length, 0)
  queue.resume('alice', 'task')
  await tick()
  assert.equal(inputs.length, 2)
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0].signal, inputs[1].signal)
  assert.equal(transfers[0].owner, 'alice')
  assert.equal(transfers[0].quality, 'hires')
  assert.equal(queue.list('alice')[0].status, 'finished')
})

test('removing during source lookup aborts it and a late result cannot start a transfer', async t => {
  const { queue, transfers } = fixture(t)
  let signal: AbortSignal | undefined
  let complete: (result: { url: string }) => void = () => {}
  queue.initialize(async (_task, s) => {
    signal = s
    return new Promise(resolve => { complete = resolve })
  })
  queue.enqueue('alice', [{ id: 'task', songInfo: song }])
  queue.remove('alice', { id: 'task' })
  complete({ url: 'https://audio.example.test/file' })
  await tick()
  assert.equal(signal?.aborted, true)
  assert.equal(transfers.length, 0)
  assert.equal(queue.list('alice').length, 0)
})

const autoInput = (quality = 'hires', selected = song) =>
  ({ songInfo: selected, quality, cacheUpgrade: true as const, enableOnlyDownloadMode: true, enableAutoSwitchApiSource: false })
const audioUrl = 'https://audio.example.test/file'

test('automatic upgrades are account-scoped, exact and single flight before resolution', async t => {
  const { queue, upgrades } = fixture(t)
  const resolves: Array<{ task: any; ready: () => void }> = []
  queue.initialize((task) => new Promise(resolve => resolves.push({
    task, ready: () => resolve({ url: audioUrl, quality: 'flac24bit', songInfo: { id: 'untrusted', source: 'wy' } }),
  })))
  assert.throws(() => queue.enqueue('_open', [autoInput()]), /unavailable/)
  assert.throws(() => queue.enqueue('alice', [autoInput('atmos')]), /unavailable/)
  const [one] = queue.enqueue('alice', [autoInput()])
  const [duplicate] = queue.enqueue('alice', [autoInput('flac24bit')])
  const [other] = queue.enqueue('bob', [autoInput()])
  assert.match(one.id, /^lx_upgrade_[a-f0-9]{32}$/)
  assert.equal(one.cacheUpgrade, true)
  assert.equal(duplicate.id, one.id)
  assert.notEqual(other.id, one.id)
  assert.equal(resolves.length, 1)
  assert.equal(resolves[0].task.requestedQuality, 'hires')
  assert.equal(resolves[0].task.enableOnlyDownloadMode, false)
  assert.equal(resolves[0].task.enableAutoSwitchApiSource, false)
  queue.pause('bob', one.id)
  assert.equal(queue.list('alice')[0].status, 'downloading')
  assert.equal(queue.list('alice', { includeUpgrades: false }).length, 0)
  assert.equal(queue.list('alice', { includeUpgrades: false, id: one.id })[0].cacheUpgrade, true)
  assert.equal(queue.list('bob', { id: one.id }).length, 0)
  queue.remove('alice', { all: true })
  assert.equal(queue.list('alice')[0].status, 'downloading')
  resolves[0].ready()
  await tick()
  assert.equal(resolves.length, 2)
  resolves[1].ready()
  await tick()
  assert.equal(upgrades[0].song.id, song.id, 'writes under the selected recording, not another provider ID')
  assert.equal(upgrades[0].owner, 'alice')
  assert.equal(upgrades[1].owner, 'bob')
  assert.equal(queue.list('bob')[0].status, 'finished')
})

test('manual downloads retain priority and their IDs cannot masquerade as an automatic job', async t => {
  const { queue, transfers, upgrades } = fixture(t)
  const events: Array<{ label: string; signal: AbortSignal }> = []
  queue.initialize(async (task, signal) => {
    events.push({ label: task.cacheUpgrade ? 'upgrade' : 'manual', signal })
    if (events.length === 1) return new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    return { url: audioUrl, quality: task.requestedQuality }
  })
  const [auto] = queue.enqueue('alice', [autoInput()])
  const [manual] = queue.enqueue('alice', [{ songInfo: song, id: auto.id }])
  assert.notEqual(manual.id, auto.id)
  assert.equal(manual.cacheUpgrade, undefined)
  assert.equal(events[0].signal.aborted, true)
  await tick()
  assert.deepEqual(events.map(event => event.label), ['upgrade', 'manual', 'upgrade'])
  assert.equal(transfers.length, 1)
  assert.equal(upgrades.length, 1)
})

test('an exact ready copy wins before source lookup; failures are cooled down', async t => {
  const { queue } = fixture(t, { exact: true })
  queue.initialize(async () => assert.fail('should not look up provider'))
  assert.equal(queue.enqueue('alice', [autoInput()])[0].status, 'exists')
  const bad = fixture(t, { reject: true })
  let attempts = 0
  bad.queue.initialize(async () => { attempts++; return { url: audioUrl, quality: 'hires' } })
  const [one] = bad.queue.enqueue('alice', [autoInput()])
  await tick()
  const [duplicate] = bad.queue.enqueue('alice', [autoInput()])
  assert.equal(duplicate.id, one.id)
  assert.equal(duplicate.status, 'error')
  bad.queue.resume('alice', one.id)
  await tick()
  assert.equal(attempts, 1)
})

test('by-ID buffering pause cancels only the automatic job and resume is explicit', async t => {
  const { queue, upgrades } = fixture(t)
  let first: AbortSignal | undefined
  queue.initialize(async (_task, signal) => {
    if (first) return { url: audioUrl, quality: 'hires' }
    first = signal
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const [task] = queue.enqueue('alice', [autoInput()])
  queue.pause('alice', task.id)
  await tick()
  assert.equal(first?.aborted, true)
  assert.equal(queue.enqueue('alice', [autoInput()])[0].status, 'paused')
  assert.equal(upgrades.length, 0)
  queue.resume('alice')
  await tick()
  assert.equal(upgrades.length, 0)
  queue.resume('alice', task.id)
  await tick()
  assert.equal(upgrades.length, 1)
  assert.equal(queue.list('alice')[0].status, 'finished')
})
