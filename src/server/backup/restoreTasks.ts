import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { backupFileVersion, hashBackupFile } from '@/utils/backupFiles'
import { backupLocalPath, isCloudRestoreActive, isCloudBackupRunning } from '@/utils/backupPolicy'

export interface RestoreFile {
  relative: string; local: string; remote: string; size: number; hash?: string
  version: string; action: 'add' | 'overwrite' | 'skip' | 'merge'
}
export interface RestoreTask {
  id: string; state: string; createdAt: number; updatedAt: number; source: string
  options: any; files: RestoreFile[]; downloaded: string[]; downloadedHashes?: Record<string, string>; installed: Record<string, string>
  errors: string[]; keepCopies: boolean; bytes: number
}
export function createRestoreTaskManager(namespace: string) {
  if (!/^[a-z-]+$/.test(namespace)) throw new Error('恢复任务命名空间无效')
  const controllers = new Map<string, AbortController>()
  const pendingTasks = new Set<string>()
  const root = () => path.join(global.lx.dataPath, 'backups', namespace)
  function hasInterruptedRestore(dataPath: string): boolean {
    const base = path.join(dataPath, 'backups', namespace)
    if (!fs.existsSync(base)) return false
    return fs.readdirSync(base).filter(id => /^[0-9a-f-]{36}$/.test(id)).some(id => {
      try { return ['committing', 'recovery-required'].includes(JSON.parse(fs.readFileSync(path.join(base, id, 'task.json'), 'utf8')).state) } catch { return false }
    })
  }
  const directory = (id: string) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('恢复任务 ID 无效')
    const dir = path.join(root(), id)
    if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('任务目录不能为符号链接')
    return dir
  }
  const save = (task: RestoreTask) => {
    const dir = directory(task.id); fs.mkdirSync(dir, { recursive: true })
    task.updatedAt = Date.now()
    const file = path.join(dir, 'task.json'), tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(task, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file)
  }
  function readRestoreTask(id: string): RestoreTask {
    const task = JSON.parse(fs.readFileSync(path.join(directory(id), 'task.json'), 'utf8')) as RestoreTask
    if (task.id !== id || !Array.isArray(task.files)) throw new Error('恢复任务记录无效')
    if (task.state === 'pending' && !pendingTasks.has(id)) { task.state = 'interrupted'; save(task) }
    if (!controllers.has(id) && ['downloading', 'ready'].includes(task.state)) { task.state = 'interrupted'; save(task) }
    if (!controllers.has(id) && task.state === 'committing') { task.state = 'recovery-required'; save(task) }
    return task
  }
  function listRestoreTasks() {
    if (!fs.existsSync(root())) return []
    return fs.readdirSync(root()).filter(id => /^[0-9a-f-]{36}$/.test(id)).map(id => {
      try {
        const task = readRestoreTask(id)
        return { id, state: task.state, createdAt: task.createdAt, updatedAt: task.updatedAt, source: task.source, total: task.files.filter(f => f.action !== 'skip').length, downloaded: task.downloaded.length, applied: Object.keys(task.installed).length, bytes: task.bytes, errors: task.errors, canRollback: task.keepCopies && Object.keys(task.installed).length > 0 }
      } catch { return null }
    }).filter(Boolean).sort((a, b) => b!.createdAt - a!.createdAt)
  }
  function cancelRestoreTask(id: string) {
    const controller = controllers.get(id)
    if (!controller) {
      const task = readRestoreTask(id)
      if (task.state !== 'pending') throw new Error('任务未在运行')
      task.state = 'cancelled'; pendingTasks.delete(id); save(task); return
    }
    controller.abort(new Error('用户取消恢复'))
  }
  function createPendingRestoreTask(options: any): string {
    const task: RestoreTask = { id: crypto.randomUUID(), state: 'pending', createdAt: Date.now(), updatedAt: Date.now(), source: '', options, files: [], downloaded: [], installed: {}, errors: [], keepCopies: options.backupBeforeRestore !== false, bytes: 0 }
    save(task); pendingTasks.add(task.id); return task.id
  }
  function failRestoreTask(id: string, error: unknown) {
    pendingTasks.delete(id)
    const task = readRestoreTask(id)
    if (['completed', 'recovery-required', 'cancelled'].includes(task.state)) return
    task.state = 'failed'; task.errors.push(error instanceof Error ? error.message : String(error)); save(task)
  }
  function validateTargets(task: RestoreTask) {
    const context = { dataPath: global.lx.dataPath, configPath: global.lx.configPath, config: global.lx.config as any }
    for (const file of task.files) if (path.resolve(backupLocalPath(file.relative, context)) !== path.resolve(file.local)) throw new Error('恢复目标配置已变化，请重新预览')
  }
  function rollback(task: RestoreTask) {
    validateTargets(task)
    const applied = task.files.filter(file => task.installed[file.relative])
    // Validate every destination before changing anything. Never erase subsequent user edits.
    for (const file of applied) {
      if (!fs.existsSync(file.local) || hashBackupFile(file.local) !== task.installed[file.relative]) throw new Error('恢复后文件已变化，不能自动回退：' + file.relative)
      if (file.version !== 'missing' && !fs.existsSync(path.join(directory(task.id), 'files', file.relative))) throw new Error('恢复前副本已不存在')
    }
    task.state = 'recovery-required'; save(task)
    for (const file of applied.reverse()) {
      if (file.version === 'missing') fs.unlinkSync(file.local)
      else {
        const temp = file.local + '.' + crypto.randomUUID() + '.oltmp'
        fs.copyFileSync(path.join(directory(task.id), 'files', file.relative), temp); fs.renameSync(temp, file.local)
      }
      delete task.installed[file.relative]; save(task)
    }
    task.installed = {}; task.state = 'rolled-back'; save(task)
  }
  function rollbackRestoreTask(id: string) {
    if (isCloudRestoreActive() || isCloudBackupRunning()) throw new Error('请等待当前备份、校验或恢复完成')
    if (controllers.size) throw new Error('请先等待当前恢复结束')
    const task = readRestoreTask(id)
    if (!task.keepCopies && task.state !== 'recovery-required') throw new Error('此任务未保留恢复前副本')
    if (task.state === 'recovery-required') {
      // A crash can occur between replacing a file and writing its journal entry.
      for (const file of task.files) {
        const staged = path.join(directory(id), 'stage', file.relative)
        if (!task.installed[file.relative] && file.action !== 'skip' && fs.existsSync(staged) && fs.existsSync(file.local) && hashBackupFile(file.local) === hashBackupFile(staged) && backupFileVersion(file.local) !== file.version) task.installed[file.relative] = hashBackupFile(staged)
      }
    }
    if (global.lx.pauseForRestore) { global.lx.restoreMaintenance = true; global.lx.pauseForRestore() }
    rollback(task)
    return { restartRequired: true }
  }
  function deleteRestoreTask(id: string) {
    const task = readRestoreTask(id)
    if (controllers.has(id) || ['committing', 'recovery-required'].includes(task.state)) throw new Error('任务仍在运行或等待故障恢复，不能删除')
    const dir = directory(id)
    if (path.dirname(dir) !== root()) throw new Error('任务目录无效')
    fs.rmSync(dir, { recursive: true, force: true })
  }

  /** Downloads are restartable at file boundaries; local files are touched only after all downloads pass. */
  async function executeRestoreTransaction(input: {
    files: RestoreFile[]; source: string; options: any; keepCopies: boolean; resumeId?: string
    download: (file: RestoreFile, target: string, signal: AbortSignal) => Promise<void>
    merge: (file: RestoreFile, staged: string) => void
  }) {
    let task: RestoreTask
    if (input.resumeId) {
      task = readRestoreTask(input.resumeId)
      if (!['pending', 'failed', 'cancelled', 'interrupted', 'rolled-back'].includes(task.state)) throw new Error('任务不可继续；中断的提交需先回退')
      if (task.state !== 'pending' && task.files.length && (task.source !== input.source || JSON.stringify(task.files.map(f => [f.relative, f.remote, f.size, f.hash])) !== JSON.stringify(input.files.map(f => [f.relative, f.remote, f.size, f.hash])))) throw new Error('备份内容已变化，不能继续旧任务')
      task.source = input.source
      task.files = input.files; task.options = input.options; task.errors = []; task.installed = {}; task.keepCopies = input.keepCopies
    } else {
      task = { id: crypto.randomUUID(), state: 'downloading', createdAt: Date.now(), updatedAt: Date.now(), source: input.source, options: input.options, files: input.files, downloaded: [], installed: {}, errors: [], keepCopies: input.keepCopies, bytes: 0 }
    }
    validateTargets(task)
    const controller = new AbortController(); controllers.set(task.id, controller)
    pendingTasks.delete(task.id)
    task.state = 'downloading'; save(task)
    let applied = false
    try {
      for (const file of task.files) {
        if (file.action === 'skip') continue
        controller.signal.throwIfAborted()
        const target = path.join(directory(task.id), 'stage', file.relative)
        task.downloadedHashes ??= {}
        const expectedHash = file.hash || task.downloadedHashes[file.relative]
        const reusable = task.downloaded.includes(file.relative) && !!expectedHash && fs.existsSync(target) && fs.statSync(target).size === file.size && hashBackupFile(target) === expectedHash
        if (!reusable) {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          await input.download(file, target, controller.signal)
        }
        task.downloadedHashes[file.relative] = hashBackupFile(target)
        if (!task.downloaded.includes(file.relative)) task.downloaded.push(file.relative)
        task.bytes = task.files.filter(f => task.downloaded.includes(f.relative)).reduce((n, f) => n + f.size, 0)
        save(task)
      }
      controller.signal.throwIfAborted()
      if (!task.files.some(file => file.action !== 'skip')) { task.state = 'completed'; save(task); return { taskId: task.id, restored: 0, backupDir: '', errors: [] as string[] } }
      task.state = 'ready'; save(task)
      for (const file of task.files.filter(f => f.action !== 'skip')) if (backupFileVersion(file.local) !== file.version) throw new Error('本地数据在下载期间发生变化，未替换任何文件：' + file.relative)
      // No await from this point through commit/rollback: other JS writers cannot interleave.
      if (global.lx.pauseForRestore) { global.lx.restoreMaintenance = true; global.lx.pauseForRestore() }
      for (const file of task.files.filter(f => f.action !== 'skip')) {
        if (file.version !== 'missing') {
          const original = path.join(directory(task.id), 'files', file.relative)
          fs.mkdirSync(path.dirname(original), { recursive: true }); fs.copyFileSync(file.local, original)
        }
        if (file.action === 'merge') input.merge(file, path.join(directory(task.id), 'stage', file.relative))
      }
      fs.writeFileSync(path.join(directory(task.id), 'manifest.json'), JSON.stringify({ createdAt: task.createdAt, source: task.source, files: task.files.filter(f => f.action !== 'skip' && f.version !== 'missing').map(f => ({ path: f.relative, local: f.local })) }, null, 2))
      task.state = 'committing'; save(task)
      for (const file of task.files.filter(f => f.action !== 'skip')) {
        if (backupFileVersion(file.local) !== file.version) throw new Error('提交期间本地文件已变化：' + file.relative)
        fs.mkdirSync(path.dirname(file.local), { recursive: true })
        const temp = file.local + '.' + crypto.randomUUID() + '.oltmp'
        const staged = path.join(directory(task.id), 'stage', file.relative)
        const hash = hashBackupFile(staged)
        try { fs.copyFileSync(staged, temp); fs.renameSync(temp, file.local) } finally { fs.rmSync(temp, { force: true }) }
        task.installed[file.relative] = hash; applied = true; save(task)
      }
      task.state = 'completed'; save(task)
      if (!task.keepCopies) fs.rmSync(path.join(directory(task.id), 'files'), { recursive: true, force: true })
      return { taskId: task.id, restored: Object.keys(task.installed).length, backupDir: task.keepCopies ? directory(task.id) : '', errors: [] as string[] }
    } catch (error: any) {
      task.errors.push(error?.message || String(error))
      if (applied) {
        try { rollback(task) } catch (e: any) { task.errors.push('自动回退失败：' + e.message); task.state = 'recovery-required'; save(task); return { taskId: task.id, restored: Object.keys(task.installed).length, backupDir: directory(task.id), errors: task.errors } }
      }
      task.state = controller.signal.aborted ? 'cancelled' : 'failed'; save(task)
      return { taskId: task.id, restored: 0, backupDir: directory(task.id), errors: task.errors }
    } finally { controllers.delete(task.id) }
  }

  return { hasInterruptedRestore, readRestoreTask, listRestoreTasks, cancelRestoreTask, createPendingRestoreTask, failRestoreTask, rollbackRestoreTask, deleteRestoreTask, executeRestoreTransaction }
}
