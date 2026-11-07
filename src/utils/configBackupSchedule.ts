/** 下一次本地备份：首次按锚点对齐，后续沿上次计划递增，跨天周期不会被每日重新对齐。 */
export function getNextConfigBackupTime(anchor: string, intervalMs: number, now: number, previous?: number): number {
  if (previous !== undefined) return previous + (Math.floor(Math.max(0, now - previous) / intervalMs) + 1) * intervalMs
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(anchor)
  if (!match) return now + intervalMs
  const base = new Date(now)
  base.setHours(Number(match[1]), Number(match[2]), 0, 0)
  const start = base.getTime()
  return start > now ? start : start + (Math.floor((now - start) / intervalMs) + 1) * intervalMs
}

/** Node 定时器最大约 24.8 天；较长周期需要分段等待。 */
export const configBackupTimerDelay = (next: number, now: number) => Math.max(1, Math.min(next - now, 2_147_483_647))
