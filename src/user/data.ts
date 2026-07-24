import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { throttle } from '@/utils/common'
import { filterFileName, toMD5 } from '@/utils'
import { File } from '@/constants'
import { normalizeUsername, validateUsername } from '@/utils/username'


interface ServerInfo {
  serverId: string
  version: number
}
interface DevicesInfo {
  userName: string
  clients: Record<string, LX.Sync.KeyInfo>
}
const serverInfoFilePath = path.join(global.lx.dataPath, File.serverInfoJSON)
const saveServerInfoThrottle = throttle(() => {
  fs.writeFile(serverInfoFilePath, JSON.stringify(serverInfo), 'utf8', (err) => {
    if (err) console.error(err)
  })
})
let serverInfo: ServerInfo
if (fs.existsSync(serverInfoFilePath)) {
  serverInfo = JSON.parse(fs.readFileSync(serverInfoFilePath).toString())
} else {
  serverInfo = {
    serverId: randomBytes(4 * 4).toString('base64'),
    version: 2,
  }
  saveServerInfoThrottle()
}
export const getServerId = (): string => {
  return serverInfo.serverId
}
export const getVersion = () => {
  return serverInfo.version ?? 1
}
export const setVersion = (version: number) => {
  serverInfo.version = version
  saveServerInfoThrottle()
}

export const getUserDirname = (userName: string) => {
  const normalizedName = normalizeUsername(userName)
  return `${filterFileName(normalizedName)}_${toMD5(normalizedName).substring(0, 6)}`
}

const getLegacyUserDirname = (userName: string) => {
  const legacyName = validateUsername(userName)
  return filterFileName(legacyName) + '_' + toMD5(legacyName).substring(0, 6)
}

const getLegacyUserSourcePath = (userName: string) => path.join(
  global.lx.userPath,
  'source',
  validateUsername(userName),
)

export const getUserSourcePath = (userName: string) => path.join(
  global.lx.userPath,
  'source',
  normalizeUsername(userName),
)

export const getUserConfig = (userName: string): Required<LX.User> => {
  const normalizedName = normalizeUsername(userName)
  const user = global.lx.config.users.find(u => u.name === normalizedName)
  if (!user) throw new Error('user not found: ' + userName)
  return {
    maxSnapshotNum: global.lx.config.maxSnapshotNum,
    'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
    ...user,
  }
}


// 读取所有用户目录下的devicesInfo信息，建立clientId与用户的对应关系，用于非首次连接
const deviceUserMap = new Map<string, string>()
for (const deviceInfo of fs.readdirSync(global.lx.userPath).map(dirname => {
  try {
    const devicesFilePath = path.join(global.lx.userPath, dirname, File.userDevicesJSON)
    if (fs.existsSync(devicesFilePath)) {
      const devicesInfo = JSON.parse(fs.readFileSync(devicesFilePath).toString()) as DevicesInfo
      const originalUserName = validateUsername(devicesInfo.userName)
      const userName = normalizeUsername(originalUserName)
      if (
        global.lx.config.users.some(user => user.name === userName) &&
        getUserDirname(userName) == dirname
      ) {
        if (originalUserName !== userName) {
          devicesInfo.userName = userName
          fs.writeFileSync(devicesFilePath, JSON.stringify(devicesInfo, null, 2))
        }
        return { userName, devices: devicesInfo.clients }
      }
    }
  } catch (err: any) {
    console.warn(`[UserData] Ignoring invalid devices file in ${dirname}: ${err.message}`)
  }
  return { userName: '', devices: {} }
})) {
  for (const device of Object.values(deviceInfo.devices)) {
    if (deviceInfo.userName) deviceUserMap.set(device.clientId, deviceInfo.userName)
  }
}
export const getUserName = (clientId: string | null): string | null => {
  if (!clientId) return null
  const userName = deviceUserMap.get(clientId)
  if (!userName) return null
  if (!global.lx.config.users.some(user => user.name === userName)) {
    deviceUserMap.delete(clientId)
    return null
  }
  return userName
}
export const setUserName = (clientId: string, dir: string) => {
  deviceUserMap.set(clientId, normalizeUsername(dir))
}
export const deleteUserName = (clientId: string) => {
  deviceUserMap.delete(clientId)
}

/**
 * 迁移用户数据（重命名用户名）
 * @param oldName 旧用户名
 * @param newName 新用户名
 * @returns 新的数据路径
 */
export const migrateUserData = (oldName: string, newName: string) => {
  const normalizedNewName = normalizeUsername(newName)
  const oldDirname = getLegacyUserDirname(oldName)
  const newDirname = getUserDirname(normalizedNewName)
  const oldDirPath = path.join(global.lx.userPath, oldDirname)
  const newDirPath = path.join(global.lx.userPath, newDirname)
  const oldSourcePath = getLegacyUserSourcePath(oldName)
  const newSourcePath = getUserSourcePath(normalizedNewName)
  const hasUserData = fs.existsSync(oldDirPath)
  const hasSourceData = fs.existsSync(oldSourcePath)
  const hasTargetSourceData = fs.existsSync(newSourcePath)
  let sourcePathsMatch = false
  if (hasSourceData && hasTargetSourceData) {
    const oldRealPath = fs.realpathSync.native(oldSourcePath)
    const newRealPath = fs.realpathSync.native(newSourcePath)
    sourcePathsMatch = process.platform === 'win32'
      ? oldRealPath.toLowerCase() === newRealPath.toLowerCase()
      : oldRealPath === newRealPath
  }

  if (hasUserData && fs.existsSync(newDirPath)) throw new Error('Target user directory already exists')
  if (hasSourceData && hasTargetSourceData && !sourcePathsMatch) throw new Error('Target source directory already exists')
  if (!hasUserData && !hasSourceData) return newDirPath

  const copiedTargets: string[] = []
  let sourceCaseRenamed = false
  try {
    if (hasUserData) {
      copiedTargets.push(newDirPath)
      fs.cpSync(oldDirPath, newDirPath, { recursive: true })
    }
    if (hasSourceData && !sourcePathsMatch) {
      copiedTargets.push(newSourcePath)
      fs.cpSync(oldSourcePath, newSourcePath, { recursive: true })
    } else if (hasSourceData && sourcePathsMatch && oldSourcePath !== newSourcePath) {
      // Windows treats these paths as identical, so use an intermediate name to update casing.
      const tempSourcePath = `${oldSourcePath}.rename-${randomBytes(4).toString('hex')}`
      fs.renameSync(oldSourcePath, tempSourcePath)
      try {
        fs.renameSync(tempSourcePath, newSourcePath)
        sourceCaseRenamed = true
      } catch (err) {
        fs.renameSync(tempSourcePath, oldSourcePath)
        throw err
      }
    }
  } catch (err: any) {
    console.error(`[MigrateData] Copy failed: ${err.message}`)
    if (sourceCaseRenamed) {
      const tempSourcePath = `${newSourcePath}.rollback-${randomBytes(4).toString('hex')}`
      try {
        fs.renameSync(newSourcePath, tempSourcePath)
        fs.renameSync(tempSourcePath, oldSourcePath)
      } catch { }
    }
    for (const targetPath of copiedTargets.reverse()) {
      try { fs.rmSync(targetPath, { recursive: true, force: true }) } catch { }
    }
    throw err
  }

  // Update devices.json only after all user-owned directories have copied successfully.
  const devicesFilePath = path.join(newDirPath, File.userDevicesJSON)
  if (hasUserData && fs.existsSync(devicesFilePath)) {
    try {
      const devicesInfo = JSON.parse(fs.readFileSync(devicesFilePath, 'utf-8')) as DevicesInfo
      devicesInfo.userName = normalizedNewName
      fs.writeFileSync(devicesFilePath, JSON.stringify(devicesInfo, null, 2))

      for (const client of Object.values(devicesInfo.clients)) {
        deviceUserMap.set(client.clientId, normalizedNewName)
      }
    } catch (err: any) {
      console.warn(`[MigrateData] Failed to update devices.json: ${err.message}`)
    }
  }

  for (const oldPath of [hasUserData ? oldDirPath : '', hasSourceData && !sourcePathsMatch ? oldSourcePath : '']) {
    if (!oldPath) continue
    try {
      fs.rmSync(oldPath, { recursive: true, force: true })
    } catch (err: any) {
      console.warn(`[MigrateData] Could not remove old directory ${oldPath}: ${err.message}`)
    }
  }

  return newDirPath
}

export const createClientKeyInfo = (deviceName: string, isMobile: boolean): LX.Sync.KeyInfo => {
  const keyInfo: LX.Sync.KeyInfo = {
    clientId: randomBytes(4 * 4).toString('base64'),
    key: randomBytes(16).toString('base64'),
    deviceName,
    isMobile,
    lastConnectDate: 0,
  }
  return keyInfo
}

export class UserDataManage {
  userName: string
  userDir: string
  devicesFilePath: string
  devicesInfo: DevicesInfo
  private readonly saveDevicesInfoThrottle: () => void

  getAllClientKeyInfo = () => {
    return Object.values(this.devicesInfo.clients).sort((a, b) => (b.lastConnectDate ?? 0) - (a.lastConnectDate ?? 0))
  }

  saveClientKeyInfo = (keyInfo: LX.Sync.KeyInfo) => {
    if (this.devicesInfo.clients[keyInfo.clientId] == null && Object.keys(this.devicesInfo.clients).length > 101) throw new Error('max keys')
    this.devicesInfo.clients[keyInfo.clientId] = keyInfo
    this.saveDevicesInfoThrottle()
  }

  getClientKeyInfo = (clientId: string | null): LX.Sync.KeyInfo | null => {
    if (!clientId) return null
    return this.devicesInfo.clients[clientId] ?? null
  }

  removeClientKeyInfo = async (clientId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.devicesInfo.clients[clientId]
    this.saveDevicesInfoThrottle()
  }

  isIncluedsClient = (clientId: string) => {
    return Object.values(this.devicesInfo.clients).some(client => client.clientId == clientId)
  }

  constructor(userName: string) {
    this.userName = normalizeUsername(userName)
    this.userDir = path.join(global.lx.userPath, getUserDirname(this.userName))
    this.devicesFilePath = path.join(this.userDir, File.userDevicesJSON)
    this.devicesInfo = fs.existsSync(this.devicesFilePath) ? JSON.parse(fs.readFileSync(this.devicesFilePath).toString()) : { userName: this.userName, clients: {} }
    this.devicesInfo.userName = this.userName

    this.saveDevicesInfoThrottle = throttle(() => {
      fs.writeFile(this.devicesFilePath, JSON.stringify(this.devicesInfo), 'utf8', (err) => {
        if (err) console.error(err)
      })
    })
  }
}
// type UserDataManages = Map<string, UserDataManage>

// export const createUserDataManage = (user: LX.UserConfig) => {
//   const manage = Object.create(userDataManage) as typeof userDataManage
//   manage.userDir = user.dataPath
// }
