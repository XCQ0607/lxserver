import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import crypto from 'node:crypto'
import { transformSync } from 'esbuild'
import { Open } from 'unzipper'
import { ZipArchive } from 'archiver'
import { pipeline } from 'node:stream/promises'
import WebDAVSync from '../src/utils/webdavSync'
import { BACKUP_TYPES, BACKUP_TYPE_INFO, backupLocalPath, backupType, getBackupTypes, normalizeBackupTypes, scanBackupFiles } from '../src/utils/backupPolicy'
import defaultConfig from '../src/defaultConfig'

test('shared cloud backup policy and WebDAV restore', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-backup-policy-'))
  const source = path.join(temp, 'data')
  fs.mkdirSync(source)
  const write = (relative: string, content = relative) => {
    const local = path.join(source, relative)
    fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, content)
    return local
  }
  const originalGlobal = global.lx
  global.lx = { dataPath: source, configPath: path.join(source, 'config.js'), config: {} } as any
  t.after(() => { global.lx = originalGlobal; fs.rmSync(temp, { recursive: true, force: true }) })
  write('config.js', 'module.exports = {}')
  write('users.json', '[]')
  write('serverInfo.json', '{}')
  write('music/alice/song.mp3', 'audio')
  write('music/alice/song.lrc', 'lyrics')
  write('music/alice/music_index.json', '{}')
  write('users/source/alice/script.js', 'source script')
  write('users/alice/list/snapshot/snapshot_123', 'snapshot without extension')
  write('users/alice/list/snapshot/snapshotInfo.json', '{}')
  write('users/alice/dislike/snapshot/snapshot_456', 'dislike snapshot')
  write('users/alice/settings.json', 'old!')
  write('cache/alice/song.mp3', 'cache')
  write('users/alice/cache/audio.mp3', 'legacy cache')
  write('runtime/queue.json', 'runtime')
  write('backups/config-old.js', 'backup')
  write('openlist-backup.db', 'live DB')
  write('openlist-backup.db-wal', 'live WAL')

  await t.test('five disjoint types include extensionless snapshots and exclude transient/cache files', () => {
    const all = scanBackupFiles({ dataPath: source }, BACKUP_TYPES)
    assert.equal(all.size, 11)
    assert.ok(all.has('users/alice/list/snapshot/snapshot_123'))
    for (const file of ['cache/alice/song.mp3', 'users/alice/cache/audio.mp3', 'runtime/queue.json', 'backups/config-old.js', 'openlist-backup.db-wal']) assert.equal(all.has(file), false)
    const music = scanBackupFiles({ dataPath: source }, ['music'])
    assert.deepEqual([...music.keys()].sort(), ['music/alice/music_index.json', 'music/alice/song.lrc', 'music/alice/song.mp3'])
    assert.equal(backupType('users/alice/list/snapshot/snapshotInfo.json'), 'snapshots')
    assert.deepEqual(normalizeBackupTypes(['system', 'system']), ['system'])
    assert.throws(() => normalizeBackupTypes(['cache']))
    assert.equal(getBackupTypes('webdav', { 'webdav.excludeMusic': true }).includes('music'), false)
  })

  await t.test('external config/snapshots have stable virtual paths and restore into configured destinations', () => {
    const externalConfig = path.join(temp, 'external-config.js'); fs.writeFileSync(externalConfig, 'module.exports = {}')
    const snapshots = path.join(temp, 'snapshot-store')
    fs.mkdirSync(path.join(snapshots, 'alice', 'snapshot'), { recursive: true })
    fs.writeFileSync(path.join(snapshots, 'alice', 'snapshot', 'snapshot_789'), 'external snapshot')
    const context = { dataPath: source, configPath: externalConfig, config: { 'snapshot.backupPath': snapshots } }
    const selected = scanBackupFiles(context, ['system', 'snapshots'])
    assert.equal(selected.get('config.js'), externalConfig)
    assert.equal(selected.get('_snapshots/alice/snapshot/snapshot_789'), path.join(snapshots, 'alice', 'snapshot', 'snapshot_789'))
    assert.equal(backupLocalPath('_snapshots/alice/snapshot/snapshot_789', context), selected.get('_snapshots/alice/snapshot/snapshot_789'))
    assert.throws(() => backupLocalPath('_snapshots/alice/snapshot/snapshot_789', { dataPath: source }), /先配置/)
  })

  await t.test('traversal and directory links cannot escape a restore target or expand the music scope', () => {
    assert.throws(() => backupLocalPath('users/../../outside.json', { dataPath: source }))
    assert.throws(() => backupLocalPath('music/C:/outside.mp3', { dataPath: source }))
    const outside = path.join(temp, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret.mp3'), 'secret')
    fs.symlinkSync(outside, path.join(source, 'music', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.equal(scanBackupFiles({ dataPath: source }, ['music']).has('music/linked/secret.mp3'), false)
    assert.throws(() => backupLocalPath('music/linked/new.mp3', { dataPath: source }), /符号链接/)
  })

  const remote = new Map<string, Buffer>()
  let puts = 0
  let failUploads = false
  const client = {
    exists: async () => true,
    createDirectory: async () => {},
    putFileContents: async (name: string, stream: any) => {
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      puts++
      if (failUploads) throw new Error('simulated upload failure')
      remote.set(name, Buffer.concat(chunks))
    },
    getDirectoryContents: async (prefix: string) => [...remote].filter(([name]) => name.startsWith(prefix)).map(([filename, bytes]) => ({ filename, basename: path.posix.basename(filename), type: 'file', size: bytes.length })),
    getFileContents: async (name: string) => { if (!remote.has(name)) throw Object.assign(new Error('not found'), { status: 404 }); return remote.get(name)! },
    deleteFile: async (name: string) => { remote.delete(name) },
  }
  const create = (types: any[] = [...BACKUP_TYPES]) => {
    const instance = new WebDAVSync({ enable: true, url: 'http://test-only.invalid', username: '', password: '', types }, source)
    ;(instance as any).client = client
    return instance
  }

  await t.test('incremental and ZIP backup contain exactly the same selected paths', async () => {
    const backup = create()
    assert.equal(await backup.syncAllFiles(), true)
    const zipName = await backup.createBackup()
    assert.ok(zipName)
    const zip = await Open.file(path.join(source, zipName!))
    const expected = [...scanBackupFiles({ dataPath: source }, BACKUP_TYPES).keys()].sort()
    assert.deepEqual(zip.files.filter(f => f.type === 'File').map(f => f.path).sort(), expected)
    assert.deepEqual([...remote.keys()].map(name => name.slice('/lx-sync/'.length)).sort(), expected)
    fs.unlinkSync(path.join(source, zipName!))
  })

  await t.test('restore reads same-sized changed content, preserves local-only files and never uploads', async () => {
    const restore = create(['userData'])
    remote.set('/lx-sync/users/alice/settings.json', Buffer.from('new!'))
    write('users/alice/local-only.json', 'keep')
    const before = puts
    assert.equal(await restore.restoreScatteredFiles(), true)
    assert.equal(fs.readFileSync(path.join(source, 'users/alice/settings.json'), 'utf8'), 'new!')
    assert.equal(fs.readFileSync(path.join(source, 'users/alice/local-only.json'), 'utf8'), 'keep')
    assert.equal(puts, before)
    assert.equal(await create([]).restoreScatteredFiles(), false)
  })

  await t.test('legacy ZIP restore honors selected types and never restores caches', async () => {
    const zipFile = path.join(temp, 'legacy.zip')
    const archive = new ZipArchive()
    const ready = pipeline(archive, fs.createWriteStream(zipFile))
    archive.append('cloud music', { name: 'music/alice/song.mp3' })
    archive.append('cloud setting', { name: 'users/alice/settings.json' })
    archive.append('cloud cache', { name: 'cache/alice/song.mp3' })
    await archive.finalize(); await ready
    await create(['userData']).extractZip(zipFile, source)
    assert.equal(fs.readFileSync(path.join(source, 'users/alice/settings.json'), 'utf8'), 'cloud setting')
    assert.equal(fs.readFileSync(path.join(source, 'music/alice/song.mp3'), 'utf8'), 'audio')
    assert.equal(fs.readFileSync(path.join(source, 'cache/alice/song.mp3'), 'utf8'), 'cache')
  })

  await t.test('failed incremental upload is retried; deselection and local deletion retain cloud copies by default', async () => {
    const backup = create(['userData'])
    await backup.syncChangedFiles()
    write('users/alice/retry.json', 'retry me')
    failUploads = true
    await backup.syncChangedFiles()
    failUploads = false
    assert.equal(remote.has('/lx-sync/users/alice/retry.json'), false)
    await backup.syncChangedFiles()
    assert.equal(remote.get('/lx-sync/users/alice/retry.json')?.toString(), 'retry me')
    fs.unlinkSync(path.join(source, 'users/alice/retry.json'))
    await backup.syncChangedFiles()
    assert.ok(remote.has('/lx-sync/users/alice/retry.json'))
    ;(backup as any).config.types = []
    await backup.syncChangedFiles()
    assert.ok(remote.has('/lx-sync/users/alice/settings.json'))
    ;(backup as any).config.types = ['userData']; (backup as any).config.mirrorDeletes = true
    write('users/alice/delete.json'); await backup.syncChangedFiles()
    fs.unlinkSync(path.join(source, 'users/alice/delete.json')); await backup.syncChangedFiles()
    assert.equal(remote.has('/lx-sync/users/alice/delete.json'), false)
  })

  await t.test('configuration API values survive the actual saveConfig writer and reload', () => {
    const server = fs.readFileSync(path.join(__dirname, '../src/server/server.ts'), 'utf8')
    const apiStart = server.indexOf("if (pathname === '/api/config')")
    const start = server.indexOf('const config = {', apiStart)
    const end = server.indexOf('          res.writeHead(200', start)
    const getter = transformSync(`module.exports = () => { ${server.slice(start, end)}; return config; }`, { loader: 'ts', format: 'cjs' }).code
    const runtime: any = {
      module: { exports: null }, global: { lx: { dataPath: source, configPath: path.join(source, 'saved-config.js'), config: {
        ...defaultConfig, 'backup.webdav.types': [], 'backup.openlist.types': ['snapshots', 'system'],
        'backup.webdav.mirrorDeletes': true, 'backup.webdav.restoreOnStartup': true,
        'subsonic.playCacheFirstUseOpenlist': true, 'subsonic.openlistDelivery': 'proxy',
      } } },
      path, fs, process, crypto, BACKUP_TYPE_INFO, getBackupTypes, backupConfig() {}, lastConfigHash: '', console: { error() {} },
    }
    vm.runInNewContext(getter, runtime)
    const readPayload = runtime.module.exports
    const before = JSON.parse(JSON.stringify(readPayload()))
    const index = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8')
    const writerStart = index.indexOf('const saveConfigToFile = () => {')
    const writerEnd = index.indexOf('\nglobal.lx = {', writerStart)
    vm.runInNewContext(transformSync(index.slice(writerStart, writerEnd) + '; module.exports = saveConfigToFile;', { loader: 'ts', format: 'cjs' }).code, runtime)
    const writer = runtime.module.exports
    writer()
    const saved = { exports: {} }
    vm.runInNewContext(fs.readFileSync(runtime.global.lx.configPath, 'utf8'), { module: saved })
    runtime.global.lx.config = saved.exports
    const after = JSON.parse(JSON.stringify(readPayload()))
    for (const key of ['backup.webdav.types', 'backup.openlist.types', 'backup.webdav.mirrorDeletes', 'backup.webdav.restoreOnStartup', 'subsonic.playCacheFirstUseOpenlist', 'subsonic.openlistDelivery']) assert.deepEqual(after[key], before[key])
    runtime.global.lx.configPath = source // A directory cannot be replaced by a config file.
    assert.throws(() => writer())
    assert.equal(fs.readdirSync(temp).some(name => name.endsWith('.tmp')), false)
  })
})
