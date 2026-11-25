import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalChangedChecker } from '../src/server/openlist/openlistLocalChange'

function harness(initial = 'original') {
  const file = {
    content: initial,
    size: initial.length,
    mtimeMs: 1000,
  }
  let hashes = 0
  const baselines: Array<[number, number]> = []
  const checker = createLocalChangedChecker({
    exists: () => true,
    stat: () => ({ size: file.size, mtimeMs: file.mtimeMs }),
    hash: () => { hashes++; return file.content },
    onBaseline: (_row, size, mtimeMs) => baselines.push([size, mtimeMs]),
  })
  const row = () => ({
    id: 7,
    local_path: '/data/song.mp3',
    local_hash: 'original' as string | null,
    size: 8 as number | null,
    local_mtime: 1000 as number | null,
    status: 'verified',
  })
  return { file, row, checker, baselines, get hashes() { return hashes } }
}

test('repeated checks inside one round hash the file only once', () => {
  const h = harness()
  h.checker.beginRound()
  assert.equal(h.checker.inRound(), true)
  assert.equal(h.checker.changed(h.row()), false)
  assert.equal(h.checker.changed(h.row()), false)
  assert.equal(h.checker.changed(h.row()), false)
  assert.equal(h.hashes, 1)
  h.checker.endRound()
  assert.equal(h.checker.inRound(), false)
  assert.deepEqual(h.baselines, [])
})

test('each new round recomputes the hash so same-size edits with a restored mtime are detected', () => {
  const h = harness()
  h.checker.beginRound()
  assert.equal(h.checker.changed(h.row()), false)
  h.checker.endRound()

  // Same size, mtime explicitly restored: a stat-only shortcut would miss this edit.
  h.file.content = 'modified'
  h.checker.beginRound()
  assert.equal(h.checker.changed(h.row()), true, 'content change is still detected across rounds')
  assert.equal(h.hashes, 2)
  h.checker.endRound()
})

test('hash-in-flight stat changes are treated as changed and not cached', () => {
  const h = harness()
  let flip = true
  let hashes = 0
  const checker = createLocalChangedChecker({
    exists: () => true,
    stat: () => ({ size: h.file.size, mtimeMs: h.file.mtimeMs }),
    hash: () => {
      hashes++
      if (flip) { h.file.content = 'modified'; h.file.mtimeMs = 2000; flip = false }
      return h.file.content
    },
    onBaseline: () => {},
  })
  checker.beginRound()
  assert.equal(checker.changed(h.row()), true, 'stat changed while hashing, so result is not trusted')
  assert.equal(hashes, 1)
  assert.equal(checker.changed(h.row()), true, 'no stale memo was written for the racy result')
  assert.equal(hashes, 2)
  checker.endRound()
})

test('useMemo=false bypasses the round cache for freshly written files', () => {
  const h = harness()
  h.checker.beginRound()
  assert.equal(h.checker.changed(h.row()), false)
  h.file.content = 'modified'
  assert.equal(h.checker.changed(h.row(), false), true)
  assert.equal(h.hashes, 2)
  h.checker.endRound()
})

test('missing files and rows without a hash fall back to size/mtime semantics', () => {
  const h = harness()
  const checker = createLocalChangedChecker({
    exists: p => p !== '/missing',
    stat: () => ({ size: 8, mtimeMs: 1000 }),
    hash: () => { throw new Error('should not hash') },
  })
  assert.equal(checker.changed({ ...h.row(), local_path: '/missing' }), false)
  const noHash = { ...h.row(), local_hash: null }
  assert.equal(checker.changed(noHash), false)
  assert.equal(checker.changed({ ...noHash, size: 9 }), true)
  assert.equal(checker.changed({ ...noHash, local_mtime: null }), true)
  assert.equal(checker.changed({ ...noHash, local_mtime: 999 }), true)
})

test('baseline drift is corrected once when content is unchanged', () => {
  const h = harness()
  const checker = createLocalChangedChecker({
    exists: () => true,
    stat: () => ({ size: 8, mtimeMs: 2222 }),
    hash: () => 'original',
    onBaseline: (_row, size, mtimeMs) => h.baselines.push([size, mtimeMs]),
  })
  checker.beginRound()
  assert.equal(checker.changed(h.row()), false)
  assert.deepEqual(h.baselines, [[8, 2222]])
  checker.endRound()
})
