# 配置、环境变量与存储

系统默认使用 `data/config.js`；`DATA_PATH` 改变数据目录，`CONFIG_PATH` 指定独立配置文件。首次启动时，若目标配置文件不存在，会尝试从程序根目录的旧配置初始化。

普通启动按默认值、配置文件、环境变量的顺序合并配置。启用了 WebDAV 恢复时，恢复过程还会重新加载远端配置和账号数据，因此不能简单理解为“环境变量始终覆盖一切”。当前生效值和配置路径可在管理后台查看。

环境变量在进程启动时读取。修改 Compose 中的环境变量后需要重建容器；后台配置是否即时生效取决于具体选项，监听端口和路径调整后应按提示重新连接或重启。

### 环境变量参考

以下列出常用环境变量。默认值以代码默认配置为基准；仓库自带配置、历史数据和后台保存值可能覆盖它们。`DATA_PATH`、`LOG_PATH` 在 Docker 镜像中另有默认设置，见 [部署指南](./getting-started.md)。

| 环境变量                                     | 对应配置项                                   | 说明                                                                                               | 默认值               |
| -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| `PORT`                                     | `port`                                     | 服务端口                                                                                           | `9527`             |
| `BIND_IP` | `bindIP` | 服务监听地址 | `0.0.0.0` |
| `ADMIN_PATH`                               | `admin.path`                               | 后台管理界面访问路径                                                                               | `/admin`           |
| `PLAYER_PATH`                              | `player.path`                              | Web 播放器访问路径 (默认为根路径 `/`)                                                            | `/`                |
| `ADMIN_PASSWORD`                           | `admin.password`                           | 管理员密码（用于登录控制台和音乐播放器管理员登录）                                                 | `123456`           |
| `SERVER_NAME`                              | `serverName`                               | 同步服务名称（客户端连接展示名称及管理后台标题）                                                   | `LX Sync Server`   |
| `PLAYER_NAME`                              | `player.name`                              | Web 播放器名称（播放器网页标题及登录卡片标题）                                                     | `LX Music Web`     |
| `ENABLE_DEBUG`                             | `debug.enabled`                            | 是否启用 DEBUG 模式 (开启后输出详细调试日志与音源内部日志，默认关闭)                               | `false`            |
| `MAX_SNAPSHOT_NUM`                         | `maxSnapshotNum`                           | 保留的最大快照数量                                                                                 | `10`               |
| `CONFIG_PATH`                              | -                                            | 指定外部配置文件的绝对路径 (默认使用 `data/config.js`)                                           | -                    |
| `DATA_PATH`                                | -                                            | 指定数据存储目录的绝对路径                                                                         | `./data`           |
| `LOG_PATH`                                 | -                                            | 指定日志输出目录的绝对路径                                                                         | `./logs`           |
| `PROXY_HEADER` | `proxy.header` | 代理转发的原始 IP 头 | `x-real-ip` |
| `USER_ENABLE_ROOT`                         | `user.enableRoot`                          | 启用根路径 (开启后连接URL即为 `ip:port`，不允许不同用户密码相同)                                 | `false`            |
| `USER_ENABLE_PATH`                         | `user.enablePath`                          | 启用用户路径 (开启后连接URL需为 `ip:port/用户名`，允许密码相同)                                  | `true`             |
| `WEBDAV_ENABLE`                            | `webdav.enable`                            | 是否启用 WebDAV 同步与备份                                                                         | `false`            |
| `WEBDAV_URL`                               | `webdav.url`                               | WebDAV 地址                                                                                        | -                    |
| `WEBDAV_USERNAME`                          | `webdav.username`                          | WebDAV 用户名                                                                                      | -                    |
| `WEBDAV_PASSWORD`                          | `webdav.password`                          | WebDAV 密码                                                                                        | -                    |
| `WEBDAV_SYNC_PATH`                         | `webdav.syncPath`                          | WebDAV 增量同步远端路径                                                                            | `/lx-sync`         |
| `WEBDAV_BACKUP_PATH`                       | `webdav.backupPath`                        | WebDAV 全量备份远端路径                                                                            | `/lx-sync-backups` |
| `SYNC_INTERVAL`                            | `sync.interval`                            | WebDAV 增量同步检测间隔(分钟)                                                                      | `60`               |
| `BACKUP_INTERVAL`                          | `sync.backupInterval`                      | WebDAV 全量备份间隔(小时)                                                                          | `24`               |
| `WEBDAV_EXCLUDE_CACHE` | `webdav.excludeCache` | 旧兼容项；数据备份现在固定排除缓存 | `false` |
| `WEBDAV_EXCLUDE_MUSIC` | `webdav.excludeMusic` | 旧兼容项；显式备份类型数组优先 | `false` |
| `ENABLE_WEBPLAYER_AUTH`                    | `player.enableAuth`                        | 是否启用 Web 播放器访问密码                                                                        | `false`            |
| `WEBPLAYER_PASSWORD`                       | `player.password`                          | Web 播放器访问密码                                                                                 | `123456`           |
| `DISABLE_TELEMETRY`                        | `disableTelemetry`                         | 是否禁用匿名数据统计，系统更新提示以及系统公告提示                                                 | `false`            |
| `ENABLE_PUBLIC_USER_RESTRICTION`           | `user.enablePublicRestriction`             | 是否启用公开用户权限限制 (限制上传、删除公开源、缓存到服务器等)                                    | `true`             |
| `ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC`      | `user.enablePublicNonAdminLocalMusic`      | 是否开启非管理员访问本地音乐 (允许未登录管理员的公开账号访问本地音乐)                              | `false`            |
| `ENABLE_PUBLIC_NON_ADMIN_BROWSER_DOWNLOAD` | `user.enablePublicNonAdminBrowserDownload` | 是否开启非管理员浏览器下载 (允许未登录管理员的公开/普通账号使用浏览器下载歌曲)                     | `true`             |
| `ENABLE_PUBLIC_NON_ADMIN_SERVER_CACHE`     | `user.enablePublicNonAdminServerCache`     | 是否开启非管理员服务器缓存 (允许未登录管理员的公开/普通账号将歌曲缓存到服务器)                     | `false`            |
| `ENABLE_PUBLIC_FAVORITES`                  | `user.enablePublicFavorites`               | 是否开启公开收藏和歌曲 (开启后允许公开/未登录用户查看及播放公开收藏)                               | `false`            |
| `ENABLE_PUBLIC_NON_ADMIN_ACCESS`           | `user.enablePublicNonAdminAccess`          | 是否开启非管理员访问公开收藏和歌曲 (允许未登录管理员的公开账号查看)                                | `false`            |
| `ENABLE_CUSTOM_MUSIC_DIR`                  | `user.enableCustomMusicDir`                | 是否开启自定义歌曲目录总开关                                                                       | `false`            |
| `ENABLE_LOGIN_USER_CACHE_RESTRICTION`      | `user.enableLoginCacheRestriction`         | 是否启用登录用户缓存限制 (开启后限非管理员登录用户的缓存设置)                                      | `false`            |
| `ENABLE_CACHE_SIZE_LIMIT`                  | `user.enableCacheSizeLimit`                | 是否启用缓存空间限制 (开启后超出容量将按 LRU 自动清理)                                             | `false`            |
| `CACHE_SIZE_LIMIT`                         | `user.cacheSizeLimit`                      | 缓存空间限制大小 (单位: MB)                                                                        | `2000`             |
| `CONFIG_BACKUP_ENABLE`                     | `configBackup.enable`                      | 是否启用配置文件自动备份功能 (每天生成一份历史配置副本)                                            | `true`             |
| `CONFIG_BACKUP_RETENTION_DAYS`             | `configBackup.retentionDays`               | 配置文件备份保留天数 (自动清理过期备份)                                                            | `7`                |
| `CONFIG_BACKUP_DIR` | `configBackup.dir` | 配置备份目录，相对路径基于数据目录 | 空，使用 `data/backups` |
| `SNAPSHOT_BACKUP_PATH`                     | `snapshot.backupPath`                      | 歌单快照自定义存储路径 (支持绝对路径或相对 `./data`，各用户独立隔离)                             | -                    |
| `LIST_ADD_MUSIC_LOCATION_TYPE`             | `list.addMusicLocationType`                | 添加歌曲到列表时的位置 (`top` / `bottom`)                                                      | `top`              |
| `PROXY_ALL_ENABLED`                        | `proxy.all.enabled`                        | 是否启用外发请求代理 (针对 Music SDK)                                                              | `false`            |
| `PROXY_ALL_ADDRESS`                        | `proxy.all.address`                        | 代理地址 (支持 http:// 或 socks5://)                                                               | -                    |
| `SINGER_SOURCE_PRIORITY`                   | `singer.sourcePriority`                    | 歌手信息获取来源优先级 (如 `tx,wy` 或 `wy,tx`)                                                 | `tx,wy`            |
| `SUBSONIC_ENABLE`                          | `subsonic.enable`                          | 是否启用 Subsonic 协议支持                                                                         | `true`             |
| `SUBSONIC_PATH`                            | `subsonic.path`                            | Subsonic 接口访问路径 (默认为 `/rest`)                                                           | `/rest`            |
| `SUBSONIC_PORT` | `subsonic.port` | 独立监听端口；需要另行启用 `subsonic.standalone` | `4050` |
| `SUBSONIC_ENABLE_DEBUG`                    | `subsonic.enableDebug`                     | 是否开启 Subsonic 调试日志模式                                                                     | `false`            |
| `SUBSONIC_ONLINE_SEARCH`                   | `subsonic.onlineSearch`                    | 是否开启 Subsonic 在线全网搜索                                                                     | `true`             |
| `SUBSONIC_ONLINE_SEARCH_MODE`              | `subsonic.onlineSearchMode`                | Subsonic 在线搜索模式 (`fallback` / `merge` / `local_only`)                                  | `fallback`         |
| `SUBSONIC_ONLINE_SEARCH_SOURCES`           | `subsonic.onlineSearchSources`             | Subsonic 在线搜索默认音源列表                                                                      | `wy,tx,kw,kg,mg`   |
| `SUBSONIC_PUBLIC_LEADERBOARDS` | `subsonic.publicLeaderboards` | 是否返回在线排行榜等共享歌单 | `false` |
| `SUBSONIC_LEADERBOARD_SOURCE`              | `subsonic.leaderboardSource`               | Subsonic 公开排行榜默认音源平台 (仅支持单选, 如 `tx`, `wy` 等)                                 | `tx`               |
| `SUBSONIC_LYRIC_TRANSLATION`               | `subsonic.lyricTranslation`                | Subsonic 歌词中是否包含翻译                                                                        | `true`             |
| `SUBSONIC_CACHE_ON_PLAY`                   | `subsonic.cacheOnPlay`                     | Subsonic 播放时是否触发服务器自动缓存保存 (落盘到用户目录)                                         | `false`            |
| `SUBSONIC_PLAY_CACHE_FIRST`                | `subsonic.playCacheFirst`                  | Subsonic 播放时是否优先使用服务器已有的本地缓存/下载文件直接传输(默认关闭,避免服务器自担出向流量) | `false`            |
| `SUBSONIC_QUALITY_ENABLED`                 | `subsonic.quality.enabled`                 | Subsonic 是否开启音质优选                                                                          | `true`             |
| `SUBSONIC_QUALITY_PRIORITY`                | `subsonic.quality.priority`                | Subsonic 音质优选优先级列表 (如 `flac,320k,128k`)                                                | `flac,320k,128k`   |
| `SUBSONIC_SOURCE_PRIORITY`                 | `subsonic.source.priority`                 | 跨平台优选顺序                                                                                     | `kw,tx,wy,mg,kg`   |
| `SUBSONIC_SOURCE_CROSS_PLATFORM`           | `subsonic.source.crossPlatform`            | 跨平台查找候选                                                                                     | `true`             |
| `SUBSONIC_SOURCE_AUTOSWITCH_CUSTOM`        | `subsonic.source.autoSwitchCustom`         | 同平台解析失败时是否尝试其他自定义源脚本                                                           | `true`             |
| `ARTIST_MAX_FETCH_PAGES`                   | `artist.maxFetchPages`                     | 歌手歌曲最大抓取页数                                                                               | `20`               |
| `CACHE_NAMING_PATTERN` | `cache.namingPattern` | `simple`、`standard`、`singer_name_quality_album`、`singer_name`、`name_singer` | `simple` |
| `SYSTEM_ALLOW_UNSAFE_VM`                   | `system.allowUnsafeVM`                     | 是否允许运行 VM 模式自定义源脚本 (需注意安全风险)                                                  | `false`            |
| `LX_USER_<用户名>`                         | `users` 数组                               | 快速添加用户，值为该用户的密码 (如 `LX_USER_test=123`)                                           | -                    |

布尔值不区分大小写，开启可用 `true/1/yes/y/on`，关闭可用 `false/0/no/n/off`。

`LX_USER_<用户名>` 的值作为该用户密码使用，例如 `LX_USER_user1=your-password`。自定义目录、写入权限和账号禁用等高级设置请通过后台用户管理维护，不要把 JSON 当作该环境变量的高级配置格式。

### 通过配置文件设置的选项

部分选项没有对应环境变量，可在后台或配置文件中设置：

| 配置项 | 说明 |
| --- | --- |
| `subsonic.standalone` | 是否启用 Subsonic 独立监听，默认 false |
| `subsonic.localPlaylist` | 是否返回本地歌曲只读歌单，默认 true |
| `subsonic.customPlaylist` | 是否单独返回自定义目录歌单，默认 true，依赖本地歌单开关及账号目录权限 |
| `proxy.music.*` | 音乐平台请求代理 |
| `proxy.customSource.*` | 自定义源请求代理 |
| `proxy.app.*` | 应用功能请求代理 |

分类代理的 `enabled` 未设置时沿用统一代理开关，显式设为 false 时该类请求直连，设为 true 时启用代理；独立地址留空时沿用统一地址。完整配置项还可参考 [默认配置](https://github.com/XCQ0607/lxserver/blob/main/src/defaultConfig.ts)。

## 数据目录与备份

### 目录分别保存什么

| 位置 | 内容 | 迁移时的处理 |
| --- | --- | --- |
| `data/` 或 `DATA_PATH` | 配置、账号、歌单、用户状态及运行数据 | 整体保存，作为迁移的基础 |
| `data/config.js` | 当前服务配置，除非显式设置 `CONFIG_PATH` | 与账号和其他数据一起备份 |
| 程序根目录的 `cache/`、`music/` | 根目录存储模式下的音频及索引 | 使用该模式时单独保留 |
| 数据目录下的 `cache/`、`music/` | 数据目录存储模式下的音频及索引 | 随数据目录一起保留 |
| 自定义音乐目录 | 用户已有的外部音乐文件 | 单独备份，并保留容器挂载关系 |
| 日志目录 | 启动、请求和后台任务日志 | 源码运行默认 `logs/`；Docker 默认 `data/logs/` |

音频目录内还会按账号隔离文件，实际路径可在界面或目录接口中查看。网页临时浏览其他位置不会自动迁移文件，也不会更改账号持久化的存储选择。

Subsonic 用户目录中的 `subsonic-local-registry.json` 和 `subsonic-local-state.json` 保存本地歌曲身份、收藏及歌单关系，迁移时应保留，不能当作可随意删除的临时缓存。

### 快照、配置备份与 WebDAV

歌单快照用于恢复歌单数据，配置备份用于恢复 `config.js`，它们都不能代替音频文件备份。

配置备份默认开启，保留 7 天；默认位置为数据目录的 `backups/`。可以用 `CONFIG_BACKUP_DIR` 和 `SNAPSHOT_BACKUP_PATH` 自定义配置备份、歌单快照的存储位置。

WebDAV 和 OpenList 按「系统设置 → 云端备份范围」选择的数据类型备份。启动时恢复默认关闭，可用 `backup.webdav.restoreOnStartup` 显式开启。恢复步骤和两种后端的职责见 [云端备份与恢复](./backup-recovery.md)。

新的 `backup.webdav.types` 和 `backup.openlist.types` 类型数组分别控制两个目的地。歌曲只包含 `data/music`；`cache` 和外部音乐目录不属于数据备份。旧排除选项不再作为第二套界面开关。

### 更新与迁移

更新前保存数据目录、实际使用的音频目录以及外部配置文件。Docker Compose 部署可以执行：

```bash
docker compose pull
docker compose up -d
docker compose logs --tail=100
```

源码部署更新后重新安装依赖、构建并重启；不要只拉取源码就继续使用旧的 `server/`。迁移完成后检查账号登录、歌单数量、本地目录扫描和一首歌曲的实际播放。

## 目录与用户高级设置

### 配置文件片段

下面演示独立 Subsonic 端口与用户目录的字段写法，合并到现有配置对象中使用，不要用它替换整个配置文件：

```js
module.exports = {
  'subsonic.enable': true,
  'subsonic.standalone': true,
  'subsonic.port': 4050,
  'user.enableCustomMusicDir': true,
  users: [
    {
      name: 'user1',
      password: 'replace-with-your-user-password',
      enableCustomMusicDir: true,
      customMusicDir: '/library',
      allowOperateCustomMusicDir: false,
      allowWriteCustomMusicDir: false,
    },
  ],
}
```

`/library` 是 Linux/容器路径示例，Windows 直接运行可填写 `D:/Music` 等实际路径。关闭操作和写入权限适合先验证浏览播放。Docker 使用独立端口还需映射 `4050:4050`。

### 临时设置启动环境

Bash：

```bash
DATA_PATH=/absolute/path/to/test-data PORT=9528 npm run dev
```

PowerShell：

```powershell
$env:DATA_PATH = 'D:\lxserver-test-data'
$env:PORT = '9528'
npm run dev
```

这些命令不修改其他终端的环境。试验目录应与常用实例分开；还要检查测试配置是否会恢复同一个 WebDAV 远端。

推荐在后台用户管理中设置自定义目录、操作/写入权限、自动下载和账号禁用状态。手动配置时使用 JavaScript 配置对象的 users 数组；已存在的 users.json 以及启动时远端恢复也会影响最终账号列表。不要认为只改根目录示例配置就能覆盖已部署账号。

服务器路径以服务所在环境为准：源码运行填主机路径，Docker 填容器路径。只读挂载与应用写入权限同时存在时，以实际文件系统权限为限。修改浏览位置不移动音频；迁移存储是单独操作。

## 配置修改后的检查

- 端口：检查主服务和独立 Subsonic 监听，Docker 端口映射要对应。
- 路径：检查播放器、后台及客户端，反向代理不要重复拼接前缀。
- 代理：区分出站请求分类代理与媒体转发，修改后用搜索和实际播放分别验证。
- 目录：检查挂载、账号权限和扫描结果，不只检查路径字符串是否保存。
- WebDAV：核对远端命名空间、排除项、恢复日志和运行时值。

启动方式见 [部署指南](./getting-started.md)，备份恢复见 [运行维护](./operations.md)。
