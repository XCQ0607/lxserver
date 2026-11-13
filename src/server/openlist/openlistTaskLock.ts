/**
 * OpenList 云端任务的互斥闸门。
 *
 * 同步（runSyncNow）、后台校验（verifyPending）与「存量文件批量改名」
 * （applyCacheRename）都会同时改动本地文件、备份库记录与云端路径。
 * 改名的步骤是「云端 rename → 本地 rename → 更新备份库/索引」，
 * 中间必然出现「本地已改名、备份库仍是旧名」的窗口。若同步在这个窗口里跑：
 *  - 会把新名字当成新文件插入一条重复记录并再传一份；
 *  - 旧记录因本地文件消失且云端旧路径也不存在，可能被删除检测误判。
 * 因此这些任务必须串行执行，不能并发。
 */
let tail: Promise<void> = Promise.resolve()
let depth = 0

/** 是否已有互斥任务在真正执行（排队中的不算）。 */
export function isTaskRunning(): boolean { return depth > 0 }

/** 排队执行一个会改动云端/本地/备份库的任务；异常不会阻塞后续任务。 */
export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const start = tail
  let release!: () => void
  tail = new Promise<void>(resolve => { release = resolve })
  const run = async (): Promise<T> => {
    depth++
    try { return await task() } finally { depth--; release() }
  }
  return start.then(run)
}
