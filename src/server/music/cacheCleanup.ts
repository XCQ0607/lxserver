import fs from 'fs'
import path from 'path'

export const CACHE_MEDIA_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape', '.aac', '.opus', '.wma', '.alac', '.aiff', '.aif', '.lrc'])

// Async filesystem traversal keeps large cache trees off the server's synchronous hot path.
export const collectCacheMediaAsync = async (directory: string) => {
  const files: Array<{ path: string, size: number, used: number, mtime: number, ino: number }> = []
  const walk = async (dir: string): Promise<void> => {
    try {
      if ((await fs.promises.lstat(dir)).isSymbolicLink()) return
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(fullPath)
        else if (entry.isFile() && CACHE_MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          try {
            const stat = await fs.promises.lstat(fullPath)
            if (stat.isFile()) files.push({ path: fullPath, size: stat.size, used: Math.max(stat.atimeMs, stat.mtimeMs), mtime: stat.mtimeMs, ino: stat.ino })
          } catch (error: any) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
        }
      }
    } catch (error: any) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error }
  }
  await walk(directory)
  return files
}

// A transfer owns its audio/lyric group until completion, followed by a short handoff window.
export class CacheUsageGuard {
  private targets = new Map<string, { active: number, until: number }>()
  constructor(private now = Date.now) {}
  acquire(file: string) {
    const key = path.resolve(file).slice(0, -path.extname(file).length)
    const state = this.targets.get(key) || { active: 0, until: 0 }
    state.active++
    this.targets.set(key, state)
    let released = false
    return () => {
      if (released) return
      released = true
      state.active--
      state.until = this.now() + 30000
      setTimeout(() => {
        if (this.targets.get(key) === state && !state.active && state.until <= this.now()) this.targets.delete(key)
      }, 31000).unref()
    }
  }
  protects(file: string) {
    const resolved = path.resolve(file).slice(0, -path.extname(file).length)
    let protectedFile = false
    for (const [target, state] of this.targets) {
      if (!state.active && state.until <= this.now()) { this.targets.delete(target); continue }
      if (resolved === target) protectedFile = true
    }
    return protectedFile
  }
}

export const cleanupCacheDirectory = async (directory: string, options: {
  limitBytes?: number
  retentionMs?: number
  /** 未完成播放的缓存文件（绝对路径）；这类文件用更短的保留期并优先淘汰 */
  unplayedPaths?: Set<string>
  unplayedRetentionMs?: number
  protectedPaths: Set<string>
  refreshProtectedPaths?: () => Set<string>
  isProtected?: (file: string) => boolean
  shouldStop?: () => boolean
  onDeleted: (file: string) => void
  now?: number
}) => {
  const files = await collectCacheMediaAsync(directory)
  const groups = new Map<string, { files: typeof files, used: number }>()
  for (const file of files) {
    const key = file.path.slice(0, -path.extname(file.path).length)
    const group = groups.get(key) || { files: [], used: 0 }
    group.files.push(file)
    group.used = Math.max(group.used, file.used)
    groups.set(key, group)
  }
  const isUnplayed = (group: { files: typeof files }) => !!options.unplayedPaths && group.files.some(file => options.unplayedPaths!.has(path.resolve(file.path)))
  /** 分组实际适用的保留期：未播放缓存优先用更短的保留期 */
  const retentionFor = (group: { files: typeof files }) => isUnplayed(group) ? (options.unplayedRetentionMs ?? options.retentionMs) : options.retentionMs
  let totalSize = files.reduce((sum, file) => sum + file.size, 0)
  const overLimit = options.limitBytes !== undefined && totalSize > options.limitBytes
  const target = overLimit ? options.limitBytes! * 0.95 : Infinity
  const now = options.now ?? Date.now()
  let deletedCount = 0
  let batch = 0
  let protectedPaths = options.protectedPaths
  // 未完成播放的缓存排在前面，同等新旧时先删它们
  const ordered = [...groups.values()].sort((a, b) => (Number(isUnplayed(b)) - Number(isUnplayed(a))) || (a.used - b.used))
  for (const { files: group, used } of ordered) {
    if (batch++ % 32 === 0) {
      await new Promise<void>(resolve => setImmediate(resolve))
      protectedPaths = options.refreshProtectedPaths?.() ?? protectedPaths
    }
    if (options.shouldStop?.()) break
    const retention = retentionFor({ files: group })
    const expired = !!retention && now - used > retention
    if (!expired && !(overLimit && totalSize > target)) continue
    if (group.some(file => protectedPaths.has(path.resolve(file.path)) || options.isProtected?.(file.path))) continue
    // Each small deletion group is synchronous: no backup/download can start between protection and unlink.
    const current = group.map(file => {
      try { return fs.lstatSync(file.path) } catch { return undefined }
    })
    if (group.some((file, i) => {
      const stat = current[i]
      return !stat?.isFile() || stat.ino !== file.ino || stat.size !== file.size || stat.mtimeMs !== file.mtime ||
        (!(overLimit && totalSize > target) && (retention === undefined || now - Math.max(stat.atimeMs, stat.mtimeMs) <= retention))
    })) continue
    for (const file of group.sort((a, b) => Number(path.extname(a.path).toLowerCase() === '.lrc') - Number(path.extname(b.path).toLowerCase() === '.lrc'))) {
      try { fs.unlinkSync(file.path) } catch { break }
      totalSize -= file.size
      deletedCount++
      options.onDeleted(file.path)
    }
  }
  return { totalSize, deletedCount }
}
