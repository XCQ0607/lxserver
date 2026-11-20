const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

test('cloud_missing_count persists across status updates and resets explicitly', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-cloud-missing-'))
  const root = path.resolve(__dirname, '..')
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))

  await build({
    stdin: { contents: "export * from './src/server/openlist/openlistBackupDb'", resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'db.cjs'),
  })
  global.lx = { dataPath: temp }
  const api = require(path.join(temp, 'db.cjs'))

  const row = api.upsertBackupFile({
    user: 'alice', folderType: 'cache', localPath: path.join(temp, 'a.mp3'),
    remotePath: '/root/alice/cache/a.mp3', status: 'verified', direction: 'upload',
  })
  assert.equal(row.cloud_missing_count || 0, 0)

  // Count accumulates and survives a successful reupload that only clears retry_count.
  api.setBackupStatus(row.id, 'failed', { cloudMissingCount: 1, retryCount: 2, error: 'cloud missing' })
  assert.equal(api.getBackupById(row.id).cloud_missing_count, 1)
  api.setBackupStatus(row.id, 'verified', { retryCount: 0 })
  assert.equal(api.getBackupById(row.id).cloud_missing_count, 1, 'successful reupload keeps cloud counter')

  api.setBackupStatus(row.id, 'verified', { cloudMissingCount: 2 })
  api.setBackupStatus(row.id, 'verified', { cloudMissingCount: 3 })
  assert.equal(api.getBackupById(row.id).cloud_missing_count, 3)

  // Manual retry resets both counters and clears the error.
  api.setBackupStatus(row.id, 'verified', { retryCount: 0, cloudMissingCount: 0, error: null })
  const reset = api.getBackupById(row.id)
  assert.equal(reset.cloud_missing_count, 0)
  assert.equal(reset.retry_count, 0)
  assert.equal(reset.error, null)

  api.closeBackupDb()
})
