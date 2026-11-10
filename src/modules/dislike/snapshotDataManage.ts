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
  /** 由用户上传导入的快照 id；系统自动生成的快照不在此列 */
  imported: string[]
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

  /** 兼容旧版 snapshotInfo.json（无 imported 字段） */
  private getImported = (): string[] => {
    if (!Array.isArray(this.snapshotInfo.imported)) this.snapshotInfo.imported = []
    return this.snapshotInfo.imported
  }

  /**
   * 来源登记直接同步落盘，不走 saveSnapshotInfoThrottle：
   * 该节流回调会触发 clearOldSnapshot，避免在清理路径里互相触发写入。
   */
  private persistSnapshotInfo = () => {
    try {
      fs.writeFileSync(this.snapshotInfoFilePath, JSON.stringify(this.snapshotInfo))
    } catch (err) {
      syncLog.warn(err)
    }
  }

  /** 登记用户导入的备份，来源由服务端显式持久化，不靠文件名/latest 推断 */
  markImported = (name: string) => {
    const imported = this.getImported()
    if (imported.includes(name)) return
    imported.push(name)
    this.persistSnapshotInfo()
  }

  /** 删除快照时移除来源登记 */
  unmarkImported = (name: string) => {
    const imported = this.getImported()
    const idx = imported.indexOf(name)
    if (idx < 0) return
    imported.splice(idx, 1)
    this.persistSnapshotInfo()
  }

  /**
   * 判定是否为导入来源：优先读显式登记；兼容本次改动前已导入的备份——
   * 系统自动快照 id 恒为 32 位 md5，其余 id 只可能是外部导入的文件名。
   */
  isImported = (name: string): boolean =>
    this.getImported().includes(name) || !/^[0-9a-f]{32}$/.test(name)

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

  // 回滚时清空客户端快照键，迫使其下次同步重新拉取最新数据
  clearClients = () => {
    this.snapshotInfo.clients = {}
    this.clientSnapshotKeys = []
    this.saveSnapshotInfoThrottle()
  }

  // 将指定快照标记为 latest，使「当前 dislike 数据」回滚到该快照
  setLatest = (name: string) => {
    this.snapshotInfo.latest = name
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
    if (global.lx?.restoreMaintenance) throw new Error('恢复维护中，请重启服务')
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

  /** 导入外部下载的 dislike 备份：直接写入原始 JSON 内容并保留文件时间（与歌单快照 saveSnapshotWithTime 同构） */
  saveSnapshotWithTime = async(name: string, data: string, time: number) => {
    syncLog.info('saveSnapshotWithTime', this.userDataManage.userName, name, time)
    const filePath = path.join(this.snapshotDir, `snapshot_${name}`)
    try {
      fs.writeFileSync(filePath, data)
      if (time) {
        const date = new Date(time)
        fs.utimesSync(filePath, date, date)
      }
      // 导入来源是显式登记的，避免下次自动快照把它误当成系统快照
      this.markImported(name)
      void (globalThis as any).lx?.scheduleOpenlistSync?.()
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
      throw err
    }
    this.unmarkImported(name)
    // 一并清理本地备份目录中该快照的所有带时间戳历史副本（含旧版无时间戳副本），避免孤儿文件
    void (globalThis as any).lx?.removeSnapshotLocalBackups?.(this.userDataManage.userName, name)
  }

  /** 列出不喜欢快照（与歌单快照 getSnapshotListWithMeta 同构，供 /api/data/snapshots 合并展示） */
  getSnapshotListWithMeta = async (): Promise<Array<{ id: string, time: number, size: number, origin: 'imported' | 'auto' }>> => {
    const list: Array<{ id: string, time: number, size: number, origin: 'imported' | 'auto' }> = []
    try {
      const files = await fs.promises.readdir(this.snapshotDir)
      for (const file of files) {
        if (!file.startsWith('snapshot_')) continue
        const name = file.replace('snapshot_', '')
        const filePath = path.join(this.snapshotDir, file)
        try {
          const stat = await fs.promises.stat(filePath)
          list.push({ id: name, time: stat.mtimeMs, size: stat.size, origin: this.isImported(name) ? 'imported' : 'auto' })
        } catch { /* ignore missing files */ }
      }
    } catch (err) {
      syncLog.error(err)
    }
    return list.sort((a, b) => b.time - a.time)
  }


  /**
   * 动态更新快照目录并迁移历史数据（无需重启即时生效）
   * 与歌单快照（<base>/<user>/snapshot）区分，dislike 快照使用 <base>/<user>/dislike/snapshot
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
        newSnapshotDir = path.join(base, this.userDataManage.userName, File.dislikeDir, File.dislikeSnapshotDir)
        checkAndCreateDirSync(newSnapshotDir)
      } catch (err) {
        syncLog.warn(`[DislikeSnapshot] 无法创建自定义快照目录 (${backupPathConf})，已安全回退到默认目录:`, err)
        newSnapshotDir = path.join(this.dislikeDir, File.dislikeSnapshotDir)
      }
    } else {
      newSnapshotDir = path.join(this.dislikeDir, File.dislikeSnapshotDir)
    }
    checkAndCreateDirSync(newSnapshotDir)

    // 迁移旧快照目录中的历史文件
    const sourceDir = oldSnapshotDir || path.join(this.dislikeDir, File.dislikeSnapshotDir)
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
              syncLog.error(`[DislikeSnapshot] 迁移快照文件失败 (${name}):`, e)
            }
          }
        }
        if (count > 0) {
          syncLog.info(`[DislikeSnapshot] 用户 ${this.userDataManage.userName} 不喜欢快照迁移成功 (共 ${count} 个文件 -> ${newSnapshotDir})`)
        }
        if (fs.existsSync(sourceDir) && fs.readdirSync(sourceDir).length === 0) {
          try { fs.rmdirSync(sourceDir) } catch { }
        }
      } catch (err) {
        syncLog.error(`[DislikeSnapshot] 用户 ${this.userDataManage.userName} 不喜欢快照迁移失败:`, err)
      }
    }

    this.snapshotDir = newSnapshotDir
  }

  constructor(userDataManage: UserDataManage) {
    this.userDataManage = userDataManage

    this.dislikeDir = path.join(userDataManage.userDir, File.dislikeDir)
    checkAndCreateDirSync(this.dislikeDir)

    this.snapshotDir = ''
    this.snapshotInfoFilePath = path.join(this.dislikeDir, File.dislikeSnapshotInfoJSON)
    this.snapshotInfo = fs.existsSync(this.snapshotInfoFilePath)
      ? JSON.parse(fs.readFileSync(this.snapshotInfoFilePath).toString())
      : { latest: null, time: 0, list: [], imported: [], clients: {} }

    this.updateSnapshotDir()

    this.saveSnapshotInfoThrottle = throttle(() => {
      if (global.lx?.restoreMaintenance) return
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
