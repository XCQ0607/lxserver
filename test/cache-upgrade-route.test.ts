import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import vm from 'node:vm'

const source = fs.readFileSync(path.join(__dirname, '../src/server/server.ts'), 'utf8')
const queuePath = '/api/music/cache/queue'
const between = (from: string, to: string) => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end)
}
const route = new vm.Script(stripTypeScriptTypes([
  between('const getCacheRequestUsername =', '/** 定期清理过期用户 Token'),
  between('const readBody =', '// Opaque, short-lived capture intent'),
  `(() => {${between(`if (pathname === '${queuePath}' && req.method === 'GET')`, `if (pathname === '${queuePath}/concurrency'`)}})()`,
].join('\n;\n')))

const upgrade = { cacheUpgrade: true, songInfo: { id: 'tx_1', source: 'tx' }, quality: 'flac' }
const alice = { 'x-user-name': 'alice', 'x-user-token': 'fixture-alice' }

async function request({ method = 'POST', id = '', headers = {} as Record<string, string>, body = { tasks: [upgrade] } as unknown } = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = []
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method, headers })
  const urlObj = new URL(queuePath, 'https://fixture.invalid')
  if (id) urlObj.searchParams.set('id', id)
  let status = 0
  const payload = await new Promise<any>(resolve => {
    route.runInNewContext({
      global: { lx: { config: { 'admin.password': 'fixture-admin' } } }, Buffer, req, urlObj, pathname: queuePath,
      res: { writeHead(code: number) { status = code }, end(body: string) { resolve(JSON.parse(body)) } },
      verifyUserAuth(r: typeof req) {
        return r.headers['x-user-name'] === 'alice' && r.headers['x-user-token'] === 'fixture-alice' ? 'alice' : null
      },
      canUpgradeForAccount: (account: string) => account === 'alice',
      serverDownloadQueue: Object.fromEntries(['enqueue', 'setConcurrency', 'list'].map(name => [name, (...args: unknown[]) => {
        calls.push({ name, args })
        return []
      }])),
    })
  })
  req.destroy()
  return { status, payload, calls: JSON.parse(JSON.stringify(calls)) }
}

test('automatic queue writes reject anonymous or invalid accounts and ignore a claimed owner', async () => {
  assert.equal((await request()).status, 403)
  assert.equal((await request({ headers: { 'x-user-name': 'alice' } })).status, 401)
  const allowed = await request({ headers: alice, body: { username: 'another-account', tasks: [upgrade] } })
  assert.equal(allowed.status, 200)
  assert.deepEqual(allowed.calls, [{ name: 'enqueue', args: ['alice', [upgrade]] }])
})

test('an automatic request cannot include manual tasks or set download configuration', async () => {
  for (const body of [{ tasks: [upgrade, upgrade] }, { tasks: [upgrade], concurrency: 3 }, { tasks: [upgrade], namingPattern: '' }]) {
    const result = await request({ headers: alice, body })
    assert.equal(result.status, 400)
    assert.deepEqual(result.calls, [])
  }
})

test('status polls are scoped to verified account and explicit queue ID', async () => {
  const requested = await request({ method: 'GET', headers: alice, id: 'lx_upgrade_example' })
  assert.equal(requested.status, 200)
  assert.deepEqual(requested.calls, [{ name: 'list', args: ['alice', { id: 'lx_upgrade_example', includeUpgrades: false }] }])
  const ordinary = await request({ method: 'GET', headers: alice })
  assert.deepEqual(ordinary.calls, [{ name: 'list', args: ['alice', { includeUpgrades: false }] }])
})
