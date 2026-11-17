import type { DislikeRuleSet } from '@/modules/dislike/match'
import { scopeDislikeRules, parseDislikeRules } from '@/modules/dislike/match'

/**
 * dislike 规则集解析缓存。
 *
 * 原实现里每次过滤入口都会读取并重新解析整条规则串（parseDislikeRules 会对每个
 * 歌手 / 歌名做 replaceAll + toLowerCase + 版本归一化），一次请求往往触发多次，
 * 列表越大开销越明显。这里按用户缓存解析结果：
 *   - 写入时立即失效（invalidateDislikeCache），保证自己改的规则马上生效；
 *   - 并以 TTL 兜底外部（如 lx-music 客户端同步）对规则的变更。
 */

const cache = new Map<string, { ts: number, mutatedAt: number, set: DislikeRuleSet | null }>()
const mutatedAt = new Map<string, number>()
const TTL = 30 * 1000

/** 写入 dislike 规则后调用，使该用户的缓存立即失效 */
export function invalidateDislikeCache(username: string): void {
  mutatedAt.set(username, Date.now())
  cache.delete(username)
}

/**
 * 读取并（按需）解析某用户的 dislike 规则集。
 * @param readRules 读取原始规则串的函数（由各调用方封装其 userSpace 读取逻辑）
 */
export async function getCachedDislikeRuleSet(
  username: string,
  readRules: () => Promise<string>,
): Promise<DislikeRuleSet | null> {
  const mutated = mutatedAt.get(username) ?? 0
  const cached = cache.get(username)
  if (cached && cached.mutatedAt >= mutated && Date.now() - cached.ts < TTL) {
    return cached.set
  }
  let set: DislikeRuleSet | null = null
  try {
    const rules = await readRules()
    set = parseDislikeRules(String(rules || ''))

    // Merge disliked albums and artists from disk library files
    try {
      const { getUserDirname } = require('@/user')
      const path = require('node:path')
      const fs = require('node:fs')
      const uDir = getUserDirname(username)
      const dLibDir = path.join(global.lx.userPath, uDir, 'dislike', 'library')
      const albumsFile = path.join(dLibDir, 'albums.json')
      if (fs.existsSync(albumsFile)) {
        const albumsArr = JSON.parse(fs.readFileSync(albumsFile, 'utf8'))
        if (Array.isArray(albumsArr)) {
          const { normalizeText, splitSingers } = require('@/modules/dislike/match')
          for (const x of albumsArr) {
            const scoped = scopeDislikeRules(set, x.source)
            const albumName = normalizeText(String(x.name || ''))
            if (!albumName) continue
            let sSet = scoped.albums.get(albumName)
            if (!sSet) {
              sSet = new Set<string>()
              scoped.albums.set(albumName, sSet)
            }
            const singers = splitSingers(x.artistName)
            for (const s of singers) sSet.add(s)
          }
        }
      }
      const artistsFile = path.join(dLibDir, 'artists.json')
      if (fs.existsSync(artistsFile)) {
        const artistsArr = JSON.parse(fs.readFileSync(artistsFile, 'utf8'))
        if (Array.isArray(artistsArr)) {
          const { normalizeText } = require('@/modules/dislike/match')
          for (const x of artistsArr) {
            const scoped = scopeDislikeRules(set, x.source)
            const singerName = normalizeText(String(x.name || ''))
            if (singerName) scoped.singerNames.add(singerName)
          }
        }
      }
    } catch (err: any) {
      console.warn('[黑名单缓存] 合并音乐库失败:', err.message)
    }
  } catch (e) {
    console.error('[黑名单] 读取黑名单规则失败:', e)
    return cached?.set ?? null
  }
  cache.set(username, { ts: Date.now(), mutatedAt: mutated, set })
  return set
}
