# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-08-01
- Context: Discovered by Agent while building and deploying lxserver music sync server
- Category: Operations & Deployment
- Instructions:
  - Build: `npm run build`（prebuild 会自动下载 fpcalc 二进制并更新 build hash 到 config.js）
  - Start: `npm start`，服务器监听 `0.0.0.0:9527`；开发时用 background terminal 启动，避免阻塞
  - 管理员后台入口 `/`，前端密码（`frontend.password`）默认 `123456`；用户密码登录播放器
  - 测试账号：admin/password（管理员）、testuser/123456；管理员鉴权头 `X-Frontend-Auth: <frontend.password>`
  - 强制登录开启时（player.forceLogin），播放器静态资源未登录会 302 到 `/music/login`；登录接口 `/api/user/login` 同时下发 `lx_player_session` 与 user token cookie
  - 卡密与阿里云盘配置分别持久化在 dataPath 下的 `cards.json`、`alidrive.json`，需配置 ClientID/ClientSecret 并在后台扫码绑定后才能使用云盘功能

[Project Knowledge Summary]
- Date: 2026-08-03
- Context: Discovered by Agent while fixing OpenList 播放卡死问题
- Category: Troubleshooting & Debugging
- Instructions:
  - **needle 3.x 流式下载 bug**：`needle.get()` 在响应约 130KB（130896 字节）后会卡死不再输出数据，导致 `openlist.stream` 代理播放几秒就卡死。修复：改用 Node 原生 `http/https.request`（`src/server/openlist.ts` 的 `stream` 函数）。任何新的流式代理代码禁止使用 needle 转发大文件。
  - OpenList 播放已支持"边播边缓存"：首次播放把数据同时写入 `<dataPath>/openlist-cache/<serverId>/<hash>.ext`，完整后 rename 落盘，之后播放/拖拽直接读本地（秒开）。缓存状态接口：`/api/openlist/cache/check`（单文件）、`/api/openlist/cache/status`（汇总）、`/api/openlist/cache/clear`（管理员）。前端 openlist_manager 会显示"已缓存/缓存中"徽标。
  - 真实 OpenList 上游速度实测约 360KB/s-1.3MB/s（此前 needle 卡死误判为上游限速 4KB/s），足够流畅播放。
  - config.js 含真实凭据，不进入 git 提交；NAS 部署用 `scripts/migrate-to-nas.sh` 生成清洗后的部署包。
  - OpenList `/d/` 直链会 302 到对象存储/CDN（如阿里云盘 OSS 签名 URL），代理必须服务端跟随重定向（最多 5 跳），否则播放器拿到无 Location 的 302 无法播放。OSS 签名 URL 可直接访问，无需转发 Authorization。
  - 远程目录树扫描必须加防护：单目录 listFiles 加 20s 超时（needle 对超大目录可能永久挂起）、整体 60s 截止、目录数上限 800、子目录并发 6，否则真实 OpenList（含大量网盘挂载）递归扫描会把进程拖死。
  - 本地音乐整合 OpenList：`/api/openlist/local-list?server=&refresh=` 递归扫描生成索引（TTL 120s）；`/api/music/cache/list` 后端合并 folder='openlist' 条目；前端 local_music.js 过滤 tab 加 openlist 选项，内嵌目录树面板（`lm-ol-*` 元素 + LocalMusicManager.ol* 方法），收藏走 openlist 字段（url/serverId/path/sign）恢复播放。

[Project Knowledge Summary]
- Date: 2026-08-05
- Context: Discovered by Agent while implementing WebDAV 音乐挂载功能（边播边缓存+目录歌单）
- Category: Build Methods / Troubleshooting & Debugging
- Instructions:
  - 测试框架：node:test + `npx tsx --test <file>`（项目无 vitest/jest）；mock WebDAV 服务器须注意 PROPFIND 目录 key 去尾部斜杠归一化、响应过滤 `.`/`..`、GET 支持 Range。
  - 新增 `src/server/webdavMount.ts`（挂载源 CRUD 持久化 webdav-mounts.json、密码脱敏 hasPassword、目录扫描防护同 openlist、边播边缓存 .tmp->rename、本地 Range 206/416）；`subsonic.ts handleStream` 对 webdav_/openlist_/local source 走内部流 302，由内部流路由统一承担缓存优先（避免重复实现）。
  - `stream` 返回同步 ClientRequest，server.ts 路由用 try/catch 包裹而非 `.then()`（误用 `.then` 会 TS2339）。
  - 服务启动时 config.js 的 webdav.* 备份 restore 会阻塞监听（当前环境 host.docker.internal 不可达，需等网络超时约 2-3 分钟才完成启动）；冒烟测试前先 curl 首页确认 200。
  - 构建/推送镜像：`docker build -t lxserver:webdav . && docker tag ... ghcr.io/boy6656598/lxserver:latest && docker push`；容器内产物路径为 `/server/server/server/*.js`（根目录是 `/server` 非 `/app`）。

[Project Knowledge Summary]
- Date: 2026-08-09
- Context: Discovered by Agent while implementing 挂载歌曲同目录 .lrc 歌词读取（Subsonic getLyricsBySongId）
- Category: Troubleshooting & Debugging
- Instructions:
  - needle 3.x 始终将 body 解码为 string（即使 `decode_response:false`/`output:buffer`），GBK 编码的 .lrc 经 needle 读取后字节已损坏为 U+FFFD，无法恢复。读取远端歌词/文本必须用原生 `http/https.get` 拿原始 Buffer（openlist.ts 的 `httpGetBuffer`）。
  - 远端 .lrc 常见 GBK/GB18030 编码；解码策略：先 `new TextDecoder('utf-8',{fatal:true})` 严格解码，异常或含 `\uFFFD` 则回退 `new TextDecoder('gb18030')`（本环境 Node 22 full ICU 可用）。
  - Subsonic 歌词端点：`handleGetLyricsBySongId` 对 `webdav`/`openlist` 源不查在线 SDK（musicSdk 无此二源，会返回错误 70），改为读歌曲同目录同名 .lrc；`resolveMountedLyric` 先按索引匹配、失败再兜底解析歌单固化 url 的 server/path/sign，多候选路径逐个尝试。
  - webdav 索引 path 为相对 baseUrl 的路径（baseUrl 已指向挂载根）；openlist 索引 path 为含 rootPath 的完整 fs 路径，二者语义不同。
