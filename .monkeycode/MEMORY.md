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
