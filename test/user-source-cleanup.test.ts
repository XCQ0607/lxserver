import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deleteUserSourceFiles } from '../src/server/sources/userSourceCleanup'

test('delete only the selected private source files and reject shared or escaping paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-source-cleanup-'))
  const previous = process.env.DATA_PATH
  process.env.DATA_PATH = root
  try {
    for (const owner of ['alice', 'bob', '_open']) {
      const dir = path.join(root, 'users', 'source', owner)
      fs.mkdirSync(dir, { recursive: true })
      for (const file of ['test.js', 'sources.json', 'order.json', 'states.json']) {
        fs.writeFileSync(path.join(dir, file), '{}')
      }
    }
    deleteUserSourceFiles('alice')
    deleteUserSourceFiles('alice') // Missing directories are harmless.
    assert.equal(fs.existsSync(path.join(root, 'users/source/alice')), false)
    for (const owner of ['bob', '_open']) {
      assert.equal(fs.readdirSync(path.join(root, 'users/source', owner)).length, 4)
    }
    for (const owner of ['', '.', '..', '../bob', '..\\bob', 'open', '_open', 'C:\\data']) {
      assert.throws(() => deleteUserSourceFiles(owner))
    }
  } finally {
    if (previous === undefined) delete process.env.DATA_PATH
    else process.env.DATA_PATH = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})
