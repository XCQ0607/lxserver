import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { OpenListClient, OpenListNotFoundError } from './openlistClient'

export interface IntegrityFile {
  key: string; name: string; remote: string; user: string; type: string
  size: number; hash: string | null; version: string; changedAt?: number
}
type Result = IntegrityFile & { result: string; checkedAt: number; error?: string; remoteModified?: string; actualHash?: string }
interface Job { id: string; sourceId: string; state: string; total: number; done: number; bytes: number; estimatedBytes: number; current: string; createdAt: number; results: Result[] }
interface Store { results: Record<string, Result>; job?: Job }
let controller: AbortController | undefined
let activePath = ''
const plans = new Map<string, { expires: number; signature: string; files: IntegrityFile[]; source: string }>()
const storePath = () => path.join(global.lx.dataPath, 'runtime', 'openlist-integrity.json')
function load(): Store {
  try {
    const store = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Store
    if (store.job?.state === 'running' && (!controller || activePath !== storePath())) store.job.state = 'interrupted'
    return store
  } catch (e: any) { if (e.code === 'ENOENT') return { results: {} }; throw e }
}
function save(store: Store) {
  const file = storePath(); fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(store), { mode: 0o600 }); fs.renameSync(file + '.tmp', file)
}
const fingerprint = (file: IntegrityFile, source: string) => crypto.createHash('sha256').update(JSON.stringify([source, file.remote, file.size, file.hash, file.version])).digest('hex')
const sourceId = (source: string) => crypto.createHash('sha256').update(source).digest('hex')
export function integrityStatus(files: IntegrityFile[], source: string) {
  const store = load(), current = new Map(files.map(f => [fingerprint(f, source), f]))
  return { job: store.job?.sourceId === sourceId(source) ? store.job : null, results: Object.entries(store.results).filter(([key]) => current.has(key)).map(([key, result]) => { const file = current.get(key); return file?.changedAt && file.changedAt > result.checkedAt ? { ...result, result: 'stale' } : result }).sort((a, b) => b.checkedAt - a.checkedAt) }
}
export function prepareIntegrity(files: IntegrityFile[], source: string, options: { type?: string; user?: string; scope?: string }) {
  if (controller) throw new Error('已有内容校验任务正在执行')
  if (options.scope && !['changed', 'all', 'problems'].includes(options.scope)) throw new Error('校验范围无效')
  const store = load()
  const selected = files.filter(f => (!options.type || f.type === options.type) && (!options.user || f.user === options.user)).filter(f => {
    const old = store.results[fingerprint(f, source)]
    return options.scope === 'all' || (options.scope === 'problems' ? old && (old.result !== 'matched' || !!f.changedAt && f.changedAt > old.checkedAt) : !old || old.result !== 'matched' || !!f.changedAt && f.changedAt > old.checkedAt)
  })
  const token = crypto.randomUUID()
  const signature = JSON.stringify(files)
  for (const [key, plan] of plans) if (plan.expires < Date.now()) plans.delete(key)
  plans.set(token, { expires: Date.now() + 15 * 60_000, signature, files: selected, source })
  return { token, total: selected.length, bytes: selected.filter(f => f.hash).reduce((n, f) => n + f.size, 0), unknown: selected.filter(f => !f.hash).length }
}
export function startIntegrity(cl: OpenListClient, files: IntegrityFile[], source: string, token: string, release: () => void) {
  if (controller) throw new Error('已有内容校验任务正在执行')
  const plan = plans.get(token)
  if (!plan || plan.expires < Date.now() || plan.source !== source || plan.signature !== JSON.stringify(files)) throw new Error('备份记录已变化或预览已过期，请重新预览')
  if (!plan.files.length) throw new Error('没有需要校验的文件')
  plans.delete(token)
  const store = load()
  const job: Job = { id: crypto.randomUUID(), sourceId: sourceId(source), state: 'running', total: plan.files.length, done: 0, bytes: 0, estimatedBytes: plan.files.filter(f => f.hash).reduce((n, f) => n + f.size, 0), current: '', createdAt: Date.now(), results: [] }
  store.job = job; save(store)
  const abort = new AbortController(); controller = abort; activePath = storePath()
  void (async () => {
    try {
      for (const file of plan.files) {
        abort.signal.throwIfAborted(); job.current = file.name; save(store)
        const result: Result = { ...file, result: 'unavailable', checkedAt: Date.now() }
        try {
          if (!file.hash) result.error = '缺少该次备份的 SHA-256，不能用当前本地文件冒充上传基线；请重新备份以建立基线'
          else {
            const before = await cl.getFileInfo(file.remote, abort.signal)
            if (before.size !== file.size) { result.result = 'mismatch'; result.error = '云端大小与备份记录不一致' }
            else {
              let lastSaved = Date.now()
              const actual = await cl.hashRemoteFile(file.remote, abort.signal, bytes => {
                job.bytes += bytes
                if (Date.now() - lastSaved > 500) { save(store); lastSaved = Date.now() }
              })
              const after = await cl.getFileInfo(file.remote, abort.signal)
              if (before.size !== after.size || before.modified !== after.modified) throw new Error('校验期间云端文件发生变化，请重试')
              result.remoteModified = after.modified; result.actualHash = actual
              result.result = actual === file.hash ? 'matched' : 'mismatch'
              if (result.result === 'mismatch') result.error = '云端 SHA-256 与该次备份记录不一致'
            }
          }
        } catch (e: any) {
          if (abort.signal.aborted) throw e
          result.result = e instanceof OpenListNotFoundError ? 'missing' : 'error'; result.error = e.message
        }
        result.checkedAt = Date.now(); job.results.push(result); job.done++
        store.results[fingerprint(file, source)] = result; save(store)
      }
      job.state = 'completed'
    } catch (e: any) { job.state = abort.signal.aborted ? 'cancelled' : 'failed'; job.current = e.message }
    finally { if (job.state !== 'failed') job.current = ''; try { save(store) } finally { controller = undefined; activePath = ''; release() } }
  })().catch(error => console.error('[OpenList] 校验任务记录写入失败:', error))
  return { jobId: job.id }
}
export function cancelIntegrity() { if (!controller) throw new Error('没有正在运行的内容校验'); controller.abort(new Error('用户停止校验')) }
