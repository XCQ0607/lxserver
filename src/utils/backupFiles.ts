import fs from 'node:fs'
import crypto from 'node:crypto'

/** Fixed memory use even for multi-gigabyte audio files. */
export function hashBackupFile(file: string): string {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let count: number
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { fs.closeSync(fd) }
}

export function backupFileVersion(file: string): string {
  if (!fs.existsSync(file)) return 'missing'
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('恢复目标不是普通文件：' + file)
  return `${stat.size}:${stat.mtimeMs}:${hashBackupFile(file)}`
}
