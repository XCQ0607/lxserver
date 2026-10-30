import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWithQualityFallback } from '../src/server/music/downloadQuality'
import { CastAccessStore, normalizeCastTarget } from '../src/server/integrations/castAccess'

test('downloads fall back in order, reject empty URLs and stop on success', async () => {
  const attempted: string[] = []
  const result = await resolveWithQualityFallback('320k', async quality => {
    attempted.push(quality)
    if (quality === '320k') throw new Error('unavailable')
    return quality === '192k' ? { url: '' } : { url: '/song', type: '128k' }
  })
  assert.deepEqual(attempted, ['320k', '192k', '128k'])
  assert.equal(result.quality, '128k')
  assert.equal(result.result.url, '/song')
})

test('unknown download qualities are attempted once; total failure is reported', async () => {
  const attempted: string[] = []
  await assert.rejects(resolveWithQualityFallback('custom', async quality => {
    attempted.push(quality)
    throw new Error('provider failed')
  }), /custom: provider failed/)
  assert.deepEqual(attempted, ['custom'])
})

test('successful downloads never request lower qualities', async () => {
  let calls = 0
  await resolveWithQualityFallback('flac', async () => { calls++; return { url: '/lossless' } })
  assert.equal(calls, 1)
})

test('cast grants expire at the exact deadline and cannot be revoked by another owner', () => {
  let now = 100
  const store = new CastAccessStore(() => now, 50)
  const grant = store.issue('/song', 'audio/mpeg', { owner: 'alice', headers: {}, valid: () => true })
  assert.equal(store.revoke(grant.id, 'bob'), false)
  assert.equal(store.get(grant.id)?.target, '/song')
  now = 150
  assert.equal(store.get(grant.id), null)
})

test('cast access stops when the source session is invalidated', () => {
  let valid = true
  const store = new CastAccessStore()
  const identity = { owner: 'alice', headers: {}, valid: () => valid }
  const grant = store.issue('/song', 'audio/mpeg', identity)
  valid = false
  assert.equal(store.get(grant.id), null)
  valid = true
  assert.equal(store.get(grant.id), null)
  const fresh = store.issue('/song', 'audio/mpeg', identity)
  assert.equal(store.revoke(fresh.id, 'alice'), true)
  assert.equal(store.get(fresh.id), null)
})

test('cast grant limit evicts the oldest resource for that owner only', () => {
  const store = new CastAccessStore()
  const alice = { owner: 'alice', headers: {}, valid: () => true }
  const bob = store.issue('/bob', 'audio/mpeg', { ...alice, owner: 'bob' })
  const first = store.issue('/first', 'audio/mpeg', alice)
  for (let i = 0; i < 16; i++) store.issue(`/song-${i}`, 'audio/mpeg', alice)
  assert.equal(store.get(first.id), null)
  assert.equal(store.get(bob.id)?.target, '/bob')
})

test('cast URLs strip account tokens and reject non-music endpoints', async () => {
  assert.equal(await normalizeCastTarget('/api/music/cache/file/song?token=secret&inline=1#fragment'), '/api/music/cache/file/song?inline=1')
  for (const url of ['/api/files/download', '/api/music/cache/file/../../admin', '/api/music/download?url=http://127.0.0.1/']) {
    await assert.rejects(normalizeCastTarget(url))
  }
})
