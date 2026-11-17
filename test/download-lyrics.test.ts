import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSongLyricData, normalizeDownloadLyricSong, resolveDownloadLyrics } from '../src/server/music/downloadLyrics'

test('download lyrics preserve native platform metadata and exact identity from saved favorites', async () => {
  const song = { id: 'mg_123', meta: { source: 'mg', songId: '123', copyrightId: 'copyright', lrcUrl: 'https://lyrics.example/123', trcUrl: 'https://lyrics.example/trans/123', hash: 'hash' } }
  const normalized = normalizeDownloadLyricSong(song)
  assert.equal(normalized.source, 'mg')
  assert.equal(normalized.songmid, '123')
  let called = 0
  const result = await resolveSongLyricData(song, 'alice', (identity, owner) => {
    assert.equal(identity.strictIdentity, true)
    assert.equal(owner, 'alice')
    return { exists: false }
  }, { mg: { getLyric(info: any) {
    called++
    assert.equal(info.copyrightId, 'copyright')
    assert.equal(info.lrcUrl, song.meta.lrcUrl)
    assert.equal(info.trcUrl, song.meta.trcUrl)
    return { promise: Promise.resolve({ lyric: '[00:01.00]original', tlyric: '[00:01.00]translation' }) }
  } } })
  assert.equal(called, 1)
  assert.equal(result.tlyric, '[00:01.00]translation')
})

test('network failure falls back to exact local embedded lyrics without searching other platforms', async () => {
  const attempts: boolean[] = []
  const text = await resolveDownloadLyrics({ source: 'tx', songmid: 'tx_123' }, 'alice', (song, owner) => {
    assert.equal(owner, 'alice')
    assert.equal(song.source, 'tx')
    assert.equal(song.songmid, '123')
    assert.equal(song.strictIdentity, true)
    attempts.push(song.includeEmbedded)
    return song.includeEmbedded ? { exists: true, content: { lyric: '[00:01.00]embedded' } } : { exists: false }
  }, { tx: { getLyric() { throw new Error('offline') } }, wy: { getLyric() { throw new Error('must never search other platforms') } } })
  assert.deepEqual(attempts, [false, true])
  assert.match(text, /embedded/)
})

test('empty network lyrics trigger local fallback; corrupt cache does not prevent network lookup', async () => {
  let attempts = 0
  const result = await resolveSongLyricData({ source: 'wy', id: 'wy_1' }, '_open', () => {
    if (++attempts === 1) throw new Error('bad cache')
    return { exists: true, content: { lyric: '[00:01.00]local' } }
  }, { wy: { getLyric: () => ({ promise: Promise.resolve({ lyric: '' }) }) } })
  assert.equal(result.lyric, '[00:01.00]local')
  assert.equal(attempts, 2)
})

test('disabling local lyrics does not use caches or embedded fallback', async () => {
  await assert.rejects(resolveSongLyricData({ source: 'wy', id: '1' }, 'alice', () => { throw new Error('must not read cache') },
    { wy: { getLyric() { throw new Error('network failed') } } }, false), /network failed/)
})
