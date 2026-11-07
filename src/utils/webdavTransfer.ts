import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { hashBackupFile } from './backupFiles'

export const missingWebdavFile = (error: any) => Number(error?.status || error?.response?.status) === 404
export async function downloadWebdavFile(client: any, remote: string, target: string, size: number, signal?: AbortSignal, etag?: string) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('云端文件大小无效：' + remote)
  const timeout = AbortSignal.timeout(300_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let received = 0
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const stream = client.createReadStream(remote, { signal: combined, headers: etag ? { 'If-Match': etag } : {} })
  try {
    await pipeline(stream, new Transform({ transform(chunk, _encoding, next) {
      received += chunk.length
      if (received > size) next(new Error('云端文件超过声明大小：' + remote))
      else next(null, chunk)
    } }), fs.createWriteStream(target, { mode: 0o600 }), { signal: combined })
    if (received !== size) throw new Error('云端文件下载不完整：' + remote)
  } catch (error) { fs.rmSync(target, { force: true }); throw error }
  finally { stream.destroy() }
}

/** PUT a temporary sibling then MOVE, so a failed upload cannot replace a valid backup. */
export async function uploadWebdavFile(client: any, local: string, remote: string, size: number, onBytes?: (n: number) => void, expectedHash = hashBackupFile(local)) {
  const temporary = remote + '.' + crypto.randomUUID() + '.part'
  const signal = AbortSignal.timeout(300_000)
  const input = fs.createReadStream(local)
  const hash = crypto.createHash('sha256'); let uploaded = 0
  const stream = new Transform({ transform(chunk, _encoding, next) { hash.update(chunk); uploaded += chunk.length; onBytes?.(uploaded); next(null, chunk) } })
  input.on('error', error => stream.destroy(error))
  input.pipe(stream)
  try {
    if (await client.putFileContents(temporary, stream, { overwrite: true, signal }) === false) throw new Error('WebDAV 上传被拒绝')
    if (uploaded !== size || hash.digest('hex') !== expectedHash) throw new Error('上传期间文件变化，未替换云端原副本')
    const info = await client.stat(temporary, { signal })
    if (Number(info.size) !== size) throw new Error('WebDAV 上传后大小不一致')
    await client.moveFile(temporary, remote, { overwrite: true, signal })
  } finally {
    stream.destroy()
    input.destroy()
    try { await client.deleteFile(temporary, { signal: AbortSignal.timeout(10_000) }) } catch { /* MOVE already removed it, or cleanup will be retried later. */ }
  }
}
