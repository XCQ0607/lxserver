import { type UserDataManage } from '@/user'
import { SnapshotDataManage } from './snapshotDataManage'
import { ListDataManage } from './listDataManage'
import { toMD5 } from '@/utils'

export class ListManage {
  snapshotDataManage: SnapshotDataManage
  listDataManage: ListDataManage

  constructor(userDataManage: UserDataManage) {
    this.snapshotDataManage = new SnapshotDataManage(userDataManage)
    this.listDataManage = new ListDataManage(this.snapshotDataManage)
  }

  createSnapshot = async () => {
    const listData = JSON.stringify(await this.getListData())
    const md5 = toMD5(listData)
    const snapshotInfo = await this.snapshotDataManage.getSnapshotInfo()
    console.log(md5, snapshotInfo.latest)
    if (snapshotInfo.latest == md5) return md5
    if (snapshotInfo.list.includes(md5)) {
      snapshotInfo.list.splice(snapshotInfo.list.indexOf(md5), 1)
    } else await this.snapshotDataManage.saveSnapshot(md5, listData)
    // 用户导入的备份不纳入系统快照 list/配额清理，避免被自动删除或误判为系统生成
    if (snapshotInfo.latest && !this.snapshotDataManage.isImported(snapshotInfo.latest)) {
      snapshotInfo.list.unshift(snapshotInfo.latest)
    }
    snapshotInfo.latest = md5
    snapshotInfo.time = Date.now()
    this.snapshotDataManage.saveSnapshotInfo(snapshotInfo)
    return md5
  }

  getCurrentListInfoKey = async () => {
    const snapshotInfo = await this.snapshotDataManage.getSnapshotInfo()
    if (snapshotInfo.latest) return snapshotInfo.latest
    // snapshotInfo.latest = toMD5(JSON.stringify(await this.getListData()))
    // this.snapshotDataManage.saveSnapshotInfo(snapshotInfo)
    return this.createSnapshot()
  }

  getDeviceCurrentSnapshotKey = async (clientId: string) => {
    return this.snapshotDataManage.getDeviceCurrentSnapshotKey(clientId)
  }

  updateDeviceSnapshotKey = async (clientId: string, key: string) => {
    await this.snapshotDataManage.updateDeviceSnapshotKey(clientId, key)
  }

  removeDevice = async (clientId: string) => {
    this.snapshotDataManage.removeSnapshotInfo(clientId)
  }

  getListData = async () => {
    return await this.listDataManage.getListData()
  }

  getSnapshotList = async () => {
    return this.snapshotDataManage.getSnapshotListWithMeta()
  }

  getSnapshot = async (name: string) => {
    return this.snapshotDataManage.getSnapshot(name)
  }

  restoreSnapshot = async (name: string) => {
    const listData = await this.snapshotDataManage.getSnapshot(name)
    if (!listData) throw new Error('Snapshot not found')
    await this.listDataManage.restore(listData)

    this.snapshotDataManage.clearClients()
    this.snapshotDataManage.setLatest(name)
  }

  removeSnapshot = async (name: string) => {
    await this.snapshotDataManage.removeSnapshot(name)
  }

  saveSnapshotWithTime = async (name: string, data: string, time: number) => {
    await this.snapshotDataManage.saveSnapshotWithTime(name, data, time)
  }
}

