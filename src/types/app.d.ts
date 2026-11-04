/* eslint-disable no-var */
import { type ListEventType, type DislikeEventType } from '@/event'

declare global {
  interface Lx {
    logPath: string
    dataPath: string
    userPath: string
    config: LX.Config
    webdavSync?: any  // WebDAVSync instance
    staticPath: string
    configPath: string
    saveConfig: () => void
    backupConfigNow?: () => { success: boolean, filename?: string, error?: string }
    getConfigBackupDir?: () => string
    backupSnapshotToLocal?: (srcPath: string, user: string, name: string) => void
    nextConfigBackupAt?: number
    lastConfigBackupAt?: number
    rescheduleConfigBackup?: () => void
    lastCpuSample?: { idle: number, total: number }
    lastProcessSample?: { cpu: NodeJS.CpuUsage, time: number }
    subsonicPortConflict?: {
      port: number
      error: string
      time: number
    }
  }

  // var envParams: LX.EnvParams
  var lx: Lx
  var event_list: ListEventType
  var event_dislike: DislikeEventType

}

export { }
