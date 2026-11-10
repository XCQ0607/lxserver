import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const live = new Map<string, WeakRef<any>>()
export function registerDislikeMigration(dir: string, manager: any) { live.set(path.resolve(dir), new WeakRef(manager)); recoverRatingTransaction(dir) }
const replace = (file: string, value: string | null) => {
  if (value === null) { if (fs.existsSync(file)) fs.unlinkSync(file); return }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.transaction.tmp', value, { encoding: 'utf8', flush: true })
  fs.renameSync(file + '.transaction.tmp', file)
}
/** A durable redo journal finishes interrupted commits before another rating read. */
export function recoverRatingTransaction(dir: string) {
  const journal = path.join(dir, 'rating', 'transaction.json')
  if (!fs.existsSync(journal)) return
  const entries = JSON.parse(fs.readFileSync(journal, 'utf8'))
  if (!Array.isArray(entries)) throw new Error('Invalid rating transaction')
  for (const entry of entries) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.after !== 'string') throw new Error('Invalid rating transaction')
    const target = path.resolve(dir, entry.file)
    const relative = path.relative(dir, target).replaceAll('\\', '/')
    if (!target.startsWith(path.resolve(dir) + path.sep) || !/^(subsonic-meta\.json|rating\/songs\.json|dislike\/snapshotInfo\.json|dislike\/snapshot\/snapshot_[a-f0-9]{32})$/.test(relative)) throw new Error('Invalid rating transaction path')
  }
  for (const entry of entries) replace(path.resolve(dir, entry.file), entry.after)
  fs.unlinkSync(journal)
  if (entries.some(entry => entry.file.replaceAll('\\', '/') === 'dislike/snapshotInfo.json')) refreshLive(dir)
}
function refreshLive(dir: string) {
  const manager = live.get(path.resolve(dir))?.deref()
  if (!manager) return
  const info = path.join(dir, 'dislike', 'snapshotInfo.json')
  if (!fs.existsSync(info)) return
  manager.snapshotDataManage.snapshotInfo = JSON.parse(fs.readFileSync(info, 'utf8'))
  const latest = manager.snapshotDataManage.snapshotInfo.latest
  if (latest) manager.dislikeRules = JSON.parse(fs.readFileSync(path.join(dir, 'dislike', 'snapshot', 'snapshot_' + latest), 'utf8'))
}
export function commitRatingFiles(dir: string, changes: Map<string, string>) {
  recoverRatingTransaction(dir)
  const entries = [...changes].map(([file, after]) => ({ file: path.relative(dir, file), after, before: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null }))
  if (!entries.length) return
  const journal = path.join(dir, 'rating', 'transaction.json')
  replace(journal, JSON.stringify(entries))
  try {
    for (const entry of entries) replace(path.join(dir, entry.file), entry.after)
  } catch (error) {
    // Keep the journal if rollback itself fails; the next read completes the commit.
    for (const entry of entries) replace(path.join(dir, entry.file), entry.before)
    fs.unlinkSync(journal)
    throw error
  }
  fs.unlinkSync(journal)
  if (entries.some(entry => entry.file.replaceAll('\\', '/') === 'dislike/snapshotInfo.json')) refreshLive(dir)
}
/** Pure identity normalization, shared by reads, linking and snapshot restore. */
export function planRatingMigration(dir: string, data: any, catalog: any, tracks?: any[]) {
  data.ratings ||= {}
  const registry = path.join(dir, 'subsonic-local-registry.json')
  const linked: any[] = tracks || (fs.existsSync(registry) ? Object.values(JSON.parse(fs.readFileSync(registry, 'utf8')).tracks || {}) : [])
  const aliases = new Map<string, string>()
  for (const t of linked) if (t.id?.startsWith('local_') && /^(wy|tx|kw|kg|mg|bd)_/.test(t.platformId || '')) aliases.set(t.id, t.platformId)
  for (const [old, target] of aliases) {
    if (!data.ratings[target] && data.ratings[old]) {
      data.ratings[target] = data.ratings[old]
      if (data.ratingOrigins?.[old]) { data.ratingOrigins ||= {}; data.ratingOrigins[target] = data.ratingOrigins[old] }
      if (data.ratingHistory?.[old]) { data.ratingHistory ||= {}; data.ratingHistory[target] = data.ratingHistory[old] }
      catalog[target] = { ...(catalog[old] || {}), ...(catalog[target] || {}), id: target, source: target.split('_')[0] }
    }
    delete data.ratings[old]
    if (data.ratingOrigins) delete data.ratingOrigins[old]
    if (data.ratingHistory) delete data.ratingHistory[old]
    delete catalog[old]
  }
  const changes = new Map<string, string>()
  const manager = live.get(path.resolve(dir))?.deref()
  const infoFile = path.join(dir, 'dislike', 'snapshotInfo.json')
  const info = manager?.snapshotDataManage.snapshotInfo || (fs.existsSync(infoFile) ? JSON.parse(fs.readFileSync(infoFile, 'utf8')) : null)
  if (info?.latest) {
    const source = manager?.dislikeRules || JSON.parse(fs.readFileSync(path.join(dir, 'dislike', 'snapshot', 'snapshot_' + info.latest), 'utf8'))
    const rules = JSON.parse(JSON.stringify(source))
    let changed = false
    for (const item of rules.dislikeList || []) for (const reason of [item.provenance, item.enrichedBy, ...(item.reasons || [])]) {
      if (reason && aliases.has(reason.ratingId)) { reason.ratingId = aliases.get(reason.ratingId); changed = true }
    }
    if (changed) {
      const content = JSON.stringify(rules), id = createHash('md5').update(content).digest('hex')
      changes.set(path.join(dir, 'dislike', 'snapshot', 'snapshot_' + id), content)
      changes.set(infoFile, JSON.stringify({ ...info, latest: id, time: Date.now(), list: [...new Set([info.latest, ...(info.list || [])])].filter(x => x !== id && !(info.imported || []).includes(x)) }))
    }
  }
  return changes
}
