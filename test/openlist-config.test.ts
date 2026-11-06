import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { closeBackupDb, getBackupDb } from '../src/server/openlistBackupDb'
import {
  DEFAULT_OPENLIST_CONFIG,
  hasOpenlistConfigRecord,
  loadOpenlistConfig,
  migrateOpenlistConfigFromLegacy,
  saveOpenlistConfig,
  stripOpenlistKeysFromConfig,
} from '../src/server/openlistConfigDb'
import { getOpenlistClient, getOpenlistConfig, saveOpenlistConfig as saveRuntimeConfig } from '../src/server/openlistRuntime'

/** 每个用例独立数据目录：先关闭单例连接，避免跨用例复用同一个 db 文件 */
const useTempData = (t: any): string => {
  closeBackupDb()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-openlist-config-'))
  const original = (globalThis as any).lx
  ;(globalThis as any).lx = { dataPath: dir }
  t.after(() => {
    closeBackupDb()
    ;(globalThis as any).lx = original
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

test('OpenList 配置存储与运行时门面', async t => {
  await t.test('空库返回默认配置，且不产生配置记录', (t: any) => {
    const dir = useTempData(t)
    assert.equal(hasOpenlistConfigRecord(), false)
    assert.equal(fs.existsSync(path.join(dir, 'openlist-backup.db')), true)
    assert.deepEqual(loadOpenlistConfig(), { ...DEFAULT_OPENLIST_CONFIG, userBackups: [] })
  })

  await t.test('首次迁移写入主表与用户子表，兼容旧 keepLocalAfterUpload', (t: any) => {
    useTempData(t)
    const ok = migrateOpenlistConfigFromLegacy({
      'openlist.enable': true,
      'openlist.endpoint': 'http://openlist:5244/',
      'openlist.username': 'admin',
      'openlist.password': 'secret',
      'openlist.token': 'token-x',
      'openlist.root': '/lx_music/dev',
      'openlist.verifyInterval': '7',
      'openlist.syncInterval': 30,
      'openlist.includeNonAudio': true,
      'openlist.backupSystemConfig': true,
      'openlist.keepLocalAfterUpload': false,
      'openlist.userBackups': JSON.stringify([
        { user: 'm', enabled: true },
        { user: 'n', enabled: false, mode: 'sync', downloadDir: '/legacy' },
      ]),
    })
    assert.equal(ok, true)
    const cfg = loadOpenlistConfig()
    assert.equal(cfg.enable, true)
    // 存储层保留原始值（规范化交给运行时门面）
    assert.equal(cfg.endpoint, 'http://openlist:5244/')
    assert.equal(cfg.username, 'admin')
    assert.equal(cfg.password, 'secret')
    assert.equal(cfg.token, 'token-x')
    assert.equal(cfg.root, '/lx_music/dev')
    assert.equal(cfg.verifyInterval, 7)
    assert.equal(cfg.syncInterval, 30)
    assert.equal(cfg.includeNonAudio, true)
    assert.equal(cfg.backupSystemConfig, true)
    assert.deepEqual(
      cfg.userBackups.map(u => [u.user, u.enabled, u.mode, u.downloadDir]),
      [['m', true, 'upload-delete', undefined], ['n', false, 'sync', '/legacy']],
    )
  })

  await t.test('已有记录时二次迁移不覆盖，保存为增量补丁并按 user 替换规则', (t: any) => {
    useTempData(t)
    assert.equal(migrateOpenlistConfigFromLegacy({
      'openlist.enable': true,
      'openlist.endpoint': 'http://a',
      'openlist.userBackups': JSON.stringify([{ user: 'm' }, { user: 'n' }]),
    }), true)

    assert.equal(migrateOpenlistConfigFromLegacy({ 'openlist.enable': false, 'openlist.endpoint': 'http://should-not-apply' }), false)
    let cfg = loadOpenlistConfig()
    assert.equal(cfg.enable, true)
    assert.equal(cfg.endpoint, 'http://a')

    saveOpenlistConfig({ endpoint: 'http://b' })
    cfg = loadOpenlistConfig()
    assert.equal(cfg.endpoint, 'http://b')
    assert.deepEqual(cfg.userBackups.map(u => u.user), ['m', 'n'])

    // 传入 userBackups 时整体替换：未出现的用户被删除，缺省 mode 落为 upload
    saveOpenlistConfig({ userBackups: [{ user: 'x', enabled: false }, { user: 'm', enabled: true, mode: 'download' }] })
    cfg = loadOpenlistConfig()
    assert.deepEqual(cfg.userBackups.map(u => [u.user, u.mode, u.enabled]), [['m', 'download', true], ['x', 'upload', false]])
  })

  await t.test('非法 userBackups JSON 按空规则处理且不抛错', (t: any) => {
    useTempData(t)
    assert.equal(migrateOpenlistConfigFromLegacy({ 'openlist.enable': true, 'openlist.userBackups': '{oops' }), true)
    assert.deepEqual(loadOpenlistConfig().userBackups, [])
  })

  await t.test('清理 config.js 残留键时保留 backup.openlist.*', () => {
    const config: any = {
      'openlist.enable': true,
      'openlist.root': '/x',
      'openlist.keepLocalAfterUpload': false,
      'backup.openlist.types': ['music'],
      serverName: 'demo',
    }
    const removed = stripOpenlistKeysFromConfig(config)
    assert.deepEqual(removed.sort(), ['openlist.enable', 'openlist.keepLocalAfterUpload', 'openlist.root'])
    assert.deepEqual(config, { 'backup.openlist.types': ['music'], serverName: 'demo' })
  })

  await t.test('运行时门面规范化 endpoint 并在 externalUrl 为空时回退', (t: any) => {
    useTempData(t)
    saveRuntimeConfig({ enable: true, endpoint: 'http://10.0.8.2:5244/', externalUrl: '' })
    const cfg = getOpenlistConfig()
    assert.equal(cfg.endpoint, 'http://10.0.8.2:5244')
    assert.equal(cfg.externalUrl, 'http://10.0.8.2:5244')

    saveRuntimeConfig({ externalUrl: 'https://cdn.example.com/' })
    assert.equal(getOpenlistConfig().externalUrl, 'https://cdn.example.com')
  })

  await t.test('客户端按连接参数复用，写入后失效，禁用返回 null', (t: any) => {
    useTempData(t)
    assert.equal(getOpenlistClient(), null)

    saveRuntimeConfig({ enable: true, endpoint: 'http://10.0.8.2:5244/', username: 'u', password: 'p', token: '', root: '/r' })
    const first = getOpenlistClient()
    assert.ok(first)
    assert.equal(getOpenlistClient(), first)

    saveRuntimeConfig({ token: 'token-x' })
    const second = getOpenlistClient()
    assert.ok(second)
    assert.notEqual(second, first)

    saveRuntimeConfig({ enable: false })
    assert.equal(getOpenlistClient(), null)
  })

  await t.test('连接启用 WAL 与 busy_timeout，写冲突时等待而不是立即报 database is locked', (t: any) => {
    const dir = useTempData(t)
    const db = getBackupDb()
    const mode = db.prepare('PRAGMA journal_mode').get() as any
    assert.equal(String(Object.values(mode)[0]).toLowerCase(), 'wal')
    const timeout = db.prepare('PRAGMA busy_timeout').get() as any
    assert.equal(Number(Object.values(timeout)[0]), 8000)

    // 另一连接持有写锁时，当前连接的写入应等待超时而非立刻失败
    const other = new DatabaseSync(path.join(dir, 'openlist-backup.db'))
    other.exec('PRAGMA busy_timeout = 8000')
    other.exec('BEGIN IMMEDIATE')
    try {
      db.exec('PRAGMA busy_timeout = 200')
      const started = Date.now()
      assert.throws(() => db.exec('UPDATE openlist_backup_files SET status = status'))
      assert.ok(Date.now() - started >= 150, '应当等待 busy_timeout 后才失败')
    } finally {
      other.exec('ROLLBACK')
      other.close()
      db.exec('PRAGMA busy_timeout = 8000')
    }
  })
})
