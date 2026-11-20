/**
 * 缓存文件命名模式（纯常量/纯函数，无副作用、无 global.lx 依赖）。
 *
 * 单独成模块的原因：云端文件名反解析、灾备重建等只读工具需要按「用户配置」
 * 解析文件名，但不应因此拉起 fileCache 的整张依赖图。
 * fileCache.ts 会原样重新导出本模块内容，既有 import 路径保持不变。
 */

export const CACHE_NAMING_PATTERNS = {
    STANDARD: 'standard',       // {Name}_-_{Singer}_-_{Source}_-_{ID}_-_{Quality}
    SIMPLE: 'simple',            // {Name} - {Singer} - {Quality} - {Album}
    SINGER_NAME_QUALITY_ALBUM: 'singer_name_quality_album', // {Singer} - {Name} - {Quality} - {Album}
    SINGER_NAME: 'singer_name', // {Singer} - {Name}
    NAME_SINGER: 'name_singer',  // {Name} - {Singer}
}

export const normalizeNamingPattern = (pattern: unknown) => {
    if (Object.values(CACHE_NAMING_PATTERNS).includes(pattern as string)) {
        return pattern as string
    }
    return CACHE_NAMING_PATTERNS.SIMPLE
}
