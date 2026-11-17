import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getBackupDb } from '../src/server/openlist/openlistBackupDb'

// getDataPath() 在 getBackupDb() 调用时才读取，因此可在静态 import 之后再设置
const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-busy-timeout-'))
;(globalThis as any).lx = { dataPath }

test('S10 OpenList SQLite：busy_timeout 已生效且连接单例复用', () => {
  const db = getBackupDb()
  assert.equal(getBackupDb(), db, '重复调用应返回同一连接，避免多连接互相抢锁')
  const row = db.prepare('PRAGMA busy_timeout').get() as Record<string, number>
  assert.equal(Number(Object.values(row)[0]), 8000)
  assert.equal(db.prepare('PRAGMA journal_mode').get() !== undefined, true)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='openlist_backup_files'").all()
  assert.equal(tables.length, 1)
  assert.ok(fs.existsSync(path.join(dataPath, 'openlist-backup.db')))
  db.close()
  fs.rmSync(dataPath, { recursive: true, force: true })
})

test('S10 契约：busy_timeout 与并发注释保留在连接初始化处', () => {
  const source = fs.readFileSync(path.resolve('src/server/openlist/openlistBackupDb.ts'), 'utf8')
  assert.match(source, /PRAGMA busy_timeout = 8000/)
  assert.match(source, /PRAGMA journal_mode = WAL/)
  assert.match(source, /function getBackupDb\(\)/)
})
