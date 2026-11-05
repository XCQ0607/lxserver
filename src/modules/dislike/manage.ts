import { type UserDataManage } from '@/user'
import { SnapshotDataManage } from './snapshotDataManage'
import { DislikeDataManage } from './dislikeDataManage'
import { toMD5 } from '@/utils'

export class DislikeManage {
  snapshotDataManage: SnapshotDataManage
  dislikeDataManage: DislikeDataManage

  constructor(userDataManage: UserDataManage) {
    this.snapshotDataManage = new SnapshotDataManage(userDataManage)
    this.dislikeDataManage = new DislikeDataManage(this.snapshotDataManage)
  }

  createSnapshot = async() => {
    const listData = await this.getDislikeRules()
    const md5 = toMD5(JSON.stringify(listData))
    const snapshotInfo = await this.snapshotDataManage.getSnapshotInfo()
    console.log(md5, snapshotInfo.latest)
    if (snapshotInfo.latest == md5) return md5
    if (snapshotInfo.list.includes(md5)) {
      snapshotInfo.list.splice(snapshotInfo.list.indexOf(md5), 1)
    } else await this.snapshotDataManage.saveSnapshot(md5, listData)
    if (snapshotInfo.latest) snapshotInfo.list.unshift(snapshotInfo.latest)
    snapshotInfo.latest = md5
    snapshotInfo.time = Date.now()
    this.snapshotDataManage.saveSnapshotInfo(snapshotInfo)
    return md5
  }

  getCurrentListInfoKey = async() => {
    const snapshotInfo = await this.snapshotDataManage.getSnapshotInfo()
    if (snapshotInfo.latest) return snapshotInfo.latest
    // snapshotInfo.latest = toMD5((await this.getDislikeRules()).trim())
    // this.snapshotDataManage.saveSnapshotInfo(snapshotInfo)
    return this.createSnapshot()
  }

  getDeviceCurrentSnapshotKey = async(clientId: string) => {
    return this.snapshotDataManage.getDeviceCurrentSnapshotKey(clientId)
  }

  updateDeviceSnapshotKey = async(clientId: string, key: string) => {
    await this.snapshotDataManage.updateDeviceSnapshotKey(clientId, key)
  }

  removeDevice = async(clientId: string) => {
    this.snapshotDataManage.removeSnapshotInfo(clientId)
  }

  getDislikeRules = async() => {
    return await this.dislikeDataManage.getDislikeRules()
  }

  // 管理接口：将指定 dislike 快照恢复为当前数据（回滚）
  restoreSnapshot = async(name: string) => {
    const data = await this.snapshotDataManage.getSnapshot(name)
    if (!data) throw new Error('Snapshot not found')
    await this.dislikeDataManage.restore(data)
    this.snapshotDataManage.clearClients()
    this.snapshotDataManage.setLatest(name)
  }
}

