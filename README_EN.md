# LX Music Sync Server (Enhanced Edition)

![lxserver](https://socialify.git.ci/XCQ0607/lxserver/image?description=1&forks=0&issues=0&logo=https://raw.githubusercontent.com/XCQ0607/lxserver/refs/heads/main/public/icon.svg&owner=1&pulls=0&stargazers=0&theme=Auto)

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status">
    <img src="https://img.shields.io/badge/version-v2.0.0-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%3E%3D16-green?style=flat-square" alt="Node Version">
    <img src="https://img.shields.io/github/license/XCQ0607/lxserver?style=flat-square" alt="License">
    <br>
    <br>
    <a href="https://github.com/XCQ0607/lxserver/stargazers"><img src="https://img.shields.io/github/stars/XCQ0607/lxserver?style=flat-square&color=ffe16b" alt="GitHub stars"></a>
    <a href="https://github.com/XCQ0607/lxserver/network/members"><img src="https://img.shields.io/github/forks/XCQ0607/lxserver?style=flat-square" alt="GitHub forks"></a>
    <a href="https://github.com/XCQ0607/lxserver/issues"><img src="https://img.shields.io/github/issues/XCQ0607/lxserver?style=flat-square&color=red" alt="GitHub issues"></a>
    <a href="https://github.com/XCQ0607/lxserver/commits/main"><img src="https://img.shields.io/github/last-commit/XCQ0607/lxserver?style=flat-square&color=blueviolet" alt="Last Commit"></a>
    <img src="https://img.shields.io/github/commit-activity/m/XCQ0607/lxserver?style=flat-square&color=ff69b4" alt="Commit Activity">
    <a href="https://github.com/XCQ0607/lxserver/releases"><img src="https://img.shields.io/github/downloads/XCQ0607/lxserver/total?style=flat-square&color=blue" alt="Total Downloads"></a>
  </p>
</div>

[Documentation](https://xcq0607.github.io/lxserver/) | [SyncServer](md/lxserver_EN.md) | [Changelog](changelog.md) | [中文版](README.md)

---
This project features a powerful built-in **Web Player**, allowing you to enjoy music anywhere in your browser. It also serves as an enhanced [LX Music Data Sync Server](md/lxserver_EN.md).

## ✨ Web Player Key Features

### 1. Modern Interface
Featuring a clean, modern UI design with support for dark mode, providing a top-tier visual experience.
<p align="center">
  <img src="md/player.png" width="800" alt="Web Player Interface">
</p>

### 2. Multi-source Search
Supports aggregated searching across major music platforms, search and listen to anything you want.
<p align="center">
  <img src="md/search.png" width="800" alt="Search Interface">
</p>

### 3. Content & Playlists
  
Browse and search **multi-platform playlists** with ease. View comprehensive **playlist details** including covers, authors, and descriptions. Manage your **playback queue** with drag-and-drop sorting, batch operations, and quick positioning.

<p align="center">
  <img src="md/musiclist.png" width="800" alt="Playlist Browsing">
</p>

<p align="center">
  <img src="md/musiclist-detail.png" width="400" alt="Playlist Details">
  <img src="md/playlist.png" width="400" alt="Queue Management">
</p>

### 4. Powerful Playback Controls
Supports playback mode switching, sound quality selection, lyrics display, sleep timer, playback speed control, and more.

<p align="center">
  <img src="md/controller.png" width="800" alt="Controller">
</p>

### 5. Cache Management
  
Features a **fully automated caching system** for lyrics, links, and song files, managed via a dedicated **cache control panel** for smooth playback even in weak network conditions.

<p align="center">
  <img src="md/cache.png" width="800" alt="Automated Cache Management">
</p>

### 6. Lyric Card Sharing
  
Introducing **Lyric Card Sharing**—generate stunning posters with customizable aspect ratios (Portrait/Landscape/Square), color styles (Dark/Light/Album colors), and line counts, with support for rotation and scaling.

<p align="center">
  <img src="md/share.png" width="800" alt="Social Lyric Card Sharing">
</p>

### 7. Themes & System Configuration
  
Choose from multiple **modern themes** (Emerald, Deep Blue, Warm Sun, Nebula, Crimson) with automatic Light/Dark mode switching. Powerful system settings include **auto-updating network playlists**, **automatic config backups**, and multi-dimensional proxy support for seamless playback.

<p align="center">
  <img src="md/theme.png" width="400" alt="Modern Theme Switching">
  <img src="md/settings.png" width="400" alt="System Configuration">
</p>

### 8. Custom Source Management

Supports importing custom source scripts to expand music sources even further.

<p align="center">
  <img src="md/source.png" width="800" alt="Source Management">
</p>

### 9. Album & Artist Search & Collection

Search for albums and artists and favorite them with one click for quick access to your favorite music.

<p align="center">
  <img src="md/album.png" width="400" alt="Album Display">
  <img src="md/singer.png" width="400" alt="Artist Display">
</p>

### 10. Subsonic Protocol & Global Search Support

Fully compatible with the Subsonic protocol, allowing you to use various Subsonic clients (e.g., Yinliu, Feishin, etc.) to connect and play music. Supports specifying platform prefixes such as `wy:`, `kg:`, `tx:`, `kw:`, `mg:`, or using `online:` / `local:` prefixes to force global online or local search within Subsonic clients.

<p align="center">
  <img src="md/subsonic.png" width="400" alt="Subsonic Support">
  <img src="md/subsonic-search.png" width="400" alt="Subsonic Online Search">
</p>

### 11. Public Library & Shared Favorites

When **"Enable Public Favorites and Songs"** is enabled in the backend settings, all users (guests or different accounts) can share a common public music library and public playlists.

<p align="center">
  <img src="md/_open_song.png" width="800" alt="Public Library & Shared Favorites">
</p>

## 🔒 Access Control & Security
To protect your privacy, the Web Player supports password protection.
### How to Enable

1. **Environment Variable** (Recommended for Docker users):
   - `ENABLE_WEBPLAYER_AUTH=true`: Enable authentication
   - `WEBPLAYER_PASSWORD=yourpassword`: Set access password
2. **Web Interface**:
   Log in to the management dashboard (default port 9527), go to **"System Config"**, check **"Enable Web Player Password"** and set your password.

### Permission & Custom Source Matrix (when `user.enablePublicRestriction` is enabled)

| User Type | View List | Use/Toggle (Personal) | Change Default Quality | Upload/Import Public | Delete/Modify Public |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **Logged-in** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ❌ Denied | ❌ Denied |
| **Guest** | ❌ Hidden | ❌ Denied | ❌ Denied | ❌ Denied | ❌ Denied |

## 📱 Mobile Adaptation
The Web Player is deeply optimized for mobile devices, providing a native App-like experience in mobile browsers.

---

## 🚀 Quick Start

Built with **Node.js**, supporting multiple deployment methods.


### Option 1: Desktop Client

You can now run LX Music Sync Server more conveniently via our Desktop Client, available for Windows, macOS, and Linux.

- **📦 Download Latest**: [GitHub Releases](https://github.com/XCQ0607/lxserver/releases/latest)
- **✨ Key Advantages**:
    - **Single Window**: Integrated management dashboard and Web player for a unified experience.
    - **System Tray**: Minimizes to tray on close, ensuring the sync service stays active in the background.
    - **Port Conflict Resolution**: Automatically detects and switches ports if the default is in use.
    - **Setup Wizard**: Guided data path selection on first launch, supports **Portable Mode**.
    - **Multi-Arch Support**: Builds for Windows (x64/x86/ARM64 Setup & Portable), macOS (Intel x64 & Apple Silicon arm64), and Linux (amd64/arm64/armv7l deb/AppImage).

### Option 2: Containerized Deployment via Docker

This project supports pulling images from Docker Hub or GitHub Packages:
- **Docker Hub**: `xcq0607/lxserver:latest`
- **GitHub Packages**: `ghcr.io/xcq0607/lxserver:latest`

**Docker Run Example:**

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  -v $(pwd)/cache:/server/cache \
  -v $(pwd)/music:/server/music \
  --name lx-sync-server \
  --restart unless-stopped \
  xcq0607/lxserver:latest
```

**Docker Compose Example:**

Create a `docker-compose.yml` file:

```yaml
version: '3'
services:
  lx-sync-server:
    image: xcq0607/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./logs:/server/logs
      - ./cache:/server/cache
      - ./music:/server/music
    environment:
      - NODE_ENV=production
      # - FRONTEND_PASSWORD=123456
      # - ENABLE_WEBPLAYER_AUTH=true
      # - WEBPLAYER_PASSWORD=yourpassword
      # - ADMIN_PATH=
      # - PLAYER_PATH=/music
```

### Option 3: Manual Run (Git Clone)

```bash
# 1. Clone project
git clone https://github.com/XCQ0607/lxserver.git && cd lxserver

# 2. Install dependencies and build
npm ci && npm run build

# 3. Start service
npm start
```

### Option 4: Using Release Build

1. Download the archive from GitHub Releases.
2. Extract and run `npm install --production`.
3. Execute `npm start`.

### 3. Access Info

- **Web Player**: `http://your-ip:9527` (Default root path, configurable via `PLAYER_PATH`)
- **Sync Dashboard**: `http://your-ip:9527/admin` (Default path `/admin`, configurable via `ADMIN_PATH`, default password: `123456`)

---

## 🏗️ Architecture

Separated frontend and backend architecture based on Node.js:

- **Backend (Express + WebSocket)**: Core sync logic and WebDAV backup.
- **WebPlayer (Vanilla JS)**: Handles music playback, default access path is root `/`.
- **Console (Vanilla JS)**: Located at `/admin` path, handles user and data management.

---

## 🛠️ Configuration

Edit `config.js` directly. Environment variables take precedence:

| Env Variable | Config Key | Description | Default |
| --- | --- | --- | --- |
| `PORT` | `port` | Service port | `9527` |
| `BIND_IP` | `bindIP` | Binding IP | `0.0.0.0` |
| `ADMIN_PATH` | `admin.path` | Backend management interface path | `/admin` |
| `PLAYER_PATH` | `player.path` | Web player access path (default empty, i.e., root `/`) | (empty) |
| `SUBSONIC_ENABLE` | `subsonic.enable` | Enable Subsonic protocol support | `true` |
| `SUBSONIC_PATH` | `subsonic.path` | Subsonic access path | `/rest` |
| `FRONTEND_PASSWORD` | `frontend.password` | Web dashboard password | `123456` |
| `SERVER_NAME` | `serverName` | Sync service name | `lxserver` |
| `MAX_SNAPSHOT_NUM` | `maxSnapshotNum` | Max snapshots to keep | `10` |
| `CONFIG_PATH` | - | Absolute path to external config file | - |
| `DATA_PATH` | - | Absolute path to data storage directory | `./data` |
| `LOG_PATH` | - | Absolute path to log output directory | `./logs` |
| `PROXY_HEADER` | `proxy.header` | Proxy IP header (e.g., `x-real-ip`) | - |
| `USER_ENABLE_ROOT` | `user.enableRoot` | Enable root path (use `ip:port`, password must be unique) | `false` |
| `USER_ENABLE_PATH` | `user.enablePath` | Enable user path (use `ip:port/username`, passwords can repeat) | `true` |
| `WEBDAV_ENABLE` | `webdav.enable` | Enable WebDAV sync and backup | `false` |
| `WEBDAV_URL` | `webdav.url` | WebDAV URL | - |
| `WEBDAV_USERNAME` | `webdav.username` | WebDAV Username | - |
| `WEBDAV_PASSWORD` | `webdav.password` | WebDAV Password | - |
| `WEBDAV_SYNC_PATH` | `webdav.syncPath` | WebDAV remote sync path | `/lx-sync` |
| `WEBDAV_BACKUP_PATH` | `webdav.backupPath` | WebDAV remote backup path | `/lx-sync-backups` |
| `SYNC_INTERVAL` | `sync.interval` | WebDAV incremental sync interval (min) | `60` |
| `BACKUP_INTERVAL` | `sync.backupInterval` | WebDAV full backup interval (hours) | `24` |
| `ENABLE_WEBPLAYER_AUTH` | `player.enableAuth` | Enable Web Player password | `false` |
| `WEBPLAYER_PASSWORD` | `player.password` | Web Player password | `123456` |
| `DISABLE_TELEMETRY` | `disableTelemetry` | Disable anonymous telemetry and update notifications | `false` |
| `ENABLE_PUBLIC_USER_RESTRICTION` | `user.enablePublicRestriction` | Enable public user permission restriction (restrict upload/delete public sources) | `true` |
| `ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC` | `user.enablePublicNonAdminLocalMusic` | Enable non-admin access to local music (allows non-admin public accounts to access local music) | `false` |
| `ENABLE_PUBLIC_FAVORITES` | `user.enablePublicFavorites` | Enable public favorites and songs (allows guest/public to view and play public favorites) | `false` |
| `ENABLE_PUBLIC_NON_ADMIN_ACCESS` | `user.enablePublicNonAdminAccess` | Enable non-admin access to public favorites & songs (allows non-admin public accounts to view) | `false` |
| `ENABLE_LOGIN_USER_CACHE_RESTRICTION` | `user.enableLoginCacheRestriction` | Enable cache settings restriction for logged-in non-admin users | `false` |
| `ENABLE_CACHE_SIZE_LIMIT` | `user.enableCacheSizeLimit` | Enable cache size limit (auto-cleanup via LRU) | `false` |
| `CACHE_SIZE_LIMIT` | `user.cacheSizeLimit` | Cache size limit in MB | `2000` |
| `LIST_ADD_MUSIC_LOCATION_TYPE` | `list.addMusicLocationType` | Position when adding songs to list (`top` / `bottom`) | `top` |
| `PROXY_ALL_ENABLED` | `proxy.all.enabled` | Enable outgoing request proxy (for Music SDK) | `false` |
| `PROXY_ALL_ADDRESS` | `proxy.all.address` | Proxy address (supports http:// or socks5://) | - |
| `SINGER_SOURCE_PRIORITY` | `singer.sourcePriority` | Singer info retrieval priority (e.g., `tx,wy` or `wy,tx`) | `tx,wy` |
| `SUBSONIC_ENABLE_DEBUG` | `subsonic.enableDebug` | Enable Subsonic debug log mode | `false` |
| `SUBSONIC_ONLINE_SEARCH` | `subsonic.onlineSearch` | Enable Subsonic online search | `true` |
| `SUBSONIC_ONLINE_SEARCH_MODE` | `subsonic.onlineSearchMode` | Subsonic online search mode (`fallback` / `merge` / `local_only`) | `fallback` |
| `SUBSONIC_ONLINE_SEARCH_SOURCES` | `subsonic.onlineSearchSources` | Subsonic online search default platforms | `wy,tx,kw,kg,mg` |
| `SUBSONIC_LYRIC_TRANSLATION` | `subsonic.lyricTranslation` | Include translations in Subsonic lyrics | `true` |
| `ARTIST_MAX_FETCH_PAGES` | `artist.maxFetchPages` | Maximum fetch pages for artist tracks | `20` |
| `CACHE_NAMING_PATTERN` | `cache.namingPattern` | Cache file naming rule (`simple` / `custom`) | `simple` |
| `SYSTEM_ALLOW_UNSAFE_VM` | `system.allowUnsafeVM` | Allow VM mode custom source scripts (note security risks) | `false` |
| `LX_USER_<username>` | `users` array | Quickly add a user, value is the password (e.g., `LX_USER_test=123`) | - |

> **Boolean Environment Variable Format**: All boolean env variables support flexible case-insensitive formats: `true`/`1`/`yes`/`y`/`on` for enabled, and `false`/`0`/`no`/`n`/`off` for disabled.

> **Note**: The service currently supports two types of sync connection URLs: `Root Path` (URL configuration is `ip:port`) and `User Path` (URL configuration is `ip:port/username`). If the User Path is disabled, all sync user passwords must be completely unique.

---

## 🛡️ Data Collection & Privacy

Anonymous telemetry via PostHog is used for:

1. **Bug Tracking**: Version number and environment type.
2. **Notifications**: **Update alerts** and **maintenance notices**.

- **Totally Anonymous**: No IP, username, or playlist content is collected.
- **How to Disable**: Set `DISABLE_TELEMETRY=true`. **Note: Disabling this prevents receiving update notifications.**

---

## 🤝 Credits & Acknowledgements

- Forked from [lyswhut/lx-music-sync-server](https://github.com/lyswhut/lx-music-sync-server).
- Web player logic inspired by [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop).
- API based on `musicsdk`.

### 👥 Contributors

<a href="https://github.com/xcq0607/lxserver/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xcq0607/lxserver" />
</a>

## 📈 Star History


<a href="https://gitdata.xuanhun520.com/?repos=xcq0607/lxserver&type=Date">
<picture >
  <source media="(prefers-color-scheme: dark) and (max-width: 800px)" srcset="https://gitdata.xuanhun520.com/api/starimg?repos=xcq0607/lxserver&type=Date&theme=dark" />
  <source  media="(prefers-color-scheme: light) and (max-width: 800px)" srcset="https://gitdata.xuanhun520.com/api/starimg?repos=xcq0607/lxserver&type=Date&theme=light" />
  <img style="width: 800px; height: 533px;" alt="Star History Chart" src="https://gitdata.xuanhun520.com/api/starimg?repos=xcq0607/lxserver&type=Date&theme=dark" />
</picture>
</a>


---

## 📄 License

This project is released under the Apache License 2.0. The following agreement is a supplement to the Apache License 2.0. In case of conflict, this agreement shall prevail.

Apache License 2.0 copyright (c) 2026 [xcq0607](https://github.com/xcq0607)

**Terminology**: "This Project" refers to LX Music Web Player; "User" refers to the user who agrees to this agreement; "Official Music Platforms" refers to the collective official platforms of the music sources built into this project, including Kuwo, Kugou, Migu, etc.; "Copyrighted Data" refers to data owned by others, including but not limited to images, audio, names, etc.

### I. Data Sources

1. **Official Platforms**: The online data from various official platforms in this project is pulled from their public servers. It is displayed after simple filtering and merging (the same as the data obtained from official apps in an unlogged state). Therefore, this project is not responsible for the legality or accuracy of the data.
2. **Audio Data**: This project itself does not have the ability to obtain specific audio data. The online audio data sources used come from the online links returned by the "Source" selected in the "Custom Source" settings. This project cannot verify its accuracy, and playback abnormalities may occur during use.
3. **Other Data**: Non-official platform data in this project (such as lists in "My List") comes from server-stored data. This project is not responsible for the legality or accuracy of this data.

### II. Disclaimer

1. **Copyrighted Data**: Copyrighted data may be generated during the use of this project. This project does not own ownership of this copyrighted data. To avoid infringement, users must clear the copyrighted data generated during the use of this project within **24 hours**.
2. **Liability**: Any direct, indirect, special, incidental, or consequential damages of any nature arising from this agreement or from the use or inability to use this project are the responsibility of the user.
3. **Laws and Regulations**: This project is completely free and open-sourced on GitHub for technical learning and exchange. Use of this project in violation of local laws and regulations is **PROHIBITED**. The user shall bear full responsibility for any illegal or non-compliant behavior caused by using this project, whether the user is aware of local laws and regulations or not.

### III. Miscellaneous

1. **Resource Usage**: Some resources used in this project, including but not limited to fonts and images, come from the internet. If there is any infringement, please contact this project for removal.
2. **Non-Commercial Nature**: This project is only for technical feasibility exploration and research. It does not accept any commercial cooperation (including but not limited to advertising) or donations.
3. **Acceptance of Agreement**: If you use this project, it means you accept this agreement.
