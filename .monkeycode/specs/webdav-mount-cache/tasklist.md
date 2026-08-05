# Tasklist: WebDAV 音乐挂载(边播边缓存 + 目录歌单)

## 任务

- [x] **1. 新模块 `src/server/webdavMount.ts` 基础框架**
  - 实现 WebDAVMount 类型与持久化（`webdav-mounts.json`：listMounts/getMount/addMount/updateMount/deleteMount）
  - `initClient`（动态 import webdav，URL 归一化）、`listFiles`（带 20s 超时）、`browse`
  - `testConnection`（列出 rootPath 验证连通）
  - 单元测试：持久化 CRUD、路径归一化、密码脱敏、删除清理缓存目录

- [x] **2. 目录浏览与音频索引**
  - `collectAudioFiles`（递归扫描，复用 openlist 防护参数：深度20/5000文件/800目录/60s/并发6）
  - `getLocalIndex`（TTL 120s 索引缓存）、`getAllLocalIndex`、`clearLocalIndex`
  - 条目映射 `source='webdav'`（含 id/songmid/url 内部流地址）
  - 单元测试：条目字段完整性、防护边界（深度/文件数/超时）、TTL 缓存命中

- [x] **3. 边播边缓存到本地**
  - `getCacheDir`/`getCacheFilePath`/`isFileCached`（`webdav-cache/<id>/` hash 命名）
  - `serveCacheFile`（复用 openlist 本地 Range 服务）
  - `stream`（原生 http/https 代理 + 递归跟随重定向，禁用 needle）
  - `streamToCache`（未命中缓存 + 全量请求时边播边写 .tmp，完整后 rename 落盘）
  - 缓存进度跟踪（trackCacheProgress/markCacheDone/getCacheProgress/clearCacheProgress）
  - 单元测试：缓存路径/hash、serveCacheFile Range 响应、进度状态机

- [x] **4. server.ts 新增 WebDAV 挂载路由**
  - `/api/webdav-mounts` GET/POST、`/:id` PUT/DELETE、`/:id/test` POST
  - `/:id/browse` GET、`/:id/local-list` GET、`/local-list` GET（合并）
  - `/api/webdav-mounts/stream` GET（本地缓存优先 + 边播边写，镜像 openlist stream）
  - `/cache/check` GET、`/cache/status` GET、`/cache/clear` POST
  - 管理员/播放器鉴权沿用现有模式
  - 冒烟验证通过：挂载 CRUD/脱敏、browse、索引 731 项、stream 边播边缓存(.tmp→rename)、二次 206 命中、cache/check/status/clear、断开清理 .tmp、DELETE/clear

- [x] **5. subsonic.ts handleStream 扩展**
  - 解析 source：`webdav_`/`openlist_`/`local` 走内部流分支
  - webdav：构造 `/api/webdav-mounts/stream` 302；openlist：`/api/openlist/stream` 302；local：缓存文件服务
  - 在线源（kw/kg/tx/wy/mg）逻辑保持不变
  - 新增 `resolveLocalStreamUrl`：从挂载索引匹配 serverId 构造内部流 URL

- [x] **6. 前端后台管理视图**
  - `public/index.html` 新增 `data-view="webdav-mounts"` 导航与视图（镜像 view-openlist）
  - `public/app.js` 新增挂载源 CRUD/测试逻辑（镜像 loadOpenList 系列）

- [x] **7. 前端播放器目录树与歌单收藏**
  - `public/music/js/local_music.js` 新增 WebDAV 挂载源目录树面板（镜像 ol* 方法）
  - `buildPlaylistSong` 增加 webdav 分支（豁免音源关联）
  - `addCurrentDirToPlaylist` 支持 webdav 目录；缓存进度徽标
  - `public/music/index.html` 新增 WebDAV 面板 + folder 筛选选项 webdav
  - `public/app.js`/`index.html` 后台管理视图
  - server.ts 主列表合并 webdav 索引条目（镜像 openlist 合并）

- [x] **8. 构建验证与文档更新**
  - `npx tsc --noEmit` 类型检查通过
  - 全量测试通过（webdavMount.test.ts 20 项全过）
  - 后台/播放器手工冒烟（挂载 CRUD、浏览、播放、缓存、歌单收藏、Subsonic 流）
    - Subsonic stream webdav_ → 302 `/api/webdav-mounts/stream`（可播放 200 audio/mpeg）
    - Subsonic stream openlist_ → 302 `/api/openlist/stream`（含 sign）
    - 主列表 `/api/music/cache/list` 合并 webdav 索引条目
  - 更新 `.monkeycode/docs/` 与 MEMORY.md；git 提交（待办）
