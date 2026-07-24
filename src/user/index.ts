import { UserDataManage } from './data'
import {
  ListManage,
  DislikeManage,
} from '@/modules'
import { normalizeUsername } from '@/utils/username'

export interface UserSpace {
  dataManage: UserDataManage
  listManage: ListManage
  dislikeManage: DislikeManage
  getDecices: () => Promise<LX.Sync.KeyInfo[]>
  removeDevice: (clientId: string) => Promise<void>
}
const users = new Map<string, UserSpace>()
const renamingUsers = new Set<string>()

const delayTime = 60 * 60 * 1000 // 延长到 1 小时
const delayReleaseTimeouts = new Map<string, NodeJS.Timeout>()
const clearDelayReleaseTimeout = (userName: string) => {
  userName = normalizeUsername(userName)
  if (!delayReleaseTimeouts.has(userName)) return

  clearTimeout(delayReleaseTimeouts.get(userName))
  delayReleaseTimeouts.delete(userName)
}
const seartDelayReleaseTimeout = (userName: string) => {
  userName = normalizeUsername(userName)
  clearDelayReleaseTimeout(userName)
  delayReleaseTimeouts.set(userName, setTimeout(() => {
    users.delete(userName)
  }, delayTime))
}

export const getUserSpace = (userName: string) => {
  userName = normalizeUsername(userName)
  if (renamingUsers.has(userName)) {
    throw new Error(`User ${userName} is being renamed, access denied temporarily`)
  }
  clearDelayReleaseTimeout(userName)

  let user = users.get(userName)
  if (!user) {
    console.log('new user data manage:', userName)
    const dataManage = new UserDataManage(userName)
    const listManage = new ListManage(dataManage)
    const dislikeManage = new DislikeManage(dataManage)
    users.set(userName, user = {
      dataManage,
      listManage,
      dislikeManage,
      async getDecices() {
        return this.dataManage.getAllClientKeyInfo()
      },
      async removeDevice(clientId) {
        await listManage.removeDevice(clientId)
        await dataManage.removeClientKeyInfo(clientId)
      },
    })
  }
  return user
}

export const releaseUserSpace = (userName: string, force = false) => {
  userName = normalizeUsername(userName)
  if (force) {
    clearDelayReleaseTimeout(userName)
    users.delete(userName)
  } else seartDelayReleaseTimeout(userName)
}

/**
 * 重命名用户空间缓存并加锁
 * @param oldName 旧用户名
 */
export const renameUserSpace = (oldName: string) => {
  oldName = normalizeUsername(oldName)
  clearDelayReleaseTimeout(oldName)
  users.delete(oldName)
  renamingUsers.add(oldName)
}

/**
 * 解除重命名锁定
 * @param oldName 旧用户名
 */
export const finishRenameUserSpace = (oldName: string) => {
  oldName = normalizeUsername(oldName)
  renamingUsers.delete(oldName)
}


export * from './data'
