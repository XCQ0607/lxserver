import { SPLIT_CHAR } from '@/constants'
import { parseAlbumRule } from './utils'
import { normalizeText, normalizeSongName } from '@/server/utils/songVersion'

/**
 * dislike 规则匹配（lxserver 通用）
 *
 * 面向 Subsonic / 推荐 / web 等所有消费方，统一判定一首歌是否命中不喜欢规则。
 * 三个维度：歌曲（歌名@歌手）、歌手（@歌手）、专辑（!<source>:<albumId>@<singer>）。
 */

export { normalizeText, normalizeSongName }

/** 拆分歌手字段：「A、B」「A,B」「A/B」「A feat.B」「A & B」 */
export const splitSingers = (singer: unknown): string[] =>
  String(singer ?? '')
    .split(/[、,，\/]|\s*(?:feat\.?|ft\.?|featuring|&|;)\s*/i)
    .map(s => normalizeText(s))
    .filter(Boolean)

export interface DislikeRuleSet {
  /** 精确规则：歌名@歌手 */
  exact: Set<string>
  /** 纯歌名规则 */
  musicNames: Set<string>
  /** 纯歌手规则：@歌手 */
  singerNames: Set<string>
  /** 专辑规则：专辑名(归一化) -> 该专辑歌手集合(归一化) */
  albums: Map<string, Set<string>>
}

/**
 * 解析规则串（服务端专用）。
 * 与 filterRules 的区别：这里会把专辑规则（! 前缀）单独分离出来，
 * 而不是混进歌曲规则里。
 */
export function parseDislikeRules(rules: string): DislikeRuleSet {
  const set: DislikeRuleSet = {
    exact: new Set(),
    musicNames: new Set(),
    singerNames: new Set(),
    albums: new Map(),
  }

  for (const raw of String(rules || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue

    // 专辑维度（!<专辑名>@<歌手>，按歌手多条，聚合到专辑名 -> 歌手集合）
    const album = parseAlbumRule(line)
    if (album) {
      const name = normalizeText(album.albumName)
      const singer = normalizeText(album.singer)
      if (!name) continue
      let s = set.albums.get(name)
      if (!s) { s = new Set<string>(); set.albums.set(name, s) }
      if (singer) s.add(singer)
      continue
    }

    // 歌曲 / 歌手维度
    const [name, singer] = line.split(SPLIT_CHAR.DISLIKE_NAME)
    const n = normalizeText(name)
    const s = normalizeText(singer)
    // 额外登记「去后缀」版本，让「晴天 (Live)」也能命中「晴天」规则（反之亦然）。
    // 开关关闭时匹配端不会用归一化名，这些额外 key 自然不会被命中。
    if (n && s) {
      set.exact.add(`${n}${SPLIT_CHAR.DISLIKE_NAME}${s}`)
      const nn = normalizeSongName(n)
      if (nn && nn !== n) set.exact.add(`${nn}${SPLIT_CHAR.DISLIKE_NAME}${s}`)
    } else if (n) {
      set.musicNames.add(n)
      const nn = normalizeSongName(n)
      if (nn && nn !== n) set.musicNames.add(nn)
    } else if (s) {
      set.singerNames.add(s)
    }
  }

  return set
}

export interface DislikeMatchInput {
  name?: string
  singer?: string
  source?: string
  albumId?: string | number
  albumName?: string
  singerId?: string | number
}

export interface DislikeMatchOptions {
  /**
   * 跨平台同名是否也算命中（默认 false）。
   * 由于各平台歌手/专辑 ID 互不相通，且无映射表，
   * 开启后同名不同歌手、同名不同专辑会被一并屏蔽（有误伤风险）。
   *
   * 注意：只有带平台信息的维度（目前是专辑）能真正区分；
   * 歌手 / 歌曲规则只存名字、无平台信息，因此天然跨平台命中。
   */
  crossSource?: boolean

  /**
   * 多歌手匹配模式（合唱歌曲与专辑维度共用，如「A、B」）：
   * - any     任一位歌手命中即屏蔽（默认，最积极，合辑友好）
   * - all     所有歌手都命中才屏蔽（最保守，避免误伤合作者）
   * - primary 只看第一位（主唱）歌手
   */
  duetMode?: 'any' | 'all' | 'primary'

  /**
   * 歌名是否做「去版本后缀」归一化（默认 true）。
   * 让「晴天 (Live)」也能命中「晴天」规则，提升召回。
   */
  normalizeName?: boolean

  /**
   * 歌曲 / 专辑级别是否都要求歌手同时匹配（默认 true）。
   * 开启后，只记了歌名、没记歌手的纯歌名规则不会单独命中，
   * 避免不同歌手的同名歌曲被一起屏蔽；专辑同理。
   */
  requireSinger?: boolean
}

/**
 * 判定是否命中不喜欢规则。
 *
 * 匹配顺序（严格 → 宽松）：
 *   1. 专辑：source + albumId 精确匹配，并用歌手做二次校验
 *      （挡住不同歌手的同名专辑，如两张都叫《同名专辑》）
 *   2. 歌手：@歌手 规则
 *   3. 歌曲：歌名@歌手 精确规则，纯歌名规则
 */
export function isDisliked(
  input: DislikeMatchInput,
  set: DislikeRuleSet,
  options: DislikeMatchOptions = {},
): boolean {
  const crossSource = options.crossSource === true
  const duetMode = options.duetMode || 'any'
  const normalizeName = options.normalizeName !== false
  const requireSinger = options.requireSinger !== false

  const name = normalizeText(input.name)
  const allSingers = splitSingers(input.singer)
  // primary 模式只看主唱（第一位歌手）
  const singers = duetMode === 'primary' ? allSingers.slice(0, 1) : allSingers
  const source = normalizeText(input.source)
  // 候选歌名：原名 + 去后缀名（去重），提升对 Live / Remix 等版本的召回
  const candidateNames = Array.from(new Set(
    [name, normalizeName ? normalizeSongName(input.name) : ''].filter(Boolean)
  ))

  // 1. 专辑维度（专辑名 + 歌手集合，复用 duetMode 决定多歌手判定方式）
  if (input.albumName) {
    const albumName = normalizeText(input.albumName)
    const albumSingers = set.albums.get(albumName)
    if (albumSingers && albumSingers.size > 0) {
      if (singers.length === 0) {
        // 歌曲没有歌手信息：无法确认歌手集合关系，保守放过（避免误杀）
      } else if (duetMode === 'all') {
        // all：歌曲全部歌手都落在专辑歌手集合内才屏蔽（不被合作者误伤）
        if (singers.every(s => albumSingers.has(s))) return true
      } else {
        // any / primary：歌曲任一歌手（primary 仅主唱）命中专辑歌手集合即屏蔽（合辑友好）
        if (singers.some(s => albumSingers.has(s))) return true
      }
    }
  }

  // 2. 歌手维度
  if (singers.length > 0) {
    if (duetMode === 'all') {
      // all：所有歌手都被屏蔽才算命中，避免牵连合作者
      if (singers.every(s => set.singerNames.has(s))) return true
    } else {
      for (const s of singers) {
        if (set.singerNames.has(s)) return true
      }
    }
  }

  // 3. 歌曲维度（歌名 + 歌手 双重校验）
  for (const n of candidateNames) {
    if (!n) continue

    // 纯歌名规则（只记了歌名、没记歌手）：
    // requireSinger 时不单独命中，避免不同歌手的同名歌曲被一起屏蔽
    if (set.musicNames.has(n) && !requireSinger) return true

    if (singers.length > 0) {
      if (duetMode === 'all') {
        if (singers.every(s => set.exact.has(`${n}${SPLIT_CHAR.DISLIKE_NAME}${s}`))) return true
      } else {
        for (const s of singers) {
          if (set.exact.has(`${n}${SPLIT_CHAR.DISLIKE_NAME}${s}`)) return true
        }
      }
    }
  }

  return false
}

/** 批量过滤 */
export function filterDisliked<T>(
  items: T[],
  set: DislikeRuleSet,
  toInput: (item: T) => DislikeMatchInput,
  options: DislikeMatchOptions = {},
): T[] {
  if (!items || items.length === 0) return items
  return items.filter(item => !isDisliked(toInput(item), set, options))
}
