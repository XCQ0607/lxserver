/**
 * 配置文件
 * 配置优先级：WEBDAV备份数据 > 环境变量 > config.js (本文件) > src/defaultConfig.ts (默认配置)
 */
module.exports = {
  // 同步服务名称
  // 环境变量: SERVER_NAME
  "serverName": "lxserver",

  // 是否使用代理转发请求到本服务器 (如果配置了 proxy.header，此项会自动设为 true)
  // 环境变量: 无 (通过 PROXY_HEADER 隐式开启)
  "proxy.enabled": false,

  // 代理转发的请求头 原始IP
  // 环境变量: PROXY_HEADER
  "proxy.header": "x-real-ip",

  // 服务绑定IP (0.0.0.0 允许外网访问，127.0.0.1 仅限本机)
  // 环境变量: BIND_IP
  "bindIP": "0.0.0.0",

  // 服务监听端口
  // 环境变量: PORT
  "port": 9527,

  // 是否开启用户路径 (baseurl/用户名)
  // 开启后连接URL需包含用户名，允许不同用户使用相同密码。关闭后仅使用密码鉴权，要求所有用户密码唯一。
  // 环境变量: USER_ENABLE_PATH (true/false)
  "user.enablePath": true,

  // 是否开启根路径 (baseurl)
  // 开启后连接URL即为根路径，不允许不同用户使用相同密码。
  // 环境变量: USER_ENABLE_ROOT (true/false)
  "user.enableRoot": true,

  // 是否启用登录用户缓存限制 (开启后将限制非管理员登录用户的核心缓存设置)
  // 环境变量: ENABLE_LOGIN_USER_CACHE_RESTRICTION (true/false)
  "user.enableLoginCacheRestriction": false,

  // 是否启用缓存空间限制 (开启后超出容量将按 LRU 自动清理)
  // 环境变量: ENABLE_CACHE_SIZE_LIMIT (true/false)
  "user.enableCacheSizeLimit": false,

  // 缓存空间限制大小 (单位: MB)
  // 环境变量: CACHE_SIZE_LIMIT
  "user.cacheSizeLimit": 2000,

  // 最大快照数 (用于数据回滚)
  // 环境变量: MAX_SNAPSHOT_NUM
  "maxSnapshotNum": 10,

  // 添加歌曲到列表时的位置 (top: 顶部, bottom: 底部)
  // 环境变量: LIST_ADD_MUSIC_LOCATION_TYPE
  "list.addMusicLocationType": "top",

  // 是否禁用数据收集
  // 环境变量: DISABLE_TELEMETRY (true/false)
  // 说明：仅收集版本号、运行环境（Docker/Node）、OS类型等非敏感信息用于项目改进。绝对匿名，不收集IP。
  "disableTelemetry": false,

  // 前端管理控制台访问密码
  // 环境变量: FRONTEND_PASSWORD
  "frontend.password": "123456",

  // 用户列表
  // 环境变量: LX_USER_<用户名>=<密码> (例如: LX_USER_user1=123456)
  "users": [
    {
      "name": "admin",
      "password": "password"
    }
  ],

  // WebDAV 同步配置 (可选，用于数据备份)
  // 是否启用 WebDAV 同步与备份
  // 环境变量: WEBDAV_ENABLE (true/false)
  "webdav.enable": false,

  // WebDAV 服务地址
  // 环境变量: WEBDAV_URL
  "webdav.url": "",

  // WebDAV 用户名
  // 环境变量: WEBDAV_USERNAME
  "webdav.username": "",

  // WebDAV 密码
  // 环境变量: WEBDAV_PASSWORD
  "webdav.password": "",

  // WebDAV 增量同步远端路径
  // 环境变量: WEBDAV_SYNC_PATH
  "webdav.syncPath": "/lx-sync",

  // WebDAV 全量备份远端路径
  // 环境变量: WEBDAV_BACKUP_PATH
  "webdav.backupPath": "/lx-sync-backups",

  // 同步检测间隔 (分钟)
  // 环境变量: SYNC_INTERVAL
  "sync.interval": 60,

  // 全量备份间隔 (小时)
  // 环境变量: BACKUP_INTERVAL
  "sync.backupInterval": 24,

  // 是否启用 Web播放器 访问密码
  // 环境变量: ENABLE_WEBPLAYER_AUTH (true/false)
  "player.enableAuth": false,

  // Web播放器 访问密码
  // 环境变量: WEBPLAYER_PASSWORD
  "player.password": "123456",

  // 是否启用针对所有外发的请求代理 (目前主要用于离线音源的播放链接获取)
  // 环境变量: PROXY_ALL_ENABLED (true/false)
  "proxy.all.enabled": false,

  // 代理地址 (支持 http:// 或 socks5://)
  // 环境变量: PROXY_ALL_ADDRESS (例如: http://127.0.0.1:7890)
  "proxy.all.address": "",

  // 后台管理界面访问路径（默认为空，即根路径 /）
  // 环境变量: ADMIN_PATH
  "admin.path": "",

  // Web播放器访问路径（默认为 /music）
  // 环境变量: PLAYER_PATH
  "player.path": "/music",

  // Subsonic 协议配置
  // 是否启用 Subsonic 协议支持 (服务默认开启)
  // 环境变量: SUBSONIC_ENABLE
  "subsonic.enable": true,

  // Subsonic 访问路径 (默认为 /rest)
  // 环境变量: SUBSONIC_PATH
  "subsonic.path": "/rest",

  // 是否开启 Subsonic 调试日志模式
  // 环境变量: 无
  "subsonic.enableDebug": true,

  // 是否开启 Subsonic 在线全网搜索
  // 环境变量: 无
  "subsonic.onlineSearch": true,

  // Subsonic 在线搜索模式 (fallback: 回退模式, merge: 合并模式, local_only: 仅本地)
  // 环境变量: 无
  "subsonic.onlineSearchMode": "fallback",

  // Subsonic 在线搜索默认平台
  // 环境变量: 无
  "subsonic.onlineSearchSources": "wy,tx,kw,kg,mg",

  // 是否在 Subsonic 歌词中包含翻译
  // 环境变量: 无
  "subsonic.lyricTranslation": true,

  // 歌手信息源优先级 (多个源用逗号分隔，如 tx,wy)
  // 环境变量: SINGER_SOURCE_PRIORITY
  "singer.sourcePriority": [
    "tx",
    "wy"
  ],

  // 歌手歌曲最大抓取页数
  // 环境变量: 无
  "artist.maxFetchPages": 20,

  // 缓存文件命名规则 (simple / custom)
  // 环境变量: 无
  "cache.namingPattern": "simple",

  // 是否允许运行 VM 模式自定义源脚本 (默认关闭)
  // 环境变量: 无
  "system.allowUnsafeVM": false
}
