/**
 * 事件驱动的自动同步节流器。
 *
 * 目标：把「配置保存 / 音频落盘 / 歌单快照落盘」等密集事件合并成一次全量同步，
 * 并保证两次由事件触发的同步之间至少间隔 minIntervalMs。
 * 手动按钮与定时同步直接调用 runSyncNow，不经过这里，因此不受节流限制；
 * 它们完成后通过 noteRun() 更新基线，避免紧接着又跑一次事件同步。
 */
export interface SyncThrottleOptions {
  minIntervalMs: number
  now: () => number
  schedule: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  cancel: (handle: ReturnType<typeof setTimeout>) => void
  run: () => Promise<unknown>
  onError?: (error: unknown) => void
}

export interface SyncThrottleState {
  dirty: boolean
  queued: boolean
  lastRunAt: number
  nextRunAt: number
}

export function createSyncThrottle(opts: SyncThrottleOptions) {
  let lastRunAt = 0
  let dirty = false
  let handle: ReturnType<typeof setTimeout> | null = null
  let nextRunAt = 0

  const queue = (wait: number): void => {
    nextRunAt = opts.now() + wait
    handle = opts.schedule(fire, wait)
  }

  const fire = (): void => {
    handle = null
    nextRunAt = 0
    if (!dirty) return
    // 到期时重新确认间隔：期间可能刚跑过定时/手动全量同步。
    const wait = lastRunAt === 0 ? 0 : Math.max(0, opts.minIntervalMs - (opts.now() - lastRunAt))
    if (wait > 0) { queue(wait); return }
    dirty = false
    lastRunAt = opts.now()
    void opts.run().catch(error => opts.onError?.(error))
  }

  return {
    /** 事件到达：置脏标记并排队，重复事件只合并成一次。 */
    request(): void {
      dirty = true
      if (handle !== null) return
      const wait = lastRunAt === 0 ? 0 : Math.max(0, opts.minIntervalMs - (opts.now() - lastRunAt))
      queue(wait)
    },
    /** 任意来源完成一次全量同步后调用，作为新的节流基线。 */
    noteRun(at: number = opts.now()): void {
      if (at > lastRunAt) lastRunAt = at
    },
    /** 调度器停止时清理挂起状态，避免旧实例遗留的定时器触发同步。 */
    cancel(): void {
      if (handle !== null) { opts.cancel(handle); handle = null }
      dirty = false
      nextRunAt = 0
    },
    state(): SyncThrottleState {
      return { dirty, queued: handle !== null, lastRunAt, nextRunAt }
    },
  }
}
