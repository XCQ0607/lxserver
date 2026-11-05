import fs from 'node:fs'
import path from 'node:path'
import { syncLog } from '@/utils/log4js'
import { ScheduledTask, TaskExecutionResult } from './types'
import { createNetworkListTask } from './networkListTask'
import { createSyncDownloadTask, syncDownloadForAllUsers } from './syncDownloadTask'

export * from './types'
export { parseIntervalMs, checkAllUsersNetworkLists } from './networkListTask'
export { createSyncDownloadTask, syncDownloadForAllUsers }

// 调度器内部状态
const registeredTasks = new Map<string, ScheduledTask>()
const taskTimers = new Map<string, NodeJS.Timeout>()
let isSchedulerRunning = false

const getRuntimeDir = () => {
  const dir = path.join(global.lx?.dataPath || process.cwd(), 'runtime')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

const getTaskRecordsFilePath = () => path.join(getRuntimeDir(), 'network-list-autoupdate-records.json')

const loadTaskRecords = () => {
  try {
    const p = getTaskRecordsFilePath()
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    }
  } catch {}
  return {}
}

const saveTaskRecords = () => {
  try {
    const p = getTaskRecordsFilePath()
    const records: Record<string, { lastRunTime?: number; nextRunTime?: number; lastResult?: TaskExecutionResult }> = {}
    for (const [id, task] of registeredTasks.entries()) {
      records[id] = {
        lastRunTime: task.lastRunTime,
        nextRunTime: task.nextRunTime,
        lastResult: task.lastResult
      }
    }
    fs.writeFileSync(p, JSON.stringify(records, null, 2), 'utf8')
  } catch (err: any) {
    syncLog.warn('[任务调度] 保存任务执行记录失败:', err.message)
  }
}

/**
 * 安排下次执行
 */
const scheduleNextRun = (task: ScheduledTask) => {
  if (taskTimers.has(task.id)) {
    clearTimeout(taskTimers.get(task.id)!)
    taskTimers.delete(task.id)
  }

  if (!task.enabled || task.intervalMs <= 0) {
    task.nextRunTime = undefined
    saveTaskRecords()
    return
  }

  task.nextRunTime = Date.now() + task.intervalMs
  saveTaskRecords()

  const timer = setTimeout(async () => {
    await executeTask(task.id)
    if (task.enabled && isSchedulerRunning) {
      scheduleNextRun(task)
    }
  }, task.intervalMs)

  taskTimers.set(task.id, timer)
}

/**
 * 注册后台任务
 */
export const registerTask = (task: ScheduledTask) => {
  const records = loadTaskRecords()
  if (records[task.id]) {
    task.lastRunTime = records[task.id].lastRunTime
    task.lastResult = records[task.id].lastResult
  }
  registeredTasks.set(task.id, task)
  if (isSchedulerRunning && task.enabled && task.intervalMs > 0) {
    scheduleNextRun(task)
  }
}

/**
 * 手动或定时执行任务
 */
export const executeTask = async (taskId: string): Promise<TaskExecutionResult> => {
  const task = registeredTasks.get(taskId)
  if (!task) {
    return {
      taskId,
      timestamp: Date.now(),
      success: false,
      message: `任务 ${taskId} 未注册`
    }
  }

  if (task.isRunning) {
    return {
      taskId,
      timestamp: Date.now(),
      success: false,
      message: `任务 ${task.name} 正在运行中，跳过本次执行`
    }
  }

  task.isRunning = true
  task.lastRunTime = Date.now()
  syncLog.info(`[任务调度] 开始执行后台任务: ${task.name} (${task.id})`)

  try {
    const result = await task.run()
    task.lastResult = result
    syncLog.info(`[任务调度] 任务执行完毕: ${task.name}, 结果: ${result.message}`)
    return result
  } catch (err: any) {
    const errorResult: TaskExecutionResult = {
      taskId,
      timestamp: Date.now(),
      success: false,
      message: `执行失败: ${err.message}`
    }
    task.lastResult = errorResult
    syncLog.error(`[任务调度] 任务 ${task.name} 执行异常:`, err)
    return errorResult
  } finally {
    task.isRunning = false
    task.nextRunTime = task.enabled && task.intervalMs > 0 ? Date.now() + task.intervalMs : undefined
    saveTaskRecords()
  }
}

/**
 * 更新任务的定时配置
 */
export const updateTaskConfig = (taskId: string, config: { intervalMs?: number; enabled?: boolean }) => {
  const task = registeredTasks.get(taskId)
  if (!task) return false

  if (typeof config.enabled === 'boolean') {
    task.enabled = config.enabled
  }
  if (typeof config.intervalMs === 'number' && config.intervalMs >= 0) {
    task.intervalMs = config.intervalMs
  }

  if (taskTimers.has(task.id)) {
    clearTimeout(taskTimers.get(task.id)!)
    taskTimers.delete(task.id)
  }

  if (isSchedulerRunning && task.enabled && task.intervalMs > 0) {
    scheduleNextRun(task)
  } else {
    task.nextRunTime = undefined
    saveTaskRecords()
  }
  return true
}

/**
 * 获取所有任务的状态快照
 */
export const getSchedulerStatus = () => {
  return Array.from(registeredTasks.values()).map(task => ({
    id: task.id,
    name: task.name,
    intervalMs: task.intervalMs,
    enabled: task.enabled,
    isRunning: task.isRunning,
    lastRunTime: task.lastRunTime,
    nextRunTime: task.nextRunTime,
    lastResult: task.lastResult,
  }))
}

/**
 * 启动后台任务调度中心
 */
export const startScheduler = () => {
  if (isSchedulerRunning) return
  isSchedulerRunning = true

  // 注册默认网络歌单任务（从 task/networkListTask.ts 加载）
  const networkListTask = createNetworkListTask()
  registerTask(networkListTask)

  // 注册歌曲同步下载任务（从 task/syncDownloadTask.ts 加载）
  const syncDownloadTask = createSyncDownloadTask()
  registerTask(syncDownloadTask)

  syncLog.info('[任务调度] 后台任务调度器已启动')

  // 针对已启用的任务：
  // 1. 安排下一次定期执行时间
  // 2. 如果任务开启，服务端启动后延时 3 秒立即执行一次初始检查
  for (const task of registeredTasks.values()) {
    if (task.enabled && task.intervalMs > 0) {
      scheduleNextRun(task)

      // 服务端刚开机/刚启动时立即执行一次（延迟3秒等待网络/musicSdk初始化）
      setTimeout(() => {
        if (isSchedulerRunning && task.enabled) {
          syncLog.info(`[任务调度] 服务端启动，触发任务首次执行: ${task.name}`)
          void executeTask(task.id)
        }
      }, 3000)
    }
  }
}

/**
 * 停止后台任务调度中心
 */
export const stopScheduler = () => {
  isSchedulerRunning = false
  for (const [id, timer] of taskTimers.entries()) {
    clearTimeout(timer)
  }
  taskTimers.clear()
  syncLog.info('[任务调度] 后台任务调度器已停止')
}
