/**
 * 用户自建网络电台（Internet Radio Station）持久化。
 *
 * 与「官方电台」(QQ music radio_tx_*，由 discovery.fetchRadios 实时抓取) 不同，
 * 用户自建电台由用户在客户端（如音流）粘贴 streamUrl 添加，需落盘持久化。
 *
 * 存储路径：process.env.DATA_PATH || cwd/data/radioStations.json
 * （与 userApi / customSourceHandlers 等模块保持一致，Docker 下由 DATA_PATH 卷挂载）
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export interface RadioStation {
  id: string
  name: string
  streamUrl: string
  homepageUrl?: string
}

const DATA_PATH = process.env.DATA_PATH || path.join(process.cwd(), 'data')
const STORE_FILE = path.join(DATA_PATH, 'radioStations.json')

let cache: RadioStation[] | null = null

function load(): RadioStation[] {
  if (cache) return cache
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'))
      cache = Array.isArray(raw?.stations) ? raw.stations : []
    } else {
      cache = []
    }
  } catch {
    cache = []
  }
  return cache ?? []
}

function persist(): void {
  try {
    if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true })
    fs.writeFileSync(STORE_FILE, JSON.stringify({ stations: cache ?? [] }, null, 2), 'utf-8')
  } catch (err) {
    console.error('[RadioStations] persist failed:', err)
  }
}

export function listRadioStations(): RadioStation[] {
  return load().map(s => ({ ...s }))
}

export function getRadioStation(id: string): RadioStation | null {
  const s = load().find(x => x.id === id)
  return s ? { ...s } : null
}

export function addRadioStation(name: string, streamUrl: string, homepageUrl?: string): RadioStation {
  const stations = load()
  const station: RadioStation = {
    id: `radio_usr_${crypto.randomUUID()}`,
    name,
    streamUrl,
    homepageUrl,
  }
  stations.push(station)
  persist()
  return { ...station }
}

export function updateRadioStation(
  id: string,
  name?: string,
  streamUrl?: string,
  homepageUrl?: string,
): RadioStation | null {
  const stations = load()
  const s = stations.find(x => x.id === id)
  if (!s) return null
  if (name !== undefined) s.name = name
  if (streamUrl !== undefined) s.streamUrl = streamUrl
  if (homepageUrl !== undefined) s.homepageUrl = homepageUrl
  persist()
  return { ...s }
}

export function removeRadioStation(id: string): boolean {
  const stations = load()
  const idx = stations.findIndex(x => x.id === id)
  if (idx < 0) return false
  stations.splice(idx, 1)
  persist()
  return true
}
