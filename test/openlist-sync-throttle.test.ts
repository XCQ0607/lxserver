import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncThrottle } from '../src/server/openlist/openlistSyncThrottle'

interface Pending { id: number; at: number; fn: () => void }

function harness(minIntervalMs = 5 * 60 * 1000) {
  let clock = 1_000_000
  let jobs: Pending[] = []
  let seq = 0
  const runs: number[] = []
  const throttle = createSyncThrottle({
    minIntervalMs,
    now: () => clock,
    schedule: (fn, delayMs) => {
      const id = ++seq
      jobs.push({ id, at: clock + delayMs, fn })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    cancel: handle => { jobs = jobs.filter(job => job.id !== handle) },
    run: async () => { runs.push(clock) },
  })
  const drain = () => {
    for (let guard = 0; guard < 100; guard++) {
      const due = jobs.filter(job => job.at <= clock)
      if (!due.length) return
      for (const job of due) {
        jobs = jobs.filter(item => item.id !== job.id)
        job.fn()
      }
    }
    throw new Error('throttle kept rescheduling')
  }
  const advance = (ms: number, step = 1000) => {
    const target = clock + ms
    while (clock < target) {
      clock = Math.min(target, clock + step)
      drain()
    }
    clock = target
    drain()
  }
  return { throttle, runs, advance, drain, getClock: () => clock }
}

test('event sync requests are merged and throttled to one run per interval', () => {
  const h = harness()
  h.throttle.request()
  h.throttle.request()
  h.throttle.request()
  assert.equal(h.runs.length, 0)
  assert.equal(h.throttle.state().dirty, true)
  assert.equal(h.throttle.state().queued, true)

  h.drain()
  assert.equal(h.runs.length, 1, 'first burst runs immediately')
  assert.equal(h.throttle.state().dirty, false)

  // A new event inside the interval is queued, not executed.
  h.throttle.request()
  h.advance(60_000)
  assert.equal(h.runs.length, 1)
  assert.equal(h.throttle.state().dirty, true)
  assert.equal(h.throttle.state().nextRunAt, h.runs[0] + 5 * 60 * 1000)

  h.advance(4 * 60 * 1000)
  assert.equal(h.runs.length, 2, 'queued event runs once the interval elapses')
  assert.equal(h.throttle.state().dirty, false)
})

test('manual/scheduled sync updates the throttle baseline without being blocked', () => {
  const h = harness()
  h.throttle.request()
  h.drain()
  assert.equal(h.runs.length, 1)

  // A manual full sync at t+30s moves the baseline; a following event waits a full interval.
  h.advance(30_000)
  h.throttle.noteRun()
  h.throttle.request()
  h.advance(4 * 60 * 1000)
  assert.equal(h.runs.length, 1)
  h.advance(60_000)
  assert.equal(h.runs.length, 2)
  assert.equal(h.runs[1] - (h.runs[0] + 30_000), 5 * 60 * 1000)
})

test('noteRun never moves the baseline backwards and cancel drops pending work', () => {
  const h = harness()
  h.advance(10 * 60 * 1000)
  h.throttle.noteRun(h.getClock())
  h.throttle.noteRun(h.getClock() - 60_000)
  assert.equal(h.throttle.state().lastRunAt, h.getClock())

  h.throttle.request()
  assert.equal(h.throttle.state().queued, true)
  h.throttle.cancel()
  assert.deepEqual(h.throttle.state(), { dirty: false, queued: false, lastRunAt: h.getClock(), nextRunAt: 0 })
  h.advance(10 * 60 * 1000)
  assert.equal(h.runs.length, 0, 'cancelled request never triggers a sync')
})

test('a first request after startup is not delayed by a zero baseline', () => {
  const h = harness(60_000)
  assert.equal(h.throttle.state().lastRunAt, 0)
  h.throttle.request()
  assert.equal(h.throttle.state().nextRunAt, h.getClock())
  h.drain()
  assert.equal(h.runs.length, 1)
})
