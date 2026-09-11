
const config: LX.Config = {
  serverName: 'lxserver', // 同步服务名称
  'proxy.enabled': false, // 是否使用代理转发请求到本服务器
  'proxy.header': 'x-real-ip', // 代理转发的请求头 原始IP
  bindIP: '0.0.0.0', // 绑定IP
  port: 9527, // 端口
  'user.enablePath': true, // 是否开启用户路径
  'user.enableRoot': false, // 是否开启根路径
  'user.enablePublicRestriction': true, // 是否启用公开用户权限限制
  'user.enablePublicNonAdminLocalMusic': false, // 是否开启非管理员访问本地音乐
  'user.enablePublicNonAdminBrowserDownload': true, // 是否开启非管理员浏览器下载
  'user.enablePublicNonAdminServerCache': false, // 是否开启非管理员服务器缓存
  'user.enablePublicFavorites': false, // 是否开启公开收藏和歌曲
  'user.enablePublicNonAdminAccess': false, // 是否开启非管理员访问公开收藏和歌曲
  'user.enableCustomMusicDir': false, // 是否启用自定义歌曲目录
  'user.enableLoginCacheRestriction': false, // 是否启用登录用户缓存限制
  'user.enableCacheSizeLimit': false, // 是否启用缓存空间限制
  'user.cacheSizeLimit': 2000, // 缓存空间限制大小 (MB)

  maxSnapshotNum: 10, // 公共最大备份快照数
  'list.addMusicLocationType': 'top', // 公共添加歌曲到我的列表时的位置 top | bottom，参考客户端的「设置 → 列表设置 → 添加歌曲到列表时的位置」
  disableTelemetry: false, // 是否禁用数据收集（仅用于开源项目改进，不含敏感信息）

  users: [
    // 用户配置例子
    // {
    //   name: 'user1', // 用户名，必须，不能与其他用户名重复
    //   password: '123.def', // 是连接密码，必须，不能与其他用户密码重复，若在外网，务必增加密码复杂度
    //   maxSnapshotNum: 10, // 可选，最大备份快照数
    //   'list.addMusicLocationType': 'top', // 可选，添加歌曲到我的列表时的位置 top | bottom，参考客户端的「设置 → 列表设置 → 添加歌曲到列表时的位置」
    //   enableCustomMusicDir: false, // 可选，是否启用此用户自定义歌曲目录
    //   customMusicDir: '', // 可选，自定义歌曲目录绝对路径
    //   allowOperateCustomMusicDir: false, // 可选，是否允许操作目录歌曲（如删除、洗版）
    //   allowWriteCustomMusicDir: false, // 可选，是否允许写入歌曲文件（如关联、更新元信息、嵌入歌词）
    // },
  ],

  'frontend.password': '123456',

  // WebDAV 配置
  'webdav.enable': false,
  'webdav.url': '',
  'webdav.username': '',
  'webdav.password': '',
  'webdav.syncPath': '/lx-sync', // 增量同步远程路径
  'webdav.backupPath': '/lx-sync-backups', // 全量备份远程路径
  'sync.interval': 60, // 同步间隔（分钟）默认1小时
  'sync.backupInterval': 24, // 全量备份间隔（小时）默认24小时

  // Web播放器配置
  'player.enableAuth': false,
  'player.password': '123456',

  // 代理配置
  'proxy.all.enabled': false,
  'proxy.all.address': '',

  // 访问路径配置
  'admin.path': '/admin', // 后台管理路径
  'player.path': '/', // 播放器路径，默认为根路径 /
  'subsonic.enable': true, // 是否启用 Subsonic 服务
  'subsonic.path': '/rest', // Subsonic 访问路径
  'subsonic.enableDebug': false, // 是否开启 Subsonic 调试日志模式
  'subsonic.onlineSearch': true, // 是否开启 Subsonic 在线全网搜索
  'subsonic.onlineSearchMode': 'fallback', // 在线搜索模式: fallback | merge | local_only
  'subsonic.onlineSearchSources': 'wy,tx,kw,kg,mg', // 在线搜索默认平台
  'subsonic.publicLeaderboards': true, // 是否在 Subsonic 中公开在线排行榜(只读虚拟播放列表)
  'subsonic.leaderboardSource': 'tx', // 在线排行榜平台: tx | wy | kg | kw | mg
  'subsonic.dislikeRating': 1, // 评分联动 dislike 阈值: 0 < rating <= 该值 视为不喜欢(写回原生 dislike 规则); 设为 0 关闭联动
  'subsonic.linkRatingToDislike': false, // 解耦开关(正向): 评星 -> 不喜欢 是否自动联动; false=不联动(仅记录评分)
  'subsonic.linkDislikeToRating': false, // 解耦开关(反向): 不喜欢 -> 评星 是否自动联动; false=不联动(仅记录不喜欢)
  'subsonic.hideDisliked': true, // 是否在 Subsonic 列表中隐藏 dislike 命中的歌曲(关闭则只评分不剔除)
  'subsonic.dislikeCrossSource': false, // dislike 是否跨平台同名命中(各平台 ID 不互通, 开启会误伤同名歌手/专辑)
  'subsonic.dislikeNoRecommend': true, // 推荐类接口(每日推荐/随机/相似)是否排除 dislike 歌曲(与 hideDisliked 独立)
  'subsonic.dislikeDuetMode': 'any', // 合唱歌曲匹配模式: any=任一歌手命中 / all=全部命中 / primary=仅主唱
  'subsonic.dislikeNormalizeName': true, // 歌名去版本后缀归一化: 「晴天 (Live)」也能命中「晴天」规则
  'subsonic.dislikeRequireSinger': true, // 歌曲/专辑级别都要求歌手同时匹配(关闭则纯歌名规则可单独命中, 会误杀同名)
  'subsonic.recommendPoolSize': 100, // 推荐池容量: 专辑列表可翻页数 ≈ 容量 / size
  'subsonic.lyricTranslation': true, // 是否在 Subsonic 歌词中包含翻译
  'subsonic.cacheOnPlay': false, // 是否在 Subsonic 播放时触发服务器缓存保存（落盘）
  'subsonic.playCacheFirst': true, // 是否在 Subsonic 播放时优先使用服务器已有的本地缓存/下载文件直接传输
  'subsonic.quality.enabled': true, // 音质优选总开关: 按优先级主动选最优可用音质(非失败降级); 关闭则 stream 仅单次解析
  'subsonic.quality.priority': 'flac,320k,128k', // 音质优先级(从高到低, 逗号分隔), 按此顺序主动优选
  'subsonic.quality.clientCapMode': 'soft', // 客户端 maxBitrate 上界模式: hard 仅选≤上限的最高优先级; soft 上限内都取不到再突破上限选更高优先级
  'subsonic.source.priority': 'kw,tx,wy,mg,kg', // 跨平台优选顺序(逗号分隔, 客户端所选源始终优先)
  'subsonic.source.crossPlatform': true, // 是否允许跨平台优选(按歌名+歌手在其它平台搜索替身)
  'subsonic.source.autoSwitchCustom': true, // 同源是否切换其它自定义源脚本(callUserApiGetMusicUrl 内部循环同平台候选脚本)
  'singer.sourcePriority': ['tx', 'wy'], // 歌手信息源优先级
  'artist.maxFetchPages': 20, // 歌手歌曲最大抓取页数
  'cache.namingPattern': 'simple', // 缓存命名规则
  'system.allowUnsafeVM': false, // 是否允许运行 VM 模式自定义源脚本
}

export default config
