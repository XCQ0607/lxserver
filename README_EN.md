# LX Music Sync Server (Enhanced Edition)

![lxserver](https://socialify.git.ci/XCQ0607/lxserver/image?description=1&forks=0&issues=0&logo=https://raw.githubusercontent.com/XCQ0607/lxserver/refs/heads/main/public/icon.svg&owner=1&pulls=0&stargazers=0&theme=Auto)

<div align="center">
  <p>
    <img src="https://img.shields.io/github/package-json/v/XCQ0607/lxserver?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%3E%3D22-green?style=flat-square" alt="Node Version">
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
  <p>
    <a href="https://www.star-history.com/xcq0607/lxserver">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/badge?repo=XCQ0607/lxserver&type=trending&theme=dark" />
        <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/badge?repo=XCQ0607/lxserver&type=trending" />
        <img alt="GitHub Trending Repository of the Day" src="https://api.star-history.com/badge?repo=XCQ0607/lxserver&type=trending" />
      </picture>
    </a>
  </p>
</div>

[Documentation](https://xcq0607.github.io/lxserver/) | [SyncServer](md/lxserver_EN.md) | [Changelog](changelog.md) | [中文版](README.md)


---

LX Music Sync Server brings playlist sync, a browser music player and a server-side music library into one self-hosted service. Built on [LX Music Sync Server](https://github.com/lyswhut/lx-music-sync-server), this edition adds an admin console, background downloads, local metadata tools and Subsonic/OpenSubsonic integration.

Use it from a browser, an LX Music desktop/mobile client, or a compatible Subsonic client. Playlist synchronization transfers playlist data; it does not automatically copy your server's audio files to every device.

## Contents

- [Deployment and first run](#deployment-and-first-run)
- [Connecting clients](#connecting-clients)
- [Player and music management](#player-and-music-management)
- [Accounts and permissions](#accounts-and-permissions)
- [Storage, backups and updates](#storage-backups-and-updates)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Development and APIs](#development-and-apis)

See the [documentation site](https://xcq0607.github.io/lxserver/en/), [API reference](docs/en/api/reference.md), [route index](docs/en/api/routes.md), and [Chinese README](README.md).

## Deployment and first run

### Choose a runtime

| Method | Suitable for | Requirements |
| --- | --- | --- |
| Docker / Compose | NAS and unattended servers | Docker and persistent host directories |
| Source build | Development and custom builds | Node.js 22+, npm and Git |
| Server release archive | Running compiled server files | Node.js 22+ and the server release package |
| Desktop app | Using the player and admin console in desktop windows | A package matching your OS and architecture |
| PM2 | Keeping a compiled Node.js deployment running | A built server and separately installed PM2 |

The main service defaults to port `9527`: player at `/`, admin console at `/admin`, Subsonic at `/rest`.

### Docker Compose

Create `compose.yaml` in the directory where you want to keep your data:

```yaml
services:
  lx-sync-server:
    image: xcq0607/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./cache:/server/cache
      - ./music:/server/music
      # Optional existing library:
      # - /mnt/nas/music:/library:ro
    environment:
      NODE_ENV: production
      ADMIN_PASSWORD: "replace-with-your-admin-password"
      ENABLE_WEBPLAYER_AUTH: "true"
      WEBPLAYER_PASSWORD: "replace-with-your-player-password"
      # Optional initial sync account:
      # LX_USER_user1: "replace-with-your-user-password"
```

```bash
docker compose up -d
docker compose logs -f --tail=100
```

The alternative image is `ghcr.io/xcq0607/lxserver:latest`. For a pinned deployment, use a version tag that exists in the image registry.

The image writes logs to `/server/data/logs` by default, so the data mount already includes logs. To store logs separately, add `./logs:/server/logs` **and** set `LOG_PATH: /server/logs`. Mounting that directory alone does not change the log destination.

The `cache` and `music` mounts preserve audio in root-directory storage mode. Data-directory storage puts those folders below `/server/data`. Keep the directories used by your account when recreating containers.

### Docker Run

Bash example:

```bash
docker run -d \
  --name lx-sync-server \
  --restart unless-stopped \
  -p 9527:9527 \
  -v "$(pwd)/data:/server/data" \
  -v "$(pwd)/cache:/server/cache" \
  -v "$(pwd)/music:/server/music" \
  -e ADMIN_PASSWORD="replace-with-your-admin-password" \
  -e ENABLE_WEBPLAYER_AUTH=true \
  -e WEBPLAYER_PASSWORD="replace-with-your-player-password" \
  xcq0607/lxserver:latest
```

On Windows PowerShell, Compose avoids differences in multiline shell syntax and host-path expansion.

### Build from source

```bash
git clone https://github.com/XCQ0607/lxserver.git
cd lxserver
npm ci
npm run build
npm start
```

The build generates server JavaScript, player CSS and the file-manager bundle, and checks the audio fingerprint utility. Installation and the first build need access to dependency and binary downloads.

For development, use `npm run dev`. Production runs compiled files in `server/`; changing TypeScript source requires another build before restarting production.

### Compiled releases and desktop app

Download a package from [Releases](https://github.com/XCQ0607/lxserver/releases). Desktop packages vary by release; choose the OS and architecture listed in that release's assets. The desktop app manages its storage separately and can choose another port when `9527` is busy; use the address shown by the app.

A server archive contains compiled files such as `server/`, `public/`, `index.js` and `package.json`. It can be launched directly after extracting it. If production dependencies are absent or incompatible with the target platform, install them first:

```bash
npm install --omit=dev
node index.js
```

GitHub's automatically generated **Source code** archives are source distributions, not compiled server packages. Follow the source-build instructions for those archives.

`node index.js` runs the compiled server without npm lifecycle hooks. `npm start` also runs the repository's prestart steps, which check the fingerprint utility and refresh build metadata. Keep the `scripts/` directory when using the npm startup workflow.

### PM2 and local image builds

After building the project, install PM2 separately and run the supplied ecosystem configuration from the project directory:

```bash
npm install -g pm2
npm run prd
pm2 logs lx-music-sync-server
pm2 status
pm2 save
```

`npm run prd` executes `pm2 start ecosystem.config.js --env production`; it does not compile the project. PM2 is not a project dependency. OS boot integration is a separate setup step; saving a process list alone does not configure it.

To build the image from your current checkout:

```bash
docker build -t lxserver:local .
```

Use `lxserver:local` in your Compose file instead of the registry image. `npm run electron:dist` builds and packages the desktop app; packaging requirements and native-module support depend on the target platform.

### First-run checklist

1. Open `http://server-ip:9527/admin` and sign in with your configured administrator password. The unchanged default is `123456`.
2. Create a personal account in user management and set its sync password.
3. Open the player at `http://server-ip:9527/`. If player access authentication is enabled, enter the player password, then sign in to your personal account as needed.
4. Import and enable a working custom source for online playback.
5. For local music, check the storage selection, mounted paths and account permissions, then scan the directory.

## Connecting clients

### Browser

| Entry | Default URL | Purpose |
| --- | --- | --- |
| Web player | `http://server-ip:9527/` | Search, playback, playlists and local music |
| Admin console | `http://server-ip:9527/admin` | Users, configuration, backups, logs and file management |

`PLAYER_PATH` and `ADMIN_PATH` customize these paths. For example, `/music` puts the player at `http://server-ip:9527/music`. The two paths must differ and cannot occupy `/api`.

Phones and computers use the same service URL. Autoplay, background playback and lock-screen controls depend on browser and operating-system support.

### LX Music desktop and mobile

In the client, open **Settings → Sync Settings** and choose a custom server.

| Mode | Example URL | Password | Requirement |
| --- | --- | --- | --- |
| User path, enabled by default | `http://192.168.1.100:9527/user1` | user1's sync password | `USER_ENABLE_PATH=true`; different users may share a password |
| Root path, disabled by default | `http://192.168.1.100:9527` | The account's sync password | `USER_ENABLE_ROOT=true`; user passwords must be unique |

Do not use `/admin`, `/rest` or the player access password for LX sync. Review merge/overwrite direction during the first synchronization and back up existing playlists before choosing a baseline. More details: [sync guide](docs/en/guide/sync-server.md).

### Subsonic clients

Compatible clients include Yinliu, Feishin and Symfonium. The server implements Subsonic/OpenSubsonic endpoints for library browsing, search, playback and related features; the UI and available features vary by client.

| Field | Value |
| --- | --- |
| Server URL | `http://server-ip:9527/rest` |
| Username | An account created in the admin console |
| Password | That account's sync password |

Some clients append `/rest` themselves. Follow their URL prompt to avoid `/rest/rest`.

By default Subsonic shares the main port. Separate listening requires `subsonic.standalone=true` and a positive `subsonic.port` (default port value: `4050`). **Setting `SUBSONIC_PORT` alone does not enable it.** Map that port in Docker as well. `subsonic.path` controls the protocol path.

Online search uses `subsonic.onlineSearch` and `subsonic.onlineSearchMode`: `fallback` supplements insufficient local results; `merge` combines local and online results; `local_only` stays local. Query prefixes include `wy:`, `tx:`, `kw:`, `kg:`, `mg:`, `online:` and `local:`. Online playback still needs a working custom source.

Local library selection follows the account's saved storage location plus its enabled custom directory. A temporary browsing switch in the web UI does not change that library. Read-only local/custom playlists can be exposed separately. Pure local playlists stay on the server; only the online portion of mixed playlists enters LX native sync.

<p align="center">
  <img src="md/subsonic.png" width="500" alt="Subsonic connection">
  <img src="md/subsonic-search.png" width="300" alt="Subsonic search">
</p>

## Player and music management

### Playback, lyrics and appearance

The responsive player includes a queue, quality selection, playback speed, sleep timer, full-screen lyrics, themes and player backgrounds. Lyrics can include translations, romanization and word highlighting when supplied by the source. Lyric cards offer image layouts for sharing selected lines.

Version and build fingerprint identify the running build, for example `v2.1.4 · build 123abcd`. Include both when reporting custom-build issues.

<p align="center"><img src="md/player.png" width="800" alt="Web player"></p>
<p align="center"><img src="md/controller.png" width="800" alt="Playback controls"></p>

### Search and discovery

Search platforms are Kuwo (`kw`), Kugou (`kg`), QQ Music (`tx`), NetEase (`wy`) and Migu (`mg`). Choose a platform or use aggregation where supported. Artist, album and playlist search availability varies by platform.

Single-source song search fetches results serially on the server and paginates the received list locally. Upstream depth limits and server budgets mean the received count may differ from a platform's reported total.

Metadata search and audio resolution are separate: platforms provide search data, while custom source scripts resolve playback links. Finding a track does not guarantee a playable URL at every quality.

<p align="center"><img src="md/search.png" width="800" alt="Music search"></p>
<p align="center">
  <img src="md/album.png" width="400" alt="Album details">
  <img src="md/singer.png" width="400" alt="Artist details">
</p>

### Playlists, favorites and queue

Manage personal playlists, favorite artists/albums, online playlists, leaderboards and queue order. Personal data belongs to the signed-in account; public favorites have separate visibility and access settings. Editing a personal sync playlist changes synchronized data. Browsing a platform leaderboard does not automatically import it into your playlists.

<p align="center">
  <img src="md/musiclist.png" width="400" alt="Playlist discovery">
  <img src="md/musiclist-detail.png" width="400" alt="Playlist tracks">
</p>
<p align="center">
  <img src="md/playlist.png" width="280" alt="Playback queue">
  <img src="md/cache.png" width="280" alt="Cache management">
</p>

### Local files, downloads and matching

The local music view covers server downloads, cache and authorized custom directories. Inspect audio properties, cover/lyric state and online associations; filter with `&`, `|` and `!`, then apply supported batch operations.

| Operation | Destination or effect |
| --- | --- |
| Browser download | Saves on the visiting device, subject to browser download permission |
| Server download/cache | Uses server disk space and network traffic |
| Associate or update metadata | Links local files to platform tracks; relevant actions can rewrite tags |
| Embed lyrics | Writes supported audio lyric tags |
| Remaster | Resolves and downloads another available quality to replace a linked file; this is separate from playback transcoding |

The persistent server download queue supports progress, concurrency changes, resume and removal. Closing a page does not itself cancel a server task.

Automatic matching processes selected unlinked files, records per-track results and supports cancellation. It defaults to concurrency 2 (range 1–4). Restart marks an unfinished task as interrupted; review remaining files and start another task. Matching is not guaranteed to distinguish every live, remastered or similarly named recording.

Mount an existing NAS library before assigning it to an account. With `/mnt/nas/music:/library:ro`, enter `/library` in the admin console, not the host path. Read-only mounts support browsing/playback; tag writes, deletion and replacement also require filesystem write access and account permission.

<p align="center"><img src="md/localmusic.png" width="800" alt="Local music and filtering"></p>
<p align="center"><img src="md/favorite.png" width="800" alt="Favorites"></p>

### Sound effects, casting and background playback

The player has an equalizer and pitch controls. Audio processing depends on browser audio capabilities and resource access. If native playback or AirPlay needs restoring after audio processing, use the sound-effects panel's restore control.

Chromecast is available in supported desktop/Android Chromium browsers in a secure context, normally HTTPS. The receiver must be able to reach the server and media URL. Browser-only `blob:`/file URLs cannot be fetched by the receiver. Casting does not apply browser sound effects or playback speed; iOS uses its native AirPlay path. See the [player guide](docs/en/guide/web-player.md).

### Custom sources and scheduled downloads

Import a source script by URL or upload, enable it and choose supported platforms/qualities. Source order and account-specific preferences affect resolution. Missing or expired links, platform restrictions and source failures can still prevent playback.

Network-playlist checks and sync-download tasks are configured separately. Check their last run, next run and result state in the UI. Enabling playlist synchronization alone does not enable automatic audio downloads.

<p align="center">
  <img src="md/theme.png" width="400" alt="Themes">
  <img src="md/settings.png" width="400" alt="Player settings">
</p>
<p align="center">
  <img src="md/share.png" width="380" alt="Lyric card">
  <img src="md/source.png" width="420" alt="Custom sources">
</p>

## Accounts and permissions

| Credential | Setting | Purpose |
| --- | --- | --- |
| Administrator password | `admin.password` / `ADMIN_PASSWORD` | Console and administrative operations |
| Player access password | `player.password` / `WEBPLAYER_PASSWORD` | Entering the web player when player access authentication is enabled |
| User sync password | User management / `LX_USER_<username>` | Personal login, LX sync and Subsonic |

The player access password does not create a personal account or grant file-write permission.

Public restrictions default to enabled. Separate settings govern non-admin local music, browser downloads, server cache, public favorites and cache limits. Logging in does not bypass every restriction.

Custom directories require account settings `enableCustomMusicDir` and `customMusicDir`. `allowOperateCustomMusicDir` controls deletion/replacement operations; `allowWriteCustomMusicDir` controls association, metadata and lyric writes. Filesystem permissions apply as well.

For scripts, use the personal Token management UI to create, name, expire, disable or remove persistent API tokens. A user token is not an administrator password. Revoking one token is preferable to sharing account credentials across scripts. See the [API reference](docs/en/api/reference.md).

## Storage, backups and updates

| Location | Contents |
| --- | --- |
| `data/` or `DATA_PATH` | Configuration, accounts, playlists, preferences and runtime state |
| `data/config.js` unless `CONFIG_PATH` is set | Active server configuration |
| Root `cache/` and `music/` | Audio/indexes in root-directory storage mode |
| Data-directory `cache/` and `music/` | Audio/indexes in data-directory storage mode |
| Custom library path | Existing external audio files; preserve its mounts separately |
| Log directory | Source default: `logs/`; image default: `data/logs/` |

Audio folders are further scoped by account. A temporary browse switch neither moves files nor changes the saved account location.

Keep `subsonic-local-registry.json` and `subsonic-local-state.json` with user data: they preserve local identities, favorites and playlist relationships. They are not disposable audio caches.

Playlist snapshots restore playlists; configuration backups restore configuration. Neither substitutes for audio backups. Configuration backups default to a seven-day retention period under the data directory's `backups/` folder.

WebDAV supports remote sync and backups. Startup with WebDAV configured can restore remote data and reload configuration/accounts. Confirm the remote namespace before connecting a new installation. `WEBDAV_EXCLUDE_CACHE` and `WEBDAV_EXCLUDE_MUSIC` exclude the corresponding audio folders within data; they do not back up external or root-directory libraries for you.

For container updates:

```bash
docker compose pull
docker compose up -d
docker compose logs --tail=100
```

Preserve all used storage first. Source updates require dependency installation, rebuilding and restarting. Verify account access, playlists, local scanning and actual playback after migration.

## Configuration

The default configuration is `data/config.js`. `DATA_PATH` changes the data directory; `CONFIG_PATH` selects an external configuration file. If the target configuration is absent on first start, the server tries to initialize it from the legacy/bundled root configuration.

Normal startup merges defaults, configuration and environment variables. WebDAV restoration can subsequently reload remote configuration and accounts, so environment variables do not universally remain the final authority. Check the active path and effective values in the console.

Environment changes need a process restart or container recreation. Some console changes apply immediately; listener/path changes can require restart and reconnection.

### Environment variables

Defaults below refer to code defaults. Bundled configuration, saved values and image environment can differ; Docker data/log paths are described above.

| Environment variable | Config key | Description | Default |
| --- | --- | --- | --- |
| `PORT` | `port` | Service port | `9527` |
| `BIND_IP` | `bindIP` | Listening interface | `0.0.0.0` |
| `ADMIN_PATH` | `admin.path` | Backend management interface path | `/admin` |
| `PLAYER_PATH` | `player.path` | Web player access path (default root `/`) | `/` |
| `ADMIN_PASSWORD` | `admin.password` | Admin password (for management console and music player admin login) | `123456` |
| `SERVER_NAME` | `serverName` | Sync service name (shown in client pairing & admin console title) | `LX Sync Server` |
| `PLAYER_NAME` | `player.name` | Web player name (shown in web player title & login card) | `LX Music Web` |
| `ENABLE_DEBUG` | `debug.enabled` | Enable DEBUG mode (verbose debug and source sandbox logs, default false) | `false` |
| `MAX_SNAPSHOT_NUM` | `maxSnapshotNum` | Max snapshots to keep | `10` |
| `CONFIG_PATH` | - | Absolute path to external config file (defaults to `data/config.js`) | - |
| `DATA_PATH` | - | Absolute path to data storage directory | `./data` |
| `LOG_PATH` | - | Absolute path to log output directory | `./logs` |
| `PROXY_HEADER` | `proxy.header` | Original client IP header supplied by reverse proxy | `x-real-ip` |
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
| `WEBDAV_EXCLUDE_CACHE` | `webdav.excludeCache` | Exclude cache dir from sync (`data/cache/<user>`). When enabled, skips incremental sync & full backup (already-synced files are NOT deleted) | `false` |
| `WEBDAV_EXCLUDE_MUSIC` | `webdav.excludeMusic` | Exclude music/download dir from sync (`data/music/<user>`). When enabled, skips incremental sync & full backup (already-synced files are NOT deleted) | `false` |
| `ENABLE_WEBPLAYER_AUTH` | `player.enableAuth` | Enable Web Player password | `false` |
| `WEBPLAYER_PASSWORD` | `player.password` | Web Player password | `123456` |
| `DISABLE_TELEMETRY` | `disableTelemetry` | Disable anonymous telemetry and update notifications | `false` |
| `ENABLE_PUBLIC_USER_RESTRICTION` | `user.enablePublicRestriction` | Enable public user permission restriction (restrict upload/delete public sources) | `true` |
| `ENABLE_PUBLIC_NON_ADMIN_LOCAL_MUSIC` | `user.enablePublicNonAdminLocalMusic` | Enable non-admin access to local music (allows non-admin public accounts to access local music) | `false` |
| `ENABLE_PUBLIC_NON_ADMIN_BROWSER_DOWNLOAD` | `user.enablePublicNonAdminBrowserDownload` | Enable non-admin browser download (allows non-admin/public accounts to download songs via browser) | `true` |
| `ENABLE_PUBLIC_NON_ADMIN_SERVER_CACHE` | `user.enablePublicNonAdminServerCache` | Enable non-admin server cache (allows non-admin/public accounts to cache songs on server) | `false` |
| `ENABLE_PUBLIC_FAVORITES` | `user.enablePublicFavorites` | Enable public favorites and songs (allows guest/public to view and play public favorites) | `false` |
| `ENABLE_PUBLIC_NON_ADMIN_ACCESS` | `user.enablePublicNonAdminAccess` | Enable non-admin access to public favorites & songs (allows non-admin public accounts to view) | `false` |
| `ENABLE_CUSTOM_MUSIC_DIR` | `user.enableCustomMusicDir` | Enable custom music directories feature globally | `false` |
| `ENABLE_LOGIN_USER_CACHE_RESTRICTION` | `user.enableLoginCacheRestriction` | Enable cache settings restriction for logged-in non-admin users | `false` |
| `ENABLE_CACHE_SIZE_LIMIT` | `user.enableCacheSizeLimit` | Enable cache size limit (auto-cleanup via LRU) | `false` |
| `CACHE_SIZE_LIMIT` | `user.cacheSizeLimit` | Cache size limit in MB | `2000` |
| `CONFIG_BACKUP_ENABLE` | `configBackup.enable` | Enable automatic config.js backup (creates daily backup copy) | `true` |
| `CONFIG_BACKUP_RETENTION_DAYS` | `configBackup.retentionDays` | Config backup retention period in days (auto cleans up expired backups) | `7` |
| `CONFIG_BACKUP_DIR` | `configBackup.dir` | Backup directory, relative to data; empty uses data/backups | `empty` |
| `SNAPSHOT_BACKUP_PATH` | `snapshot.backupPath` | Custom storage path for playlist snapshots (absolute or relative to `./data`) | - |
| `LIST_ADD_MUSIC_LOCATION_TYPE` | `list.addMusicLocationType` | Position when adding songs to list (`top` / `bottom`) | `top` |
| `PROXY_ALL_ENABLED` | `proxy.all.enabled` | Enable outgoing request proxy (for Music SDK) | `false` |
| `PROXY_ALL_ADDRESS` | `proxy.all.address` | Proxy address (supports http:// or socks5://) | - |
| `SINGER_SOURCE_PRIORITY` | `singer.sourcePriority` | Singer info retrieval priority (e.g., `tx,wy` or `wy,tx`) | `tx,wy` |
| `SUBSONIC_ENABLE` | `subsonic.enable` | Enable Subsonic API support | `true` |
| `SUBSONIC_PATH` | `subsonic.path` | Subsonic API access path (default `/rest`) | `/rest` |
| `SUBSONIC_PORT` | `subsonic.port` | Separate port; requires subsonic.standalone=true | `4050` |
| `SUBSONIC_ENABLE_DEBUG` | `subsonic.enableDebug` | Enable Subsonic debug log mode | `false` |
| `SUBSONIC_ONLINE_SEARCH` | `subsonic.onlineSearch` | Enable Subsonic online search | `true` |
| `SUBSONIC_ONLINE_SEARCH_MODE` | `subsonic.onlineSearchMode` | Subsonic online search mode (`fallback` / `merge` / `local_only`) | `fallback` |
| `SUBSONIC_ONLINE_SEARCH_SOURCES` | `subsonic.onlineSearchSources` | Subsonic online search default platforms | `wy,tx,kw,kg,mg` |
| `SUBSONIC_PUBLIC_LEADERBOARDS` | `subsonic.publicLeaderboards` | Expose online shared playlists/leaderboards | `false` |
| `SUBSONIC_LEADERBOARD_SOURCE` | `subsonic.leaderboardSource` | Subsonic public leaderboard default platform (single platform, e.g., `tx`, `wy`) | `tx` |
| `SUBSONIC_LYRIC_TRANSLATION` | `subsonic.lyricTranslation` | Include translations in Subsonic lyrics | `true` |
| `SUBSONIC_CACHE_ON_PLAY` | `subsonic.cacheOnPlay` | Trigger server caching on Subsonic playback (cached to user dir) | `false` |
| `SUBSONIC_PLAY_CACHE_FIRST` | `subsonic.playCacheFirst` | Prefer streaming local cached/downloaded files on Subsonic playback (default off, to avoid server egress) | `false` |
| `SUBSONIC_QUALITY_ENABLED` | `subsonic.quality.enabled` | Enable Subsonic audio quality selection | `true` |
| `SUBSONIC_QUALITY_PRIORITY` | `subsonic.quality.priority` | Subsonic audio quality priority order (e.g. `flac,320k,128k`) | `flac,320k,128k` |
| `SUBSONIC_SOURCE_PRIORITY` | `subsonic.source.priority` | Cross-platform candidate priority | `kw,tx,wy,mg,kg` |
| `SUBSONIC_SOURCE_CROSS_PLATFORM` | `subsonic.source.crossPlatform` | Allow cross-platform candidate lookup | `true` |
| `SUBSONIC_SOURCE_AUTOSWITCH_CUSTOM` | `subsonic.source.autoSwitchCustom` | Try other custom scripts on the same platform | `true` |
| `ARTIST_MAX_FETCH_PAGES` | `artist.maxFetchPages` | Maximum fetch pages for artist tracks | `20` |
| `CACHE_NAMING_PATTERN` | `cache.namingPattern` | simple, standard, singer_name_quality_album, singer_name, name_singer | `simple` |
| `SYSTEM_ALLOW_UNSAFE_VM` | `system.allowUnsafeVM` | Allow VM mode custom source scripts (note security risks) | `false` |
| `LX_USER_<username>` | `users` | Create account using a password string | — |

Boolean values are case-insensitive: `true/1/yes/y/on` and `false/0/no/n/off`.

`LX_USER_<username>` accepts a password string. Use user management for advanced account settings; JSON in that environment variable is not an advanced-account configuration format.

Options without environment mappings include `subsonic.standalone`, `subsonic.localPlaylist`, `subsonic.customPlaylist` and category proxies `proxy.music.*`, `proxy.customSource.*`, `proxy.app.*`. Category proxy `enabled` inherits the global setting when unset, forces direct connection when false and enables that category's proxy when true; an empty category address falls back to the global address.

See the [configuration guide](docs/en/guide/configuration.md) and [code defaults](src/defaultConfig.ts).

## Troubleshooting

| Symptom | First checks |
| --- | --- |
| Search works, playback fails | Enabled source, supported platform/quality, resolution logs, URL expiry and network/proxy reachability |
| Empty local library | Account, saved storage location, container path, mount access and scan result |
| Web files missing in Subsonic | Same account, saved location rather than temporary browsing, custom-directory and local-playlist switches |
| Settings revert after restart | Environment values, active config path and WebDAV restore logs |
| Old UI after update | Actual running process/container, completed build, build fingerprint and browser refresh |
| Sync fails behind a proxy | Preserved paths, WebSocket upgrade, timeouts and forwarded endpoint paths |
| Casting sees a receiver but cannot play | Receiver access to server/media, supported codec and secure browser context |
| Remaster skips tracks | Missing platform association, existing target quality, unavailable replacement or write permissions |

When reporting an issue, include version/build fingerprint, deployment method, client, steps and logs with passwords/tokens removed.

## Development and APIs

The backend uses Node.js HTTP and `ws`, primarily in TypeScript. Player and console use vanilla JavaScript; the file manager uses VueFinder.

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | Startup and configuration |
| `src/server/server.ts` | HTTP routing and service setup |
| `src/server/auth/` | Authentication and access control |
| `src/server/integrations/` | Subsonic, file manager and casting integration |
| `src/server/music/` | Local music, cache and file handling |
| `src/server/sources/` | Custom source loading and invocation |
| `src/server/sync/` | WebSocket synchronization |
| `src/server/task/` | Downloads, matching, remaster and scheduled tasks |
| `public/music/` | Web player resources |
| `scripts/` | Build and maintenance tools |
| `docs/` | VitePress documentation |

```bash
npm run dev          # Development
npm run build        # Server and generated frontend resources
npm run build:css    # Player CSS only
npm run build:files  # File manager only
npm test             # Repository tests
npm ci --prefix docs
npm run docs:build --prefix docs
```

Admin APIs usually use `x-frontend-auth`; user APIs usually use `x-user-token`; the player has session cookies. These credentials are not interchangeable. `/api/music/search` returns an object with `list`, not a bare array. Use a positive explicit `limit` for one-page song retrieval. Refer to the API documentation for endpoint-specific behavior.

## Telemetry and notifications

The project includes PostHog statistics and version/announcement notification logic. Set `DISABLE_TELEMETRY=true` to disable the associated functionality; corresponding update/announcement prompts are also unavailable. You can check [changelog](changelog.md) and [Releases](https://github.com/XCQ0607/lxserver/releases) manually.


## 🤝 Credits & Acknowledgements

- Forked from [lyswhut/lx-music-sync-server](https://github.com/lyswhut/lx-music-sync-server).
- Web player logic inspired by [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop).

### 👥 Contributors

<a href="https://github.com/xcq0607/lxserver/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=xcq0607/lxserver" />
</a>

## 📈 Star History


<a href="https://www.star-history.com/?repos=xcq0607%2Flxserver&type=timeline&logscale=&releases=&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=xcq0607/lxserver&type=timeline&theme=dark&logscale&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=xcq0607/lxserver&type=timeline&logscale&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=xcq0607/lxserver&type=timeline&logscale&legend=bottom-right" />
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
