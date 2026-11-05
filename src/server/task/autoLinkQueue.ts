import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const SOURCES = ['tx', 'wy', 'kg', 'kw', 'mg']
export const DEFAULT_CONCURRENCY = 2
const MAX_CONCURRENCY = 4
const ACTIVE_STATES = ['waiting', 'identifying', 'searching', 'linking']
export interface LinkItem {
  filename: string; folder: string; name?: string; singer?: string; interval?: string | number; source?: string; songmid?: string
  img?: string; hasCover?: boolean; quality?: string; mtime?: number; size?: number
  coverCheckedVersion?: number; coverCheckedMtime?: number; coverCheckedSize?: number
}
interface SongState extends LinkItem { key: string; status: string; message: string; searchSource?: string; matchedSource?: string; coverFilename?: string }
export const itemKey = (item: LinkItem) => JSON.stringify([item.folder, item.filename])
export const isUnlinked = (item: LinkItem) => !item.source || ['unknown', 'local'].includes(item.source) || String(item.songmid || '').includes(' - ') || !item.name || item.name === '未知歌曲'
export const seconds = (value: unknown): number => {
  const parts = String(value || '').split(':').map(Number)
  return parts.every(n => Number.isFinite(n) && n >= 0) ? parts.reduce((n, v) => n * 60 + v, 0) : 0
}
interface Dependencies {
  list: (username: string, custom: boolean) => Promise<LinkItem[]>
  identify: (username: string, item: LinkItem) => Promise<any[]>
  search: (keyword: string, source: string) => Promise<any[]>
  link: (username: string, item: LinkItem, match: any) => Promise<unknown>
}
interface Task {
  id: string; status: string; sources: string[]; custom: boolean; location: string
  total: number; processed: number; linked: number; failed: number
  current: string; phase: string; error: string; results: SongState[]; updatedAt: number; concurrency: number
}

// Only the latest task per account is retained; no auth credentials are stored.
export class AutoLinkQueue {
  private tasks = new Map<string, Task>()
  private starting = new Set<string>()
  private runtimeDir: () => string
  private deps: Dependencies
  constructor(runtimeDir: () => string, deps: Dependencies) {
    this.runtimeDir = runtimeDir
    this.deps = deps
  }
  private file(user: string) {
    return path.join(this.runtimeDir(), 'auto-link', crypto.createHash('sha256').update(user).digest('hex') + '.json')
  }
  private save(user: string, task: Task) {
    task.updatedAt = Date.now()
    const file = this.file(user)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify(task), 'utf8')
    fs.renameSync(file + '.tmp', file)
  }
  private get(user: string) {
    if (!this.tasks.has(user) && fs.existsSync(this.file(user))) {
      const task: Task = JSON.parse(fs.readFileSync(this.file(user), 'utf8'))
      task.concurrency ||= DEFAULT_CONCURRENCY
      task.results.forEach(row => { row.key ||= itemKey(row) })
      if (['running', 'cancelling'].includes(task.status)) {
        task.status = 'interrupted'
        task.current = ''
        task.error = '服务已重启，任务中断。请重新选择剩余未链接歌曲。'
        task.results.forEach(row => {
          if (ACTIVE_STATES.includes(row.status)) { row.status = 'interrupted'; row.message = '服务重启，处理已中断' }
        })
        this.save(user, task)
      }
      this.tasks.set(user, task)
    }
    return this.tasks.get(user)
  }
  status(user: string, offset = 0, limit = 200) {
    const task = this.get(user)
    if (!task) return { status: 'idle', results: [], nextOffset: 0, resultTotal: 0 }
    const start = Number.isFinite(offset) ? Math.min(task.results.length, Math.max(0, Math.floor(offset))) : 0
    const size = Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.floor(limit))) : 200
    const results = task.results.slice(start, start + size).map(row => ({ ...row }))
    return { ...task, results, resultTotal: task.results.length, nextOffset: start + results.length }
  }
  async candidates(user: string, custom: boolean) {
    return (await this.deps.list(user, custom)).filter(isUnlinked).map(item => ({ ...item, key: itemKey(item) }))
  }
  async start(user: string, keys: unknown, sources: unknown, custom: boolean, location: string, concurrency: unknown = DEFAULT_CONCURRENCY) {
    if (this.starting.has(user) || ['running', 'cancelling'].includes(this.get(user)?.status || '')) throw new Error('已有智能检测任务正在运行')
    if (!Array.isArray(sources) || !sources.length || sources.some(s => !SOURCES.includes(s))) throw new Error('请至少选择一个有效平台')
    if (!Array.isArray(keys) || !keys.length || keys.length > 10000 || keys.some(k => typeof k !== 'string')) throw new Error('请选择 1 至 10000 首未链接歌曲')
    if (typeof concurrency !== 'number' || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new Error('识别并发数必须是 1 至 4 的整数')
    this.starting.add(user)
    try {
      const selected = new Set(keys)
      const items = (await this.candidates(user, custom)).filter(item => selected.has(item.key))
      if (items.length !== selected.size) throw new Error('歌曲状态已变化，请刷新待检测列表')
      const task: Task = { id: crypto.randomUUID(), status: 'running', sources: [...new Set(sources)], custom, location,
        total: items.length, processed: 0, linked: 0, failed: 0, current: '', phase: '', error: '', concurrency,
        results: items.map(item => ({ ...item, status: 'waiting', message: '等待识别' })), updatedAt: Date.now() }
      this.save(user, task)
      this.tasks.set(user, task)
      void this.run(user, task, items).catch(error => {
        task.status = 'error'
        task.error = error.message || String(error)
        try { this.save(user, task) } catch (e) { console.error('[AutoLink] 保存任务失败', e) }
      })
      return this.status(user)
    } finally { this.starting.delete(user) }
  }
  cancel(user: string) {
    const task = this.get(user)
    if (task?.status === 'running') {
      task.status = 'cancelling'
      this.save(user, task)
    }
    return this.status(user)
  }
  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('请求超时')), 30000)
      })])
    } finally { clearTimeout(timer) }
  }
  private async run(user: string, task: Task, items: LinkItem[]) {
    let cursor = 0
    // Fingerprints/searches run in parallel, but file/index writes are serialized.
    let linkTail = Promise.resolve()
    const serializeLink = async (operation: () => Promise<void>) => {
      const work = linkTail.then(operation)
      linkTail = work.catch(() => {})
      return await work
    }
    const worker = async () => {
      while (task.status === 'running' && cursor < items.length) {
        const index = cursor++
        await this.processSong(user, task, items[index], task.results[index], serializeLink)
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(task.concurrency, items.length) }, () => worker().catch(error => {
        task.status = 'error'
        task.error = error.message || String(error)
      })))
    } finally {
      if (task.status !== 'error') task.status = task.status === 'cancelling' ? 'cancelled' : 'completed'
      for (const row of task.results) {
        if (ACTIVE_STATES.includes(row.status)) {
          row.status = task.status === 'error' ? 'interrupted' : 'cancelled'
          row.message = task.status === 'error' ? '任务异常，处理已中断' : '已停止，未完成关联'
        }
      }
      task.current = ''
      task.phase = ''
      this.save(user, task)
    }
  }
  private async processSong(user: string, task: Task, item: LinkItem, row: SongState,
    serializeLink: (operation: () => Promise<void>) => Promise<void>) {
    const update = (status: string, message: string) => {
      row.status = status
      row.message = message
      this.save(user, task)
    }
    update('identifying', '正在识别声学指纹……')
    try {
      const duration = seconds(item.interval)
      if (!duration) throw new Error('缺少有效时长，请先补全歌曲信息')
      let identified: any
      try { identified = (await this.bounded(this.deps.identify(user, item)))[0] } catch { /* Keyword fallback */ }
      if (task.status !== 'running') return
      const unknown = (s?: string) => !s || ['未知歌曲', '未知歌手', 'unknown'].includes(s.toLowerCase())
      const keyword = unknown(item.name) ? item.filename.replace(/\.[^/.]+$/, '').replace(/^[0-9\-_\s]+/, '')
        : `${item.name} ${unknown(item.singer) ? '' : item.singer}`.trim()
      const queries = [...(identified ? [{ text: `${identified.singer} ${identified.name}`, tolerance: 3 }] : []), { text: keyword, tolerance: 2 }]
      const errors: string[] = []
      const names: Record<string, string> = { tx: 'QQ 音乐', wy: '网易云音乐', kg: '酷狗音乐', kw: '酷我音乐', mg: '咪咕音乐' }
      let match: any
      for (const query of queries) {
        for (const source of task.sources) {
          if (task.status !== 'running') return
          row.searchSource = source
          update('searching', `正在搜索 ${names[source]} · ${query.text}`)
          try {
            const results = await this.bounded(this.deps.search(query.text, source))
            match = results.find(r => seconds(r.interval) > 0 && Math.abs(seconds(r.interval) - duration) <= query.tolerance)
            if (match) { match = { ...match, source }; break }
          } catch (e: any) { errors.push(`${source}: ${e.message}`) }
        }
        if (match) break
      }
      if (task.status !== 'running') return
      if (match) {
        update('linking', '等待关联并写入歌曲信息……')
        await serializeLink(async () => {
          if (task.status !== 'running') return
          const current = (await this.deps.list(user, task.custom)).find(i => itemKey(i) === itemKey(item))
          if (!current || !isUnlinked(current)) throw new Error('歌曲已被关联或已不存在')
          if (task.status !== 'running') return
          update('linking', '正在链接歌曲并更新元数据……')
          const linked: any = await this.deps.link(user, item, match)
          if (linked?.success === false) throw new Error(linked.message || '关联失败')
          row.matchedSource = match.source
          row.source = match.source
          if (match.name) row.name = match.name
          if (match.singer) row.singer = match.singer
          if (match.img) row.img = match.img
          if (linked?.filename) row.coverFilename = linked.filename
          task.linked++
          task.processed++
          update('linked', `已关联 ${match.singer || ''} - ${match.name || ''}`)
        })
      } else {
        task.failed++
        task.processed++
        update('failed', errors.length ? `未找到匹配；部分平台请求失败：${errors.join('；')}` : '未找到时长符合的歌曲，建议手动关联')
      }
    } catch (e: any) {
      task.failed++
      task.processed++
      update('failed', e.message || String(e))
    }
  }
}
