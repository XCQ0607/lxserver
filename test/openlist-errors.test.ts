import test from 'node:test'
import assert from 'node:assert/strict'
import { openlistError } from '../src/server/openlist/openlistErrors'
test('OpenList error messages separate connectivity, local failures and raw diagnostics', () => {
  for (const input of ['fetch failed', 'ECONNREFUSED', 'request timeout', 'HTTP 401', 'HTTP 403']) assert.equal(openlistError(new Error(input)).connection, true)
  assert.equal(openlistError({ message: 'fetch failed', cause: { code: 'CERT_HAS_EXPIRED' } }).code, 'network')
  assert.equal(openlistError({ code: 'ENOENT', message: 'missing local' }).code, 'local_missing')
  assert.equal(openlistError(new Error('unexpected response')).message, '操作失败，请查看详情中的原始错误')
  assert.equal(openlistError(new Error('OpenList 登录失败（500）：upstream error')).connection, false)
})
