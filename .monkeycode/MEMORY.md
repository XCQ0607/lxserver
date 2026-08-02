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
