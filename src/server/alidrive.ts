import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import needle from 'needle'

const API_BASE = 'https://openapi.alipan.com'
const CONFIG_FILE = 'alidrive.json'
const DEFAULT_SCOPES = ['user:base', 'file:all:read', 'file:all:write']

interface AlidriveConfig {
  clientId: string
  clientSecret: string
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresAt: number
  driveId: string
  userName: string
  linked: boolean
  linkedAt: number
}

interface QrStatus {
  status: 'PendingLogin' | 'Scanning' | 'LoginSuccess' | 'Expired' | 'Cancel' | 'Refreshed'
  auth_code?: string
  state?: string
  error_message?: string
}

const defaultConfig: AlidriveConfig = {
  clientId: '',
  clientSecret: '',
  accessToken: '',
  refreshToken: '',
  tokenType: 'Bearer',
  expiresAt: 0,
  driveId: '',
  userName: '',
  linked: false,
  linkedAt: 0,
}

let config: AlidriveConfig = { ...defaultConfig }

const configPath = () => path.join(global.lx.dataPath, CONFIG_FILE)

export const loadConfig = (): AlidriveConfig => {
  const p = configPath()
  if (fs.existsSync(p)) {
    try {
      config = { ...defaultConfig, ...JSON.parse(fs.readFileSync(p, 'utf8')) }
    } catch (e) {
      config = { ...defaultConfig }
    }
  }
  return config
}

export const saveConfig = (): void => {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('[Alidrive] Failed to save config:', e)
  }
}

export const getConfig = (): AlidriveConfig => config

export const updateClient = (clientId: string, clientSecret: string): void => {
  config.clientId = clientId || ''
  config.clientSecret = clientSecret || ''
  if (clientId && clientSecret) {
    config.linked = false
    config.accessToken = ''
    config.refreshToken = ''
    config.driveId = ''
    config.userName = ''
  }
  saveConfig()
}

const basicAuthHeader = (): string => {
  const raw = `${config.clientId}:${config.clientSecret}`
  return `Basic ${Buffer.from(raw).toString('base64')}`
}

const isExpired = (): boolean => {
  if (!config.accessToken) return true
  if (!config.expiresAt) return true
  return Date.now() >= config.expiresAt
}

const request = (method: string, url: string, data?: any, headers?: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    const opts: any = { json: true, timeout: 30000, headers: {} }
    if (headers) opts.headers = { ...headers }
    needle.request(method as any, url, data, opts, (err: any, resp: any) => {
      if (err) return reject(new Error(err.message || 'Network error'))
      const body = resp.body
      if (resp.statusCode && resp.statusCode >= 400) {
        const msg = body && (body.message || body.error_description || body.error) || `HTTP ${resp.statusCode}`
        const err2: any = new Error(msg)
        err2.code = resp.statusCode
        err2.body = body
        return reject(err2)
      }
      resolve(body)
    })
  })
}

const apiRequest = (method: string, urlPath: string, data?: any): Promise<any> => {
  return request(method, `${API_BASE}${urlPath}`, data, {
    Authorization: `${config.tokenType || 'Bearer'} ${config.accessToken}`,
  })
}

/**
 * 刷新 access token
 */
export const refreshToken = async (): Promise<boolean> => {
  if (!config.clientId || !config.clientSecret || !config.refreshToken) return false
  try {
    const res = await request('POST', `${API_BASE}/oauth/token`, {
      grant_type: 'refresh_token',
      refresh_token: config.refreshToken,
      client_id: config.clientId,
    }, {
      Authorization: basicAuthHeader(),
    })
    if (res && res.access_token) {
      config.accessToken = res.access_token
      config.refreshToken = res.refresh_token || config.refreshToken
      config.expiresAt = Date.now() + (res.expires_in || 7200) * 1000
      saveConfig()
      return true
    }
    return false
  } catch (e) {
    console.error('[Alidrive] Refresh token failed:', (e as any).message)
    return false
  }
}

/**
 * 确保有效的 access token
 */
export const ensureToken = async (): Promise<boolean> => {
  if (!config.clientId || !config.clientSecret) return false
  if (config.accessToken && !isExpired()) return true
  if (!config.refreshToken) return false
  return refreshToken()
}

/**
 * 获取 driveId（缓存到配置中）
 */
export const ensureDriveId = async (): Promise<string> => {
  if (config.driveId) return config.driveId
  if (!(await ensureToken())) return ''
  try {
    const res = await apiRequest('POST', '/adrive/v1.0/user/getDriveInfo', {})
    if (res && res.default_drive_id) {
      config.driveId = res.default_drive_id
      config.userName = res.name || config.userName
      config.linked = true
      saveConfig()
      return config.driveId
    }
    return ''
  } catch (e) {
    console.error('[Alidrive] Get drive info failed:', (e as any).message)
    return ''
  }
}

// ===== 扫码登录流程 =====

/**
 * 步骤1: 创建扫码授权，返回二维码内容 qr_content 与 sid
 */
export const createQrCode = async (): Promise<{ qr_content: string; sid: string }> => {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('阿里云盘未配置 ClientID / ClientSecret，请先在后台管理配置')
  }
  const res = await request('POST', `${API_BASE}/oauth/authorize/qrcode`, {
    client_id: config.clientId,
    scopes: DEFAULT_SCOPES,
    state: cryptoRandomStr(16),
  }, {
    Authorization: basicAuthHeader(),
  })
  if (!res || !res.qr_content || !res.sid) {
    throw new Error('创建扫码授权失败: ' + JSON.stringify(res || {}))
  }
  return { qr_content: res.qr_content, sid: res.sid }
}

/**
 * 步骤2: 轮询扫码状态
 */
export const checkQrStatus = async (sid: string): Promise<QrStatus> => {
  if (!config.clientId) throw new Error('未配置 ClientID')
  const res = await request('POST', `${API_BASE}/oauth/qrcode/${sid}/status`, {
    client_id: config.clientId,
  }, {
    Authorization: basicAuthHeader(),
  })
  return res as QrStatus
}

/**
 * 步骤3: 用 auth_code 兑换 token
 */
export const exchangeToken = async (code: string): Promise<boolean> => {
  if (!config.clientId || !config.clientSecret) return false
  const res = await request('POST', `${API_BASE}/oauth/token`, {
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
  }, {
    Authorization: basicAuthHeader(),
  })
  if (res && res.access_token) {
    config.accessToken = res.access_token
    config.refreshToken = res.refresh_token || config.refreshToken
    config.expiresAt = Date.now() + (res.expires_in || 7200) * 1000
    config.linked = true
    config.linkedAt = Date.now()
    saveConfig()
    await ensureDriveId()
    return true
  }
  return false
}

/**
 * 解除绑定
 */
export const unlink = (): void => {
  config.accessToken = ''
  config.refreshToken = ''
  config.driveId = ''
  config.userName = ''
  config.linked = false
  config.linkedAt = 0
  saveConfig()
}

const cryptoRandomStr = (len: number): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  const bytes = crypto.randomBytes(len)
  for (let i = 0; i < len; i++) result += chars[bytes[i] % chars.length]
  return result
}

// ===== 文件 API =====

/**
 * 获取文件列表
 */
export const listFiles = async (parentFileId = 'root', marker = '', limit = 100): Promise<{ items: any[]; next_marker: string }> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const res = await apiRequest('POST', '/adrive/v1.0/openFile/list', {
    drive_id: driveId,
    parent_file_id: parentFileId,
    limit,
    marker,
    order_by: 'name',
    order_direction: 'ASC',
  })
  return { items: res?.items || [], next_marker: res?.next_marker || '' }
}

/**
 * 搜索文件（query 形如: name match "关键字"）
 */
export const searchFiles = async (query: string, marker = '', limit = 50): Promise<{ items: any[]; next_marker: string }> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const res = await apiRequest('POST', '/adrive/v1.0/openFile/search', {
    drive_id: driveId,
    query,
    limit,
    marker,
  })
  return { items: res?.items || [], next_marker: res?.next_marker || '' }
}

/**
 * 获取单个文件的下载地址
 */
export const getDownloadUrl = async (fileId: string): Promise<string> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const res = await apiRequest('POST', '/adrive/v1.0/openFile/getDownloadUrl', {
    drive_id: driveId,
    file_id: fileId,
  })
  if (res && res.url) return res.url
  throw new Error('获取下载地址失败')
}

/**
 * 获取文件元信息
 */
export const getFileInfo = async (fileId: string): Promise<any> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const res = await apiRequest('POST', '/adrive/v1.0/openFile/get', {
    drive_id: driveId,
    file_id: fileId,
  })
  return res || {}
}

/**
 * 创建文件夹
 */
export const createFolder = async (parentFileId: string, name: string): Promise<string> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const res = await apiRequest('POST', '/adrive/v1.0/openFile/create', {
    drive_id: driveId,
    parent_file_id: parentFileId,
    name,
    type: 'folder',
    check_name_mode: 'refuse',
  })
  if (res && res.file_id) return res.file_id
  throw new Error('创建文件夹失败')
}

const getOrCreateFolderId = async (parentFileId: string, folderName: string): Promise<string> => {
  try {
    const { items } = await listFiles(parentFileId)
    const match = items.find((it: any) => it.type === 'folder' && it.name === folderName)
    if (match) return match.file_id
  } catch (e) { /* ignore */ }
  return createFolder(parentFileId, folderName)
}

/**
 * 确保目录结构存在，返回最终目录 file_id
 * 支持 "/a/b/c" 形式的路径，从根目录依次创建
 */
export const ensureDirPath = async (dirPath: string): Promise<string> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const segments = (dirPath || '').split('/').filter(s => s && s !== '.')
  let parentId = 'root'
  for (const seg of segments) {
    parentId = await getOrCreateFolderId(parentId, seg)
  }
  return parentId
}

/**
 * 上传文件（直传模式，单分片）
 * 返回上传后的 file_id
 */
export const uploadFile = async (parentFileId: string, fileName: string, filePath: string): Promise<string> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const stat = fs.statSync(filePath)
  const size = stat.size
  const createRes = await apiRequest('POST', '/adrive/v1.0/openFile/create', {
    drive_id: driveId,
    parent_file_id: parentFileId,
    name: fileName,
    type: 'file',
    check_name_mode: 'ignore',
    part_info_list: [{ part_number: 1 }],
    size,
  })
  if (!createRes || !createRes.file_id || !createRes.upload_id) {
    throw new Error('创建上传任务失败: ' + JSON.stringify(createRes || {}))
  }
  const uploadUrl = createRes.part_info_list?.[0]?.upload_url
  if (!uploadUrl) throw new Error('获取上传地址失败')

  await new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath)
    const opts: any = {
      timeout: 0,
      headers: { 'Content-Type': 'application/octet-stream' },
    }
    const uploadReq = needle.put(uploadUrl, fileStream, opts, (err: any, resp: any) => {
      if (err) return reject(new Error(err.message || 'Upload failed'))
      if (resp.statusCode && resp.statusCode >= 400) {
        return reject(new Error(`Upload failed: HTTP ${resp.statusCode}`))
      }
      resolve(null)
    })
    uploadReq.on('error', (e: any) => reject(e))
  })

  const completeRes = await apiRequest('POST', '/adrive/v1.0/openFile/complete', {
    drive_id: driveId,
    file_id: createRes.file_id,
    upload_id: createRes.upload_id,
    part_info_list: [{ part_number: 1 }],
  })
  if (completeRes && completeRes.file_id) return completeRes.file_id
  throw new Error('完成上传失败')
}

/**
 * 上传缓冲区内容为文件（用于歌词/小文件）
 */
export const uploadBuffer = async (parentFileId: string, fileName: string, buffer: Buffer): Promise<string> => {
  const driveId = await ensureDriveId()
  if (!driveId) throw new Error('阿里云盘未授权')
  const createRes = await apiRequest('POST', '/adrive/v1.0/openFile/create', {
    drive_id: driveId,
    parent_file_id: parentFileId,
    name: fileName,
    type: 'file',
    check_name_mode: 'ignore',
    part_info_list: [{ part_number: 1 }],
    size: buffer.length,
  })
  if (!createRes || !createRes.file_id || !createRes.upload_id) {
    throw new Error('创建上传任务失败')
  }
  const uploadUrl = createRes.part_info_list?.[0]?.upload_url
  if (!uploadUrl) throw new Error('获取上传地址失败')

  await new Promise((resolve, reject) => {
    needle.put(uploadUrl, buffer, {
      timeout: 0,
      headers: { 'Content-Type': 'application/octet-stream' },
    }, (err: any, resp: any) => {
      if (err) return reject(new Error(err.message || 'Upload failed'))
      if (resp.statusCode && resp.statusCode >= 400) return reject(new Error(`Upload failed: HTTP ${resp.statusCode}`))
      resolve(null)
    })
  })

  const completeRes = await apiRequest('POST', '/adrive/v1.0/openFile/complete', {
    drive_id: driveId,
    file_id: createRes.file_id,
    upload_id: createRes.upload_id,
    part_info_list: [{ part_number: 1 }],
  })
  if (completeRes && completeRes.file_id) return completeRes.file_id
  throw new Error('完成上传失败')
}

export const isLinked = (): boolean => !!(config.linked && config.clientId && config.accessToken)
