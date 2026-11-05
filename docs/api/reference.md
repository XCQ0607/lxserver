# 服务端 API 参考

LX Sync Server 提供了多种 RESTful 风格的 API 接口，用于自动化获取和操控同步服务器数据以及状态。

## 概述

为了确保安全性，API 要求进行鉴权。目前主要支持以下两种鉴权方式：

1. **管理员鉴权 (`x-frontend-auth`)**: 使用管理终端的全局口令（`admin.password`）。用于敏感的服务控制、用户管理及全局数据提取。
2. **用户 Token 鉴权 (`x-user-token`)**: 使用通过登录接口获取的动态 Session Token 或管理面板生成的持久化 API Token。用于操作特定用户的数据（如歌单、设置、缓存等）。

Web 播放器另有 `lx_player_session` Cookie，公开访问受播放器认证和公共权限配置控制。`x-user-name` 不能替代用户 Token；各路由的权限规则以其处理逻辑为准。

多数数据接口使用 JSON。媒体返回二进制，进度订阅可能使用 SSE，部分成功或错误响应为纯文本；调用方应检查 HTTP 状态和 Content-Type。

完整入口及直接读取的参数见 [当前路由索引](./routes.md)。

---

## 1. 认证与账户管理 API

### 1.1 管理员：服务状态 (`GET /api/status`)

获取同步服务器整体内存消耗、设备在线情况、运行时间汇总状态。

- **Header Auth**: `x-frontend-auth: <Admin Password>`

### 1.2 管理员：用户管理 (`/api/users`)

- **Header Auth**: `x-frontend-auth: <Admin Password>`
- `GET /api/users`: 获取所有用户列表及密码、权限配置。
- `POST /api/users`: 创建新用户 (`{"name": "...", "password": "..."}`)。
- `PUT /api/users`: 修改用户信息 (重命名、修改密码或权限) (`{"name": "...", "newName": "...", "password": "...", "enableCustomMusicDir": false, "customMusicDir": "...", "allowOperateCustomMusicDir": false, "allowWriteCustomMusicDir": false}`)。
- `DELETE /api/users`: 删除用户 (`{"names": ["..."], "deleteData": true}`)。

### 1.3 用户：登录获取 Token (`POST /api/user/login`)

使用用户名密码登录并颁发 Token。

- **Body**: `{"username": "...", "password": "..."}`
- **响应**: `{"success": true, "token": "lx_tk_...", "username": "..."}`

### 1.4 用户：登出 (`POST /api/user/logout`)

注销当前的 Session Token。

- **Header Auth**: `x-user-token: <Token>`

### 1.5 用户：认证有效性检查 (`GET /api/user/auth/verify`)

检查当前 Token 是否还有效。

- **Header Auth**: `x-user-token: <Token>`

---

## 2. Token 安全管理 API

用于在管理面板或客户端管理持久化的 API Token。要求使用 `x-user-token` 进行鉴权。

- `GET /api/user/token/config`: 获取当前用户的 Token 认证配置（是否开启及列表）。
- `POST /api/user/token/config`: 开启或关闭 Token 认证功能 (`{"enabled": true/false}`)。
- `POST /api/user/token/add`: 生成新的持久化 API Token (`{"name": "名称", "expireDays": 7}`)。
- `POST /api/user/token/remove`: 删除指定 Token (`{"token": "..."}`)。
- `POST /api/user/token/update`: 更新 Token 信息（名称、有效期）。
- `POST /api/user/token/toggle`: 禁用或启用某个已生成的 Token。
- `GET /api/user/token/logs`: 获取特定 Token 的审计/访问日志（需传入 `tokenMasked` 参数）。

---

## 3. 数据与同步 API

此类接口用于管理用户的核心同步数据。

### 3.1 歌单管理

- `GET /api/user/list`: 获取用户当前完整歌单数据。
- `POST /api/user/list`: 全量覆盖更新用户歌单数据（会触发同步广播）。
- `POST /api/music/user/list/remove`: 批量删除指定歌单中的歌曲 (`{"listId": "...", "songIds": [...]}`)。

### 3.2 历史快照 (Snapshot)

- `GET /api/data/snapshots`: 获取快照列表。
- `GET /api/data/snapshot`: 获取特定快照的数据。
- `POST /api/data/restore-snapshot`: 恢复到指定快照。
- `POST /api/data/delete-snapshot`: 删除特定快照。
- `POST /api/data/upload-snapshot`: 手动上传备份快照。

### 3.3 用户设置与音效

- `GET /api/user/settings`: 获取用户应用设置。
- `POST /api/user/settings`: 更新用户应用设置。
- `GET /api/user/sound-effects`: 获取用户均衡器/音效设置。
- `POST /api/user/sound-effects`: 更新用户音效设置。

---

## 4. 多媒体核心 API (Web Player 支持)

### 4.1 搜索与提示

- `GET /api/music/search`: 音乐搜索（支持 `kw`, `kg`, `tx`, `wy`, `mg`）。
- `GET /api/music/tipSearch`: 搜索关键词联想提示。
- `GET /api/music/hotSearch`: 各平台实时热搜榜单。

#### 搜索参数与返回格式

| 查询参数 | 说明 |
| --- | --- |
| `name` | 必填关键词，缺失返回 HTTP 400 文本 `Missing name` |
| `source` | `kw`（默认）、`kg`、`tx`、`wy`、`mg`；聚合搜索由前端分别请求各源，不支持 `source=all` |
| `type` | `song`（默认）、`singer`、`album`、`playlist`，支持情况取决于音源 |
| `page` | 默认 1；歌曲搜索仅在显式传入正数 `limit` 时用于上游分页 |
| `limit` | 歌曲：正数表示只取指定页，实际每页数量不超过该源上限；省略或非正数则从第一页连续拉取。其他类型默认每页 20 条 |

```http
GET /api/music/search?name=周杰伦&source=kw
GET /api/music/search?name=周杰伦&source=kw&page=2&limit=20
```

成功响应为对象，**不是裸数组**，调用方读取 `data.list`。以下仅展示结构，歌曲字段因音源而异：

```json
{
  "list": [],
  "total": 100,
  "allPage": 5,
  "pageSize": 20,
  "fetchedPages": 2,
  "stopReason": "single-page",
  "hasMore": true,
  "source": "kw"
}
```

- `total/allPage` 是平台自报值（缺失时后端回退计算），可能是估算值。实际收到的条数和本地分页应使用 `list.length`。
- `fetchedPages` 实际记录最后取回的上游页码；单页请求第 2 页时值为 2，不表示本次请求取了两页。
- 连续拉取在后续页请求前检查 60 页、4000 条、15 秒预算；条数和时间不是精确硬上限或 HTTP 超时。
- `stopReason`：`all-pages`、`single-page`、`empty-page`、`repeat-page`、`page-cap`、`page-wall`、`item-budget`、`time-budget`。
- `hasMore` 标识预算或页数墙等截断；单页模式仅按本页是否达到 `pageSize` 推断。空页、重复页或取完上游页数时为 false，不保证平台全部歌曲均已取到。
- 歌手、专辑、歌单搜索返回 `list,total,allPage,pageSize,fetchedPages,source`，不含 `hasMore/stopReason`。
- 不支持的音源/类型或第一页失败，返回 HTTP 500 与 `{ "error": "...", "code": 500 }`；后续页失败可能返回已有结果并标记 `page-wall`。

`GET /api/music/tipSearch` 使用 `name,source` 参数，返回提示数组；缺少关键词或上游失败时返回 `[]`。

### 4.2 广场与榜单

- `GET /api/music/songList/tags`: 获取歌单分类标签。
- `GET /api/music/songList/list`: 获取指定标签的精选歌单列表。
- `GET /api/music/songList/detail`: 获取歌单详情（完整歌曲列表）。
- `GET /api/music/leaderboard/boards`: 获取排行榜分类。
- `GET /api/music/leaderboard/list`: 获取排行榜内的歌曲。

### 4.3 播放与歌词

- `POST /api/music/url`: 获取音乐播放直链。
  - **Header Support**: 可选 `x-req-id` 用于 SSE 进度追踪。
  - **Progress**: 可通过 `GET /api/music/progress?reqId=xxx` 订阅 SSE 获取自定义源解析进度。
- `POST /api/music/lyric`: 获取歌词。
- `POST /api/music/comment`: 获取歌曲评论（支持 hot/new 类型）。

### 4.4 下载与转发 (`GET /api/music/download`)

代理下载音乐文件，支持自动注入 ID3 标签。

- **Params**: `url`, `filename`, `tag=1` (注入标签), `name`, `singer`, `album`, `pic`。

---

## 5. 服务端文件缓存 API

用户可以通过接口管理缓存在服务器上的音乐文件和歌词。

- `GET /api/music/cache/stats`: 获取当前用户的缓存统计（文件数、占用空间）。
- `GET /api/music/cache/list`: 获取详细的缓存文件列表。
- `POST /api/music/cache/download`: 触发服务器后台下载歌曲并缓存。
- `POST /api/music/cache/remove`: 删除指定的缓存文件。
- `POST /api/music/cache/clear`: 清理所有音乐缓存。
- `POST /api/music/cache/lyric`: 保存或读取歌词缓存。

### 5.1 自定义音乐目录与洗版 (`/api/music/custom/*`)

允许配置了 `enableCustomMusicDir` 的用户挂载并管理服务器上的本地音乐文件。

- `GET /api/music/custom/list`: 获取自定义目录歌曲列表。
- `POST /api/music/custom/sync`: 触发服务器重新扫描同步自定义目录数据。
- `GET /api/music/custom/file`: 获取单个音频文件流。
- `GET /api/music/custom/cover`: 获取音频内嵌封面图片流。
- `POST /api/music/custom/remove`: 删除音频文件及数据（要求用户开启 `allowOperateCustomMusicDir` 权限）。
- `POST /api/music/custom/link`: 手动关联并重写音频 ID3 标签信息（要求用户开启 `allowWriteCustomMusicDir` 权限）。
- `POST /api/music/custom/updateMetadata`: 批量抓取网上元数据并覆写本地文件（要求用户开启 `allowWriteCustomMusicDir` 权限）。
- `POST /api/music/custom/embedLyric`: 批量将歌词写入本地文件 USLT 标签中（要求用户开启 `allowWriteCustomMusicDir` 权限）。
- `POST /api/music/remaster/start`: 启动音质替换下载任务（自定义目录要求 `allowOperateCustomMusicDir`）。`targetQuality` 与非空 `filenames` 数组必填，单次最多 10000 个文件；`isCustomDir` 用于明确目录类型。不是本地编码转码接口。

---

## 6. 自定义源管理 API

- `GET /api/custom-source/list`: 获取已导入的自定义源列表。
- `POST /api/custom-source/import`: 在线导入自定义源脚本。
- `POST /api/custom-source/upload`: 上传本地脚本文件。
- `POST /api/custom-source/toggle`: 启用或禁用某个源。
- `POST /api/custom-source/delete`: 删除自定义源。
- `POST /api/custom-source/reorder`: 对自定义源进行排序。

---

## 7. 全局系统配置 API (管理员权限)

用于管理后台对服务器核心行为的实时调整。要求 `x-frontend-auth` 鉴权。

- `GET /api/config`: 获取服务器当前的所有可配置项（含环境变量覆盖后的最终值）。
- `POST /api/config`: 增量更新全局配置。
  - **支持配置项**: 包括 `admin.path`, `player.path`, `subsonic.enableDebug`, `subsonic.onlineSearch`, `subsonic.onlineSearchMode`, `subsonic.onlineSearchSources`, `subsonic.lyricTranslation`, `artist.maxFetchPages`, `cache.namingPattern`, `system.allowUnsafeVM` 等。
  - **参数示例**: `{"admin.path": "/admin", "player.path": "", "subsonic.enableDebug": false}`
  - **路径校验规则**: `admin.path` 与 `player.path` 必须以 `/` 开头或为空字符串，两者不能冲突相同且不能以 `/api` 开头。
- `POST /api/admin/reload`: 重新加载服务器 `config.js` 与 `users.json` 数据及用户自定义音源 API。
- `POST /api/restart`: 安全重启服务器进程。

---

## 8. Web 播放器专属 API

专为 Web 播放器前端逻辑设计的接口，支持基于 Session 的访问。

### 8.1 基础配置与认证
- `GET /api/music/config`: **公开接口**，获取 Web 播放器的运行状态及基础路径配置。
  - **响应示例**: `{"admin.path": "/admin", "player.path": "", "player.enableAuth": false, "user.enablePublicRestriction": true}`
- `POST /api/music/auth`: 校验访问密码，成功后下发 `lx_player_session` HttpOnly Cookie。
- `POST /api/music/auth/logout`: 彻底注销当前的 Session 会话。
- `GET /api/music/auth/verify`: 检查当前 Session 是否依然有效。

### 8.2 增强元数据详情
- `GET /api/music/artistDetail`: 获取歌手精美详情。
  - **Params**: `source` (tx/wy), `id` (歌手Mid/ID)。
  - **Return**: 含 `name`, `desc`, `avatar`, `fans` 等。
- `GET /api/music/artistAlbums`: 分页获取歌手的专辑列表。
- `GET /api/music/artistSongs`: 服务端连续拉取歌手歌曲并返回数组，受 `artist.maxFetchPages` 限制（默认 20 页，每页 100 条），不保证取满。
- `GET /api/music/albumSongs`: 获取指定专辑内的所有音轨详情。

### 8.3 实时进度 (SSE)
- `GET /api/music/progress?reqId=xxx`: 通过 Server-Sent Events (SSE) 实时订阅外链解析、缓存进度等流式信息。


## 9. VueFinder 文件管理接口（管理员）

当前处理器为 `src/server/integrations/fileManager.ts`，旧 ElFinder connector 以及 PUT/DELETE `/api/files` 调用方式已不适用。操作使用 `x-frontend-auth`；仅媒体 GET/HEAD 还可使用 `POST /api/files/session` 签发的一小时 HttpOnly `lx_files` Cookie，服务器重启后失效。

使用虚拟路径：`root://` 为服务运行目录，`data://` 为数据目录，不接受主机绝对路径。

| 方法 / 路径 | 参数 / 行为 |
| --- | --- |
| `POST /api/files/session` | 签发媒体 Cookie，返回存储列表与上传限制 |
| `GET /api/files` | 查询 `path=root://`；返回 `storages,dirname,files,read_only` |
| `GET /api/files/search` | 查询 `path,filter,deep=1,size=all/small/medium/large` |
| `GET/HEAD /api/files/preview`, `GET/HEAD /api/files/download`, `GET/HEAD /api/files/thumbnail` | 查询 `path`；预览与下载支持 Range，缩略图返回 WebP |
| `POST /api/files/upload` | multipart/form-data：`path`、文件、可选 `overwrite=1`；单文件上限 1 GiB |
| `POST /api/files/create-file`, `POST /api/files/create-folder` | JSON path, name |
| `POST /api/files/rename` | JSON path, item, name |
| `POST /api/files/delete` | JSON path, items:[{path:"data://example.txt"}] |
| `POST /api/files/copy`, `POST /api/files/move` | JSON destination, sources:["data://example.txt"] |
| `POST /api/files/save` | JSON `path,content`；仅支持 8 MiB 内文本 |
| `POST /api/files/archive` | JSON `destination`（或 `path`）、`name`、`items:[{path:"data://example.txt"}]`；创建 ZIP |
| `POST /api/files/unarchive` | JSON `destination`（或 `path`）、`item`（ZIP 虚拟路径）；解压 ZIP |

错误返回对应 HTTP 状态及 `{"message":"..."}`。

## 10. 自动匹配与歌单排序

- `POST /api/music/user/list/reorder`：用户 Token 鉴权；JSON `listId,orderedSongIds`，未列出的歌曲追加到末尾，成功返回文本。
- `GET /api/music/auto-link/candidates?custom=true`：获取自定义目录候选；省略 custom 使用缓存目录。
- `POST /api/music/auto-link/start`：JSON `keys,sources,custom,concurrency`；查询参数 `browseLocation` 指定本次浏览位置，自定义目录写入需要 `allowWriteCustomMusicDir`。
- `GET /api/music/auto-link/status?offset=0&limit=200`、`POST /api/music/auto-link/cancel`：查看或取消自动匹配。
- 自动匹配要求用户 Token；成功响应 `{ "success": true, "data": ... }`，业务错误返回 HTTP 400 与 `{ "success": false, "message": "..." }`。
- 洗版另支持 `GET /api/music/remaster/status?offset=0&limit=200`、`POST /api/music/remaster/cancel`；启动参数为 `targetQuality,filenames,isCustomDir`。

其余缓存、下载队列、同步下载、后台任务、备份与管理接口见 [当前路由索引](./routes.md)。

## 11. 缓存目录、下载队列与后台任务

缓存接口根据用户身份及公共缓存权限决定是否允许操作；不能把管理员鉴权头当作所有用户端点的通用凭据。

| 接口 | 用途 / 主要参数 |
| --- | --- |
| `POST /api/music/cache/config` | 设置 `location`（root/data）和 `namingPattern`；具名用户需要身份验证，公共用户及全局命名配置受管理员权限约束 |
| `GET /api/music/cache/directories` | 获取当前目录信息 |
| `POST /api/music/cache/sync` | 重新扫描缓存索引 |
| `GET /api/music/cache/subdirs` | 列出缓存子目录 |
| `POST /api/music/cache/mkdir`、`POST /api/music/cache/categorize` | 创建子目录、分类移动 |
| `POST /api/music/cache/subdirs/rename`、`POST /api/music/cache/subdirs/delete` | 子目录重命名、删除 |
| `POST /api/music/cache/rename`、`POST /api/music/cache/move`、`POST /api/music/cache/switch-base` | 文件重命名、移动与存储位置切换 |
| `GET /api/music/cache/check`、`GET /api/music/cache/cover` | 检查缓存、读取封面 |
| `GET /api/music/cache/queue` | 获取服务端持久下载队列 |
| `POST /api/music/cache/queue` | 入队：`tasks` 数组，可选 `concurrency,namingPattern`；全局命名修改需要管理员权限 |
| `POST /api/music/cache/queue/concurrency` | 调整队列并发 |
| `POST /api/music/cache/queue/resume`、`POST /api/music/cache/queue/remove` | 恢复或移除队列任务 |
| `POST /api/music/cache/stop`、`GET /api/music/cache/progress` | 停止下载、查询进度 |
| `GET /api/music/cache/lyric`、`POST /api/music/cache/lyric` | 读取、保存歌词缓存 |
| `POST /api/music/cache/lyric/clear` | 清空歌词缓存 |
| `GET /api/music/cache/lyric/orphans`、`POST /api/music/cache/lyric/orphans/delete` | 查找与删除孤立歌词 |
| `POST /api/music/cache/link`、`POST /api/music/cache/updateMetadata` | 手动关联、更新元数据 |
| `GET /api/music/cache/embedLyric`、`POST /api/music/cache/embedLyric` | 查看歌词嵌入状态、执行嵌入 |
| `GET /api/music/custom/embedLyric` | 查看自定义目录歌词嵌入状态 |
| `POST /api/music/identify` | 识别本地音频 |
| `POST /api/music/quality/size` | 探测音质文件大小 |

### 同步下载

- `GET /api/user/sync-download/status`：同步状态及配置。
- `PUT /api/user/sync-download/settings`：更新同步下载设置。
- `POST /api/user/sync-download/trigger`：手动启动。
- `POST /api/user/sync-download/cancel`、`POST /api/user/sync-download/pause`：取消或暂停。
- `GET /api/user/sync-download/progress`：查询同步进度。
- `POST /api/user/sync-download/migrate-storage`：迁移同步下载存储。

### 定时任务

- `GET /api/tasks/status`：任务状态，别名 `/api/music/tasks/status`。
- `POST /api/tasks/trigger?id=network_list_autocheck`：手动触发；同步下载可使用 `id=sync_download_task`，别名 `/api/music/tasks/trigger`。
- `GET /api/tasks/user-data?task=network_list_autocheck`：读取任务通知状态；POST 请求体 `listId` 清除指定歌单更新标记。
- `GET /api/tasks/user-data?task=sync_download_task`：读取同步下载数据；POST 请求体 `{ "action": "trigger" }` 可触发同步。
- user-data 另有 `/api/music/tasks/user-data` 别名。任务临时用户数据在重启后清除，不能作为持久化历史。

## 12. 收藏、音源与运维补充

- `GET/POST /api/user/library/artists`、`GET/POST /api/user/library/albums`：读取或覆盖收藏歌手、专辑。
- `GET/POST /api/user/dislike/library/artists`、`GET/POST /api/user/dislike/library/albums`：读取或更新不喜欢的歌手、专辑。
- `GET /api/music/dislike`、`POST /api/music/dislike/add`、`POST /api/music/dislike/remove`：读取、添加、删除不喜欢规则。
- `GET /api/music/songList/search`、`GET /api/music/songList/userPlaylist`：搜索平台歌单、读取平台用户公开歌单。
- `POST /api/custom-source/validate`、`POST /api/custom-source/update`、`POST /api/custom-source/update-platforms`：验证、更新源脚本及平台映射。
- `POST /api/login`、`POST /api/admin/verify`：验证管理员密码；不替代后续操作所需的鉴权头。
- `GET /api/config/backups`、`POST /api/config/backup-now`、`GET /api/config/backups/download`、`DELETE /api/config/backups/<filename>`、`POST /api/config/backups/restore`：配置备份管理。
- `POST /api/config/test-proxy`：测试代理；`GET /api/logs`、`GET /api/stats`：日志与统计。
- `GET /api/backup/download`、`POST /api/backup/upload`：导出、导入数据备份。
- `POST /api/webdav/test`、`POST /api/webdav/sync`、`POST /api/webdav/sync-file`：测试连接、完整同步、单文件同步。
- `POST /api/webdav/backup`、`GET /api/webdav/backups`、`DELETE /api/webdav/backup`、`POST /api/webdav/restore`：远程备份管理。
- `GET /api/webdav/logs`、`GET /api/webdav/progress`：同步日志与 SSE 进度。

Subsonic 的协议范围与本地库行为另见 [本地音乐库说明](../subsonic-local-library.md) 和 [协议状态](../subsonic-status.md)。
