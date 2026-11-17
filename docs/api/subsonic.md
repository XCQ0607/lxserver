# Subsonic 协议支持

本服务实现 Subsonic / OpenSubsonic 接口，用于将 LX 歌单、在线音源和账号本地曲库提供给兼容客户端。接口行为由服务端配置、音源可用性及客户端能力共同决定。本页按功能说明支持范围，不代表所有客户端提供相同界面。

本地文件目录、身份和歌单持久化见 [Subsonic 本地音乐库](../guide/subsonic-local-library.md)，连接设置见 [同步服务器设置](../guide/sync-server.md)。

## 接入方式

默认协议路径为 `/rest`，与主服务共用端口；路径可通过 `subsonic.path` 调整。使用独立端口时，必须同时启用 `subsonic.standalone` 并设置有效的 `subsonic.port`，只设置端口不会启用独立监听。

使用用户账号的同步密码认证，不使用管理密码。接口支持 JSON / XML；以下路径中的参数仅示意，正式客户端应提供协议认证和版本等参数。

```text
GET /rest/ping.view?u=<user>&t=<token>&s=<salt>&v=1.16.1&c=<client>&f=json
```

## 支持的接口

### 系统、浏览与搜索

| 方法 | 行为与限制 |
| --- | --- |
| `ping`、`getLicense`、`getUser` | 连接检查、许可信息和当前用户信息 |
| `getMusicFolders` | 返回服务器设置入口、NAS 本地音乐及在线平台入口 |
| `getMusicDirectory` | 目录、专辑、歌单和本地音乐入口 |
| `getIndexes`、`getArtists`、`getArtistList` | 艺术家索引；`getArtistList` 为兼容入口 |
| `getArtist`、`getArtistInfo`、`getArtistInfo2` | 艺术家详情和信息 |
| `getAlbum`、`getAlbumInfo`、`getAlbumInfo2` | 专辑歌曲、介绍及封面信息 |
| `getAlbumList`、`getAlbumList2` | 专辑列表、推荐和最近播放等；指定 NAS 文件夹时使用本地分支 |
| `getGenres` | 在线或本地曲库的流派信息 |
| `search`、`search2`、`search3` | 根据在线搜索设置和查询前缀选择数据来源 |
| `startScan`、`getScanStatus` | 刷新本地索引，返回扫描状态、数量和失败原因；不是固定占位状态 |

在线搜索使用 `subsonic.onlineSearch` 与 `subsonic.onlineSearchMode`：`fallback` 在本地结果不足时补充在线结果，`merge` 合并结果，`local_only` 只查本地。可使用 `local:`、`online:` 或平台前缀限定范围；在线播放仍需要可用的自定义音源。

### 媒体、歌单与收藏

| 方法 | 行为与限制 |
| --- | --- |
| `getSong` | 在线或本地歌曲信息 |
| `stream`、`download` | 音频读取；本地文件支持 Range，在线资源依赖音源解析 |
| `getCoverArt` | 歌曲、专辑及歌单封面，支持 `size` 参数 |
| `getLyrics`、`getLyricsBySongId` | 普通及结构化歌词；来源和逐字歌词限制见本地音乐库说明 |
| `getPlaylists`、`getPlaylist` | 用户、共享及已启用的只读本地歌单 |
| `createPlaylist`、`updatePlaylist`、`deletePlaylist` | 用户歌单管理；内置和共享歌单有写入限制 |
| `getStarred`、`getStarred2`、`star`、`unstar` | 查询及设置收藏 |
| `setRating` | 按用户保存 0–5 分；0 表示清除评分 |

纯本地与混合歌单的同步规则、删除行为和备份文件见 [收藏与歌单同步](../guide/subsonic-local-library.md#收藏与歌单同步)。

### 发现与电台

| 方法 | 行为与限制 |
| --- | --- |
| `getRandomSongs`、`getSongsByGenre`、`getSongsByGenre2` | 随机或按流派返回歌曲，支持本地库分支 |
| `getSimilarSongs`、`getSimilarSongs2`、`getSonicSimilarTracks` | 基于同歌手等条件挑选相似歌曲，不进行声学分析 |
| `getTopSongs` | 艺术家热门歌曲 |
| `getRecommendedSongs`、`getDailySongs`、`getSongsByTag` | 服务端推荐入口；后两者为别名，`getSongsByTag` 不执行独立标签检索 |
| `getInternetRadioStations` | 返回可用的官方电台、用户电台及音源歌单电台 |
| `createInternetRadioStation`、`updateInternetRadioStation`、`deleteInternetRadioStation` | 用户电台管理；另接受复数形式的删除兼容入口 |

每日推荐从在线推荐专辑获取歌曲并去重，同一天使用稳定的洗牌顺序。上游不可用时可回退到上次成功结果。返回前按账号过滤落入“不喜欢”评分区间的歌曲：`0 < rating <= subsonic.dislikeRating`，默认阈值为 1。

服务端生成的电台流地址使用绝对 URL 和限时票据，不直接携带长期认证凭据；用户自建的外部电台地址按配置返回。反向代理应正确传递协议等信息，且客户端必须能访问这些地址。上游官方电台不可用时会被暂时隐藏。

### 播放活动、队列与书签

| 方法 | 行为与限制 |
| --- | --- |
| `scrobble` | 保存请求中的歌曲播放记录，接受播放时间参数 |
| `reportPlayback` | 更新播放状态和位置；仅 `stopped` 且未设置 `ignoreScrobble=true` 时记录播放历史 |
| `getNowPlaying` | 返回近期播放活动，可附带位置；并非对所有客户端的实时播放状态监测 |
| `getPlayQueue`、`savePlayQueue` | 按用户持久化播放队列 |
| `getPlayQueueByIndex`、`savePlayQueueByIndex` | 按索引读写队列；当前索引越界返回参数错误 |
| `getBookmarks`、`createBookmark`、`deleteBookmark` | 按用户持久化书签 |

## 转码与媒体限制

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `subsonic.transcode.enabled` | `false` | 服务端转码总开关 |
| `subsonic.transcode.format` | `mp3` | 目标格式，可选 `mp3`、`opus`、`aac` |
| `subsonic.transcode.maxConcurrent` | `2` | 同时转码任务上限 |

转码需要可用的 ffmpeg。`stream` / `download` 可结合客户端码率要求选择转码；`timeOffset` 使用秒。OpenSubsonic 的 `getTranscodeDecision` / `getTranscodeStream` 提供转码决策和签名参数。

ffmpeg 不可用时在线资源可降级为原始链接，不能保证原始格式符合客户端要求。目标格式、音源可用性和服务器资源均会影响播放结果。

## OpenSubsonic 扩展

`getOpenSubsonicExtensions` 声明以下扩展，版本均为 1：

| 扩展 | 对应能力 |
| --- | --- |
| `formPost` | 表单 POST 参数 |
| `songLyrics` | 结构化歌词 |
| `playbackReport` | 播放状态与位置上报 |
| `sonicSimilarity` | 相似曲目入口，使用启发式挑选 |
| `indexBasedQueue` | 按索引管理播放队列 |
| `transcodeOffset` | 转码时间偏移 |
| `transcoding` | 转码决策与转码流 |

声明扩展表示接口存在，客户端是否调用和展示仍取决于其实现。

## 不支持的范围

视频、播客、聊天、分享，以及通过 Subsonic 接口创建或修改服务器账号等功能不在当前实现范围。典型未支持方法包括 `getVideos`、`getPodcasts`、`getChatMessages`、`createShare`、`createUser`、`updateUser`、`deleteUser`、`changePassword` 和 `getAvatar`。

未支持的方法返回 `Method not found`。账号管理应使用后台管理页；客户端出现缺失控件或兼容问题时，应先核对本页能力范围与该客户端实际请求的方法。
