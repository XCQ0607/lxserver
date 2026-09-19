import { throttle } from '@/utils/common'
import fs from 'node:fs'
import path from 'node:path'
import { syncLog } from '@/utils/log4js'
import { checkAndCreateDirSync } from '@/utils'
import { getUserConfig, type UserDataManage } from '@/user/data'
import { File } from '@/constants'

interface SnapshotInfo {
  latest: string | null
  time: number
  list: string[]
  clients: Record<string, LX.Sync.List.ListInfo>
}
export class SnapshotDataManage {
  userDataManage: UserDataManage
  listDir: string
  snapshotDir: string
  snapshotInfoFilePath: string
  snapshotInfo: SnapshotInfo
  clientSnapshotKeys: string[]
  private readonly saveSnapshotInfoThrottle: () => void

  isIncluedsDevice = (key: string) => {
    return this.clientSnapshotKeys.includes(key)
  }

  clearOldSnapshot = async () => {
    if (!this.snapshotInfo) return
    const snapshotList = this.snapshotInfo.list.filter(key => !this.isIncluedsDevice(key))
    // console.log(snapshotList.length, lx.config.maxSnapshotNum)
    const userMaxSnapshotNum = getUserConfig(this.userDataManage.userName).maxSnapshotNum
    let requiredSave = snapshotList.length > userMaxSnapshotNum
    while (snapshotList.length > userMaxSnapshotNum) {
      const name = snapshotList.pop()
      if (name) {
        await this.removeSnapshot(name)
        this.snapshotInfo.list.splice(this.snapshotInfo.list.indexOf(name), 1)
      } else break
    }
    if (requiredSave) this.saveSnapshotInfo(this.snapshotInfo)
  }

  updateDeviceSnapshotKey = async (clientId: string, key: string) => {
    // console.log('updateDeviceSnapshotKey', key)
    let client = this.snapshotInfo.clients[clientId]
    if (!client) client = this.snapshotInfo.clients[clientId] = { snapshotKey: '', lastSyncDate: 0 }
    if (client.snapshotKey) this.clientSnapshotKeys.splice(this.clientSnapshotKeys.indexOf(client.snapshotKey), 1)
    client.snapshotKey = key
    client.lastSyncDate = Date.now()
    this.clientSnapshotKeys.push(key)
    this.saveSnapshotInfoThrottle()
  }

  getDeviceCurrentSnapshotKey = async (clientId: string) => {
    // console.log('updateDeviceSnapshotKey', key)
    const client = this.snapshotInfo.clients[clientId]
    return client?.snapshotKey
  }

  getSnapshotInfo = async (): Promise<SnapshotInfo> => {
    return this.snapshotInfo
  }

  saveSnapshotInfo = (info: SnapshotInfo) => {
    this.snapshotInfo = info
    this.saveSnapshotInfoThrottle()
  }

  removeSnapshotInfo = (clientId: string) => {
    let client = this.snapshotInfo.clients[clientId]
    if (!client) return
    if (client.snapshotKey) this.clientSnapshotKeys.splice(this.clientSnapshotKeys.indexOf(client.snapshotKey), 1)
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.snapshotInfo.clients[clientId]
    this.saveSnapshotInfoThrottle()
  }

  getSnapshot = async (name: string) => {
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    let listData: LX.Sync.List.ListData
    try {
      listData = JSON.parse((await fs.promises.readFile(filePath)).toString('utf-8'))
    } catch (err) {
      syncLog.warn(err)
      return null
    }
    return listData
  }

  saveSnapshot = async (name: string, data: string) => {
    syncLog.info('saveSnapshot', this.userDataManage.userName, name)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.writeFileSync(filePath, data)
    } catch (err) {
      syncLog.error(err)
      throw err
    }
  }

  saveSnapshotWithTime = async (name: string, data: string, time: number) => {
    syncLog.info('saveSnapshotWithTime', this.userDataManage.userName, name, time)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.writeFileSync(filePath, data)
      if (time) {
        const date = new Date(time)
        fs.utimesSync(filePath, date, date)
      }
    } catch (err) {
      syncLog.error(err)
      throw err
    }
  }

  removeSnapshot = async (name: string) => {
    syncLog.info('removeSnapshot', this.userDataManage.userName, name)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.unlinkSync(filePath)
    } catch (err) {
      syncLog.error(err)
    }
  }

  getSnapshotListWithMeta = async () => {
    const list = []
    try {
      const files = await fs.promises.readdir(this.snapshotDir)
      for (const file of files) {
        if (!file.startsWith('snapshot_')) continue
        const name = file.replace('snapshot_', '')
        const filePath = path.join(this.snapshotDir, file)
        try {
          const stat = await fs.promises.stat(filePath)
          list.push({
            id: name,
            time: stat.mtimeMs,
            size: stat.size,
          })
        } catch (e) {
          // ignore missing files
        }
      }
    } catch (err) {
      syncLog.error(err)
    }
    // Sort by time desc
    return list.sort((a, b) => b.time - a.time)
  }

  clearClients = () => {
    this.snapshotInfo.clients = {}
    this.clientSnapshotKeys = []
    this.saveSnapshotInfoThrottle()
  }

  setLatest = (name: string) => {
    this.snapshotInfo.latest = name
    this.saveSnapshotInfoThrottle()
  }


  constructor(userDataManage: UserDataManage) {
    this.userDataManage = userDataManage

    this.listDir = path.join(userDataManage.userDir, File.listDir)
    checkAndCreateDirSync(this.listDir)

    // [歌单快照额外备份路径] 配置了 snapshot.backupPath 时，快照存到该路径下（按用户名隔离），否则用默认 list/snapshot
    const backupPathConf = (global.lx.config['snapshot.backupPath'] || '').trim()
    if (backupPathConf) {
      const base = path.isAbsolute(backupPathConf)
        ? backupPathConf
        : path.join(global.lx.dataPath, backupPathConf)
      this.snapshotDir = path.join(base, userDataManage.userName, File.listSnapshotDir)
    } else {
      this.snapshotDir = path.join(this.listDir, File.listSnapshotDir)
    }
    checkAndCreateDirSync(this.snapshotDir)

    // 迁移旧快照：默认路径（list/snapshot）下的数据整体搬迁到当前 snapshotDir
    const legacySnapshotDir = path.join(this.listDir, File.listSnapshotDir)
    if (this.snapshotDir !== legacySnapshotDir && fs.existsSync(legacySnapshotDir)) {
      for (const name of fs.readdirSync(legacySnapshotDir)) {
        const src = path.join(legacySnapshotDir, name)
        const dst = path.join(this.snapshotDir, name)
        if (!fs.existsSync(dst)) {
          try { fs.renameSync(src, dst) } catch (e) { syncLog.error('migrate snapshot file failed:', name, e) }
        }
      }
      if (fs.readdirSync(legacySnapshotDir).length === 0) {
        try { fs.rmdirSync(legacySnapshotDir) } catch { /* ignore */ }
      }
    }

    // 快照元数据文件（snapshotInfo.json）跟随 snapshotDir 存放，首次运行从旧位置迁移
    this.snapshotInfoFilePath = path.join(this.snapshotDir, File.listSnapshotInfoJSON)
    const legacyInfoPath = path.join(this.listDir, File.listSnapshotInfoJSON)
    if (!fs.existsSync(this.snapshotInfoFilePath) && fs.existsSync(legacyInfoPath)) {
      try { fs.renameSync(legacyInfoPath, this.snapshotInfoFilePath) } catch (e) { syncLog.error('migrate snapshotInfo failed:', e) }
    }
    this.snapshotInfo = fs.existsSync(this.snapshotInfoFilePath)
      ? JSON.parse(fs.readFileSync(this.snapshotInfoFilePath).toString())
      : { latest: null, time: 0, list: [], clients: {} }

    this.saveSnapshotInfoThrottle = throttle(() => {
      fs.writeFile(this.snapshotInfoFilePath, JSON.stringify(this.snapshotInfo), 'utf8', (err) => {
        if (err) console.error(err)
        void this.clearOldSnapshot()
      })
    })

    this.clientSnapshotKeys = Object.values(this.snapshotInfo.clients).map(device => device.snapshotKey).filter(k => k)
  }
}
// type UserDataManages = Map<string, UserDataManage>

// export const createUserDataManage = (user: LX.UserConfig) => {
//   const manage = Object.create(userDataManage) as typeof userDataManage
//   manage.userDir = user.dataPath
// }
