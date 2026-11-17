import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { backupType } from './backupPolicy'

export interface WebdavFileVersion { size: number; hash: string }
export interface WebdavState { manifest?: string; files: Array<[string, string]>; zip: Array<[string, string]>; remote: Record<string, WebdavFileVersion> }
export const webdavManifestName = '.lx-backup-manifest.json'
export function parseWebdavManifest(value: any): Record<string, WebdavFileVersion> {
  if (value?.schema !== 1 || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('WebDAV 备份清单格式无效')
  for (const [relative, entry] of Object.entries(value.files)) {
    const file = entry as WebdavFileVersion
    if (!backupType(relative) || !Number.isSafeInteger(file?.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file?.hash)) throw new Error('WebDAV 备份清单条目无效')
  }
  return value.files
}
export function webdavStatePath(dataPath: string, identity: string) {
  return path.join(dataPath, 'runtime', 'webdav-baselines', crypto.createHash('sha256').update(identity).digest('hex') + '.json')
}
export function readWebdavState(file: string): WebdavState {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    parseWebdavManifest({ schema: 1, files: state.remote })
    for (const entries of [state.files, state.zip]) {
      if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || entry.length !== 2 || !backupType(entry[0]) || typeof entry[1] !== 'string' || !/^[a-f0-9]{64}$/.test(entry[1]))) throw new Error('基线格式无效')
    }
    return state
  } catch (error: any) {
    if (error.code !== 'ENOENT') console.warn('[WebDAV] 本地增量基线不可用，将重新备份')
    return { files: [], zip: [], remote: {} }
  }
}
export function saveWebdavState(file: string, state: WebdavState) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(state), { mode: 0o600 }); fs.renameSync(file + '.tmp', file)
}
