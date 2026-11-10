const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { once } = require('node:events')
const { build } = require('esbuild')

test('OpenList backup, restore and synchronization against an HTTP storage server', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-openlist-test-'))
  const root = path.resolve(__dirname, '..')
  const remote = new Map()
  let metadataError = false
  let truncateDownload = false
  let metadataReads = 0
  let uploads = 0
  const contentReads = []
  let refuseUpload = false
  let expireUploadOnce = false
  let base
  const storage = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const body = Buffer.concat(parts)
    const answer = (data, code = 200) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code, data })) }
    if (req.url.startsWith('/audio?')) {
      contentReads.push(new URL(req.url, base).searchParams.get('path'));
      const file = remote.get(new URL(req.url, base).searchParams.get('path'))
      if (!file) { res.writeHead(404); res.end(); return }
      res.end(truncateDownload ? file.body.subarray(0, 1) : file.body)
      return
    }
    const args = body.length && req.method !== 'PUT' ? JSON.parse(body) : {}
    if (req.url === '/api/auth/login') return answer({ token: 'test-token' })
    if (req.url === '/api/fs/mkdir') return answer({})
    if (req.url === '/api/fs/put') {
      if (expireUploadOnce) { expireUploadOnce = false; return answer(null, 401) }
      if (refuseUpload) return answer(null, 500)
      const name = decodeURIComponent(req.headers['file-path'])
      remote.set(name, { body, modified: new Date().toISOString() })
      uploads++
      return answer({})
    }
    if (metadataError) return answer(null, 403)
    if (req.url === '/api/fs/get') {
      metadataReads++
      const file = remote.get(args.path)
      if (!file) return answer(null, 404)
      return answer({ hash_info: file.sha256 ? { sha256: file.sha256 } : undefined, size: file.body.length, name: path.posix.basename(args.path), modified: file.modified, raw_url: base + '/audio?path=' + encodeURIComponent(args.path) })
    }
    if (req.url === '/api/fs/list') {
      const files = [...remote].filter(([p]) => p.startsWith(args.path + '/')).map(([p, f]) => ({ path: p, name: path.posix.basename(p), size: f.body.length, modified: f.modified, is_dir: false }))
      return answer({ content: files.slice((args.page - 1) * args.per_page, args.page * args.per_page), total: files.length })
    }
    if (req.url === '/api/fs/remove') {
      for (const name of args.names) remote.delete(args.dir + '/' + name)
      return answer({})
    }
    answer(null, 404)
  })
  storage.listen(0, '127.0.0.1')
  await once(storage, 'listening')
  base = 'http://127.0.0.1:' + storage.address().port
  t.after(async () => {
    api.stopVerifyScheduler()
    api.closeBackupDb()
    storage.closeAllConnections()
    await new Promise(resolve => storage.close(resolve))
    fs.rmSync(temp, { recursive: true, force: true })
    delete global.__openlistTest
  })
  // Isolate the music SDK and user spaces; exercise the real manager, SQLite DB and HTTP client.
  await build({
    stdin: { contents: "export * from './src/server/openlist/openlistBackup'; export * from './src/server/openlist/openlistBackupDb'; export * from './src/server/openlist/openlistClient'", resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'manager.cjs'),
    plugins: [{ name: 'application-boundaries', setup(b) {
      b.onResolve({ filter: /^@\/(server\/music\/fileCache|server\/sources\/userApi|user(\/data)?|constants)$/ }, a => ({ path: a.path, namespace: 'boundary' }))
      b.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({ loader: 'js', contents: `
        export function getCacheDir(user, music) { return global.__openlistTest.dirs[music ? 'music' : 'cache'] }
        export function getIndexItemByFilename(name) { return global.__openlistTest.items.get(name) }
        export function registerOpenListCacheFile(user, item) { global.__openlistTest.registered.push(item) }
        export function unregisterOpenListCacheFile(user, id) { global.__openlistTest.removed.push(id) }
        export function callUserApiGetMusicUrl() { return null }
        export function getUserDirname(user) { return global.__openlistTest.aliases?.[user] || user }
        export function getUserSpace() { return { listManage: { snapshotDataManage: { updateSnapshotDir() {} } } } }
        export const File = { listDir: 'list', listSnapshotDir: 'snapshot', dislikeDir: 'dislike', dislikeSnapshotDir: 'snapshot' }
      ` }))
    } }],
  })
  const api = require(path.join(temp, 'manager.cjs'))
  const state = global.__openlistTest = { dirs: { cache: path.join(temp, 'cache'), music: path.join(temp, 'music') }, items: new Map(), registered: [], removed: [] }
  const config = {
    'openlist.enable': true, 'openlist.endpoint': base, 'openlist.token': 'test-token', 'openlist.root': '/root',
    'openlist.userBackups': [{ user: 'alice', enabled: true, backupCache: true, backupDownload: true, backupSnapshot: false, mode: 'sync' }],
    'subsonic.playCacheFirst': true, 'subsonic.playCacheFirstUseOpenlist': true,
  }
  global.lx = { dataPath: temp, userPath: temp, config }
  const rule = config['openlist.userBackups'][0]
  const reset = () => {
    api.stopVerifyScheduler()
    for (const table of ['openlist_attachment_links', 'openlist_backup_attachments', 'openlist_backup_files', 'openlist_local_files']) api.getBackupDb().exec('DELETE FROM ' + table)
    for (const dir of Object.values(state.dirs)) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir) }
    Object.assign(rule, { enabled: true, backupCache: true, backupDownload: true, mode: 'sync' })
    config['openlist.includeNonAudio'] = false
    config['subsonic.playCacheFirst'] = true
    config['subsonic.playCacheFirstUseOpenlist'] = true
    remote.clear(); state.items.clear(); state.registered.length = 0; state.removed.length = 0
    metadataError = false; truncateDownload = false; uploads = 0
    refuseUpload = false
    contentReads.length = 0
    expireUploadOnce = false
    delete config['openlist.playback.enable']
    delete config['backup.openlist.types']
    config['openlist.root'] = '/root'
  }
  const putLocal = (folder = 'cache', name = 'song.mp3', text = 'original') => {
    const target = path.join(state.dirs[folder], name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
    state.items.set(path.basename(name), { id: 'tx_song123', songmid: 'tx_song123', source: 'tx', quality: '320k', name: 'Song', singer: 'Singer' })
    return target
  }
  const rp = (folder = 'cache', name = 'song.mp3') => '/root/alice/' + folder + '/' + name
  const sync = folder => api.runSyncNow({ user: 'alice', folder })

  await t.test('data backup ownership maps music, source and snapshot namespaces without changing stored identities', () => {
    reset()
    const previousUsers = config.users
    config.users = [{ name: 'admin' }, { name: 'test' }]
    state.aliases = { admin: 'admin_21232f' }
    try {
      const cases = [
        ['music/admin/song.mp3', 'admin'],
        ['music/_open/public.mp3', '_open'],
        ['users/source/admin/source.js', 'admin'],
        ['users/source/_open/source.js', '_open'],
        ['users/admin_21232f/list/snapshot/snapshot_1', 'admin'],
        ['_snapshots/admin/snapshot/snapshot_2', 'admin'],
        ['config.js', '_system'],
        ['music/unknown/song.mp3', '_system'],
      ]
      for (const [relative] of cases) api.upsertBackupFile({ user: '_system', folderType: 'data', name: relative,
        localPath: path.join(temp, relative), remotePath: '/root/_data/' + relative, size: 5, direction: 'upload', mode: 'upload', status: 'completed' })
      const listed = api.listBackups()
      for (const [relative, expected] of cases) assert.equal(listed.find(row => row.name === relative).user, expected, relative)
      assert.ok(api.listAllBackups().every(row => row.user === '_system'))
      assert.equal(api.prepareOpenlistIntegrity({ user: 'admin', scope: 'all' }).total, 4)
      assert.equal(api.prepareOpenlistIntegrity({ user: '_open', scope: 'all' }).total, 2)
      config.users = [{ name: 'test' }]
      assert.equal(api.listBackups().find(row => row.name === 'music/admin/song.mp3').user, '_system')
      assert.equal(api.listBackups().find(row => row.name === 'users/admin_21232f/list/snapshot/snapshot_1').user, '_system')
    } finally { config.users = previousUsers; delete state.aliases; reset() }
  })

  await t.test('local existence follows disk deletion and recreation without changing cloud status', async () => {
    reset(); rule.mode = 'upload'
    const local = putLocal()
    await sync('cache')
    const record = api.listBackups().find(row => row.local_path === local)
    assert.equal(record.local_exists, true)
    assert.ok(['same', 'untracked'].includes(record.local_state))
    fs.unlinkSync(local)
    assert.equal(api.listBackups().find(row => row.id === record.id).local_exists, false)
    fs.mkdirSync(local)
    assert.equal(api.listBackups().find(row => row.id === record.id).local_exists, false)
    fs.rmdirSync(local)
    fs.writeFileSync(local, 'recreated')
    const recreated = api.listBackups().find(row => row.id === record.id)
    assert.equal(recreated.local_exists, true)
    assert.equal(recreated.status, record.status)
    assert.equal(recreated.local_state, 'changed')
    assert.equal(recreated.task_state, 'pending')
    const enabled = rule.enabled; rule.enabled = false
    assert.equal(api.listBackups().find(row => row.id === record.id).task_state, 'paused')
    rule.enabled = enabled
  })

  await t.test('upload-delete verifies bytes, restores soft-deleted registration and original metadata', async () => {
    reset(); rule.mode = 'upload-delete'
    const local = putLocal()
    await sync('cache'); await api.verifyPending()
    assert.equal(fs.existsSync(local), false)
    assert.equal(api.listAllBackups()[0].status, 'verified')
    assert.equal(await api.tryRestoreFromOpenlist('alice', 'cache', state.dirs.cache, 'song', '320k').then(Boolean), true)
    assert.equal(fs.readFileSync(local, 'utf8'), 'original')
    assert.equal(api.localFileExists('alice', local), true)
    assert.equal(state.registered.at(-1).id, 'tx_song123')
    assert.equal(state.registered.at(-1).singer, 'Singer')
  })

  await t.test('manual retry replaces a mismatched remote file and reports real transfer failures', async t => {
    reset(); rule.mode = 'upload-delete'
    const local = putLocal('cache', 'song.mp3', 'valuable-new-audio')
    const row = api.upsertBackupFile({ user: 'alice', folderType: 'cache', localPath: local, remotePath: rp(), mode: rule.mode, status: 'failed' })
    remote.set(rp(), { body: Buffer.from('bad'), modified: new Date().toISOString() })
    assert.equal((await api.retryBackup(row.id)).ok, true)
    assert.equal(fs.existsSync(local), true)
    assert.equal(remote.get(rp()).body.toString(), 'valuable-new-audio')
    await api.verifyPending()
    assert.equal(fs.existsSync(local), false)
    const missing = api.upsertBackupFile({ user: 'alice', folderType: 'cache', localPath: local + '.missing', remotePath: rp() + '.missing', status: 'failed' })
    assert.equal((await api.retryBackup(missing.id)).ok, false)
  })

  await t.test('upload paths preserve literal URL escapes, percent signs and Chinese characters', async () => {
    reset(); rule.mode = 'upload'
    const name = '%E6%BA%90 100% 中文.mp3'
    putLocal('cache', name)
    assert.deepEqual((await sync('cache')).errors, [])
    assert.equal(remote.get(rp('cache', name)).body.toString(), 'original')
    assert.equal(remote.has(rp('cache', decodeURIComponent('%E6%BA%90') + ' 100% 中文.mp3')), false)
  })

  await t.test('same-sized corrupted cloud bytes never authorize deleting the local original', async () => {
    reset(); rule.mode = 'upload-delete'
    const local = putLocal()
    await sync('cache')
    remote.get(rp()).body = Buffer.from('tampered')
    await api.verifyPending()
    assert.equal(fs.readFileSync(local, 'utf8'), 'original')
    // Allow the automatic retry queued by verification to finish before reset.
    await sync('cache')
  })

  await t.test('local edits upload again, including same-sized edits with preserved mtime', async () => {
    reset(); const local = putLocal()
    await sync('cache'); await api.verifyPending()
    const st = fs.statSync(local)
    fs.writeFileSync(local, 'modified'); fs.utimesSync(local, st.atime, st.mtime)
    await sync('cache')
    assert.equal(remote.get(rp()).body.toString(), 'modified')
    assert.equal(uploads, 2)
  })

  await t.test('music deletion propagates before downloading, while cache eviction preserves cloud backup', async () => {
    reset(); let local = putLocal('music')
    await sync('music'); await api.verifyPending(); fs.unlinkSync(local)
    await sync('music')
    assert.equal(remote.has(rp('music')), false)
    assert.equal(fs.existsSync(local), false)
    reset(); local = putLocal()
    await sync('cache'); await api.verifyPending(); fs.unlinkSync(local); api.softDeleteLocalFileByPath(local)
    await sync('cache')
    assert.equal(remote.has(rp()), true)
  })

  await t.test('remote deletion removes unchanged local files; permission errors never delete data', async () => {
    reset(); const local = putLocal('music')
    await sync('music'); await api.verifyPending()
    metadataError = true
    assert.ok((await sync('music')).errors.length)
    assert.equal(fs.existsSync(local), true)
    metadataError = false; remote.delete(rp('music'))
    await sync('music')
    assert.equal(fs.existsSync(local), false)
    assert.equal(remote.has(rp('music')), false)
  })

  await t.test('download mode updates existing files and preserves nested directory identity', async () => {
    reset(); rule.mode = 'download'
    remote.set(rp('cache', 'a/song.mp3'), { body: Buffer.from('first'), modified: '2025-01-01T00:00:00Z' })
    remote.set(rp('cache', 'b/song.mp3'), { body: Buffer.from('second'), modified: '2025-01-01T00:00:00Z' })
    await sync('cache')
    remote.set(rp('cache', 'a/song.mp3'), { body: Buffer.from('updated'), modified: '2025-02-01T00:00:00Z' })
    await sync('cache')
    assert.equal(fs.readFileSync(path.join(state.dirs.cache, 'a/song.mp3'), 'utf8'), 'updated')
    assert.equal(fs.readFileSync(path.join(state.dirs.cache, 'b/song.mp3'), 'utf8'), 'second')
  })

  await t.test('priority and per-folder rules gate both restore and direct playback', async () => {
    reset(); const local = putLocal()
    await sync('cache'); await api.verifyPending(); fs.unlinkSync(local)
    config['subsonic.playCacheFirst'] = false
    assert.equal(await api.tryRestoreFromOpenlist('alice', 'cache', state.dirs.cache, 'song', '320k'), null)
    config['subsonic.playCacheFirst'] = true; rule.backupCache = false
    assert.equal(await api.resolveOpenlistCacheDirectUrl('alice', 'cache', 'song'), null)
    assert.equal(await api.tryRestoreFromOpenlist('alice', 'cache', state.dirs.cache, 'song', '320k'), null)
    rule.backupCache = true
    assert.ok(await api.resolveOpenlistCacheEntry('alice', 'cache', 'different-name', { id: 'tx_song123', source: 'tx', quality: '320k' }))
  })

  await t.test('OpenList playback master is independent of Subsonic settings and reuses metadata requests', async () => {
    reset(); putLocal('cache', 'playback-route.mp3')
    await sync('cache'); await api.verifyPending()
    config['openlist.playback.enable'] = false
    assert.equal(await api.resolveOpenlistCacheEntry('alice', 'cache', 'playback-route'), null)
    config['openlist.playback.enable'] = true; config['subsonic.playCacheFirst'] = false; config['subsonic.playCacheFirstUseOpenlist'] = false
    const before = metadataReads
    const hits = await Promise.all([api.resolveOpenlistCacheEntry('alice', 'cache', 'playback-route'), api.resolveOpenlistCacheEntry('alice', 'cache', 'playback-route')])
    assert.ok(hits.every(Boolean)); assert.equal(metadataReads - before, 1)
    await api.resolveOpenlistCacheEntry('alice', 'cache', 'playback-route')
    assert.equal(metadataReads - before, 1)
    assert.equal(await api.resolveOpenlistCacheEntry('bob', 'cache', 'playback-route'), null)
  })

  await t.test('attachments belong to matching songs; shared covers survive deletion of one song', async () => {
    reset(); config['openlist.includeNonAudio'] = true
    putLocal('music', 'one.mp3'); putLocal('music', 'two.mp3')
    fs.writeFileSync(path.join(state.dirs.music, 'one.lrc'), 'one lyrics')
    fs.writeFileSync(path.join(state.dirs.music, 'two.lrc'), 'two lyrics')
    fs.writeFileSync(path.join(state.dirs.music, 'cover.jpg'), 'shared cover')
    await sync('music'); await api.verifyPending()
    const rows = api.listAllBackups()
    const one = rows.find(r => r.name === 'one.mp3'), two = rows.find(r => r.name === 'two.mp3')
    assert.deepEqual(api.listAttachments(one.id).map(a => path.basename(a.local_path)).sort(), ['cover.jpg', 'one.lrc'])
    assert.deepEqual(api.listAttachments(two.id).map(a => path.basename(a.local_path)).sort(), ['cover.jpg', 'two.lrc'])
    await api.deleteOpenlistBackups([one.id])
    assert.equal(remote.has(rp('music', 'cover.jpg')), true)
    assert.equal(fs.existsSync(path.join(state.dirs.music, 'cover.jpg')), true)
    assert.equal(remote.has(rp('music', 'one.lrc')), false)
  })

  await t.test('exhausted retries release cache protection', () => {
    reset(); const local = putLocal()
    const row = api.upsertBackupFile({ user: 'alice', folderType: 'cache', localPath: local, remotePath: rp(), status: 'failed' })
    assert.ok(api.getActiveBackupLocalPaths().has(local))
    api.setBackupStatus(row.id, 'failed', { retryCount: 5 })
    assert.equal(api.getActiveBackupLocalPaths().has(local), false)
  })

  await t.test('truncated downloads preserve existing local bytes', async () => {
    reset(); const local = putLocal()
    remote.set(rp(), { body: Buffer.from('new cloud version'), modified: new Date().toISOString() })
    truncateDownload = true
    const client = new api.OpenListClient({ endpoint: base, token: 'test-token' })
    await assert.rejects(client.download(rp(), local), /大小/)
    assert.equal(fs.readFileSync(local, 'utf8'), 'original')
    assert.equal(fs.readdirSync(state.dirs.cache).filter(p => p.endsWith('.oltmp')).length, 0)
  })

  await t.test('enabling data backup never runs an old music upload-delete rule', async () => {
    reset(); rule.mode = 'upload-delete'
    const local = putLocal('music')
    await sync('music')
    config['backup.openlist.types'] = ['music']
    await api.verifyPending()
    assert.equal(fs.readFileSync(local, 'utf8'), 'original')
  })

  await t.test('selected data types round-trip into a fresh installation without a backup database', async () => {
    reset(); rule.backupCache = false
    config['backup.openlist.types'] = ['music', 'userFiles', 'snapshots', 'userData', 'system']
    const data = {
      'config.js': 'module.exports = {}',
      'users.json': '[]',
      'music/alice/song.mp3': 'permanent music',
      'music/alice/song.lrc': 'permanent lyrics',
      'music/alice/music_index.json': '{"items":[]}',
      'users/source/alice/source.js': 'source script',
      'users/alice/settings.json': '{"volume":80}',
      'users/alice/list/snapshot/snapshot_123': 'extensionless snapshot',
      'users/alice/dislike/snapshot/snapshot_456': 'dislike snapshot',
    }
    for (const [relative, value] of Object.entries(data)) {
      const local = path.join(temp, relative); fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, value)
    }
    fs.writeFileSync(path.join(state.dirs.cache, 'not-a-backup.mp3'), 'cache')
    const result = await api.runSyncNow()
    assert.deepEqual(result.errors, [])
    assert.equal(result.uploaded, Object.keys(data).length + 1) // 配置历史副本独立于恢复镜像
    await api.verifyPending()
    assert.deepEqual([...remote.keys()].filter(p => p.startsWith('/root/_data/')).sort(), Object.keys(data).map(p => '/root/_data/' + p).sort())
    assert.equal([...remote.keys()].filter(p => p.startsWith('/root/_system/config-history/')).length, 1)
    assert.equal(api.listBackups().find(r => r.name === 'config.js').backup_type, 'system')
    // A missing cloud copy must be recreated even if the local bytes are unchanged.
    remote.delete('/root/_data/music/alice/song.lrc')
    assert.equal((await api.runSyncNow()).errors.length, 0)
    assert.equal(remote.get('/root/_data/music/alice/song.lrc').body.toString(), 'permanent lyrics')
    const fresh = path.join(temp, 'fresh-install'); fs.mkdirSync(fresh)
    api.closeBackupDb()
    global.lx.dataPath = fresh
    global.lx.configPath = path.join(fresh, 'config.js')
    const putsBefore = uploads
    const restored = await api.restoreOpenlistData()
    assert.equal(restored.restored, Object.keys(data).length)
    assert.deepEqual(restored.errors, [])
    for (const [relative, value] of Object.entries(data)) assert.equal(fs.readFileSync(path.join(fresh, relative), 'utf8'), value)
    assert.equal(fs.existsSync(path.join(fresh, 'cache/not-a-backup.mp3')), false)
    assert.equal(uploads, putsBefore)
    config['backup.openlist.types'] = ['system']
    fs.writeFileSync(path.join(fresh, 'users/alice/settings.json'), 'keep local')
    assert.equal((await api.restoreOpenlistData()).restored, 2)
    assert.equal(fs.readFileSync(path.join(fresh, 'users/alice/settings.json'), 'utf8'), 'keep local')
  })

  await t.test('changing root retargets exhausted uploads and completed data; history follows the new root', async () => {
    reset(); rule.backupCache = false
    config['backup.openlist.types'] = ['system']
    fs.writeFileSync(global.lx.configPath, 'module.exports = { changed: true }')
    await api.runSyncNow()
    const row = api.listAllBackups().find(r => r.name === 'config.js')
    api.setBackupStatus(row.id, 'failed', { retryCount: 5, error: 'storage not found' })
    config['openlist.root'] = '/new-mount'
    assert.equal((await api.retryBackup(row.id)).ok, true)
    assert.equal(api.getBackupById(row.id).remote_path, '/new-mount/_data/config.js')
    await api.runSyncNow()
    assert.ok(remote.has('/new-mount/_data/config.js'))
    assert.equal([...remote.keys()].filter(p => p.startsWith('/new-mount/_system/config-history/')).length, 1)
    assert.equal((await api.runSyncNow()).uploaded, 0)
    const history = [...remote.keys()].find(p => p.startsWith('/new-mount/_system/config-history/'))
    remote.get(history).modified = '2020-01-01T00:00:00Z'
    await api.runSyncNow()
    assert.equal([...remote.keys()].filter(p => p.startsWith('/new-mount/_system/config-history/')).length, 1)
    // 同步会删掉过期副本并按「当前秒」重建；跨秒时文件名里的秒级时间戳会变，
    // 不能复用同步前的 key（该条目已从远端移除），否则读取 undefined.modified 抛错。
    const refreshed = [...remote.keys()].find(p => p.startsWith('/new-mount/_system/config-history/'))
    assert.ok(refreshed, '同步后应保留一份配置历史副本')
    assert.ok(Date.parse(remote.get(refreshed).modified) > Date.parse('2020-01-01'), '过期副本应被重新上传并刷新 mtime')
    config['openlist.root'] = '/third-mount'
    await api.runSyncNow()
    assert.ok(remote.has('/third-mount/_data/config.js'))
  })

  await t.test('orphan uploading records recover without a ten-minute polling loop', async () => {
    reset(); rule.mode = 'upload'
    const local = putLocal()
    const row = api.upsertBackupFile({ user: 'alice', folderType: 'cache', localPath: local, remotePath: rp(), status: 'uploading' })
    await api.verifyPending()
    await sync('cache') // drains the real upload queue
    await api.verifyPending()
    assert.equal(api.getBackupById(row.id).status, 'verified')
    assert.equal(remote.get(rp()).body.toString(), 'original')
  })

  await t.test('switching to upload-delete never trusts stale completed bytes', async () => {
    reset(); rule.mode = 'upload'
    const local = putLocal()
    await sync('cache'); await api.verifyPending()
    remote.get(rp()).body = Buffer.from('tampered')
    rule.mode = 'upload-delete'
    await api.triggerBackfillUploadDelete('alice')
    assert.equal(fs.existsSync(local), true)
    await sync('cache'); await api.verifyPending()
    assert.equal(remote.get(rp()).body.toString(), 'original')
    assert.equal(fs.existsSync(local), false)
  })

  await t.test('playlist and dislike snapshot backups do not require media-cache user rules', async () => {
    reset(); rule.enabled = false
    config.users = [{ name: 'alice' }]
    config['backup.openlist.types'] = ['snapshots']
    const beforeUserPath = global.lx.userPath
    global.lx.userPath = path.join(global.lx.dataPath, 'users')
    try {
      await api.runSyncNow({ user: 'alice', folder: 'list' })
      await api.verifyPending()
      const rows = api.listAllBackups().filter(r => r.folder_type === 'list')
      assert.ok(rows.length >= 2)
      assert.ok(rows.some(r => r.local_path.includes(path.join('dislike', 'snapshot'))))
      assert.ok(rows.every(r => r.status === 'verified' && r.mode === 'upload' && fs.existsSync(r.local_path)))
    } finally { global.lx.userPath = beforeUserPath; delete config.users }
  })

  await t.test('restore preview is read-only; missing-only and overwrite use independent type choices', async () => {
    reset()
    config['backup.openlist.types'] = ['system']
    const existing = path.join(global.lx.dataPath, 'users/alice/restore.json')
    const missing = path.join(global.lx.dataPath, 'users/alice/new.json')
    fs.mkdirSync(path.dirname(existing), { recursive: true }); fs.writeFileSync(existing, 'local version')
    fs.rmSync(missing, { force: true })
    const put = (name, value) => remote.set('/root/_data/users/alice/' + name, { body: Buffer.from(value), modified: new Date().toISOString() })
    put('restore.json', 'cloud version'); put('new.json', 'new cloud data')
    const options = { types: ['userData'], mode: 'missing', backupBeforeRestore: true }
    const preview = await api.restoreOpenlistData({ ...options, preview: true })
    assert.equal(preview.added, 1); assert.equal(preview.skipped, 1); assert.equal(preview.restored, 0)
    assert.equal(api.listAllBackups().length, 0); assert.equal(fs.existsSync(missing), false)
    assert.equal(preview.backupDir, '')
    const added = await api.restoreOpenlistData({ ...options, planToken: preview.planToken })
    assert.equal(added.restored, 1); assert.equal(added.skipped, 1)
    assert.equal(fs.readFileSync(existing, 'utf8'), 'local version')
    assert.equal(fs.readFileSync(missing, 'utf8'), 'new cloud data')
    assert.deepEqual(config['backup.openlist.types'], ['system'])
    const overwriteOptions = { ...options, mode: 'overwrite' }
    const next = await api.restoreOpenlistData({ ...overwriteOptions, preview: true })
    const restored = await api.restoreOpenlistData({ ...overwriteOptions, planToken: next.planToken })
    assert.equal(restored.restored, 2)
    assert.equal(fs.readFileSync(existing, 'utf8'), 'cloud version')
    assert.equal(fs.readFileSync(path.join(restored.backupDir, 'files/users/alice/restore.json'), 'utf8'), 'local version')
    const manifest = JSON.parse(fs.readFileSync(path.join(restored.backupDir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.files.length, 2)
    assert.equal(uploads, 0)
    assert.equal((await api.restoreOpenlistData({ ...options, preview: true })).skipped, 2)
  })

  await t.test('changed preview, invalid options and a failed safety copy never replace local data', async () => {
    reset()
    const local = path.join(global.lx.dataPath, 'users/alice/restore.json')
    fs.writeFileSync(local, 'valuable local')
    const rp = '/root/_data/users/alice/restore.json'
    remote.set(rp, { body: Buffer.from('cloud replacement'), modified: new Date().toISOString() })
    const options = { types: ['userData'], mode: 'overwrite' }
    const preview = await api.restoreOpenlistData({ ...options, preview: true })
    fs.writeFileSync(local, 'new local change')
    await assert.rejects(api.restoreOpenlistData({ ...options, planToken: preview.planToken }), /重新预览/)
    assert.equal(fs.readFileSync(local, 'utf8'), 'new local change')
    const again = await api.restoreOpenlistData({ ...options, preview: true })
    remote.get(rp).body = Buffer.from('changed cloud payload')
    await assert.rejects(api.restoreOpenlistData({ ...options, planToken: again.planToken }), /重新预览/)
    for (const invalid of [{ mode: 'merge' }, { types: [] }, { types: ['cache'] }, { preview: 'true' }, { backupBeforeRestore: 'false' }]) {
      await assert.rejects(api.restoreOpenlistData(invalid))
    }
    const block = path.join(global.lx.dataPath, 'blocked-backup-root'); fs.writeFileSync(block, 'not a directory')
    global.lx.getConfigBackupDir = () => block
    try { await assert.rejects(api.restoreOpenlistData(options)) }
    finally { delete global.lx.getConfigBackupDir }
    assert.equal(fs.readFileSync(local, 'utf8'), 'new local change')
    const restored = await api.restoreOpenlistData({ ...options, backupBeforeRestore: false })
    assert.equal(restored.restored, 1); assert.equal(restored.backupDir, '')
  })

  await t.test('download guard preserves concurrent local edits and removes temporary files', async () => {
    reset()
    const local = putLocal()
    remote.set(rp(), { body: Buffer.from('cloud version'), modified: new Date().toISOString() })
    const client = new api.OpenListClient({ endpoint: base, token: 'test-token' })
    await assert.rejects(client.download(rp(), local, undefined, () => { throw new Error('local changed') }), /local changed/)
    assert.equal(fs.readFileSync(local, 'utf8'), 'original')
    assert.equal(fs.readdirSync(state.dirs.cache).some(p => p.endsWith('.oltmp')), false)
  })

  await t.test('same-sized old cloud bytes cannot turn an HTTP 500 upload into success', async () => {
    reset(); const local = putLocal()
    remote.set(rp(), { body: Buffer.from('tampered'), modified: new Date().toISOString() })
    refuseUpload = true
    const client = new api.OpenListClient({ endpoint: base, token: 'test-token' })
    await assert.rejects(client.upload(local, rp()), /上传被拒绝/)
    assert.equal(fs.readFileSync(local, 'utf8'), 'original')
  })

  await t.test('streamed upload reopens its file after refreshing an expired login', async () => {
    reset(); const local = putLocal('cache', 'stream.mp3', 'streamed content')
    expireUploadOnce = true
    const client = new api.OpenListClient({ endpoint: base, username: 'test', password: 'fixture' })
    const original = fs.promises.readFile
    fs.promises.readFile = async () => { throw new Error('upload must not buffer the complete file') }
    try { await client.upload(local, rp('cache', 'stream.mp3')) }
    finally { fs.promises.readFile = original }
    assert.equal(remote.get(rp('cache', 'stream.mp3')).body.toString(), 'streamed content')
  })

  const waitIntegrity = async () => {
    for (let i = 0; i < 200; i++) {
      const status = api.integrityStatus()
      if (status.job && status.job.state !== 'running') return status
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('integrity job timeout')
  }
  await t.test('ordinary uploads, periodic checks and unchanged scans never download cloud audio', async () => {
    reset(); rule.mode = 'upload'; putLocal()
    await sync('cache'); await api.verifyPending(); await sync('cache')
    assert.deepEqual(contentReads, [])
    const before = uploads
    remote.get(rp()).body = Buffer.from('tampered')
    await api.verifyPending(); await sync('cache')
    assert.equal(uploads, before)
    assert.deepEqual(contentReads, [])
    const preview = api.prepareOpenlistIntegrity({ scope: 'all', type: 'cache' })
    assert.equal(preview.total, 1); assert.equal(preview.bytes, 8)
    api.startOpenlistIntegrity(preview.token)
    const status = await waitIntegrity()
    assert.equal(status.job.state, 'completed')
    assert.equal(status.results[0].result, 'mismatch')
    assert.equal(contentReads.filter(p => p === rp()).length, 1)
    assert.equal(remote.get(rp()).body.toString(), 'tampered', 'manual verification never repairs automatically')
    const row = api.listAllBackups()[0]
    assert.equal((await api.retryBackup(row.id)).ok, true)
    assert.equal(remote.get(rp()).body.toString(), 'original')
  })

  await t.test('manual SHA results skip unchanged backups; driver SHA avoids body reads', async () => {
    reset(); rule.mode = 'upload'; putLocal('cache', 'manual-sha.mp3', 'sha body')
    await sync('cache'); await api.verifyPending()
    assert.equal(api.listBackups().find(row => row.name === 'manual-sha.mp3').content_verification, null)
    const remotePath = rp('cache', 'manual-sha.mp3')
    remote.get(remotePath).sha256 = require('node:crypto').createHash('sha256').update('sha body').digest('hex')
    const preview = api.prepareOpenlistIntegrity({ scope: 'all', type: 'cache' })
    api.startOpenlistIntegrity(preview.token)
    const status = await waitIntegrity()
    assert.equal(status.results[0].result, 'matched'); assert.equal(status.job.bytes, 0)
    const checked = api.listBackups().find(row => row.name === 'manual-sha.mp3')
    assert.equal(checked.content_verification, 'matched')
    assert.ok(checked.content_verified_at > 0)
    assert.deepEqual(contentReads, [])
    assert.equal(api.prepareOpenlistIntegrity({ scope: 'changed', type: 'cache' }).total, 0)
    const stale = api.prepareOpenlistIntegrity({ scope: 'all' })
    putLocal('cache', 'manual-sha.mp3', 'new version'); await sync('cache')
    const changed = api.listBackups().find(row => row.name === 'manual-sha.mp3')
    assert.equal(changed.content_verification, null)
    assert.equal(changed.content_verified_at, null)
    assert.throws(() => api.startOpenlistIntegrity(stale.token), /已变化/)
    assert.equal(api.prepareOpenlistIntegrity({ scope: 'changed', type: 'cache' }).total, 1)
  })

  await t.test('history generation uses metadata and local hashes instead of reading backup bodies', async () => {
    reset(); rule.backupCache = false; config['backup.openlist.types'] = ['userData']
    fs.writeFileSync(path.join(temp, 'users/alice/no-read.json'), 'history without download')
    assert.deepEqual((await api.runSyncNow()).errors, [])
    await api.verifyPending(); await api.runSyncNow()
    assert.equal(contentReads.some(p => p.includes('/_data/') || p.includes('/recovery/objects/')), false)
  })

  await t.test('immutable history restores older bytes and refuses same-sized object corruption', async () => {
    reset(); rule.backupCache = false; config['backup.openlist.types'] = ['userData']
    const file = path.join(global.lx.dataPath, 'users/alice/settings.json')
    fs.writeFileSync(file, 'v1')
    assert.deepEqual((await api.runSyncNow()).errors, [])
    const history = await api.getOpenlistRecoveryHistory()
    const first = history.versions[0].id
    fs.writeFileSync(file, 'v2')
    assert.deepEqual((await api.runSyncNow()).errors, [])
    const puts = uploads
    fs.writeFileSync(file, 'local')
    const options = { types: ['userData'], mode: 'overwrite', snapshotId: first }
    const preview = await api.restoreOpenlistData({ ...options, preview: true })
    const restored = await api.restoreOpenlistData({ ...options, planToken: preview.planToken })
    assert.deepEqual(restored.errors, []); assert.equal(fs.readFileSync(file, 'utf8'), 'v1')
    assert.equal(remote.get('/root/_data/users/alice/settings.json').body.toString(), 'v2')
    assert.equal(uploads, puts)
    const manifest = JSON.parse(remote.get('/root/_system/recovery/history/' + first).body.toString())
    const item = manifest.files.find(f => f.relative === 'users/alice/settings.json')
    remote.get('/root/' + item.object).body = Buffer.from('xx')
    fs.writeFileSync(file, 'protected')
    const bad = await api.restoreOpenlistData(options)
    assert.ok(bad.errors.length)
    assert.equal(bad.restored, 0)
    assert.equal(fs.readFileSync(file, 'utf8'), 'protected')
  })

  await t.test('cloud cache metadata restores platform, quality and lyrics after losing SQLite', async () => {
    reset(); config['backup.openlist.types'] = []; config['openlist.includeNonAudio'] = true; rule.mode = 'upload'
    const file = putLocal(), lyric = path.join(state.dirs.cache, 'song.lrc')
    fs.writeFileSync(lyric, 'lyrics')
    assert.deepEqual((await api.runSyncNow()).errors, [])
    const manifest = JSON.parse(remote.get('/root/_system/recovery/latest.json').body.toString())
    assert.equal(manifest.cache[0].songmid, 'tx_song123')
    assert.equal(manifest.cache[0].attachments.length, 1)
    for (const table of ['openlist_attachment_links', 'openlist_backup_attachments', 'openlist_backup_files', 'openlist_local_files']) api.getBackupDb().exec('DELETE FROM ' + table)
    fs.unlinkSync(file); fs.unlinkSync(lyric); state.registered.length = 0; rule.mode = 'download'
    assert.deepEqual((await api.runSyncNow()).errors, [])
    assert.equal(fs.readFileSync(file, 'utf8'), 'original')
    assert.equal(fs.readFileSync(lyric, 'utf8'), 'lyrics')
    assert.equal(state.registered[0].id, 'tx_song123')
    assert.equal(state.registered[0].source, 'tx'); assert.equal(state.registered[0].quality, '320k')
  })

  await t.test('background restoration persists status and offers a guarded rollback', async () => {
    reset()
    const file = path.join(global.lx.dataPath, 'users/alice/job.json')
    fs.writeFileSync(file, 'local job data')
    remote.set('/root/_data/users/alice/job.json', { body: Buffer.from('cloud job data'), modified: new Date().toISOString() })
    const options = { types: ['userData'], mode: 'overwrite' }
    const preview = await api.restoreOpenlistData({ ...options, preview: true })
    const id = api.startOpenlistRestore({ ...options, planToken: preview.planToken })
    let task
    for (let i = 0; i < 100; i++) {
      task = api.listRestoreTasks().find(t => t.id === id)
      if (task && ['completed', 'failed'].includes(task.state)) break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(task.state, 'completed'); assert.equal(task.applied, 1)
    assert.equal(fs.readFileSync(file, 'utf8'), 'cloud job data')
    api.rollbackRestoreTask(id)
    assert.equal(fs.readFileSync(file, 'utf8'), 'local job data')
    api.deleteRestoreTask(id)
    assert.equal(api.listRestoreTasks().some(t => t.id === id), false)
  })

  await t.test('retention collects only unreferenced history; local removal retains the current cloud copy', async () => {
    reset(); rule.backupCache = false; config['backup.openlist.types'] = ['userData']; config['openlist.historyRetentionDays'] = 7
    const file = path.join(global.lx.dataPath, 'users/alice/retention.json'); fs.writeFileSync(file, 'version-one')
    await api.runSyncNow()
    const previous = JSON.parse(remote.get('/root/_system/recovery/latest.json').body.toString())
    const object = previous.files.find(f => f.relative.endsWith('/retention.json')).object
    const version = (await api.getOpenlistRecoveryHistory()).versions[0].id
    remote.get('/root/_system/recovery/history/' + version).modified = '2000-01-01T00:00:00Z'
    remote.get('/root/' + object).modified = '2000-01-01T00:00:00Z'
    fs.writeFileSync(file, 'version-two')
    assert.deepEqual((await api.runSyncNow()).errors, [])
    assert.equal(remote.has('/root/_system/recovery/history/' + version), false)
    assert.equal(remote.has('/root/' + object), false)
    fs.unlinkSync(file)
    assert.deepEqual((await api.runSyncNow()).errors, [])
    const current = JSON.parse(remote.get('/root/_system/recovery/latest.json').body.toString())
    assert.ok(current.files.some(f => f.relative.endsWith('/retention.json')))
    assert.deepEqual((await api.restoreOpenlistData({ types: ['userData'], mode: 'missing' })).errors, [])
    assert.equal(fs.readFileSync(file, 'utf8'), 'version-two')
  })
})

test('Subsonic OpenList delivery uses the production stream handler', async t => {
  const vm = require('node:vm')
  const { transformSync } = require('esbuild')
  const sourceText = fs.readFileSync(path.join(__dirname, '../src/server/integrations/subsonic.ts'), 'utf8')
  const names = ['handleStream', 'getCacheProbeOrder', 'getRequestedAudioFormat', 'shouldTranscodeFormat', 'getSourceContainer', 'isQualityOverCap']
  // Run the original private methods without booting unrelated music providers or user spaces.
  const methods = names.map(name => {
    const start = sourceText.search(new RegExp('    private (?:async )?' + name + '\\('))
    assert.ok(start >= 0, name + ' exists in the production handler')
    const rest = sourceText.slice(start)
    const end = rest.slice(1).search(/\n    (?:private|public|protected) /)
    assert.ok(end >= 0)
    return rest.slice(0, end + 1)
  }).join('\n')
  let upstreamBase
  const upstream = http.createServer((req, res) => {
    if (req.url === '/ignore-range') { res.end('abcdef'); return }
    if (req.url === '/slow-body') {
      res.writeHead(200, { 'Content-Length': 6 }); res.flushHeaders()
      setTimeout(() => res.end('abcdef'), 80)
      return
    }
    if (req.headers.range === 'bytes=99-') { res.writeHead(416, { 'Content-Range': 'bytes */6' }); res.end(); return }
    if (req.headers.range) { res.writeHead(206, { 'Content-Range': 'bytes 1-3/6', 'Content-Length': 3 }); res.end('bcd'); return }
    res.end('abcdef')
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  upstreamBase = 'http://127.0.0.1:' + upstream.address().port
  let cloudPath = '/', cloudQuality = '320k', cloudFolder = 'cache'
  let fallback = 0
  const context = {
    module: { exports: {} }, global, URL, URLSearchParams, AbortController, AbortSignal,
    Readable: require('node:stream').Readable, pipeline: require('node:stream/promises').pipeline,
    fetch, clearTimeout, setTimeout: (fn, ms) => setTimeout(fn, ms === 30000 ? 30 : ms),
    subsonicLog: { debug() {}, warn() {}, error() {} },
    checkCache: () => ({ exists: false }), getFileName: () => 'song',
    resolveOpenlistCacheEntry: async (_user, folder, _base, song) => folder === cloudFolder && song.quality === cloudQuality ? { url: upstreamBase + cloudPath, filename: 'song.' + (cloudQuality === 'flac' ? 'flac' : 'mp3'), quality: cloudQuality } : null,
    safeRedirect: (res, url) => { res.writeHead(302, { Location: url }); res.end() },
  }
  vm.runInNewContext(transformSync('class Harness { ' + methods + ' }; module.exports = Harness;', { loader: 'ts', format: 'cjs' }).code, context)
  const h = new context.module.exports()
  h.resolveSongMeta = async () => ({ music: { id: 'tx_song', source: 'tx', songmid: 'song', name: 'Song', singer: 'Singer', interval: 180 } })
  h.transcodeStream = async (_req, res, url, bitrate, _format, offset, target) => { res.end(JSON.stringify({ transcode: true, url, bitrate, offset, target })) }
  h.resolveStreamUrl = async () => { fallback++; return { url: 'https://platform.example/song.mp3', quality: '320k' } }
  h.sendError = (res, _code, message) => { res.writeHead(502); res.end(message) }
  h.logSourceError = () => {}
  const app = http.createServer((req, res) => void h.handleStream(req, res, 'alice', new URL(req.url, 'http://local').searchParams, 'json'))
  app.listen(0, '127.0.0.1'); await once(app, 'listening')
  const endpoint = 'http://127.0.0.1:' + app.address().port + '/?id=tx_song'
  global.lx = { config: { 'subsonic.playCacheFirstUseOpenlist': true, 'subsonic.playCacheFirst': true, 'subsonic.openlistDelivery': 'direct', 'subsonic.transcode.enabled': true } }
  const config = global.lx.config
  t.after(async () => {
    for (const server of [app, upstream]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  })
  await t.test('requested format and time offset use transcoding even on a cloud hit', async () => {
    cloudQuality = 'flac'
    const response = await fetch(endpoint + '&format=mp3&timeOffset=10')
    const body = await response.json()
    assert.equal(body.transcode, true); assert.equal(body.target, 'mp3'); assert.equal(body.offset, 10)
  })
  await t.test('higher-quality cloud backup can be transcoded to a client bitrate cap', async () => {
    cloudFolder = 'music'
    const body = await (await fetch(endpoint + '&maxBitrate=128&format=mp3')).json()
    assert.equal(body.bitrate, 128); assert.equal(body.transcode, true)
    cloudFolder = 'cache'; cloudQuality = '320k'
  })
  await t.test('proxy preserves partial responses and invalid range status', async () => {
    config['subsonic.openlistDelivery'] = 'proxy'
    const partial = await fetch(endpoint, { headers: { Range: 'bytes=1-3' } })
    assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), 'bytes 1-3/6'); assert.equal(await partial.text(), 'bcd')
    const invalid = await fetch(endpoint, { headers: { Range: 'bytes=99-' } })
    assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */6')
  })
  await t.test('proxy falls back before headers if upstream ignores Range', async () => {
    cloudPath = '/ignore-range'
    const response = await fetch(endpoint, { headers: { Range: 'bytes=1-3' }, redirect: 'manual' })
    assert.equal(response.status, 302); assert.equal(response.headers.get('location'), 'https://platform.example/song.mp3'); assert.equal(fallback, 1)
  })
  await t.test('the connection timeout does not abort an established, slowly delivered audio body', async () => {
    cloudPath = '/slow-body'
    assert.equal(await (await fetch(endpoint)).text(), 'abcdef')
  })
})
