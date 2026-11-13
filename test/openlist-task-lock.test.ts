import test from 'node:test'
import assert from 'node:assert/strict'
import { isTaskRunning, runExclusive } from '../src/server/openlist/openlistTaskLock'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('exclusive tasks run one at a time and report running state', async () => {
  assert.equal(isTaskRunning(), false)
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })

  const first = runExclusive(async () => {
    order.push('first:start')
    await gate
    order.push('first:end')
    return 1
  })
  await tick()
  assert.equal(isTaskRunning(), true)

  const second = runExclusive(async () => {
    order.push('second:start')
    return 2
  })
  await tick()
  assert.deepEqual(order, ['first:start'], 'the second task must wait for the first')

  release()
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start'])
  assert.equal(isTaskRunning(), false)
})

test('a queued task is not reported as running and a failure never blocks the queue', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const first = runExclusive(async () => { await gate })
  const failing = runExclusive(async () => { throw new Error('boom') })
  const after = runExclusive(async () => 'ok')

  await tick()
  assert.equal(isTaskRunning(), true)
  release()
  await first
  await assert.rejects(() => failing, /boom/)
  assert.equal(await after, 'ok', 'a thrown task must still release the lock')
  assert.equal(isTaskRunning(), false)
})

test('running state stays false when only queued work exists', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const first = runExclusive(async () => { await gate })
  await tick()
  assert.equal(isTaskRunning(), true)
  release()
  await first
  assert.equal(isTaskRunning(), false)
})
