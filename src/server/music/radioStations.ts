/**
 * 用户自建网络电台（Internet Radio Station）分用户隔离持久化。
 *
 * 与「官方电台」(QQ music radio_tx_*，由 discovery.fetchRadios 实时抓取) 不同，
 * 用户自建电台由用户在客户端（如音流）粘贴 streamUrl 添加，需落盘持久化。
 *
 * 存储路径：data/users/<username>/radioStations.json
 * 各用户自建电台独立隔离存储，互不干扰。
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getUserDirname } = require('@/user')

export interface RadioStation {
  id: string
  name: string
  streamUrl: string
  homepageUrl?: string
}

const userCaches = new Map<string, RadioStation[]>()

function getUserStoreFile(username: string): string {
  const userPath = (global.lx && global.lx.userPath) || path.join(process.cwd(), 'data', 'users')
  const userDir = path.join(userPath, getUserDirname(username || 'default'))
  return path.join(userDir, 'radioStations.json')
}

function load(username: string): RadioStation[] {
  if (userCaches.has(username)) return userCaches.get(username)!
  const storeFile = getUserStoreFile(username)
  let stations: RadioStation[] = []
  try {
    if (fs.existsSync(storeFile)) {
      const raw = JSON.parse(fs.readFileSync(storeFile, 'utf-8'))
      stations = Array.isArray(raw?.stations) ? raw.stations : []
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.error(`[电台服务] 解析/加载用户 ${username} 的电台配置异常:`, err)
    }
    stations = []
  }
  userCaches.set(username, stations)
  return stations
}

function persist(username: string): void {
  const storeFile = getUserStoreFile(username)
  const dir = path.dirname(storeFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storeFile, JSON.stringify({ stations: userCaches.get(username) ?? [] }, null, 2), 'utf-8')
}

export function listRadioStations(username: string): RadioStation[] {
  return load(username).map(s => ({ ...s }))
}

export function getRadioStation(username: string, id: string): RadioStation | null {
  const s = load(username).find(x => x.id === id)
  return s ? { ...s } : null
}

export function addRadioStation(username: string, name: string, streamUrl: string, homepageUrl?: string): RadioStation {
  const stations = load(username)
  const station: RadioStation = {
    id: `radio_usr_${crypto.randomUUID()}`,
    name,
    streamUrl,
    homepageUrl,
  }
  stations.push(station)
  persist(username)
  return { ...station }
}

export function updateRadioStation(
  username: string,
  id: string,
  name?: string,
  streamUrl?: string,
  homepageUrl?: string,
): RadioStation | null {
  const stations = load(username)
  const s = stations.find(x => x.id === id)
  if (!s) return null
  if (name !== undefined) s.name = name
  if (streamUrl !== undefined) s.streamUrl = streamUrl
  if (homepageUrl !== undefined) s.homepageUrl = homepageUrl
  persist(username)
  return { ...s }
}

export function removeRadioStation(username: string, id: string): boolean {
  const stations = load(username)
  const idx = stations.findIndex(x => x.id === id)
  if (idx < 0) return false
  stations.splice(idx, 1)
  persist(username)
  return true
}

