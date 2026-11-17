import fs from 'node:fs'
import path from 'node:path'
import type { RestoreFile } from './restoreTasks'

/** Missing-only restores keep business data but must merge metadata describing newly added files. */
export function markRestoreDependencies(files: RestoreFile[]) {
  const added = files.filter(f => f.action === 'add')
  for (const file of files) {
    if (file.action !== 'skip') continue
    if (file.relative.endsWith('/music_index.json') && added.some(f => path.posix.dirname(f.relative) === path.posix.dirname(file.relative))) file.action = 'merge'
    if (file.relative.endsWith('/snapshotInfo.json')) {
      const parent = path.posix.dirname(file.relative)
      const base = parent.endsWith('/snapshot') ? parent + '/' : parent + '/snapshot/'
      if (added.some(f => f.relative.startsWith(base) && path.posix.basename(f.relative).startsWith('snapshot_'))) file.action = 'merge'
    }
  }
}

export function mergeRestoreDependency(file: RestoreFile, staged: string, files: RestoreFile[]) {
  const local = JSON.parse(fs.readFileSync(file.local, 'utf8'))
  const cloud = JSON.parse(fs.readFileSync(staged, 'utf8'))
  if (!local || !cloud || Array.isArray(local) || Array.isArray(cloud)) throw new Error('索引格式无效，已取消恢复：' + file.relative)
  if (file.relative.endsWith('/music_index.json')) {
    const base = path.dirname(file.local)
    for (const [id, value] of Object.entries(cloud)) {
      const item = value as any
      if (Object.hasOwn(local, id) || !item || typeof item.filename !== 'string') continue
      const target = path.resolve(base, item.filename)
      if (!target.startsWith(base + path.sep)) throw new Error('音乐索引文件名越界')
      if (fs.existsSync(target) || files.some(f => f.action === 'add' && path.resolve(f.local) === target)) local[id] = item
    }
  } else {
    if (!Array.isArray(local.list) || !Array.isArray(cloud.list)) throw new Error('快照索引格式无效')
    const folder = path.dirname(file.local).endsWith(path.sep + 'snapshot') ? path.dirname(file.local) : path.join(path.dirname(file.local), 'snapshot')
    const added = files.filter(f => f.action === 'add' && path.dirname(f.local) === folder).map(f => path.basename(f.local).replace(/^snapshot_/, ''))
    // Keep local latest/clients/time; cloud latest becomes an available historical snapshot.
    local.list = [...new Set([...local.list, ...cloud.list, cloud.latest, ...added])].filter(id => typeof id === 'string' && id !== local.latest && (fs.existsSync(path.join(folder, 'snapshot_' + id)) || added.includes(id)))
  }
  fs.writeFileSync(staged, JSON.stringify(local, null, 2))
}
