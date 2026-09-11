declare namespace LX {
  type AddMusicLocationType = 'top' | 'bottom'

  interface User {
    /**
     * 用户名
     */
    name: string

    /**
     * 连接密码
     */
    password: string

    /**
     * 最大备份快照数
     */
    maxSnapshotNum?: number

    /**
     * 添加歌曲到我的列表时的方式
     */
    'list.addMusicLocationType'?: AddMusicLocationType

    /**
     * 是否启用此用户自定义歌曲目录
     */
    enableCustomMusicDir?: boolean

    /**
     * 自定义歌曲目录路径
     */
    customMusicDir?: string

    /**
     * 是否允许操作目录歌曲（如添加、修改、删除歌曲或分类）
     */
    allowOperateCustomMusicDir?: boolean

    /**
     * 是否允许写入歌曲文件（如手动关联、批量更新元数据、批量嵌入歌词）
     */
    allowWriteCustomMusicDir?: boolean
  }

  interface UserConfig extends User {
    dataPath: string
  }

  interface Config {
    /**
     * 同步服务名称
     */
    'serverName': string

    /**
     * 是否使用代理转发请求到本服务器
     */
    'proxy.enabled': boolean

    /**
     * 代理转发的请求头 原始IP
     */
    'proxy.header': string

    /**
     * 绑定IP
     */
    bindIP: string

    /**
     * 端口
     */
    port: number

    /**
     * 是否开启用户路径 /<userName>
     */

    /**
     * 是否开启用户路径 /<userName>
     */
    'user.enablePath'?: boolean

    /**
     * 是否开启根路径 /
     */
    'user.enableRoot'?: boolean

    /**
     * 是否启用公开用户权限限制
     */
    'user.enablePublicRestriction'?: boolean

    /**
     * 是否开启非管理员访问本地音乐
     */
    'user.enablePublicNonAdminLocalMusic'?: boolean

    /**
     * 是否开启非管理员浏览器下载
     */
    'user.enablePublicNonAdminBrowserDownload'?: boolean

    /**
     * 是否开启非管理员服务器缓存
     */
    'user.enablePublicNonAdminServerCache'?: boolean

    /**
     * 是否开启公开收藏和歌曲
     */
    'user.enablePublicFavorites'?: boolean

    /**
     * 是否开启非管理员访问公开收藏和歌曲
     */
    'user.enablePublicNonAdminAccess'?: boolean

    /**
     * 是否启用登录用户缓存限制
     */
    'user.enableLoginCacheRestriction'?: boolean
    /**
     * 是否启用缓存空间限制
     */
    'user.enableCacheSizeLimit'?: boolean
    /**
     * 缓存空间限制大小 (MB)
     */
    'user.cacheSizeLimit'?: number

    /**
     * 公共最大备份快照数
     */
    maxSnapshotNum: number

    /**
     * 公共添加歌曲到我的列表时的方式 top | bottom，参考客户端的设置-列表设置-添加歌曲到我的列表时的方式
     */
    'list.addMusicLocationType': AddMusicLocationType

    /**
     * 同步用户
     */
    users: UserConfig[]

    /**
     * 前端访问密码
     */
    'frontend.password'?: string

    /**
     * 是否启用 WebDAV 同步服务
     */
    'webdav.enable'?: boolean

    /**
     * WebDAV URL
     */
    'webdav.url'?: string

    /**
     * WebDAV 用户名
     */
    'webdav.username'?: string

    /**
     * WebDAV 密码
     */
    'webdav.password'?: string

    /**
     * WebDAV 增量同步远端路径（默认 /lx-sync）
     */
    'webdav.syncPath'?: string

    /**
     * WebDAV 全量备份远端路径（默认 /lx-sync-backups）
     */
    'webdav.backupPath'?: string

    /**
     * 同步间隔(分钟)
     */
    'sync.interval'?: number

    /**
     * 全量备份间隔(小时)，默认 24
     */
    'sync.backupInterval'?: number

    /**
     * 是否开启Web播放器访问密码
     */
    'player.enableAuth'?: boolean

    /**
     * Web播放器访问密码
     */
    'player.password'?: string

    /**
     * 是否启用自定义歌曲目录
     */
    'user.enableCustomMusicDir'?: boolean

    /**
     * 是否启用针对所有外发请求的代理 (目前主要用于 Music SDK)
     */
    'proxy.all.enabled'?: boolean

    /**
     * 代理地址 (支持 http:// 或 socks5://)
     */
    'proxy.all.address'?: string

    /**
     * 是否禁用数据收集
     */
    disableTelemetry?: boolean

    /**
     * 后台管理界面访问路径，默认为 /admin
     */
    'admin.path'?: string

    /**
     * Web播放器访问路径，默认为空字符串（表示根路径 /）
     */
    'player.path'?: string

    /**
     * 是否启用 Subsonic 协议支持 (默认 true)
     */
    'subsonic.enable'?: boolean

    /**
     * Subsonic 访问路径 (默认 /rest)
     */
    'subsonic.path'?: string

    /**
     * 是否开启 Subsonic 调试日志模式 (默认 false)
     */
    'subsonic.enableDebug'?: boolean

    /**
     * 是否启用 Subsonic 在线全网搜索
     */
    'subsonic.onlineSearch'?: boolean

    /**
     * Subsonic 在线搜索模式 (fallback | merge | local_only)
     */
    'subsonic.onlineSearchMode'?: 'fallback' | 'merge' | 'local_only'

    /**
     * 是否在 Subsonic 中公开在线排行榜(只读虚拟播放列表) (默认 false)
     */
    'subsonic.publicLeaderboards'?: boolean

    /**
     * Subsonic 在线排行榜音源平台 (tx | wy | kg | kw | mg，默认 tx)
     */
    'subsonic.leaderboardSource'?: string

    /**
     * Subsonic 评分联动 dislike 的阈值 (默认 1)
     * 评分 rating 满足 0 < rating <= dislikeRating 时视为「不喜欢」，写回 lx-music 原生 dislike 规则。
     * 设为 0 可关闭整条联动（评分仅作评分，不影响 dislike）。
     */
    'subsonic.dislikeRating'?: number

    /**
     * 解耦开关(正向): 评星 -> 不喜欢 是否自动联动 (默认 false)
     * true 时, Subsonic 客户端打低星(0 < rating <= dislikeRating)会写回 lx-music 原生 dislike 规则;
     * false 时, 评星仅记录到该用户 ratings 映射, 不触碰 dislike 规则, 与「不喜欢」解耦。
     */
    'subsonic.linkRatingToDislike'?: boolean

    /**
     * 解耦开关(反向): 不喜欢 -> 评星 是否自动联动 (默认 false)
     * true 时, 网页端 / Subsonic 给某歌点「不喜欢」会回写该用户 subsonic-meta.json 的 ratings 映射(低星),
     * 使 Subsonic 客户端能看到这颗星; false 时, 「不喜欢」仅写入原生 dislike 规则, 不回写评星, 与评星解耦。
     */
    'subsonic.linkDislikeToRating'?: boolean

    /**
     * Subsonic 列表中是否隐藏 dislike 命中的歌曲 (默认 true)
     * 开启后，命中不喜欢规则的歌曲会直接从专辑/歌单/搜索等列表中剔除；
     * 关闭则保留，仅以评分形式体现（不做剔除）。
     */
    'subsonic.hideDisliked'?: boolean

    /**
     * dislike 是否跨平台同名命中 (默认 false)
     * 各平台歌手 / 专辑 ID 互不相通且无映射表，
     * 开启后同名不同歌手、同名不同专辑会被一并屏蔽（有误伤风险）。
     */
    'subsonic.dislikeCrossSource'?: boolean

    /**
     * 推荐类接口是否排除 dislike 命中的歌曲 (默认 true)
     * 与 hideDisliked 相互独立：
     * - hideDisliked=false 时歌曲仍在歌单/搜索里可见
     * - dislikeNoRecommend=true 时它不会出现在每日推荐 / 随机 / 相似歌曲中
     */
    'subsonic.dislikeNoRecommend'?: boolean

    /**
     * 多歌手匹配模式（合唱歌曲与专辑维度共用）(默认 any)
     * - any     任一位歌手命中即屏蔽（合辑友好）
     * - all     所有歌手都命中才屏蔽（最保守，不牵连合作者）
     * - primary 只看第一位歌手（主唱）
     */
    'subsonic.dislikeDuetMode'?: 'any' | 'all' | 'primary'

    /**
     * dislike 歌名是否做「去版本后缀」归一化 (默认 true)
     * 开启后「晴天 (Live)」「晴天 - Remix」也能命中「晴天」规则，提升召回。
     * 代价：极少数两首不同的歌只差后缀时会被视为同名。
     */
    'subsonic.dislikeNormalizeName'?: boolean

    /**
     * dislike 歌曲 / 专辑级别是否都要求歌手同时匹配 (默认 true)
     * 开启后，只记歌名、没记歌手的规则不会单独命中，
     * 避免不同歌手的同名歌曲 / 同名专辑被一起屏蔽。
     */
    'subsonic.dislikeRequireSinger'?: boolean

    /**
     * Subsonic 推荐池容量 (默认 100)
     * 专辑列表可翻页数 ≈ 该容量 / 客户端请求的 size。
     */
    'subsonic.recommendPoolSize'?: number

    /**
     * Subsonic 在线搜索默认平台 (如 wy,tx,kw,kg,mg)
     */
    'subsonic.onlineSearchSources'?: string

    /**
     * Subsonic 歌词是否包含翻译 (默认 true)
     */
    'subsonic.lyricTranslation'?: boolean

    /**
     * 是否在 Subsonic 播放音乐时触发服务器缓存保存 (默认 false)
     * 开启后,每次通过 Subsonic 协议播放的曲目会在后台落盘到该用户的缓存目录,
     * 已缓存的曲目会被 downloadAndCache 自动跳过,不会重复下载。
     */
    'subsonic.cacheOnPlay'?: boolean

    /**
     * 是否在 Subsonic 播放音乐时优先使用本地缓存/下载文件直接流式传输 (默认 true)
     * 开启后,若服务器该用户目录下已存在此歌曲的缓存或下载文件,直接传输本地流,避免向源站请求在线直链
     */
    'subsonic.playCacheFirst'?: boolean

    /**
     * Subsonic 音质优选总开关 (默认 true)。关闭后 stream 仅做单次解析、不做优先级选择。
     */
    'subsonic.quality.enabled'?: boolean

    /**
     * 音质优先级(从高到低, 逗号分隔), 默认 'flac,320k,128k'。按此顺序主动优选可用音质。
     */
    'subsonic.quality.priority'?: string

    /**
     * 逐源音质优先级覆盖, 如 'subsonic.quality.sources.kw.priority': ['flac','320k']。存在时优先于全局 priority。
     */
    'subsonic.quality.sources'?: Record<string, string[]>

    /**
     * 客户端 maxBitrate 上界模式: 'hard' 只选 ≤ 上限的最高优先级音质; 'soft' 上限内都取不到时再突破上限选更高优先级。
     */
    'subsonic.quality.clientCapMode'?: 'hard' | 'soft'

    /**
     * 跨平台优选顺序(逗号分隔), 默认 'kw,tx,wy,mg,kg'。客户端所选源始终优先, 其余按此顺序优选。
     */
    'subsonic.source.priority'?: string

    /**
     * 是否允许跨平台优选 (默认 true)。关闭则只在客户端所选源内做音质优选。
     */
    'subsonic.source.crossPlatform'?: boolean

    /**
     * 同源是否切换其它自定义源脚本 (默认 true)。callUserApiGetMusicUrl 内部已循环同平台候选脚本。
     */
    'subsonic.source.autoSwitchCustom'?: boolean

    /**
     * 歌手信息源优先级
     */
    'singer.sourcePriority': Array<'tx' | 'wy'>
    /**
     * 歌手歌曲最大抓取页数
     */
    'artist.maxFetchPages'?: number
    /**
     * 缓存命名规则
     */
    'cache.namingPattern'?: string
    /**
     * 缓存存储位置
     */
    serverCacheLocation?: string
    /**
     * 是否允许运行 VM 模式自定义源脚本
     */
    'system.allowUnsafeVM'?: boolean
  }
}
