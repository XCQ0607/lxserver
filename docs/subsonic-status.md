# Subsonic 协议支持状态对照

> 范围：`src/server/subsonic.ts` 对 Subsonic REST API 的**自定义实现**对照表。
> 图例：✅ 已实现可用　🟡 占位（返回空 / no-op，兼容客户端握手）　❌ 未实现（返回 `Method not found`）
> 更新：2026-09-10（新增「每日推荐歌曲」接口，见文末）

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
| `setRating` | 评分 | ✅ | 评分按用户持久化（0-5，0=清除）；每日推荐会排除该用户评分为 1 的歌曲 |
| `scrobble` | 播放 | 🟡 | no-op（返回成功） |
| `getNowPlaying` | 播放 | 🟡 | 返回空列表 |
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
  - **评分过滤**：返回前按请求用户过滤——该用户评分为 1 分的歌曲不会进入每日推荐（`setRating` 设置）。
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
| `getIndexes` | 浏览 |
| `getVideos` | 媒体 |
| `getBookmarks` / `createBookmark` / `deleteBookmark` | 书签 |
| `getPlayQueue` / `savePlayQueue` | 播放队列 |
| `createUser` / `updateUser` / `deleteUser` / `changePassword` / `getAvatar` | 用户管理 |
| `getPodcasts` / `getNewestPodcasts` / `refreshPodcasts` 等播客系列 | 播客 |
| `getChatMessages` / `createChatMessage` | 聊天 |
| `createShare` / `getShares` / `deleteShare` | 分享 |
| `createInternetRadioStation` / `updateInternetRadioStation` / `deleteInternetRadioStation` | 电台管理 |

> 注：lx-server 定位是「个人音乐库桥接」，未实现多用户管理 / 播客 / 分享 / 聊天等协作类接口属预期范围。
