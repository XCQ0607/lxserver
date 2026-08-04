# LX Music Sync Server (Enhanced Edition)

![lxserver](https://socialify.git.ci/boy6656598/lxserver/image?description=1&forks=0&issues=0&logo=https://raw.githubusercontent.com/boy6656598/lxserver/refs/heads/main/public/icon.svg&owner=1&pulls=0&stargazers=0&theme=Auto)

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status">
    <img src="https://img.shields.io/badge/version-v2.0.0-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%3E%3D16-green?style=flat-square" alt="Node Version">
    <img src="https://img.shields.io/github/license/boy6656598/lxserver?style=flat-square" alt="License">
    <br>
    <br>
    <a href="https://github.com/boy6656598/lxserver/stargazers"><img src="https://img.shields.io/github/stars/boy6656598/lxserver?style=flat-square&color=ffe16b" alt="GitHub stars"></a>
    <a href="https://github.com/boy6656598/lxserver/network/members"><img src="https://img.shields.io/github/forks/boy6656598/lxserver?style=flat-square" alt="GitHub forks"></a>
    <a href="https://github.com/boy6656598/lxserver/issues"><img src="https://img.shields.io/github/issues/boy6656598/lxserver?style=flat-square&color=red" alt="GitHub issues"></a>
    <a href="https://github.com/boy6656598/lxserver/commits/main"><img src="https://img.shields.io/github/last-commit/boy6656598/lxserver?style=flat-square&color=blueviolet" alt="Last Commit"></a>
    <img src="https://img.shields.io/github/commit-activity/m/boy6656598/lxserver?style=flat-square&color=ff69b4" alt="Commit Activity">
    <a href="https://github.com/boy6656598/lxserver/releases"><img src="https://img.shields.io/github/downloads/boy6656598/lxserver/total?style=flat-square&color=blue" alt="Total Downloads"></a>
  </p>
</div>

[同步服务器 SyncServer](md/lxserver.md) | [更新日志 Changelog](changelog.md) | [English](README_EN.md)

---

本项目内置了一个功能强大的 **Web 播放器**，让你可以随时随地在浏览器中享受音乐。同时，它也是一个增强版的 [LX Music 数据同步服务端](md/lxserver.md)。

## ✨ Web 播放器核心特性

### 1. 现代化界面

采用清爽的现代化 UI 设计，支持深色模式，提供极致的视觉体验。

<p align="center">
  <img src="md/player.png" width="800" alt="Web Player Interface">
</p>

### 2. 多源搜索

支持聚合搜索各大音乐平台的资源，想听什么搜什么。

<p align="center">
  <img src="md/search.png" width="800" alt="Search Interface">
</p>

### 3. 内容与播放列表

支持**多平台歌单**的浏览、搜索与一键播放，提供直观的**歌单详情**面板，包含封面、作者、简介等完整信息。**播放队列**支持拖拽排序、批量管理及快速定位当前播放。

<p align="center">
  <img src="md/musiclist.png" width="800" alt="歌单浏览">
</p>

<p align="center">
  <img src="md/musiclist-detail.png" width="400" alt="歌单详情">
  <img src="md/playlist.png" width="400" alt="播放队列管理">
</p>

### 4. 强大的播放控制

支持播放模式切换、音质选择、歌词显示、睡眠定时、播放倍数等功能。

<p align="center">
  <img src="md/controller.png" width="800" alt="Controller">
</p>

### 5. 缓存管理

内置**全自动化缓存系统**，可自动保存歌词、链接及歌曲文件，通过专门的**缓存控制面板**实现颗粒化管理，极大提升弱网环境下的播放流畅度。

<p align="center">
  <img src="md/cache.png" width="800" alt="缓存自动化管理">
</p>

### 6. 歌词卡片分享

新增**歌词卡片分享**功能，支持自定义卡片比例（竖版/横版/方版）、色彩风格（深色/浅色/专辑色）及歌词行数，一键生成精美海报，支持旋转缩放。

<p align="center">
  <img src="md/share.png" width="800" alt="歌词卡片社交分享">
</p>

### 7. 主题定制与系统功能

支持**多套现代化主题**（如森之韵、深海鲨、暖阳意、绯红月等），并可根据系统自动切换暗亮模式。系统设置支持**自动更新网络歌单**、**账号设置自动备份**及**多维度代理**配置，确保播放顺滑稳定。

<p align="center">
  <img src="md/theme.png" width="400" alt="现代化主题切换">
  <img src="md/settings.png" width="400" alt="全方位系统配置">
</p>

### 8. 自定义源管理

支持导入自定义源脚本，扩展更多音乐来源。

<p align="center">
  <img src="md/source.png" width="800" alt="Source Management">
</p>

### 9. 专辑与歌手搜索与收藏

支持搜索专辑与歌手，并支持一键收藏，方便快速找回你喜爱的音乐人与专辑。

<p align="center">
  <img src="md/album.png" width="400" alt="专辑展示">
  <img src="md/singer.png" width="400" alt="歌手展示">
</p>

### 10. Subsonic 协议与全网检索支持

全面适配 Subsonic 协议，支持使用各类 Subsonic 客户端（如音流、Feishin 等）连接并播放本站资源。支持在 Subsonic 客户端中通过 `wy:`, `kg:`, `tx:`, `kw:`, `mg:` 等指定平台前缀，或 `online:` / `local:` 强制指定全网在线或本地搜索。

<p align="center">
  <img src="md/subsonic.png" width="400" alt="Subsonic 支持">
  <img src="md/subsonic-search.png" width="400" alt="Subsonic 在线全网搜索">
</p>

### 11. 公共曲库与共享收藏

在后台系统配置中开启 **“开启公共收藏和歌曲”** 之后，所有用户（无论未登录或不同账号）均可共同拥有并共享一个公共曲库与公开歌单列表。

<p align="center">
  <img src="md/_open_song.png" width="800" alt="公共曲库与共享收藏">
</p>

## 🔒 访问控制与安全

为了保护你的隐私，Web 播放器支持开启访问密码。

### 开启方式

1. **环境变量配置**（推荐 Docker 用户使用）：
   - `ENABLE_WEBPLAYER_AUTH=true`: 开启认证
   - `WEBPLAYER_PASSWORD=yourpassword`: 设置访问密码
2. **Web 界面配置**：
   登录管理后台（默认端口 9527），进入 **"系统配置"**，勾选 **"启用 Web 播放器访问密码"** 并设置密码。

### 权限与公开源限制矩阵 (当 `user.enablePublicRestriction` 开启时)

| 用户类型             | 查看列表 | 使用/切换(仅个人) | 修改默认音质 | 上传/导入公开源 | 删除/修改公开源 |
| :------------------- | :------- | :---------------- | :----------- | :-------------- | :-------------- |
| **管理员**     | ✅ 允许  | ✅ 允许           | ✅ 允许      | ✅ 允许         | ✅ 允许         |
| **已登录用户** | ✅ 允许  | ✅ 允许           | ✅ 允许      | ❌ 禁止         | ❌ 禁止         |
| **未登录访客** | ❌ 隐藏  | ❌ 禁止           | ❌ 禁止      | ❌ 禁止         | ❌ 禁止         |

## 📱 移动端适配

Web 播放器针对移动端进行了深度优化，手机浏览器访问也能获得原生 App 般的体验。

---

## 🚀 快速启动

本项目基于 **Node.js** 开发，支持多种部署方式。推荐在 NAS / VPS 上使用 **Docker Compose** 一键部署。

### 方式一：NAS / Docker Compose 一键部署（推荐）

适用于飞牛 NAS、群晖 NAS、及任何支持 Docker 的主机。项目内置了 `Dockerfile` 与 `docker-compose.yml`，可直接构建运行。

**已有数据迁移（可选）**：如果你已有运行中的数据（用户、OpenList、卡密、云盘配置、缓存），先执行迁移脚本生成部署包：

```bash
# 在项目目录执行，生成 lxserver-nas-deploy.tar.gz（含清洗后的 config.js + 完整 data/）
bash scripts/migrate-to-nas.sh
```

**全新安装 / 迁移安装通用步骤：**

```bash
# 1. 将项目代码放到 NAS 固定目录
mkdir -p /vol1/docker/lxserver
#    （若迁移，把上面的部署包也解压进来）
tar -xzf lxserver-nas-deploy.tar.gz -C /vol1/docker/lxserver

# 2. 构建并启动（首次构建需编译 TS，约 5-15 分钟）
cd /vol1/docker/lxserver && docker compose up -d --build

# 3. 访问
#    同步管理后台:  http://<NAS-IP>:9527/
#    Web 播放器:    http://<NAS-IP>:9527/music/
```

> **提示**：
> - 端口被占用时修改 `docker-compose.yml` 中 `ports` 左侧宿主机端口即可（如 `"9000:9527"`）。
> - 所有数据（用户、OpenList、云盘配置、缓存）持久化在 `./data` 目录，**备份只需复制该目录**。
> - 常用环境变量（优先级高于 `config.js`）见 `docker-compose.yml` 内注释：`LX_USER_<用户名>` 追加用户、`FRONTEND_PASSWORD` 后台密码、`ENABLE_WEBPLAYER_AUTH` / `WEBPLAYER_PASSWORD` 播放器密码、`WEBDAV_URL` 等开启 WebDAV 同步。

### 方式二：直接运行 (Git Clone)

```bash
# 1. 克隆项目
git clone https://github.com/boy6656598/lxserver.git && cd lxserver

# 2. 安装依赖并编译
npm ci && npm run build

# 3. 启动服务
npm start
```

### 方式三：桌面客户端

可以通过桌面端更方便地运行 LX Music Sync Server，支持 Windows、macOS 和 Linux。

- **📦 最新版本下载**: [GitHub Releases](https://github.com/boy6656598/lxserver/releases/latest)
- **✨ 桌面端优势**:
  - **单窗口管理**: 服务器管理与 Web 播放器合二为一，界面更统一。
  - **托盘常驻**: 窗口关闭后自动缩回托盘，服务在后台始终运行。
  - **全架构支持**: 提供 Windows (x64/x86/ARM64 Setup 及 Portable)、macOS (Intel/Apple Silicon) 及 Linux (amd64/arm64/armv7l) 全家桶。

### 方式四：使用 Docker 镜像

> 镜像发布在 **GitHub Container Registry**（Docker Hub 发布见下方说明）：

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  -v $(pwd)/cache:/server/cache \
  -v $(pwd)/music:/server/music \
  --name lx-sync-server \
  --restart unless-stopped \
  ghcr.io/boy6656598/lxserver:latest
```

**从源码构建镜像（如需自定义或自行发布 Docker Hub）：**

```bash
docker build -t lxserver .
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  -v $(pwd)/cache:/server/cache \
  -v $(pwd)/music:/server/music \
  --name lx-sync-server \
  --restart unless-stopped \
  lxserver
```

### 方式五：使用 Release 版本

1. 在 GitHub Releases 下载压缩包。
2. 解压后运行 `npm install --production`。
3. 执行 `npm start` 启动。

### 群晖套件安装

群晖用户也可使用项目内置的 SPK 打包方案（`packaging/synology-spk/`），支持 DSM 7 手动安装套件，详见 [packaging/synology-spk/README.md](packaging/synology-spk/README.md)。

### 访问说明

- **同步管理后台**: `http://your-ip:9527` (默认路径，可通过 `ADMIN_PATH` 修改，默认密码: `123456`)
- **Web 播放器**: `http://your-ip:9527/music` (默认路径，可通过 `PLAYER_PATH` 修改)
- **Subsonic**: `http://your-ip:9527/rest` (可被音流、Feishin 等客户端连接)

---

## 🏗️ 项目架构

本项目基于 Node.js 采用前后端分离架构：

- **Backend (Express + WebSocket)**: 核心同步逻辑与 WebDAV 备份。
- **Console (Vanilla JS)**: 位于根目录，负责用户与数据管理。
- **WebPlayer (Vanilla JS)**: 负责音乐播放业务，默认访问路径为 `/music`。

---

## 🛠️ 配置说明

可以直接编辑 `config.js`。环境变量优先级最高：

| 环境变量                                | 对应配置项                           | 说明                                                               | 默认值             |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ | ------------------ |
| `PORT`                                | `port`                             | 服务端口                                                           | `9527`           |
| `BIND_IP`                             | `bindIP`                           | 绑定 IP                                                            | `0.0.0.0`        |
| `ADMIN_PATH`                          | `admin.path`                       | 后台管理界面访问路径 (默认为空，即根路径 `/`)                    | (空)               |
| `PLAYER_PATH`                         | `player.path`                      | Web 播放器访问路径 (默认为 `/music`)                             | `/music`         |
| `SUBSONIC_ENABLE`                     | `subsonic.enable`                  | 是否启用 Subsonic 协议支持 (服务默认开启)                          | `true`           |
| `SUBSONIC_PATH`                       | `subsonic.path`                    | Subsonic 访问路径 (默认为 `/rest`)                               | `/rest`          |
| `FRONTEND_PASSWORD`                   | `frontend.password`                | Web 管理界面访问密码                                               | `123456`         |
| `SERVER_NAME`                         | `serverName`                       | 同步服务名称                                                       | `lxserver`       |
| `MAX_SNAPSHOT_NUM`                    | `maxSnapshotNum`                   | 保留的最大快照数量                                                 | `10`             |
| `CONFIG_PATH`                         | -                                    | 指定外部配置文件的绝对路径                                         | -                  |
| `DATA_PATH`                           | -                                    | 指定数据存储目录的绝对路径                                         | `./data`         |
| `LOG_PATH`                            | -                                    | 指定日志输出目录的绝对路径                                         | `./logs`         |
| `PROXY_HEADER`                        | `proxy.header`                     | 代理转发 IP 头 (如 `x-real-ip`)                                  | -                  |
| `USER_ENABLE_ROOT`                    | `user.enableRoot`                  | 启用根路径 (开启后连接URL即为 `ip:port`，不允许不同用户密码相同) | `false`          |
| `USER_ENABLE_PATH`                    | `user.enablePath`                  | 启用用户路径 (开启后连接URL需为 `ip:port/用户名`，允许密码相同)  | `true`           |
| `WEBDAV_ENABLE`                       | `webdav.enable`                    | 是否启用 WebDAV 同步与备份                                         | `false`          |
| `WEBDAV_URL`                          | `webdav.url`                       | WebDAV 地址                                                        | -                  |
| `WEBDAV_USERNAME`                     | `webdav.username`                  | WebDAV 用户名                                                      | -                  |
| `WEBDAV_PASSWORD`                     | `webdav.password`                  | WebDAV 密码                                                        | -                  |
| `WEBDAV_SYNC_PATH`                    | `webdav.syncPath`                  | WebDAV 增量同步远端路径                                            | `/lx-sync`         |
| `WEBDAV_BACKUP_PATH`                  | `webdav.backupPath`                | WebDAV 全量备份远端路径                                            | `/lx-sync-backups` |
| `SYNC_INTERVAL`                       | `sync.interval`                    | WebDAV 增量同步检测间隔(分钟)                                      | `60`             |
| `BACKUP_INTERVAL`                     | `sync.backupInterval`              | WebDAV 全量备份间隔(小时)                                          | `24`             |
| `ENABLE_WEBPLAYER_AUTH`               | `player.enableAuth`                | 是否启用 Web 播放器访问密码                                        | `false`          |
| `WEBPLAYER_PASSWORD`                  | `player.password`                  | Web 播放器访问密码                                                 | `123456`         |
| `DISABLE_TELEMETRY`                   | `disableTelemetry`                 | 是否禁用匿名数据统计，系统更新提示以及系统公告提示                 | `false`          |
| `ENABLE_PUBLIC_USER_RESTRICTION`      | `user.enablePublicRestriction`     | 是否启用公开用户权限限制 (限制上传、删除公开源、缓存到服务器等)    | `true`           |
| `ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC` | `user.enablePublicNonAdminLocalMusic` | 是否开启非管理员访问本地音乐 (允许未登录管理员的公开账号访问本地音乐) | `false`          |
| `ENABLE_PUBLIC_FAVORITES`             | `user.enablePublicFavorites`       | 是否开启公开收藏和歌曲 (开启后允许公开/未登录用户查看及播放公开收藏) | `false`          |
| `ENABLE_PUBLIC_NON_ADMIN_ACCESS`      | `user.enablePublicNonAdminAccess`  | 是否开启非管理员访问公开收藏和歌曲 (允许未登录管理员的公开账号查看) | `false`          |
| `ENABLE_LOGIN_USER_CACHE_RESTRICTION` | `user.enableLoginCacheRestriction` | 是否启用登录用户缓存限制 (开启后限非管理员登录用户的缓存设置)      | `false`          |
| `ENABLE_CACHE_SIZE_LIMIT`             | `user.enableCacheSizeLimit`        | 是否启用缓存空间限制 (开启后超出容量将按 LRU 自动清理)             | `false`          |
| `CACHE_SIZE_LIMIT`                    | `user.cacheSizeLimit`              | 缓存空间限制大小 (单位: MB)                                        | `2000`           |
| `LIST_ADD_MUSIC_LOCATION_TYPE`        | `list.addMusicLocationType`        | 添加歌曲到列表时的位置 (`top` / `bottom`)                      | `top`            |
| `PROXY_ALL_ENABLED`                   | `proxy.all.enabled`                | 是否启用外发请求代理 (针对 Music SDK)                              | `false`          |
| `PROXY_ALL_ADDRESS`                   | `proxy.all.address`                | 代理地址 (支持 http:// 或 socks5://)                               | -                  |
| `SINGER_SOURCE_PRIORITY`              | `singer.sourcePriority`            | 歌手信息获取来源优先级 (如 `tx,wy` 或 `wy,tx`)                 | `tx,wy`          |
| `LX_USER_<用户名>`                    | `users` 数组                       | 快速添加用户，值为该用户的密码 (如 `LX_USER_test=123`)           | -                  |

### 仅在 `config.js` 中生效的高级配置项

部分高级选项仅可通过直接修改 `config.js` 进行配置：

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `subsonic.enableDebug` | 是否开启 Subsonic 调试日志模式 | `true` |
| `subsonic.onlineSearch` | 是否开启 Subsonic 在线全网搜索 | `true` |
| `subsonic.onlineSearchMode` | Subsonic 在线搜索模式 (`fallback` 回退模式 / `merge` 合并模式 / `local_only` 仅本地) | `"fallback"` |
| `subsonic.onlineSearchSources` | Subsonic 在线搜索默认音源列表 | `"wy,tx,kw,kg,mg"` |
| `subsonic.lyricTranslation` | Subsonic 歌词中是否包含翻译 | `true` |
| `artist.maxFetchPages` | 歌手歌曲最大抓取页数 | `20` |
| `cache.namingPattern` | 缓存文件命名规则 (`simple` / `custom`) | `"simple"` |
| `system.allowUnsafeVM` | 是否允许运行 VM 模式自定义源脚本 (需注意安全风险) | `false` |

> **提示**：目前服务支持 `启用根路径` (URL配置为 `ip:port`) 和 `启用用户路径` (URL配置为 `ip:port/username`) 两种数据同步连接方式。如果没有启用用户路径，则必须保证每一个同步用户的鉴权密码不重复。

---

## 🛡️ 数据收集与隐私说明

本项目集成了 PostHog 匿名数据统计，主要用于：

1. **Bug 追踪**: 收集版本号、环境类型。
2. **通知推送**: 弹出 **版本更新提醒** 与 **紧急维护公告**。

- **绝对匿名**: 绝不收集 IP、用户名或具体歌单内容。
- **关闭方法**: 环境变量设置 `DISABLE_TELEMETRY=true`。**注意：关闭后将无法收到新版本通知。**

---

## 🤝 贡献与致谢

- 修改自 [lyswhut/lx-music-sync-server](https://github.com/lyswhut/lx-music-sync-server)。
- Web 播放器逻辑参考 [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)。
- 接口实现基于 `musicsdk`。

### 👥 贡献者 (Contributors)

<a href="https://github.com/boy6656598/lxserver/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=boy6656598/lxserver" />
</a>

## 📄 开源协议

本项目基于 Apache License 2.0 许可证发行，以下协议是对于 Apache License 2.0 的补充，如有冲突，以以下协议为准。

Apache License 2.0 copyright (c) 2026 [boy6656598](https://github.com/boy6656598)

**词语约定**：本协议中的“本项目”指 LX Music Web 播放器；“使用者”指签署本协议的使用者；“官方音乐平台”指对本项目内置的包括酷我、酷狗、咪咕等音乐源的官方平台统称；“版权数据”指包括但不限于图像、音频、名字等在内的他人拥有所属版权的数据。

### 一、数据来源

1. **官方平台**: 本项目的各官方平台在线数据来源原理是从其公开服务器中拉取数据，经过对数据简单地筛选与合并后进行展示(与未登录状态在官方APP获取的数据相同)，因此本项目不对数据的合法性、准确性负责。
2. **音频数据**: 本项目本身没有获取某个音频数据的能力，所使用的在线音频数据来源来自设置内“自定义源”所选择的“源”返回的在线链接。本项目无法校验其准确性，使用过程中可能会出现播放异常。
3. **其他数据**: 本项目的非官方平台数据（例如“我的列表”内列表）来自服务器存储数据，本项目不对这些数据的合法性、准确性负责。

### 二、免责声明

1. **版权数据**: 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 **24 小时内** 清除使用本项目的过程中所产生的版权数据。
2. **责任承担**: 由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害由使用者负责。
3. **法律法规**: 本项目完全免费，且开源发布于 GitHub 面向全世界人用作对技术的学习交流。**禁止**在违反当地法律法规的情况下使用本项目。对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担。

### 三、其他

1. **资源使用**: 本项目内使用的部分包括但不限于字体、图片等资源来源于互联网。如果出现侵权可联系本项目移除。
2. **非商业性质**: 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。
3. **接受协议**: 若你使用了本项目，即代表你接受本协议。
