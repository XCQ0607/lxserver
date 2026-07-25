import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { File } from '@/constants'
import { getUserDirname, getUserSpace } from '@/user'
import { normalizeUsername, tryNormalizeUsername } from '@/utils/username'

interface PlaylistShareRecord {
  id: string
  fromUser: string
  toUser: string
  playlistId: string
  playlistName: string
  songs: LX.Music.MusicInfo[]
  createdAt: number
}

export interface PlaylistShareSummary {
  id: string
  fromUser: string
  playlistName: string
  songCount: number
  createdAt: number
}

export class PlaylistSharingError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
  }
}

const SHARE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000
const MAX_PENDING_SHARES = 100
const processingShares = new Set<string>()

const getUserDir = (username: string) => path.join(global.lx.userPath, getUserDirname(username))
const getSettingsPath = (username: string) => path.join(getUserDir(username), File.userSettingsJSON)
const getSharesPath = (username: string) => path.join(getUserDir(username), File.userPlaylistSharesJSON)

const readJsonObject = (filePath: string): Record<string, any> => {
  if (!fs.existsSync(filePath)) return {}
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const readShares = (username: string): PlaylistShareRecord[] => {
  const filePath = getSharesPath(username)
  if (!fs.existsSync(filePath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - SHARE_EXPIRY_MS
    const valid = parsed.filter(item =>
      item &&
      typeof item.id === 'string' &&
      typeof item.fromUser === 'string' &&
      typeof item.playlistName === 'string' &&
      Array.isArray(item.songs) &&
      Number(item.createdAt) >= cutoff,
    ) as PlaylistShareRecord[]
    if (valid.length !== parsed.length) writeShares(username, valid)
    return valid
  } catch {
    return []
  }
}

const writeShares = (username: string, shares: PlaylistShareRecord[]) => {
  const userDir = getUserDir(username)
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true })
  fs.writeFileSync(getSharesPath(username), JSON.stringify(shares, null, 2), 'utf8')
}

const cloneSongs = (songs: LX.Music.MusicInfo[]): LX.Music.MusicInfo[] => JSON.parse(JSON.stringify(songs))

export const isPlaylistSharingEnabled = (username: string) => {
  const settings = readJsonObject(getSettingsPath(normalizeUsername(username)))
  return settings.enablePlaylistSharing === true
}

export const setPlaylistSharingEnabled = (username: string, enabled: boolean) => {
  username = normalizeUsername(username)
  const userDir = getUserDir(username)
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true })
  const settings = readJsonObject(getSettingsPath(username))
  settings.enablePlaylistSharing = enabled
  fs.writeFileSync(getSettingsPath(username), JSON.stringify(settings, null, 2), 'utf8')
  return enabled
}

export const createPlaylistShare = async (fromUser: string, rawToUser: unknown, playlistId: unknown) => {
  fromUser = normalizeUsername(fromUser)
  if (!isPlaylistSharingEnabled(fromUser)) {
    throw new PlaylistSharingError(403, 'sharing_disabled', '请先在设置中开启歌单分享')
  }

  const normalizedTarget = tryNormalizeUsername(rawToUser)
  const target = normalizedTarget && global.lx.config.users.find(user => user.name === normalizedTarget)
  if (!target) throw new PlaylistSharingError(404, 'user_not_found', '未找到该用户')
  if (target.name === fromUser) throw new PlaylistSharingError(400, 'same_user', '不能分享给自己')
  if (!isPlaylistSharingEnabled(target.name)) {
    throw new PlaylistSharingError(409, 'recipient_disabled', `用户 ${target.name} 未开启歌单分享，不接受分享歌单`)
  }
  if (typeof playlistId !== 'string' || !playlistId) {
    throw new PlaylistSharingError(400, 'invalid_playlist', '请选择要分享的歌单')
  }

  const listData = await getUserSpace(fromUser).listManage.getListData()
  const playlist = listData.userList.find(list => list.id === playlistId)
  if (!playlist) throw new PlaylistSharingError(404, 'playlist_not_found', '未找到要分享的歌单')
  if (!Array.isArray(playlist.list) || playlist.list.length === 0) {
    throw new PlaylistSharingError(400, 'empty_playlist', '空歌单不能分享')
  }

  const pending = readShares(target.name)
  const existing = pending.find(item => item.fromUser === fromUser && item.playlistId === playlist.id)
  const share: PlaylistShareRecord = {
    id: existing?.id || crypto.randomUUID(),
    fromUser,
    toUser: target.name,
    playlistId: playlist.id,
    playlistName: playlist.name || '未命名歌单',
    songs: cloneSongs(playlist.list),
    createdAt: Date.now(),
  }

  if (existing) pending.splice(pending.indexOf(existing), 1, share)
  else {
    if (pending.length >= MAX_PENDING_SHARES) {
      throw new PlaylistSharingError(409, 'recipient_inbox_full', '对方的待处理分享已满，请稍后再试')
    }
    pending.push(share)
  }
  writeShares(target.name, pending)
  return { id: share.id, updated: !!existing, toUser: target.name }
}

export const getPendingPlaylistShares = (username: string): PlaylistShareSummary[] => {
  username = normalizeUsername(username)
  return readShares(username)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ id, fromUser, playlistName, songs, createdAt }) => ({
      id,
      fromUser,
      playlistName,
      songCount: songs.length,
      createdAt,
    }))
}

export const respondToPlaylistShare = async (username: string, shareId: unknown, action: unknown) => {
  username = normalizeUsername(username)
  if (!isPlaylistSharingEnabled(username)) {
    throw new PlaylistSharingError(403, 'sharing_disabled', '请先开启歌单分享后再处理请求')
  }
  if (typeof shareId !== 'string' || !['accept', 'reject'].includes(String(action))) {
    throw new PlaylistSharingError(400, 'invalid_request', '分享处理参数无效')
  }
  if (processingShares.has(shareId)) {
    throw new PlaylistSharingError(409, 'processing', '该分享正在处理中')
  }

  processingShares.add(shareId)
  try {
    const pending = readShares(username)
    const index = pending.findIndex(item => item.id === shareId)
    if (index < 0) throw new PlaylistSharingError(404, 'share_not_found', '该分享已处理或不存在')
    const share = pending[index]

    if (action === 'reject') {
      pending.splice(index, 1)
      writeShares(username, pending)
      return { accepted: false }
    }

    const userSpace = getUserSpace(username)
    const currentData = await userSpace.listManage.getListData()
    const marker = `shared:${share.id}`
    let importedList = currentData.userList.find(list => list.sourceListId === marker)
    if (!importedList) {
      const newListId = `shared_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
      await userSpace.listManage.listDataManage.userListCreate({
        id: newListId,
        name: `${share.playlistName}（${share.fromUser} 分享）`,
        sourceListId: marker,
        position: -1,
        locationUpdateTime: Date.now(),
      })
      await userSpace.listManage.listDataManage.listMusicOverwrite(newListId, cloneSongs(share.songs))
      await userSpace.listManage.createSnapshot()
      importedList = (await userSpace.listManage.getListData()).userList.find(list => list.id === newListId)
    }

    // Importing creates a snapshot asynchronously. Re-read the inbox afterwards so
    // shares received or updated while the import was running are not lost.
    const latestPending = readShares(username)
    writeShares(username, latestPending.filter(item =>
      item.id !== shareId || item.createdAt !== share.createdAt,
    ))
    return {
      accepted: true,
      playlistId: importedList?.id,
      playlistName: importedList?.name,
    }
  } finally {
    processingShares.delete(shareId)
  }
}
