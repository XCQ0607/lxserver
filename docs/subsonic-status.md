# Subsonic 协议支持状态对照

> 范围：`src/server/subsonic.ts` 对 Subsonic REST API 的**自定义实现**对照表。
> 图例：✅ 已实现可用　🟡 占位（返回空 / no-op，兼容客户端握手）　❌ 未实现（返回 `Method not found`）
> 更新：2026-09-19（协议补全：专辑信息 / 播放上报 / 书签 / 播放队列 / 相似歌曲 / 转码，见第四节）

---

## 一、已实现 / 可用接口

| 方法 (method) | 类别 | 状态 | 说明 |
|---|---|---|---|
| `ping` | 系统 | ✅ | 握手 / 存活检测 |
| `getLicense` | 系统 | ✅ | 许可信息 |
| `getScanStatus` | 系统 | 🟡 | 固定返回 `scanning:false` |
| `getMusicFolders` | 浏览 | ✅ | 单一音乐库 |
| `getMusicDirectory` | 浏览 | ✅ | 专辑 / 歌单 / 歌手目录 |
| `getGenres` | 浏览 | ✅ | 流派（来自 QQ 音乐 discovery） |
| `getArtists` | 浏览 | ✅ | 按字母索引的歌手 |
| `getArtist` | 浏览 | ✅ | 歌手详情 |
| `getArtistInfo` / `getArtistInfo2` | 浏览 | ✅ | 歌手信息 |
| `getAlbum` | 浏览 | ✅ | 专辑详情（含歌曲列表） |
| `getAlbumList` / `getAlbumList2` | 浏览 | ✅ | 含 `recommend`/`random`/`newest`/`recent` 推荐专辑逻辑 |
| `getStarred` / `getStarred2` | 浏览 | ✅ | 收藏 |
| `getSong` | 媒体 | ✅ | 单曲信息 |
| `stream` / `download` | 媒体 | ✅ | 在线音频流（按 `source_songmid` 解析） |
| `getCoverArt` | 媒体 | ✅ | 封面代理 |
| `getUser` | 用户 | ✅ | 当前用户 |
| `search` / `search2` / `search3` | 搜索 | ✅ | 本地 + 在线全网搜索 |
| `getPlaylists` / `getPlaylist` | 歌单 | ✅ | |
| `createPlaylist` / `updatePlaylist` / `deletePlaylist` | 歌单 | ✅ | |
| `star` / `unstar` | 收藏 | ✅ | |
| `setRating` | 评分 | ✅ | 评分按用户持久化（0-5，0=清除）；每日推荐会排除评分落入「不喜欢」阈值（`subsonic.dislikeRating`，默认 1）的歌曲 |
| `scrobble` | 播放 | ✅ | 写入播放历史；按规范仅 `stopped` 且未带 `ignoreScrobble` 时记录 |
| `getNowPlaying` | 播放 | ✅ | 返回正在播放列表，条目带 `positionMs` |
| `getLyrics` / `getLyricsBySongId` | 歌词 | ✅ | |
| `getOpenSubsonicExtensions` | 扩展 | ✅ | |
| `getRandomSongs` | 发现 | ✅ | 本地库随机 / 流派随机 |
| `getSongsByGenre` / `getSongsByGenre2` | 发现 | ✅ | 按流派拉取云端歌曲 |
| `getSimilarSongs` / `getSimilarSongs2` | 发现 | ✅ | 同歌手相似 |
| `getTopSongs` | 发现 | ✅ | 歌手热门 |
| `getInternetRadioStations` | 电台 | ✅ | QQ 音乐电台 |
| **`getRecommendedSongs`** | **发现（新增）** | ✅ | **每日推荐歌曲（见第二节）** |
| **`getDailySongs`** | **发现（新增）** | ✅ | **`getRecommendedSongs` 的别名** |
| **`getSongsByTag`** | **发现（新增）** | ✅ | **别名，同样映射为每日推荐**（lx-server 未实现独立按标签检索） |

---

## 二、新增：每日推荐歌曲（2026-09-10 实现）

### 背景
此前代码里**完全没有**歌曲级「每日推荐」接口（`getRecommendedSongs` / `getDailySongs` / `getSongsByTag` / `DailySongs` 在 `subsonic.ts` 中均为空，走 default 分支返回 `Method not found`）。仅 `getAlbumList2` 带有「推荐专辑」逻辑（`cachedRecommend → fetchRecommendedAlbums`，专辑级）。

### 实现
- 新增数据源 `src/server/utils/recommendSongs.ts`：`fetchRecommendedSongs(size)`
  - 复用已验证的 `fetchRecommendedAlbums('random')` 拿推荐专辑；
  - 逐张调用 `musicSdk.tx.extendDetail.getAlbumSongs(mid)` 取出专辑内歌曲；
  - 按 `tx_<songmid>` 去重，按「自然日」做种子洗牌（当天稳定、跨天换批），返回可直接播放的在线歌曲。
  - 全程公开接口、无需登录；QQ 抓取失败时回退到上次成功结果，避免每日推荐空白。
  - **评分过滤**：返回前按请求用户过滤——评分落入「不喜欢」区间（`0 < rating <= subsonic.dislikeRating`，默认阈值为 1，可配置）的歌曲不会进入每日推荐（`setRating` 设置）。
- `subsonic.ts` 分发开关新增 `case 'getRecommendedSongs' / 'getDailySongs' / 'getSongsByTag'`，handler `handleGetRecommendedSongs` 复用 `renderRandomSongs` 输出（与 `getRandomSongs`/`getSongsByGenre` 同一条渲染链路，封面 / 播放均正常）。

### 调用示例
```
GET /rest/getRecommendedSongs?u=<user>&p=<pass>&f=json&size=20
GET /rest/getDailySongs?u=<user>&p=<pass>&f=json
```
返回结构：`{ recommendedSongs: { song: [ ... ] } }`（XML 下为 `recommendedSongs > children > song`）。

---

## 三、未实现（官方标准方法，当前返回 `Method not found`）

| 方法 | 类别 |
|---|---|
| `getVideos` | 媒体 |
| `createUser` / `updateUser` / `deleteUser` / `changePassword` / `getAvatar` | 用户管理 |
| `getPodcasts` / `getNewestPodcasts` / `refreshPodcasts` 等播客系列 | 播客 |
| `getChatMessages` / `createChatMessage` | 聊天 |
| `createShare` / `getShares` / `deleteShare` | 分享 |
| `createInternetRadioStation` / `updateInternetRadioStation` / `deleteInternetRadioStation` | 电台管理 |

> 注：lx-server 定位是「个人音乐库桥接」，未实现多用户管理 / 播客 / 分享 / 聊天等协作类接口属预期范围。

---

## 四、2026-09-19 协议补全（本轮新增）

补齐以下官方 / OpenSubsonic 方法（此前均走 default 分支返回 `Method not found`）：

| 方法 | 类别 | 说明 |
|---|---|---|
| `getIndexes` | 浏览 | 艺术家按拼音首字母索引分组 |
| `getAlbumInfo` / `getAlbumInfo2` | 浏览 | 专辑介绍（`notes`）+ 封面 URL；构造不出平台直链时回退歌曲自带封面 |
| `reportPlayback` | 播放 | OpenSubsonic `playbackReport` 扩展；仅 `stopped` 且未带 `ignoreScrobble` 时写入播放历史 |
| `getPlayQueue` / `savePlayQueue` | 播放队列 | 按用户持久化；`current` 指向的歌曲缺失时按列表兜底 |
| `getPlayQueueByIndex` / `savePlayQueueByIndex` | 播放队列 | OpenSubsonic `indexBasedQueue` 扩展；`currentIndex` 越界返回错误码 10 |
| `getBookmarks` / `createBookmark` / `deleteBookmark` | 书签 | 按用户落盘持久化 |
| `getSonicSimilarTracks` | 发现 | OpenSubsonic `sonicSimilarity` 扩展；复用同歌手相似歌挑选逻辑（排序分，非声学分析） |
| `getTranscodeDecision` / `getTranscodeStream` | 转码 | OpenSubsonic `transcoding` 扩展；下发签名 `transcodeParams`，服务端 ffmpeg 流式转码 |

配套变更：

- `scrobble` 由 no-op 改为写入播放历史，`getNowPlaying` 返回正在播放列表（条目带 `positionMs`）。
- `stream` / `download` 支持 OpenSubsonic `transcodeOffset`：`timeOffset`（秒）作为 ffmpeg 快速定位（`-ss` 置于 `-i` 之前）。
- `getOpenSubsonicExtensions` 改为声明**实际实现**的扩展名：`formPost`、`songLyrics`、`playbackReport`、`sonicSimilarity`、`indexBasedQueue`、`transcodeOffset`、`transcoding`。此前的 `coverArtScaling` / `thumbnails` / `lyrics` 并非官方扩展名，客户端据此永远不会调用 `getLyricsBySongId`；封面缩放仍通过 `getCoverArt` 的 `size` 参数生效。
- 服务端转码：`ffmpeg` 可用性探测（缺失时降级 302 直链）、并发信号量（`subsonic.transcode.maxConcurrent`）、目标格式（`subsonic.transcode.format`），并在 `handleStream` 中按客户端 `maxBitrate` 决定是否转码。
- `search3` 补齐在线歌手 / 专辑搜索（此前只查本地库，未收藏时恒为空）；歌手寻址改为相似度匹配（失败短缓存 + 诊断日志）；跨源同名歌手合并与去重；简繁双向搜索（新增 `src/server/utils/zhConvert.ts`）。
- 协议根元素、参数截断与封面尺寸修正；共享歌单支持「排行榜 / 歌单 / 都要」三态配置（`subsonic.sharedListMode`、`subsonic.sharedListSort`）。
