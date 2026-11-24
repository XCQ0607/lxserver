import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveCollectionUser } from '../src/server/auth/collectionAccess'
import { normalizeSourceOwner, parseCookies, resolveContainedPath, resolveContainedPathAsync, resolvePublicUrl } from '../src/server/auth/security'

test('collection ownership: ordinary users cannot impersonate another account', () => {
  assert.equal(resolveCollectionUser('bob', 'alice', false, true, false), null)
  assert.equal(resolveCollectionUser('bob', 'alice', false, true, true), null)
  assert.equal(resolveCollectionUser('', 'alice', false, false, true), 'alice')
  assert.equal(resolveCollectionUser('bob', 'admin', true, false, true), 'bob')
  assert.equal(resolveCollectionUser('alice', null, false, true, false), null)
})

test('public collections require opt-in and only admins can write', () => {
  assert.equal(resolveCollectionUser('_open', null, false, false, false), null)
  assert.equal(resolveCollectionUser('', null, false, true, false), '_open')
  assert.equal(resolveCollectionUser('_open', 'alice', false, true, true), null)
  assert.equal(resolveCollectionUser('_open', 'admin', true, true, true), '_open')
})

test('source owners reject directory separators and traversal', () => {
  for (const name of ['..', '.', '../alice', 'a/b', 'a\\b', 'a\0b']) {
    assert.throws(() => normalizeSourceOwner(name), /Invalid source owner/)
  }
  assert.equal(normalizeSourceOwner('_open'), 'open')
  assert.equal(normalizeSourceOwner('alice'), 'alice')
})

test('contained paths reject sibling-prefix escapes and symlink write paths', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-security-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'root')
  const outside = path.join(temp, 'root-other')
  fs.mkdirSync(root)
  fs.mkdirSync(outside)
  assert.equal(resolveContainedPath(root, 'new/song.mp3'), path.join(root, 'new/song.mp3'))
  assert.throws(() => resolveContainedPath(root, '../root-other/song.mp3'), /traversal/)
  assert.throws(() => resolveContainedPath(root, outside), /traversal/)
  fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => resolveContainedPath(root, 'link/new/song.mp3'), /traversal/)
})

test('cookies tolerate malformed encoding and keep the first duplicate', () => {
  const cookies = parseCookies('token=first; token=second; broken=%ZZ; name=a%20b; __proto__=value')
  assert.equal(cookies.token, 'first')
  assert.equal(cookies.name, 'a b')
  assert.equal(cookies.broken, undefined)
  assert.equal(Object.getPrototypeOf(cookies), null)
})

test('download upstream validation rejects private IPs and credentials without DNS', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]']) {
    await assert.rejects(resolvePublicUrl(`http://${ip}/song`), { code: 'ERR_PRIVATE_UPSTREAM' })
  }
  await assert.rejects(resolvePublicUrl('file:///etc/passwd'), /Invalid upstream URL/)
  await assert.rejects(resolvePublicUrl('https://user:pass@8.8.8.8/song'), /Invalid upstream URL/)
  assert.equal((await resolvePublicUrl('https://8.8.8.8/song')).address, '8.8.8.8')
})


test('async media containment preserves traversal and symlink guards without synchronous filesystem calls', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-security-async-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const root = path.join(temp, 'root')
  const outside = path.join(temp, 'root-other')
  fs.mkdirSync(root)
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(root, 'track.mp3'), 'audio')
  fs.writeFileSync(path.join(outside, 'track.mp3'), 'other audio')
  fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(await resolveContainedPathAsync(root, 'track.mp3'), path.join(root, 'track.mp3'))
  await assert.rejects(resolveContainedPathAsync(root, '../root-other/track.mp3'), /traversal/)
  await assert.rejects(resolveContainedPathAsync(root, 'link/track.mp3'), /traversal/)
  await assert.rejects(resolveContainedPathAsync(root, 'missing.mp3'), { code: 'ENOENT' })
})
