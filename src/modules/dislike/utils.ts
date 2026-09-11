import { SPLIT_CHAR } from '@/constants'
import { normalizeText } from '@/server/utils/songVersion'

// ─────────────────────────────────────────────
// 专辑维度规则（lxserver 扩展）
// 格式：!<专辑名>@<歌手>
//
// 按歌手拆成多条存储（一张合辑若有 A/B/C 三位歌手，则写 3 行）。
// 用 ! 前缀与「歌手(@歌手)」「歌曲(歌名@歌手)」维度区分；
// 歌手恒在 @ 末尾，故解析按最后一个 @ 切，专辑名可含 @。
// ─────────────────────────────────────────────
export const ALBUM_RULE_PREFIX = '!'

/** 生成一条专辑规则行（!<专辑名>@<歌手>）。按歌手拆多条时多次调用。 */
export const encodeAlbumRule = (albumName: string, singer: string): string => {
  return `${ALBUM_RULE_PREFIX}${albumName}${SPLIT_CHAR.DISLIKE_NAME}${singer ?? ''}`
}

/** 是否专辑规则行 */
export const isAlbumRule = (line: string): boolean => line.startsWith(ALBUM_RULE_PREFIX)

/**
 * 解析专辑规则行，非专辑规则返回 null。
 * 新格式：!<专辑名>@<歌手>（按最后一个 @ 切，歌手恒在末尾）。
 */
export const parseAlbumRule = (line: string): { albumName: string, singer: string } | null => {
  if (!isAlbumRule(line)) return null
  const body = line.slice(1)
  const idx = body.lastIndexOf(SPLIT_CHAR.DISLIKE_NAME)
  if (idx < 0) return null
  const albumName = normalizeText(body.slice(0, idx).trim())
  const singer = normalizeText(body.slice(idx + 1).trim())
  if (!albumName) return null
  return { albumName, singer }
}

export const filterRules = (rules: string) => {
  const list: string[] = []
  for (const item of rules.split('\n')) {
    const line = item.trim()
    if (!line) continue
    // 专辑规则（!<专辑名>@<歌手>）：按歌手拆分存储，专辑名可能含 @，不走歌曲规则的 @ 切分。
    // 必须「先解析再重新编码」：直接对整行 normalizeText 会把分隔符 @ 替换成 #，
    // 导致 parseAlbumRule 无法识别该行、删除侧也无法精确匹配。统一成 !<归一化专辑名>@<归一化歌手>。
    if (line.startsWith(ALBUM_RULE_PREFIX)) {
      const parsed = parseAlbumRule(line)
      list.push(parsed ? encodeAlbumRule(parsed.albumName, parsed.singer) : normalizeText(line))
      continue
    }
    let [name, singer] = item.split(SPLIT_CHAR.DISLIKE_NAME)
    if (name) {
      name = name.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
      if (singer) {
        singer = singer.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
        list.push(`${name}${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
      } else {
        list.push(name)
      }
    } else if (singer) {
      singer = singer.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
      list.push(`${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
    }
  }
  return new Set(list)
}
