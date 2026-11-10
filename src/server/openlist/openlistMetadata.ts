import { setTimeout as delay } from 'node:timers/promises'
import { openlistError } from './openlistErrors'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { OpenListClient, OpenListNotFoundError } from './openlistClient'

type Observation = { state: string; checkedAt: number; changedAt?: number; baseline: string; error?: string }
type Row = { id: number; local_path: string; remote_path: string; size: number | null; local_hash: string | null; local_mtime: number | null; remote_mtime: number | null }
type Job = { id: string; source: string; target: string; state: string; total: number; done: number; failed: number; startedAt: number; finishedAt?: number }
type Store = { observations: Record<string, Observation>; job?: Job }
let controller: AbortController | undefined
let cachedFile = '', cachedStore: Store | undefined
let lastWrite = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined
const location = () => path.join(global.lx.dataPath, 'runtime', 'openlist-metadata.json')
const key = (source: string, remote: string, side: string) => crypto.createHash('sha256').update(JSON.stringify([source, remote, side])).digest('hex')
export const metadataBaseline = (row: Row) => JSON.stringify([row.size, row.local_hash, row.remote_mtime])
function read(): Store {
  const file = location()
  if (cachedFile === file && cachedStore) return cachedStore
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined }
  cachedFile = file; cachedStore = undefined; lastWrite = 0
  try { cachedStore = JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error: any) { if (error.code === 'ENOENT') cachedStore = { observations: {} }; else throw error }
  return cachedStore!
}
function write(store: Store, force = false) {
  cachedStore = store
  if (!force && Date.now() - lastWrite < 500) {
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = undefined; if (cachedFile !== location()) return; try { write(store, true) } catch (error) { console.error('[OpenList] 保存检查结果失败', error) } }, 500)
    saveTimer?.unref()
    return
  }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined }
  const file = location(); fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(store), { mode: 0o600 }); fs.renameSync(file + '.tmp', file)
  lastWrite = Date.now()
}
export function metadataObservations(source: string) {
  const store = read()
  return (remote: string, side = 'remote') => store.observations[key(source, remote, side)]
}
export function recordRemoteObservation(source: string, row: Row, info?: { size?: number; modified?: string }, error?: any) {
  const store = read(), id = key(source, row.remote_path, 'remote'), baseline = metadataBaseline(row)
  const modified = info?.modified ? new Date(info.modified).getTime() : NaN
  const state = error ? error instanceof OpenListNotFoundError ? 'missing' : 'error'
    : info?.size == null ? 'unknown' : info.size !== row.size || Number.isFinite(modified) && row.remote_mtime != null && modified !== row.remote_mtime ? 'changed' : 'same'
  const previous = store.observations[id], checkedAt = Date.now()
  const changedAt = previous?.baseline === baseline && previous.changedAt ? previous.changedAt
    : ['changed', 'missing'].includes(state) ? checkedAt : undefined
  store.observations[id] = { state, checkedAt, changedAt, baseline, error: error ? String(error.message || error) : undefined }
  write(store)
}
export function metadataStatus(source: string) {
  const job = read().job
  return { job: job?.source === source ? { ...job, state: ['running', 'paused'].includes(job.state) && !controller ? 'interrupted' : job.state } : null }
}
export function cancelMetadata() { if (!controller) throw new Error('没有正在执行的文件检查'); controller.abort() }
export function startMetadata(source: string, rows: Row[], target: string, client: OpenListClient | null, ready?: () => Promise<boolean>) {
  if (controller) throw new Error('已有文件检查正在执行')
  if (!['local', 'remote', 'both'].includes(target)) throw new Error('检查位置无效')
  if (target !== 'local' && !client) throw new Error('请先启用并保存 OpenList 连接')
  if (!rows.length) throw new Error('没有需要检查的记录')
  const abort = controller = new AbortController()
  const job: Job = { id: crypto.randomUUID(), source, target, state: 'running', total: rows.length, done: 0, failed: 0, startedAt: Date.now() }
  try { const initial = read(); initial.job = job; write(initial, true) } catch (error) { controller = undefined; throw error }
  void (async () => {
    try {
      for (const row of rows) {
        if (target !== 'local' && ready) {
          while (!abort.signal.aborted && !await ready()) {
            job.state = 'paused'; const store = read(); store.job = job; write(store)
            try { await delay(1000, undefined, { signal: abort.signal }) } catch { break }
          }
          job.state = 'running'
        }
        if (abort.signal.aborted) break
        let failed = false
        if (target !== 'remote') {
          let state = 'missing', error: string | undefined
          try {
            const stat = await fs.promises.stat(row.local_path)
            state = !stat.isFile() ? 'missing' : row.local_mtime == null ? 'untracked' : stat.size !== row.size || stat.mtimeMs !== row.local_mtime ? 'changed' : 'same'
          } catch (e: any) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) { state = 'error'; error = e.message; failed = true } }
          if (state === 'missing') failed = true
          const store = read(); store.observations[key(source, row.remote_path, 'local')] = { state, error, checkedAt: Date.now(), baseline: metadataBaseline(row) }; write(store)
        }
        if (target !== 'local' && !abort.signal.aborted) {
          while (!abort.signal.aborted) {
            try {
              const info = await client!.getFileInfo(row.remote_path, AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]))
              recordRemoteObservation(source, row, info)
              break
            } catch (error) {
              if (abort.signal.aborted) break
              if (!ready || !openlistError(error).connection) {
                failed = true; recordRemoteObservation(source, row, undefined, error); break
              }
              // Retry the same row after recovery. Connection outages do not become file errors.
              job.state = 'paused'
              const store = read(); store.job = job; write(store)
              let recovered = false
              do {
                recovered = await ready()
                if (!recovered) try { await delay(1000, undefined, { signal: abort.signal }) } catch { break }
              } while (!abort.signal.aborted && !recovered)
              job.state = 'running'
            }
          }
          if (abort.signal.aborted) break
        }
        job.done++; if (failed) job.failed++
        const store = read(); store.job = job; write(store)
      }
      job.state = abort.signal.aborted ? 'cancelled' : 'completed'
    } catch { job.state = 'failed' }
    finally { job.finishedAt = Date.now(); try { const store = read(); store.job = job; write(store, true) } finally { controller = undefined } }
  })().catch(error => console.error('[OpenList] 文件检查状态保存失败', error))
  return { job }
}
