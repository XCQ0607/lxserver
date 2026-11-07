/**
 * OpenList / alist 存储客户端（音频备份专用）。
 * 契约已对真实实例(天翼云盘 tyCloud 挂载)实测确认：
 *  - 登录 POST /api/auth/login -> data.token
 *  - 上传 PUT /api/fs/put（file-path 头 + 原始字节体），成功响应后用元信息确认大小。
 *    明确报错不凭旧同名文件认定成功；普通上传不回读正文。
 *  - 校验/直链 POST /api/fs/get -> { raw_url, size, name }
 *  - 建目录 POST /api/fs/mkdir；删除 POST /api/fs/remove
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { hashBackupFile } from '@/utils/backupFiles'

export interface OpenListClientConfig {
  endpoint: string
  username: string
  password: string
  token?: string
  root?: string
}

export interface OpenListFileInfo {
  size?: number
  rawUrl?: string
  openlistUrl?: string
  name?: string
  modified?: string
  sha256?: string
}

export class OpenListNotFoundError extends Error {}

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

  private async ensureToken(signal?: AbortSignal): Promise<string> {
    if (this.directToken) return this.directToken
    if (this.token) return this.token
    const resp = await fetch(`${this.endpoint}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
      signal: signal ?? AbortSignal.timeout(META_TIMEOUT_MS),
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

  private async request(route: string, init: RequestInit, bodyFactory?: () => any): Promise<Response> {
    await this.ensureToken(init.signal || undefined)
    const send = () => fetch(`${this.endpoint}${route}`, { ...init, ...(bodyFactory ? { body: bodyFactory() } : {}), headers: { ...init.headers, ...this.authHeader() } })
    const response = await send()
    const data: any = await response.clone().json().catch(() => ({}))
    if (!this.directToken && (response.status === 401 || data.code === 401)) {
      await response.body?.cancel()
      this.token = null
      await this.ensureToken(init.signal || undefined)
      return send()
    }
    return response
  }

  /** 拼接完整远端路径：root + 相对路径 */
  resolveRemotePath(relativePath: string): string {
    const rel = relativePath.replace(/^\/+/, '')
    return `${this.root}/${rel}`.replace(/\/+/g, '/')
  }

  async listDir(p: string, signal?: AbortSignal): Promise<any> {
    await this.ensureToken(signal)
    const all: any[] = []
    let page = 1
    const perPage = 100
    let last: any = {}
    let total = 0
    // 按 total 分页累积所有条目，避免单页(默认 100)截断导致 listFilesRecursive 漏文件
    do {
      const resp = await this.request('/api/fs/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeader() },
        body: JSON.stringify({ path: p, password: '', page, per_page: perPage }),
        signal: signal ?? AbortSignal.timeout(META_TIMEOUT_MS),
      })
      const data: any = await resp.json().catch(() => ({}))
      if (resp.status === 404 || data?.code === 404 || (data?.code !== 200 && /object not found|no such file/i.test(data?.message || ''))) throw new OpenListNotFoundError('OpenList 目录不存在：' + p)
      if (data?.code !== 200) throw new Error('OpenList 列目录失败：' + (data?.message || resp.status))
      const d = data.data || {}
      const items: any[] = d.content || []
      all.push(...items)
      last = d
      total = Number(d.total ?? all.length)
      if (!items.length) break
      page++
    } while (all.length < total)
    return { ...last, content: all, total: all.length }
  }

  async mkdir(dir: string): Promise<void> {
    await this.ensureToken()
    const resp = await this.request('/api/fs/mkdir', {
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

  private async pollFileInfo(remotePath: string, timeoutMs = 30_000, expectedSize?: number): Promise<OpenListFileInfo | null> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const info = await this.getFileInfo(remotePath)
        // 同时校验远端大小与本地预期大小，避免仅凭路径存在就认定上传完成
        if (info && info.size != null && (expectedSize == null || Number(info.size) === Number(expectedSize))) return info
      } catch { /* 尚未就绪，继续轮询 */ }
      await new Promise((r) => setTimeout(r, 1000))
    }
    return null
  }

  /**
   * 上传本地文件到完整远端路径(remotePath)。
   * 采用 OpenList PUT + file-path 头 + 原始字节体；成功响应后以 getInfo 确认大小。
   */
  async upload(localPath: string, remotePath: string, signal?: AbortSignal, baselineHash?: string): Promise<OpenListFileInfo> {
    await this.ensureToken()
    const expectedSize = (await fs.promises.stat(localPath)).size
    const expectedHash = hashBackupFile(localPath)
    if (baselineHash && baselineHash !== expectedHash) throw new Error('本地文件与待备份版本不一致，请重新备份')
    const headers: Record<string, string> = {
      ...this.authHeader(),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(expectedSize),
      // OpenList 对 File-Path 做 URL 解码。逐段编码同时兼容中文和文件名中的字面百分号，
      // 避免 %E... 被解码成另一个文件名，上传成功却永远轮询不到原路径。
      'file-path': encodePath(remotePath),
      overwrite: 'true',
      password: '',
      'last-modified': goTime(),
    }
    const resp = await this.request('/api/fs/put', {
      method: 'PUT',
      headers,
      duplex: 'half',
      signal: signal ?? AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
    } as RequestInit, () => fs.createReadStream(localPath))
    const text = await resp.text()
    let data: any = {}
    try { data = JSON.parse(text) } catch { /* 非 JSON 响应 */ }
    const code = Number(data?.code || resp.status)
    if (code !== 200) throw new Error('OpenList 上传被拒绝：' + (data?.message || code))
    const info = await this.pollFileInfo(remotePath, TRANSFER_TIMEOUT_MS, expectedSize)
    if (info && info.size != null) {
      if (hashBackupFile(localPath) !== expectedHash) {
        throw new Error('OpenList 上传期间本地文件发生变化')
      }
      return { ...info, name: info.name || path.basename(remotePath) }
    }
    throw new Error('OpenList 上传失败：' + (data?.message || resp.status) + ' | body=' + text.slice(0, 300))
  }

  async getFileInfo(remotePath: string, signal?: AbortSignal): Promise<OpenListFileInfo> {
    await this.ensureToken(signal)
    const resp = await this.request('/api/fs/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader() },
      body: JSON.stringify({ path: remotePath, password: '' }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(META_TIMEOUT_MS)]) : AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const data: any = await resp.json().catch(() => ({}))
    if (resp.status === 404 || data?.code === 404 || (data?.code !== 200 && /object not found|no such file/i.test(data?.message || ''))) throw new OpenListNotFoundError('OpenList 文件不存在：' + remotePath)
    if (data?.code !== 200) throw new Error('OpenList 获取文件信息失败：' + (data?.message || resp.status))
    const d = data.data || {}
    return {
      size: d.size != null ? Number(d.size) : undefined,
      rawUrl: d.raw_url || undefined,
      openlistUrl: `${this.endpoint}/d/${encodePath(remotePath.replace(/^\/+/, ''))}`,
      name: d.name,
      modified: d.modified || undefined,
      sha256: /^[a-f0-9]{64}$/i.test(d.hash_info?.sha256 || d.hash_info?.SHA256 || '') ? String(d.hash_info.sha256 || d.hash_info.SHA256).toLowerCase() : undefined,
    }
  }

  async remove(remotePath: string): Promise<void> {
    await this.ensureToken()
    const dir = path.posix.dirname(remotePath)
    const name = path.posix.basename(remotePath)
    const resp = await this.request('/api/fs/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeader() },
      body: JSON.stringify({ dir, names: [name] }),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const data: any = await resp.json().catch(() => ({}))
    if (data?.code !== 200) throw new Error('OpenList 删除失败：' + (data?.message || resp.status))
  }

  /** 删除唯一的本地副本前，校验远端实际字节，不能只相信同名文件的大小。 */
  async verifyFile(remotePath: string, expectedHash: string, signal?: AbortSignal): Promise<boolean> {
    return await this.hashRemoteFile(remotePath, signal) === expectedHash
  }

  async hashRemoteFile(remotePath: string, signal?: AbortSignal, onBytes?: (bytes: number) => void): Promise<string> {
    const info = await this.getFileInfo(remotePath, signal)
    if (info.sha256) return info.sha256
    if (!info.rawUrl) throw new Error('OpenList 文件没有下载地址')
    const resp = await fetch(info.rawUrl, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TRANSFER_TIMEOUT_MS)]) : AbortSignal.timeout(TRANSFER_TIMEOUT_MS) })
    if (!resp.ok || !resp.body) { await resp.body?.cancel(); throw new Error('OpenList 内容校验下载失败：' + resp.status) }
    const hash = createHash('sha256')
    for await (const chunk of Readable.fromWeb(resp.body as any)) { hash.update(chunk); onBytes?.(chunk.length) }
    return hash.digest('hex')
  }

  async readJSON(remotePath: string): Promise<any> {
    const info = await this.getFileInfo(remotePath)
    if (!info.rawUrl || info.size == null || info.size > 16 * 1024 * 1024) throw new Error('OpenList 恢复清单大小无效')
    const response = await fetch(info.rawUrl, { signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) })
    if (!response.ok || !response.body) throw new Error('OpenList 读取恢复清单失败')
    const parts: Buffer[] = []; let size = 0
    for await (const chunk of Readable.fromWeb(response.body as any)) {
      size += chunk.length
      if (size > 16 * 1024 * 1024) throw new Error('OpenList 恢复清单超过大小限制')
      parts.push(Buffer.from(chunk))
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
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
      await this.ensureToken(ctrl.signal)
      await this.listDir(this.root, ctrl.signal)
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
  async download(remotePath: string, localPath: string, signal?: AbortSignal, beforeReplace?: () => void, expectedHash?: string): Promise<void> {
    await this.ensureToken()
    const info = await this.getFileInfo(remotePath)
    const url = info.rawUrl
    if (!url) throw new Error('OpenList 无法获取下载直链：' + remotePath)
    // 先写入临时文件，全部落盘成功后再 rename，避免半截文件覆盖/残留
    const tmpPath = localPath + '.' + randomUUID() + '.oltmp'
    try {
      const resp = await fetch(url, { signal: signal ?? AbortSignal.timeout(TRANSFER_TIMEOUT_MS) })
      if (!resp.ok) throw new Error('OpenList 下载失败：' + resp.status)
      await pipeline(Readable.fromWeb(resp.body as any), fs.createWriteStream(tmpPath))
      if (info.size == null || (await fs.promises.stat(tmpPath)).size !== info.size) {
        throw new Error('OpenList 下载文件大小与远端不一致')
      }
      if (expectedHash && hashBackupFile(tmpPath) !== expectedHash) throw new Error('OpenList 下载内容 SHA-256 校验失败')
      beforeReplace?.()
      await fs.promises.rename(tmpPath, localPath)
    } catch (e) {
      await fs.promises.rm(tmpPath, { force: true }).catch(() => {})
      throw e
    }
  }
}
