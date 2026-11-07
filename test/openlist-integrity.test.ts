import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { prepareIntegrity, startIntegrity, integrityStatus, cancelIntegrity, type IntegrityFile } from '../src/server/openlist/openlistIntegrity'
import { OpenListClient, OpenListNotFoundError } from '../src/server/openlist/openlistClient'

test('manual integrity plans, durable results and cancellation', async t => {
  const previous = global.lx, temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-integrity-'))
  global.lx = { dataPath: temp } as any
  t.after(() => { global.lx = previous; fs.rmSync(temp, { recursive: true, force: true }) })
  const file = (name: string): IntegrityFile => ({ key: name, name, remote: '/' + name, user: 'alice', type: 'cache', hash: 'a'.repeat(64), size: 8, version: '1' })
  const wait = async (files: IntegrityFile[], source = 'fixture') => {
    for (let n = 0; n < 200; n++) {
      const status = integrityStatus(files, source)
      if (status.job?.state !== 'running') return status
      await new Promise(resolve => setTimeout(resolve, 2))
    }
    throw new Error('task did not finish')
  }

  await t.test('reports missing, transport errors and unavailable baselines independently', async () => {
    const files = ['good', 'bad', 'missing', 'network', 'unknown'].map(file); files[4].hash = null
    let reads = 0, released = 0
    const client = {
      async getFileInfo(remote: string) {
        if (remote === '/missing') throw new OpenListNotFoundError('gone')
        if (remote === '/network') throw new Error('timeout')
        return { size: 8, modified: 'stable' }
      },
      async hashRemoteFile(remote: string, _signal: AbortSignal, bytes: (n: number) => void) { reads++; bytes(8); return (remote === '/bad' ? 'b' : 'a').repeat(64) },
    } as unknown as OpenListClient
    const plan = prepareIntegrity(files, 'fixture', { scope: 'all' })
    assert.equal(plan.bytes, 32); assert.equal(plan.unknown, 1)
    startIntegrity(client, files, 'fixture', plan.token, () => { released++ })
    const status = await wait(files)
    assert.equal(status.job?.done, 5); assert.equal(status.job?.bytes, 16); assert.equal(reads, 2); assert.equal(released, 1)
    const results = Object.fromEntries(status.results.map(r => [r.name, r.result]))
    assert.deepEqual(results, { good: 'matched', bad: 'mismatch', missing: 'missing', network: 'error', unknown: 'unavailable' })
    assert.equal(prepareIntegrity(files, 'fixture', { scope: 'changed' }).total, 4)
    assert.equal(prepareIntegrity(files, 'fixture', { scope: 'problems' }).total, 4)
    assert.equal(prepareIntegrity(files, 'another-endpoint', { scope: 'changed' }).total, 5)
    assert.equal(integrityStatus(files, 'another-endpoint').results.length, 0)
    const observed = files.map(f => f.name === 'good' ? { ...f, changedAt: Date.now() + 1 } : f)
    assert.equal(integrityStatus(observed, 'fixture').results.find(r => r.name === 'good')?.result, 'stale')
    assert.equal(prepareIntegrity(observed, 'fixture', { scope: 'changed' }).total, 5)
    assert.equal(prepareIntegrity(observed, 'fixture', { scope: 'problems' }).total, 5)
    const mutated = files.map(f => ({ ...f, version: '2' }))
    assert.equal(integrityStatus(mutated, 'fixture').results.length, 0)
  })

  await t.test('stopping aborts the active transfer and releases the backup lock', async () => {
    const files = [file('cancel')]; let entered = false, released = false
    const client = {
      async getFileInfo() { return { size: 8, modified: 'stable' } },
      async hashRemoteFile(_remote: string, signal: AbortSignal, bytes: (n: number) => void) {
        entered = true; bytes(3)
        return await new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      },
    } as unknown as OpenListClient
    const plan = prepareIntegrity(files, 'fixture', { scope: 'all' })
    startIntegrity(client, files, 'fixture', plan.token, () => { released = true })
    while (!entered) await new Promise(resolve => setTimeout(resolve, 2))
    assert.throws(() => prepareIntegrity(files, 'fixture', {}), /正在执行/)
    cancelIntegrity()
    const status = await wait(files)
    assert.equal(status.job?.state, 'cancelled'); assert.equal(status.job?.done, 0); assert.equal(status.job?.bytes, 3); assert.equal(released, true)
    assert.equal(prepareIntegrity(files, 'fixture', { scope: 'changed' }).total, 1)
  })

  await t.test('backup mutations invalidate the confirmed plan', () => {
    const files = [file('plan')], plan = prepareIntegrity(files, 'fixture', {})
    assert.throws(() => startIntegrity({} as OpenListClient, [{ ...files[0], hash: 'b'.repeat(64) }], 'fixture', plan.token, () => {}), /已变化/)
  })

  await t.test('a journal left running by a previous process is shown as interrupted', () => {
    const journal = path.join(temp, 'runtime/openlist-integrity.json')
    const store = JSON.parse(fs.readFileSync(journal, 'utf8')); store.job.state = 'running'; fs.writeFileSync(journal, JSON.stringify(store))
    assert.equal(integrityStatus([], 'fixture').job?.state, 'interrupted')
  })
})
