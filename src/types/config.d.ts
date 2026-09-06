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
     * Subsonic 在线搜索默认平台 (如 wy,tx,kw,kg,mg)
     */
    'subsonic.onlineSearchSources'?: string

    /**
     * Subsonic 歌词是否包含翻译 (默认 true)
     */
    'subsonic.lyricTranslation'?: boolean

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
