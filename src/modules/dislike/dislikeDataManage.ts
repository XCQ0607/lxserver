import { registerDislikeMigration } from '../../server/rating/ratingMigration'
import fs from 'node:fs'
import path from 'node:path'
import { SPLIT_CHAR } from '@/constants'
import { type SnapshotDataManage } from './snapshotDataManage'
import { encodeAlbumRule, canonicalDislikeRule, scopedDislikeRule } from './utils'

export class DislikeDataManage {
  snapshotDataManage: SnapshotDataManage
  dislikeRules: LX.Dislike.DislikeListData = { dislikeList: [] }

  constructor(snapshotDataManage: SnapshotDataManage) {
    this.snapshotDataManage = snapshotDataManage
    if (snapshotDataManage.dislikeDir) registerDislikeMigration(path.dirname(snapshotDataManage.dislikeDir), this)

    try {
      const latest = this.snapshotDataManage.snapshotInfo?.latest
      if (latest) {
        const filePath = path.join(this.snapshotDataManage.snapshotDir, `snapshot_${latest}`)
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8').trim()
          if (content.startsWith('{')) {
            const parsed = JSON.parse(content)
            this.dislikeRules = parsed
            // normalize: populate missing dislikeRule fields from name/singer
            this.normalizeRules()
          }
        }
      }
    } catch { /* ignore */ }

    void this.snapshotDataManage.getSnapshotInfo().then(async(snapshotInfo) => {
      if (!snapshotInfo.latest) return
      const data = await this.snapshotDataManage.getSnapshot(snapshotInfo.latest)
      if (data) {
        this.dislikeRules = data
        this.normalizeRules()
      }
    })
  }

  /**
   * Build the canonical rule string for a DislikeSongInfo entry.
   * Snapshot entries loaded from disk may not have dislikeRule populated
   * (they only have name/singer from the original music object).
   * Format: "name@singer" | "@singer" | "name"
   */
  private buildDislikeRule(item: LX.Dislike.DislikeSongInfo): string {
    if (item.dislikeRule) return item.dislikeRule
    const name = (item.name ?? '').trim()
    const singer = (item.singer ?? '').trim()
    if (name && singer) return `${name}${SPLIT_CHAR.DISLIKE_NAME}${singer}`
    if (singer) return `${SPLIT_CHAR.DISLIKE_NAME}${singer}`
    return name
  }

  /**
   * Ensure every entry in dislikeList has dislikeRule populated.
   * Called after loading from snapshot so getDislikeRulesString works correctly.
   */
  private normalizeRules() {
    for (const item of this.dislikeRules.dislikeList) {
      if (!item.dislikeRule) {
        item.dislikeRule = this.buildDislikeRule(item)
      }
    }
  }

  // Returns the structured object
  getDislikeRules = async(): Promise<LX.Dislike.DislikeRules> => {
    return this.dislikeRules
  }

  // Returns all active rule strings separated by newline (used by dislikeCache for parsing)
  getDislikeRulesString = (): string => {
    return this.dislikeRules.dislikeList
      .map(s => scopedDislikeRule(this.buildDislikeRule(s), (s as any).source))
      .filter(Boolean)
      .join('\n')
  }

  // 从指定快照内容恢复当前 dislike 数据（管理接口回滚用）
  restore = async(data: LX.Dislike.DislikeRules) => {
    this.dislikeRules = (data && Array.isArray(data.dislikeList)) ? { dislikeList: data.dislikeList } : { dislikeList: [] }
    this.normalizeRules()
  }

  addDislikeInfo = async(infos: LX.Dislike.DislikeSongInfo[]) => {
    const key = (item: any) => scopedDislikeRule(this.buildDislikeRule(item), item.source)
    const current = new Map(this.dislikeRules.dislikeList.map(item => [key(item), item]))
    for (const raw of infos) {
      const info: any = { ...raw, dislikeRule: canonicalDislikeRule(this.buildDislikeRule(raw)) }
      if (!info.dislikeRule) continue
      info.provenance = info.provenance || { channel: 'unknown', at: Date.now() }
      info.reasons = info.reasons || [info.provenance]
      const existing: any = current.get(key(info))
      if (existing) {
        // 只有身份不冲突时补字段；同名不同ID不能互相污染。
        const identity = (x: any) => String(x.songmid || x.id || '').replace(new RegExp('^' + (x.source || '') + '_'), '')
        const reasons = existing.reasons || [existing.provenance || { channel: 'unknown', at: Date.now() }]
        for (const reason of info.reasons) if (!reasons.some((x: any) => x.channel === reason.channel && x.ratingId === reason.ratingId)) reasons.push(reason)
        existing.reasons = reasons
        if (identity(existing) && identity(info) && identity(existing) !== identity(info)) continue
        const fill = (target: any, incoming: any) => {
          for (const [field, value] of Object.entries(incoming)) {
            if (['dislikeRule', 'provenance', 'reasons', '__proto__', 'constructor', 'prototype'].includes(field) || value == null || value === '') continue
            const old = target[field]
            if (old == null || old === '' || (Array.isArray(old) && !old.length)) target[field] = value
            else if (typeof old === 'object' && !Array.isArray(old) && typeof value === 'object' && !Array.isArray(value)) fill(old, value)
          }
        }
        const before = JSON.stringify(existing)
        fill(existing, info)
        if (JSON.stringify(existing) !== before) existing.enrichedBy = info.provenance
      } else {
        this.dislikeRules.dislikeList.push(info)
        current.set(key(info), info)
      }
    }
    return this.dislikeRules
  }

  /** 同步读取当前规则并裁剪原因，避免预览期间新增的手动原因被旧副本覆盖。 */
  reconcileRatingReasons = (validIds: Set<string>, preview = true) => {
    const removed: any[] = []
    const next: LX.Dislike.DislikeSongInfo[] = []
    for (const item of this.dislikeRules.dislikeList) {
      const reasons = item.reasons || [item.provenance || { channel: 'unknown', at: 0 }]
      const remaining = reasons.filter(reason => {
        const keep = !reason.ratingId || validIds.has(reason.ratingId)
        if (!keep) removed.push({ rule: item.dislikeRule, source: item.source, ratingId: reason.ratingId })
        return keep
      })
      if (remaining.length) next.push({ ...item, reasons: remaining, provenance: remaining[0] })
    }
    const result = { removedReasons: removed.length, removedRules: this.dislikeRules.dislikeList.length - next.length, removals: removed }
    if (!preview) this.dislikeRules = { dislikeList: next }
    return result
  }

  removeDislikeInfo = async(rule: string, source?: string) => {
    const wanted = scopedDislikeRule(rule, source)
    this.dislikeRules.dislikeList = this.dislikeRules.dislikeList.filter(item => scopedDislikeRule(this.buildDislikeRule(item), (item as any).source) !== wanted)
  }

  addDislikeAlbums = async(infos: LX.Dislike.DislikeAlbumInfo[]) => {
    if (!infos || infos.length === 0) return this.dislikeRules
    await this.addDislikeInfo(infos.map(info => ({ name: '', singer: '',
      dislikeRule: encodeAlbumRule(info.albumName, info.singer), source: info.source,
      provenance: info.provenance, reasons: info.reasons })))
    return this.dislikeRules
  }

  overwirteDislikeInfo = async(rulesString: string) => {
    const validRules = new Set(rulesString.split('\n').map(r => r.trim()).filter(Boolean))
    const existingMap = new Map<string, LX.Dislike.DislikeSongInfo>()
    for (const item of this.dislikeRules.dislikeList) {
      const r = scopedDislikeRule(this.buildDislikeRule(item), (item as any).source)
      if (r && validRules.has(r)) {
        existingMap.set(r, item)
      }
    }
    const newDislikeList: LX.Dislike.DislikeSongInfo[] = []
    for (const r of validRules) {
      if (existingMap.has(r)) {
        newDislikeList.push(existingMap.get(r)!)
      } else {
        newDislikeList.push({
          name: '',
          singer: '',
          dislikeRule: r.includes('::') ? r.split('::').slice(1).join('::') : r,
          source: r.split('::')[0] === '*' ? undefined : r.split('::')[0],
        })
      }
    }
    this.dislikeRules.dislikeList = newDislikeList
    return this.dislikeRules
  }
}
