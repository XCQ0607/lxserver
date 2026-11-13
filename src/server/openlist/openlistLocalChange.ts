/**
 * 本地文件内容变更判定（单次同步任务内复用 SHA-256 结果）。
 *
 * 同步引擎在一轮里会多次询问同一文件（软删判断、completed 短路、verified 比对），
 * 每次都全文件 SHA-256 会随记录数线性放大本地 IO。这里按「轮」缓存判定结果：
 *  - 缓存只在 beginRound/endRound 之间有效，跨轮一律重新计算；
 *  - 因此「同大小 + 恢复 mtime 的内容改写」仍会在下一轮被检测到；
 *  - stat 在 hash 前后发生变化时按变更处理，不做缓存，避免竞态误判。
 */
export interface LocalChangeRow {
  id?: number
  local_path: string
  local_hash: string | null
  size: number | null
  local_mtime: number | null
  status?: string
}

export interface LocalChangeDeps {
  exists: (p: string) => boolean
  stat: (p: string) => { size: number; mtimeMs: number }
  hash: (p: string) => string
  onBaseline?: (row: LocalChangeRow, size: number, mtimeMs: number) => void
}

interface MemoEntry {
  size: number
  mtimeMs: number
  localHash: string
  changed: boolean
}

export function createLocalChangedChecker(deps: LocalChangeDeps) {
  let memo: Map<string, MemoEntry> | null = null
  return {
    beginRound(): void { memo = new Map() },
    endRound(): void { memo = null },
    /** 当前是否处于某一轮同步任务内（供测试与状态查看）。 */
    inRound(): boolean { return memo !== null },
    /** useMemo=false 用于文件刚落盘的钩子，避免读到本轮早期对同一路径的旧判定。 */
    changed(row: LocalChangeRow, useMemo = true): boolean {
      if (!deps.exists(row.local_path)) return false
      const st = deps.stat(row.local_path)
      if (!row.local_hash) return row.size !== st.size || row.local_mtime == null || st.mtimeMs !== row.local_mtime
      const hit = useMemo ? memo?.get(row.local_path) : undefined
      if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && hit.localHash === row.local_hash) return hit.changed
      const changed = deps.hash(row.local_path) !== row.local_hash
      const after = deps.stat(row.local_path)
      if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) return true
      // 后台已确认内容相同，更新观察基线，避免仅 touch 后永久显示待上传。
      if (!changed && row.id && (row.size !== st.size || row.local_mtime !== st.mtimeMs)) {
        deps.onBaseline?.(row, st.size, st.mtimeMs)
      }
      if (useMemo) memo?.set(row.local_path, { size: st.size, mtimeMs: st.mtimeMs, localHash: row.local_hash, changed })
      return changed
    },
  }
}
