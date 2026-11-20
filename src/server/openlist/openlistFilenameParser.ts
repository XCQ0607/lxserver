import { CACHE_NAMING_PATTERNS, normalizeNamingPattern } from '../music/cacheNamingPattern'

/**
 * 云端音频文件名反解析（灾备重建用）。
 *
 * 设计前提：文件名格式由用户配置决定，绝不是固定格式。
 * 全局配置为 config['cache.namingPattern']，用户级为 users/<user>/settings.json
 * 的 serverCacheNamingPattern（见 fileCache.ts 的 getUserNamingPattern）；
 * 存量云端文件还可能来自历史配置或别的用户，因此：
 *   1. 先按调用方传入的「该用户当前配置」解析；
 *   2. 解析不了时按全部 5 种已支持模式逐一尝试，并明确标注使用的是哪种模式；
 *   3. 绝不因为解析结果去改写文件名或生成逻辑。
 *
 * 只有 STANDARD 模式（{Name}_-_{Singer}_-_{Source}_-_{ID}_-_{Quality}）
 * 与冲突后缀 ` (id)` 能还原歌曲 ID；其余模式只能给出歌名/歌手/音质/专辑，
 * 调用方必须继续走内嵌标签或反查流程，不能假装拿到了 songId。
 */

export interface ParsedCloudFilename {
    /** 实际用于解析的命名模式 */
    pattern: string | null
    /** 是否与调用方声明的（用户/全局）配置一致 */
    matchesConfiguredPattern: boolean
    name?: string
    singer?: string
    quality?: string
    album?: string
    source?: string
    /** normalizeSongId 形式（如 tx_xxx），只有 STANDARD / 冲突后缀能提供 */
    songId?: string
    /** 是否从文件名还原出了可唯一定位歌曲的 ID */
    idResolvable: boolean
    /** exact=按配置解析成功；fallback=按其他模式解析；none=无法解析 */
    confidence: 'exact' | 'fallback' | 'none'
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.ape', '.aac', '.opus', '.wma', '.alac', '.aiff', '.aif', '.lrc'])

function stripExtension(filename: string): string {
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
    return AUDIO_EXTENSIONS.has(ext) ? filename.slice(0, -ext.length) : filename
}

/** 歌曲 ID 形如 tx_xxx / kw_123456 或纯字母数字串；歌名里的「(女版)」等不算 */
const ID_LIKE = /^(?:[a-z]{2,4}_)?[A-Za-z0-9_-]{6,64}$/

/** 去掉 getFileName 为处理重名追加的 ` (id)` 后缀，并把括号内容当作备选歌曲 ID */
function splitCollisionSuffix(base: string): { base: string, suffixId?: string } {
    const match = base.match(/ \(([^()]+)\)$/)
    if (!match || !ID_LIKE.test(match[1])) return { base }
    return { base: base.slice(0, -match[0].length), suffixId: match[1] }
}

function parseStandard(parts: string[]) {
    if (parts.length !== 5) return null
    const [name, singer, source, id, quality] = parts
    if (!name || !singer || !source || !id || !quality) return null
    return { name, singer, source, songId: id, quality }
}

function parseByPattern(base: string, pattern: string) {
    if (pattern === CACHE_NAMING_PATTERNS.STANDARD) {
        return parseStandard(base.split('_-_').map(s => s.trim()))
    }
    const parts = base.split(' - ').map(s => s.trim())
    switch (pattern) {
        case CACHE_NAMING_PATTERNS.SIMPLE:
            if (parts.length !== 4) return null
            return { name: parts[0], singer: parts[1], quality: parts[2], album: parts[3] }
        case CACHE_NAMING_PATTERNS.SINGER_NAME_QUALITY_ALBUM:
            if (parts.length !== 4) return null
            return { singer: parts[0], name: parts[1], quality: parts[2], album: parts[3] }
        case CACHE_NAMING_PATTERNS.SINGER_NAME:
            if (parts.length !== 2) return null
            return { singer: parts[0], name: parts[1] }
        case CACHE_NAMING_PATTERNS.NAME_SINGER:
            if (parts.length !== 2) return null
            return { name: parts[0], singer: parts[1] }
        default:
            return null
    }
}

/** 尝试顺序：能还原 ID 的 STANDARD 优先，其次信息量更大的 4 段模式 */
const FALLBACK_ORDER = [
    CACHE_NAMING_PATTERNS.STANDARD,
    CACHE_NAMING_PATTERNS.SIMPLE,
    CACHE_NAMING_PATTERNS.SINGER_NAME_QUALITY_ALBUM,
    CACHE_NAMING_PATTERNS.NAME_SINGER,
    CACHE_NAMING_PATTERNS.SINGER_NAME,
]

/**
 * @param filename 云端文件的 basename（可带扩展名，可带子目录前缀，取 basename 即可）
 * @param configuredPattern 该用户当前的命名模式；不传则用全局配置，再没有则只做多模式兜底
 */
export function parseCloudFilename(filename: string, configuredPattern?: string): ParsedCloudFilename {
    const empty: ParsedCloudFilename = {
        pattern: null, matchesConfiguredPattern: false, idResolvable: false, confidence: 'none',
    }
    if (!filename || typeof filename !== 'string') return empty

    const basename = filename.split(/[\\/]/).pop() || ''
    const { base, suffixId } = splitCollisionSuffix(stripExtension(basename))
    if (!base) return empty

    const declared = normalizeNamingPattern(configuredPattern ?? global.lx?.config?.['cache.namingPattern'])
    const candidates = [declared, ...FALLBACK_ORDER.filter(p => p !== declared)]
    let firstMatch: { pattern: string, fields: NonNullable<ReturnType<typeof parseByPattern>> } | null = null

    for (const pattern of candidates) {
        const fields = parseByPattern(base, pattern)
        if (!fields) continue
        if (!firstMatch) firstMatch = { pattern, fields }
        // 按配置解析成功即可停止；否则继续尝试能给出更多字段的模式
        if (pattern === declared) break
    }
    if (!firstMatch) return empty

    const { pattern, fields } = firstMatch
    const songId = (fields as any).songId || suffixId
    return {
        pattern,
        matchesConfiguredPattern: pattern === declared,
        ...fields,
        ...(songId ? { songId } : {}),
        idResolvable: Boolean((fields as any).source && songId) || Boolean(suffixId),
        confidence: pattern === declared ? 'exact' : 'fallback',
    }
}
