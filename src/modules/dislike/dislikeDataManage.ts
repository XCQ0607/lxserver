import fs from 'node:fs'
import path from 'node:path'
import { SPLIT_CHAR } from '@/constants'
import { type SnapshotDataManage } from './snapshotDataManage'
import { filterRules, encodeAlbumRule } from './utils'

export class DislikeDataManage {
  snapshotDataManage: SnapshotDataManage
  dislikeRules: LX.Dislike.DislikeListData = { dislikeList: [] }

  constructor(snapshotDataManage: SnapshotDataManage) {
    this.snapshotDataManage = snapshotDataManage

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
      .map(s => this.buildDislikeRule(s))
      .filter(Boolean)
      .join('\n')
  }

  // 从指定快照内容恢复当前 dislike 数据（管理接口回滚用）
  restore = async(data: LX.Dislike.DislikeRules) => {
    this.dislikeRules = (data && Array.isArray(data.dislikeList)) ? { dislikeList: data.dislikeList } : { dislikeList: [] }
    this.normalizeRules()
  }

  addDislikeInfo = async(infos: LX.Dislike.DislikeSongInfo[]) => {
    // Check for duplicates
    const currentRules = new Set(this.dislikeRules.dislikeList.map(s => this.buildDislikeRule(s)))
    for (const info of infos) {
      const rule = this.buildDislikeRule(info)
      if (!rule) continue
      if (!currentRules.has(rule)) {
        info.dislikeRule = rule
        this.dislikeRules.dislikeList.push(info)
        currentRules.add(rule)
      }
    }
    return this.dislikeRules
  }

  addDislikeAlbums = async(infos: LX.Dislike.DislikeAlbumInfo[]) => {
    if (!infos || infos.length === 0) return this.dislikeRules
    const currentRules = new Set(this.dislikeRules.dislikeList.map(s => this.buildDislikeRule(s)))
    const lines = infos.map(info => encodeAlbumRule(info.albumName, info.singer))
    
    for (let i = 0; i < lines.length; i++) {
      const rule = lines[i]
      if (!currentRules.has(rule)) {
        this.dislikeRules.dislikeList.push({
          name: '',
          singer: '',
          dislikeRule: rule
        })
        currentRules.add(rule)
      }
    }
    return this.dislikeRules
  }

  overwirteDislikeInfo = async(rulesString: string) => {
    const validRules = new Set(filterRules(rulesString))
    const existingMap = new Map<string, LX.Dislike.DislikeSongInfo>()
    for (const item of this.dislikeRules.dislikeList) {
      const r = this.buildDislikeRule(item)
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
          dislikeRule: r,
        })
      }
    }
    this.dislikeRules.dislikeList = newDislikeList
    return this.dislikeRules
  }
}
