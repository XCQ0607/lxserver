import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { handleFileManager } from '../src/server/integrations/fileManager'

test('file API: authentication, media sessions, traversal and mutations', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-file-api-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'root')
  fs.mkdirSync(root)
  fs.writeFileSync(path.join(root, 'sample.txt'), 'abcdef')
  fs.writeFileSync(path.join(root, 'page.html'), '<script>alert(1)</script>')
  fs.writeFileSync(path.join(temp, 'outside.txt'), 'private')
  const password = 'test-only-password'
  // Keep the constructors explicit: Electron also brings a different Node type version.
  const server = http.createServer<typeof http.IncomingMessage, typeof http.ServerResponse>((req, res) => {
    void handleFileManager(req, res, { root }, password).catch(error => res.destroy(error))
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as import('node:net').AddressInfo
  const base = `http://127.0.0.1:${address.port}/api/files`
  const auth = { 'x-frontend-auth': password }
  const media = (file: string) => '/preview?path=' + encodeURIComponent('root://' + file)
  const post = (action: string, body: unknown) => fetch(base + '/' + action, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  await t.test('missing/wrong credentials and query-string passwords are rejected', async () => {
    for (const suffix of ['', '?token=' + password]) assert.equal((await fetch(base + suffix)).status, 401)
    assert.equal((await fetch(base, { headers: { 'x-frontend-auth': 'wrong' } })).status, 401)
    const response = await fetch(base, { headers: auth })
    assert.equal(response.status, 200)
    const listing = await response.json()
    assert.ok(listing.files.some((file: any) => file.path === 'root://sample.txt'))
    assert.ok(!JSON.stringify(listing).includes(temp))
  })

  await t.test('session cookies authorize media only, and tampering is rejected', async () => {
    const session = await fetch(base + '/session', { method: 'POST', headers: auth })
    assert.equal(session.status, 200)
    const setCookie = session.headers.get('set-cookie')!
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Strict/)
    const cookie = setCookie.split(';')[0]
    const preview = await fetch(base + media('sample.txt'), { headers: { cookie } })
    assert.equal(preview.status, 200)
    assert.equal(await preview.text(), 'abcdef')
    assert.equal((await fetch(base, { headers: { cookie } })).status, 401)
    assert.equal((await fetch(base + media('sample.txt'), { headers: { cookie: cookie + 'x' } })).status, 401)
  })

  await t.test('traversal and unknown storage cannot expose outside files', async () => {
    for (const virtual of ['root://../outside.txt', 'root://..\\outside.txt', 'unknown://outside.txt']) {
      const response = await fetch(base + '/preview?path=' + encodeURIComponent(virtual), { headers: auth })
      assert.equal(response.status, 400)
      assert.ok(!(await response.text()).includes('private'))
    }
  })

  await t.test('media supports byte ranges and rejects invalid ranges', async () => {
    const response = await fetch(base + media('sample.txt'), { headers: { ...auth, Range: 'bytes=1-3' } })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), 'bytes 1-3/6')
    assert.equal(await response.text(), 'bcd')
    const invalid = await fetch(base + media('sample.txt'), { headers: { ...auth, Range: 'bytes=99-100' } })
    assert.equal(invalid.status, 416)
    const head = await fetch(base + media('sample.txt'), { method: 'HEAD', headers: auth })
    assert.equal(head.headers.get('content-length'), '6')
    assert.equal(await head.text(), '')
  })

  await t.test('HTML preview cannot run scripts in the admin origin', async () => {
    const response = await fetch(base + media('page.html'), { headers: auth })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type')!, /^text\/plain/)
    assert.match(response.headers.get('content-security-policy')!, /sandbox/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    await response.text()
  })

  await t.test('create/save cannot overwrite existing files or delete the root', async () => {
    assert.equal((await post('create-file', { path: 'root://', name: 'new.txt' })).status, 200)
    assert.equal((await post('save', { path: 'root://new.txt', content: 'saved' })).status, 200)
    assert.equal(fs.readFileSync(path.join(root, 'new.txt'), 'utf8'), 'saved')
    assert.equal((await post('create-file', { path: 'root://', name: 'new.txt' })).status, 409)
    assert.equal(fs.readFileSync(path.join(root, 'new.txt'), 'utf8'), 'saved')
    assert.equal((await post('delete', { path: 'root://', items: [{ path: 'root://' }] })).status, 403)
    assert.equal(fs.readFileSync(path.join(temp, 'outside.txt'), 'utf8'), 'private')
  })

  await t.test('write endpoints reject GET', async () => {
    assert.equal((await fetch(base + '/delete', { headers: auth })).status, 405)
    assert.ok(fs.existsSync(path.join(root, 'sample.txt')))
  })
})
