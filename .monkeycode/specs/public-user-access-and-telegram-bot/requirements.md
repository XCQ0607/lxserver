# 需求文档：对外开放用户注册与 TG 机器人（卡密注册 / 有效期 / 封禁 / 歌单下载）

## Introduction

本项目为 lx-music-sync-server。当前已具备：卡密生成与消耗注册（`/api/auth/register`）、用户管理后台（`/api/users`）、服务器下载队列（`serverDownloadQueue`）、本地音乐索引（`music_index.json`）、用户收藏歌单（`ListManage`）。本需求将其扩展为"对外开放注册"的产品形态：

- Web 播放端仅管理员可登录进入，普通注册用户被拒绝。
- 账号按使用时间授权（7 天 / 30 天 / 365 天 / 永久），管理后台可查看与设置。
- 每个 30 天周期内累计活跃超过 5 分钟自动续期 30 天；管理后台可手动续期。
- 记录用户活跃使用时间，超过可配置天数无活跃自动封禁。
- 普通用户仅能通过 TG 机器人完成：卡密注册、修改密码、获取线路（连接信息）、发送歌单。
- TG 机器人收到歌单（文本 / LX JSON / 平台链接三种格式），对比全服务器本地曲库，缺失歌曲自动加入下载队列，并为该用户生成/更新单独的收藏歌单。

## Glossary

- **管理员**：通过 `frontend.password`（`X-Frontend-Auth`）访问管理后台与 Web 播放端的角色。
- **普通用户（注册用户）**：通过卡密注册获得账号的用户，可通过 Subsonic 客户端与 TG 机器人使用服务。
- **有效期（expireAt）**：账号可用截止时间戳。永久账号该值为空。
- **永久账号**：`expireAt` 为空，不参与续期与封禁。
- **活跃（activity）**：用户任意使用行为（Web 播放端请求、Subsonic 请求、本地播放、TG 交互）触发一次活跃刷新，更新 `lastActiveAt` 并累加活跃时长。
- **活跃续期**：每个 30 天周期内累计活跃时长 ≥ 5 分钟，到期时自动延长 30 天。
- **自动封禁**：超过 N 天（管理后台可配置，0 表示关闭）无活跃记录，系统自动置为封禁状态。
- **线路（connection info）**：服务器对外连接参数（Subsonic 地址、WebDAV 地址、用户名等），供用户配置客户端。
- **TG 机器人**：本系统新增的 Telegram Bot，为普通用户提供注册/改密/线路/歌单服务。
- **本地曲库**：服务器上所有用户已下载音乐文件的全量集合（按 `/music/<username>/` 落盘，由 `music_index.json` 索引），本需求中歌单对比针对全服务器曲库。
- **歌单**：用户通过 TG 发送的歌曲集合，支持三种格式：文本（每行`歌手 - 歌名`）、LX Music JSON 歌单、平台（网易云/QQ 等）歌单链接。

## Requirements

### R1. Web 播放端访问控制

**User Story:** AS 管理员，I want 普通用户无法登录 Web 播放端与后台，SO THAT 播放端仅对管理员开放。

#### Acceptance Criteria

1. WHEN 普通注册用户调用播放端登录接口（用户名/密码），THEN 系统 SHALL 拒绝登录并提示"仅管理员可用"。
2. WHEN 管理员使用后台密码（`frontend.password`）登录 Web 播放端，THEN 系统 SHALL 允许进入并正常使用播放功能。
3. WHEN 普通用户访问管理后台 API，THEN 系统 SHALL 返回 401（沿用现有 `x-frontend-auth` 校验）。
4. WHEN 未开启 `player.enableAuth` 且未开启 `player.forceLogin`，THEN 系统 SHALL 保持现有"直接放行"行为。

### R2. 用户有效期管理

**User Story:** AS 管理员，I want 为每个用户设置可使用时间（7/30/365/永久），SO THAT 控制账号授权时长。

#### Acceptance Criteria

1. WHEN 用户通过卡密注册，THEN 系统 SHALL 依据卡密 `expireDays` 设置账号初始 `expireAt`（`now + expireDays`，永久卡 `expireAt = null`）。
2. WHEN 管理后台为某用户设置时长为 7/30/365 天，THEN 系统 SHALL 将 `expireAt` 更新为 `now + 对应天数`。
3. WHEN 管理后台为某用户设置"永久"，THEN 系统 SHALL 将 `expireAt` 置为空。
4. WHEN 用户的 `expireAt` 已过期，THEN 系统 SHALL 在播放端、Subsonic、TG 三入口同步拒绝该用户使用，并提示"账号已到期"。

### R3. 活跃续期与手动续期

**User Story:** AS 普通用户，I want 账号到期前只要保持活跃即可自动续期，SO THAT 正常使用的用户不会被中断。

#### Acceptance Criteria

1. WHEN 一个 30 天周期内该用户累计活跃时长 ≥ 5 分钟，THEN 系统 SHALL 在其到期时将 `expireAt` 延长 30 天并清零该周期累计活跃时长。
2. WHEN 用户为永久账号，THEN 系统 SHALL 跳过续期判定。
3. WHEN 管理后台点击"手动续期"，THEN 系统 SHALL 将 `expireAt` 延长 30 天（永久账号不适用）。

### R4. 活跃时间记录与展示

**User Story:** AS 管理员，I want 查看每个用户的活跃使用时间，SO THAT 了解用户使用情况。

#### Acceptance Criteria

1. WHEN 用户发生任意活跃行为，THEN 系统 SHALL 更新该用户 `lastActiveAt` 并累加当前周期活跃秒数。
2. WHEN 管理后台打开用户管理页，THEN 系统 SHALL 展示每个用户的 `expireAt`（或"永久"）、`lastActiveAt`、本周期累计活跃时长与封禁状态。
3. WHEN 管理后台请求用户详情，THEN 系统 SHALL 返回上述字段。

### R5. 无活跃自动封禁

**User Story:** AS 管理员，I want 超过指定天数无活跃的账号被自动封禁，SO THAT 清理僵尸账号。

#### Acceptance Criteria

1. WHEN 管理后台配置封禁阈值 N 天（0 表示关闭），THEN 系统 SHALL 按该阈值执行自动封禁扫描。
2. WHEN 定时扫描发现非永久用户 `now - lastActiveAt > N 天`，THEN 系统 SHALL 将该用户置为封禁状态。
3. WHEN 封禁用户尝试使用任一入口（播放端/Subsonic/TG），THEN 系统 SHALL 拒绝并提示"账号已被封禁"。
4. WHEN 管理后台对封禁用户执行"解封"，THEN 系统 SHALL 清除封禁状态并刷新 `lastActiveAt`。

### R6. TG 机器人：卡密注册

**User Story:** AS 普通用户，I want 通过 TG 机器人使用卡密注册，SO THAT 无需访问 Web 页面。

#### Acceptance Criteria

1. WHEN 用户在 TG 中发送 `/register <用户名> <密码> <卡密>`，THEN 机器人 SHALL 校验用户名格式、密码长度与卡密有效性，并创建账号（与 `/api/auth/register` 一致）。
2. WHEN 注册成功，THEN 机器人 SHALL 将 TG 用户 ID 与该账号绑定并回复成功信息。
3. WHEN 卡密无效/已使用/已过期，THEN 机器人 SHALL 回复对应错误信息。
4. WHEN 注册功能被关闭（`player.enableRegister = false`），THEN 机器人 SHALL 拒绝注册。
5. WHEN 已注册的老用户发送 `/bind <用户名> <密码>`，THEN 机器人 SHALL 校验密码并将 TG 用户 ID 与该账号绑定。

### R7. TG 机器人：修改密码

**User Story:** AS 普通用户，I want 通过 TG 机器人修改密码，SO THAT 管理账号安全。

#### Acceptance Criteria

1. WHEN 已绑定账号的用户发送 `/changepassword <旧密码> <新密码>`，THEN 机器人 SHALL 校验旧密码并将新密码写入用户配置。
2. WHEN 未绑定账号，THEN 机器人 SHALL 提示先注册或绑定。
3. WHEN 新密码长度小于 6，THEN 机器人 SHALL 拒绝并提示密码规则。

### R8. TG 机器人：获取线路

**User Story:** AS 普通用户，I want 通过 TG 机器人获取线路连接信息，SO THAT 配置 Subsonic 等客户端。

#### Acceptance Criteria

1. WHEN 已绑定账号的用户发送 `/server`，THEN 机器人 SHALL 返回服务器连接信息（Subsonic 地址、用户名、WebDAV 地址等，取自配置）。
2. WHEN 服务器对外地址未配置，THEN 机器人 SHALL 返回提示"请管理员配置对外地址"。
3. WHEN 未绑定账号，THEN 机器人 SHALL 提示先注册或绑定。

### R9. TG 机器人：接收歌单并自动下载

**User Story:** AS 普通用户，I want 发送歌单给 TG 机器人，SO THAT 缺失歌曲被自动下载并生成我的收藏歌单。

#### Acceptance Criteria

1. WHEN 已绑定账号的用户发送文本歌单（每行`歌手 - 歌名`），THEN 机器人 SHALL 解析出歌曲列表。
2. WHEN 已绑定账号的用户发送 LX Music JSON 歌单文件，THEN 机器人 SHALL 解析出歌曲列表。
3. WHEN 已绑定账号的用户发送平台歌单链接（网易云/QQ 等），THEN 机器人 SHALL 通过 musicSdk 获取歌单歌曲列表。
4. WHEN 解析成功，THEN 机器人 SHALL 将歌曲列表与全服务器本地曲库对比，标记缺失歌曲。
5. WHEN 存在缺失歌曲，THEN 机器人 SHALL 将该用户名的下载任务加入 `serverDownloadQueue`，歌曲保存至 `/music/<用户名>/`。
6. WHEN 下载完成后，THEN 机器人 SHALL 为该用户创建/更新单独收藏歌单（`userList`，命名为"TG 歌单"），回复下载结果统计（总数/已存在/已排队/失败）。
7. WHEN 歌单为空或无法解析，THEN 机器人 SHALL 回复错误提示。

## Non-Functional Requirements

1. **安全**：TG 绑定需验证；卡密不可重复使用；所有入口统一执行到期/封禁校验。
2. **可配置**：TG Bot Token、功能开关、封禁阈值 N 天、服务器对外地址均通过管理后台或配置文件设置。
3. **一致性**：`global.lx.config.users` 扩展字段需在保存/加载/热重载时保持一致，避免覆盖丢失。
4. **资源边界**：TG 歌单下载复用现有 `serverDownloadQueue` 的并发与持久化机制，不引入新下载链路。
