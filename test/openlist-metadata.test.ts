import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startMetadata, metadataStatus, metadataObservations, cancelMetadata } from '../src/server/openlist/openlistMetadata'
import { OpenListClient, OpenListNotFoundError } from '../src/server/openlist/openlistClient'

test('metadata checks are read-only, scoped, durable and cancellable', async t => {
  const previous = global.lx, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-meta-'))
  global.lx = { dataPath: dir } as any
  t.after(() => { global.lx = previous; fs.rmSync(dir, { recursive: true, force: true }) })
  const local = path.join(dir, 'song.mp3'); fs.writeFileSync(local, 'audio')
  const row = { id: 1, local_path: local, remote_path: '/root/song.mp3', size: 5, local_hash: 'upload-fingerprint', local_mtime: fs.statSync(local).mtimeMs, remote_mtime: 1000 }
  const wait = async () => {
    for (let n = 0; n < 100; n++) {
      const job = metadataStatus('source').job
      if (job?.state !== 'running') return job
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('metadata check did not finish')
  }
  let calls = 0
  const client = { async getFileInfo() { calls++; return { size: 5, modified: new Date(1000).toISOString() } } } as unknown as OpenListClient
  startMetadata('source', [row], 'both', client)
  assert.equal((await wait())?.state, 'completed')
  assert.equal(calls, 1)
  assert.equal(metadataObservations('source')(row.remote_path)?.state, 'same')
  assert.equal(metadataObservations('source')(row.remote_path, 'local')?.state, 'same')
  assert.equal(metadataObservations('other-server')(row.remote_path), undefined)
  assert.equal(fs.readFileSync(local, 'utf8'), 'audio')
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'runtime/openlist-metadata.json'), 'utf8'))
  assert.equal(persisted.job.done, 1)
  assert.equal(Object.keys(persisted.observations).length, 2)

  fs.unlinkSync(local)
  startMetadata('source', [row], 'local', null)
  assert.equal((await wait())?.failed, 1)
  assert.equal(calls, 1, 'local-only checks never access the network')
  assert.equal(metadataObservations('source')(row.remote_path, 'local')?.state, 'missing')
  assert.throws(() => startMetadata('source', [row], 'remote', null), /启用/)

  const missing = { async getFileInfo() { throw new OpenListNotFoundError('gone') } } as unknown as OpenListClient
  startMetadata('source', [row], 'remote', missing); await wait()
  assert.equal(metadataObservations('source')(row.remote_path)?.state, 'missing')
  assert.ok(metadataObservations('source')(row.remote_path)?.changedAt)

  const slow = { getFileInfo(_remote: string, signal: AbortSignal) { return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })) } } as unknown as OpenListClient
  startMetadata('source', [row, { ...row, id: 2, remote_path: '/root/two' }], 'remote', slow)
  assert.throws(() => startMetadata('source', [row], 'local', null), /正在执行/)
  cancelMetadata()
  assert.equal((await wait())?.state, 'cancelled')
  assert.equal(metadataStatus('source').job?.done, 0)
  assert.equal(metadataObservations('source')('/root/two'), undefined)
  let online = false, attempts = 0
  const flaky = { async getFileInfo() { attempts++; if (!online) throw new Error('fetch failed'); return { size: 5 } } } as unknown as OpenListClient
  startMetadata('source', [row, { ...row, id: 2, remote_path: '/root/resume' }], 'remote', flaky, async () => online)
  for (let n = 0; n < 100 && metadataStatus('source').job?.state !== 'paused'; n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(metadataStatus('source').job?.state, 'paused')
  assert.equal(attempts, 0, 'offline preflight never fans out file requests')
  online = true
  for (let n = 0; n < 300 && ['running', 'paused'].includes(metadataStatus('source').job?.state || ''); n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(metadataStatus('source').job?.state, 'completed')
  assert.equal(metadataStatus('source').job?.done, 2)
  assert.equal(metadataStatus('source').job?.failed, 0)
  assert.equal(attempts, 2)

})
