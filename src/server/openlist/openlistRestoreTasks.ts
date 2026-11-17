import { createRestoreTaskManager } from '../backup/restoreTasks'
export type { RestoreFile, RestoreTask } from '../backup/restoreTasks'
export const { hasInterruptedRestore, readRestoreTask, listRestoreTasks, cancelRestoreTask, createPendingRestoreTask, failRestoreTask, rollbackRestoreTask, deleteRestoreTask, executeRestoreTransaction } = createRestoreTaskManager('openlist-restore-tasks')
