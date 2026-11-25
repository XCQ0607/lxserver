import fs from 'node:fs'
import path from 'node:path'
import { getUserDirname } from '@/user'

export interface SubsonicPreferences {
  addToDefaultList: boolean
}

const preferenceFile = (user: string) =>
  path.join(global.lx.userPath, getUserDirname(user), 'subsonic-preferences.json')

export function readSubsonicPreferences(user: string): SubsonicPreferences {
  const file = preferenceFile(user)
  if (!fs.existsSync(file)) return { addToDefaultList: false }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { addToDefaultList: data?.addToDefaultList === true }
  } catch {
    console.warn('[Subsonic设置] 用户设置无法读取，播放加入默认列表暂按关闭处理:', user)
    return { addToDefaultList: false }
  }
}

export function saveSubsonicPreferences(user: string, value: unknown): SubsonicPreferences {
  if (typeof value !== 'boolean') throw new Error('addToDefaultList must be boolean')
  const data: SubsonicPreferences = { addToDefaultList: value }
  const file = preferenceFile(user)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data), 'utf8')
  fs.renameSync(file + '.tmp', file)
  return data
}
