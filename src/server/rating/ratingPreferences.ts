import fs from 'node:fs'
import path from 'node:path'
import { getUserDirname } from '@/user'
export interface RatingPreferences { dislikeAutoRating: boolean }
const preferenceFile = (user: string) => path.join(global.lx.userPath, getUserDirname(user), 'rating', 'preferences.json')
export function readRatingPreferences(user: string): RatingPreferences {
  const file = preferenceFile(user)
  if (!fs.existsSync(file)) return { dislikeAutoRating: false }
  try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return { dislikeAutoRating: data.dislikeAutoRating === true } }
  catch { console.warn('[评分设置] 用户设置无法读取，自动补分暂按关闭处理:', user); return { dislikeAutoRating: false } }
}
export function saveRatingPreferences(user: string, value: unknown): RatingPreferences {
  if (typeof value !== 'boolean') throw new Error('dislikeAutoRating must be boolean')
  const data = { dislikeAutoRating: value }
  const file = preferenceFile(user)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data), 'utf8'); fs.renameSync(file + '.tmp', file)
  return data
}
