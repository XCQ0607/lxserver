import { SPLIT_CHAR } from '@/constants'
import { type SnapshotDataManage } from './snapshotDataManage'
import { filterRules, encodeAlbumRule } from './utils'

const filterRulesToString = (rules: string) => {
  return Array.from(filterRules(rules)).join('\n')
}

export class DislikeDataManage {
  snapshotDataManage: SnapshotDataManage
  dislikeRules = ''

  constructor(snapshotDataManage: SnapshotDataManage) {
    this.snapshotDataManage = snapshotDataManage

    let dislikeRules: LX.Dislike.DislikeRules | null
    void this.snapshotDataManage.getSnapshotInfo().then(async(snapshotInfo) => {
      if (snapshotInfo.latest) dislikeRules = await this.snapshotDataManage.getSnapshot(snapshotInfo.latest)
      if (!dislikeRules) dislikeRules = ''
      this.dislikeRules = dislikeRules
    })
  }

  getDislikeRules = async(): Promise<LX.Dislike.DislikeRules> => {
    return this.dislikeRules
  }

  addDislikeInfo = async(infos: LX.Dislike.DislikeMusicInfo[]) => {
    this.dislikeRules = filterRulesToString(this.dislikeRules + '\n' + infos.map(info => `${info.name ?? ''}${SPLIT_CHAR.DISLIKE_NAME}${info.singer ?? ''}`).join('\n'))
    return this.dislikeRules
  }

  /** 追加专辑维度规则（!<专辑名>@<歌手>，调用方已按歌手拆成多条） */
  addDislikeAlbums = async(infos: LX.Dislike.DislikeAlbumInfo[]) => {
    if (!infos || infos.length === 0) return this.dislikeRules
    const lines = infos.map(info => encodeAlbumRule(info.albumName, info.singer))
    this.dislikeRules = filterRulesToString(this.dislikeRules + '\n' + lines.join('\n'))
    return this.dislikeRules
  }

  overwirteDislikeInfo = async(rules: string) => {
    this.dislikeRules = filterRulesToString(rules)
    return this.dislikeRules
  }
}

