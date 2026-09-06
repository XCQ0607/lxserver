#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import moduleAlias from 'module-alias'
// @ts-ignore
moduleAlias.addAliases({
  '@renderer': path.join(__dirname, 'modules'),
  '@': __dirname
})

if (typeof (global as any).navigator === 'undefined') {
  (global as any).navigator = { userAgent: 'node.js' }
}

import { initLogger } from '@/utils/log4js'
import defaultConfig from './defaultConfig'
import { ENV_PARAMS, File } from './constants'
import { checkAndCreateDirSync } from './utils'

// Declare Env Params Type
type ENV_PARAMS_Type = typeof ENV_PARAMS
type ENV_PARAMS_Value_Type = ENV_PARAMS_Type[number]


process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err)
})
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason)
})

let envParams: Partial<Record<Exclude<ENV_PARAMS_Value_Type, 'LX_USER_'>, string>> = {}
let envUsers: LX.User[] = []
const envParamKeys = Object.values(ENV_PARAMS).filter(v => v != 'LX_USER_')
const parseBool = (val?: string): boolean | undefined => {
  if (val === undefined || val === null || val === '') return undefined
  const str = String(val).trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on'].includes(str)) return true
  if (['false', '0', 'no', 'n', 'off'].includes(str)) return false
  return undefined
}
const setBoolConfig = <K extends keyof LX.Config>(key: K, val?: string) => {
  const parsed = parseBool(val)
  if (parsed !== undefined) {
    // @ts-expect-error
    global.lx.config[key] = parsed
  }
}

{
  const envLog = [
    ...(envParamKeys.map(e => [e, process.env[e]]) as Array<[Exclude<ENV_PARAMS_Value_Type, 'LX_USER_'>, string]>).filter(([k, v]) => {
      if (!v) return false
      envParams[k] = v
      return true
    }),
    ...Object.entries(process.env)
      .filter(([k, v]) => {
        if (k.startsWith('LX_USER_') && !!v) {
          const name = k.replace('LX_USER_', '')
          if (name) {
            envUsers.push({
              name,
              password: v,
            })
            return true
          }
        }
        return false
      }),
  ].map(([e, v]) => `${e}: ${v as string}`)
  if (envLog.length) console.log(`Load env: \n  ${envLog.join('\n  ')}`)
}

let lastConfigHash = ''
const getConfigHash = (filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) return ''
    const content = fs.readFileSync(filePath)
    return crypto.createHash('md5').update(content).digest('hex')
  } catch {
    return ''
  }
}

const dataPath = envParams.DATA_PATH ?? path.join(__dirname, '../data')
const saveConfigToFile = () => {
  const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.js')
  const content = `module.exports = ${JSON.stringify(global.lx.config, null, 2)}`
  try {
    fs.writeFileSync(configPath, content)
    lastConfigHash = crypto.createHash('md5').update(content).digest('hex')
    // console.log('Current memory config saved to config.js')
  } catch (err) {
    console.error('Failed to save config.js:', err)
  }
}

global.lx = {
  logPath: envParams.LOG_PATH ?? path.join(__dirname, '../logs'),
  dataPath,
  userPath: path.join(dataPath, File.userDir),
  config: defaultConfig,
  staticPath: process.env.STATIC_PATH ?? path.join(process.cwd(), 'public'),
  saveConfig: saveConfigToFile,
}

const mergeConfigFileEnv = (config: Partial<Record<ENV_PARAMS_Value_Type, string>>) => {
  const envLog = []
  for (const [k, v] of Object.entries(config).filter(([k]) => k.startsWith('env.'))) {
    const envKey = k.replace('env.', '') as keyof typeof envParams
    let value = String(v)
    if (envParamKeys.includes(envKey)) {
      if (envParams[envKey] == null) {
        envLog.push(`${envKey}: ${value}`)
        envParams[envKey] = value
      }
    } else if (envKey.startsWith('LX_USER_') && value) {
      const name = k.replace('LX_USER_', '')
      if (name) {
        envUsers.push({
          name,
          password: value,
        })
        envLog.push(`${envKey}: ${value}`)
      }
    }
  }
  if (envLog.length) console.log(`Load config file env:\n  ${envLog.join('\n  ')}`)
}

const margeConfig = (p: string) => {
  let config
  try {
    config = path.extname(p) == '.js'
      ? require(p)
      : JSON.parse(fs.readFileSync(p).toString()) as LX.Config
  } catch (err: any) {
    console.warn('Read config error: ' + (err.message as string))
    return false
  }
  const newConfig = { ...global.lx.config }
  for (const key of Object.keys(defaultConfig) as Array<keyof LX.Config>) {
    // @ts-expect-error
    if (config[key] !== undefined) newConfig[key] = config[key]
  }

  console.log('Load config: ' + p)
  if (newConfig.users.length) {
    const users: LX.UserConfig[] = []
    for (const user of newConfig.users) {
      users.push({
        ...user,
        dataPath: '',
      })
    }
    newConfig.users = users
  }
  global.lx.config = newConfig

  mergeConfigFileEnv(config)
  return true
}

//加载环境变量
const p1 = path.join(__dirname, '../config.js')
fs.existsSync(p1) && margeConfig(p1)
envParams.CONFIG_PATH && fs.existsSync(envParams.CONFIG_PATH) && margeConfig(envParams.CONFIG_PATH)
if (envParams.PROXY_HEADER) {
  global.lx.config['proxy.enabled'] = true
  global.lx.config['proxy.header'] = envParams.PROXY_HEADER
}
if (envParams.MAX_SNAPSHOT_NUM) {
  const num = parseInt(envParams.MAX_SNAPSHOT_NUM)
  if (!isNaN(num)) global.lx.config.maxSnapshotNum = num
}
if (envParams.LIST_ADD_MUSIC_LOCATION_TYPE) {
  switch (envParams.LIST_ADD_MUSIC_LOCATION_TYPE) {
    case 'top':
    case 'bottom':
      global.lx.config['list.addMusicLocationType'] = envParams.LIST_ADD_MUSIC_LOCATION_TYPE
      break
  }
}
if (envParams.FRONTEND_PASSWORD) {
  global.lx.config['frontend.password'] = envParams.FRONTEND_PASSWORD
}
if (envParams.WEBDAV_ENABLE !== undefined) {
  setBoolConfig('webdav.enable', envParams.WEBDAV_ENABLE)
}
if (envParams.WEBDAV_URL) {
  global.lx.config['webdav.url'] = envParams.WEBDAV_URL
}
if (envParams.WEBDAV_USERNAME) {
  global.lx.config['webdav.username'] = envParams.WEBDAV_USERNAME
}
if (envParams.WEBDAV_PASSWORD) {
  global.lx.config['webdav.password'] = envParams.WEBDAV_PASSWORD
}
if (envParams.WEBDAV_SYNC_PATH) {
  global.lx.config['webdav.syncPath'] = envParams.WEBDAV_SYNC_PATH
}
if (envParams.WEBDAV_BACKUP_PATH) {
  global.lx.config['webdav.backupPath'] = envParams.WEBDAV_BACKUP_PATH
}
if (envParams.SYNC_INTERVAL) {
  const interval = parseInt(envParams.SYNC_INTERVAL)
  if (!isNaN(interval)) global.lx.config['sync.interval'] = interval
}
if (envParams.BACKUP_INTERVAL) {
  const backupInterval = parseInt(envParams.BACKUP_INTERVAL)
  if (!isNaN(backupInterval)) global.lx.config['sync.backupInterval'] = backupInterval
}
if (envParams.USER_ENABLE_PATH !== undefined) {
  setBoolConfig('user.enablePath', envParams.USER_ENABLE_PATH)
}
if (envParams.USER_ENABLE_ROOT !== undefined) {
  setBoolConfig('user.enableRoot', envParams.USER_ENABLE_ROOT)
}
if (envParams.PORT) {
  const port = parseInt(envParams.PORT, 10)
  if (!isNaN(port) && port > 0) global.lx.config.port = port
}
if (envParams.BIND_IP) {
  global.lx.config.bindIP = envParams.BIND_IP
}
if (envParams.ENABLE_WEBPLAYER_AUTH !== undefined) {
  setBoolConfig('player.enableAuth', envParams.ENABLE_WEBPLAYER_AUTH)
}
if (envParams.WEBPLAYER_PASSWORD) {
  global.lx.config['player.password'] = envParams.WEBPLAYER_PASSWORD
}
if (envParams.DISABLE_TELEMETRY !== undefined) {
  setBoolConfig('disableTelemetry', envParams.DISABLE_TELEMETRY)
}
if (envParams.ENABLE_PUBLIC_USER_RESTRICTION !== undefined) {
  setBoolConfig('user.enablePublicRestriction', envParams.ENABLE_PUBLIC_USER_RESTRICTION)
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC !== undefined) {
  setBoolConfig('user.enablePublicNonAdminLocalMusic', envParams.ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC)
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_BROWSER_DOWNLOAD !== undefined) {
  setBoolConfig('user.enablePublicNonAdminBrowserDownload', envParams.ENABLE_PUBLIC_NON_ADMIN_BROWSER_DOWNLOAD)
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_SERVER_CACHE !== undefined) {
  setBoolConfig('user.enablePublicNonAdminServerCache', envParams.ENABLE_PUBLIC_NON_ADMIN_SERVER_CACHE)
}
if (envParams.ENABLE_PUBLIC_FAVORITES !== undefined) {
  setBoolConfig('user.enablePublicFavorites', envParams.ENABLE_PUBLIC_FAVORITES)
}
if (envParams.ENABLE_PUBLIC_NON_ADMIN_ACCESS !== undefined) {
  setBoolConfig('user.enablePublicNonAdminAccess', envParams.ENABLE_PUBLIC_NON_ADMIN_ACCESS)
}
if (envParams.ENABLE_CUSTOM_MUSIC_DIR !== undefined) {
  setBoolConfig('user.enableCustomMusicDir', envParams.ENABLE_CUSTOM_MUSIC_DIR)
}
if (envParams.ENABLE_LOGIN_USER_CACHE_RESTRICTION !== undefined) {
  setBoolConfig('user.enableLoginCacheRestriction', envParams.ENABLE_LOGIN_USER_CACHE_RESTRICTION)
}
if (envParams.ENABLE_CACHE_SIZE_LIMIT !== undefined) {
  setBoolConfig('user.enableCacheSizeLimit', envParams.ENABLE_CACHE_SIZE_LIMIT)
}
if (envParams.CACHE_SIZE_LIMIT) {
  global.lx.config['user.cacheSizeLimit'] = parseInt(envParams.CACHE_SIZE_LIMIT) || 2000
}
if (envParams.PROXY_ALL_ENABLED !== undefined) {
  setBoolConfig('proxy.all.enabled', envParams.PROXY_ALL_ENABLED)
}
if (envParams.PROXY_ALL_ADDRESS) {
  global.lx.config['proxy.all.address'] = envParams.PROXY_ALL_ADDRESS
}
if (envParams.ADMIN_PATH !== undefined) {
  global.lx.config['admin.path'] = envParams.ADMIN_PATH
}
if (envParams.PLAYER_PATH !== undefined) {
  global.lx.config['player.path'] = envParams.PLAYER_PATH
}
if (envParams.SUBSONIC_ENABLE !== undefined) {
  setBoolConfig('subsonic.enable', envParams.SUBSONIC_ENABLE)
}
if (envParams.SUBSONIC_PATH !== undefined) {
  global.lx.config['subsonic.path'] = envParams.SUBSONIC_PATH
}
if (envParams.SUBSONIC_ENABLE_DEBUG !== undefined) {
  setBoolConfig('subsonic.enableDebug', envParams.SUBSONIC_ENABLE_DEBUG)
}
if (envParams.SUBSONIC_ONLINE_SEARCH !== undefined) {
  setBoolConfig('subsonic.onlineSearch', envParams.SUBSONIC_ONLINE_SEARCH)
}
if (envParams.SUBSONIC_ONLINE_SEARCH_MODE) {
  const mode = envParams.SUBSONIC_ONLINE_SEARCH_MODE as any
  if (['fallback', 'merge', 'local_only'].includes(mode)) {
    global.lx.config['subsonic.onlineSearchMode'] = mode
  }
}
if (envParams.SUBSONIC_ONLINE_SEARCH_SOURCES) {
  global.lx.config['subsonic.onlineSearchSources'] = envParams.SUBSONIC_ONLINE_SEARCH_SOURCES
}
if (envParams.SUBSONIC_LYRIC_TRANSLATION !== undefined) {
  setBoolConfig('subsonic.lyricTranslation', envParams.SUBSONIC_LYRIC_TRANSLATION)
}
if (envParams.ARTIST_MAX_FETCH_PAGES) {
  const pages = parseInt(envParams.ARTIST_MAX_FETCH_PAGES, 10)
  if (!isNaN(pages) && pages > 0) global.lx.config['artist.maxFetchPages'] = pages
}
if (envParams.CACHE_NAMING_PATTERN) {
  global.lx.config['cache.namingPattern'] = envParams.CACHE_NAMING_PATTERN
}
if (envParams.SYSTEM_ALLOW_UNSAFE_VM !== undefined) {
  setBoolConfig('system.allowUnsafeVM', envParams.SYSTEM_ALLOW_UNSAFE_VM)
}
if (envParams.SINGER_SOURCE_PRIORITY !== undefined) {
  const priority = envParams.SINGER_SOURCE_PRIORITY.split(',').filter(s => s === 'tx' || s === 'wy') as Array<'tx' | 'wy'>
  if (priority.length > 0) global.lx.config['singer.sourcePriority'] = priority
}
if (envParams.SERVER_NAME) {
  global.lx.config.serverName = envParams.SERVER_NAME
}

if (envUsers.length) {
  const users: LX.Config['users'] = []
  let u
  for (let user of envUsers) {
    let isLikeJSON = true
    try {
      u = JSON.parse(user.password) as Omit<LX.User, 'name'>
    } catch {
      isLikeJSON = false
    }
    if (isLikeJSON && typeof u == 'object') {
      users.push({
        name: user.name,
        ...u,
        dataPath: '',
      })
    } else {
      users.push({
        name: user.name,
        password: user.password,
        dataPath: '',
      })
    }
  }
  global.lx.config.users = users
}

const exit = (message: string): never => {
  console.error(message)
  process.exit(0)
}

const checkAndCreateDir = (path: string) => {
  try {
    checkAndCreateDirSync(path)
  } catch (e: any) {
    if (e.code !== 'EEXIST') {
      exit(`Could not set up log directory, error was: ${e.message as string}`)
    }
  }
}

const checkUserConfig = (users: LX.Config['users']) => {
  const userNames: string[] = []
  const passwords: string[] = []
  // 允许重复密码的条件：开启了路径模式 且 关闭了根路径模式
  const allowDuplicatePasswords = global.lx.config['user.enablePath'] && !global.lx.config['user.enableRoot']

  for (const user of users) {
    if (userNames.includes(user.name)) exit('User name duplicate: ' + user.name)
    if (!allowDuplicatePasswords && passwords.includes(user.password)) exit('User password duplicate: ' + user.password)
    userNames.push(user.name)
    passwords.push(user.password)
  }
}

checkAndCreateDir(global.lx.logPath)
checkAndCreateDir(global.lx.dataPath)
checkAndCreateDir(global.lx.userPath)
checkAndCreateDir(global.lx.userPath)

// Load users from users.json if exists
const usersJsonPath = path.join(global.lx.dataPath, 'users.json')
if (fs.existsSync(usersJsonPath)) {
  try {
    const users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf-8'))
    if (Array.isArray(users)) {
      console.log('Load users from users.json')
      global.lx.config.users = users.map(u => ({ ...u, dataPath: '' }))
    }
  } catch (err) {
    console.error('Failed to load users.json', err)
  }
} else {
  // Save initial users to users.json
  try {
    fs.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
      name: u.name,
      password: u.password,
      maxSnapshotNum: u.maxSnapshotNum,
      'list.addMusicLocationType': u['list.addMusicLocationType'],
    })), null, 2))
  } catch (err) {
    console.error('Failed to save users.json', err)
  }
}

checkUserConfig(global.lx.config.users)

console.log(`Users:
${global.lx.config.users.map(user => `  ${user.name}: ${user.password}`).join('\n') || '  No User'}
`)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getUserDirname } = require('@/user')
let hasUserCustomDirModified = false
for (const user of global.lx.config.users) {
  const dataPath = path.join(global.lx.userPath, getUserDirname(user.name))
  checkAndCreateDir(dataPath)
  user.dataPath = dataPath

  if (user.enableCustomMusicDir) {
    let isValid = false
    if (user.customMusicDir && typeof user.customMusicDir === 'string' && user.customMusicDir.trim()) {
      const resolvedDir = path.resolve(user.customMusicDir.trim())
      try {
        if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
          isValid = true
        }
      } catch {
        isValid = false
      }
    }
    if (!isValid) {
      console.warn(`[StartupCheck] 用户 ${user.name} 的自定义歌曲目录 [${user.customMusicDir || ''}] 无效，已自动关闭自定义目录功能并清除路径`)
      user.enableCustomMusicDir = false
      user.customMusicDir = ''
      hasUserCustomDirModified = true
    }
  }
}

if (hasUserCustomDirModified) {
  saveConfigToFile()
  try {
    fs.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
      name: u.name,
      password: u.password,
      maxSnapshotNum: u.maxSnapshotNum,
      'list.addMusicLocationType': u['list.addMusicLocationType'],
      enableCustomMusicDir: u.enableCustomMusicDir,
      customMusicDir: u.customMusicDir,
      allowOperateCustomMusicDir: u.allowOperateCustomMusicDir,
      allowWriteCustomMusicDir: u.allowWriteCustomMusicDir,
    })), null, 2))
  } catch (err) {
    console.error('Failed to update users.json after custom dir cleanup', err)
  }
}

initLogger()


/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val: string) {
  const port = parseInt(val, 10)

  if (isNaN(port) || port < 1) {
    // named pipe
    exit(`port illegal: ${val}`)
  }
  return port
}

/**
 * Get port from environment and store in Express.
 */

// const port = normalizePort(envParams.PORT ?? '9527')
// const bindIP = envParams.BIND_IP ?? '127.0.0.1'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createModuleEvent } = require('@/event')
createModuleEvent()

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('@/utils/migrate').default(global.lx.dataPath, global.lx.userPath)

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startServer } = require('@/server')

// 初始化 WebDAV 同步
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebDAVSync = require('@/utils/webdavSync').default
const webdavSync = new WebDAVSync({
  enable: global.lx.config['webdav.enable'],
  url: global.lx.config['webdav.url'],
  username: global.lx.config['webdav.username'],
  password: global.lx.config['webdav.password'],
  syncPath: global.lx.config['webdav.syncPath'],
  backupPath: global.lx.config['webdav.backupPath'],
  interval: global.lx.config['sync.interval'],
  backupInterval: global.lx.config['sync.backupInterval'],
}, global.lx.dataPath)

// 如果配置了 WebDAV，在启动时尝试从远程恢复
if (webdavSync.isConfigured()) {
  console.log('WebDAV configured, attempting to restore from remote...')
  void webdavSync.restoreFromRemote().then(async (success: boolean) => {
    if (success) {
      console.log('Data restored from WebDAV successfully')

      // 1. 重新从磁盘加载最新的 config.js 到内存 (解决实时生效问题)
      const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.js')
      if (fs.existsSync(configPath)) {
        console.log('Reloading config.js after WebDAV restore...')
        // 清除 node require 缓存以强制重载
        try {
          delete require.cache[require.resolve(configPath)]
          margeConfig(configPath)
        } catch (e) {
          console.error('Failed to hot-reload config.js:', e)
        }
      }

      // 2. 重新加载 users.json
      const usersJsonPath = path.join(global.lx.dataPath, 'users.json')
      if (fs.existsSync(usersJsonPath)) {
        try {
          const users = JSON.parse(fs.readFileSync(usersJsonPath, 'utf-8'))
          if (Array.isArray(users)) {
            console.log('Reload users from restored users.json')
            global.lx.config.users = users.map(u => ({ ...u, dataPath: '' }))

            // 重新初始化用户目录
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getUserDirname } = require('@/user')
            for (const user of global.lx.config.users) {
              const dataPath = path.join(global.lx.userPath, getUserDirname(user.name))
              checkAndCreateDir(dataPath)
              user.dataPath = dataPath
            }
          }
        } catch (err) {
          console.error('Failed to reload users.json after WebDAV restore', err)
        }
      }

      // 3. 重新加载所有自定义源 (解决前端显示加载中/旧源问题)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initUserApis } = require('@/server/userApi')
      console.log('Re-initializing user APIs after WebDAV restore...')
      await initUserApis()
    }
    // 启动自动同步
    webdavSync.startAutoSync()
  })
} else {
  console.log('WebDAV not configured, skipping remote restore')
}

// 导出 webdavSync 实例供 API 使用
global.lx.webdavSync = webdavSync

// [新增] 确保数据目录下的 _open 及 _open/library 目录存在 (用于公共受限资源 & 公开收藏)
const openDir = path.join(global.lx.userPath, '_open')
const openLibDir = path.join(openDir, 'library')
if (!fs.existsSync(openDir)) {
  fs.mkdirSync(openDir, { recursive: true })
}
if (!fs.existsSync(openLibDir)) {
  fs.mkdirSync(openLibDir, { recursive: true })
}

// 启动前最后保存一次合并后的配置，确保环境变量被固化到 config.js 中
saveConfigToFile()

startServer(global.lx.config.port, global.lx.config.bindIP)

// 监控 config.js 变动以实现热重载 (由于 nodemon 已忽略该文件)
const rootConfigPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config.js')
if (fs.existsSync(rootConfigPath)) {
  lastConfigHash = getConfigHash(rootConfigPath)
  let debounceTimer: NodeJS.Timeout | null = null
  fs.watch(rootConfigPath, (event) => {
    if (event === 'change') {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const currentHash = getConfigHash(rootConfigPath)
        // 如果内容未发生实质改变（如内部写配置触发的 fs.watch 事件），跳过热重载
        if (currentHash && currentHash === lastConfigHash) return
        lastConfigHash = currentHash

        console.log('Detected external config.js change, hot-reloading...')
        try {
          delete require.cache[require.resolve(rootConfigPath)]
          margeConfig(rootConfigPath)
          // 重新初始化各模块以使用新配置（如果需要）
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
        } catch (e) {
          console.error('Hot-reload config.js failed:', e)
        }
      }, 500)
    }
  })
}

