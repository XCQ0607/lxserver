const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { build, transformSync } = require('esbuild')

const player = fs.readFileSync(path.join(__dirname, '../public/music/app.js'), 'utf8')
function method(name) {
  const start = player.indexOf('async function ' + name + '(')
  const end = player.slice(start + 1).search(/\n(?:async )?function /)
  assert.ok(start >= 0 && end >= 0)
  return player.slice(start, start + 1 + end)
}
const quiet = { log() {}, warn() {}, error() {} }

test('Web local-lyrics preference controls read order independently of saving', async () => {
  for (const [prefer, browser, expected] of [[true, 'browser', 'local'], [false, 'browser', 'browser'], [false, '', 'online']]) {
    const song = { id: 'tx_123', source: 'tx', songmid: '123', name: 'Song', singer: 'Singer' }, calls = []
    const context = vm.createContext({ settings: { preferLocalLyrics: prefer, enableServerLyricCache: false }, currentPlayingSong: song, lyricRequestVersion: 0,
      getLyricSongKey: song => song.id, lastLyricSongId: null, currentLyricLines: [], currentRawLrc: '', currentRawTlrc: '', currentRawRlrc: '', currentRawKlrc: '',
      document: { getElementById: () => ({ innerHTML: '' }) }, localStorage: { getItem: () => browser ? JSON.stringify({ lrc: browser }) : null, setItem() {}, removeItem() {} },
      API_BASE: '/api/music', getUserAuthHeaders: () => ({ 'x-user-name': 'alice' }), console: quiet, URLSearchParams,
      initLyricPlayer() {}, applyLyricUpdate() {}, renderLyric() {},
      fetch: async url => { calls.push(String(url)); return { ok: true, json: async () => String(url).includes('/cache/lyric') ? { success: true, data: { lyric: 'local' } } : { lyric: 'online' } } },
    })
    vm.runInContext(method('fetchLyric'), context)
    await context.fetchLyric(song)
    assert.equal(context.currentRawLrc, expected)
    if (prefer) assert.ok(calls[0].includes('/cache/lyric'))
    else assert.ok(!calls.some(url => url.includes('/cache/lyric')))
    if (!prefer && !browser) assert.match(calls[0], /preferLocal=0/)
  }
})

test('Web audio cache requests pass independent LRC, embedding and download-directory settings', async () => {
  let payload
  const context = vm.createContext({ window: { settings: { enableServerLyricCache: false, embedLyricToFile: true, enableOnlyDownloadMode: true } },
    currentListData: { username: 'alice' }, getUserAuthHeaders: () => ({}), localStorage: { getItem: () => null }, console: quiet,
    fetch: async (_url, options) => { payload = JSON.parse(options.body) },
  })
  vm.runInContext(method('triggerServerCache'), context)
  await context.triggerServerCache({ id: 'tx_123', name: 'Song' }, 'https://audio.example/song', '320k')
  assert.equal(payload.cacheLyric, false); assert.equal(payload.embedLyric, true); assert.equal(payload.enableOnlyDownloadMode, true)
})

test('Subsonic online-ID lyrics return local LRC without requesting SDK lyrics or KG metadata', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server/integrations/subsonic.ts'), 'utf8')
  const start = source.indexOf('    private async handleGetLyricsBySongId(')
  const next = source.slice(start + 1).search(/\n    (?:private|public|protected) /)
  const method = source.slice(start, start + 1 + next)
  let response, called = 0
  const context = vm.createContext({ URLSearchParams, lookupLocalLyrics: (_song, user) => { assert.equal(user, 'alice'); return { exists: true, content: { lyric: '[00:01]local LRC', tlyric: '[00:01]translation' } } },
    musicSdk: { kg: { getLyric() { called++; throw new Error('must not fetch') }, musicSearch: { search() { called++; throw new Error('must not search') } } } },
  })
  const handler = vm.runInContext(transformSync('(new class {' + method + '})', { loader: 'ts' }).code, context)
  handler.findMusicById = async () => ({ music: { id: 'kg_123', source: 'kg', songmid: '123', name: 'Song', singer: 'Singer' } })
  handler.buildMergedLrc = raw => raw
  handler.parseLrc = text => [{ start: 1000, value: text }]
  handler.sendResponse = (_res, body) => { response = body }
  await handler.handleGetLyricsBySongId({}, 'alice', new URLSearchParams({ id: 'kg_123' }), 'json')
  assert.equal(called, 0); assert.equal(response.lyrics.value, '[00:01]local LRC')
  assert.equal(response.lyricsList.structuredLyrics.length, 2)
})

test('local sidecar lyrics cover music, cache and custom directories without crossing users', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-local-lrc-')), fixture = path.join(temp, 'fixture.cjs')
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.resolve(__dirname, '..')
  await build({ entryPoints: [path.join(root, 'src/server/music/localLyrics.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: fixture,
    plugins: [{ name: 'local-library-boundaries', setup(b) {
      b.onResolve({ filter: /^\.\/(fileCache|customMusicManager)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
        import path from 'node:path';
        export function getCacheDir(user,music){return path.join(${JSON.stringify(temp)},user,music?'music':'cache')}
        export function getCustomMusicDir(user){return path.join(${JSON.stringify(temp)},user,'custom')}
        export function checkLyricCache(){return {exists:false}}
        export function checkCustomLyricCache(){return {exists:false}}
      ` }))
    } }],
  })
  const { lookupLocalLyrics } = require(fixture)
  for (const folder of ['music', 'cache', 'custom']) {
    const dir = path.join(temp, 'alice', folder); fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'audio'); fs.writeFileSync(path.join(dir, 'song.lrc'), '[00:01]Alice ' + folder)
    assert.match(lookupLocalLyrics({ filename: 'song.mp3', folder }, 'alice').content.lyric, new RegExp('Alice ' + folder))
    assert.equal(lookupLocalLyrics({ filename: 'song.mp3', folder }, 'bob').exists, false)
  }
  assert.throws(() => lookupLocalLyrics({ filename: '../../alice/music/song.mp3', folder: 'cache' }, 'bob'), /path|outside|traversal|Forbidden/i)
})

test('Web cache routing tries authenticated local files before OpenList and does not leak tokens into cloud URLs', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/server/server.ts'), 'utf8')
  const start = source.indexOf("      if (pathname === '/api/music/cache/check'")
  const route = source.slice(start, source.indexOf('// Persistent server download queue', start))
  for (const local of [true, false]) {
    let cloud = 0, response
    const context = { AbortSignal, pathname: '/api/music/cache/check', req: { method: 'GET', headers: { 'x-user-name': 'alice', 'x-user-token': 'private-token' } },
      urlObj: new URL('http://localhost/api/music/cache/check?name=Song&singer=Singer&source=tx&songmid=123&quality=320k&includeOpenlist=1'),
      verifyUserAuth: () => 'alice', fileCache: { normalizeSongId: () => 'tx_123', getFileName: () => 'song', checkCache: (_song, user) => { assert.equal(user, 'alice'); return local ? { exists: true, url: '/api/music/cache/file/alice/song?folder=music' } : { exists: false } } },
      resolveOpenlistCacheEntry: async user => { assert.equal(user, 'alice'); cloud++; return { url: 'https://cloud.example/song?sign=abc', filename: 'song.mp3', quality: '320k' } },
      res: { writeHead() {}, end(body) { response = JSON.parse(body) } },
    }
    await vm.runInNewContext(transformSync('(async () => {' + route + '})()', { loader: 'ts' }).code, context)
    assert.equal(cloud, local ? 0 : 1)
    assert.equal(response.url.includes('private-token'), local)
    if (!local) assert.equal(response.origin, 'openlist')
  }
})
