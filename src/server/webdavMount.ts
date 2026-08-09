import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as http from 'http'
import * as https from 'https'
import iconv from 'iconv-lite'
import { resolveHost } from './hostResolver'

const CONFIG_FILE = 'webdav-mounts.json'

export interface WebDAVMount {
  id: string
  name: string
  baseUrl: string
  username: string
  password: string
  rootPath: string
  enabled: boolean
  createdAt: number
}

interface WebDAVConfig {
  mounts: WebDAVMount[]
}

const defaultConfig: WebDAVConfig = { mounts: [] }

let config: WebDAVConfig = { mounts: [] }

const configPath = (): string => path.join(global.lx.dataPath, CONFIG_FILE)

const now = (): number => Date.now()

const normalizeWebdavUrl = (url?: string): string => {
  const trimmed = (url || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return 'http://' + trimmed
}

export const loadConfig = (): WebDAVConfig => {
  const p = configPath()
  if (fs.existsSync(p)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      config = { mounts: Array.isArray(parsed.mounts) ? parsed.mounts : [] }
    } catch (e) {
      config = { mounts: [] }
    }
  }
  return config
}

export const saveConfig = (): void => {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('[WebDAVMount] Failed to save config:', e)
  }
}

export const listMounts = (): WebDAVMount[] => {
  loadConfig()
  return config.mounts.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export const getMount = (id: string): WebDAVMount | null => {
  loadConfig()
  return config.mounts.find(m => m.id === id) || null
}

const normalizeMount = (data: any): WebDAVMount => {
  let baseUrl = String(data.baseUrl || '').trim().replace(/\/+$/, '')
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = 'http://' + baseUrl
  return {
    id: data.id || 'wd_' + crypto.randomBytes(6).toString('hex'),
    name: String(data.name || 'WebDAV').trim(),
    baseUrl,
    username: String(data.username || '').trim(),
    password: String(data.password || ''),
    rootPath: String(data.rootPath || '/').trim() || '/',
    enabled: data.enabled !== false,
    createdAt: data.createdAt || now(),
  }
}

export const addMount = (data: any): WebDAVMount => {
  loadConfig()
  if (!data.baseUrl) throw new Error('缺少 WebDAV 地址')
  const mount = normalizeMount(data)
  config.mounts.push(mount)
  saveConfig()
  return mount
}

export const updateMount = (id: string, data: any): WebDAVMount | null => {
  loadConfig()
  const idx = config.mounts.findIndex(m => m.id === id)
  if (idx < 0) return null
  const merged = normalizeMount({ ...config.mounts[idx], ...data, id })
  config.mounts[idx] = merged
  saveConfig()
  return merged
}

export const deleteMount = (id: string): boolean => {
  loadConfig()
  const before = config.mounts.length
  config.mounts = config.mounts.filter(m => m.id !== id)
  saveConfig()
  if (config.mounts.length < before) {
    try {
      const cacheDir = path.join(global.lx.dataPath, 'webdav-cache', id)
      if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true })
    } catch (e) {
      console.error('[WebDAVMount] Failed to clean cache dir:', e)
    }
  }
  return config.mounts.length < before
}

/**
 * 动态创建 webdav 客户端（ESM 模块）
 */
export const initClient = async (mount: WebDAVMount, force = false): Promise<any> => {
  const { createClient } = await import('webdav')
  const options: any = {}
  if (mount.username) options.username = mount.username
  if (mount.password) options.password = mount.password
  return createClient(resolveHost(normalizeWebdavUrl(mount.baseUrl)), options)
}

const joinRemotePath = (rootPath: string, dirPath: string): string => {
  // 路径统一为相对 baseUrl：rootPath 为 baseUrl 下的根目录
  // 若 dirPath 已含 rootPath 前缀（前端 browse 传绝对路径）则去重，避免路径翻倍
  const root = rootPath === '/' ? '' : String(rootPath || '').replace(/^\/+|\/+$/g, '')
  const dir = dirPath === '/' ? '' : String(dirPath || '').replace(/^\/+|\/+$/g, '')
  let rel = dir
  if (root && dir) {
    if (dir === root) rel = ''
    else if (dir.startsWith(root + '/')) rel = dir.slice(root.length + 1)
  }
  const full = root ? (rel ? `${root}/${rel}` : root) : rel
  return '/' + full.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'
}

/**
 * 列出目录内容（带超时），返回 { items, error? }
 */
export const listFiles = async (mount: WebDAVMount, dirPath: string, timeoutMs = 20000): Promise<{ items: Array<{ name: string; isDir: boolean; size: number; mtime: number }>; error?: string }> => {
  try {
    const client = await initClient(mount)
    const stats: any[] = await Promise.race([
      client.getDirectoryContents(joinRemotePath(mount.rootPath, dirPath)),
      new Promise<any[]>((resolve) => setTimeout(() => resolve([]), timeoutMs)),
    ])
    const items = (stats || []).map((it: any) => ({
      name: it.basename || path.posix.basename(String(it.filename || '')).split('/').pop() || '',
      isDir: it.type === 'directory',
      size: it.size || 0,
      mtime: Date.parse(String(it.lastmod || '')) || 0,
    })).filter(it => it.name && it.name !== '.' && it.name !== '..')
    return { items }
  } catch (e: any) {
    return { items: [], error: e.message || '连接失败' }
  }
}

/**
 * 测试连接：列出 rootPath 验证连通
 */
export const testConnection = async (id: string): Promise<{ ok: boolean; message: string }> => {
  const mount = getMount(id)
  if (!mount) return { ok: false, message: '挂载源不存在' }
  const { items, error } = await listFiles(mount, mount.rootPath === '/' ? '/' : '', 20000)
  if (error) return { ok: false, message: error }
  return { ok: true, message: `连接成功，共 ${items.length} 项` }
}

/**
 * 浏览目录：返回子目录与文件列表（供前端目录树）
 */
export const browse = async (mountId: string, dirPath: string): Promise<{ success: boolean; items?: Array<{ name: string; isDir: boolean; size: number; mtime: number }>; message?: string }> => {
  const mount = getMount(mountId)
  if (!mount) return { success: false, message: '挂载源不存在' }
  const dir = (dirPath || '/').replace(/^\/+/, '')
  const { items, error } = await listFiles(mount, dir, 20000)
  if (error) return { success: false, message: error }
  return { success: true, items }
}

// ===== 音频索引：递归扫描目录树收集音频文件 =====

const AUDIO_EXT_RE = /\.(mp3|flac|wav|ogg|aac|m4a|ape|wma|opus|alac)$/i

const localIndexCache: Record<string, { files: any[]; at: number; pending?: Promise<any[]> }> = {}
const LOCAL_INDEX_TTL = 120 * 1000
const MAX_SCAN_DEPTH = 20
const MAX_SCAN_FILES = 5000
const MAX_SCAN_DIRS = 800
const MAX_SCAN_MS = 60 * 1000
const SCAN_CONCURRENCY = 6

const joinDir = (dirPath: string, name: string): string => {
  return (dirPath === '/' ? '' : dirPath) + '/' + name
}

const collectAudioFiles = async (mount: WebDAVMount, dirPath: string, depth = 0, result: any[] = [], ctx: { dirCount: number; deadline: number } = { dirCount: 0, deadline: Date.now() + MAX_SCAN_MS }): Promise<any[]> => {
  if (depth > MAX_SCAN_DEPTH || result.length >= MAX_SCAN_FILES || ctx.dirCount >= MAX_SCAN_DIRS || Date.now() > ctx.deadline) return result
  const dir = dirPath === '/' ? '' : dirPath.replace(/^\/+/, '')
  const { items, error } = await listFiles(mount, dir, 20000)
  if (error) return result
  ctx.dirCount++
  const subDirs: string[] = []
  // 跳过 WebDAV 同步目录：其中的缓存/备份文件会被误索引为挂载音乐（自我污染）
  const skipDirs = new Set(['lx-sync', 'lx-sync-backups'])
  for (const it of items) {
    if (result.length >= MAX_SCAN_FILES || ctx.dirCount >= MAX_SCAN_DIRS || Date.now() > ctx.deadline) break
    if (it.isDir) {
      if (skipDirs.has(it.name)) continue
      subDirs.push(joinDir(dirPath, it.name))
      continue
    }
    if (!it.name || !AUDIO_EXT_RE.test(it.name)) continue
    const ext = (path.extname(it.name) || '.mp3').toLowerCase().slice(1)
    const relPath = joinDir(dirPath, it.name)
    // 统一为相对 baseUrl 的完整路径（含 rootPath 前缀），与 stream/browse 语义一致
    const fullPath = joinRemotePath(mount.rootPath, relPath)
    const id = `webdav_${encodeURIComponent(fullPath)}`
    result.push({
      id,
      songmid: id,
      songId: id,
      name: it.name.replace(/\.[^.]+$/, ''),
      singer: '',
      album: '',
      albumId: '',
      source: 'webdav',
      downloadSource: 'webdav',
      sourceName: mount.name,
      quality: ext === 'flac' ? 'flac' : ext,
      filename: fullPath,
      folder: 'webdav',
      subPath: dirPath === '/' ? '' : dirPath,
      mtime: it.mtime || Date.now(),
      size: it.size || 0,
      ext,
      hasCover: false,
      coverType: 'none',
      hasLyric: false,
      serverId: mount.id,
      path: fullPath,
      sign: '',
      isLocal: true,
      webdav: true,
      interval: 0,
      url: `/api/webdav-mounts/stream?server=${encodeURIComponent(mount.id)}&path=${encodeURIComponent(fullPath)}`,
    })
  }
  let idx = 0
  while (idx < subDirs.length) {
    const batch = subDirs.slice(idx, idx + SCAN_CONCURRENCY)
    idx += SCAN_CONCURRENCY
    await Promise.all(batch.map(dir => collectAudioFiles(mount, dir, depth + 1, result, ctx)))
    if (Date.now() > ctx.deadline || ctx.dirCount >= MAX_SCAN_DIRS || result.length >= MAX_SCAN_FILES) break
  }
  return result
}

/**
 * 获取某挂载源的音频索引（带缓存，forceRefresh 强制重新扫描）
 */
export const getLocalIndex = (mountId: string, forceRefresh = false): Promise<any[]> => {
  const mount = getMount(mountId)
  if (!mount || !mount.enabled || !mount.baseUrl) return Promise.resolve([])
  const cached = localIndexCache[mountId]
  if (!forceRefresh && cached && cached.files && Date.now() - cached.at < LOCAL_INDEX_TTL) {
    return Promise.resolve(cached.files)
  }
  if (!forceRefresh && cached && cached.pending) {
    return cached.pending
  }
  const pending = collectAudioFiles(mount, '/').then(files => {
    localIndexCache[mountId] = { files, at: Date.now() }
    return files
  })
  if (!cached) localIndexCache[mountId] = { files: [], at: 0, pending }
  else localIndexCache[mountId] = { ...cached, pending }
  return pending
}

/**
 * 获取所有启用挂载源的音频索引（合并）
 */
export const getAllLocalIndex = (forceRefresh = false): Promise<any[]> => {
  const mounts = listMounts().filter(m => m.enabled && m.baseUrl)
  return Promise.all(mounts.map(m => getLocalIndex(m.id, forceRefresh))).then(groups => {
    const merged: any[] = []
    groups.forEach(group => merged.push(...group))
    return merged
  })
}

export const clearLocalIndex = (mountId?: string): void => {
  if (mountId) delete localIndexCache[mountId]
  else Object.keys(localIndexCache).forEach(k => delete localIndexCache[k])
}

// ===== 边播边缓存：本地缓存目录 + 流式代理 =====

const cacheProgress: Record<string, { total: number; received: number; done: boolean }> = {}
const inFlight: Record<string, Promise<any> | undefined> = {}

const cacheProgressKey = (mountId: string, filePath: string) => mountId + ':' + filePath

export const getCacheDir = (mount: WebDAVMount): string => {
  const dir = path.join(global.lx.dataPath, 'webdav-cache', mount.id)
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) { /* ignore */ }
  return dir
}

export const getCacheFilePath = (mount: WebDAVMount, filePath: string): string => {
  const hash = crypto.createHash('md5').update(mount.id + ':' + filePath).digest('hex')
  const ext = path.extname(filePath || '').toLowerCase() || '.mp3'
  return path.join(getCacheDir(mount), hash + ext)
}

export const isFileCached = (mount: WebDAVMount, filePath: string): boolean => {
  return fs.existsSync(getCacheFilePath(mount, filePath))
}

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.ape': 'audio/x-ape', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma',
}

/** 按文件路径扩展名返回音频 MIME；无法识别时回退 audio/mpeg */
export const getAudioMime = (filePath: string): string => {
  const ext = path.extname(filePath || '').toLowerCase()
  return MIME_TYPES[ext] || 'audio/mpeg'
}

/**
 * 服务本地缓存文件（支持 Range），返回是否已完整缓存
 */
export const serveCacheFile = (filePath: string, range: string | undefined, res: any): boolean => {
  if (!fs.existsSync(filePath)) return false
  const stat = fs.statSync(filePath)
  // 损坏缓存防御：0 字节文件（下载中断/上游无 Content-Length 导致的空文件）
  // 视为无效缓存，回退到上游 dav 流式，避免 audio 收到空响应而播放失败
  if (stat.size === 0) return false
  const ext = path.extname(filePath).toLowerCase()
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
    if (!Number.isFinite(start) || start < 0 || start >= stat.size || (parts[1] && end < start)) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      res.end()
      return true
    }
    const chunksize = (end - start) + 1
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath, { start, end }).pipe(res)
    return true
  }
  res.writeHead(200, {
    'Content-Length': stat.size,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  })
  fs.createReadStream(filePath).pipe(res)
  return true
}

/**
 * 生成 WebDAV 文件 URL（baseUrl + 路径拼接，路径保留编码）
 */
const fileUrl = (mount: WebDAVMount, filePath: string): string => {
  const base = resolveHost(normalizeWebdavUrl(mount.baseUrl)).replace(/\/+$/, '')
  const p = (filePath || '/').replace(/^\/+/, '')
  return `${base}/${p.split('/').map(seg => encodeURIComponent(seg)).join('/')}`
}

/**
 * 从 WebDAV 流式读取文件（原生 http/https，支持 Range 与 Basic Auth）。
 * 返回 ClientRequest，通过 'response'/'error' 事件暴露上游响应流。
 */
export const stream = (mount: WebDAVMount, filePath: string, range?: string): http.ClientRequest => {
  const targetUrl = new URL(fileUrl(mount, filePath))
  const headers: Record<string, string> = { 'User-Agent': 'lxserver/1.0' }
  if (mount.username && mount.password) {
    const token = Buffer.from(`${mount.username}:${mount.password}`).toString('base64')
    headers['Authorization'] = `Basic ${token}`
  }
  if (range) headers['Range'] = range
  const lib = targetUrl.protocol === 'https:' ? https : http
  const req = lib.request(targetUrl, { method: 'GET', headers } as any)
  req.on('error', () => { /* 错误由调用方处理 */ })
  req.end()
  return req
}

/**
 * 智能解码歌词文本：优先按 UTF-8 严格解码，失败回退 GB18030（远端常见 GBK 编码 .lrc）。
 * 不使用 TextDecoder('gb18030')：Alpine/Docker 的 node 仅 small-icu，不支持该编码。
 */
const decodeText = (buf: Buffer): string => {
  if (!buf || !buf.length) return ''
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    if (!utf8.includes('\uFFFD')) return utf8
  } catch (e) { /* 非合法 UTF-8，回退 GB18030 */ }
  try {
    return iconv.decode(buf, 'gb18030')
  } catch (e) {
    return buf.toString('utf-8')
  }
}

/**
 * 获取同目录歌词（filePath 形如 /dir/song.mp3，找 /dir/song.lrc）
 */
export const getLyric = async (mount: WebDAVMount, filePath: string): Promise<string> => {
  try {
    const client = await initClient(mount)
    const dir = path.posix.dirname(filePath === '/' ? '/' : filePath)
    const baseName = path.posix.basename(filePath || '').replace(/\.[^.]+$/, '')
    const lyricName = baseName + '.lrc'
    const lyricPath = path.posix.join(dir, lyricName).replace(/\/{2,}/g, '/')
    const content: any = await Promise.race([
      client.getFileContents(lyricPath, { format: 'binary' }),
      new Promise<any>((resolve) => setTimeout(() => resolve(''), 20000)),
    ])
    if (Buffer.isBuffer(content)) return decodeText(content)
    if (typeof content === 'string') return content
    if (content) {
      try { return JSON.stringify(content) } catch (e) { return String(content) }
    }
    return ''
  } catch (e) {
    return ''
  }
}

export const getCacheProgress = (mountId: string, filePath: string): { total: number; received: number; done: boolean } | null => {
  return cacheProgress[cacheProgressKey(mountId, filePath)] || null
}

export const trackCacheProgress = (mountId: string, filePath: string, total: number, received: number): void => {
  cacheProgress[cacheProgressKey(mountId, filePath)] = { total, received, done: false }
}

export const markCacheDone = (mountId: string, filePath: string): void => {
  const key = cacheProgressKey(mountId, filePath)
  const prev = cacheProgress[key]
  cacheProgress[key] = { total: prev?.total || 0, received: prev?.received || 0, done: true }
}

export const clearCacheProgress = (mountId: string, filePath: string): void => {
  delete cacheProgress[cacheProgressKey(mountId, filePath)]
  delete inFlight[cacheProgressKey(mountId, filePath)]
}

/**
 * 完整缓存下载并落盘（单飞去重：同一文件并发请求只触发一次下载）。
 * 返回 Promise，resolve(true) 表示完整下载完成。
 */
export const downloadToCache = (mount: WebDAVMount, filePath: string, onProgress?: (received: number, total: number) => void): Promise<boolean> => {
  const key = cacheProgressKey(mount.id, filePath)
  if (isFileCached(mount, filePath)) return Promise.resolve(true)
  if (inFlight[key]) return inFlight[key]

  const task = new Promise<boolean>((resolve) => {
    const tmpPath = getCacheFilePath(mount, filePath) + '.tmp'
    const cacheFilePath = getCacheFilePath(mount, filePath)
    let received = 0
    let total = 0
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch (e) { /* ignore */ }
    const proxyReq = stream(mount, filePath)
    const cleanup = (finish: boolean) => {
      delete inFlight[key]
      if (!finish) {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch (e) { /* ignore */ }
        clearCacheProgress(mount.id, filePath)
      }
    }
    proxyReq.on('error', () => cleanup(false))
    proxyReq.on('response', (resp: any) => {
      const statusCode = resp.statusCode || 200
      if (statusCode >= 300 && statusCode < 400 && resp.headers['location']) {
        resp.resume()
        cleanup(false)
        resolve(false)
        return
      }
      if (statusCode >= 400) {
        resp.resume()
        cleanup(false)
        resolve(false)
        return
      }
      total = parseInt(resp.headers['content-length'] || '0', 10)
      trackCacheProgress(mount.id, filePath, total, 0)
      const ws = fs.createWriteStream(tmpPath, { flags: 'w' })
      resp.on('data', (chunk: any) => {
        received += chunk.length
        ws.write(chunk)
        trackCacheProgress(mount.id, filePath, total, received)
        if (onProgress) onProgress(received, total)
      })
      resp.on('end', () => {
        ws.end(() => {
          // 上游无 Content-Length（total=0）时，仍要求至少收到数据才落盘；
          // 空响应（received=0）视为无效，清理临时文件避免产生空缓存
          if (received > 0 && (total === 0 || received >= total)) {
            try { fs.renameSync(tmpPath, cacheFilePath) } catch (e) {
              try { fs.unlinkSync(tmpPath) } catch (e2) { /* ignore */ }
            }
            markCacheDone(mount.id, filePath)
            cleanup(true)
            resolve(true)
          } else {
            cleanup(false)
            resolve(false)
          }
        })
      })
      resp.on('error', () => {
        ws.destroy()
        cleanup(false)
        resolve(false)
      })
    })
  })
  inFlight[key] = task
  return task
}

/**
 * 缓存汇总：文件数/占用大小；不指定 mountId 时为全部挂载
 */
export const cacheStatus = (mountId?: string): { fileCount: number; size: number } => {
  const base = path.join(global.lx.dataPath, 'webdav-cache')
  let fileCount = 0
  let size = 0
  const scan = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) scan(p)
      else if (!entry.name.endsWith('.tmp')) {
        fileCount++
        try { size += fs.statSync(p).size } catch (e) { /* ignore */ }
      }
    }
  }
  if (mountId) scan(path.join(base, mountId))
  else scan(base)
  return { fileCount, size }
}

/**
 * 清空缓存目录
 */
export const clearCache = (mountId?: string): void => {
  const base = path.join(global.lx.dataPath, 'webdav-cache')
  if (mountId) {
    const dir = path.join(base, mountId)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  } else {
    try { fs.rmSync(base, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }
}
