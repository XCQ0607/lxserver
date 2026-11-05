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
  let uploads = 0
  let base
  const storage = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const body = Buffer.concat(parts)
    const answer = (data, code = 200) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code, data })) }
    if (req.url.startsWith('/audio?')) {
      const file = remote.get(new URL(req.url, base).searchParams.get('path'))
      if (!file) { res.writeHead(404); res.end(); return }
      res.end(truncateDownload ? file.body.subarray(0, 1) : file.body)
      return
    }
    const args = body.length && req.method !== 'PUT' ? JSON.parse(body) : {}
    if (req.url === '/api/auth/login') return answer({ token: 'test-token' })
    if (req.url === '/api/fs/mkdir') return answer({})
    if (req.url === '/api/fs/put') {
      const name = Buffer.from(req.headers['file-path'], 'latin1').toString('utf8')
      remote.set(name, { body, modified: new Date().toISOString() })
      uploads++
      return answer({})
    }
    if (metadataError) return answer(null, 403)
    if (req.url === '/api/fs/get') {
      const file = remote.get(args.path)
      if (!file) return answer(null, 404)
      return answer({ size: file.body.length, name: path.posix.basename(args.path), modified: file.modified, raw_url: base + '/audio?path=' + encodeURIComponent(args.path) })
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
    stdin: { contents: "export * from './src/server/openlistBackup'; export * from './src/server/openlistBackupDb'; export * from './src/server/openlistClient'", resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'manager.cjs'),
    plugins: [{ name: 'application-boundaries', setup(b) {
      b.onResolve({ filter: /^@\/(server\/music\/fileCache|server\/sources\/userApi|user(\/data)?|constants)$/ }, a => ({ path: a.path, namespace: 'boundary' }))
      b.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({ loader: 'js', contents: `
        export function getCacheDir(user, music) { return global.__openlistTest.dirs[music ? 'music' : 'cache'] }
        export function getIndexItemByFilename(name) { return global.__openlistTest.items.get(name) }
        export function registerOpenListCacheFile(user, item) { global.__openlistTest.registered.push(item) }
        export function unregisterOpenListCacheFile(user, id) { global.__openlistTest.removed.push(id) }
        export function callUserApiGetMusicUrl() { return null }
        export function getUserDirname(user) { return user }
        export function getUserSpace() { return { listManage: { snapshotDataManage: { updateSnapshotDir() {} } } } }
        export const File = { listDir: 'list', listSnapshotDir: 'snapshot' }
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
    delete config['backup.openlist.types']
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
    assert.equal(result.uploaded, Object.keys(data).length)
    await api.verifyPending()
    assert.deepEqual([...remote.keys()].sort(), Object.keys(data).map(p => '/root/_data/' + p).sort())
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
  global.lx = { config: { 'subsonic.playCacheFirst': true, 'subsonic.openlistDelivery': 'direct', 'subsonic.transcode.enabled': true } }
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
