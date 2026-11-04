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
  clients: Record<string, LX.Sync.Dislike.ListInfo>
}
export class SnapshotDataManage {
  userDataManage: UserDataManage
  dislikeDir: string
  snapshotDir: string
  snapshotInfoFilePath: string
  snapshotInfo: SnapshotInfo
  clientSnapshotKeys: string[]
  private readonly saveSnapshotInfoThrottle: () => void

  isIncluedsDevice = (key: string) => {
    return this.clientSnapshotKeys.includes(key)
  }

  clearOldSnapshot = async() => {
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

  updateDeviceSnapshotKey = async(clientId: string, key: string) => {
    // console.log('updateDeviceSnapshotKey', key)
    let client = this.snapshotInfo.clients[clientId]
    if (!client) client = this.snapshotInfo.clients[clientId] = { snapshotKey: '', lastSyncDate: 0 }
    if (client.snapshotKey) this.clientSnapshotKeys.splice(this.clientSnapshotKeys.indexOf(client.snapshotKey), 1)
    client.snapshotKey = key
    client.lastSyncDate = Date.now()
    this.clientSnapshotKeys.push(key)
    this.saveSnapshotInfoThrottle()
  }

  getDeviceCurrentSnapshotKey = async(clientId: string) => {
    // console.log('updateDeviceSnapshotKey', key)
    const client = this.snapshotInfo.clients[clientId]
    return client?.snapshotKey
  }

  getSnapshotInfo = async(): Promise<SnapshotInfo> => {
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

  getSnapshot = async(name: string) => {
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    let listData: LX.Dislike.DislikeRules
    try {
      const content = (await fs.promises.readFile(filePath)).toString('utf-8')
      // If it starts with { it is likely JSON, otherwise it's old string format (we don't write compatibility code as requested, but we should at least parse JSON properly)
      if (content.trim().startsWith('{')) {
        listData = JSON.parse(content)
      } else {
        // Fallback for old format if someone encounters it, though user said no compatibility needed. Let's just create an empty list.
        listData = { dislikeList: [] }
      }
    } catch (err) {
      syncLog.warn(err)
      return null
    }
    return listData
  }

  saveSnapshot = async(name: string, data: LX.Dislike.DislikeRules) => {
    syncLog.info('saveSnapshot', this.userDataManage.userName, name)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
      // 不喜欢快照落盘后，防抖触发一次云端备份（与歌单快照、缓存落盘上传同一入口；按配置备份 snapshots 类型）
      void (globalThis as any).lx?.scheduleOpenlistSync?.()
      // 本地备份开关打开时，复制一份快照到备份目录（"跟配置走"，复用 configBackup.enable 与备份目录约定）
      void (globalThis as any).lx?.backupSnapshotToLocal?.(filePath, this.userDataManage.userName, name)
    } catch (err) {
      syncLog.error(err)
      throw err
    }
  }

  removeSnapshot = async(name: string) => {
    syncLog.info('removeSnapshot', this.userDataManage.userName, name)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.unlinkSync(filePath)
    } catch (err) {
      syncLog.error(err)
    }
    // 一并清理本地备份目录中的对应副本（若存在），避免孤儿文件
    try {
      const backupDir = (globalThis as any).lx?.getConfigBackupDir?.()
      if (backupDir) {
        const backupPath = path.join(backupDir, 'snapshots', this.userDataManage.userName, `snapshot_${name}`)
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath)
      }
    } catch { /* ignore */ }
  }


  constructor(userDataManage: UserDataManage) {
    this.userDataManage = userDataManage

    this.dislikeDir = path.join(userDataManage.userDir, File.dislikeDir)
    checkAndCreateDirSync(this.dislikeDir)

    this.snapshotDir = path.join(this.dislikeDir, File.dislikeSnapshotDir)
    checkAndCreateDirSync(this.snapshotDir)

    this.snapshotInfoFilePath = path.join(this.dislikeDir, File.dislikeSnapshotInfoJSON)
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
