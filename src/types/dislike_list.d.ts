

declare namespace LX {
  namespace Dislike {
    // interface ListItemMusicText {
    //   id?: string
    //   // type: 'music'
    //   name: string | null
    //   singer: string | null
    // }
    // interface ListItemMusic {
    //   id?: number
    //   type: 'musicId'
    //   musicId: string
    //   meta: LX.Music.MusicInfo
    // }
    // type ListItem = ListItemMusicText
    // type ListItem = string
    // type ListItem = ListItemMusic | ListItemMusicText

    interface DislikeMusicInfo {
      name: string
      singer: string
    }

    /**
     * 专辑维度（lxserver 扩展）
     * 规则串中以 !<专辑名>@<歌手> 形式存储，按歌手拆成多条。
     */
    interface DislikeAlbumInfo {
      source?: string
      provenance?: { channel: string, at: number, ratingId?: string }
      reasons?: { channel: string, at: number, ratingId?: string }[]
      albumName: string
      singer: string
    }

    interface DislikeSongInfo {
      provenance?: { channel: string, at: number, ratingId?: string }
      reasons?: { channel: string, at: number, ratingId?: string }[]
      enrichedBy?: { channel: string, at: number }
      id?: string
      name: string
      singer: string
      source?: string
      pic?: string
      interval?: string
      meta?: any
      dislikeRule?: string
    }

    interface DislikeListData {
      dislikeList: DislikeSongInfo[]
    }

    type DislikeRules = DislikeListData

    interface DislikeInfo {
      // musicIds: Set<string>
      names: Set<string>
      musicNames: Set<string>
      singerNames: Set<string>
      // albumKeys: Set<string>
      // list: LX.Dislike.ListItem[]
      rules: string // The raw string representation for matching
    }
  }
}
