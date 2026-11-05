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
  snapshotDir!: string
  snapshotInfoFilePath!: string
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
      // 歌单快照落盘后，防抖触发一次云端备份（与缓存落盘上传同一入口；按配置备份 snapshots 类型）
      void (globalThis as any).lx?.scheduleOpenlistSync?.()
      // 本地备份开关打开时，复制一份快照到备份目录（"跟配置走"，复用 configBackup.enable 与备份目录约定）
      void (globalThis as any).lx?.backupSnapshotToLocal?.(filePath, this.userDataManage.userName, name)
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
      // 歌单快照落盘后，防抖触发一次云端备份（与缓存落盘上传同一入口；按配置备份 snapshots 类型）
      void (globalThis as any).lx?.scheduleOpenlistSync?.()
      // 本地备份开关打开时，复制一份快照到备份目录（"跟配置走"，复用 configBackup.enable 与备份目录约定）
      void (globalThis as any).lx?.backupSnapshotToLocal?.(filePath, this.userDataManage.userName, name)
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
    // 一并清理本地备份目录中该快照的所有带时间戳历史副本（含旧版无时间戳副本），避免孤儿文件
    void (globalThis as any).lx?.removeSnapshotLocalBackups?.(this.userDataManage.userName, name)
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


  /**
   * 动态更新快照目录并迁移历史数据（无需重启即时生效）
   * @param targetBackupPath 新的 snapshot.backupPath 配置字符串
   */
  updateSnapshotDir = (targetBackupPath?: string) => {
    const backupPathConf = (targetBackupPath !== undefined ? targetBackupPath : (global.lx.config['snapshot.backupPath'] || '')).trim()
    const oldSnapshotDir = this.snapshotDir
    let newSnapshotDir = ''

    if (backupPathConf) {
      try {
        const base = path.isAbsolute(backupPathConf)
          ? backupPathConf
          : path.join(global.lx.dataPath, backupPathConf)
        newSnapshotDir = path.join(base, this.userDataManage.userName, File.listSnapshotDir)
        checkAndCreateDirSync(newSnapshotDir)
      } catch (err) {
        syncLog.warn(`[Snapshot] 无法创建自定义快照目录 (${backupPathConf})，已安全回退到默认目录:`, err)
        newSnapshotDir = path.join(this.listDir, File.listSnapshotDir)
      }
    } else {
      newSnapshotDir = path.join(this.listDir, File.listSnapshotDir)
    }
    checkAndCreateDirSync(newSnapshotDir)

    // 确定源目录（从旧 snapshotDir 或默认 legacyDir 迁移）
    const sourceDir = oldSnapshotDir || path.join(this.listDir, File.listSnapshotDir)
    if (newSnapshotDir !== sourceDir && fs.existsSync(sourceDir)) {
      try {
        let count = 0
        for (const name of fs.readdirSync(sourceDir)) {
          const src = path.join(sourceDir, name)
          const dst = path.join(newSnapshotDir, name)
          if (!fs.existsSync(dst)) {
            try {
              fs.renameSync(src, dst)
              count++
            } catch (e) {
              syncLog.error(`[Snapshot] 迁移快照文件失败 (${name}):`, e)
            }
          }
        }
        if (count > 0) {
          syncLog.info(`[Snapshot] 用户 ${this.userDataManage.userName} 歌单快照迁移成功 (共 ${count} 个文件 -> ${newSnapshotDir})`)
        }
        if (fs.existsSync(sourceDir) && fs.readdirSync(sourceDir).length === 0) {
          try {
            fs.rmdirSync(sourceDir)
            // 向上递归清理空的父目录（如 data/snapshot/admin）
            let parent = path.dirname(sourceDir)
            while (parent && parent !== global.lx.dataPath && parent !== path.dirname(global.lx.dataPath)) {
              if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
                fs.rmdirSync(parent)
                parent = path.dirname(parent)
              } else {
                break
              }
            }
          } catch { }
        }
      } catch (err) {
        syncLog.error(`[Snapshot] 用户 ${this.userDataManage.userName} 歌单快照迁移失败:`, err)
      }
    }

    this.snapshotDir = newSnapshotDir
    this.snapshotInfoFilePath = path.join(this.snapshotDir, File.listSnapshotInfoJSON)
    const legacyInfoPath = path.join(this.listDir, File.listSnapshotInfoJSON)
    if (!fs.existsSync(this.snapshotInfoFilePath) && fs.existsSync(legacyInfoPath)) {
      try { fs.renameSync(legacyInfoPath, this.snapshotInfoFilePath) } catch (e) { syncLog.error('migrate snapshotInfo failed:', e) }
    }

    if (fs.existsSync(this.snapshotInfoFilePath)) {
      try {
        this.snapshotInfo = JSON.parse(fs.readFileSync(this.snapshotInfoFilePath).toString())
      } catch { }
    }
  }

  constructor(userDataManage: UserDataManage) {
    this.userDataManage = userDataManage

    this.listDir = path.join(userDataManage.userDir, File.listDir)
    checkAndCreateDirSync(this.listDir)

    this.snapshotInfo = { latest: null, time: 0, list: [], clients: {} }
    this.updateSnapshotDir()

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
