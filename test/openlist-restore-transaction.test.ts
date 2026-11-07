import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeRestoreTransaction, listRestoreTasks, readRestoreTask, cancelRestoreTask, rollbackRestoreTask, deleteRestoreTask, hasInterruptedRestore, type RestoreFile } from '../src/server/openlist/openlistRestoreTasks'
import { hashBackupFile, backupFileVersion } from '../src/utils/backupFiles'
import { markRestoreDependencies, mergeRestoreDependency } from '../src/server/backup/restoreDependencies'

test('staged restore transactions, interrupted tasks and metadata dependencies', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-restore-transaction-'))
  const previous = global.lx
  global.lx = { dataPath: temp, configPath: path.join(temp, 'config.js'), config: {} } as any
  t.after(() => { global.lx = previous; fs.rmSync(temp, { recursive: true, force: true }) })
  const fixture = (name: string): RestoreFile => {
    const relative = 'users/alice/' + name + '.json', local = path.join(temp, relative)
    fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, 'original ' + name)
    return { relative, local, remote: '/fixture/' + name, size: 5, version: backupFileVersion(local), action: 'overwrite' }
  }
  const input = (files: RestoreFile[], download: any) => ({ files, source: 'fixture', options: {}, keepCopies: true, merge() {}, download })

  await t.test('a failed download replaces nothing; continuing reuses already verified files', async () => {
    const files = [fixture('a'), fixture('b')]
    let calls = 0
    const failed = await executeRestoreTransaction(input(files, async (f: RestoreFile, target: string) => {
      calls++; if (f.relative.endsWith('b.json')) throw new Error('network down')
      fs.writeFileSync(target, 'cloud')
    }))
    assert.equal(failed.restored, 0)
    assert.equal(fs.readFileSync(files[0].local, 'utf8'), 'original a')
    assert.equal(readRestoreTask(failed.taskId).state, 'failed')
    const continued = await executeRestoreTransaction({ ...input(files, async (_: RestoreFile, target: string) => { calls++; fs.writeFileSync(target, 'cloud') }), resumeId: failed.taskId })
    assert.equal(continued.restored, 2); assert.equal(calls, 3)
    assert.equal(fs.readFileSync(path.join(continued.backupDir, 'files', files[0].relative), 'utf8'), 'original a')
    rollbackRestoreTask(failed.taskId)
    assert.equal(fs.readFileSync(files[0].local, 'utf8'), 'original a')
    deleteRestoreTask(failed.taskId)
    assert.equal(listRestoreTasks().some(task => task?.id === failed.taskId), false)
  })

  await t.test('commit failure rolls back earlier replacements', async () => {
    const files = [fixture('c'), fixture('d')]
    const originalRename = fs.renameSync
    fs.renameSync = ((source: fs.PathLike, dest: fs.PathLike) => {
      if (String(source).endsWith('.oltmp') && String(dest) === files[1].local) throw new Error('simulated disk error')
      originalRename(source, dest)
    }) as typeof fs.renameSync
    try {
      const result = await executeRestoreTransaction(input(files, async (_: RestoreFile, target: string) => fs.writeFileSync(target, 'cloud')))
      assert.equal(result.restored, 0); assert.ok(result.errors.length)
      assert.equal(fs.readFileSync(files[0].local, 'utf8'), 'original c')
      assert.equal(fs.readFileSync(files[1].local, 'utf8'), 'original d')
    } finally { fs.renameSync = originalRename }
  })

  await t.test('cancellation keeps original files and permits file-level continuation', async () => {
    const file = fixture('cancel')
    const result = await executeRestoreTransaction(input([file], async (_: RestoreFile, target: string) => {
      fs.writeFileSync(target, 'cloud')
      const active = listRestoreTasks().find(task => task?.state === 'downloading')!
      cancelRestoreTask(active!.id)
    }))
    assert.equal(readRestoreTask(result.taskId).state, 'cancelled')
    assert.equal(fs.readFileSync(file.local, 'utf8'), 'original cancel')
    const next = await executeRestoreTransaction({ ...input([file], async () => { throw new Error('should reuse downloaded file') }), resumeId: result.taskId })
    assert.equal(next.restored, 1)
  })

  await t.test('rollback validates all files before erasing subsequent user edits', async () => {
    const file = fixture('edited')
    const result = await executeRestoreTransaction(input([file], async (_: RestoreFile, target: string) => fs.writeFileSync(target, 'cloud')))
    fs.writeFileSync(file.local, 'user edit after restore')
    assert.throws(() => rollbackRestoreTask(result.taskId), /已变化/)
    assert.equal(fs.readFileSync(file.local, 'utf8'), 'user edit after restore')
  })

  await t.test('crash between replace and journal update is detected and recoverable', async () => {
    const file = fixture('crash')
    const result = await executeRestoreTransaction(input([file], async (_: RestoreFile, target: string) => fs.writeFileSync(target, 'cloud')))
    const journal = path.join(temp, 'backups/openlist-restore-tasks', result.taskId, 'task.json')
    const task = JSON.parse(fs.readFileSync(journal, 'utf8')); task.state = 'committing'; task.installed = {}
    fs.writeFileSync(journal, JSON.stringify(task))
    assert.equal(hasInterruptedRestore(temp), true)
    assert.equal(readRestoreTask(result.taskId).state, 'recovery-required')
    rollbackRestoreTask(result.taskId)
    assert.equal(hasInterruptedRestore(temp), false)
    assert.equal(fs.readFileSync(file.local, 'utf8'), 'original crash')
  })

  await t.test('resume re-downloads same-size modified staging files without cloud hashes', async () => {
    const file = fixture('tampered-stage')
    const result = await executeRestoreTransaction(input([file], async (_: RestoreFile, target: string) => {
      fs.writeFileSync(target, 'cloud')
      cancelRestoreTask(listRestoreTasks().find(task => task?.state === 'downloading')!.id)
    }))
    fs.writeFileSync(path.join(temp, 'backups/openlist-restore-tasks', result.taskId, 'stage', file.relative), 'wrong')
    let calls = 0
    const resumed = await executeRestoreTransaction({ ...input([file], async (_: RestoreFile, target: string) => { calls++; fs.writeFileSync(target, 'cloud') }), resumeId: result.taskId })
    assert.equal(calls, 1); assert.equal(resumed.restored, 1)
    assert.equal(fs.readFileSync(file.local, 'utf8'), 'cloud')
  })

  await t.test('missing snapshots preserve local latest and add cloud history', () => {
    const dir = path.join(temp, 'users/alice/list/snapshot'); fs.mkdirSync(dir, { recursive: true })
    const local = path.join(dir, 'snapshotInfo.json'), staged = path.join(temp, 'snapshot-stage.json')
    fs.writeFileSync(local, JSON.stringify({ latest: 'local', list: ['old'], clients: { desktop: 'local' } }))
    fs.writeFileSync(path.join(dir, 'snapshot_old'), 'old')
    fs.writeFileSync(staged, JSON.stringify({ latest: 'cloud', list: [], clients: {} }))
    const files: RestoreFile[] = [
      { relative: 'users/alice/list/snapshot/snapshotInfo.json', local, remote: '', size: 0, version: backupFileVersion(local), action: 'skip' },
      { relative: 'users/alice/list/snapshot/snapshot_cloud', local: path.join(dir, 'snapshot_cloud'), remote: '', size: 0, version: 'missing', action: 'add' },
    ]
    markRestoreDependencies(files); assert.equal(files[0].action, 'merge')
    mergeRestoreDependency(files[0], staged, files)
    const merged = JSON.parse(fs.readFileSync(staged, 'utf8'))
    assert.equal(merged.latest, 'local'); assert.deepEqual(merged.clients, { desktop: 'local' })
    assert.deepEqual(merged.list, ['old', 'cloud'])
  })

  await t.test('missing music merges new index entries and preserves local conflicts', () => {
    const dir = path.join(temp, 'music/alice'); fs.mkdirSync(dir, { recursive: true })
    const local = path.join(dir, 'music_index.json'), stage = path.join(temp, 'index-stage.json')
    fs.writeFileSync(local, JSON.stringify({ old: { filename: 'old.mp3', name: 'local title' } }))
    fs.writeFileSync(stage, JSON.stringify({ old: { filename: 'old.mp3', name: 'cloud title' }, added: { filename: 'new.mp3', source: 'tx', quality: 'flac' } }))
    const files: RestoreFile[] = [
      { relative: 'music/alice/music_index.json', local, remote: '', size: 0, version: backupFileVersion(local), action: 'skip' },
      { relative: 'music/alice/new.mp3', local: path.join(dir, 'new.mp3'), remote: '', size: 0, version: 'missing', action: 'add' },
    ]
    markRestoreDependencies(files); assert.equal(files[0].action, 'merge')
    mergeRestoreDependency(files[0], stage, files)
    const merged = JSON.parse(fs.readFileSync(stage, 'utf8'))
    assert.equal(merged.old.name, 'local title'); assert.equal(merged.added.source, 'tx')
    assert.match(hashBackupFile(stage), /^[a-f0-9]{64}$/)
  })
})
