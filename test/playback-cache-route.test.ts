import test, { after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { stripTypeScriptTypes } from 'node:module'
import { Readable } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { parseCookies } from '../src/server/auth/security'

const routePath = '/api/music/cache/select'
const source = fs.readFileSync(path.join(__dirname, '../src/server/server.ts'), 'utf8')
const between = (start: string, end: string) => {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first)
  assert.ok(first >= 0 && last > first)
  return source.slice(first, last)
}
const handler = new vm.Script(stripTypeScriptTypes([
  between('const checkPlayerAuth =', '/** 定期清理过期 Session'),
  between('export const verifyUserAuth =', 'const revokeUserSessions =').replace('export const', 'const'),
  between('const readBody =', '// Opaque, short-lived capture intent'),
  `(async () => {${between(`if (pathname === '${routePath}'`, '// 2. Check Cache')} })()`,
].join('\n;\n')))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-playback-cache-route-'))
const userPath = path.join(root, 'users')
fs.mkdirSync(userPath)
fs.writeFileSync(path.join(root, 'serverInfo.json'), '{"serverId":"test","version":2}')
const originalLx = global.lx
global.lx = { dataPath: root, userPath, config: { serverCacheLocation: 'data' } } as typeof global.lx
after(() => {
  global.lx = originalLx
  fs.rmSync(root, { recursive: true, force: true })
})
mock.timers.enable({ apis: ['setTimeout'] })
const { getCacheDir, indexManager } = require('../src/server/music/fileCache') as typeof import('../src/server/music/fileCache')
const { selectPlaybackCache } = require('../src/server/music/playbackCacheSelection') as typeof import('../src/server/music/playbackCacheSelection')
mock.timers.reset()

const song = { id: 'kw_42', source: 'kw', name: 'Tune', singer: 'Artist', interval: '01:28' }
for (const owner of ['alice', 'bob', '_open']) {
  const filename = `${owner}.mp3`
  const audio = Buffer.from('completed audio fixture')
  fs.writeFileSync(path.join(getCacheDir(owner), filename), audio)
  indexManager.update(owner, {
    ...song, filename, quality: '320k', ext: 'mp3', album: '', size: audio.length, mtime: 0, folder: 'cache',
  }, 'cache')
}
const lookup = { songs: [song], quality: '320k' }
type RouteOptions = {
  requirePlayerAuth?: boolean
  restricted?: boolean
  headers?: Record<string, string>
  chunks?: Buffer[]
  body?: any
}

async function request({ requirePlayerAuth = false, restricted = false, headers = {}, body = lookup, chunks }: RouteOptions = {}) {
  const verifiedLookups: string[] = []
  const req = Object.assign(Readable.from(chunks || [Buffer.from(JSON.stringify(body))]), { method: 'POST', headers, url: routePath })
  const config = {
    users: [{ name: 'alice' }, { name: 'bob' }, { name: 'disabled', disabled: true }, { name: '..' }],
    'player.enableAuth': requirePlayerAuth, 'user.enablePublicRestriction': restricted,
    'user.enablePublicNonAdminLocalMusic': false, 'admin.password': 'fixture-admin',
  }
  let status = 0
  let headersOut: Record<string, string> = {}
  let responseBody: any
  const res = {
    destroyed: false, writableEnded: false,
    writeHead(code: number, responseHeaders: Record<string, string>) {
      assert.equal(status, 0)
      status = code
      headersOut = responseHeaders
    },
    end(value?: string) {
      assert.ok(!this.writableEnded)
      this.writableEnded = true
      responseBody = value ? JSON.parse(value) : undefined
    },
  }
  const now = Date.now()
  await handler.runInNewContext({
    req, res, pathname: routePath, global: { lx: { config } }, Buffer, JSON, TypeError, SyntaxError, parseCookies,
    SESSION_COOKIE_NAME: 'fixtureSession', SESSION_TTL: 60_000, USER_SESSION_TTL: 60_000,
    playerSessions: new Map([['active', { createdAt: now }]]),
    userSessions: new Map([
      ['alice-token', { username: 'alice', createdAt: now }],
      ['disabled-token', { username: 'disabled', createdAt: now }],
      ['unsafe-owner-token', { username: '..', createdAt: now }],
    ]),
    persistentTokens: new Map(),
    selectPlaybackCache(input: unknown, owner: string) {
      verifiedLookups.push(owner)
      return selectPlaybackCache(input, owner)
    },
  })
  // Restricted/unauthorized early exits do not attach a body reader.
  req.destroy()
  return { status, headers: headersOut, body: responseBody, verifiedLookups }
}

test('batch cache selects the active authenticated owner regardless of a claimed body account', async () => {
  const result = await request({
    requirePlayerAuth: true,
    headers: { 'x-user-name': 'alice', 'x-user-token': 'alice-token' },
    body: { ...lookup, username: 'bob' },
  })
  assert.equal(result.status, 200)
  assert.deepEqual(result.verifiedLookups, ['alice'])
  assert.match(result.body.url, /\/cache\/file\/alice\/alice\.mp3\?folder=cache$/)
  assert.equal(result.headers['Cache-Control'], 'private, no-store')
  assert.ok(!result.body.url.includes('alice-token'))
})

test('batch cache denies missing, invalid, disabled and wrong-account credentials before lookup', async () => {
  for (const [headers, requirePlayerAuth] of [
    [{ 'x-user-name': 'alice' }, false],
    [{ 'x-user-token': 'invalid' }, false],
    [{ 'x-user-name': 'bob', 'x-user-token': 'alice-token' }, false],
    [{ 'x-user-name': 'disabled', 'x-user-token': 'disabled-token' }, false],
    [{ 'x-user-name': '..', 'x-user-token': 'unsafe-owner-token' }, false],
    [{}, true],
  ] as Array<[Record<string, string>, boolean]>) {
    const result = await request({ headers, requirePlayerAuth })
    assert.equal(result.status, 401)
    assert.deepEqual(result.verifiedLookups, [])
    assert.equal(result.body, undefined)
  }
})

test('public restriction hides ready local audio without blocking public provider playback', async () => {
  const headers = { cookie: 'fixtureSession=active' }
  const allowed = await request({ headers, requirePlayerAuth: true })
  assert.equal(allowed.status, 200)
  assert.deepEqual(allowed.verifiedLookups, ['_open'])
  assert.equal(allowed.body.filename, '_open.mp3')

  const restricted = await request({ headers, restricted: true, requirePlayerAuth: true })
  assert.equal(restricted.status, 200)
  assert.deepEqual(restricted.body, { exists: false })
  assert.deepEqual(restricted.verifiedLookups, [])
})

test('batch cache accepts eight tracks and 24 KiB exactly, rejecting larger input', async () => {
  const body = { ...lookup, songs: Array(8).fill(song) }
  const bytes = 24 * 1024
  const json = Buffer.from(JSON.stringify(body))
  const fitting = Buffer.concat([json, Buffer.alloc(bytes - json.length, 0x20)])
  const allowed = await request({ chunks: [fitting.subarray(0, 1024), fitting.subarray(1024)] })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.body.exists, true)

  const extraTrack = await request({ body: { ...body, songs: Array(9).fill(song) } })
  assert.equal(extraTrack.status, 400)
  const oneTooMany = Buffer.concat([fitting, Buffer.from(' ')])
  for (const chunks of [[oneTooMany], [fitting, Buffer.from(' ')], [Buffer.from('水'.repeat(bytes / 3 + 1))]]) {
    const oversized = await request({ chunks })
    assert.equal(oversized.status, 413)
    assert.deepEqual(oversized.verifiedLookups, [])
    assert.equal(oversized.body, undefined)
  }
})
