
const config: LX.Config = {
  serverName: 'lxserver', // 同步服务名称
  'proxy.enabled': false, // 是否使用代理转发请求到本服务器
  'proxy.header': 'x-real-ip', // 代理转发的请求头 原始IP
  bindIP: '0.0.0.0', // 绑定IP
  port: 9527, // 端口
  'user.enablePath': true, // 是否开启用户路径
  'user.enableRoot': true, // 是否开启根路径
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
  'admin.path': '', // 后台管理路径，默认为根路径 /
  'player.path': '/music', // 播放器路径
  'subsonic.enable': true, // 是否启用 Subsonic 服务
  'subsonic.path': '/rest', // Subsonic 访问路径
  'subsonic.enableDebug': true, // 是否开启 Subsonic 调试日志模式
  'subsonic.onlineSearch': true, // 是否开启 Subsonic 在线全网搜索
  'subsonic.onlineSearchMode': 'fallback', // 在线搜索模式: fallback | merge | local_only
  'subsonic.onlineSearchSources': 'wy,tx,kw,kg,mg', // 在线搜索默认平台
  'subsonic.lyricTranslation': true, // 是否在 Subsonic 歌词中包含翻译
  'singer.sourcePriority': ['tx', 'wy'], // 歌手信息源优先级
  'artist.maxFetchPages': 20, // 歌手歌曲最大抓取页数
  'cache.namingPattern': 'simple', // 缓存命名规则
  'system.allowUnsafeVM': false, // 是否允许运行 VM 模式自定义源脚本
}

export default config
