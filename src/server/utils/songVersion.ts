import { SPLIT_CHAR } from '@/constants'

/**
 * 歌名 / 歌手归一化（dislike 匹配、排序、折叠共用）。
 *
 * 这些函数在 filterDisliked 里会被「每首歌 × 每歌手 × 每条规则」反复调用，
 * 因此结果在此处集中缓存，避免重复 replaceAll + toLowerCase 的开销。
 */

const normalizeCache = new Map<string, string>()
const NORMALIZE_CACHE_LIMIT = 5000

const cachedNormalize = (key: string, compute: () => string): string => {
  const hit = normalizeCache.get(key)
  if (hit !== undefined) return hit
  const out = compute()
  if (normalizeCache.size > NORMALIZE_CACHE_LIMIT) normalizeCache.clear()
  normalizeCache.set(key, out)
  return out
}

/** 归一化：与 filterRules 保持一致（@ → #、去空格、小写） */
export const normalizeText = (value: unknown): string =>
  cachedNormalize(`t:${value ?? ''}`, () =>
    String(value ?? '')
      .replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS)
      .trim()
      .toLowerCase()
  )

/** 歌名版本后缀正则（Live / Remix / 现场 / 伴奏 …），供排序、折叠、归一化共用 */
export const VERSION_SUFFIX_RE =
  /[\s\-–—_]*[（(](?:live|remix|现场|伴奏|纯音乐|demo|翻唱|acoustic|instrumental|off\s*vocal|版)[^）)]*[）)]\s*$/i

/**
 * 归一化歌名：剥离常见版本后缀。
 * 「晴天 (Live)」「晴天 - Remix」「晴天（现场版）」→「晴天」，
 * 提升 dislike / 排序 / 折叠的跨版本召回。
 */
export const normalizeSongName = (value: unknown): string =>
  cachedNormalize(`s:${value ?? ''}`, () => {
    const base = normalizeText(value)
    return base.replace(VERSION_SUFFIX_RE, '').trim()
  })
