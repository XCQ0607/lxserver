import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as http from 'http'
import * as https from 'https'
import needle from 'needle'

const CONFIG_FILE = 'openlist.json'

interface OpenListServer {
  id: string
  name: string
  baseUrl: string
  username: string
  password: string
  token: string
  rootPath: string
  enabled: boolean
  createdAt: number
}

interface OpenListConfig {
  servers: OpenListServer[]
}

const defaultConfig: OpenListConfig = {
  servers: [],
}

let config: OpenListConfig = { servers: [] }

const configPath = () => path.join(global.lx.dataPath, CONFIG_FILE)

// token 缓存：服务器 id -> token
const tokenCache: Record<string, { token: string; expireAt: number }> = {}

const now = () => Date.now()

export const loadConfig = (): OpenListConfig => {
  const p = configPath()
  if (fs.existsSync(p)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
      config = {
        servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      }
    } catch (e) {
      config = { servers: [] }
    }
  }
  return config
}

export const saveConfig = (): void => {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('[OpenList] Failed to save config:', e)
  }
}

export const getConfig = (): OpenListConfig => config

export const listServers = (): OpenListServer[] => {
  loadConfig()
  return config.servers.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export const getServer = (id: string): OpenListServer | null => {
  loadConfig()
  return config.servers.find(s => s.id === id) || null
}

const normalizeServer = (data: any): OpenListServer => {
  let baseUrl = String(data.baseUrl || '').trim().replace(/\/+$/, '')
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) baseUrl = 'https://' + baseUrl
  return {
    id: data.id || crypto.randomBytes(8).toString('hex'),
    name: String(data.name || 'OpenList').trim(),
    baseUrl,
    username: String(data.username || '').trim(),
    password: String(data.password || ''),
    token: String(data.token || '').trim(),
    rootPath: String(data.rootPath || '/').trim() || '/',
    enabled: data.enabled !== false,
    createdAt: data.createdAt || now(),
  }
}

export const addServer = (data: any): OpenListServer => {
  loadConfig()
  if (!data.baseUrl) throw new Error('缺少 OpenList 地址')
  const server = normalizeServer(data)
  config.servers.push(server)
  saveConfig()
  return server
}

export const updateServer = (id: string, data: any): OpenListServer | null => {
  loadConfig()
  const idx = config.servers.findIndex(s => s.id === id)
  if (idx < 0) return null
  const merged = normalizeServer({ ...config.servers[idx], ...data, id })
  config.servers[idx] = merged
  delete tokenCache[id]
  saveConfig()
  return merged
}

export const deleteServer = (id: string): boolean => {
  loadConfig()
  const before = config.servers.length
  config.servers = config.servers.filter(s => s.id !== id)
  delete tokenCache[id]
  saveConfig()
  return config.servers.length < before
}

const encodePath = (p: string): string => {
  const cleaned = p || '/'
  const segments = cleaned.split('/').filter(Boolean)
  return '/' + segments.map(s => encodeURIComponent(s)).join('/')
}

const request = (server: OpenListServer, method: string, urlPath: string, data?: any, headers?: any, isDownload = false): Promise<any> => {
  return new Promise((resolve, reject) => {
    const baseUrl = server.baseUrl || ''
    const opts: any = { json: !isDownload, timeout: 30000, headers: {} }
    if (headers) opts.headers = { ...headers }
    needle.request(method as any, `${baseUrl}${urlPath}`, isDownload ? data : data, opts, (err: any, resp: any) => {
      if (err) return reject(new Error(err.message || 'Network error'))
      const body = resp.body
      if (resp.statusCode && resp.statusCode >= 400) {
        const msg = body && (body.message || body.error || body.error_description) || `HTTP ${resp.statusCode}`
        const err2: any = new Error(msg)
        err2.code = resp.statusCode
        err2.body = body
        return reject(err2)
      }
      if (isDownload) return resolve(resp)
      if (body && typeof body === 'object' && body.code !== undefined) {
        if (body.code === 200) return resolve(body.data !== undefined ? body.data : body)
        const msg = body.message || body.error || `OpenList error ${body.code}`
        const err3: any = new Error(msg)
        err3.code = body.code
        return reject(err3)
      }
      resolve(body)
    })
  })
}

/**
 * 登录获取 token（使用配置的用户名/密码）
 */
export const login = async (server: OpenListServer): Promise<string> => {
  if (!server.username || !server.password) throw new Error('未配置用户名/密码，无法登录')
  const res = await request(server, 'POST', '/api/auth/login', {
    username: server.username,
    password: server.password,
  })
  const token = res && (res.token || (res.data && res.data.token))
  if (!token) throw new Error('登录失败: ' + JSON.stringify(res || {}))
  tokenCache[server.id] = { token, expireAt: now() + 3600 * 1000 }
  return token
}

/**
 * 获取有效的 Authorization 值：
 * 优先使用手动 token；否则尝试用户名/密码登录；都没有则返回空（guest 访问）
 */
export const ensureToken = async (server: OpenListServer): Promise<string> => {
  if (server.token) return server.token
  const cached = tokenCache[server.id]
  if (cached && cached.token && cached.expireAt > now()) return cached.token
  if (server.username && server.password) {
    try {
      return await login(server)
    } catch (e) {
      console.error('[OpenList] login failed:', (e as any).message)
      return ''
    }
  }
  return ''
}

/**
 * 获取文件列表
 */
export const listFiles = async (server: OpenListServer, dirPath: string, page = 1, perPage = 0): Promise<any> => {
  const token = await ensureToken(server)
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = token
  const res = await request(server, 'POST', '/api/fs/list', {
    path: dirPath || '/',
    password: '',
    page,
    per_page: perPage,
    refresh: false,
  }, headers)
  return res || { content: [], total: 0, write: false }
}

/**
 * 搜索文件（仅对当前服务器内搜索）
 */
export const searchFiles = async (server: OpenListServer, keyword: string, page = 1, perPage = 0): Promise<any> => {
  const token = await ensureToken(server)
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = token
  try {
    const res = await request(server, 'POST', '/api/fs/search', {
      parent: server.rootPath || '/',
      keywords: keyword,
      page,
      per_page: perPage,
      scope: 0,
    }, headers)
    return res || { content: [], total: 0, write: false }
  } catch (e: any) {
    if (e && (e.code === 404 || e.code === 400)) {
      return { content: [], total: 0, write: false }
    }
    throw e
  }
}

/**
 * 获取文件的下载链接（/d/ 直链，带 sign）
 */
export const getDownloadUrl = async (server: OpenListServer, filePath: string, sign?: string): Promise<string> => {
  let s = sign || ''
  if (!s) {
    try {
      const token = await ensureToken(server)
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = token
      const info = await request(server, 'POST', '/api/fs/get', {
        path: filePath,
        password: '',
      }, headers)
      s = info && info.sign ? info.sign : ''
    } catch (e) {
      s = ''
    }
  }
  const q = s ? `?sign=${encodeURIComponent(s)}` : ''
  return `${server.baseUrl}/d${encodePath(filePath)}${q}`
}

/**
 * 代理下载/流式播放（支持 Range）。
 * 注意：不使用 needle（其 3.x 在流式响应约 130KB 后会卡死），改用原生 http/https。
 * 返回的 ClientRequest 通过 'response'/'error' 事件暴露上游响应流。
 */
export const stream = async (server: OpenListServer, filePath: string, sign: string | undefined, range?: string): Promise<http.ClientRequest> => {
  const url = await getDownloadUrl(server, filePath, sign)
  const targetUrl = new URL(url)
  const headers: Record<string, string> = {
    'User-Agent': 'lxserver/1.0',
  }
  const token = await ensureToken(server)
  if (token) headers['Authorization'] = token
  if (range) headers['Range'] = range
  const lib = targetUrl.protocol === 'https:' ? https : http
  const req = lib.request(targetUrl, { method: 'GET', headers } as any)
  req.on('error', () => { /* 错误由调用方处理 */ })
  req.end()
  return req
}

/**
 * 本地缓存目录：<dataPath>/openlist-cache/<serverId>/
 */
export const getCacheDir = (server: OpenListServer): string => {
  const dir = path.join(global.lx.dataPath, 'openlist-cache', server.id)
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) { /* ignore */ }
  return dir
}

/**
 * 计算文件在本地缓存中的路径（hash 命名，保留扩展名）
 */
export const getCacheFilePath = (server: OpenListServer, filePath: string): string => {
  const hash = crypto.createHash('md5').update(server.id + ':' + filePath).digest('hex')
  const ext = path.extname(filePath || '').toLowerCase() || '.mp3'
  return path.join(getCacheDir(server), hash + ext)
}

/**
 * 播放缓存进度：serverId:path -> { total, received, done }
 */
const cacheProgress = new Map<string, { total: number; received: number; done: boolean }>()

const cacheProgressKey = (serverId: string, filePath: string) => serverId + ':' + filePath

export const getCacheProgress = (serverId: string, filePath: string) => {
  return cacheProgress.get(cacheProgressKey(serverId, filePath)) || null
}

/**
 * 服务本地缓存文件（支持 Range），返回是否已完整缓存
 */
export const serveCacheFile = (filePath: string, range: string | undefined, res: any): boolean => {
  if (!fs.existsSync(filePath)) return false
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
    '.ape': 'audio/x-ape', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma',
  }
  const contentType = mimeTypes[ext] || 'application/octet-stream'
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
 * 更新缓存进度（写入 .tmp 时调用）
 */
export const trackCacheProgress = (serverId: string, filePath: string, total: number, received: number) => {
  cacheProgress.set(cacheProgressKey(serverId, filePath), { total, received, done: false })
}

export const markCacheDone = (serverId: string, filePath: string) => {
  const key = cacheProgressKey(serverId, filePath)
  const prev = cacheProgress.get(key)
  cacheProgress.set(key, { total: prev?.total || 0, received: prev?.received || 0, done: true })
}

export const clearCacheProgress = (serverId: string, filePath: string) => {
  cacheProgress.delete(cacheProgressKey(serverId, filePath))
}

/**
 * 判断指定文件是否已完整缓存到本地
 */
export const isFileCached = (server: OpenListServer, filePath: string): boolean => {
  return fs.existsSync(getCacheFilePath(server, filePath))
}

/**
 * 获取同目录歌词（path 形如 /dir/song.mp3，找 /dir/song.lrc）
 */
export const getLyric = async (server: OpenListServer, filePath: string, sign?: string): Promise<string> => {
  const dir = path.posix.dirname(filePath === '/' ? '/' : filePath)
  const baseName = path.posix.basename(filePath || '').replace(/\.[^.]+$/, '')
  const lyricName = baseName + '.lrc'
  const token = await ensureToken(server)
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = token
  const list = await request(server, 'POST', '/api/fs/list', {
    path: dir || '/',
    password: '',
    page: 1,
    per_page: 0,
    refresh: false,
  }, headers)
  const content: any[] = (list && list.content) || []
  const match = content.find((it: any) => !it.is_dir && it.name && it.name.toLowerCase() === lyricName.toLowerCase())
  if (!match) return ''
  const lyricUrl = await getDownloadUrl(server, path.posix.join(dir, match.name).replace(/\/{2,}/g, '/'), match.sign)
  const resp = await new Promise<any>((resolve, reject) => {
    const h: Record<string, string> = {}
    if (token) h['Authorization'] = token
    needle.get(lyricUrl, { headers: h, timeout: 20000, json: false }, (err: any, r: any) => {
      if (err) return reject(err)
      resolve(r)
    })
  })
  const text = resp && resp.body
  if (typeof text === 'string') return text
  if (Buffer.isBuffer(text)) return text.toString('utf-8')
  if (text) {
    try { return JSON.stringify(text) } catch (e) { return String(text) }
  }
  return ''
}

/**
 * 上传歌曲到 OpenList：将 sourceUrl 下载到临时文件，再 PUT 到目标目录
 */
export const uploadFromUrl = async (server: OpenListServer, sourceUrl: string, fileName: string, dirPath: string, tmpDir: string): Promise<any> => {
  const token = await ensureToken(server)
  if (!token) throw new Error('OpenList 需要登录或配置 token 才能上传')
  const safeName = String(fileName || 'song.mp3').replace(/[\\/:*?"<>|]/g, '_')
  const tmpFile = path.join(tmpDir, `${now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const fileStream = fs.createWriteStream(tmpFile)
      const downloadReq = needle.get(sourceUrl, { timeout: 0, follow_max: 5 })
      downloadReq.on('error', (e: any) => reject(e))
      downloadReq.pipe(fileStream)
      fileStream.on('finish', () => resolve())
      fileStream.on('error', (e: any) => reject(e))
    })
    const targetDir = (dirPath || server.rootPath || '/music').replace(/\/{2,}/g, '/')
    const targetPath = path.posix.join(targetDir, safeName).replace(/\/{2,}/g, '/')
    const resp = await new Promise<any>((resolve, reject) => {
      const fileStream = fs.createReadStream(tmpFile)
      const opts: any = {
        timeout: 0,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': token,
        },
      }
      const putReq = needle.put(`${server.baseUrl}/api/fs/put?path=${encodeURIComponent(targetPath)}`, fileStream, opts, (err: any, r: any) => {
        if (err) return reject(new Error(err.message || 'Upload failed'))
        if (r.statusCode && r.statusCode >= 400) {
          const msg = r.body && (r.body.message || r.body.error) || `HTTP ${r.statusCode}`
          return reject(new Error(msg))
        }
        resolve(r.body)
      })
      putReq.on('error', (e: any) => reject(e))
    })
    try { fs.unlinkSync(tmpFile) } catch (e) { /* ignore */ }
    return resp
  } catch (e: any) {
    try { fs.unlinkSync(tmpFile) } catch (e2) { /* ignore */ }
    throw e
  }
}

/**
 * 测试连接：验证 baseUrl 可达且能列出根目录
 */
export const testConnection = async (id: string): Promise<{ ok: boolean; message: string }> => {
  const server = getServer(id)
  if (!server) return { ok: false, message: '服务器不存在' }
  try {
    const token = await ensureToken(server)
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = token
    const res = await request(server, 'POST', '/api/fs/list', {
      path: server.rootPath || '/',
      password: '',
      page: 1,
      per_page: 1,
      refresh: false,
    }, headers)
    const content: any[] = (res && res.content) || []
    return { ok: true, message: `连接成功，共 ${res && res.total !== undefined ? res.total : content.length} 项` }
  } catch (e: any) {
    return { ok: false, message: e.message || '连接失败' }
  }
}
