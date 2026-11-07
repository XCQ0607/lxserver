const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { build, transformSync } = require('esbuild')

test('local config backups: manual collisions, snapshot versions, disable and retention', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-local-backup-'))
  try {
    const source = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8')
    const body = source.slice(source.indexOf("let lastBackupSlot = ''"), source.indexOf('const saveConfigToFile ='))
    const configPath = path.join(temp, 'config.js'); fs.writeFileSync(configPath, 'module.exports = {}')
    const lx = { config: { 'configBackup.enable': true, 'configBackup.retentionDays': 7 }, configPath }
    const context = vm.createContext({ fs, path, dataPath: temp, global: { lx }, console: { log() {}, error() {}, warn() {} } })
    const code = transformSync(body + '\nglobal.api = { backupConfig, backupConfigNow, backupSnapshotToLocal, removeSnapshotLocalBackups, cleanOldConfigBackups, getConfigBackupDir }', { loader: 'ts' }).code
    vm.runInContext(code, context)
    const api = context.global.api
    api.backupConfig()
    const first = api.backupConfigNow(), second = api.backupConfigNow()
    assert.equal(first.success, true); assert.equal(second.success, true)
    assert.notEqual(first.filename, second.filename)
    assert.equal(fs.readFileSync(path.join(api.getConfigBackupDir(), first.filename), 'utf8'), 'module.exports = {}')
    const snapshot = path.join(temp, 'snapshot'); fs.writeFileSync(snapshot, 'first version')
    api.backupSnapshotToLocal(snapshot, 'alice', 'abc')
    fs.writeFileSync(snapshot, 'second version'); api.backupSnapshotToLocal(snapshot, 'alice', 'abc')
    const dir = path.join(api.getConfigBackupDir(), 'snapshots/alice')
    assert.equal(fs.readdirSync(dir).length, 2)
    assert.deepEqual(fs.readdirSync(dir).map(n => fs.readFileSync(path.join(dir, n), 'utf8')).sort(), ['first version', 'second version'])
    lx.config['configBackup.enable'] = false
    api.backupSnapshotToLocal(snapshot, 'alice', 'disabled')
    assert.equal(fs.readdirSync(dir).length, 2)
    api.removeSnapshotLocalBackups('alice', 'abc'); assert.equal(fs.readdirSync(dir).length, 0)
    const old = path.join(api.getConfigBackupDir(), 'config-old.js'); fs.writeFileSync(old, 'old')
    const oldSnap = path.join(dir, 'snapshot_old'); fs.writeFileSync(oldSnap, 'old')
    for (const file of [old, oldSnap]) fs.utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1))
    api.cleanOldConfigBackups()
    assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(oldSnap), false)
    assert.equal(fs.existsSync(path.join(api.getConfigBackupDir(), first.filename)), true)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('playlist and dislike snapshots restore, migrate independently, and report failed deletion', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-snapshot-manage-'))
  const previous = global.lx
  try {
    await build({
      stdin: { contents: "export { ListManage } from './src/modules/list/manage'; export { DislikeManage } from './src/modules/dislike/manage'", resolveDir: path.resolve(__dirname, '..'), loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'snapshots.cjs'),
      plugins: [{ name: 'isolated-users-and-logs', setup(b) {
        b.onResolve({ filter: /^@\/(utils|utils\/log4js|user\/data)$/ }, a => ({ path: a.path, namespace: 'boundary' }))
        b.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({ loader: 'js', contents: `
          import fs from 'node:fs'; import crypto from 'node:crypto';
          export const toMD5 = value => crypto.createHash('md5').update(value).digest('hex');
          export const checkAndCreateDirSync = dir => fs.mkdirSync(dir, { recursive: true });
          export const getUserConfig = () => ({ maxSnapshotNum: 100 });
          export const syncLog = { info() {}, warn() {}, error() {} };
        ` }))
      } }],
    })
    let cloudScheduled = 0, localCopied = 0
    global.lx = { dataPath: temp, config: {}, scheduleOpenlistSync: () => cloudScheduled++, backupSnapshotToLocal: () => localCopied++ }
    const { ListManage, DislikeManage } = require(path.join(temp, 'snapshots.cjs'))
    const user = { userName: 'alice', userDir: path.join(temp, 'users/alice') }
    const list = new ListManage(user), dislike = new DislikeManage(user)
    // Keep persistence synchronous in this test; production throttling is orthogonal to snapshot contents.
    for (const manager of [list, dislike]) manager.snapshotDataManage.saveSnapshotInfoThrottle = () => fs.writeFileSync(manager.snapshotDataManage.snapshotInfoFilePath, JSON.stringify(manager.snapshotDataManage.snapshotInfo))
    await list.listDataManage.initPromise
    const playlist = { defaultList: [{ id: 'song123', name: 'A song' }], loveList: [], userList: [] }
    const rules = { dislikeList: [{ name: 'Blocked song', singer: 'Singer', type: 'music' }] }
    await list.snapshotDataManage.saveSnapshot('same-id', JSON.stringify(playlist))
    await dislike.snapshotDataManage.saveSnapshot('same-id', rules)
    assert.equal(cloudScheduled, 2); assert.equal(localCopied, 2)
    await list.updateDeviceSnapshotKey('device', 'old-list'); await dislike.updateDeviceSnapshotKey('device', 'old-dislike')
    await list.restoreSnapshot('same-id'); await dislike.restoreSnapshot('same-id')
    assert.deepEqual(await list.getListData(), playlist)
    assert.equal((await dislike.getDislikeRules()).dislikeList[0].name, 'Blocked song')
    for (const manager of [list, dislike]) {
      assert.deepEqual(manager.snapshotDataManage.snapshotInfo.clients, {})
      assert.equal(manager.snapshotDataManage.snapshotInfo.latest, 'same-id')
      manager.snapshotDataManage.updateSnapshotDir('external')
    }
    assert.notEqual(list.snapshotDataManage.snapshotDir, dislike.snapshotDataManage.snapshotDir)
    assert.ok(await list.getSnapshot('same-id')); assert.ok(await dislike.snapshotDataManage.getSnapshot('same-id'))
    await dislike.snapshotDataManage.removeSnapshot('same-id')
    assert.ok(await list.getSnapshot('same-id'))
    assert.equal(await dislike.snapshotDataManage.getSnapshot('same-id'), null)
    await assert.rejects(dislike.snapshotDataManage.removeSnapshot('missing'))
    await assert.rejects(list.removeSnapshot('missing'))
    await assert.rejects(dislike.restoreSnapshot('missing'))
  } finally { global.lx = previous; fs.rmSync(temp, { recursive: true, force: true }) }
})

test('local configuration restore route preserves the current configuration before replacing it', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-config-restore-'))
  try {
    const active = path.join(temp, 'config.js'), backup = path.join(temp, 'config-manual-fixture.js'), before = path.join(temp, 'config-before.js')
    fs.writeFileSync(active, 'module.exports = { version: "current" }')
    fs.writeFileSync(backup, 'module.exports = { version: "restored" }')
    let reloads = 0
    const lx = { config: { 'admin.password': 'fixture-password' }, configPath: active, dataPath: temp,
      getConfigBackupDir: () => temp, backupConfigNow: () => { fs.copyFileSync(active, before); return { success: true } } }
    const source = fs.readFileSync(path.join(__dirname, '../src/server/server.ts'), 'utf8')
    const route = source.slice(source.indexOf("if (pathname === '/api/config/backups/restore'"), source.indexOf("if (pathname === '/api/config/test-proxy'"))
    const invoke = (fileName, authenticated = true) => new Promise((resolve, reject) => {
      let status = 200
      const context = vm.createContext({ fs, path, global: { lx }, process,
        pathname: '/api/config/backups/restore', req: { method: 'POST', headers: { 'x-frontend-auth': authenticated ? 'fixture-password' : '' } },
        res: { writeHead: value => { status = value }, end: value => resolve({ status, body: JSON.parse(value) }) },
        readBody: async () => JSON.stringify({ fileName }), reloadServerData: async () => { reloads++ }, updateAllUserSnapshotDirs() {} })
      vm.runInContext(transformSync('(async () => {' + route + '})()', { loader: 'ts' }).code, context).catch(reject)
    })
    assert.equal((await invoke(path.basename(backup), false)).status, 401)
    assert.equal((await invoke('../config-outside.js')).status, 400)
    assert.equal((await invoke('config-missing.js')).status, 404)
    const result = await invoke(path.basename(backup))
    assert.equal(result.status, 200); assert.equal(result.body.success, true)
    assert.equal(reloads, 1)
    assert.equal(fs.readFileSync(active, 'utf8'), 'module.exports = { version: "restored" }')
    assert.equal(fs.readFileSync(before, 'utf8'), 'module.exports = { version: "current" }')
    lx.backupConfigNow = () => ({ success: false, error: 'disk full' })
    const failed = await invoke(path.basename(backup))
    assert.equal(failed.status, 500)
    assert.equal(reloads, 1)
    assert.equal(fs.readFileSync(active, 'utf8'), 'module.exports = { version: "restored" }')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
