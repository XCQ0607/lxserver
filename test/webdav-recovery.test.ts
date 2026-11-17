import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { Readable } from 'node:stream'
import WebDAVSync from '../src/utils/webdavSync'
import { WebdavRecovery, checkedBackupPath } from '../src/utils/webdavRecovery'
import { webdavManifestName } from '../src/utils/webdavState'
import { uploadWebdavFile, downloadWebdavFile } from '../src/utils/webdavTransfer'
import { beginCloudBackup, beginCloudRestore } from '../src/utils/backupPolicy'
import { rollbackRestoreTask, listRestoreTasks } from '../src/server/backup/webdavRestoreTasks'

test('WebDAV recovery, persistent baselines and streaming transfers', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-webdav-recovery-'))
  const previous = global.lx
  global.lx = { dataPath: temp, config: {}, configPath: path.join(temp, 'config.js') } as any
  t.after(() => { global.lx = previous; fs.rmSync(temp, { recursive: true, force: true }) })
  const local = (relative: string, text: string) => {
    const file = path.join(temp, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file
  }
  const remote = new Map<string, Buffer>()
  let failRead = '', failMove = false, reads = 0, moves = 0, puts = 0
  const client = {
    exists: async () => true, createDirectory: async () => {},
    getDirectoryContents: async (prefix: string) => [...remote].filter(([name]) => name.startsWith(prefix)).map(([filename, bytes]) => ({ filename, basename: path.posix.basename(filename), type: 'file', size: bytes.length })),
    createReadStream: (name: string) => { reads++; if (name === failRead) return Readable.from((async function* () { throw new Error('read failed') })()); return Readable.from([remote.get(name)!]) },
    stat: async (name: string) => { if (!remote.has(name)) throw Object.assign(new Error('missing'), { status: 404 }); return { size: remote.get(name)!.length } },
    putFileContents: async (name: string, stream: any) => { puts++; const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk); remote.set(name, Buffer.concat(chunks)); return true },
    moveFile: async (from: string, to: string) => { if (failMove) throw new Error('MOVE failed'); moves++; remote.set(to, remote.get(from)!); remote.delete(from) },
    deleteFile: async (name: string) => { remote.delete(name) },
  }
  const context = () => ({ dataPath: temp, configPath: global.lx.configPath, config: {}, client, types: ['userData'] as any, syncPath: '/sync', backupPath: '/zip', identity: 'test' })
  const a = local('users/alice/a.json', 'local-a'), b = local('users/alice/b.json', 'local-b')
  const seed = () => {
    remote.clear(); failRead = ''; remote.set('/sync/users/alice/a.json', Buffer.from('cloud-a')); remote.set('/sync/users/alice/b.json', Buffer.from('cloud-b'))
    local('users/alice/a.json', 'local-a'); local('users/alice/b.json', 'local-b')
  }
  await t.test('a second download failure leaves every original intact', async () => {
    seed(); const recovery = new WebdavRecovery(), preview = await recovery.prepare(context())
    failRead = '/sync/users/alice/b.json'
    const result = await recovery.execute(context(), preview.token)
    assert.match(result.errors.join(), /read failed/)
    assert.equal(fs.readFileSync(a, 'utf8'), 'local-a'); assert.equal(fs.readFileSync(b, 'utf8'), 'local-b')
  })
  await t.test('size-only downloads reject both truncation and oversized responses', async () => {
    seed(); const target = path.join(temp, 'download.tmp')
    await assert.rejects(downloadWebdavFile(client, '/sync/users/alice/a.json', target, 100), /不完整/)
    assert.equal(fs.existsSync(target), false)
    await assert.rejects(downloadWebdavFile(client, '/sync/users/alice/a.json', target, 1), /超过/)
    assert.equal(fs.existsSync(target), false)
  })
  await t.test('new manifests detect same-size corruption before committing anything', async () => {
    seed()
    const files = Object.fromEntries([...remote].map(([name, data]) => [name.slice('/sync/'.length), { size: data.length, hash: crypto.createHash('sha256').update(data).digest('hex') }]))
    remote.set('/sync/' + webdavManifestName, Buffer.from(JSON.stringify({ schema: 1, files })))
    const recovery = new WebdavRecovery(), preview = await recovery.prepare(context())
    remote.set('/sync/users/alice/b.json', Buffer.from('broken!'))
    const result = await recovery.execute(context(), preview.token)
    assert.match(result.errors.join(), /SHA-256/); assert.equal(fs.readFileSync(a, 'utf8'), 'local-a')
    remote.delete('/sync/users/alice/b.json')
    await assert.rejects(recovery.prepare(context()), /清单中的文件缺失/)
  })
  await t.test('preview is read-only, bound to config and rejects changed local files', async () => {
    seed(); const recovery = new WebdavRecovery(), preview = await recovery.prepare(context())
    assert.equal(preview.overwritten, 2); assert.equal(fs.readFileSync(a, 'utf8'), 'local-a')
    await assert.rejects(recovery.execute({ ...context(), identity: 'different' }, preview.token), /配置已变化/)
    fs.writeFileSync(a, 'user edit')
    await assert.rejects(recovery.execute(context(), preview.token), /本地文件已变化/)
  })
  await t.test('missing-only adds files while retaining existing files and permits guarded rollback', async () => {
    seed(); fs.unlinkSync(b)
    const recovery = new WebdavRecovery(), preview = await recovery.prepare(context(), { strategy: 'missing', keepCopies: true })
    assert.equal(preview.skipped, 1); assert.equal(preview.added, 1)
    const result = await recovery.execute(context(), preview.token)
    assert.deepEqual(result.errors, []); assert.equal(result.restored, 1)
    assert.equal(fs.readFileSync(a, 'utf8'), 'local-a'); assert.equal(fs.readFileSync(b, 'utf8'), 'cloud-b')
    rollbackRestoreTask(result.taskId); assert.equal(fs.existsSync(b), false)
    assert.ok(listRestoreTasks().some(task => task?.id === result.taskId && task.state === 'rolled-back'))
  })
  const instance = (mirrorDeletes = false) => {
    const sync = new WebDAVSync({ enable: true, url: 'http://fixture.invalid', syncPath: '/sync', types: ['userData'], mirrorDeletes }, temp)
    ;(sync as any).client = client
    return sync
  }
  await t.test('runtime status reports actual scheduled checks and clears them when stopped', () => {
    const sync = instance(), before = Date.now()
    try {
      sync.startAutoSync()
      const status = sync.getRuntimeStatus()
      assert.ok(status.nextSyncAt >= before + 60 * 60_000)
      assert.ok(status.nextZipAt >= before + 24 * 3600_000)
      assert.equal(status.running, false)
      global.lx.restoreMaintenance = true
      assert.equal(sync.getRuntimeStatus().nextSyncAt, 0)
      global.lx.restoreMaintenance = false
    } finally { global.lx.restoreMaintenance = false; sync.stopAutoSync() }
    assert.equal(sync.getRuntimeStatus().nextSyncAt, 0)
    assert.equal(sync.getRuntimeStatus().nextZipAt, 0)
  })
  await t.test('successful backup has no body downloads and survives restart without re-uploading', async () => {
    seed(); const sync = instance(); const before = reads
    await sync.syncChangedFiles(); assert.equal(reads, before)
    const uploaded = puts
    await instance().syncChangedFiles(); assert.equal(puts, uploaded)
    assert.ok(remote.has('/sync/' + webdavManifestName))
  })
  await t.test('tracked deletion propagates after restart only when mirror deletion is enabled', async () => {
    fs.unlinkSync(a); await instance(true).syncChangedFiles()
    assert.equal(remote.has('/sync/users/alice/a.json'), false)
    fs.unlinkSync(b); await instance(false).syncChangedFiles()
    assert.equal(remote.has('/sync/users/alice/b.json'), true)
  })
  await t.test('a fresh baseline preserves cloud-only manifest entries and permits legacy files with an explicit warning', async () => {
    const legacy = '/sync/users/alice/legacy.json'
    remote.set(legacy, Buffer.from('legacy'))
    const newFile = local('users/alice/new.json', 'new content')
    const sync = instance()
    ;(sync as any).publishedManifest = ''; (sync as any).remoteVersions = {}; (sync as any).filesHash.clear()
    await sync.syncChangedFiles()
    const manifest = JSON.parse(remote.get('/sync/' + webdavManifestName)!.toString())
    assert.ok(manifest.files['users/alice/b.json'])
    assert.ok(manifest.files['users/alice/new.json'])
    assert.equal(manifest.files['users/alice/legacy.json'], undefined)
    const recovery = new WebdavRecovery(), preview = await recovery.prepare(context(), { strategy: 'missing' })
    assert.ok(preview.warnings.some(warning => /部分旧云端文件/.test(warning)))
    assert.equal(fs.readFileSync(newFile, 'utf8'), 'new content')
    recovery.discard(preview.token)
  })
  await t.test('failed atomic upload never replaces the previous object and cleans temporary files', async () => {
    const file = local('users/alice/upload.json', 'new value'); remote.set('/object', Buffer.from('old value'))
    failMove = true
    await assert.rejects(uploadWebdavFile(client, file, '/object', 9), /MOVE failed/)
    failMove = false
    assert.equal(remote.get('/object')!.toString(), 'old value')
    assert.equal([...remote.keys()].some(name => name.endsWith('.part')), false)
    const before = moves
    await assert.rejects(uploadWebdavFile(client, file, '/object', 9, undefined, '0'.repeat(64)), /上传期间文件变化/)
    assert.equal(moves, before)
  })
  await t.test('restore excludes active backups and new backups during a restore', () => {
    const done = beginCloudBackup(); assert.throws(beginCloudRestore, /正在备份/); done(); done()
    const restored = beginCloudRestore(); assert.throws(beginCloudBackup, /恢复维护/); restored()
  })
  await t.test('ZIP deletion cannot escape the configured archive directory', () => {
    for (const input of ['/else/lx-sync-backup-ok.zip', '../lx-sync-backup-ok.zip', '/zip/../lx-sync-backup-ok.zip', '/zip/config.js']) assert.throws(() => checkedBackupPath('/zip', input))
    assert.equal(checkedBackupPath('/zip', 'lx-sync-backup-ok.zip'), '/zip/lx-sync-backup-ok.zip')
  })
  await t.test('retention respects both limits and always keeps the newest archive', async () => {
    remote.clear(); const sync = instance()
    ;(sync as any).backupPath = '/zip'; (sync as any).config.retentionCount = 2
    for (const date of ['2026-01-01', '2026-01-02', '2026-01-03']) remote.set(`/zip/lx-sync-backup-${date}.zip`, Buffer.from('zip'))
    remote.set('/zip/unrelated.zip', Buffer.from('keep'))
    await sync.cleanOldBackups()
    assert.equal(remote.has('/zip/lx-sync-backup-2026-01-01.zip'), false)
    ;(sync as any).config.retentionDays = 1
    await sync.cleanOldBackups()
    assert.equal(remote.has('/zip/lx-sync-backup-2026-01-02.zip'), false)
    assert.equal(remote.has('/zip/lx-sync-backup-2026-01-03.zip'), true)
    assert.equal(remote.has('/zip/unrelated.zip'), true)
  })
  await t.test('real WebDAV SDK streams PUT/MOVE/PROPFIND/GET over isolated local HTTP', async () => {
    const store = new Map<string, Buffer>(), methods: string[] = []
    const server = http.createServer(async (req, res) => {
      const key = decodeURIComponent(req.url!); methods.push(req.method!)
      if (req.method === 'PUT') { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk); store.set(key, Buffer.concat(chunks)); res.writeHead(201); res.end(); return }
      if (req.method === 'MOVE') { const dest = decodeURIComponent(new URL(req.headers.destination!).pathname); store.set(dest, store.get(key)!); store.delete(key); res.writeHead(201); res.end(); return }
      if (req.method === 'DELETE') { store.delete(key); res.writeHead(204); res.end(); return }
      if (!store.has(key)) { res.writeHead(404); res.end(); return }
      if (req.method === 'PROPFIND') { res.writeHead(207, { 'Content-Type': 'application/xml' }); res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${key}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${store.get(key)!.length}</d:getcontentlength><d:getetag>"fixture"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`); return }
      res.writeHead(200, { 'Content-Length': store.get(key)!.length }); res.end(store.get(key))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const { createClient } = await import('webdav')
      const sdk = createClient(`http://127.0.0.1:${(server.address() as any).port}`)
      const file = local('users/alice/stream.json', 'large '.repeat(50000)), size = fs.statSync(file).size
      await uploadWebdavFile(sdk, file, '/backup', size)
      assert.equal(methods.includes('GET'), false)
      const output = path.join(temp, 'sdk-downloaded.tmp')
      await downloadWebdavFile(sdk, '/backup', output, size)
      assert.deepEqual(fs.readFileSync(output), fs.readFileSync(file))
      assert.ok(methods.includes('MOVE') && methods.includes('PROPFIND') && methods.includes('GET'))
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
