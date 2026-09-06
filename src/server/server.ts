import http, { type IncomingMessage } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { registerLocalSyncEvent, callObj, sync } from './sync'
import { authCode, authConnect } from './auth'
import { getAddress, sendStatus, decryptMsg, encryptMsg, getIP } from '@/utils/tools'
import { accessLog, startupLog, syncLog, loginLog, tokenLog } from '@/utils/log4js'
import {
  File,
  SYNC_CODE,
  SYNC_CLOSE_CODE,
} from '@/constants'
import { getUserSpace, releaseUserSpace, getUserName, getServerId, getUserDirname, getUserConfig, migrateUserData, renameUserSpace, finishRenameUserSpace } from '@/user'
import { createMsg2call } from 'message2call'
import { ElFinderConnector, getSystemRoot } from './elfinderConnector'
import formidable from 'formidable'
// @ts-ignore
import musicSdkRaw from '@/modules/utils/musicSdk/index.js'
const musicSdk = musicSdkRaw as any
import { initUserApis, callUserApiGetMusicUrl, isSourceSupported, getLoadedApis } from './userApi'
import * as customSourceHandlers from './customSourceHandlers'
import * as fileCache from './fileCache'
import * as customMusicManager from './customMusicManager'
import * as serverDownloadQueue from './serverDownloadQueue'
import * as remasterQueue from './remasterQueue'
import { getDownloadQualityCandidates } from './downloadQuality'
import crypto from 'node:crypto'
import needle from 'needle'
const { MusicTagger, MetaPicture } = require('music-tag-native')

// ===== Player Session Store =====
const playerSessions = new Map<string, { createdAt: number }>()
const SESSION_TTL = 24 * 60 * 60 * 1000 // 24小时
const SESSION_COOKIE_NAME = 'lx_player_session'

/** 生成随机 sessionId */
const generateSessionId = () => crypto.randomBytes(32).toString('hex')

/** 解析 Cookie 字符串 */
const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader) return {}
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=')
      return [k.trim(), decodeURIComponent(v.join('='))]
    })
  )
}

/** 检查请求是否携带有效的 Player Session Cookie */
const checkPlayerAuth = (req: IncomingMessage): boolean => {
  if (!global.lx.config['player.enableAuth']) return true // 未开启认证，直接放行
  const cookies = parseCookies(req.headers['cookie'])
  const sessionId = cookies[SESSION_COOKIE_NAME]
  if (!sessionId) return false
  const session = playerSessions.get(sessionId)
  if (!session) return false
  if (Date.now() - session.createdAt > SESSION_TTL) {
    playerSessions.delete(sessionId)
    return false
  }
  return true
}

/** 定期清理过期 Session（每小时） */
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of playerSessions) {
    if (now - session.createdAt > SESSION_TTL) playerSessions.delete(id)
  }
}, 60 * 60 * 1000)
// ===== End Player Session Store =====

// ===== User Session Token Store =====
interface UserToken {
  token: string
  name: string
  createdAt: number
  expiresAt: number | null
  lastUsed?: number
  disabled?: boolean
}

interface UserTokenConfig {
  enabled: boolean
  tokens: UserToken[]
}

/** 用户 Token 存储：token → { username, createdAt } */
const userSessions = new Map<string, { username: string; createdAt: number }>()
const USER_SESSION_TTL = 7 * 24 * 60 * 60 * 1000 // 7天

/** 持久化 Token 快速查找缓存：token → username */
const persistentTokens = new Map<string, string>()

/** 持久化 Token 元数据缓存：token → token 对象（含 disabled/expiresAt/lastUsed）*/
const persistentTokenMeta = new Map<string, { name: string; token: string; disabled?: boolean; expiresAt?: number; lastUsed?: number }>()

/** lastUsed 防抖写盘队列：username → debounce timer */
const persistentTokenSaveQueue = new Map<string, ReturnType<typeof setTimeout>>()

/** 触发防抖写盘，10s 内的高频更新只写一次 */
const scheduleSaveTokenConfig = (username: string) => {
  if (persistentTokenSaveQueue.has(username)) clearTimeout(persistentTokenSaveQueue.get(username)!)
  const timer = setTimeout(() => {
    persistentTokenSaveQueue.delete(username)
    // 从内存重建完整 config 并写盘
    const tokens: any[] = []
    for (const [, meta] of persistentTokenMeta) {
      if (persistentTokens.get(meta.token) === username) {
        tokens.push({ ...meta })
      }
    }
    // 同时保留已过期/禁用的 token（从文件读取合并）
    const existing = getUserTokenConfig(username)
    const existingNonActive = existing.tokens.filter(t => !persistentTokenMeta.has(t.token))
    const merged = [...existingNonActive, ...tokens]
    const config = { ...existing, tokens: merged }
    const userDirname = getUserDirname(username)
    const userPath = path.join(global.lx.userPath, userDirname)
    const tokenPath = path.join(userPath, File.userTokensJSON)
    if (!fs.existsSync(userPath)) fs.mkdirSync(userPath, { recursive: true })
    fs.writeFile(tokenPath, JSON.stringify(config, null, 2), 'utf8', (err) => {
      if (err) console.error('[Token] 写盘失败:', err)
    })
  }, 10_000)
  persistentTokenSaveQueue.set(username, timer)
}

const getUserTokenConfig = (username: string): UserTokenConfig => {
  const userDirname = getUserDirname(username)
  const userPath = path.join(global.lx.userPath, userDirname)
  const tokenPath = path.join(userPath, File.userTokensJSON)

  if (fs.existsSync(tokenPath)) {
    try {
      return JSON.parse(fs.readFileSync(tokenPath, 'utf8'))
    } catch (e) {
      return { enabled: false, tokens: [] }
    }
  }
  return { enabled: false, tokens: [] }
}

const saveUserTokenConfig = (username: string, config: UserTokenConfig) => {
  const userDirname = getUserDirname(username)
  const userPath = path.join(global.lx.userPath, userDirname)
  const tokenPath = path.join(userPath, File.userTokensJSON)
  if (!fs.existsSync(userPath)) fs.mkdirSync(userPath, { recursive: true })
  fs.writeFileSync(tokenPath, JSON.stringify(config, null, 2), 'utf8')

  // 更新内存缓存（清理该用户旧条目）
  for (const [tk, name] of persistentTokens.entries()) {
    if (name === username) {
      persistentTokens.delete(tk)
      persistentTokenMeta.delete(tk)
    }
  }
  // 写入新的有效 token
  if (config.enabled) {
    for (const t of config.tokens) {
      if (!t.expiresAt || t.expiresAt > Date.now()) {
        persistentTokens.set(t.token, username)
        persistentTokenMeta.set(t.token, {
          name: t.name,
          token: t.token,
          disabled: t.disabled ?? false,
          expiresAt: t.expiresAt ?? undefined,
          lastUsed: t.lastUsed,
        })
      }
    }
  }
}

// 初始化加载所有用户的持久化 Token
setTimeout(() => {
  if (global.lx.config && global.lx.config.users) {
    global.lx.config.users.forEach((u: any) => saveUserTokenConfig(u.name, getUserTokenConfig(u.name)))
  }
}, 5000)

/**
 * 验证请求中的用户 Token（x-user-token header）。
 * 1. 优先验证内存 Session Token（网页登陆产生）
 * 2. 其次验证持久化 API Token（管理面板产生，需开启账户 Token 功能）
 * 返回已验证的用户名，或 null 表示未认证。
 */
export const verifyUserAuth = (req: IncomingMessage): string | null => {
  const token = req.headers['x-user-token'] as string
  if (token) {
    // 1. Session Token 验证
    const session = userSessions.get(token)
    if (session && Date.now() - session.createdAt <= USER_SESSION_TTL) {
      return session.username
    }

    // 2. 持久化 API Token 验证（全程走内存，不读磁盘）
    const persistentUsername = persistentTokens.get(token)
    if (persistentUsername) {
      const meta = persistentTokenMeta.get(token)
      if (meta) {
        // 检查是否被禁用
        if (meta.disabled) {
          tokenLog.warn(`User ${persistentUsername} attempted to use DISABLED token: ${meta.name}`)
          return null
        }
        // 检查有效期
        if (!meta.expiresAt || meta.expiresAt > Date.now()) {
          // 仅更新内存中的 lastUsed，通过防抖延迟批量写盘
          meta.lastUsed = Date.now()
          scheduleSaveTokenConfig(persistentUsername)

          // 记录 Token 日志
          const ip = getIP(req)
          const masked = `${meta.token.slice(0, 6)}...${meta.token.slice(-4)}`
          tokenLog.info(`API Token [${meta.name}] (${masked}) used by ${persistentUsername} from ${ip} to access ${req.url}`)

          return persistentUsername
        } else {
          // 已过期，从内存缓存移除
          persistentTokens.delete(token)
          persistentTokenMeta.delete(token)
        }
      }
    }

    return null // Token 存在但无效/过期
  }

  // 后端所有用户名密码明文校验逻辑
  /*
  const username = req.headers['x-user-name'] as string
  const password = req.headers['x-user-password'] as string
  if (username && password) {
    const user = global.lx.config.users.find((u: any) => u.name === username && u.password === password)
    if (user) return username
  }
  */

  return null
}

const getCacheRequestUsername = (req: IncomingMessage): string | null => {
  const requested = (req.headers['x-user-name'] as string) || ''
  if (!requested || requested === 'default' || requested === 'open' || requested === '_open') return '_open'
  return verifyUserAuth(req)
}

/** 定期清理过期用户 Token（每小时） */
setInterval(() => {
  const now = Date.now()
  // 清理内存 Session
  for (const [token, session] of userSessions) {
    if (now - session.createdAt > USER_SESSION_TTL) userSessions.delete(token)
  }
  // 清理加载到内存的过期 API Token（直接走内存 meta，不读磁盘）
  for (const [token, meta] of persistentTokenMeta) {
    if (meta.expiresAt && meta.expiresAt <= now) {
      persistentTokens.delete(token)
      persistentTokenMeta.delete(token)
    }
  }
}, 60 * 60 * 1000)
// ===== End User Session Token Store =====


const getMime = (filename: string) => {
  const ext = path.extname(filename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.txt': 'text/plain',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.css': 'text/css',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * 规范化歌曲信息，确保收藏列表中的 meta 属性在根节点也可用
 * 解决 SDK 无法识别收藏歌曲音质的问题
 */
const normalizeSongInfo = (songInfo: any) => {
  if (!songInfo) return songInfo
  const meta = songInfo.meta || {}

  // 1. 处理音质信息 (types / _types)
  if (!songInfo.types && meta) {
    songInfo.types = meta.qualitys || meta.types
  }
  if (!songInfo._types && meta) {
    songInfo._types = meta._qualitys || meta._types
  }

  // 2. 处理基础字段备用根节点映射
  if (!songInfo.albumName && meta.albumName) songInfo.albumName = meta.albumName
  if (!songInfo.albumId && meta.albumId) songInfo.albumId = meta.albumId
  if (!songInfo.img && meta.picUrl) songInfo.img = meta.picUrl
  if (!songInfo.name && meta.name) songInfo.name = meta.name
  if (!songInfo.singer && meta.singer) songInfo.singer = meta.singer
  if (!songInfo.source && meta.source) songInfo.source = meta.source
  if (!songInfo.interval && meta.interval) songInfo.interval = meta.interval

  // 3. 处理通用 ID 转换 (id -> songmid)
  if (!songInfo.songmid) {
    if (meta.songId) {
      songInfo.songmid = meta.songId
    } else if (songInfo.id) {
      const sourcePrefix = `${songInfo.source}_`
      if (typeof songInfo.id === 'string' && songInfo.id.startsWith(sourcePrefix)) {
        songInfo.songmid = songInfo.id.slice(sourcePrefix.length)
      } else {
        songInfo.songmid = songInfo.id
      }
    }
  }

  // 4. 针对各平台 SDK 所需的特定字段进行补全
  switch (songInfo.source) {
    case 'wy': // 网易
      if (!songInfo.id && meta.songId) songInfo.id = Number(meta.songId)
      if (!songInfo.songmid && songInfo.id) songInfo.songmid = String(songInfo.id)
      break

    case 'kg': // 酷狗
      if (!songInfo.hash && meta.hash) songInfo.hash = meta.hash
      // 兼容某些 SDK 可能需要的 songmid 格式 (数字_哈希 或 仅哈Hash)
      break

    case 'tx': // 腾讯
      if (!songInfo.strMediaMid && meta.strMediaMid) songInfo.strMediaMid = meta.strMediaMid
      if (!songInfo.albumMid && meta.albumMid) songInfo.albumMid = meta.albumMid
      // 只有当 meta 中的 songId 是纯数字时才回填至 root.songId，否则保持 undefined 触发 SDK 自动获取
      const metaSongId = String(meta.songId || '')
      if (/^\d+$/.test(metaSongId)) {
        songInfo.songId = metaSongId
      }
      break

    case 'mg': // 咪咕
      if (!songInfo.copyrightId && meta.copyrightId) songInfo.copyrightId = meta.copyrightId
      if (!songInfo.lrcUrl && meta.lrcUrl) songInfo.lrcUrl = meta.lrcUrl
      if (!songInfo.songId) songInfo.songId = songInfo.songmid
      break

    case 'kw': // 酷我
      // 已在步骤 3 中通用处理
      break
  }

  return songInfo
}

let status: LX.Sync.Status = {
  status: false,
  message: '',
  address: [],
  // code: '',
  devices: [],
}

let host = 'http://localhost'
const sseClients = new Set<http.ServerResponse>()
// 音乐解析进度 SSE 专属通道: requestId -> response
const musicProgressClients = new Map<string, http.ServerResponse>()

// const codeTools: {
//   timeout: NodeJS.Timer | null
//   start: () => void
//   stop: () => void
// } = {
//   timeout: null,
//   start() {
//     this.stop()
//     this.timeout = setInterval(() => {
//       void generateCode()
//     }, 60 * 3 * 1000)
//   },
//   stop() {
//     if (!this.timeout) return
//     clearInterval(this.timeout)
//     this.timeout = null
//   },
// }

const checkDuplicateClient = (newSocket: LX.Socket) => {
  for (const client of [...wss!.clients]) {
    if (client === newSocket || client.keyInfo.clientId != newSocket.keyInfo.clientId) continue
    syncLog.info('duplicate client', client.userInfo.name, client.keyInfo.deviceName)
    client.isReady = false
    for (const name of Object.keys(client.moduleReadys) as Array<keyof LX.Socket['moduleReadys']>) {
      client.moduleReadys[name] = false
    }
    client.close(SYNC_CLOSE_CODE.normal)
  }
}

const handleConnection = async (socket: LX.Socket, request: IncomingMessage) => {
  const queryData = new URL(request.url as string, host).searchParams
  const clientId = queryData.get('i')

  //   // if (typeof socket.handshake.query.i != 'string') return socket.disconnect(true)
  const userName = getUserName(clientId)
  if (!userName) {
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  const userSpace = getUserSpace(userName)
  const keyInfo = userSpace.dataManage.getClientKeyInfo(clientId)
  if (!keyInfo) {
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  const user = global.lx.config.users.find(u => u.name == userName)
  if (!user) {
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  keyInfo.lastConnectDate = Date.now()
  userSpace.dataManage.saveClientKeyInfo(keyInfo)
  //   // socket.lx_keyInfo = keyInfo
  socket.keyInfo = keyInfo
  socket.userInfo = user

  checkDuplicateClient(socket)

  try {
    await sync(socket)
  } catch (err) {
    // console.log(err)
    syncLog.warn(err)
    socket.close(SYNC_CLOSE_CODE.failed)
    return
  }
  status.devices.push(keyInfo)
  // handleConnection(io, socket)
  sendStatus(status)
  socket.onClose(() => {
    status.devices.splice(status.devices.findIndex(k => k.clientId == keyInfo.clientId), 1)
    sendStatus(status)
  })

  // console.log('connection', keyInfo.deviceName)
  accessLog.info('connection', user.name, keyInfo.deviceName)
  // console.log(socket.handshake.query)

  socket.isReady = true
}

const handleUnconnection = (userName: string) => {
  // console.log('unconnection')
  releaseUserSpace(userName)
}

const authConnection = (req: http.IncomingMessage, callback: (err: string | null | undefined, success: boolean) => void) => {
  // console.log(req.headers)
  // // console.log(req.auth)
  // console.log(req._query.authCode)
  authConnect(req).then(() => {
    callback(null, true)
  }).catch(err => {
    // console.log('WebSocket auth failed:', err.message)
    callback(null, false) // <--- 修改为传递 null, false
  })
}

let wss: LX.SocketServer | null

function noop() { }
function onSocketError(err: Error) {
  console.error(err)
}

const saveUsers = () => {
  const usersJsonPath = path.join(global.lx.dataPath, 'users.json')
  try {
    fs.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
      name: u.name,
      password: u.password,
      maxSnapshotNum: u.maxSnapshotNum,
      'list.addMusicLocationType': u['list.addMusicLocationType'],
      enableCustomMusicDir: u.enableCustomMusicDir,
      customMusicDir: u.customMusicDir,
      allowOperateCustomMusicDir: u.allowOperateCustomMusicDir,
    })), null, 2))
    return true
  } catch (err) {
    console.error('Failed to save users.json', err)
    return false
  }
}

/** [新增] 服务器内部热重载数据 */
const reloadServerData = async () => {
  startupLog.info('Hot-reloading server data (users and config)...')

  // 1. 重新加载 config.js (必须先加载基础配置)
  const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.js')
  if (fs.existsSync(configPath)) {
    try {
      delete require.cache[require.resolve(configPath)]
      const rootConfig = require(configPath)

      // 合并除 users 以外的配置项
      for (const key of Object.keys(rootConfig)) {
        if (key !== 'users') {
          (global.lx.config as any)[key] = rootConfig[key]
        }
      }

      // 如果有 WebDAV 同步实例，手动同步其配置
      if (global.lx.webdavSync) {
        global.lx.webdavSync.updateConfig({
          url: global.lx.config['webdav.url'],
          username: global.lx.config['webdav.username'],
          password: global.lx.config['webdav.password'],
          syncPath: global.lx.config['webdav.syncPath'],
          backupPath: global.lx.config['webdav.backupPath'],
          interval: global.lx.config['sync.interval'],
          backupInterval: global.lx.config['sync.backupInterval'],
        })
      }
      startupLog.info('Config.js re-loaded and merged.')
    } catch (err: any) {
      startupLog.error('Failed to reload config.js:', err.message)
    }
  }

  // 2. 重新加载 users.json (users.json 权重更高，会覆盖 config.js 中的 users)
  const usersJsonPath = path.join(global.lx.dataPath, 'users.json')
  if (fs.existsSync(usersJsonPath)) {
    try {
      const usersRaw = fs.readFileSync(usersJsonPath, 'utf-8')
      const users = JSON.parse(usersRaw)
      if (Array.isArray(users)) {
        global.lx.config.users = users.map(u => ({
          ...u,
          dataPath: path.join(global.lx.userPath, getUserDirname(u.name))
        }))

        // 确保新加载的所有用户目录存在
        for (const user of global.lx.config.users) {
          if (!fs.existsSync(user.dataPath)) {
            fs.mkdirSync(user.dataPath, { recursive: true })
          }
        }
        startupLog.info(`Reloaded ${global.lx.config.users.length} users from users.json`)
      }
    } catch (err: any) {
      startupLog.error('Failed to reload users.json:', err.message)
    }
  }

  // 3. 重新初始化 User APIs (解决脚本源实时生效问题)
  try {
    await initUserApis()
    startupLog.info('User APIs re-initialized.')
  } catch (err: any) {
    startupLog.error('Failed to re-init user APIs:', err.message)
  }

  return true
}

const checkAndCreateDir = (p: string) => {
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true })
    }
  } catch (e: any) {
    if (e.code !== 'EEXIST') {
      console.error(`Could not create directory ${p}:`, e.message)
    }
  }
}

const readBody = async (req: IncomingMessage) => await new Promise<string>((resolve, reject) => {
  const chunks: any[] = []
  req.on('data', chunk => { chunks.push(chunk) })
  req.on('end', () => {
    resolve(Buffer.concat(chunks).toString('utf-8'))
  })
  req.on('error', reject)
})

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`
}

const getHeaderValue = (headers: Record<string, any>, key: string): string | undefined => {
  const value = headers[key] ?? headers[key.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value == null ? undefined : String(value)
}

const parseContentLength = (headers: Record<string, any>): number | null => {
  const range = getHeaderValue(headers, 'content-range')
  const total = range?.match(/\/(\d+)$/)?.[1]
  if (total) {
    const parsed = Number(total)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const length = Number(getHeaderValue(headers, 'content-length'))
  if (Number.isFinite(length) && length > 0) return length

  return null
}

const getAudioRemoteSize = async (audioUrl: string): Promise<number | null> => {
  if (!/^https?:\/\//i.test(audioUrl)) return null

  const urlObj = new URL(audioUrl)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': urlObj.origin,
  }
  const options = {
    follow_max: 5,
    response_timeout: 8000,
    read_timeout: 8000,
    headers,
  }

  try {
    const resp = await needle('head', audioUrl, null, options)
    const size = parseContentLength(resp.headers || {})
    if (size) return size
  } catch (e: any) {
    console.warn(`[QualitySize] HEAD failed: ${e.message}`)
  }

  try {
    const resp = await needle('get', audioUrl, null, {
      ...options,
      headers: {
        ...headers,
        Range: 'bytes=0-0',
      },
    })
    return parseContentLength(resp.headers || {})
  } catch (e: any) {
    console.warn(`[QualitySize] Range probe failed: ${e.message}`)
  }

  return null
}

const AUTO_SOURCE_ORDER = ['wy', 'tx', 'kw', 'kg', 'mg']
const SOURCE_MATCH_CACHE_TTL = 60_000
const sourceMatchCache = new Map<string, { expiresAt: number, promise: Promise<any[]> }>()

const normalizeSongMatchText = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/[（(\[].*?[）)\]]/g, '')
  .replace(/[\s\p{P}\p{S}]/gu, '')

const normalizeSongNameText = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/[\s\p{P}\p{S}]/gu, '')

const splitSingerNames = (value: unknown) => String(value || '')
  .toLowerCase()
  .split(/[、，,&；;|/+]/)
  .map(normalizeSongMatchText)
  .filter(Boolean)

const isSingerMatch = (candidateSinger: unknown, targetSinger: unknown) => {
  const candidateText = normalizeSongMatchText(candidateSinger)
  const targetText = normalizeSongMatchText(targetSinger)
  if (!targetText) return true
  if (!candidateText) return false
  if (candidateText.includes(targetText) || targetText.includes(candidateText)) return true

  const candidateParts = splitSingerNames(candidateSinger)
  const targetParts = splitSingerNames(targetSinger)
  return candidateParts.some(candidatePart => targetParts.some(targetPart => (
    candidatePart.includes(targetPart) || targetPart.includes(candidatePart)
  )))
}

const getSongDurationSeconds = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10000 ? Math.round(value / 1000) : Math.round(value)
  }

  const text = String(value || '').trim()
  if (!text) return 0
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const parsed = Number(text)
    return parsed > 10000 ? Math.round(parsed / 1000) : Math.round(parsed)
  }

  const parts = text.split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part))) return 0
  if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1])
  if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2])
  return 0
}

const getSongMatchScore = (candidate: any, target: any) => {
  const candidateName = normalizeSongNameText(candidate?.name)
  const targetName = normalizeSongNameText(target?.name)
  if (!candidateName || !targetName) return -1
  if (!candidateName.includes(targetName) && !targetName.includes(candidateName)) return -1
  if (!isSingerMatch(candidate?.singer, target?.singer)) return -1

  const candidateDuration = getSongDurationSeconds(candidate?.interval)
  const targetDuration = getSongDurationSeconds(target?.interval)
  let durationScore = 0
  if (candidateDuration > 0 && targetDuration > 0) {
    const durationDiff = Math.abs(candidateDuration - targetDuration)
    if (durationDiff > 8) return -1
    durationScore = 8 - durationDiff
  }

  const nameScore = candidateName === targetName ? 20 : 10
  const candidateAlbum = normalizeSongMatchText(candidate?.albumName)
  const targetAlbum = normalizeSongMatchText(target?.albumName)
  const albumScore = candidateAlbum && targetAlbum && candidateAlbum === targetAlbum ? 3 : 0
  return nameScore + durationScore + albumScore
}

const findServerSourceMatches = async (songInfo: any, username: string) => {
  if (!songInfo?.name || !songInfo?.singer) return []

  const cacheKey = [
    username,
    songInfo.source,
    normalizeSongMatchText(songInfo.name),
    normalizeSongMatchText(songInfo.singer),
    getSongDurationSeconds(songInfo.interval),
  ].join(':')
  const now = Date.now()
  const cached = sourceMatchCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.promise

  for (const [key, value] of sourceMatchCache) {
    if (value.expiresAt <= now) sourceMatchCache.delete(key)
  }

  const searchSources = AUTO_SOURCE_ORDER.filter(source => (
    source !== songInfo.source && isSourceSupported(source, username) && musicSdk[source]?.musicSearch?.search
  ))
  const query = `${songInfo.name} ${songInfo.singer}`
  const promise = Promise.all(searchSources.map(async source => {
    try {
      const searchData = await musicSdk[source].musicSearch.search(query, 1, 20)
      const list = Array.isArray(searchData?.list) ? searchData.list : []
      return list.map((item: any) => ({ ...item, source }))
    } catch (err: any) {
      console.warn(`[ServerAutoSource] Search failed for ${source}: ${err?.message || err}`)
      return []
    }
  })).then(resultGroups => resultGroups.flat()
    .map(candidate => ({ candidate, score: getSongMatchScore(candidate, songInfo) }))
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.candidate))

  sourceMatchCache.set(cacheKey, { expiresAt: now + SOURCE_MATCH_CACHE_TTL, promise })
  return promise
}

interface ServerSongResolveResult {
  url: string
  quality: string
  songInfo: any
  requestedSource?: string
  downloadSource?: string
  sourceName?: string
}

const resolveServerSong = async (
  rawSongInfo: any,
  requestedQuality: string,
  username: string,
  allowQualityFallback: boolean,
): Promise<ServerSongResolveResult> => {
  const originalSong = normalizeSongInfo({ ...rawSongInfo })
  if (!originalSong?.source) throw new Error('Missing song source')

  const qualities = allowQualityFallback
    ? getDownloadQualityCandidates(requestedQuality)
    : [requestedQuality]
  const errors: string[] = []

  const tryCandidates = async (quality: string, rawCandidates: any[]) => {
    for (const rawCandidate of rawCandidates) {
      const candidate = normalizeSongInfo({ ...rawCandidate })
      const source = candidate?.source
      if (!source || !isSourceSupported(source, username)) continue

      try {
        const result = await callUserApiGetMusicUrl(source, candidate, quality, username, undefined, true)
        if (!result?.url) throw new Error('audio source returned no URL')
        return {
          url: result.url,
          quality: result.type || quality,
          songInfo: candidate,
          requestedSource: originalSong.source,
          downloadSource: fileCache.detectDownloadSource(result.url, source),
          sourceName: result.sourceName,
        }
      } catch (err: any) {
        errors.push(`${source}/${quality}: ${err?.message || 'resolve failed'}`)
      }
    }
    return null
  }

  const originalResult = await tryCandidates(requestedQuality, [originalSong])
  if (originalResult) return originalResult

  const matches = await findServerSourceMatches(originalSong, username)
  const switchedResult = await tryCandidates(requestedQuality, matches)
  if (switchedResult) return switchedResult

  for (const quality of qualities.slice(1)) {
    const fallbackResult = await tryCandidates(quality, [originalSong, ...matches])
    if (fallbackResult) return fallbackResult
  }

  throw new Error(`No downloadable source found (${errors.join('; ')})`)
}

const isPathInside = (child: string, parent: string): boolean => {
  const resolvedParent = path.resolve(parent)
  const resolvedChild = path.resolve(child)
  if (resolvedChild === resolvedParent) return true
  const withSep = resolvedParent.endsWith(path.sep) ? resolvedParent : resolvedParent + path.sep
  return resolvedChild.startsWith(withSep)
}

const serveStatic = (req: IncomingMessage, res: http.ServerResponse, filePath: string) => {
  // Prevent path traversal: ensure the resolved file path stays within staticPath
  if (!isPathInside(filePath, global.lx.staticPath)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  const contentType = getMime(filePath)

  try {
    const stats = fs.statSync(filePath)
    const mtime = stats.mtime.getTime()
    const etag = `W/"${stats.size}-${mtime}"`
    const lastModified = stats.mtime.toUTCString()

    // Check Cache Validity (Conditional Requests)
    if (req.headers['if-none-match'] === etag || req.headers['if-modified-since'] === lastModified) {
      res.writeHead(304)
      res.end()
      return
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404)
          res.end('Not Found')
        } else {
          res.writeHead(500)
          res.end('Server Error')
        }
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'ETag': etag,
          'Last-Modified': lastModified,
          'Cache-Control': 'no-cache, must-revalidate', // Force browser to revalidate every time
          'Pragma': 'no-cache',
          'Expires': '0',
        })
        res.end(content, 'utf-8')
      }
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      res.writeHead(404)
      res.end('Not Found')
    } else {
      res.writeHead(500)
      res.end('Server Error')
    }
  }
}

const handleStartServer = async (port = 9527, ip = '127.0.0.1') => await new Promise((resolve, reject) => {
  const httpServer = http.createServer(async (req, res) => {
    // CORS 跨域处理
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Private-Network', 'true')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const ip = getIP(req)
    accessLog.info(`${req.method} ${req.url} from ${ip}`)
    // console.log(req.url)
    const urlObj = new URL(req.url ?? '', `http://${req.headers.host}`)
    const pathname = urlObj.pathname

    // 读取路径配置（每次请求都重新读取，保存后立刻生效）
    const normalizePath = (p: string) => (p || '').replace(/\/+$/, '')
    const playerPath = global.lx.config['player.path'] ?? '/'
    const adminPath = global.lx.config['admin.path'] ?? '/admin'

    // 映射播放器逻辑 (无论是自定义路径还是前端硬编码的 /music/)
    const isPlayerRequest = (playerPath === '/' || playerPath === '')
      ? (pathname === '/' || (!pathname.startsWith('/api/') && !pathname.startsWith('/rest/') && (adminPath === '' || (pathname !== adminPath && !pathname.startsWith(adminPath + '/')))))
      : (pathname.startsWith(playerPath + '/') || pathname === playerPath)

    // [新增] 映射管理后台逻辑
    const isAdminRequest = adminPath && (pathname.startsWith(adminPath + '/') || pathname === adminPath)

    if (isAdminRequest) {
      if (pathname === adminPath) {
        res.writeHead(301, { 'Location': pathname + '/' })
        res.end()
        return
      }
      const subPath = pathname.slice(adminPath.length)
      let targetPath = ''
      if (subPath === '/' || subPath === '') {
        targetPath = 'index.html'
      } else {
        targetPath = subPath.startsWith('/') ? subPath.slice(1) : subPath
      }
      const filePath = path.join(global.lx.staticPath, targetPath)
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStatic(req, res, filePath)
        return
      }
    }

    const isLegacyPlayerAsset = playerPath !== '/music' && (
      pathname.startsWith('/music/assets/') ||
      pathname.startsWith('/music/css/') ||
      pathname.startsWith('/music/js/') ||
      pathname.startsWith('/music/fonts/') ||
      pathname.startsWith('/music/img/') ||
      pathname === '/music/manifest.json' ||
      pathname === '/music/sw.js'
    )

    if (isPlayerRequest || isLegacyPlayerAsset) {
      const activePrefix = isPlayerRequest ? playerPath : '/music'
      const normalizedPrefix = (activePrefix === '/' || activePrefix === '') ? '' : activePrefix.replace(/\/+$/, '')
      // 白名单：登录页、静态资源无需认证
      const isLoginPage = pathname === `${normalizedPrefix}/login` || pathname === `${normalizedPrefix}/login.html`
      const isPublicAsset = pathname.startsWith(`${normalizedPrefix}/assets/`) ||
        pathname.startsWith(`${normalizedPrefix}/css/`) ||
        pathname.startsWith(`${normalizedPrefix}/js/`) ||
        pathname.startsWith(`${normalizedPrefix}/fonts/`) ||
        pathname.startsWith(`${normalizedPrefix}/img/`) ||
        pathname === `${normalizedPrefix}/manifest.json` ||
        pathname === `${normalizedPrefix}/sw.js` ||
        isLegacyPlayerAsset

      // 认证检查
      if (!isLoginPage && !isPublicAsset && global.lx.config['player.enableAuth']) {
        if (!checkPlayerAuth(req)) {
          res.writeHead(302, { 'Location': `${normalizedPrefix}/login` })
          res.end()
          return
        }
      }

      // 规范化物理路径
      let targetPath = pathname
      // 将请求路径中的前缀映射到真实的 /music 物理目录
      if (pathname === activePrefix && activePrefix !== '/') {
        res.writeHead(301, { 'Location': pathname + '/' })
        res.end()
        return
      }

      // [PWA 适配] 动态生成播放器的 manifest.json，自动匹配当前 playerPath
      if (pathname === `${normalizedPrefix}/manifest.json` || (isLegacyPlayerAsset && pathname === '/music/manifest.json')) {
        const manifestFilePath = path.join(global.lx.staticPath, 'music', 'manifest.json')
        try {
          const raw = fs.readFileSync(manifestFilePath, 'utf-8')
          const manifest = JSON.parse(raw)
          // 规范化当前播放器的 base URL（必须以 / 结尾）
          const effectivePlayerBase = (playerPath === '/' || playerPath === '') ? '/' : `${playerPath.replace(/\/+$/, '')}/`
          manifest.start_url = effectivePlayerBase
          manifest.scope = effectivePlayerBase
          // 图标使用相对于当前有效根路径或者播放器物理路径的地址
          if (Array.isArray(manifest.icons)) {
            manifest.icons = manifest.icons.map((icon: any) => ({
              ...icon,
              src: icon.src ? (icon.src.startsWith('http') ? icon.src : `${effectivePlayerBase}${icon.src.replace(/^\.\//, '')}`) : icon.src
            }))
          }
          res.writeHead(200, {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          })
          res.end(JSON.stringify(manifest, null, 2))
          return
        } catch { }
      }

      const subPath = pathname.slice(normalizedPrefix.length)
      if (subPath === '/' || subPath === '') {
        targetPath = 'music/index.html'
      } else if (isLoginPage) {
        targetPath = 'music/login.html'
      } else {
        // [优化] 如果根路径是播放器，且请求已经包含 /music/ 前缀，则不再重复叠加
        if ((activePrefix === '/' || activePrefix === '') && subPath.startsWith('/music/')) {
          targetPath = subPath.slice(1)
        } else {
          targetPath = path.posix.join('music', subPath.startsWith('/') ? subPath.slice(1) : subPath)
        }
      }

      const filePath = path.join(global.lx.staticPath, targetPath)
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStatic(req, res, filePath)
        return
      }
    }

    // [动态配置注入] 优先拦截 /js/config.js 请求，确保后端配置能注入到前端 window.CONFIG
    if (pathname === '/js/config.js') {
      // 从静态文件读取版本号和构建哈希
      const staticConfigPath = path.join(global.lx.staticPath, 'js', 'config.js')
      let version = 'v1.0.0'
      let buildHash = 'unknown'
      try {
        const content = fs.readFileSync(staticConfigPath, 'utf-8')
        const matchVersion = content.match(/version:\s*['"]([^'"]+)['"]/)
        if (matchVersion) version = matchVersion[1]
        const matchHash = content.match(/buildHash:\s*['"]([^'"]+)['"]/)
        if (matchHash) buildHash = matchHash[1]
      } catch { }

      // 构造前端配置 暴露给前端
      const frontendConfig = {
        version,
        buildHash,
        serverName: global.lx.config.serverName,
        disableTelemetry: global.lx.config.disableTelemetry || false,
        'proxy.enabled': global.lx.config['proxy.enabled'],
        'user.enablePath': global.lx.config['user.enablePath'],
        'user.enableRoot': global.lx.config['user.enableRoot'],
        'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'] || false,
        'user.enablePublicNonAdminBrowserDownload': global.lx.config['user.enablePublicNonAdminBrowserDownload'] ?? true,
        'user.enablePublicNonAdminServerCache': global.lx.config['user.enablePublicNonAdminServerCache'] ?? false,
        'user.enableLoginCacheRestriction': global.lx.config['user.enableLoginCacheRestriction'] || false,
        'user.enableCacheSizeLimit': global.lx.config['user.enableCacheSizeLimit'] || false,
        'user.cacheSizeLimit': global.lx.config['user.cacheSizeLimit'] || 2000,
        maxSnapshotNum: global.lx.config.maxSnapshotNum,
        'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
        'player.enableAuth': global.lx.config['player.enableAuth'] || false,
        port: global.lx.config.port,
        bindIP: global.lx.config.bindIP,
        'admin.path': global.lx.config['admin.path'] ?? '/admin',
        'player.path': global.lx.config['player.path'] ?? '/',
      }

      const configJs = `window.CONFIG = ${JSON.stringify(frontendConfig, null, 2)};`
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      })
      res.end(configJs)
      return
    }

    // [管理界面]
    const effectiveAdminPath = adminPath || '/'
    const isAdminPath = (pathname === effectiveAdminPath || pathname === effectiveAdminPath + '/' || pathname === effectiveAdminPath + '/index.html')

    if (isAdminPath) {
      const rootHtmlPath = path.join(global.lx.staticPath, 'index.html')
      if (fs.existsSync(rootHtmlPath)) {
        serveStatic(req, res, rootHtmlPath)
        return
      }
    }

    // 注意：如果设置了 adminPath，则不允许通过 / 直接访问后台资源文件，除非它是公共资源
    if (!pathname.startsWith('/api/')) {
      const generalFilePath = path.join(global.lx.staticPath, pathname)
      // 禁止绕过 adminPath 直接访问后台 index.html
      if (pathname === '/' || pathname === '/index.html') {
        if (adminPath !== '' && playerPath !== '/') {
          res.writeHead(404)
          res.end('Not Found')
          return
        }
      }

      if (fs.existsSync(generalFilePath) && fs.statSync(generalFilePath).isFile()) {
        serveStatic(req, res, generalFilePath)
        return
      }
    }

    // [Subsonic API]
    const subsonicEnable = global.lx.config['subsonic.enable']
    const subsonicPath = normalizePath(global.lx.config['subsonic.path'] || '/rest')
    if (subsonicEnable && (pathname.startsWith(subsonicPath + '/') || pathname === subsonicPath)) {
      const { subsonicHandler } = require('./subsonic')
      return subsonicHandler.handleRequest(req, res, urlObj)
    }


    if (pathname.startsWith('/api/')) {


      if (pathname === '/api/login' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { password } = JSON.parse(body)
            if (password === global.lx.config['frontend.password']) {
              loginLog.info(`Admin login success from ${ip}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              loginLog.warn(`Admin login failed from ${ip}`)
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false }))
            }
          } catch (e) {
            res.writeHead(400)
            res.end('Bad Request')
          }
        })
        return
      }



      // [新增] 获取服务器状态
      if (pathname === '/api/status' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const totalMem = os.totalmem()
        const freeMem = os.freemem()

        // 重新实现更准确的 CPU 使用率计算（支持 Windows）
        const getSystemCpuUsage = () => {
          const cpus = os.cpus()
          let idle = 0; let total = 0
          cpus.forEach(cpu => {
            for (const type in cpu.times) { total += (cpu.times as any)[type] }
            idle += cpu.times.idle
          })
          const last = global.lx.lastCpuSample || { idle: 0, total: 0 }
          const deltaIdle = idle - last.idle
          const deltaTotal = total - last.total
          global.lx.lastCpuSample = { idle, total }
          if (deltaTotal === 0) return '0.00'
          return (100 * (1 - deltaIdle / deltaTotal)).toFixed(2)
        }

        const getProcessCpuUsage = () => {
          const currentUsage = process.cpuUsage()
          const currentTime = Date.now()
          const last = global.lx.lastProcessSample || { cpu: process.cpuUsage(), time: Date.now() - 100 }
          const deltaUsage = {
            user: currentUsage.user - last.cpu.user,
            system: currentUsage.system - last.cpu.system,
          }
          const deltaTime = (currentTime - last.time) * 1000 // microseconds
          global.lx.lastProcessSample = { cpu: currentUsage, time: currentTime }
          if (deltaTime === 0) return '0.00'
          return ((deltaUsage.user + deltaUsage.system) / deltaTime / os.cpus().length * 100).toFixed(2)
        }

        const status = {
          users: global.lx.config.users.length,
          devices: wss?.clients.size ?? 0,
          uptime: process.uptime(),
          memory: process.memoryUsage().rss,
          totalMemory: totalMem,
          freeMemory: freeMem,
          systemMemoryUsage: ((totalMem - freeMem) / totalMem * 100).toFixed(2),
          processMemoryUsage: (process.memoryUsage().rss / totalMem * 100).toFixed(2),
          cpuUsage: getSystemCpuUsage(),
          processCpuUsage: getProcessCpuUsage(),
          osUptime: os.uptime(),
          cpus: os.cpus().length,
          cpuModel: os.cpus()[0]?.model || 'Unknown',
          cpuSpeed: os.cpus()[0]?.speed || 0,
          isWebDAVConfigured: !!(global.lx.config['webdav.url'] && global.lx.config['webdav.url'].trim() !== ''),
        }

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        })
        res.end(JSON.stringify(status))
        return
      }

      if (pathname === '/api/users') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        if (req.method === 'GET') {
          // 修改：返回包含密码及自定义目录配置的用户列表
          const users = global.lx.config.users.map(u => ({
            name: u.name,
            password: u.password,
            enableCustomMusicDir: u.enableCustomMusicDir ?? false,
            customMusicDir: u.customMusicDir || '',
            allowOperateCustomMusicDir: u.allowOperateCustomMusicDir ?? false,
            allowWriteCustomMusicDir: u.allowWriteCustomMusicDir ?? false,
          }))
          if (global.lx.config['user.enablePublicFavorites']) {
            users.unshift({ name: '_open', password: '', enableCustomMusicDir: false, customMusicDir: '', allowOperateCustomMusicDir: false, allowWriteCustomMusicDir: false })
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(users))
          return
        }
        if (req.method === 'POST') {
          void readBody(req).then(body => {
            try {
              const { name, password } = JSON.parse(body)
              if (!name || !password) {
                res.writeHead(400)
                res.end('Missing name or password')
                return
              }
              if (global.lx.config.users.some(u => u.name === name)) {
                res.writeHead(409)
                res.end('User already exists')
                return
              }

              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { getUserDirname } = require('@/user')
              const dataPath = path.join(global.lx.userPath, getUserDirname(name))
              checkAndCreateDir(dataPath)

              global.lx.config.users.push({
                name,
                password,
                dataPath,
              })
              saveUsers()

              res.writeHead(200)
              res.end(JSON.stringify({ success: true }))
            } catch (e) {
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
        if (req.method === 'PUT') {
          void readBody(req).then(body => {
            try {
              const { name, newName, password, enableCustomMusicDir, customMusicDir, allowOperateCustomMusicDir, allowWriteCustomMusicDir } = JSON.parse(body)
              if (!name) {
                res.writeHead(400)
                res.end('Missing required fields')
                return
              }
              const userIdx = global.lx.config.users.findIndex(u => u.name === name)
              if (userIdx === -1) {
                res.writeHead(404)
                res.end('User not found')
                return
              }

              const user = global.lx.config.users[userIdx]

              const handleFinalUpdate = () => {
                if (password) user.password = password
                if (enableCustomMusicDir !== undefined) user.enableCustomMusicDir = !!enableCustomMusicDir
                if (customMusicDir !== undefined) user.customMusicDir = String(customMusicDir).trim()
                if (allowOperateCustomMusicDir !== undefined) user.allowOperateCustomMusicDir = !!allowOperateCustomMusicDir
                if (allowWriteCustomMusicDir !== undefined) user.allowWriteCustomMusicDir = !!allowWriteCustomMusicDir
                saveUsers()
                res.writeHead(200)
                res.end(JSON.stringify({ success: true }))
              }

              if (newName && newName !== name) {
                if (global.lx.config.users.some(u => u.name === newName)) {
                  res.writeHead(409)
                  res.end('New username already exists')
                  return
                }

                console.log(`[RenameUser] Renaming ${name} to ${newName}...`)

                // 1. 断开该用户的连接
                if (wss) {
                  for (const client of wss.clients) {
                    if (client.userInfo?.name === name) client.close(SYNC_CLOSE_CODE.normal)
                  }
                }

                // 2. 释放内存中的用户空间 (清除缓存) 并锁定，防止重命名期间被重新初始化
                renameUserSpace(name)

                // 3. 稍作延迟等待 Socket 释放和可能的异步操作完成 (Windows 友好)
                // 增加到 500ms 以确保稳定性
                setTimeout(() => {
                  try {
                    // 4. 迁移物理数据
                    migrateUserData(name, newName)

                    // 5. 更新内存中的用户信息 (全局配置)
                    user.name = newName

                    handleFinalUpdate()
                  } catch (err: any) {
                    console.error(`[RenameUser] Failed to migrate data: ${err.message}`)
                    res.writeHead(500)
                    res.end(err.message || 'Data Migration Failed')
                  } finally {
                    // 无论成功失败，都解除锁定
                    finishRenameUserSpace(name)
                  }
                }, 500)
              } else {
                handleFinalUpdate()
              }
            } catch (e) {
              console.error('[RenameUser] Error:', e)
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
        if (req.method === 'DELETE') {
          void readBody(req).then(body => {
            try {
              // 修改：同时支持单个 name 和批量 names，以及 deleteData 参数
              const { name, names, deleteData } = JSON.parse(body)
              const targets = names || (name ? [name] : [])

              if (targets.length === 0) {
                res.writeHead(400)
                res.end('Missing name or names')
                return
              }

              let deletedCount = 0
              const deletedUsers: { name: string, dataPath: string }[] = []

              for (const targetName of targets) {
                const idx = global.lx.config.users.findIndex(u => u.name === targetName)
                if (idx !== -1) {
                  const user = global.lx.config.users[idx]

                  // 保存用户数据路径（如果需要删除）
                  console.log(`[DeleteUser] deleteData: ${deleteData}, user.dataPath: ${user.dataPath}`)
                  if (deleteData && user.dataPath) {
                    deletedUsers.push({ name: targetName, dataPath: user.dataPath })
                  } else {
                    console.log(`[DeleteUser] Skipping data deletion for ${targetName}. deleteData=${deleteData}, hasDataPath=${!!user.dataPath}`)
                  }

                  // 断开该用户的连接
                  if (wss) {
                    for (const client of wss.clients) {
                      if (client.userInfo?.name === targetName) client.close(SYNC_CLOSE_CODE.normal)
                    }
                  }
                  global.lx.config.users.splice(idx, 1)
                  deletedCount++
                }
              }

              if (deletedCount > 0) {
                saveUsers()

                // 如果需要删除数据文件夹
                if (deleteData && deletedUsers.length > 0) {
                  console.log(`[DeleteUser] Processing ${deletedUsers.length} data folders deletion...`)
                  for (const user of deletedUsers) {
                    try {
                      console.log(`[DeleteUser] Checking path: ${user.dataPath}`)
                      if (fs.existsSync(user.dataPath)) {
                        fs.rmSync(user.dataPath, { recursive: true, force: true })
                        console.log(`Deleted user data folder: ${user.dataPath}`)
                      } else {
                        console.log(`[DeleteUser] Path not found: ${user.dataPath}`)
                      }
                    } catch (err) {
                      console.error(`Failed to delete user data folder for ${user.name}:`, err)
                      // 继续删除其他用户，不中断流程
                    }
                  }
                } else {
                  console.log('[DeleteUser] No data folders to delete (or deleteData is false)')
                }

                res.writeHead(200)
                res.end(JSON.stringify({ success: true, deletedCount }))
              } else {
                res.writeHead(404)
                res.end('User not found')
              }
            } catch (e) {
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
      }

      if (pathname === '/api/data' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        const isAdminAuth = auth === global.lx.config['frontend.password']
        const userParam = urlObj.searchParams.get('user')

        if (!userParam) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }

        // 鉴权逻辑：管理员 或 公共用户 或 具名用户(需 Token)
        let verifiedUser: string | null = null
        if (isAdminAuth) {
          verifiedUser = userParam // 管理员信任 userParam
        } else if (userParam === 'default' || userParam === '_open') {
          verifiedUser = '_open'
        } else {
          verifiedUser = verifyUserAuth(req)
          if (!verifiedUser || verifiedUser !== userParam) {
            res.writeHead(403)
            res.end('Forbidden: User mismatch or unauthorized')
            return
          }
        }

        const userSpace = getUserSpace(verifiedUser)
        void userSpace.listManage.getListData().then(async data => {
          let albums = []
          let artists = []
          try {
            const userDirname = getUserDirname(verifiedUser)
            const libraryPath = path.join(global.lx.userPath, userDirname, 'library')
            const albumsPath = path.join(libraryPath, 'albums.json')
            const artistsPath = path.join(libraryPath, 'artists.json')
            
            if (await fs.promises.stat(albumsPath).then(()=>true).catch(()=>false)) {
              albums = JSON.parse(await fs.promises.readFile(albumsPath, 'utf8'))
            }
            if (await fs.promises.stat(artistsPath).then(()=>true).catch(()=>false)) {
              artists = JSON.parse(await fs.promises.readFile(artistsPath, 'utf8'))
            }
          } catch(err) {
             console.error(err)
          }

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify({ ...data, albums, artists }))
        }).catch(err => {
          res.writeHead(500)
          res.end(err.message)
        })
        return
      }
      // 获取快照列表
      if (pathname === '/api/data/snapshots' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        const isAdminAuth = auth === global.lx.config['frontend.password']
        const userParam = urlObj.searchParams.get('user')

        if (!userParam) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }

        // 鉴权逻辑
        let verifiedUser: string | null = null
        if (isAdminAuth) {
          verifiedUser = userParam
        } else if (userParam === 'default' || userParam === '_open') {
          verifiedUser = '_open'
        } else {
          verifiedUser = verifyUserAuth(req)
          if (!verifiedUser || verifiedUser !== userParam) {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }
        }

        const userSpace = getUserSpace(verifiedUser)
        try {
          const list = await userSpace.listManage.getSnapshotList()
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(list))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // 下载快照数据
      if (pathname === '/api/data/snapshot' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        const isAdminAuth = auth === global.lx.config['frontend.password']
        const userParam = urlObj.searchParams.get('user')

        if (!userParam) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }

        let verifiedUser: string | null = null
        if (isAdminAuth) {
          verifiedUser = userParam
        } else if (userParam === 'default' || userParam === '_open') {
          verifiedUser = '_open'
        } else {
          verifiedUser = verifyUserAuth(req)
          if (!verifiedUser || verifiedUser !== userParam) {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }
        }

        const userSpace = getUserSpace(verifiedUser)
        const id = urlObj.searchParams.get('id')
        if (!id) {
          res.writeHead(400)
          res.end('Missing id')
          return
        }
        try {
          const data = await userSpace.listManage.getSnapshot(id)
          if (!data) {
            res.writeHead(404)
            res.end('Not Found')
            return
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(data))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // 恢复快照
      if (pathname === '/api/data/restore-snapshot' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        const isAdminAuth = auth === global.lx.config['frontend.password']
        const userParam = urlObj.searchParams.get('user')

        if (!userParam) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }

        let verifiedUser: string | null = null
        if (isAdminAuth) {
          verifiedUser = userParam
        } else if (userParam === 'default' || userParam === '_open') {
          verifiedUser = '_open'
        } else {
          verifiedUser = verifyUserAuth(req)
          if (!verifiedUser || verifiedUser !== userParam) {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }
        }

        const userSpace = getUserSpace(verifiedUser)
        try {
          const body = await readBody(req)
          const { id } = JSON.parse(body)
          if (!id) throw new Error('Missing id')

          await userSpace.listManage.restoreSnapshot(id)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // [新增] Batch Remove Songs from List (User Auth)
      if (pathname === '/api/music/user/list/remove' && req.method === 'POST') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: '需要用户认证' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const { listId, songIds } = JSON.parse(body)

            if (!listId || !Array.isArray(songIds)) {
              res.writeHead(400)
              res.end('参数错误:需要listId和songIds数组')
              return
            }

            console.log(`[UserAPI] 批量删除请求: 用户=${username}, 列表=${listId}, 删除歌曲数=${songIds.length}`)
            console.log(`[UserAPI] 待删除歌曲ID:`, songIds)

            const userSpace = getUserSpace(username)

            // Get list before deletion
            const listBefore = await userSpace.listManage.listDataManage.getListMusics(listId)
            console.log(`[UserAPI] 删除前列表歌曲数: ${listBefore.length}`)

            // Remove songs from the list
            const affectedLists = await userSpace.listManage.listDataManage.listMusicRemove(listId, songIds)
            console.log(`[UserAPI] 受影响的列表:`, affectedLists)

            // Get list after deletion  
            const listAfter = await userSpace.listManage.listDataManage.getListMusics(listId)
            console.log(`[UserAPI] 删除后列表歌曲数: ${listAfter.length}`)

            // Create new snapshot to persist changes
            const newSnapshotKey = await userSpace.listManage.createSnapshot()
            console.log(`[UserAPI] 批量删除成功,已创建新快照: ${newSnapshotKey}`)

            res.writeHead(200)
            res.end('删除成功')
          } catch (err: any) {
            console.error('[UserAPI] 批量删除失败:', err)
            res.writeHead(500)
            res.end(err.message || '删除失败')
          }
        })
        return
      }

      // [新增] Batch Add Songs to List (User Auth)
      if (pathname === '/api/music/user/list/add' && req.method === 'POST') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: '需要用户认证' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const { listId, musicInfos, location } = JSON.parse(body)

            if (!listId || !Array.isArray(musicInfos)) {
              res.writeHead(400)
              res.end('参数错误:需要listId和musicInfos数组')
              return
            }

            console.log(`[UserAPI] 批量添加请求: 用户=${username}, 列表=${listId}, 添加歌曲数=${musicInfos.length}`)

            const userSpace = getUserSpace(username)

            // Add songs to the list
            const addMusicLocationType = location === 'top' || location === 'bottom'
              ? location
              : getUserConfig(username)['list.addMusicLocationType']
            await userSpace.listManage.listDataManage.listMusicAdd(listId, musicInfos, addMusicLocationType)

            // Create new snapshot to persist changes
            const newSnapshotKey = await userSpace.listManage.createSnapshot()
            console.log(`[UserAPI] 批量添加成功,已创建新快照: ${newSnapshotKey}`)

            res.writeHead(200)
            res.end('添加成功')
          } catch (err: any) {
            console.error('[UserAPI] 批量添加失败:', err)
            res.writeHead(500)
            res.end(err.message || '添加失败')
          }
        })
        return
      }



      // [新增] 删除快照 API
      if (pathname === '/api/data/delete-snapshot' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        const isAdminAuth = auth === global.lx.config['frontend.password']
        const userParam = urlObj.searchParams.get('user')

        if (!userParam) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }

        let verifiedUser: string | null = null
        if (isAdminAuth) {
          verifiedUser = userParam
        } else if (userParam === 'default' || userParam === '_open') {
          verifiedUser = '_open'
        } else {
          verifiedUser = verifyUserAuth(req)
          if (!verifiedUser || verifiedUser !== userParam) {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }
        }

        const userSpace = getUserSpace(verifiedUser)
        try {
          const body = await readBody(req)
          const { id } = JSON.parse(body)
          if (!id) throw new Error('Missing id')

          // 调用刚刚在 ListManage 中添加的方法
          await userSpace.listManage.removeSnapshot(id)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }
      // [新增] 上传快照 API
      if (pathname === '/api/data/upload-snapshot' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        const isAdminAuth = auth === global.lx.config['frontend.password']
        const userParam = urlObj.searchParams.get('user')
        const time = parseInt(urlObj.searchParams.get('time') || '0')
        const filename = urlObj.searchParams.get('filename')

        if (!userParam) {
          res.writeHead(400)
          res.end('Missing user param')
          return
        }

        let verifiedUser: string | null = null
        if (isAdminAuth) {
          verifiedUser = userParam
        } else if (userParam === 'default' || userParam === '_open') {
          verifiedUser = '_open'
        } else {
          verifiedUser = verifyUserAuth(req)
          if (!verifiedUser || verifiedUser !== userParam) {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }
        }

        if (!filename) {
          res.writeHead(400)
          res.end('Missing filename param')
          return
        }

        const userSpace = getUserSpace(verifiedUser)

        try {
          const body = await readBody(req)
          let finalData = body

          // [核心兼容性修复] 检测是否为落雪音乐离线备份格式 (playList_v2)
          try {
            const jsonData = JSON.parse(body)
            if (jsonData && jsonData.type === 'playList_v2' && Array.isArray(jsonData.data)) {
              startupLog.info(`[Snapshot] Detected LX Music backup format for user ${verifiedUser}, converting back to internal format...`)

              // 寻找默认列表
              const defaultList = jsonData.data.find((l: any) => l.id === 'default')?.list || []
              // 寻找收藏列表
              const loveList = jsonData.data.find((l: any) => l.id === 'love')?.list || []
              // 其他所有列表均作为用户列表
              const userList = jsonData.data.filter((l: any) => l.id !== 'default' && l.id !== 'love')

              // 拼装为服务器内部快照格式
              const internalFormat = {
                defaultList,
                loveList,
                userList
              }

              // 压缩为单行 JSON 以节省磁盘空间并保持与原生快照一致的大小
              finalData = JSON.stringify(internalFormat)
              startupLog.info(`[Snapshot] Conversion complete for user ${verifiedUser}.`)
            }
          } catch (parseErr) {
            // 解析失败说明不是标准的 JSON 格式或已经是原始快照，保持原样即可
          }

          // 处理文件名：如果以 snapshot_ 开头，则去掉（因为 saveSnapshotWithTime 会自动加）
          // 如果不以 snapshot_ 开头，则保持原样（saveSnapshotWithTime 会自动加 snapshot_ 前缀）
          let name = filename
          if (name.startsWith('snapshot_')) {
            name = name.substring(9)
          }

          // 调用 ListManage 中的 saveSnapshotWithTime 方法
          await userSpace.listManage.saveSnapshotWithTime(name, finalData, time)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(err.message)
        }
        return
      }

      // [新增] User Login Verification
      if (pathname === '/api/user/verify' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { username, password } = JSON.parse(body)
            if (!username || !password) {
              res.writeHead(400)
              res.end('Missing username or password')
              return
            }
            const user = global.lx.config.users.find(u => u.name === username && u.password === password)
            if (user) {
              loginLog.info(`User login success: ${username} from ${ip}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              loginLog.warn(`User login failed: ${username} from ${ip}`)
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }))
            }
          } catch (e) {
            res.writeHead(400)
            res.end('Bad Request')
          }
        })
        return
      }

      // [新增] 用户登录 - 颁发 Token（替代明文密码传输）
      if (pathname === '/api/user/login' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { username, password } = JSON.parse(body)
            if (!username || !password) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Missing username or password' }))
              return
            }
            const user = global.lx.config.users.find((u: any) => u.name === username && u.password === password)
            if (user) {
              const token = generateSessionId()
              userSessions.set(token, { username, createdAt: Date.now() })
              loginLog.info(`User token issued: ${username} from ${ip}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, token, username }))
            } else {
              loginLog.warn(`User login failed: ${username} from ${ip}`)
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }))
            }
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Bad Request' }))
          }
        })
        return
      }

      // [新增] 用户登出 - 注销 Token
      if (pathname === '/api/user/logout' && req.method === 'POST') {
        const token = req.headers['x-user-token'] as string
        if (token) userSessions.delete(token)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // [新增] Token 有效性检查
      if (pathname === '/api/user/auth/verify' && req.method === 'GET') {
        const username = verifyUserAuth(req)
        const valid = !!username
        let enableCustomMusicDir = false
        let allowOperateCustomMusicDir = false
        if (username) {
          const user = global.lx.config.users.find(u => u.name === username)
          // 全局总开关 user.enableCustomMusicDir 必须为 true，才读取用户自身配置
          const globalSwitch = !!global.lx.config['user.enableCustomMusicDir']
          if (user && globalSwitch) {
            enableCustomMusicDir = !!user.enableCustomMusicDir
            allowOperateCustomMusicDir = !!user.allowOperateCustomMusicDir
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ valid, username: username || null, enableCustomMusicDir, allowOperateCustomMusicDir }))
        return
      }

      // [新增] Get User List (User Auth)
      // [新增] Get User List (User Auth)
      if (pathname === '/api/user/list' && req.method === 'GET') {
        const targetUserParam = urlObj.searchParams.get('user')
        const reqUsername = (req.headers['x-user-name'] as string) || targetUserParam || ''
        const auth = req.headers['x-frontend-auth']
        const isAdmin = !!(auth && auth === global.lx.config['frontend.password'])
        let username: string | null = null

        const canAccessOpen = global.lx.config['user.enablePublicFavorites'] && (
          global.lx.config['user.enablePublicNonAdminAccess'] || isAdmin || !!verifyUserAuth(req)
        )
        if (targetUserParam === '_open' || reqUsername === '_open' || (!reqUsername && !verifyUserAuth(req))) {
          if (canAccessOpen) {
            username = '_open'
          }
        }
        if (!username) {
          username = verifyUserAuth(req)
        }
        if (!username && reqUsername && reqUsername !== '_open') {
          username = reqUsername
        }


        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        const userSpace = getUserSpace(username)
        void userSpace.listManage.getListData().then(data => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(data))
        }).catch(err => {
          res.writeHead(500)
          res.end(err.message)
        })
        return
      }

      // [新增] Update User List (User Auth) - Full Restore/Overwrite
      if (pathname === '/api/user/list' && req.method === 'POST') {
        const targetUserParam = urlObj.searchParams.get('user')
        const reqUsername = (req.headers['x-user-name'] as string) || targetUserParam || ''
        const auth = req.headers['x-frontend-auth']
        const isAdmin = !!(auth && auth === global.lx.config['frontend.password'])
        let username: string | null = null

        const canAccessOpen = global.lx.config['user.enablePublicFavorites'] && (
          global.lx.config['user.enablePublicNonAdminAccess'] || isAdmin || !!verifyUserAuth(req)
        )
        if (targetUserParam === '_open' || reqUsername === '_open' || (!reqUsername && !verifyUserAuth(req))) {
          if (!canAccessOpen) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '权限不足：未开启公开访问。' }))
            return
          }
          if (auth !== global.lx.config['frontend.password']) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '权限不足：公共歌单修改受限，请先验证管理员身份。' }))
            return
          }
          username = '_open'
        }
        if (!username) {
          username = verifyUserAuth(req)
        }
        if (!username && reqUsername && reqUsername !== '_open') {
          username = reqUsername
        }


        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const listData = JSON.parse(body)
            const userSpace = getUserSpace(username!)
            // Restore ensures consistency with the provided snapshot
            await userSpace.listManage.listDataManage.restore(listData)
            // Create a snapshot after update
            await userSpace.listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // [新增] 用户 Library API — 收藏歌手 & 收藏专辑
      const getLibUsername = (req: any): string | null => {
        const url = new URL(req.url || '', 'http://localhost')
        const userParam = url.searchParams.get('user') || ''
        const reqUsername = (req.headers['x-user-name'] as string) || userParam
        const auth = req.headers['x-frontend-auth']
        const isAdmin = !!(auth && auth === global.lx.config['frontend.password'])

        const canAccessOpen = global.lx.config['user.enablePublicFavorites'] && (
          global.lx.config['user.enablePublicNonAdminAccess'] || isAdmin || !!verifyUserAuth(req)
        )
        if ((reqUsername === '_open' || userParam === '_open' || (!reqUsername && !verifyUserAuth(req))) && canAccessOpen) {
          return '_open'
        }

        let username = verifyUserAuth(req)
        if (!username && reqUsername && reqUsername !== '_open') {
          username = reqUsername
        }
        return username || '_open'
      }

      // GET /api/user/library/artists  — 读取收藏歌手列表
      if (pathname === '/api/user/library/artists' && req.method === 'GET') {
        const username = getLibUsername(req)
        if (!username) { res.writeHead(401); res.end('Unauthorized'); return }
        const userDirname = getUserDirname(username)
        const libDir = path.join(global.lx.userPath, userDirname, 'library')
        if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true })
        const filePath = path.join(libDir, 'artists.json')
        try {
          if (!fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return
          }
          const data = fs.readFileSync(filePath, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(data)
        } catch (e: any) { res.writeHead(500); res.end(e.message) }
        return
      }

      // POST /api/user/library/artists  — 完整覆盖写入收藏歌手列表
      if (pathname === '/api/user/library/artists' && req.method === 'POST') {
        const username = getLibUsername(req)
        if (!username) { res.writeHead(401); res.end('Unauthorized'); return }
        void readBody(req).then(body => {
          try {
            const parsed = JSON.parse(body)
            if (!Array.isArray(parsed)) throw new Error('Expected an array')
            const userDirname = getUserDirname(username)
            const libDir = path.join(global.lx.userPath, userDirname, 'library')
            if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true })
            fs.writeFileSync(path.join(libDir, 'artists.json'), JSON.stringify(parsed, null, 2), 'utf-8')
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true }))
          } catch (e: any) { res.writeHead(400); res.end(e.message) }
        })
        return
      }

      // GET /api/user/library/albums  — 读取收藏专辑列表
      if (pathname === '/api/user/library/albums' && req.method === 'GET') {
        const username = getLibUsername(req)
        if (!username) { res.writeHead(401); res.end('Unauthorized'); return }
        const userDirname = getUserDirname(username)
        const libDir = path.join(global.lx.userPath, userDirname, 'library')
        if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true })
        const filePath = path.join(libDir, 'albums.json')
        try {
          if (!fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return
          }
          const data = fs.readFileSync(filePath, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(data)
        } catch (e: any) { res.writeHead(500); res.end(e.message) }
        return
      }

      // POST /api/user/library/albums  — 完整覆盖写入收藏专辑列表
      if (pathname === '/api/user/library/albums' && req.method === 'POST') {
        const username = getLibUsername(req)
        if (!username) { res.writeHead(401); res.end('Unauthorized'); return }
        void readBody(req).then(body => {
          try {
            const parsed = JSON.parse(body)
            if (!Array.isArray(parsed)) throw new Error('Expected an array')
            const userDirname = getUserDirname(username)
            const libDir = path.join(global.lx.userPath, userDirname, 'library')
            if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true })
            fs.writeFileSync(path.join(libDir, 'albums.json'), JSON.stringify(parsed, null, 2), 'utf-8')
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true }))
          } catch (e: any) { res.writeHead(400); res.end(e.message) }
        })
        return
      }

      // [新增] Get User Settings (User Auth)
      if (pathname === '/api/user/settings' && req.method === 'GET') {
        const reqUsername = req.headers['x-user-name'] as string
        const isPublic = !reqUsername || reqUsername === 'default'
        let resolvedUsername: string | null = null

        if (isPublic && global.lx.config['user.enablePublicRestriction']) {
          resolvedUsername = '_open' // 公开受限用户允许访问 _open 空间
        } else {
          resolvedUsername = verifyUserAuth(req)
          if (!resolvedUsername) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
        }

        const userSpace = getUserSpace(resolvedUsername)
        const settingsPath = path.join(userSpace.dataManage.userDir, File.userSettingsJSON)

        if (fs.existsSync(settingsPath)) {
          const settingsData = fs.readFileSync(settingsPath, 'utf8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(settingsData)
        } else {
          // Return empty object instead of 404 to avoid console error on fresh installs
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{}')
        }
        return
      }

      // [新增] Update User Settings (User Auth)
      if (pathname === '/api/user/settings' && req.method === 'POST') {
        const reqUsername = req.headers['x-user-name'] as string
        const isPublic = !reqUsername || reqUsername === 'default'
        let resolvedUsername: string | null = null

        if (isPublic) {
          // 公开用户：若开启了限制，需要管理员密码
          if (global.lx.config['user.enablePublicRestriction']) {
            const auth = req.headers['x-frontend-auth']
            if (auth !== global.lx.config['frontend.password']) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: '权限不足：公共用户保存设置受限，请先验证管理员身份。' }))
              return
            }
          }
          resolvedUsername = '_open'
        } else {
          resolvedUsername = verifyUserAuth(req)
          if (!resolvedUsername) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
        }

        void readBody(req).then(body => {
          try {
            const userSpace = getUserSpace(resolvedUsername!)
            const settingsPath = path.join(userSpace.dataManage.userDir, File.userSettingsJSON)

            let settings = JSON.parse(body)

            // [核心逻辑] 如果是受限的公开用户，仅允许保存特定的 3 项设置
            if (resolvedUsername === '_open' && global.lx.config['user.enablePublicRestriction']) {
              const restrictedSettings: any = {}
              const allowedKeys = ['enableServerCache', 'enableServerLyricCache', 'serverCacheLocation', 'serverCacheNamingPattern', 'downloadConcurrency', 'enableRemaster', 'preferredQuality', 'enableOnlyDownloadMode', 'enablePublicSources', 'embedLyricToFile', 'preferServerCache']
              allowedKeys.forEach(key => {
                if (settings[key] !== undefined) restrictedSettings[key] = settings[key]
              })
              settings = restrictedSettings
            }

            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(400)
            res.end('Invalid JSON data')
          }
        })
        return
      }

      // [核心路由记录] Token 管理相关 API
      // 1. 获取/更新 Token 配置 (开启状态及列表)
      if (pathname === '/api/user/token/config') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        if (req.method === 'GET') {
          const config = getUserTokenConfig(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            config: {
              enabled: config.enabled,
              tokens: config.tokens
            }
          }))
        } else if (req.method === 'POST') {
          void readBody(req).then(body => {
            try {
              const { enabled } = JSON.parse(body)
              const config = getUserTokenConfig(username)
              const newEnabled = !!enabled

              // 只有状态发生物理改变（从 True 到 False 或反之）时才处理
              if (config.enabled !== newEnabled) {
                config.enabled = newEnabled
                saveUserTokenConfig(username, config) // 这里内部会自动更新内存缓存逻辑
                tokenLog.info(`User ${username} ${newEnabled ? 'enabled' : 'disabled'} persistent token auth`)
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } catch (e) {
              res.writeHead(400)
              res.end('Invalid Body')
            }
          })
        }
        return
      }

      // 3. 生成新 Token
      if (pathname === '/api/user/token/add' && req.method === 'POST') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(body => {
          try {
            const { name, expireDays, expiresAt } = JSON.parse(body)
            const config = getUserTokenConfig(username)
            const newTokenValue = `lx_tk_${crypto.randomBytes(16).toString('hex')}`
            const newToken: UserToken = {
              name: name || '未命名 Token',
              token: newTokenValue,
              createdAt: Date.now(),
              expiresAt: (expiresAt !== undefined && expiresAt !== null) ? expiresAt : (expireDays ? Date.now() + (expireDays * 24 * 60 * 60 * 1000) : null),
              lastUsed: undefined
            }
            config.tokens.push(newToken)
            saveUserTokenConfig(username, config)
            tokenLog.info(`User ${username} generated a new token: ${name}`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, token: newTokenValue }))
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }

      // 3. 删除 Token
      if (pathname === '/api/user/token/remove' && req.method === 'POST') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(body => {
          try {
            const { token, tokenMasked } = JSON.parse(body)
            // 优先使用完整 Token 删除，兼容旧的 tokenMasked
            const target = token || tokenMasked
            if (!target) {
              res.writeHead(400)
              res.end('Missing token identifier')
              return
            }

            const config = getUserTokenConfig(username)
            const initialCount = config.tokens.length

            config.tokens = config.tokens.filter(t => {
              if (target.startsWith('lx_tk_')) {
                return t.token !== target
              }
              // 回退：使用脱敏串匹配
              const m = `${t.token.slice(0, 6)}...${t.token.slice(-4)}`
              return m !== target
            })

            if (config.tokens.length !== initialCount) {
              saveUserTokenConfig(username, config)
              tokenLog.info(`User ${username} removed a token identifier: ${target.length > 20 ? target.slice(0, 10) + '...' : target}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              // 注意：这里返回 404 表明没找到，前端会显示删除失败
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Token not found' }))
            }
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }

      // 4. 更新 Token 信息 (名称/有效期)
      if (pathname === '/api/user/token/update' && req.method === 'POST') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(body => {
          try {
            const { tokenMasked, name, expireDays, expiresAt } = JSON.parse(body)
            const config = getUserTokenConfig(username)
            const tokenItem = config.tokens.find(t => {
              const masked = `${t.token.slice(0, 6)}...${t.token.slice(-4)}`
              return masked === tokenMasked
            })

            if (tokenItem) {
              if (name !== undefined) tokenItem.name = name
              if (expiresAt !== undefined) {
                tokenItem.expiresAt = expiresAt
              } else if (expireDays !== undefined) {
                tokenItem.expiresAt = expireDays ? Date.now() + (expireDays * 24 * 60 * 60 * 1000) : null
              }
              saveUserTokenConfig(username, config)
              tokenLog.info(`User ${username} updated token config: ${tokenMasked}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              res.writeHead(404)
              res.end('Token not found')
            }
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }

      // 5. 切换 Token 启用/禁用状态
      if (pathname === '/api/user/token/toggle' && req.method === 'POST') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(body => {
          try {
            const { tokenMasked, disabled } = JSON.parse(body)
            const config = getUserTokenConfig(username)
            const tokenItem = config.tokens.find(t => {
              const masked = `${t.token.slice(0, 6)}...${t.token.slice(-4)}`
              return masked === tokenMasked
            })

            if (tokenItem) {
              tokenItem.disabled = !!disabled
              saveUserTokenConfig(username, config)
              tokenLog.info(`User ${username} ${disabled ? 'disabled' : 'enabled'} token: ${tokenMasked}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Token not found' }))
            }
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }

      // 5. 获取特定 Token 的审计日志
      if (pathname === '/api/user/token/logs' && req.method === 'GET') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        const tokenMaskedRaw = urlObj.searchParams.get('tokenMasked')
        const tokenMasked = tokenMaskedRaw ? decodeURIComponent(tokenMaskedRaw).trim() : ''

        if (!tokenMasked) {
          res.writeHead(400)
          res.end('Missing tokenMasked')
          return
        }

        try {
          // [路径修正] 直接指向根目录 logs/token.log (不依赖 global.lx.dataPath 下的 logs)
          const logPath = path.join(process.cwd(), 'logs', 'token.log')
          let logs: string[] = []
          if (fs.existsSync(logPath)) {
            const content = fs.readFileSync(logPath, 'utf8')
            logs = content.split('\n')
              .filter(line => line.trim().includes(tokenMasked))
              .reverse()
              .slice(0, 50)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, logs }))
        } catch (e) {
          res.writeHead(500)
          res.end('Error reading logs')
        }
        return
      }

      // [新增] Get User Sound Effects (User Auth)
      if (pathname === '/api/user/sound-effects' && req.method === 'GET') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        const userSpace = getUserSpace(username)
        const soundEffectsPath = path.join(userSpace.dataManage.userDir, File.userSoundEffectsJSON)

        if (fs.existsSync(soundEffectsPath)) {
          const soundEffectsData = fs.readFileSync(soundEffectsPath, 'utf8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(soundEffectsData)
        } else {
          // Return empty object instead of 404 to avoid console error on fresh installs
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{}')
        }
        return
      }

      // [新增] Update User Sound Effects (User Auth)
      if (pathname === '/api/user/sound-effects' && req.method === 'POST') {
        const username = verifyUserAuth(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(body => {
          try {
            const userSpace = getUserSpace(username)
            const soundEffectsPath = path.join(userSpace.dataManage.userDir, File.userSoundEffectsJSON)

            // Validate JSON
            JSON.parse(body)

            fs.writeFileSync(soundEffectsPath, body, 'utf8')
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(400)
            res.end('Invalid JSON data')
          }
        })
        return
      }

      // Local music remaster APIs use the same account access rules as other cache operations.
      if (pathname.startsWith('/api/music/remaster/')) {
        const username = getCacheRequestUsername(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        if (pathname === '/api/music/remaster/start' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req))
            const explicitIsCustomDir = body?.isCustomDir === undefined ? undefined : Boolean(body?.isCustomDir)
            
            if (explicitIsCustomDir) {
              const userCfg = getUserConfig(username)
              if (!userCfg?.allowOperateCustomMusicDir) {
                res.writeHead(403, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, message: '管理员未允许操作自定义目录中的文件' }))
                return
              }
            }

            const data = await remasterQueue.start(username, String(body?.targetQuality || ''), body?.filenames, explicitIsCustomDir)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, data }))
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: err?.message || '启动洗版失败' }))
          }
          return
        }

        if (pathname === '/api/music/remaster/status' && req.method === 'GET') {
          const offset = Number(urlObj.searchParams.get('offset') || 0)
          const limit = Number(urlObj.searchParams.get('limit') || 200)
          const data = remasterQueue.getStatus(username, offset, limit)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data }))
          return
        }

        if (pathname === '/api/music/remaster/cancel' && req.method === 'POST') {
          const cancelled = remasterQueue.cancel(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { cancelled } }))
          return
        }

        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, message: 'Not Found' }))
        return
      }

      // [新增] File Cache APIs
      // 1. Config Cache Location
      if (pathname === '/api/music/cache/config' && req.method === 'POST') {
        const reqUsername = req.headers['x-user-name'] as string
        const isPublic = !reqUsername || reqUsername === 'default'

        // 具名用户必须通过 Token（或兼容密码）验证身份
        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
        }

        void readBody(req).then(async body => {
          try {
            const { location, namingPattern } = JSON.parse(body)
            let updated = false

            if (location) {
              if (location !== fileCache.getCacheLocation()) {
                // 公开用户：需要管理员密码才能修改
                if (isPublic && global.lx.config['user.enablePublicRestriction']) {
                  const auth = req.headers['x-frontend-auth']
                  if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(403, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ success: false, error: '权限不足：公共用户修改缓存位置受限，请输入管理员密码。' }))
                    return
                  }
                }
                fileCache.setCacheLocation(location)
                updated = true
              }
            }

            if (namingPattern) {
              const normalizedNamingPattern = fileCache.setNamingPattern(namingPattern)
              if (global.lx.config) global.lx.config['cache.namingPattern'] = normalizedNamingPattern
              updated = true
            }

            if (updated) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true }))
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: true, message: 'No changes' }))
            }
          } catch (e) {
            res.writeHead(500)
            res.end('Error')
          }
        })
        return
      }

      // 1.05 Get Real Cache & Download Directories
      if (pathname === '/api/music/cache/directories' && req.method === 'GET') {
        const parsedUrl = url.parse(req.url || '', true)
        const locationQuery = (parsedUrl.query.location as string) || undefined
        const onlyDownloadQuery = parsedUrl.query.onlyDownload === 'true' || parsedUrl.query.onlyDownload === '1'

        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        const effectiveLocation = locationQuery || fileCache.getCacheLocation()
        const cacheDir = fileCache.getCacheDir(username, false, effectiveLocation)
        const downloadDir = fileCache.getCacheDir(username, true, effectiveLocation)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          data: {
            username,
            location: effectiveLocation,
            isOnlyDownloadMode: onlyDownloadQuery,
            isSameDirectory: !onlyDownloadQuery,
            cacheDirectory: cacheDir,
            downloadDirectory: onlyDownloadQuery ? downloadDir : cacheDir,
            rawDownloadDirectory: downloadDir,
            rootType: effectiveLocation === 'data' ? 'DATA_PATH (WebDAV同步)' : '运行目录 (仅本地)',
            isWebDAVSynced: effectiveLocation === 'data'
          }
        }))
        return
      }

      // 1.1 Sync Cache Index
      if (pathname === '/api/music/cache/sync' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        try {
          await fileCache.syncCacheIndex(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, message: 'Sync completed' }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Sync failed: ' + (e as any).message }))
        }
        return
      }

      // 1.1-B Get Subdirectories
      if (pathname === '/api/music/cache/subdirs' && req.method === 'GET') {
        const reqUsername = (req.headers['x-user-name'] as string) || urlObj.searchParams.get('user') || ''
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        const folder = (urlObj.searchParams.get('folder') as 'cache' | 'music') || 'music'
        const subdirs = fileCache.getSubDirectories(username, folder)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: subdirs }))
        return
      }

      // 1.1-C Create Subdirectory
      if (pathname === '/api/music/cache/mkdir' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        void readBody(req).then(body => {
          try {
            const { folder, subPath } = JSON.parse(body)
            if (!folder || !subPath) {
              res.writeHead(400)
              res.end('Missing params')
              return
            }
            const success = fileCache.createSubDirectory(username, folder, subPath)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success }))
          } catch (e) {
            res.writeHead(500)
            res.end('Error')
          }
        })
        return
      }

      // 1.1-D Categorize Files
      if (pathname === '/api/music/cache/categorize' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        void readBody(req).then(async body => {
          try {
            const { filenames, subPath } = JSON.parse(body)
            if (!Array.isArray(filenames)) {
              res.writeHead(400)
              res.end('Missing params')
              return
            }
            const result = await fileCache.categorizeFiles(filenames, subPath, username)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, ...result }))
          } catch (e) {
            res.writeHead(500)
            res.end('Error')
          }
        })
        return
      }

      // 1.1-E Rename Subdirectory
      if (pathname === '/api/music/cache/subdirs/rename' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const auth = req.headers['x-frontend-auth']
        const isAdmin = !!(auth && auth === global.lx.config['frontend.password'])
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (isPublic) {
          if (!isAdmin) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: '权限不足：修改公共本地分类需要验证管理员权限。' }))
            return
          }
        } else {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        void readBody(req).then(body => {
          try {
            const { folder = 'music', oldSubPath, newSubPath } = JSON.parse(body)
            if (!oldSubPath || !newSubPath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: '缺少参数' }))
              return
            }
            const result = fileCache.renameSubDirectory(username, folder, oldSubPath.trim(), newSubPath.trim())
            res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e?.message || 'Server error' }))
          }
        })
        return
      }

      // 检查文件夹是否有效
      if (pathname === '/api/utils/check-dir' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        void readBody(req).then(body => {
          try {
            const { dirPath } = JSON.parse(body)
            if (!dirPath || typeof dirPath !== 'string' || !dirPath.trim()) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: '请输入路径' }))
              return
            }
            const absolutePath = path.resolve(dirPath.trim())
            if (!fs.existsSync(absolutePath)) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: '目录不存在，请检查路径是否正确' }))
              return
            }
            const stat = fs.statSync(absolutePath)
            if (!stat.isDirectory()) {
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: '指定路径不是一个有效的目录' }))
              return
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, message: '目录可用', path: absolutePath }))
          } catch (e: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e?.message || '检测目录发生错误' }))
          }
        })
        return
      }

      // 1.1-F Delete Subdirectory
      if (pathname === '/api/music/cache/subdirs/delete' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const auth = req.headers['x-frontend-auth']
        const isAdmin = !!(auth && auth === global.lx.config['frontend.password'])
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (isPublic) {
          if (!isAdmin) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: '权限不足：删除公共本地分类需要验证管理员权限。' }))
            return
          }
        } else {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        void readBody(req).then(body => {
          try {
            const { folder = 'music', subPath, deleteSongs = false } = JSON.parse(body)
            if (!subPath) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: '缺少 subPath 参数' }))
              return
            }
            const result = fileCache.deleteSubDirectory(username, folder, subPath.trim(), !!deleteSongs)
            res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e?.message || 'Server error' }))
          }
        })
        return
      }

      // 1.2 Batch Rename Cache Files
      if (pathname === '/api/music/cache/rename' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        try {
          const result = await fileCache.batchRenameCacheFiles(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Rename failed: ' + (e as any).message }))
        }
        return
      }

      // 2. Check Cache
      if (pathname === '/api/music/cache/check' && req.method === 'GET') {
        const name = urlObj.searchParams.get('name')
        const singer = urlObj.searchParams.get('singer')
        const source = urlObj.searchParams.get('source')
        const songmid = urlObj.searchParams.get('songmid')
        const songId = urlObj.searchParams.get('songId')
        const quality = urlObj.searchParams.get('quality')
        const exactQuality = urlObj.searchParams.get('exactQuality') === '1' || urlObj.searchParams.get('exactQuality') === 'true'

        if (!name || !singer || !source || (!songmid && !songId)) {
          res.writeHead(400)
          res.end('Missing params')
          return
        }

        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        const result = fileCache.checkCache({ name, singer, source, songmid, songId, quality, exactQuality }, username)
        if (result && result.exists && username !== '_open' && username !== 'default') {
          const token = req.headers['x-user-token']
          if (token) {
            result.url += `&token=${encodeURIComponent(token as string)}`
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
        return
      }

      // Persistent server download queue. These tasks continue after the browser closes.
      if (pathname === '/api/music/cache/queue' && req.method === 'GET') {
        const username = getCacheRequestUsername(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: serverDownloadQueue.list(username) }))
        return
      }

      if (pathname === '/api/music/cache/queue' && req.method === 'POST') {
        const username = getCacheRequestUsername(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        const auth = req.headers['x-frontend-auth']
        const isPublic = username === '_open'
        const isAdmin = auth === global.lx.config['frontend.password'] || username === 'admin'
        const enablePublicRestriction = global.lx.config['user.enablePublicRestriction']
        const isServerCacheAllowed = global.lx.config['user.enablePublicNonAdminServerCache'] !== false

        if (enablePublicRestriction && !isServerCacheAllowed && isPublic && !isAdmin) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: '权限限制：非管理员服务器缓存已被禁用' }))
          return
        }

        void readBody(req).then(body => {
          try {
            const { tasks, namingPattern, concurrency } = JSON.parse(body)
            if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('Missing tasks')
            if (concurrency !== undefined) serverDownloadQueue.setConcurrency(username, concurrency)
            if (namingPattern) {
              const auth = req.headers['x-frontend-auth']
              if (auth === global.lx.config['frontend.password']) {
                const normalizedNamingPattern = fileCache.setNamingPattern(namingPattern)
                if (global.lx.config) global.lx.config['cache.namingPattern'] = normalizedNamingPattern
              }
            }
            const queued = serverDownloadQueue.enqueue(username, tasks)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, data: queued }))
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: err.message || 'Invalid queue request' }))
          }
        })
        return
      }

      if (pathname === '/api/music/cache/queue/concurrency' && req.method === 'POST') {
        const username = getCacheRequestUsername(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        void readBody(req).then(body => {
          try {
            const { concurrency } = JSON.parse(body)
            const savedConcurrency = serverDownloadQueue.setConcurrency(username, concurrency)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, data: { concurrency: savedConcurrency } }))
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: err.message || 'Invalid concurrency' }))
          }
        })
        return
      }

      if (pathname === '/api/music/cache/queue/resume' && req.method === 'POST') {
        const username = getCacheRequestUsername(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        void readBody(req).then(body => {
          try {
            const { id, all } = JSON.parse(body)
            if (all !== true && !id) throw new Error('Missing queue task id')
            serverDownloadQueue.resume(username, all ? undefined : id)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      if (pathname === '/api/music/cache/queue/remove' && req.method === 'POST') {
        const username = getCacheRequestUsername(req)
        if (!username) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        void readBody(req).then(body => {
          try {
            const options = JSON.parse(body)
            if (!options || (options.all !== true && options.completed !== true && !options.id)) throw new Error('Missing queue removal option')
            serverDownloadQueue.remove(username, options)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      // 3. Trigger Download
      if (pathname === '/api/music/cache/download' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { songInfo, url, quality, enableOnlyDownloadMode, namingPattern, cacheLyric, embedLyric, requestedSource, downloadSource, sourceName } = JSON.parse(body)
            if (!songInfo || !url) {
              res.writeHead(400)
              res.end('Missing params')
              return
            }

            // Fire and forget (background download) with Abort support
            const reqUsername = (req.headers['x-user-name'] as string) || ''
            const isPublic = !reqUsername || reqUsername === 'default'
            let username = '_open'

            if (!isPublic) {
              const verified = verifyUserAuth(req)
              if (!verified) {
                res.writeHead(401, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
                return
              }
              username = verified
            }

            const auth = req.headers['x-frontend-auth']
            const isAdmin = auth === global.lx.config['frontend.password'] || username === 'admin'
            const enablePublicRestriction = global.lx.config['user.enablePublicRestriction']
            const isServerCacheAllowed = global.lx.config['user.enablePublicNonAdminServerCache'] !== false

            if (enablePublicRestriction && !isServerCacheAllowed && isPublic && !isAdmin) {
              res.writeHead(403, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: '权限限制：非管理员服务器缓存已被禁用' }))
              return
            }
            if (namingPattern) {
              const auth = req.headers['x-frontend-auth']
              if (auth === global.lx.config['frontend.password']) {
                const normalizedNamingPattern = fileCache.setNamingPattern(namingPattern)
                if (global.lx.config) global.lx.config['cache.namingPattern'] = normalizedNamingPattern
              }
            }
            const songKey = fileCache.normalizeSongId(songInfo) + '_' + (quality || 'unknown')

            console.log(`[Cache] Registering active task: ${songKey} for user: "${username}"`)

            const controller = new AbortController()
            let userTasks = fileCache.activeTasks.get(username)
            if (!userTasks) {
              userTasks = []
              fileCache.activeTasks.set(username, userTasks)
            }
            userTasks.push({ songKey, controller })

            void fileCache.downloadAndCache(songInfo, url, quality, username, controller.signal, !!enableOnlyDownloadMode, cacheLyric !== false, embedLyric !== false, {
              requestedSource: requestedSource || songInfo.source,
              downloadSource,
              sourceName,
            })
              .then(() => console.log(`[Cache] Downloaded ${songInfo.name} for ${username || '_open'}`))
              .catch((err: any) => {
                if (err.message === 'Aborted') {
                  console.log(`[Cache] Task aborted for ${songInfo.name}`)
                } else {
                  console.error(`[Cache] Failed to download ${songInfo.name}:`, err)
                }
              })
              .finally(() => {
                // Cleanup active task
                const tasks = fileCache.activeTasks.get(username)
                if (tasks) {
                  const idx = tasks.findIndex(t => t.songKey === songKey)
                  if (idx !== -1) {
                    tasks.splice(idx, 1)
                    console.log(`[Cache] Cleaned up active task: ${songKey} for user: "${username}"`)
                  }
                }
              })

            res.writeHead(200)
            res.end(JSON.stringify({ success: true, message: 'Download started' }))
          } catch (e) {
            res.writeHead(500)
            res.end('Error')
          }
        })
        return
      }

      // [New] Stop Cache Task
      if (pathname === '/api/music/cache/stop' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        void readBody(req).then(body => {
          try {
            const { songKey, queueId, all } = JSON.parse(body)
            if (all) {
              fileCache.stopUserTasks(username)
              serverDownloadQueue.pause(username)
              console.log(`[Cache] Stopped all tasks for user: ${username}`)
            } else if (queueId) {
              serverDownloadQueue.pause(username, queueId)
              console.log(`[Cache] Paused persistent queue task ${queueId} for user: ${username}`)
            } else if (songKey) {
              fileCache.stopUserTasks(username, songKey)
              console.log(`[Cache] Stopped task ${songKey} for user: ${username}`)
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }

      // 4. Serve Cached File
      if (pathname.startsWith('/api/music/cache/file/')) {
        const parts = pathname.replace('/api/music/cache/file/', '').split('/')
        const reqUsername = parts.length > 1 ? decodeURIComponent(parts[0]) : '_open'
        const filename = parts.length > 1 ? parts[1] : parts[0]

        if (filename) {
          let username = '_open'
          const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'

          if (!isPublic) {
            const urlToken = urlObj.searchParams.get('token')
            if (urlToken && !req.headers['x-user-token']) {
              (req.headers as any)['x-user-token'] = urlToken
            }
            if (reqUsername && !req.headers['x-user-name']) {
              (req.headers as any)['x-user-name'] = reqUsername
            }
            const verified = verifyUserAuth(req)
            if (!verified) {
              res.writeHead(401)
              res.end('Unauthorized')
              return
            }
            username = verified
          }
          fileCache.serveCacheFile(req, res, decodeURIComponent(filename), username)
          return
        }
      }

      // 5. Get Cache Statistics
      if (pathname === '/api/music/cache/stats' && req.method === 'GET') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        try {
          const stats = fileCache.getCacheStats(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: stats }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: e.message || 'Failed to get cache stats' }))
        }
        return
      }

      if (pathname === '/api/music/cache/clear' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        try {
          const result = fileCache.clearAllCache(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: result }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: e.message || 'Failed to clear cache' }))
        }
        return
      }

      if (pathname === '/api/music/cache/lyric/clear' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        try {
          const result = fileCache.clearLyricCache(username)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: result }))
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: e.message || 'Failed to clear lyric cache' }))
        }
        return
      }

      // 7. Get Cache Progress
      if (pathname === '/api/music/cache/progress' && req.method === 'GET') {
        const ids = urlObj.searchParams.get('ids')?.split(',') || []
        const progress: any = {}
        ids.forEach(id => {
          if (fileCache.cacheProgress.has(id)) {
            progress[id] = fileCache.cacheProgress.get(id)
          }
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: progress }))
        return
      }

      // 7. Get Detailed Cache List
      if (pathname === '/api/music/cache/list' && req.method === 'GET') {
        const targetUserParam = urlObj.searchParams.get('user')
        const reqUsername = targetUserParam || (req.headers['x-user-name'] as string) || ''
        const auth = req.headers['x-frontend-auth']
        const isAdmin = !!(auth && auth === global.lx.config['frontend.password'])
        const isPublic = !reqUsername || reqUsername === 'default' || reqUsername === '_open' || targetUserParam === '_open'
        let username = '_open'

        if (isPublic) {
          const enablePublicNonAdminLocalMusic = !!global.lx.config['user.enablePublicNonAdminLocalMusic']
          const verified = verifyUserAuth(req)
          if (!enablePublicNonAdminLocalMusic && !isAdmin && !verified) {
            res.writeHead(403, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
            })
            res.end(JSON.stringify({ success: false, message: '您没有权限查看此目录，请联系管理员设置' }))
            return
          }
          username = '_open'
        } else {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
            })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        void fileCache.getCacheList(username).then(list => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          })
          res.end(JSON.stringify({ success: true, data: list }))
        }).catch(err => {
          res.writeHead(500)
          res.end(err.message)
        })
        return
      }

      // 8. Get Cache Cover
      if (pathname === '/api/music/cache/cover' && req.method === 'GET') {
        const reqUsername = (req.headers['x-user-name'] as string) || urlObj.searchParams.get('user') || ''
        const isPublic = !reqUsername || reqUsername === '_open' || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          // <img src> 无法携带自定义请求头，允许从 URL ?token= 参数读取 Token 作为补偿
          const urlToken = urlObj.searchParams.get('token')
          if (urlToken && !req.headers['x-user-token']) {
            (req.headers as any)['x-user-token'] = urlToken
          }
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401)
            res.end('Unauthorized')
            return
          }
          username = verified
        }
        const filename = urlObj.searchParams.get('filename')
        if (!filename) {
          res.writeHead(400)
          res.end('Missing filename')
          return
        }
        const cover = await fileCache.getCacheCover(filename, username) as any
        if (cover && cover.data) {
          res.writeHead(200, {
            'Content-Type': cover.mime || 'image/jpeg',
            'Cache-Control': 'public, max-age=86400'
          })
          res.end(cover.data)
        } else {
          // Fallback to logo or 404
          res.writeHead(404)
          res.end('Not Found')
        }
        return
      }

      // 9. Remove Cache File (Single or Batch)
      if (pathname === '/api/music/cache/remove' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const auth = req.headers['x-frontend-auth']
        const isAdmin = !!(auth && auth === global.lx.config['frontend.password'])
        const isPublic = !reqUsername || reqUsername === 'default' || reqUsername === '_open'
        let username = '_open'

        if (isPublic) {
          if (!isAdmin) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: '权限不足：删除公共本地歌曲需要验证管理员权限。' }))
            return
          }
        } else {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        void readBody(req).then(body => {
          try {
            const payload = JSON.parse(body)
            const legacyFilenames = payload.filenames
            const rawItems = Array.isArray(payload.items)
              ? payload.items
              : (legacyFilenames ? (Array.isArray(legacyFilenames) ? legacyFilenames : [legacyFilenames]) : [])
            if (rawItems.length === 0) throw new Error('Missing items')

            const deleteItems: Array<{ filename: string; folder?: fileCache.CacheFolder }> = rawItems.map((item: any) => {
              if (typeof item === 'string') return { filename: item }
              if (!item || typeof item.filename !== 'string') throw new Error('Invalid delete item')
              if (item.folder !== undefined && item.folder !== 'cache' && item.folder !== 'music') {
                throw new Error('Invalid folder')
              }
              return { filename: item.filename, folder: item.folder }
            })

            let deletedCount = 0
            const failures: Array<{ filename: string; folder?: fileCache.CacheFolder; message: string }> = []
            for (const item of deleteItems) {
              try {
                const result = fileCache.removeCacheFile(item.filename, username, item.folder)
                if (result.deleted) {
                  deletedCount++
                  accessLog.info(`music file deleted user=${username} folder=${result.folder} filename=${JSON.stringify(item.filename)}`)
                } else {
                  failures.push({ ...item, message: 'File not found' })
                }
              } catch (error: any) {
                failures.push({ ...item, message: error?.message || 'Delete failed' })
                accessLog.warn(`music file delete rejected user=${username} folder=${item.folder || 'unspecified'} filename=${JSON.stringify(item.filename)} reason=${JSON.stringify(error?.message || 'Delete failed')}`)
              }
            }

            const success = failures.length === 0
            const statusCode = success ? 200 : (deletedCount > 0 ? 207 : 409)
            res.writeHead(statusCode, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success,
              deletedCount,
              failedCount: failures.length,
              failures,
              message: success ? undefined : failures[0]?.message,
            }))
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message }))
          }
        })
        return
      }

      // ===== [新增] Custom Music APIs (独立于 cache/music) =====
      // A. 获取自定义目录歌曲列表
      if (pathname === '/api/music/custom/list' && req.method === 'GET') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        const userCfg = getUserConfig(verified)
        void customMusicManager.getCustomMusicList(verified).then(list => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          })
          res.end(JSON.stringify({
            success: true,
            data: list,
            allowOperateCustomMusicDir: !!userCfg?.allowOperateCustomMusicDir,
            allowWriteCustomMusicDir: !!userCfg?.allowWriteCustomMusicDir
          }))
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: err.message }))
        })
        return
      }

      // B. 强制重新同步自定义目录
      if (pathname === '/api/music/custom/sync' && req.method === 'POST') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        void customMusicManager.syncCustomIndex(verified).then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, message: 'Sync completed' }))
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: err.message }))
        })
        return
      }

      // C. 流式播放自定义音频文件（支持深层子目录相对路径）
      if (pathname === '/api/music/custom/file' || pathname.startsWith('/api/music/custom/file/')) {
        let rawFilename = urlObj.searchParams.get('filename')
        let reqUsername = urlObj.searchParams.get('user') || ''

        if (!rawFilename && pathname.startsWith('/api/music/custom/file/')) {
          const rest = pathname.substring('/api/music/custom/file/'.length)
          try {
            rawFilename = decodeURIComponent(rest)
          } catch (e) {
            rawFilename = rest
          }
        }

        if (rawFilename) {
          const urlToken = urlObj.searchParams.get('token')
          if (urlToken && !req.headers['x-user-token']) {
            (req.headers as any)['x-user-token'] = urlToken
          }
          if (reqUsername && !req.headers['x-user-name']) {
            (req.headers as any)['x-user-name'] = reqUsername
          }
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401)
            res.end('Unauthorized')
            return
          }
          customMusicManager.serveCustomFile(req, res, rawFilename, verified)
          return
        }
      }

      // D. 获取自定义目录封面
      if (pathname === '/api/music/custom/cover' && req.method === 'GET') {
        const reqUsername = (req.headers['x-user-name'] as string) || urlObj.searchParams.get('user') || ''
        const urlToken = urlObj.searchParams.get('token')
        if (urlToken && !req.headers['x-user-token']) {
          (req.headers as any)['x-user-token'] = urlToken
        }
        if (reqUsername && !req.headers['x-user-name']) {
          (req.headers as any)['x-user-name'] = reqUsername
        }
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }
        const filename = urlObj.searchParams.get('filename')
        if (!filename) {
          res.writeHead(400)
          res.end('Missing filename')
          return
        }
        const cover = await customMusicManager.getCustomCover(filename, verified)
        if (cover && cover.data) {
          res.writeHead(200, {
            'Content-Type': cover.mime || 'image/jpeg',
            'Cache-Control': 'public, max-age=86400',
          })
          res.end(cover.data)
        } else {
          res.writeHead(404)
          res.end('Not Found')
        }
        return
      }

      // E. 删除自定义目录中的歌曲（受 allowOperateCustomMusicDir 限制）
      if (pathname === '/api/music/custom/remove' && req.method === 'POST') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        const userCfg = getUserConfig(verified)
        if (!userCfg?.allowOperateCustomMusicDir) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: '管理员未允许操作或删除自定义目录中的文件' }))
          return
        }

        void readBody(req).then(body => {
          try {
            const payload = JSON.parse(body)
            const rawItems = Array.isArray(payload.items)
              ? payload.items
              : (payload.filenames ? (Array.isArray(payload.filenames) ? payload.filenames : [payload.filenames]) : [])

            let deletedCount = 0
            for (const item of rawItems) {
              const filename = typeof item === 'string' ? item : item?.filename
              if (filename && customMusicManager.removeCustomFile(filename, verified)) {
                deletedCount++
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, deletedCount }))
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message }))
          }
        })
        return
      }

      // F. 手动关联自定义目录歌曲
      if (pathname === '/api/music/custom/link' && req.method === 'POST') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }
        const userCfg = getUserConfig(verified)
        if (!userCfg?.allowWriteCustomMusicDir) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: '管理员未允许操作自定义目录中的文件' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const { filename, songInfo } = JSON.parse(body)
            if (!filename || !songInfo) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Missing params' }))
              return
            }

            const result = await customMusicManager.linkCustomSong(filename, songInfo, verified)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message || 'Linking failed' }))
          }
        })
        return
      }

      // G. 批量补全自定义目录元信息（封面与ID3）
      if (pathname === '/api/music/custom/updateMetadata' && req.method === 'POST') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        const userCfg = getUserConfig(verified)
        if (!userCfg?.allowWriteCustomMusicDir) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: '管理员未允许写入自定义目录中的歌曲文件' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const { filenames } = JSON.parse(body)
            if (!filenames) throw new Error('Missing filenames')
            const fileList = Array.isArray(filenames) ? filenames : [filenames]
            const result = await customMusicManager.batchUpdateMetadata(fileList, verified)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, ...result }))
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message }))
          }
        })
        return
      }

      // H. 批量将歌词嵌入自定义目录音频标签 (USLT)
      if (pathname === '/api/music/custom/embedLyric' && req.method === 'POST') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        const userCfg = getUserConfig(verified)
        if (!userCfg?.allowWriteCustomMusicDir) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: '管理员未允许写入自定义目录中的歌曲文件' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const { filenames } = JSON.parse(body)
            if (!filenames || !Array.isArray(filenames)) throw new Error('Missing filenames')
            const result = await customMusicManager.batchEmbedLyric(filenames, verified)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, ...result }))
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message }))
          }
        })
        return
      }
      // ===== [结束] Custom Music APIs =====

      // [New] Batch Move Files between folders
      if (pathname === '/api/music/cache/move' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401)
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        void readBody(req).then(async body => {
          try {
            const { filenames } = JSON.parse(body)
            if (!filenames) throw new Error('Missing filenames')
            const fileList = Array.isArray(filenames) ? filenames : [filenames]

            const result = await fileCache.switchFolder(fileList, username)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, ...result }))
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }

      // [New] WebDAV/Base Location switch
      if (pathname === '/api/music/cache/switch-base' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401)
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        void readBody(req).then(async body => {
          try {
            const { filenames } = JSON.parse(body)
            if (!filenames) throw new Error('Missing filenames')
            const fileList = Array.isArray(filenames) ? filenames : [filenames]

            const result = await fileCache.switchBaseLocation(fileList, username)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, ...result }))
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }



      // 10. Update Metadata (Batch)
      if (pathname === '/api/music/cache/updateMetadata' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }
        void readBody(req).then(async body => {
          try {
            const { filenames } = JSON.parse(body)
            if (!filenames) throw new Error('Missing filenames')

            const fileList = Array.isArray(filenames) ? filenames : [filenames]
            const result = await fileCache.batchUpdateMetadata(fileList, username)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, ...result }))
          } catch (e: any) {
            res.writeHead(400)
            res.end(e.message)
          }
        })
        return
      }

      // [新增] Embed Lyric into Audio File Tags (USLT)
      if (pathname === '/api/music/cache/embedLyric' && req.method === 'POST') {
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        void readBody(req).then(async body => {
          try {
            const { filenames } = JSON.parse(body)
            if (!filenames || !Array.isArray(filenames)) throw new Error('Missing filenames')

            let successCount = 0
            let skippedCount = 0
            let failCount = 0
            const details: any[] = []

            for (const filename of filenames) {
              let filePath = ''
              let folder: 'cache' | 'music' = 'cache'

              // 在 cache 和 music 两个目录中查找文件
              for (const f of ['cache', 'music'] as const) {
                const dir = fileCache.getCacheDir(username, f === 'music')
                const candidate = path.join(dir, filename)
                if (fs.existsSync(candidate)) {
                  filePath = candidate
                  folder = f
                  break
                }
              }

              if (!filePath) {
                details.push({ filename, status: 'fail', reason: '文件不存在' })
                failCount++
                continue
              }

              try {
                const indexItem = fileCache.getIndexItemByFilename(filename, username) as any
                if (indexItem?.metadataWritable === false) {
                  details.push({ filename, status: 'fail', reason: indexItem.embedLyricError || indexItem.metadataError || '当前音频容器不支持嵌入歌词，外置歌词文件仍可正常使用' })
                  failCount++
                  continue
                }

                // 检查是否已有 USLT 歌词（已有则跳过）
                const { MusicTagger: MT } = require('music-tag-native')
                let checkTagger: any
                let existingLyrics = ''
                try {
                  checkTagger = new MT()
                  checkTagger.loadPath(filePath)
                  existingLyrics = checkTagger.lyrics || ''
                } catch (checkError: any) {
                  const unsupportedStatus = fileCache.getAudioMetadataUnsupportedStatus(filePath)
                  fileCache.setIndexEmbedLyric(filename, username, false, {
                    audioContainer: unsupportedStatus.audioContainer,
                    metadataWritable: false,
                    metadataError: unsupportedStatus.error,
                    embedLyricError: unsupportedStatus.error,
                  })
                  details.push({ filename, status: 'fail', reason: unsupportedStatus.error || '当前音频容器不支持嵌入歌词，外置歌词文件仍可正常使用' })
                  failCount++
                  continue
                } finally {
                  try { if (checkTagger) checkTagger.dispose() } catch (e) { }
                }

                if (existingLyrics && existingLyrics.trim().length > 10) {
                  details.push({ filename, status: 'skipped', reason: '已有歌词标签' })
                  skippedCount++
                  continue
                }

                // 从索引中获取 songInfo（索引条目本身就包含 source/songmid 等字段）
                const songInfo = indexItem

                // 优先读同名 .lrc 文件
                const ext = path.extname(filename)
                const baseName = filename.slice(0, filename.length - ext.length)
                const lrcFilename = baseName + '.lrc'
                const dir = fileCache.getCacheDir(username, folder === 'music')
                const lrcPath = path.join(dir, lrcFilename)

                let lyricText: string | null = null

                if (fs.existsSync(lrcPath)) {
                  lyricText = fs.readFileSync(lrcPath, 'utf8')
                  console.log(`[EmbedLyric] Using local .lrc for: ${filename}`)
                } else if (songInfo && songInfo.source && songInfo.source !== 'unknown') {
                  // 没有 .lrc 文件，尝试通过 SDK 获取
                  const lyricFetcherFn = fileCache.getLyricFetcher()
                  if (lyricFetcherFn) {
                    lyricText = await lyricFetcherFn(songInfo)
                  }
                  if (lyricText) {
                    console.log(`[EmbedLyric] Fetched lyric from SDK for: ${filename}`)
                  }
                }

                if (!lyricText) {
                  details.push({ filename, status: 'fail', reason: '无法获取歌词' })
                  failCount++
                  continue
                }

                const embedResult = fileCache.embedLyricsIntoFile(filePath, lyricText)
                fileCache.setIndexEmbedLyric(filename, username, embedResult.hasEmbedLyric, {
                  audioContainer: embedResult.audioContainer,
                  metadataWritable: embedResult.metadataWritable,
                  metadataError: embedResult.metadataWritable ? undefined : embedResult.error,
                  embedLyricError: embedResult.error,
                })
                if (!embedResult.success) {
                  details.push({ filename, status: 'fail', reason: embedResult.error || '歌词标签写入后校验失败，外置歌词文件仍可正常使用' })
                  failCount++
                  continue
                }

                details.push({ filename, status: 'success' })
                successCount++
                console.log(`[EmbedLyric] Embedded lyric for: ${filename}`)
              } catch (itemErr: any) {
                details.push({ filename, status: 'fail', reason: itemErr.message || '未知错误' })
                failCount++
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, successCount, skippedCount, failCount, details }))
          } catch (e: any) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message }))
          }
        })
        return
      }

      // 11. Link Unindexed Local File
      if (pathname === '/api/music/cache/link' && req.method === 'POST') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const { filename, songInfo } = JSON.parse(body)
            if (!filename || !songInfo) {
              res.writeHead(400)
              res.end('Missing params')
              return
            }

            const result = await fileCache.linkLocalFile(filename, songInfo, verified)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (e: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message || 'Linking failed' }))
          }
        })
        return
      }

      // 12. Identify Local File (AcoustID)
      if (pathname === '/api/music/identify' && req.method === 'POST') {
        const verified = verifyUserAuth(req)
        if (!verified) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
          return
        }

        void readBody(req).then(async body => {
          try {
            const { filename, folder } = JSON.parse(body)
            if (!filename) {
              res.writeHead(400)
              res.end('Missing filename')
              return
            }

            const { identifyLocalSong } = require('./utils/identify')
            const username = verified

            const dir = folder === 'custom'
              ? customMusicManager.getCustomMusicDir(username)
              : fileCache.getCacheDir(username, folder === 'music')

            if (!dir) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, message: 'Directory not found' }))
              return
            }
            const filePath = path.join(dir, filename) // [Fix] Allow subfolders

            if (!fs.existsSync(filePath)) {
              throw new Error('文件不存在: ' + filename)
            }

            const results = await identifyLocalSong(filePath)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, results }))
          } catch (e: any) {
            console.error('[Identify] Error:', e.message)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: e.message || 'Identification failed' }))
          }
        })
        return
      }



      // [New] Fetch Lyrics
      if (pathname === '/api/music/lyric' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source')
        // [Optimization] Accept multiple ID param names for better client compatibility
        let songmid = urlObj.searchParams.get('songmid') || urlObj.searchParams.get('songId') || urlObj.searchParams.get('id')

        if (!source || !songmid) {
          res.writeHead(400)
          res.end('Missing source or songmid')
          return
        }

        // [Fix] Normalize ID by stripping source prefix if present (e.g., "tx_001..." -> "001...")
        const sourcePrefix = `${source}_`
        if (songmid.startsWith(sourcePrefix)) {
          songmid = songmid.slice(sourcePrefix.length)
        }

        // [优化] 先检查本地 .lrc 文件缓存，命中则直接返回，无需网络请求（断网也可用）
        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let lyricUsername = '_open'
        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (verified) lyricUsername = verified
        }
        const localLyricResult = fileCache.checkLyricCache({
          source,
          songmid,
          id: urlObj.searchParams.get('songId') || urlObj.searchParams.get('id') || songmid,
          name: urlObj.searchParams.get('name') || '',
          singer: urlObj.searchParams.get('singer') || '',
        }, lyricUsername)

        if (localLyricResult.exists && localLyricResult.content) {
          console.log(`[Lyric] 命中本地 .lrc 缓存: ${source}_${songmid}`)
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' })
          res.end(JSON.stringify({ ...localLyricResult.content, _fromLocalCache: true }))
          return
        }

        try {
          if (!musicSdk[source]) {
            throw new Error('Source not supported')
          }

          // console.log('[Lyric] Fetching lyric for:', source, songmid)

          // Construct complete songInfo object for SDK compatibility
          // KuGou (kg) needs: name, hash, interval
          // MiGu (mg) needs: copyrightId, lrcUrl, mrcUrl, trcUrl (优先，避免调用getMusicInfo API)
          const songInfo = {
            songmid,
            name: urlObj.searchParams.get('name') || '',
            singer: urlObj.searchParams.get('singer') || '',
            hash: urlObj.searchParams.get('hash') || '',
            interval: urlObj.searchParams.get('interval') || '',
            copyrightId: urlObj.searchParams.get('copyrightId') || '',
            albumId: urlObj.searchParams.get('albumId') || '',
            lrcUrl: urlObj.searchParams.get('lrcUrl') || '',
            mrcUrl: urlObj.searchParams.get('mrcUrl') || '',
            trcUrl: urlObj.searchParams.get('trcUrl') || ''
          }

          const requestObj = musicSdk[source].getLyric(songInfo)
          const lyricInfo = await requestObj.promise

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=86400' // Cache lyrics for 1 day
          })
          res.end(JSON.stringify(lyricInfo))
        } catch (err: any) {
          console.error('[Lyric] Fetch error:', source, songmid, err.message || err)

          // [Fallback] 网络请求失败时，再次尝试本地 .lrc 文件（防止 Step2 miss 但物理文件存在的情况）
          const fallbackResult = fileCache.checkLyricCache({
            source,
            songmid,
            id: urlObj.searchParams.get('songId') || urlObj.searchParams.get('id') || songmid,
            name: urlObj.searchParams.get('name') || '',
            singer: urlObj.searchParams.get('singer') || '',
          }, lyricUsername)
          if (fallbackResult.exists && fallbackResult.content) {
            console.log(`[Lyric] 网络失败，fallback 到本地 .lrc: ${source}_${songmid}`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ...fallbackResult.content, _fromLocalCache: true }))
            return
          }

          // Avoid circular structure error - only send message
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end(err.message || 'Failed to fetch lyric')
        }
        return
      }

      // [新增] File Cache Lyric APIs
      if (pathname === '/api/music/cache/lyric' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source')
        const songmid = urlObj.searchParams.get('songmid') || urlObj.searchParams.get('songId') || urlObj.searchParams.get('id')
        const songId = urlObj.searchParams.get('songId') || urlObj.searchParams.get('id')

        const reqUsername = (req.headers['x-user-name'] as string) || ''
        const isPublic = !reqUsername || reqUsername === 'default'
        let username = '_open'

        if (!isPublic) {
          const verified = verifyUserAuth(req)
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          username = verified
        }

        if (!source || (!songmid && !songId)) {
          res.writeHead(400)
          res.end('Missing source or songmid')
          return
        }

        const name = urlObj.searchParams.get('name') || ''
        const singer = urlObj.searchParams.get('singer') || ''
        const result = fileCache.checkLyricCache({ source, songmid, id: songId, name, singer }, username)
        if (result.exists) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: result.content }))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, message: 'Not found in cache' }))
        }
        return
      }

      if (pathname === '/api/music/cache/lyric' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { songInfo, lyricsObj, enableOnlyDownloadMode } = JSON.parse(body)
            const reqUsername = (req.headers['x-user-name'] as string) || ''
            const isPublic = !reqUsername || reqUsername === 'default'
            let username = '_open'

            if (!isPublic) {
              const verified = verifyUserAuth(req)
              if (!verified) {
                res.writeHead(401, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
                return
              }
              username = verified
            }

            if (!songInfo || !lyricsObj) {
              res.writeHead(400)
              res.end('Missing parameters')
              return
            }

            let success = false
            if (songInfo?.folder === 'custom') {
              success = customMusicManager.saveCustomLyricCache(songInfo, lyricsObj, username)
            } else {
              success = fileCache.saveLyricCache(songInfo, lyricsObj, username, !!enableOnlyDownloadMode)
              if (!success) {
                // 如果在常规缓存没找到，尝试在自定义目录匹配
                success = customMusicManager.saveCustomLyricCache(songInfo, lyricsObj, username)
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success }))
          } catch (e: any) {
            res.writeHead(500)
            res.end('Server internal error')
          }
        })
        return
      }

      // [新增] Download Proxy API
      if (pathname === '/api/music/download' && req.method === 'GET') {
        const urlStr = urlObj.searchParams.get('url')
        const filename = urlObj.searchParams.get('filename') || 'download.mp3'
        const isInline = urlObj.searchParams.get('inline') === '1'

        if (!urlStr) {
          res.writeHead(400)
          res.end('Missing url param')
          return
        }

        try {
          const isTaggingMode = urlObj.searchParams.get('tag') === '1'
          const taskId = urlObj.searchParams.get('taskId')
          console.log(`[DownloadProxy] Fetching: ${urlStr} (Tagging: ${isTaggingMode}, TaskId: ${taskId})`)

          // 使用原生 http/https 模块以获得最高的流媒体转发性能
          const http = require('http')
          const https = require('https')

          // Manual redirect handling for maximum control and stability
          const doFetch = (targetUrl: string, attempt: number) => {
            if (attempt > 5) {
              console.error('[DownloadProxy] Too many redirects')
              if (!res.headersSent) {
                res.writeHead(502)
                res.end('Too Many Redirects')
              }
              return
            }

            try {
              const parsedUrl = new URL(targetUrl)
              const options: any = {
                method: 'GET',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Referer': parsedUrl.origin
                }
              }

              // 转发 Range 请求头，以支持播放器的快进和拖拽
              if (req.headers['range']) {
                options.headers['Range'] = req.headers['range']
              }

              const lib = parsedUrl.protocol === 'https:' ? https : http

              const proxyReq = lib.request(targetUrl, options, (proxyRes: any) => {
                // 处理重定向
                if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
                  const location = proxyRes.headers.location
                  if (location) {
                    const nextUrl = location.startsWith('http') ? location : new URL(location, targetUrl).href
                    doFetch(nextUrl, attempt + 1)
                    return
                  }
                }

                // 处理最终响应
                let contentType = proxyRes.headers['content-type'] || 'application/octet-stream'
                if (contentType.includes('audio/') || contentType.includes('video/')) {
                  contentType = contentType.split(';')[0].trim()
                }

                const headers: Record<string, string | string[] | undefined> = {
                  'Content-Type': contentType,
                  'Access-Control-Allow-Origin': '*',
                }

                if (proxyRes.headers['content-length']) headers['Content-Length'] = proxyRes.headers['content-length']
                if (proxyRes.headers['accept-ranges']) headers['Accept-Ranges'] = proxyRes.headers['accept-ranges']
                if (proxyRes.headers['content-range']) headers['Content-Range'] = proxyRes.headers['content-range']

                if (!isInline) {
                  headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`
                }

                // [Unified metadata] Tagging support for browser download
                // NOTE: Local fetch from browser often sends Range: bytes=0- for full download
                const rangeHeader = req.headers['range']
                const isFullRange = rangeHeader === 'bytes=0-'

                  if (isTaggingMode && (!rangeHeader || isFullRange)) {
                  const songName = urlObj.searchParams.get('name') || ''
                  const artist = urlObj.searchParams.get('singer') || ''
                  const album = urlObj.searchParams.get('album') || ''
                  const imageUrl = urlObj.searchParams.get('pic') || ''
                  // [新增] 浏览器下载歌词嵌入参数
                  const embedLyric = urlObj.searchParams.get('lyric') === '1'
                  const lyricSource = urlObj.searchParams.get('source') || ''
                  const lyricSongmid = urlObj.searchParams.get('songmid') || ''
                  const lyricHash = urlObj.searchParams.get('hash') || ''
                  const lyricInterval = urlObj.searchParams.get('interval') || ''

                  const chunks: any[] = []
                  let received = 0
                  const total = parseInt(proxyRes.headers['content-length'] as string || '0', 10)
                  let lastSpeedAt = Date.now()
                  let lastSpeedBytes = 0
                  let currentSpeed = 0

                  if (taskId) {
                    fileCache.cacheProgress.set(taskId, { progress: 0, status: 'downloading', total, received: 0, speed: 0, updatedAt: Date.now() })
                  }

                  proxyRes.on('data', (c: any) => {
                    chunks.push(c)
                    if (taskId) {
                      received += c.length
                      const now = Date.now()
                      if (now - lastSpeedAt >= 1000) {
                        currentSpeed = Math.max(0, (received - lastSpeedBytes) / ((now - lastSpeedAt) / 1000))
                        lastSpeedAt = now
                        lastSpeedBytes = received
                      }
                      const progress = total > 0 ? Math.round((received / total) * 100) : 0
                      fileCache.cacheProgress.set(taskId, { progress, status: 'downloading', total, received, speed: currentSpeed, updatedAt: now })
                    }
                  })
                  proxyRes.on('end', async () => {
                    if (taskId) {
                      fileCache.cacheProgress.set(taskId, { progress: 100, status: 'tagging', total, received, speed: 0, updatedAt: Date.now() })
                    }
                    const finishProgress = () => {
                      if (!taskId) return
                      fileCache.cacheProgress.set(taskId, { progress: 100, status: 'finished', total: total || received, received, speed: 0, updatedAt: Date.now() })
                      setTimeout(() => fileCache.cacheProgress.delete(taskId), 30000)
                    }
                    let tempPath = ''
                    let tagger: any = null
                    try {
                      const buffer = Buffer.concat(chunks)
                      if (buffer.length < 100) throw new Error('File too small, possibly invalid');

                      // Use filename extension for temp file so MusicTagger can identify container format
                      const ext = path.extname(filename) || '.mp3'
                      tempPath = path.join(os.tmpdir(), `lx_tag_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`)
                      fs.writeFileSync(tempPath, new Uint8Array(buffer))

                      tagger = new MusicTagger()
                      tagger.loadPath(tempPath)
                      if (songName) tagger.title = songName
                      if (artist) tagger.artist = artist
                      if (album) tagger.album = album

                      if (imageUrl) {
                        try {
                          let imgBuf: Buffer | null = null;
                          if (imageUrl.startsWith('http')) {
                            const imgResp = await (global as any).fetch(imageUrl)
                            if (imgResp.ok) imgBuf = Buffer.from(await imgResp.arrayBuffer())
                          } else if (imageUrl.startsWith('/api')) {
                            // 内部 API 请求，使用请求头中的 host
                            const hostLabel = req.headers.host || '127.0.0.1:2026'
                            const internalUrl = `http://${hostLabel}${imageUrl}`
                            const imgResp = await (global as any).fetch(internalUrl)
                            if (imgResp.ok) imgBuf = Buffer.from(await imgResp.arrayBuffer())
                          }

                          if (imgBuf && imgBuf.length > 0) {
                            try {
                              // music-tag-native signature: (mime, data, type)
                              tagger.pictures = [new MetaPicture('image/jpeg', new Uint8Array(imgBuf), 'Cover')]
                            } catch (picErr) {
                              console.warn('[DownloadProxy] MetaPicture creation failed:', picErr)
                            }
                          }
                        } catch (e: any) {
                          console.warn('[DownloadProxy] Picture fetch/embed failed:', imageUrl, e.message)
                        }
                      }
                      // [新增] 嵌入歌词 USLT 标签：SDK 返回 { promise, cancel }，必须 await .promise
                      if (embedLyric && lyricSource && lyricSongmid && musicSdk[lyricSource]?.getLyric) {
                        try {
                          const lyricReqObj = musicSdk[lyricSource].getLyric({
                            songmid: lyricSongmid,
                            name: songName,
                            singer: artist,
                            hash: lyricHash,
                            interval: lyricInterval,
                          })
                          const lyricResult = await lyricReqObj.promise
                          const lyricText = lyricResult?.lyric || lyricResult?.lrc || ''
                          if (lyricText) tagger.lyrics = lyricText
                        } catch (e) { /* 歌词获取失败不影响下载 */ }
                      }
                      tagger.save()
                      console.log('[DownloadProxy] Metadata saved successfully for:', songName)
                      tagger.dispose()
                      tagger = null

                      const tagged = fs.readFileSync(tempPath)
                      headers['Content-Length'] = tagged.length.toString()
                      if (!res.headersSent) {
                        res.writeHead(200, headers)
                        res.end(tagged)
                      }
                      finishProgress()
                    } catch (e: any) {
                      if (!res.headersSent) {
                        res.writeHead(200, headers)
                        res.end(Buffer.concat(chunks))
                      }
                      finishProgress()
                    } finally {
                      if (tagger) tagger.dispose()
                      if (tempPath) fs.unlink(tempPath, () => { })
                    }
                  })
                  return
                }

                if (!res.headersSent) {
                  res.writeHead(proxyRes.statusCode || 200, headers)
                  proxyRes.pipe(res)
                }
              })

              proxyReq.on('error', (err: any) => {
                console.error('[DownloadProxy] Request Error:', err)
                if (!res.headersSent) {
                  res.writeHead(502)
                  res.end('Request Error')
                }
              })

              // 如果客户端（浏览器）中止了请求（例如：用户拖拽进度条、切换歌曲等），应该立刻销毁上游的下载请求，防止持续占用服务器下行带宽
              req.on('close', () => {
                if (!proxyReq.destroyed) {
                  proxyReq.destroy()
                }
              })

              proxyReq.end()

            } catch (err: any) {
              console.error('[DownloadProxy] Try Error:', err)
              if (!res.headersSent) {
                res.writeHead(500)
                res.end('Internal Server Error')
              }
            }
          }

          // Start the fetch process
          doFetch(urlStr, 0)

        } catch (err: any) {
          console.error('[DownloadProxy] Error:', err)
          res.writeHead(500)
          res.end('Server Error')
        }
        return
      }

      if (pathname === '/api/data/delete-playlist' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }


        void readBody(req).then(async body => {
          try {
            const { username, playlistId } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage

            // 删除歌单
            await listManage.listDataManage.userListsRemove([playlistId])
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // 删除歌曲
      if (pathname === '/api/data/delete-song' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { username, playlistId, songIndex } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage
            const listData = await listManage.getListData()

            // 获取歌单
            const playlist = listData.userList.find((list: any) => list.id === playlistId)

            if (!playlist) {
              res.writeHead(404)
              res.end('Playlist not found')
              return
            }

            if (!playlist.list || songIndex >= playlist.list.length) {
              res.writeHead(404)
              res.end('Song not found')
              return
            }

            const songInfo = playlist.list[songIndex]
            // 从歌单中删除歌曲
            await listManage.listDataManage.listMusicRemove(playlistId, [songInfo.id])
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }
      // 重命名歌单
      if (pathname === '/api/data/rename-playlist' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { username, playlistId, newName } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage
            const listData = await listManage.getListData()

            // 查找歌单
            const playlist = listData.userList.find((list: any) => list.id === playlistId)

            if (!playlist) {
              res.writeHead(404)
              res.end('Playlist not found')
              return
            }

            // 更新歌单信息
            await listManage.listDataManage.userListsUpdate([{
              id: playlist.id,
              name: newName,
              source: playlist.source,
              sourceListId: playlist.sourceListId,
              locationUpdateTime: playlist.locationUpdateTime
            }])
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // 批量删除歌曲
      if (pathname === '/api/data/batch-delete-songs' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { username, playlistId, songIndices } = JSON.parse(body)

            // 检查用户是否存在
            if (!global.lx.config.users.some(u => u.name === username)) {
              res.writeHead(404)
              res.end('User not found')
              return
            }

            const userSpace = getUserSpace(username)
            const listManage = userSpace.listManage
            const listData = await listManage.getListData()

            // 获取歌单
            const playlist = listData.userList.find((list: any) => list.id === playlistId)

            if (!playlist) {
              res.writeHead(404)
              res.end('Playlist not found')
              return
            }

            // 获取要删除的歌曲ID列表
            const songIds = songIndices.map((index: number) => {
              if (playlist.list && playlist.list[index]) {
                const id = playlist.list[index].id
                return id
              }
              return null
            }).filter((id: any) => id !== null)

            if (songIds.length === 0) {
              res.writeHead(400)
              res.end('No valid songs selected')
              return
            }

            // 批量删除
            await listManage.listDataManage.listMusicRemove(playlistId, songIds)
            // 创建快照
            await listManage.createSnapshot()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // [新增] Web播放器公共配置 API (无需鉴权)
      if (pathname === '/api/music/config' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        })
        res.end(JSON.stringify({
          'player.enableAuth': global.lx.config['player.enableAuth'] || false,
          'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'] || false,
          'user.enablePublicFavorites': global.lx.config['user.enablePublicFavorites'] || false,
          'user.enablePublicNonAdminAccess': global.lx.config['user.enablePublicNonAdminAccess'] || false,
          'user.enablePublicNonAdminLocalMusic': global.lx.config['user.enablePublicNonAdminLocalMusic'] || false,
          'user.enablePublicNonAdminBrowserDownload': global.lx.config['user.enablePublicNonAdminBrowserDownload'] ?? true,
          'user.enablePublicNonAdminServerCache': global.lx.config['user.enablePublicNonAdminServerCache'] ?? false
        }))
        return
      }

      // [新增] Web播放器认证 API（颁发 HttpOnly Cookie Session）
      if (pathname === '/api/music/auth' && req.method === 'POST') {
        void readBody(req).then(body => {
          try {
            const { password } = JSON.parse(body)
            const correctPassword = global.lx.config['player.password'] || ''

            if (password === correctPassword) {
              const sessionId = generateSessionId()
              playerSessions.set(sessionId, { createdAt: Date.now() })
              loginLog.info(`Player login success from ${ip}`)
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Set-Cookie': `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`
              })
              res.end(JSON.stringify({ success: true }))
            } else {
              loginLog.warn(`Player login failed from ${ip}`)
              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false }))
            }
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
        })
        return
      }

      // [新增] Web播放器登出 API（清除 Session Cookie）
      if (pathname === '/api/music/auth/logout' && req.method === 'POST') {
        const cookies = parseCookies(req.headers['cookie'])
        const sessionId = cookies[SESSION_COOKIE_NAME]
        if (sessionId) playerSessions.delete(sessionId)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`
        })
        res.end(JSON.stringify({ success: true }))
        return
      }

      // [新增] Web播放器认证状态检查 API
      if (pathname === '/api/music/auth/verify' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ valid: checkPlayerAuth(req) }))
        return
      }

      // [新增] 音乐搜索 API
      if (pathname === '/api/music/search' && req.method === 'GET') {
        const name = urlObj.searchParams.get('name') || ''
        const singer = urlObj.searchParams.get('singer') || ''
        const source = urlObj.searchParams.get('source') || 'kw'
        const type = urlObj.searchParams.get('type') || 'song' // 新增 type 参数: song, singer, album, playlist
        const limit = parseInt(urlObj.searchParams.get('limit') || '20')
        const page = parseInt(urlObj.searchParams.get('page') || '1')
        const fetchPages = parseInt(urlObj.searchParams.get('pages') || '1') // 新增：一次请求多少页

        if (!name) {
          res.writeHead(400); res.end('Missing name'); return
        }

        try {
          if (!musicSdk[source]) {
            throw new Error(`Source ${source} is not supported`)
          }

          let result
          if (type === 'song') {
            const PAGE_SIZE = 20
            let allSongs: any[] = []
            // 根据前端给定的起始页 (page) 和 请求量 (pages) 进行拉取
            const startPage = page
            const endPage = page + fetchPages - 1

            for (let p = startPage; p <= endPage; p++) {
              const searchData = await musicSdk[source].musicSearch.search(name, p, PAGE_SIZE)
              const pageList: any[] = searchData.list || []
              allSongs = allSongs.concat(pageList)
              // 如果本页返回数量小于 PAGE_SIZE，说明已经是最后页
              if (pageList.length < PAGE_SIZE) break
            }
            result = allSongs
          } else if (type === 'singer') {
            if (!musicSdk[source].extendSearch || !musicSdk[source].extendSearch.searchSinger) {
              throw new Error(`Source ${source} does not support singer search`)
            }
            const searchData = await musicSdk[source].extendSearch.searchSinger(name, page, limit)
            result = searchData.list || []
          } else if (type === 'album') {
            if (!musicSdk[source].extendSearch || !musicSdk[source].extendSearch.searchAlbum) {
              throw new Error(`Source ${source} does not support album search`)
            }
            const searchData = await musicSdk[source].extendSearch.searchAlbum(name, page, limit)
            result = searchData.list || []
          } else if (type === 'playlist') {
            if (!musicSdk[source].extendSearch || !musicSdk[source].extendSearch.searchPlaylist) {
              throw new Error(`Source ${source} does not support playlist search`)
            }
            const searchData = await musicSdk[source].extendSearch.searchPlaylist(name, page, limit)
            result = searchData.list || []
          } else {
            throw new Error(`Invalid search type: ${type}`)
          }

          fs.appendFileSync(path.join(process.cwd(), 'debug.txt'), `[Search] Source: ${source}, Type: ${type}, Query: ${name}, StartPage: ${page}, Pages: ${fetchPages}, Result Count: ${result.length}\n`)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          fs.appendFileSync(path.join(process.cwd(), 'debug.txt'), `[Search Error] ${err.message}\n${err.stack}\n`)
          console.error(err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message, code: 500 }))
        }
        return
      }

      // [新增] 搜索提示 (TipSearch) API
      if (pathname === '/api/music/tipSearch' && req.method === 'GET') {
        const name = urlObj.searchParams.get('name') || ''
        const source = urlObj.searchParams.get('source') || 'kw'
        if (!name) {
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return
        }
        try {
          if (!musicSdk[source] || !musicSdk[source].tipSearch) {
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]'); return
          }
          const tips = await musicSdk[source].tipSearch.search(name)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(tips || []))
        } catch (err: any) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('[]')
        }
        return
      }

      // [新增] 获取歌手详情 API
      if (pathname === '/api/music/artistDetail' && req.method === 'GET') {
        const id = urlObj.searchParams.get('id')
        const source = urlObj.searchParams.get('source') || 'wy'
        if (!id) {
          res.writeHead(400); res.end('Missing id'); return
        }
        try {
          const data = await musicSdk[source].extendDetail.getArtistDetail(id)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
        } catch (err: any) {
          res.writeHead(500); res.end(err.message)
        }
        return
      }

      // [新增] 获取歌手专辑列表 API
      if (pathname === '/api/music/artistAlbums' && req.method === 'GET') {
        const id = urlObj.searchParams.get('id')
        const source = urlObj.searchParams.get('source') || 'wy'
        const page = parseInt(urlObj.searchParams.get('page') || '1')
        if (!id) {
          res.writeHead(400); res.end('Missing id'); return
        }
        try {
          const data = await musicSdk[source].extendDetail.getArtistAlbums(id, page)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
        } catch (err: any) {
          res.writeHead(500); res.end(err.message)
        }
        return
      }

      // [新增] 获取歌手歌曲 API（循环拉取全部，前端分页）
      if (pathname === '/api/music/artistSongs' && req.method === 'GET') {
        const id = urlObj.searchParams.get('id')
        const source = urlObj.searchParams.get('source') || 'wy'
        const order = urlObj.searchParams.get('order') || 'hot'
        if (!id) {
          res.writeHead(400); res.end('Missing id'); return
        }
        try {
          const PAGE_SIZE = 100
          const configuredMaxPages = Number((global.lx.config as any)?.['artist.maxFetchPages'])
          const MAX_PAGES = Number.isFinite(configuredMaxPages) && configuredMaxPages > 0
            ? Math.min(Math.floor(configuredMaxPages), 100)
            : 20
          let allSongs: any[] = []
          for (let p = 1; p <= MAX_PAGES; p++) {
            const data = await musicSdk[source].extendDetail.getArtistSongs(id, p, PAGE_SIZE, order)
            const pageList: any[] = data.list || []
            allSongs = allSongs.concat(pageList)
            const total = Number(data.total) || 0
            if (pageList.length < PAGE_SIZE || (total > 0 && allSongs.length >= total)) break
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(allSongs))
        } catch (err: any) {
          res.writeHead(500); res.end(err.message)
        }
        return
      }

      // [新增] 获取专辑歌曲 API
      if (pathname === '/api/music/albumSongs' && req.method === 'GET') {
        const id = urlObj.searchParams.get('id')
        const source = urlObj.searchParams.get('source') || 'wy'
        if (!id) {
          res.writeHead(400); res.end('Missing id'); return
        }
        try {
          const data = await musicSdk[source].extendDetail.getAlbumSongs(id)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
        } catch (err: any) {
          res.writeHead(500); res.end(err.message)
        }
        return
      }

      // [新增] 音乐解析进度 SSE 端点 (无需登录, 用 requestId 区分)
      if (pathname === '/api/music/progress' && req.method === 'GET') {
        const reqId = urlObj.searchParams.get('reqId')
        if (!reqId) {
          res.writeHead(400)
          res.end('Missing reqId')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no', // 关键：禁用 Nginx 等代理的缓冲
        })
        res.write('retry: 3000\n\n')
        musicProgressClients.set(reqId, res)
        req.on('close', () => {
          musicProgressClients.delete(reqId)
        })
        return
      }

      // [新增] 音乐 URL API
      if (pathname === '/api/music/url' && req.method === 'POST') {
        const clientUsername = req.headers['x-user-name'] as string | undefined

        // 鉴权逻辑：如果提供了具名用户，必须通过 Token 或密码验证
        let verifiedUsername = 'open' // userApi 中公开用户标识为 'open'
        if (clientUsername && clientUsername !== 'default' && clientUsername !== 'open' && clientUsername !== '_open') {
          const verified = verifyUserAuth(req)
          if (!verified || verified !== clientUsername) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          verifiedUsername = verified
        }

        const clientId = req.headers['x-client-id'] as string | undefined
        const reqId = req.headers['x-req-id'] as string | undefined

        void readBody(req).then(async body => {
          // 辅助：通过 SSE 推送进度（内置竞态重试，最多等 600ms 让 SSE 连接就绪）
          let sseFailed = false
          const pushProgress = async (attempt: any, retries = 10): Promise<void> => {
            if (!reqId || sseFailed) return
            if (musicProgressClients.has(reqId)) {
              musicProgressClients.get(reqId)!.write(`data: ${JSON.stringify(attempt)}\n\n`)
              return
            }
            if (retries > 0) {
              await new Promise(r => setTimeout(r, 300))
              await pushProgress(attempt, retries - 1)
            } else {
              sseFailed = true
              console.warn(`[SSE] ReqId ${reqId} not found after retries (${musicProgressClients.size} clients registered)`)
            }
          }

          try {
            let { songInfo, quality, enableAutoSwitchApiSource, excludeApiSources } = JSON.parse(body)
            songInfo = normalizeSongInfo(songInfo)
            // console.log('[MusicUrl] Song Info:', JSON.stringify(songInfo, null, 2))
            if (!songInfo || !songInfo.source) {
              throw new Error('Invalid songInfo')
            }
            const source = songInfo.source
            let result: any

            let customSourceError: string | null = null
            let attempts: any[] = []
            if (isSourceSupported(source, verifiedUsername)) {
              try {
                console.log(`[MusicUrl] Using custom source for: ${source} (ReqId: ${reqId || 'None'}, User: ${verifiedUsername})`)

                const userApiResult = await callUserApiGetMusicUrl(
                  source, songInfo, quality || '128k', verifiedUsername,
                  (attempt) => { void pushProgress(attempt) },
                  enableAutoSwitchApiSource !== false,
                  excludeApiSources
                )
                result = userApiResult
                attempts = userApiResult.attempts || []
              } catch (userApiError: any) {
                console.error(`[MusicUrl] Custom source failed:`, userApiError.message)
                customSourceError = userApiError.message
                attempts = userApiError.attempts || []
                // 不抛出错误，继续尝试内置源
              }
            } else {
              // isSourceSupported = false: 无任何自定义源支持此平台，立即通知前端
              void pushProgress({ name: '系统', status: 'fail', message: `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源` })
            }

            // 自定义源失败则直接报错（内置 SDK 无独立解析能力，回退无意义）
            if (!result) {
              const errMsg = customSourceError || `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源`
              const err: any = new Error(errMsg)
              err.attempts = attempts
              throw err
            }

            // 合并解析尝试记录到响应（前端可用于诊断）
            if (attempts.length > 0) result.attempts = attempts

            // [Fix] Server-side Mixed Content handling & Redirect Resolution
            // If the upstream URL is HTTP, rewrite it to use our secure proxy OR resolve it if it's a redirect
            if (result && result.url) {
              // 1. Resolve Redirects (301, 302, 307, etc.) to get direct link
              try {
                // Only try to resolve if it looks like a remote URL and is not already resolved
                if (result.url.startsWith('http')) {
                  // console.log(`[MusicUrl] Resolving redirects for: ${songInfo.name} (${quality})`);

                  const checkRedirect = async (u: string, depth: number = 0): Promise<string> => {
                    if (depth > 3) return u // Max depth 3
                    try {
                      const resp = await needle('head', u, null, {
                        follow_max: 0,
                        response_timeout: 4000, // Increase timeout slightly
                        read_timeout: 4000,
                        headers: {
                          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                          'Referer': new URL(u).origin
                        }
                      })
                      if (resp.statusCode && [301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                        let nextUrl = resp.headers.location
                        if (!nextUrl.startsWith('http')) {
                          try { nextUrl = new URL(nextUrl, u).href } catch (e) { }
                        }
                        // console.log(`[MusicUrl] Resolve redirect [${resp.statusCode}]: ${u.substring(0, 50)}... -> ${nextUrl.substring(0, 50)}...`)
                        return checkRedirect(nextUrl, depth + 1)
                      }
                      // If error status but not redirect, return original
                      if (resp.statusCode !== undefined && resp.statusCode >= 400) {
                        console.warn(`[MusicUrl] Redirect check failed with status ${resp.statusCode}, using original URL`);
                        return u;
                      }
                    } catch (e: any) {
                      console.warn(`[MusicUrl] head check failed: ${e.message}`);
                    }
                    return u
                  }

                  const finalUrl = await checkRedirect(result.url)
                  if (finalUrl !== result.url) {
                    result.url = finalUrl
                  }
                  // console.log(`[MusicUrl] Final Resolved URL: ${result.url.substring(0, 100)}...`);
                }
              } catch (e) {
                console.error('[MusicUrl] Resolve Error:', e)
              }

              // 2. Mixed Content Handling (Optional Proxy) implementation details handled by frontend now
              // But we can keep the log for debugging
              if (result.url.startsWith('http://')) {
                // console.log(`[MusicUrl] Note: URL is HTTP, frontend might proxy if enabled: ${result.url}`)
              }

              result.requestedSource = songInfo.source
              result.downloadSource = fileCache.detectDownloadSource(result.url, songInfo.source)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (err: any) {
            console.error('[MusicUrl] Error:', err.message)
            // [Fix] Return 500 but with specific error JSON to let frontend show detailed toast
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message, code: 500, attempts: err.attempts }))
          }
        })
        return
      }

      // [新增] 音质真实大小 API
      if (pathname === '/api/music/quality/size' && req.method === 'POST') {
        const clientUsername = req.headers['x-user-name'] as string | undefined

        let verifiedUsername = 'open'
        if (clientUsername && clientUsername !== 'default' && clientUsername !== 'open' && clientUsername !== '_open') {
          const verified = verifyUserAuth(req)
          if (!verified || verified !== clientUsername) {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }))
            return
          }
          verifiedUsername = verified
        }

        void readBody(req).then(async body => {
          try {
            let { songInfo, quality } = JSON.parse(body)
            songInfo = normalizeSongInfo(songInfo)
            if (!songInfo || !songInfo.source || !quality) {
              throw new Error('Invalid quality size request')
            }

            const result = await resolveServerSong(songInfo, quality, verifiedUsername, false)
            const bytes = await getAudioRemoteSize(result.url)
            if (!bytes) throw new Error('无法读取真实文件大小')

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: true,
              quality,
              bytes,
              size: formatBytes(bytes),
              type: result.quality,
              source: fileCache.detectDownloadSource(result.url, result.downloadSource || result.songInfo?.source),
              sourceName: result.sourceName,
            }))
          } catch (err: any) {
            console.error('[QualitySize] Error:', err.message)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message, code: 500 }))
          }
        })
        return
      }

      // [新增] 歌词 API
      if (pathname === '/api/music/lyric' && req.method === 'POST') {
        void readBody(req).then(async body => {
          try {
            let { songInfo } = JSON.parse(body)
            songInfo = normalizeSongInfo(songInfo)
            if (!songInfo || !songInfo.source) {
              throw new Error('Invalid songInfo')
            }
            const source = songInfo.source
            if (!musicSdk[source] || !musicSdk[source].getLyric) {
              throw new Error(`Source ${source} not supported`)
            }
            const result = await musicSdk[source].getLyric(songInfo)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (err: any) {
            console.error(err)
            res.writeHead(500)
            res.end(err.message)
          }
        })
        return
      }

      // [新增] 热搜 API
      if (pathname === '/api/music/hotSearch' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'mg'

        try {
          // 检查是否支持热搜
          if (!musicSdk[source] || !musicSdk[source].hotSearch) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: '该音源不支持热搜功能' }))
            return
          }

          // console.log(`[HotSearch] 获取热搜: source=${source}`)
          const result = await musicSdk[source].hotSearch.getList()

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300' // 5分钟缓存
          })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error('[HotSearch] Error:', err.message)
          // Return empty array instead of 500 to keep UI stable
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify([]))
        }
        return
      }

      // [新增] 歌单分类标签 API
      if (pathname === '/api/music/songList/tags' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'wy'
        try {
          if (!musicSdk[source] || !musicSdk[source].songList) {
            throw new Error(`Source ${source} does not support songList`)
          }
          const result = await musicSdk[source].songList.getTags()
          const sortList = musicSdk[source].songList.sortList
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ...result, sortList }))
        } catch (err: any) {
          console.error(`[SongList Tags] Error:`, err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '获取歌单标签失败' }))
        }
        return
      }
      // [新增] 歌单列表 API
      if (pathname === '/api/music/songList/list' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'wy'
        const tagId = urlObj.searchParams.get('tagId') || ''
        const sortId = urlObj.searchParams.get('sortId') || 'hot'
        const page = parseInt(urlObj.searchParams.get('page') || '1')
        try {
          if (!musicSdk[source] || !musicSdk[source].songList) {
            throw new Error(`Source ${source} does not support songList`)
          }
          const result = await musicSdk[source].songList.getList(sortId, tagId, page)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error(`[SongList List] Error:`, err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '获取歌单列表失败' }))
        }
        return
      }
      // [新增] 歌单详情 API
      if (pathname === '/api/music/songList/detail' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'wy'
        const id = urlObj.searchParams.get('id')
        const page = parseInt(urlObj.searchParams.get('page') || '1')
        if (!id) {
          res.writeHead(400)
          res.end('Missing id')
          return
        }
        try {
          if (!musicSdk[source] || !musicSdk[source].songList) {
            throw new Error(`Source ${source} does not support songList`)
          }
          const result = await musicSdk[source].songList.getListDetail(id, page)
          if (result && result.list) {
            result.list = result.list.map(normalizeSongInfo)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error(`[SongList Detail] Error:`, err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '获取歌单详情失败' }))
        }
        return
      }
      // [新增] 歌单搜索 API
      if (pathname === '/api/music/songList/search' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'wy'
        const text = urlObj.searchParams.get('text')
        const page = parseInt(urlObj.searchParams.get('page') || '1')
        if (!text) {
          res.writeHead(400)
          res.end('Missing text')
          return
        }
        try {
          if (!musicSdk[source] || !musicSdk[source].songList) {
            throw new Error(`Source ${source} does not support songList`)
          }
          const result = await musicSdk[source].songList.search(text, page)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error(`[SongList Search] Error:`, err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '搜索歌单失败' }))
        }
        return
      }

      // [新增] 获取用户歌单 API
      if (pathname === '/api/music/songList/userPlaylist' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'tx'
        const uid = urlObj.searchParams.get('uid')
        const page = parseInt(urlObj.searchParams.get('page') || '1')
        if (!uid) {
          res.writeHead(400)
          res.end('Missing uid')
          return
        }
        try {
          if (!musicSdk[source] || !musicSdk[source].userPlaylist) {
            throw new Error(`Source ${source} does not support userPlaylist`)
          }
          const result = await musicSdk[source].userPlaylist.getList(uid, page)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error(`[User Playlist] Error:`, err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '获取用户歌单失败' }))
        }
        return
      }

      // [新增] 排行榜 - 获取榜单列表 API
      if (pathname === '/api/music/leaderboard/boards' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'kg'
        try {
          if (!musicSdk[source] || !musicSdk[source].leaderboard) {
            throw new Error(`Source ${source} does not support leaderboard`)
          }
          const result = await musicSdk[source].leaderboard.getBoards()
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=600'
          })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error(`[Leaderboard Boards] Error:`, err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '获取排行榜列表失败' }))
        }
        return
      }

      // [新增] 排行榜 - 获取榜单内歌曲 API
      if (pathname === '/api/music/leaderboard/list' && req.method === 'GET') {
        const source = urlObj.searchParams.get('source') || 'kg'
        const bangid = urlObj.searchParams.get('bangid')
        const page = parseInt(urlObj.searchParams.get('page') || '1')
        if (!bangid) {
          res.writeHead(400); res.end('Missing bangid'); return
        }
        try {
          if (!musicSdk[source] || !musicSdk[source].leaderboard) {
            throw new Error(`Source ${source} does not support leaderboard`)
          }
          const result = await musicSdk[source].leaderboard.getList(bangid, page)
          if (result && result.list) {
            result.list = result.list.map(normalizeSongInfo)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          console.error(`[Leaderboard List] Error:`, err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message || '获取排行榜歌曲失败' }))
        }
        return
      }

      // [新增] 评论 API
      if (pathname === '/api/music/comment' && req.method === 'POST') {
        void readBody(req).then(async body => {
          try {
            let { songInfo, type, page, limit } = JSON.parse(body)
            songInfo = normalizeSongInfo(songInfo)
            if (!songInfo || !songInfo.source) {
              console.warn('[Comment] Invalid request body:', body)
              throw new Error('Invalid songInfo')
            }
            const source = songInfo.source
            console.log(`[Comment] Request: ${source} - ${songInfo.name} - ${type} - page ${page}`)

            if (!musicSdk[source] || !musicSdk[source].comment) {
              console.warn(`[Comment] Source ${source} not supported for comments`)
              throw new Error(`Source ${source} not supported for comments`)
            }

            const method = type === 'hot' ? 'getHotComment' : 'getComment'
            console.log(`[Comment] Song: ${songInfo.name}, ID: ${songInfo.songmid}, Source: ${source}`)

            if (!musicSdk[source].comment[method]) {
              console.warn(`[Comment] Method ${method} not supported for source ${source}`)
              throw new Error(`Method ${method} not supported for source ${source}`)
            }

            const result = await musicSdk[source].comment[method](songInfo, page, limit)
            console.log(`[Comment] Success: ${source} - ${result.comments?.length} comments found`)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(result))
          } catch (err: any) {
            console.error('[Comment] Error:', err.message)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message, code: 500 }))
          }
        })
        return
      }

      // [新增] 封面 API (备用)

      // [新增] 自定义源管理 API
      // 注：此处不再进行全局强制鉴权，鉴权逻辑已下放到 customSourceHandlers 中，
      // 以便根据请求体中的 username 字段判断是否需要校验管理员密码。

      // [新增] 管理员身份验证接口
      if (pathname === '/api/admin/verify' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth === global.lx.config['frontend.password']) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: '管理员密码验证失败' }))
        }
        return
      }

      if (pathname === '/api/custom-source/validate' && req.method === 'POST') {
        return customSourceHandlers.handleValidate(req, res)
      }

      // 所有自定义源修改接口通用鉴权 (如果是公开访问限制模式，则必须登录)
      if (pathname.startsWith('/api/custom-source/') && req.method === 'POST' && pathname !== '/api/custom-source/validate') {
        if (global.lx.config['user.enablePublicRestriction']) {
          const auth = req.headers['x-frontend-auth']
          const isAdmin = auth === global.lx.config['frontend.password']
          const user = verifyUserAuth(req)
          if (!isAdmin && !user) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '当前系统已开启访问限制，管理操作请登录后重试。' }))
            return
          }
        }
      }

      if (pathname === '/api/custom-source/import' && req.method === 'POST') {
        return customSourceHandlers.handleImport(req, res)
      }
      if (pathname === '/api/custom-source/upload' && req.method === 'POST') {
        return customSourceHandlers.handleUpload(req, res)
      }
      if (pathname === '/api/custom-source/list' && req.method === 'GET') {
        const username = urlObj.searchParams.get('username') || 'default'

        // 鉴权逻辑：如果开启了页面公开访问限制
        if (global.lx.config['user.enablePublicRestriction']) {
          const auth = req.headers['x-frontend-auth']
          const isAdmin = auth === global.lx.config['frontend.password']
          const user = verifyUserAuth(req)
          if (!isAdmin && !user) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: '当前系统已开启公开访问限制，请登录后重试。' }))
            return
          }
        }

        return customSourceHandlers.handleList(req, res, username)
      }
      if (pathname === '/api/custom-source/toggle' && req.method === 'POST') {
        return customSourceHandlers.handleToggle(req, res)
      }
      if (pathname === '/api/custom-source/delete' && req.method === 'POST') {
        return customSourceHandlers.handleDelete(req, res)
      }

      if (pathname === '/api/custom-source/reorder' && req.method === 'POST') {
        return customSourceHandlers.handleReorder(req, res)
      }
      if (pathname === '/api/custom-source/update-platforms' && req.method === 'POST') {
        return customSourceHandlers.handleUpdatePlatforms(req, res)
      }

      // elFinder 文件管理器连接器
      if (pathname === '/api/elfinder/connector') {
        // [修改] 优先从 Header 获取，如果没有则尝试从 URL 参数获取 (用于支持下载和预览)
        const auth = req.headers['x-frontend-auth'] || urlObj.searchParams.get('auth')

        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        // 处理GET请求
        if (req.method === 'GET') {
          void (async () => {
            try {
              const params: any = {}
              const url = new URL(req.url || '', `http://${req.headers.host}`)
              url.searchParams.forEach((value, key) => {
                params[key] = value
              })

              const connector = new ElFinderConnector(getSystemRoot())
              const cmd = params.cmd || 'open'
              const result = await connector.handle(cmd, params)

              // [新增] 处理文件下载 (file) 和 打包下载 (zipdl)
              if ((cmd === 'file' || cmd === 'zipdl') && result.path && !result.error) {
                if (fs.existsSync(result.path)) {
                  const mime = getMime(result.path)
                  const headers: any = { 'Content-Type': mime }

                  // 如果是下载请求，或者是打包下载，强制添加附件头
                  if (params.download === '1' || cmd === 'zipdl') {
                    headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(path.basename(result.path))}"`
                  }

                  res.writeHead(200, headers)
                  fs.createReadStream(result.path).pipe(res)
                  return
                } else {
                  res.writeHead(404)
                  res.end('Not Found')
                  return
                }
              }

              res.writeHead(200, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify(result))
            } catch (err: any) {
              res.writeHead(500)
              res.end(JSON.stringify({ error: [err.message] }))
            }
          })()
          return
        }

        // 处理POST请求
        if (req.method === 'POST') {
          const contentType = req.headers['content-type'] || ''

          // 处理文件上传
          if (contentType.includes('multipart/form-data')) {
            const form = formidable({ multiples: true, uploadDir: require('os').tmpdir() })

            form.parse(req, async (err: any, fields: any, files: any) => {
              if (err) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: ['Upload error'] }))
                return
              }

              const params = { ...fields }
              // formidable v3 返回的值可能是数组，需要转换
              for (const key in params) {
                if (Array.isArray(params[key]) && params[key].length === 1) {
                  params[key] = params[key][0]
                }
              }
              console.log('[ElFinder] Files received:', Object.keys(files))
              console.log('[ElFinder] Files detail:', files)
              try {
                // 获取上传的文件（字段名可能是 upload, upload[] 等）
                const uploadedFiles = files.upload || files['upload[]'] || Object.values(files)[0]

                if (params.cmd === 'upload' && uploadedFiles) {
                  const connector = new ElFinderConnector(getSystemRoot())
                  const uploadFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles]
                  const added: any[] = []

                  for (const file of uploadFiles) {
                    const target = (connector as any).decode(params.target)
                    const destPath = require('path').join(target, file.originalFilename || file.newFilename)
                    await require('fs').promises.copyFile(file.filepath, destPath)
                    await require('fs').promises.unlink(file.filepath)

                    const fileInfo = await (connector as any).getFileInfo(destPath)
                    if (fileInfo) added.push(fileInfo)
                  }

                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ added }))
                } else {
                  const connector = new ElFinderConnector(getSystemRoot())
                  const cmd = params.cmd || 'open'
                  const result = await connector.handle(cmd, params)

                  res.writeHead(200, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify(result))
                }
              } catch (err: any) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: [err.message] }))
              }
            })
            return
          } else {
            // 普通POST数据
            void readBody(req).then(async body => {
              try {
                // 修改开始：兼容 JSON 和 x-www-form-urlencoded
                let params: any = {}
                try {
                  params = JSON.parse(body || '{}')
                } catch (e) {
                  // 如果 JSON 解析失败，尝试解析为 URL 查询参数格式
                  const urlParams = new URLSearchParams(body)
                  urlParams.forEach((value, key) => {
                    // 处理数组情况 (例如 targets[])
                    if (params[key]) {
                      if (Array.isArray(params[key])) {
                        params[key].push(value)
                      } else {
                        params[key] = [params[key], value]
                      }
                    } else {
                      params[key] = value
                    }
                  })
                }
                // 修改结束

                const connector = new ElFinderConnector(getSystemRoot())
                const cmd = params.cmd || 'open'
                const result = await connector.handle(cmd, params)

                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(result))
              } catch (err: any) {
                res.writeHead(500)
                res.end(JSON.stringify({ error: [err.message] }))
              }
            })
            return
          }
        }

        return
      }


      // Configuration API
      if (pathname === '/api/config') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        if (req.method === 'GET') {
          const config = {
            serverName: global.lx.config.serverName,
            maxSnapshotNum: global.lx.config.maxSnapshotNum,
            'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
            'proxy.enabled': global.lx.config['proxy.enabled'],
            'proxy.header': global.lx.config['proxy.header'],
            'user.enablePath': global.lx.config['user.enablePath'],
            'user.enableRoot': global.lx.config['user.enableRoot'],
            'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'],
            'user.enablePublicNonAdminLocalMusic': global.lx.config['user.enablePublicNonAdminLocalMusic'],
            'user.enablePublicNonAdminBrowserDownload': global.lx.config['user.enablePublicNonAdminBrowserDownload'] ?? true,
            'user.enablePublicNonAdminServerCache': global.lx.config['user.enablePublicNonAdminServerCache'] ?? false,
            'user.enablePublicFavorites': global.lx.config['user.enablePublicFavorites'],
            'user.enablePublicNonAdminAccess': global.lx.config['user.enablePublicNonAdminAccess'],
            'user.enableCustomMusicDir': global.lx.config['user.enableCustomMusicDir'] ?? false,
            'user.enableLoginCacheRestriction': global.lx.config['user.enableLoginCacheRestriction'],
            'user.enableCacheSizeLimit': global.lx.config['user.enableCacheSizeLimit'],
            'user.cacheSizeLimit': global.lx.config['user.cacheSizeLimit'],
            'frontend.password': global.lx.config['frontend.password'],
            'player.enableAuth': global.lx.config['player.enableAuth'] || false,
            'player.password': global.lx.config['player.password'] || '',
            'webdav.enable': global.lx.config['webdav.enable'] ?? false,
            'webdav.url': global.lx.config['webdav.url'] || '',
            'webdav.username': global.lx.config['webdav.username'] || '',
            'webdav.password': global.lx.config['webdav.password'] || '',
            'webdav.syncPath': global.lx.config['webdav.syncPath'] || '/lx-sync',
            'webdav.backupPath': global.lx.config['webdav.backupPath'] || '/lx-sync-backups',
            'sync.interval': global.lx.config['sync.interval'] || 60,
            'sync.backupInterval': global.lx.config['sync.backupInterval'] || 24,
            'proxy.all.enabled': global.lx.config['proxy.all.enabled'] || false,
            'proxy.all.address': global.lx.config['proxy.all.address'] || '',
            'admin.path': global.lx.config['admin.path'] ?? '/music',
            'player.path': global.lx.config['player.path'] ?? '/',
            'subsonic.enable': global.lx.config['subsonic.enable'] ?? true,
            'subsonic.path': global.lx.config['subsonic.path'] ?? '/rest',
            'subsonic.enableDebug': global.lx.config['subsonic.enableDebug'] ?? false,
            'subsonic.onlineSearch': global.lx.config['subsonic.onlineSearch'] ?? true,
            'subsonic.onlineSearchMode': global.lx.config['subsonic.onlineSearchMode'] ?? 'fallback',
            'subsonic.onlineSearchSources': global.lx.config['subsonic.onlineSearchSources'] ?? 'wy,tx,kw,kg,mg',
            'subsonic.lyricTranslation': global.lx.config['subsonic.lyricTranslation'] ?? true,
            'singer.sourcePriority': (global.lx.config['singer.sourcePriority'] || ['tx', 'wy']).join(','),
            'artist.maxFetchPages': global.lx.config['artist.maxFetchPages'] ?? 20,
            'system.allowUnsafeVM': global.lx.config['system.allowUnsafeVM'] || false,
            configFilePath: process.env.CONFIG_PATH || path.join(process.cwd(), 'config.js'),
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify(config))
          return
        }

        if (req.method === 'POST') {
          void readBody(req).then(body => {
            try {
              const newConfig = JSON.parse(body)
              if (newConfig.serverName !== undefined) global.lx.config.serverName = newConfig.serverName
              if (newConfig.maxSnapshotNum !== undefined) global.lx.config.maxSnapshotNum = parseInt(newConfig.maxSnapshotNum)
              if (newConfig['list.addMusicLocationType'] !== undefined) global.lx.config['list.addMusicLocationType'] = newConfig['list.addMusicLocationType']
              if (newConfig['proxy.enabled'] !== undefined) global.lx.config['proxy.enabled'] = newConfig['proxy.enabled']
              if (newConfig['proxy.header'] !== undefined) global.lx.config['proxy.header'] = newConfig['proxy.header']
              if (newConfig['user.enablePath'] !== undefined) global.lx.config['user.enablePath'] = newConfig['user.enablePath']
              // 新增：处理 user.enableRoot
              if (newConfig['user.enableRoot'] !== undefined) global.lx.config['user.enableRoot'] = newConfig['user.enableRoot']
              if (newConfig['user.enablePublicRestriction'] !== undefined) global.lx.config['user.enablePublicRestriction'] = newConfig['user.enablePublicRestriction']
              if (newConfig['user.enablePublicNonAdminLocalMusic'] !== undefined) global.lx.config['user.enablePublicNonAdminLocalMusic'] = newConfig['user.enablePublicNonAdminLocalMusic']
              if (newConfig['user.enablePublicNonAdminBrowserDownload'] !== undefined) global.lx.config['user.enablePublicNonAdminBrowserDownload'] = newConfig['user.enablePublicNonAdminBrowserDownload']
              if (newConfig['user.enablePublicNonAdminServerCache'] !== undefined) global.lx.config['user.enablePublicNonAdminServerCache'] = newConfig['user.enablePublicNonAdminServerCache']
              if (newConfig['user.enablePublicFavorites'] !== undefined) global.lx.config['user.enablePublicFavorites'] = newConfig['user.enablePublicFavorites']
              if (newConfig['user.enablePublicNonAdminAccess'] !== undefined) global.lx.config['user.enablePublicNonAdminAccess'] = newConfig['user.enablePublicNonAdminAccess']
              if (newConfig['user.enableCustomMusicDir'] !== undefined) global.lx.config['user.enableCustomMusicDir'] = newConfig['user.enableCustomMusicDir']
              if (newConfig['user.enableLoginCacheRestriction'] !== undefined) global.lx.config['user.enableLoginCacheRestriction'] = newConfig['user.enableLoginCacheRestriction']
              if (newConfig['user.enableCacheSizeLimit'] !== undefined) global.lx.config['user.enableCacheSizeLimit'] = newConfig['user.enableCacheSizeLimit']
              if (newConfig['user.cacheSizeLimit'] !== undefined) global.lx.config['user.cacheSizeLimit'] = parseInt(newConfig['user.cacheSizeLimit']) || 2000
              if (newConfig['system.allowUnsafeVM'] !== undefined) global.lx.config['system.allowUnsafeVM'] = newConfig['system.allowUnsafeVM']

              let warning = ''

              // 校验：至少开启一种模式
              if (!global.lx.config['user.enablePath'] && !global.lx.config['user.enableRoot']) {
                // 如果都关闭了，强制开启根路径（或者报错，这里建议强制开启并警告）
                global.lx.config['user.enableRoot'] = true
                warning = '必须至少开启一种连接方式，已自动开启“根路径”模式。'
              }

              // 校验：如果开启了根路径，检查密码重复
              if (global.lx.config['user.enableRoot']) {
                const passwords = global.lx.config.users.map(u => u.password)
                if (new Set(passwords).size !== passwords.length) {
                  warning = warning ? warning + '\n' : ''
                  warning += '检测到重复密码！开启“根路径”模式要求所有用户密码唯一，否则可能导致连接错误。'
                }
              }
              if (newConfig['frontend.password'] !== undefined) global.lx.config['frontend.password'] = newConfig['frontend.password']

              // Web播放器配置
              if (newConfig['player.enableAuth'] !== undefined) global.lx.config['player.enableAuth'] = newConfig['player.enableAuth']
              if (newConfig['player.password'] !== undefined) global.lx.config['player.password'] = newConfig['player.password']

              // WebDAV 配置
              if (newConfig['webdav.enable'] !== undefined) global.lx.config['webdav.enable'] = newConfig['webdav.enable']
              if (newConfig['webdav.url'] !== undefined) global.lx.config['webdav.url'] = newConfig['webdav.url']
              if (newConfig['webdav.username'] !== undefined) global.lx.config['webdav.username'] = newConfig['webdav.username']
              if (newConfig['webdav.password'] !== undefined) global.lx.config['webdav.password'] = newConfig['webdav.password']
              if (newConfig['webdav.syncPath'] !== undefined) global.lx.config['webdav.syncPath'] = newConfig['webdav.syncPath']
              if (newConfig['webdav.backupPath'] !== undefined) global.lx.config['webdav.backupPath'] = newConfig['webdav.backupPath']
              if (newConfig['sync.interval'] !== undefined) global.lx.config['sync.interval'] = parseInt(newConfig['sync.interval'])
              if (newConfig['sync.backupInterval'] !== undefined) global.lx.config['sync.backupInterval'] = parseInt(newConfig['sync.backupInterval']) || 24
              if (newConfig['proxy.all.enabled'] !== undefined) global.lx.config['proxy.all.enabled'] = newConfig['proxy.all.enabled']
              if (newConfig['proxy.all.address'] !== undefined) global.lx.config['proxy.all.address'] = newConfig['proxy.all.address']

              if (newConfig['admin.path'] !== undefined || newConfig['player.path'] !== undefined) {
                const adminPath = (newConfig['admin.path'] !== undefined ? newConfig['admin.path'] : (global.lx.config['admin.path'] ?? '/admin'))
                const playerPath = (newConfig['player.path'] !== undefined ? newConfig['player.path'] : (global.lx.config['player.path'] ?? '/'))
                const normalizedAdmin = adminPath.replace(/\/+$/, '')
                const normalizedPlayer = playerPath.replace(/\/+$/, '')

                if (normalizedPlayer !== '' && !normalizedPlayer.startsWith('/')) {
                  res.writeHead(422, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: false, error: '播放器路径必须以 / 开头或为空（代表根路径）' }))
                  return
                }
                if (normalizedAdmin !== '' && !normalizedAdmin.startsWith('/')) {
                  res.writeHead(422, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: false, error: '后台路径必须以 / 开头或为空' }))
                  return
                }
                if ((normalizedAdmin || '/') === (normalizedPlayer || '/')) {
                  res.writeHead(422, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: false, error: '后台管理路径与播放器路径不能相同' }))
                  return
                }
                if (normalizedAdmin.startsWith('/api') || normalizedPlayer.startsWith('/api')) {
                  res.writeHead(422, { 'Content-Type': 'application/json' })
                  res.end(JSON.stringify({ success: false, error: '路径不能以 /api 开头' }))
                  return
                }
                global.lx.config['admin.path'] = normalizedAdmin
                global.lx.config['player.path'] = normalizedPlayer
              }

              // 新增：Subsonic 配置保存逻辑
              if (newConfig['subsonic.enable'] !== undefined) global.lx.config['subsonic.enable'] = newConfig['subsonic.enable']
              if (newConfig['subsonic.path'] !== undefined) {
                global.lx.config['subsonic.path'] = newConfig['subsonic.path'].replace(/\/+$/, '') || '/rest'
              }
              if (newConfig['subsonic.enableDebug'] !== undefined) global.lx.config['subsonic.enableDebug'] = newConfig['subsonic.enableDebug']
              if (newConfig['subsonic.onlineSearch'] !== undefined) global.lx.config['subsonic.onlineSearch'] = newConfig['subsonic.onlineSearch']
              if (newConfig['subsonic.onlineSearchMode'] !== undefined) global.lx.config['subsonic.onlineSearchMode'] = newConfig['subsonic.onlineSearchMode']
              if (newConfig['subsonic.onlineSearchSources'] !== undefined) global.lx.config['subsonic.onlineSearchSources'] = newConfig['subsonic.onlineSearchSources']
              if (newConfig['subsonic.lyricTranslation'] !== undefined) global.lx.config['subsonic.lyricTranslation'] = newConfig['subsonic.lyricTranslation']
              if (newConfig['singer.sourcePriority'] !== undefined) {
                const priority = String(newConfig['singer.sourcePriority']).split(',').filter(s => s === 'tx' || s === 'wy') as Array<'tx' | 'wy'>
                if (priority.length > 0) global.lx.config['singer.sourcePriority'] = priority
              }
              if (newConfig['artist.maxFetchPages'] !== undefined) {
                const maxPages = Number(newConfig['artist.maxFetchPages'])
                global.lx.config['artist.maxFetchPages'] = Number.isFinite(maxPages) && maxPages > 0
                  ? Math.min(Math.floor(maxPages), 100)
                  : 20
              }

              // 更新 WebDAVSync 配置
              if (global.lx.webdavSync && (newConfig['webdav.enable'] !== undefined || newConfig['webdav.url'] || newConfig['webdav.username'] || newConfig['webdav.password'] || newConfig['webdav.syncPath'] || newConfig['webdav.backupPath'] || newConfig['sync.interval'] || newConfig['sync.backupInterval'])) {
                global.lx.webdavSync.updateConfig({
                  enable: global.lx.config['webdav.enable'],
                  url: global.lx.config['webdav.url'],
                  username: global.lx.config['webdav.username'],
                  password: global.lx.config['webdav.password'],
                  syncPath: global.lx.config['webdav.syncPath'],
                  backupPath: global.lx.config['webdav.backupPath'],
                  interval: global.lx.config['sync.interval'],
                  backupInterval: global.lx.config['sync.backupInterval'],
                })
              }

              const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.js')
              const configContent = `module.exports = ${JSON.stringify({
                serverName: global.lx.config.serverName,
                bindIP: global.lx.config.bindIP,
                port: global.lx.config.port,
                'proxy.enabled': global.lx.config['proxy.enabled'],
                'proxy.header': global.lx.config['proxy.header'],
                'user.enablePath': global.lx.config['user.enablePath'],
                'user.enableRoot': global.lx.config['user.enableRoot'],
                'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'],
                'user.enablePublicNonAdminLocalMusic': global.lx.config['user.enablePublicNonAdminLocalMusic'],
                'user.enablePublicNonAdminBrowserDownload': global.lx.config['user.enablePublicNonAdminBrowserDownload'],
                'user.enablePublicNonAdminServerCache': global.lx.config['user.enablePublicNonAdminServerCache'],
                'user.enablePublicFavorites': global.lx.config['user.enablePublicFavorites'],
                'user.enablePublicNonAdminAccess': global.lx.config['user.enablePublicNonAdminAccess'],
                'user.enableCustomMusicDir': global.lx.config['user.enableCustomMusicDir'],
                'user.enableLoginCacheRestriction': global.lx.config['user.enableLoginCacheRestriction'],
                'user.enableCacheSizeLimit': global.lx.config['user.enableCacheSizeLimit'],
                'user.cacheSizeLimit': global.lx.config['user.cacheSizeLimit'],
                maxSnapshotNum: global.lx.config.maxSnapshotNum,
                'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
                disableTelemetry: global.lx.config.disableTelemetry,
                'frontend.password': global.lx.config['frontend.password'],
                'player.enableAuth': global.lx.config['player.enableAuth'],
                'player.password': global.lx.config['player.password'],
                'webdav.enable': global.lx.config['webdav.enable'],
                'webdav.url': global.lx.config['webdav.url'],
                'webdav.username': global.lx.config['webdav.username'],
                'webdav.password': global.lx.config['webdav.password'],
                'webdav.syncPath': global.lx.config['webdav.syncPath'],
                'webdav.backupPath': global.lx.config['webdav.backupPath'],
                'sync.interval': global.lx.config['sync.interval'],
                'sync.backupInterval': global.lx.config['sync.backupInterval'],
                'proxy.all.enabled': global.lx.config['proxy.all.enabled'],
                'proxy.all.address': global.lx.config['proxy.all.address'],
                'admin.path': global.lx.config['admin.path'] ?? '/admin',
                'player.path': global.lx.config['player.path'] ?? '/',
                'subsonic.enable': global.lx.config['subsonic.enable'],
                'subsonic.path': global.lx.config['subsonic.path'],
                'subsonic.enableDebug': global.lx.config['subsonic.enableDebug'],
                'subsonic.onlineSearch': global.lx.config['subsonic.onlineSearch'],
                'subsonic.onlineSearchMode': global.lx.config['subsonic.onlineSearchMode'],
                'subsonic.onlineSearchSources': global.lx.config['subsonic.onlineSearchSources'],
                'subsonic.lyricTranslation': global.lx.config['subsonic.lyricTranslation'],
                'singer.sourcePriority': global.lx.config['singer.sourcePriority'],
                'artist.maxFetchPages': global.lx.config['artist.maxFetchPages'],
                'cache.namingPattern': global.lx.config['cache.namingPattern'],
                'system.allowUnsafeVM': global.lx.config['system.allowUnsafeVM'],
                users: global.lx.config.users.map(u => ({
                  name: u.name,
                  password: u.password,
                  maxSnapshotNum: u.maxSnapshotNum,
                  'list.addMusicLocationType': u['list.addMusicLocationType'],
                  enableCustomMusicDir: u.enableCustomMusicDir,
                  customMusicDir: u.customMusicDir,
                  allowOperateCustomMusicDir: u.allowOperateCustomMusicDir,
                })),
              }, null, 2)}`
              fs.writeFileSync(configPath, configContent)
              if (typeof global.lx?.saveConfig === 'function') {
                global.lx.saveConfig()
              }

              // 触发一次 WebDAV 同步检查（如果已配置）
              if (global.lx.webdavSync && global.lx.webdavSync.isConfigured()) {
                void global.lx.webdavSync.syncChangedFiles()
              }

              res.writeHead(200)
              res.end(JSON.stringify({ success: true, warning }))
            } catch (e) {
              res.writeHead(500)
              res.end('Server Error')
            }
          })
          return
        }
      }

      // Test Proxy API
      if (pathname === '/api/config/test-proxy' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { address } = JSON.parse(body)
            if (!address) throw new Error('Missing address')

            const url = new URL(address)
            const options: any = {
              timeout: 10000,
              headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
              }
            }

            if (url.protocol === 'http:' || url.protocol === 'https:') {
              options.proxy = address
            } else if (url.protocol.startsWith('socks')) {
              const { SocksProxyAgent } = await import('socks-proxy-agent')
              options.agent = new SocksProxyAgent(address)
            } else {
              throw new Error('Unsupported protocol: ' + url.protocol)
            }

            console.log(`[Proxy Test] Trying to connect to baidu.com via ${address}...`)
            const startTime = Date.now()
            needle.get('https://www.baidu.com', options, (err: Error | null, resp: any) => {
              const duration = Date.now() - startTime
              if (err) {
                console.error('[Proxy Test] Failed:', err.message)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, message: err.message }))
              } else {
                console.log(`[Proxy Test] Success: ${resp.statusCode} (${duration}ms)`)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true, message: `连接成功 (状态码: ${resp.statusCode}, 耗时: ${duration}ms)` }))
              }
            })
          } catch (err: any) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      // Logs API
      if (pathname === '/api/logs' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const logType = urlObj.searchParams.get('type') || 'app'
        const lines = parseInt(urlObj.searchParams.get('lines') || '100')
        const logFile = path.join(global.lx.logPath, `${logType}.log`)

        fs.readFile(logFile, 'utf-8', (err, content) => {
          if (err) {
            res.writeHead(404)
            res.end('Log file not found')
            return
          }
          const logLines = content.split('\n').slice(-lines)
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify({ logs: logLines }))
        })
        return
      }

      // Stats API
      if (pathname === '/api/stats' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const stats = {
          users: global.lx.config.users.length,
          connectedDevices: status.devices.length,
          serverStatus: status.status,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        })
        res.end(JSON.stringify(stats))
        return
      }

      // WebDAV Test Connection API
      if (pathname === '/api/webdav/test' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void webdavSync.testConnection().then((result: any) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        })
        return
      }

      // WebDAV Sync File API
      if (pathname === '/api/webdav/sync-file' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(async body => {
          try {
            const { action, path: filePath } = JSON.parse(body)
            const webdavSync = global.lx.webdavSync

            if (!webdavSync) {
              res.writeHead(500)
              res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
              return
            }

            let success = false
            if (action === 'upload') {
              success = await webdavSync.uploadFile(filePath)
            } else if (action === 'download') {
              success = await webdavSync.downloadFile(filePath)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      // WebDAV Backup API
      if (pathname === '/api/webdav/backup' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void readBody(req).then((body) => {
          const { force } = JSON.parse(body || '{}')
          void webdavSync.uploadBackup(force).then((success: boolean) => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success }))
          })
        })
        return
      }
      // WebDAV Sync All Files API
      if (pathname === '/api/webdav/sync' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void webdavSync.syncAllFiles().then((success: boolean) => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success }))
        })
        return
      }

      // WebDAV Restore API
      if (pathname === '/api/webdav/restore' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(500)
          res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }))
          return
        }

        void webdavSync.restoreFromRemote().then(async (success: boolean) => {
          if (success) {
            await reloadServerData()
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success }))
        })
        return
      }

      // WebDAV Logs API
      if (pathname === '/api/webdav/logs' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const webdavSync = global.lx.webdavSync
        if (!webdavSync) {
          res.writeHead(404)
          res.end(JSON.stringify({ logs: [] }))
          return
        }

        const logs = webdavSync.getSyncLogs()
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        })
        res.end(JSON.stringify({ logs }))
        return
      }
      // WebDAV Progress SSE API
      if (pathname === '/api/webdav/progress' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth'] || urlObj.searchParams.get('auth')
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })
        res.write('retry: 10000\\n\\n')

        const client = res
        sseClients.add(client)

        req.on('close', () => {
          sseClients.delete(client)
        })
        return
      }
      // [新增] 本地备份下载 API
      if (pathname === '/api/backup/download' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth'] || urlObj.searchParams.get('auth')
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401); res.end('Unauthorized'); return
        }

        try {
          const webdavSync = global.lx.webdavSync
          if (!webdavSync) throw new Error('Backup system not initialized')

          const zipName = await webdavSync.createBackup()
          if (!zipName) throw new Error('Backup creation failed')

          const zipPath = path.join(global.lx.dataPath, zipName)
          if (!fs.existsSync(zipPath)) throw new Error('ZIP file not found')

          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${zipName}"`,
          })
          const readStream = fs.createReadStream(zipPath)
          readStream.pipe(res)
          readStream.on('finish', () => {
            // 延时删除本地临时ZIP文件
            setTimeout(() => {
              if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)
            }, 5000)
          })
        } catch (err: any) {
          res.writeHead(500); res.end(err.message)
        }
        return
      }

      // [新增] 本地备份还原 API
      if (pathname === '/api/backup/upload' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401); res.end('Unauthorized'); return
        }

        const form = formidable({ multiples: false, uploadDir: os.tmpdir() })
        form.parse(req, async (err: any, fields: any, files: any) => {
          if (err) {
            res.writeHead(500); res.end('Upload failed: ' + err.message); return
          }
          // formidable v3 字段返回可能是数组
          let file = files.backup || files.file || Object.values(files)[0]
          if (Array.isArray(file)) file = file[0]

          if (!file || !file.filepath) {
            res.writeHead(400); res.end('No ZIP file uploaded'); return
          }

          try {
            const webdavSync = global.lx.webdavSync
            if (!webdavSync) throw new Error('Restore system not initialized')

            await webdavSync.extractZip(file.filepath, global.lx.dataPath)

            // 删除临时上传的文件
            if (fs.existsSync(file.filepath)) fs.unlinkSync(file.filepath)

            // [新增] 还原后自动触发重载
            await reloadServerData()

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true, message: 'Restore from local ZIP success and reloaded' }))
          } catch (restoreErr: any) {
            console.error('Local Restore Error:', restoreErr)
            res.writeHead(500); res.end('Restore failed: ' + restoreErr.message)
          }
        })
        return
      }

      // [新增] 管理重载 API
      if (pathname === '/api/admin/reload' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401); res.end('Unauthorized'); return
        }

        try {
          await reloadServerData()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, message: 'Server data reloaded from disk' }))
        } catch (err: any) {
          res.writeHead(500); res.end(err.message)
        }
        return
      }

      // Restart Server API
      if (pathname === '/api/restart' && req.method === 'POST') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, message: 'Server restarting...' }))

        // 延迟1秒后重启
        setTimeout(() => {
          console.log('Server restarting by admin request...')
          // 尝试通过更新文件时间戳触发 nodemon 重启
          const entryFile = path.join(process.cwd(), 'src', 'index.ts')
          try {
            if (fs.existsSync(entryFile)) {
              const time = new Date()
              fs.utimesSync(entryFile, time, time)
            } else {
              process.exit(0)
            }
          } catch (err) {
            console.error('Restart failed, forcing exit:', err)
            process.exit(0)
          }
        }, 1000)

        return
      }
      // File Management - List Files
      if (pathname === '/api/files' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const dirPath = urlObj.searchParams.get('path') || ''
        const fullPath = path.join(global.lx.dataPath, dirPath)

        // 安全检查：确保路径在 dataPath 内
        if (!fullPath.startsWith(global.lx.dataPath)) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }

        try {
          const items = fs.readdirSync(fullPath).map(name => {
            const itemPath = path.join(fullPath, name)
            const stat = fs.statSync(itemPath)
            return {
              name,
              path: path.relative(global.lx.dataPath, itemPath),
              isDirectory: stat.isDirectory(),
              size: stat.size,
              mtime: stat.mtime.getTime(),
            }
          })
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          })
          res.end(JSON.stringify({ items }))
        } catch (err: any) {
          res.writeHead(500)
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }

      // File Management - Download File
      if (pathname === '/api/files/download' && req.method === 'GET') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        const filePath = urlObj.searchParams.get('path') || ''
        const fullPath = path.join(global.lx.dataPath, filePath)

        if (!fullPath.startsWith(global.lx.dataPath)) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }

        try {
          const content = fs.readFileSync(fullPath)
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${path.basename(fullPath)}"`,
          })
          res.end(content)
        } catch (err) {
          res.writeHead(404)
          res.end('File not found')
        }
        return
      }

      // File Management - Create/Update File
      if (pathname === '/api/files' && (req.method === 'POST' || req.method === 'PUT')) {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(body => {
          try {
            const { path: filePath, content, isDirectory } = JSON.parse(body)
            const fullPath = path.join(global.lx.dataPath, filePath)

            if (!fullPath.startsWith(global.lx.dataPath)) {
              res.writeHead(403)
              res.end('Forbidden')
              return
            }

            if (isDirectory) {
              fs.mkdirSync(fullPath, { recursive: true })
            } else {
              const dir = path.dirname(fullPath)
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
              }
              fs.writeFileSync(fullPath, content || '')
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

      // File Management - Delete File
      if (pathname === '/api/files' && req.method === 'DELETE') {
        const auth = req.headers['x-frontend-auth']
        if (auth !== global.lx.config['frontend.password']) {
          res.writeHead(401)
          res.end('Unauthorized')
          return
        }

        void readBody(req).then(body => {
          try {
            const { path: filePath } = JSON.parse(body)
            const fullPath = path.join(global.lx.dataPath, filePath)

            if (!fullPath.startsWith(global.lx.dataPath)) {
              res.writeHead(403)
              res.end('Forbidden')
              return
            }

            const stat = fs.statSync(fullPath)
            if (stat.isDirectory()) {
              fs.rmSync(fullPath, { recursive: true })
            } else {
              fs.unlinkSync(fullPath)
            }

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
          } catch (err: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ success: false, message: err.message }))
          }
        })
        return
      }

    }

    const endUrl = `/${req.url?.split('/').at(-1) ?? ''}`
    let code
    let msg
    switch (endUrl) {
      case '/hello':
        // 新增：如果禁用了根路径，且当前访问的是根路径 (例如 /hello 而不是 /user/hello)，则拒绝
        if (!global.lx.config['user.enableRoot']) {
          const parts = pathname.split('/').filter(p => p)
          // parts.length <= 1 说明没有用户名部分，只有 'hello'
          if (parts.length <= 1) {
            code = 403
            msg = 'Root access disabled'
            break
          }
        }
        code = 200
        msg = SYNC_CODE.helloMsg
        break
      case '/id':
        // 新增：同上，对 /id 接口也进行同样的检查
        if (!global.lx.config['user.enableRoot']) {
          const parts = pathname.split('/').filter(p => p)
          if (parts.length <= 1) {
            code = 403
            msg = 'Root access disabled'
            break
          }
        }

        code = 200
        msg = SYNC_CODE.idPrefix + getServerId()
        break
      case '/ah':
        let targetUserName

        // 1. 尝试匹配用户路径 /<userName>/ah
        if (global.lx.config['user.enablePath']) {
          const parts = pathname.split('/').filter(p => p)
          // parts 应该是 ['username', 'ah']
          if (parts.length > 1 && parts[parts.length - 1] === 'ah') {
            targetUserName = decodeURIComponent(parts[parts.length - 2])
          }
        }

        // 2. 如果没有匹配到用户名（说明是访问的根路径 /ah，或者 URL 格式不对）
        if (!targetUserName) {
          // 如果未开启根路径模式，则拒绝访问
          if (!global.lx.config['user.enableRoot']) {
            res.writeHead(403)
            res.end('Access denied: Root path access is disabled. Please use /<username>/ah')
            return
          }
          // 如果开启了根路径，targetUserName 保持 undefined，authCode 会遍历尝试所有用户
        }

        // 将 targetUserName 传递给 authCode
        void authCode(req, res, global.lx.config.users, targetUserName)
        break
      default:
        // 如果设置了独立后台路径，兜底拦截根目录访问请求
        if (global.lx.config['admin.path'] && (pathname === '/' || pathname === '/index.html')) {
          code = 404
          msg = 'Not Found'
          break
        }

        // Serve static files
        // If root, serve index.html
        let filePath = path.join(process.cwd(), 'public', pathname === '/' ? 'index.html' : pathname)
        // Prevent directory traversal
        if (!filePath.startsWith(path.join(process.cwd(), 'public'))) {
          code = 403
          msg = 'Forbidden'
          break
        }

        // Check if file exists, if not fall back to 404 handled by serveStatic or check original logic
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          serveStatic(req, res, filePath)
          return
        }

        code = 404
        msg = 'Not Found'
        break
    }
    if (!code) return
    res.writeHead(code)
    res.end(msg)
  })

  wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  }) as unknown as LX.SocketServer

  // WebDAV Sync Progress Broadcast
  if (global.lx.webdavSync) {
    // 移除旧的监听器以防重复添加
    global.lx.webdavSync.removeAllListeners('progress')
    global.lx.webdavSync.on('progress', (data: any) => {
      // Broadcast to WebSocket clients
      if (wss) {
        const msg = JSON.stringify({ type: 'webdav_progress', data })
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg)
          }
        }
      }
      // Broadcast to SSE clients
      const sseMsg = `data: ${JSON.stringify(data)}\n\n`
      for (const client of sseClients) {
        client.write(sseMsg)
      }
    })
  }

  wss.on('connection', function (socket: any, request) {
    socket.isReady = false
    socket.moduleReadys = {
      list: false,
      dislike: false,
    }
    socket.feature = {
      list: false,
      dislike: false,
    }
    socket.on('pong', () => {
      socket.isAlive = true
    })

    // const events = new Map<keyof ActionsType, Array<(err: Error | null, data: LX.Sync.ActionSyncType[keyof LX.Sync.ActionSyncType]) => void>>()
    // const events = new Map<keyof LX.Sync.ActionSyncType, Array<(err: Error | null, data: LX.Sync.ActionSyncType[keyof LX.Sync.ActionSyncType]) => void>>()
    // let events: Partial<{ [K in keyof LX.Sync.ActionSyncType]: Array<(data: LX.Sync.ActionSyncType[K]) => void> }> = {}
    let closeEvents: Array<(err: Error) => (void | Promise<void>)> = []
    let disconnected = false
    const msg2call = createMsg2call<LX.Sync.ClientSyncActions>({
      funcsObj: callObj,
      timeout: 120 * 1000,
      sendMessage(data: any) {
        if (disconnected) throw new Error('disconnected')
        void encryptMsg(socket.keyInfo, JSON.stringify(data)).then((data: string) => {
          // console.log('sendData', eventName)
          socket.send(data)
        }).catch(err => {
          syncLog.error('encrypt message error:', err)
          syncLog.error(err.message)
          socket.close(SYNC_CLOSE_CODE.failed)
        })
      },
      onCallBeforeParams(rawArgs: any[]) {
        return [socket, ...rawArgs]
      },
      onError(error: Error, path: string[], groupName: string | null) {
        const name = groupName ?? ''
        const userName = socket.userInfo?.name ?? ''
        const deviceName = socket.keyInfo?.deviceName ?? ''
        syncLog.error(`sync call ${userName} ${deviceName} ${name} ${path.join('.')} error:`, error)
        // if (groupName == null) return
        // // TODO
        // socket.close(SYNC_CLOSE_CODE.failed)
      },
    })
    socket.remote = msg2call.remote
    socket.remoteQueueList = msg2call.createQueueRemote('list')
    socket.remoteQueueDislike = msg2call.createQueueRemote('dislike')
    socket.addEventListener('message', ({ data }: any) => {
      if (typeof data != 'string') return
      void decryptMsg(socket.keyInfo, data).then((data) => {
        let syncData: any
        try {
          syncData = JSON.parse(data)
        } catch (err) {
          syncLog.error('parse message error:', err)
          socket.close(SYNC_CLOSE_CODE.failed)
          return
        }
        msg2call.message(syncData)
      }).catch(err => {
        syncLog.error('decrypt message error:', err)
        syncLog.error(err.message)
        socket.close(SYNC_CLOSE_CODE.failed)
      })
    })
    socket.addEventListener('close', () => {
      const err = new Error('closed')
      try {
        for (const handler of closeEvents) void handler(err)
      } catch (err: any) {
        syncLog.error(err?.message)
      }
      closeEvents = []
      disconnected = true
      msg2call.destroy()
      if (socket.isReady) {
        accessLog.info('deconnection', socket.userInfo.name, socket.keyInfo.deviceName)
        // events = {}
        if (!status.devices.map(d => getUserName(d.clientId)).filter(n => n == socket.userInfo.name).length) handleUnconnection(socket.userInfo.name)
      } else {
        const queryData = new URL(request.url as string, host).searchParams
        accessLog.info('deconnection', queryData.get('i'))
      }
    })
    socket.onClose = function (handler: typeof closeEvents[number]) {
      closeEvents.push(handler)
      return () => {
        closeEvents.splice(closeEvents.indexOf(handler), 1)
      }
    }
    socket.broadcast = function (handler: any) {
      if (!wss) return
      for (const client of wss.clients) handler(client)
    }

    void handleConnection(socket, request)
  })

  httpServer.on('upgrade', function upgrade(request, socket, head) {
    socket.addListener('error', onSocketError)

    // 调用全局定义的 authConnection (在文件顶部约113行已经定义过)
    authConnection(request, (err, success) => {
      // 如果报错或者 success 为 false，则拒绝连接
      if (err || !success) {
        // console.log('Auth failed', err)
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      socket.removeListener('error', onSocketError)

      // 鉴权通过，升级协议
      // 强制删除压缩扩展头，防止 permessage-deflate 协商导致 "RSV1 must be clear" 错误
      delete request.headers['sec-websocket-extensions']
      wss?.handleUpgrade(request, socket, head, function done(ws) {
        wss?.emit('connection', ws, request)
      })
    })
  })

  const interval = setInterval(() => {
    wss?.clients.forEach(socket => {
      if (socket.isAlive == false) {
        syncLog.info('alive check false:', socket.userInfo.name, socket.keyInfo.deviceName)
        socket.terminate()
        return
      }

      socket.isAlive = false
      socket.ping(noop)
      if (socket.keyInfo.isMobile) socket.send('ping', noop)
    })
  }, 30000)

  wss?.on('close', function close() {
    clearInterval(interval)
  })

  httpServer.on('error', error => {
    console.log(error)
    reject(error)
  })

  httpServer.on('listening', () => {
    const addr = httpServer.address()
    // console.log(addr)
    if (!addr) {
      reject(new Error('address is null'))
      return
    }
    const bind = typeof addr == 'string' ? `pipe ${addr}` : `port ${addr.port}`
    startupLog.info(`Listening on ${ip} ${bind}`)
    resolve(null)
    void registerLocalSyncEvent(wss as LX.SocketServer)
  })

  host = `http://${ip.includes(':') ? `[${ip}]` : ip}:${port}`
  httpServer.listen(port, ip)
})

// const handleStopServer = async() => new Promise<void>((resolve, reject) => {
//   if (!wss) return
//   for (const client of wss.clients) client.close(SYNC_CLOSE_CODE.normal)
//   unregisterLocalSyncEvent()
//   wss.close()
//   wss = null
//   httpServer.close((err) => {
//     if (err) {
//       reject(err)
//       return
//     }
//     resolve()
//   })
// })

// export const stopServer = async() => {
//   codeTools.stop()
//   if (!status.status) {
//     status.status = false
//     status.message = ''
//     status.address = []
//     status.code = ''
//     sendStatus(status)
//     return
//   }
//   console.log('stoping sync server...')
//   await handleStopServer().then(() => {
//     console.log('sync server stoped')
//     status.status = false
//     status.message = ''
//     status.address = []
//     status.code = ''
//   }).catch(err => {
//     console.log(err)
//     status.message = err.message
//   }).finally(() => {
//     sendStatus(status)
//   })
// }

export const startServer = async (port: number, ip: string) => {
  // Initialize file cache settings from global config
  if (global.lx.config) {
    if (global.lx.config.serverCacheLocation) fileCache.setCacheLocation(global.lx.config.serverCacheLocation)
    global.lx.config['cache.namingPattern'] = fileCache.setNamingPattern(global.lx.config['cache.namingPattern'])

    // Background sync cache index for active users
    if (global.lx.config.users) {
      for (const user of global.lx.config.users) {
        void fileCache.syncCacheIndex(user.name)
      }
    }
  }

  // [新增] 注入歌词获取钩子：用于服务器缓存时自动嵌入 USLT 标签
  // SDK 的 getLyric() 返回 { promise, cancel }，必须 await .promise
  fileCache.setLyricFetcher(async (songInfo: any) => {
    try {
      const source = songInfo.source
      if (!source || !musicSdk[source] || !musicSdk[source].getLyric) {
        console.log(`[LyricFetcher] Skip: source="${source}" not supported`)
        return null
      }
      // [Fix] Strip source prefix from songmid (e.g. "tx_004bd0..." -> "004bd0...")
      let songmid: string = songInfo.songmid || songInfo.id || ''
      const sourcePrefix = `${source}_`
      if (songmid.startsWith(sourcePrefix)) songmid = songmid.slice(sourcePrefix.length)
      if (!songmid) {
        console.log(`[LyricFetcher] Skip: empty songmid`)
        return null
      }
      console.log(`[LyricFetcher] Fetching lyric: ${source}_${songmid} (${songInfo.name})`)
      const requestObj = musicSdk[source].getLyric({
        songmid,
        name: songInfo.name || '',
        singer: songInfo.singer || '',
        hash: songInfo.hash || '',
        interval: songInfo.interval || '',
      })
      const result = await requestObj.promise
      const lyricText = result?.lyric || result?.lrc || null
      console.log(`[LyricFetcher] Result: ${lyricText ? lyricText.length + ' chars' : 'null'}`)
      return lyricText
    } catch (e: any) {
      console.warn(`[LyricFetcher] Failed for "${songInfo.name}":`, e.message || e)
      return null
    }
  })

  // if (status.status) await handleStopServer()

  startupLog.info(`starting sync server in ${process.env.NODE_ENV == 'production' ? 'production' : 'development'}`)
  const proxyEnabled = global.lx.config['proxy.all.enabled']
  const proxyAddress = global.lx.config['proxy.all.address']
  console.log(`[Proxy] Music SDK Proxy: ${proxyEnabled ? `Enabled (${proxyAddress})` : 'Disabled'}`)
  startupLog.info(`Music SDK Proxy: ${proxyEnabled ? `Enabled (${proxyAddress})` : 'Disabled'}`)
  try {
    await musicSdk.init()
    startupLog.info('musicSdk initialized')
  } catch (err) {
    startupLog.error('musicSdk init failed:', err)
  }

  // 初始化自定义源
  try {
    console.log('[Server] Initializing custom user APIs...')
    // 修改：不传参数，默认加载 open + 所有用户源
    await initUserApis()
    console.log('[Server] Custom user APIs initialized')
  } catch (err: any) {
    console.error('[Server] Failed to initialize user APIs:', err.message)
  }

  // [Fix] 服务启动时从 _open 用户 settings.json 读取 serverCacheLocation 并预初始化 fileCache，
  // 避免前端初始化同步时因服务端内存状态（默认 'root'）与持久化设置不一致而触发权限检查返回 403
  try {
    const openUserSpace = getUserSpace('_open')
    const settingsPath = path.join(openUserSpace.dataManage.userDir, File.userSettingsJSON)
    if (fs.existsSync(settingsPath)) {
      const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      if (savedSettings.serverCacheLocation) {
        fileCache.setCacheLocation(savedSettings.serverCacheLocation)
        console.log(`[Server] Restored fileCache location from settings: ${savedSettings.serverCacheLocation}`)
      }
      if (savedSettings.serverCacheNamingPattern) {
        const normalizedNamingPattern = fileCache.setNamingPattern(savedSettings.serverCacheNamingPattern)
        console.log(`[Server] Restored cache naming pattern from settings: ${normalizedNamingPattern}`)
      }
    }
  } catch (err: any) {
    console.warn('[Server] Failed to restore fileCache location:', err.message)
  }

  serverDownloadQueue.initialize(async task => {
    const songInfo = normalizeSongInfo(task.songInfo)
    const apiUsername = task.username === '_open' ? 'open' : task.username
    const resolved = await resolveServerSong(songInfo, task.requestedQuality, apiUsername, true)
    return {
      url: resolved.url,
      quality: resolved.quality,
      songInfo: resolved.songInfo,
      requestedSource: resolved.requestedSource,
      downloadSource: resolved.downloadSource,
      sourceName: resolved.sourceName,
    }
  })

  remasterQueue.initialize(async (songInfo, requestedQuality, username) => {
    const apiUsername = username === '_open' ? 'open' : username
    const resolved = await resolveServerSong(songInfo, requestedQuality, apiUsername, true)
    return {
      url: resolved.url,
      quality: resolved.quality,
    }
  })

  await handleStartServer(port, ip).then(() => {
    // console.log('sync server started')
    status.status = true
    status.message = ''
    status.address = ip == '0.0.0.0' ? getAddress() : [ip]

    // void generateCode()
    // codeTools.start()
  }).catch(err => {
    console.log(err)
    status.status = false
    status.message = err.message
    status.address = []
    // status.code = ''
  })
  // .finally(() => {
  //   sendStatus(status)
  // })
}

export const getStatus = (): LX.Sync.Status => status

// export const generateCode = async() => {
//   status.code = handleGenerateCode()
//   sendStatus(status)
//   return status.code
// }

export const getDevices = async (userName: string) => {
  const userSpace = getUserSpace(userName)
  return userSpace.getDecices()
}

export const removeDevice = async (userName: string, clientId: string) => {
  if (wss) {
    for (const client of wss.clients) {
      if (client.userInfo?.name == userName && client.keyInfo?.clientId == clientId) client.close(SYNC_CLOSE_CODE.normal)
    }
  }
  const userSpace = getUserSpace(userName)
  await userSpace.removeDevice(clientId)
}
