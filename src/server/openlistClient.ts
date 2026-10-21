/**
 * OpenList / alist 存储客户端（音频备份专用）。
 * 契约已对真实实例(天翼云盘 tyCloud 挂载)实测确认：
 *  - 登录 POST /api/auth/login -> data.token
 *  - 上传 PUT /api/fs/put（file-path 头 + 原始字节体），部分构建写完文件仍返 500，
 *    因此成功与否以 getInfo 轮询确认文件存在为准
 *  - 校验/直链 POST /api/fs/get -> { raw_url, size, name }
 *  - 建目录 POST /api/fs/mkdir；删除 POST /api/fs/remove
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

export interface OpenListClientConfig {
  endpoint: string
  username: string
  password: string
  token?: string
  root?: string
}

export interface OpenListFileInfo {
  size: number
  rawUrl?: string
  openlistUrl?: string
  name?: string
  modified?: string
}

const encodePath = (p: string) => p.split('/').map((s) => encodeURIComponent(s)).join('/')

// 请求超时：防止连接挂起导致上传/下载永久卡死（曾出现大量 uploading/pending 孤儿记录）
const META_TIMEOUT_MS = 30_000
const TRANSFER_TIMEOUT_MS = 300_000

// OpenList 的 last-modified 期望 Go 参考布局 "Jan 2, 2006 15:04:05 PM -07"，否则部分构建 PUT 返回 500
function goTime(d = new Date()): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
  const p = (n: number) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')
  const om = String(Math.abs(off) % 60).padStart(2, '0')
  return `${M} ${d.getDate()}, ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} PM ${sign}${oh}${om}`
}

export class OpenListClient {
  private endpoint: string
  private username: string
  private password: string
  private directToken?: string
  private root: string
  private token: string | null = null

  constructor(cfg: OpenListClientConfig) {
    this.endpoint = (cfg.endpoint || '').replace(/\/+$/, '')
    this.username = cfg.username || ''
    this.password = cfg.password || ''
    this.directToken = cfg.token || undefined
    this.root = (cfg.root || '/').replace(/\/+$/, '') || '/'
  }

  private async ensureToken(): Promise<string> {
    if (this.directToken) return this.directToken
    if (this.token) return this.token
    const resp = await fetch(`${this.endpoint}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const data: any = await resp.json().catch(() => ({}))
    if (data?.code !== 200 || !data?.data?.token) {
      throw new Error('OpenList 登录失败：' + (data?.message || resp.status))
    }
    this.token = data.data.token
    return this.token!
  }

  private authHeader(): Record<string, string> {
    return { Authorization: this.token || this.directToken || '' }
  }

  /** 拼接完整远端路径：root + 相对路径 */
  resolveRemotePath(relativePath: string): string {
    const rel = relativePath.replace(/^\/+/, '')
    return `${this.root}/${rel}`.replace(/\/+/g, '/')
  }

  async listDir(p: string): Promise<any> {
    await this.ensureToken()
    const resp = await fetch(`${this.endpoint}/api/fs/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader() },
      body: JSON.stringify({ path: p, password: '', page: 1, per_page: 100 }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const data: any = await resp.json().catch(() => ({}))
    if (data?.code !== 200) throw new Error('OpenList 列目录失败：' + (data?.message || resp.status))
    return data.data || {}
  }

  async mkdir(dir: string): Promise<void> {
    await this.ensureToken()
    const resp = await fetch(`${this.endpoint}/api/fs/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader() },
      body: JSON.stringify({ path: dir }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const data: any = await resp.json().catch(() => ({}))
    if (data?.code !== 200 && !String(data?.message || '').toLowerCase().includes('exist')) {
      throw new Error('OpenList 创建目录失败：' + (data?.message || resp.status))
    }
  }

  private async pollFileInfo(remotePath: string, timeoutMs = 30_000): Promise<OpenListFileInfo | null> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const info = await this.getFileInfo(remotePath)
        if (info && info.size != null) return info
      } catch { /* 尚未就绪，继续轮询 */ }
      await new Promise((r) => setTimeout(r, 1000))
    }
    return null
  }

  /**
   * 上传本地文件到完整远端路径(remotePath)。
   * 采用 OpenList PUT + file-path 头 + 原始字节体；以 getInfo 确认落盘，规避服务端 500-on-success。
   */
  async upload(localPath: string, remotePath: string, signal?: AbortSignal): Promise<OpenListFileInfo> {
    await this.ensureToken()
    const buf = await fs.promises.readFile(localPath)
    const headers: Record<string, string> = {
      ...this.authHeader(),
      'Content-Type': 'application/octet-stream',
      // HTTP 头值必须是 Latin-1(ByteString)，含中文等非 ASCII 路径需先按 UTF-8 字节映射为 Latin-1，
      // 服务端再以 UTF-8 还原，否则 fetch 会抛 "Cannot convert argument to a ByteString" 导致上传失败。
      'file-path': Buffer.from(remotePath, 'utf8').toString('latin1'),
      overwrite: 'true',
      password: '',
      'last-modified': goTime(),
    }
    const resp = await fetch(`${this.endpoint}/api/fs/put`, {
      method: 'PUT',
      headers,
      body: buf,
      signal: signal ?? AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    })
    const text = await resp.text()
    let data: any = {}
    try { data = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
    const info = await this.pollFileInfo(remotePath)
    if (info && info.size != null) {
      return { ...info, name: info.name || path.basename(remotePath) }
    }
    throw new Error('OpenList 上传失败：' + (data?.message || resp.status) + ' | body=' + text.slice(0, 300))
  }

  async getFileInfo(remotePath: string): Promise<OpenListFileInfo> {
    await this.ensureToken()
    const resp = await fetch(`${this.endpoint}/api/fs/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader() },
      body: JSON.stringify({ path: remotePath, password: '' }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const data: any = await resp.json().catch(() => ({}))
    if (data?.code !== 200) throw new Error('OpenList 获取文件信息失败：' + (data?.message || resp.status))
    const d = data.data || {}
    return {
      size: Number(d.size ?? 0),
      rawUrl: d.raw_url || undefined,
      openlistUrl: `${this.endpoint}/d/${encodePath(remotePath.replace(/^\/+/, ''))}`,
      name: d.name,
      modified: d.modified || undefined,
    }
  }

  async remove(remotePath: string): Promise<void> {
    await this.ensureToken()
    const dir = path.posix.dirname(remotePath)
    const name = path.posix.basename(remotePath)
    const resp = await fetch(`${this.endpoint}/api/fs/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader() },
      body: JSON.stringify({ dir, names: [name] }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const data: any = await resp.json().catch(() => ({}))
    if (data?.code !== 200) throw new Error('OpenList 删除失败：' + (data?.message || resp.status))
  }

  /**
   * 校验可用性：强制重新登录 + 列根目录，确认账号可用且可达。
   * 失败抛出带中文说明的错误；成功返回 true。
   */
  async testConnection(timeoutMs = 15000): Promise<boolean> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      this.token = null
      await this.ensureToken()
      await this.listDir(this.root)
      return true
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 递归列出远端目录下所有条目（含子目录），返回扁平文件列表。
   * 用于双向同步/下载时比对本地与远端差异。
   */
  async listFilesRecursive(remotePath: string, depth = 0, maxDepth = 10): Promise<Array<{ path: string; name: string; size: number; modified: string; isDir: boolean }>> {
    if (depth > maxDepth) return []
    const data: any = await this.listDir(remotePath)
    const content: any[] = data?.content || []
    const out: Array<{ path: string; name: string; size: number; modified: string; isDir: boolean }> = []
    for (const item of content) {
      const full = item.path || `${remotePath}/${item.name}`
      const isDir = !!item.is_dir
      out.push({ path: full, name: item.name, size: Number(item.size || 0), modified: item.modified || '', isDir })
      if (isDir) out.push(...(await this.listFilesRecursive(full, depth + 1, maxDepth)))
    }
    return out
  }

  /**
   * 下载远端文件到本地路径（经由 getInfo 拿到的直链 raw_url 流式写入）。
   */
  async download(remotePath: string, localPath: string, signal?: AbortSignal): Promise<void> {
    await this.ensureToken()
    const info = await this.getFileInfo(remotePath)
    const url = info.rawUrl
    if (!url) throw new Error('OpenList 无法获取下载直链：' + remotePath)
    const resp = await fetch(url, { signal: signal ?? AbortSignal.timeout(TRANSFER_TIMEOUT_MS) })
    if (!resp.ok) throw new Error('OpenList 下载失败：' + resp.status)
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(localPath)
      const rs = Readable.fromWeb(resp.body as any)
      rs.on('error', reject)
      ws.on('error', reject)
      ws.on('finish', () => resolve())
      rs.pipe(ws)
    })
  }
}
