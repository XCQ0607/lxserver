import fs from 'node:fs'
import path from 'node:path'
import { resolveContainedPath } from '../auth/security'
import { parseLyrics } from '@/utils/lrcTool'
import { checkLyricCache, getCacheDir, readCachedEmbeddedLyrics } from './fileCache'
import { getCustomMusicDir, checkCustomLyricCache } from './customMusicManager'

/** All roots are resolved from the authenticated user, never from a supplied absolute path. */
export function lookupLocalLyrics(song: any, user: string): { exists: boolean; content?: any } {
  if (song.filename) {
    if (!['cache', 'music', 'custom'].includes(song.folder || 'cache')) throw new Error('歌词目录无效')
    const root = song.folder === 'custom' ? getCustomMusicDir(user) : getCacheDir(user, song.folder === 'music')
    if (!root) return { exists: false }
    const audio = resolveContainedPath(root, song.filename)
    if (!fs.existsSync(audio)) return { exists: false }
    const relative = song.filename.slice(0, song.filename.length - path.extname(song.filename).length) + '.lrc'
    const lyric = resolveContainedPath(root, relative)
    if (fs.existsSync(lyric)) {
      const content = parseLyrics(fs.readFileSync(lyric, 'utf8').replace(/^\uFEFF/, ''))
      if (content.lyric?.trim()) return { exists: true, content }
    }
    return { exists: false }
  }
  const cached = checkLyricCache(song, user)
  if (cached.exists && (cached.content?.lyric || cached.content?.lrc)?.trim()) return cached
  const custom = checkCustomLyricCache(song, user)
  if (custom.exists) return custom
  return song.includeEmbedded ? readCachedEmbeddedLyrics(song, user) : { exists: false }
}
