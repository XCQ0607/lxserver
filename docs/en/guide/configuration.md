# Configuration, environment and storage

The default configuration is `data/config.js`. `DATA_PATH` changes the data directory; `CONFIG_PATH` selects an external configuration file. If the target configuration is absent on first start, the server tries to initialize it from the legacy/bundled root configuration.

Normal startup merges defaults, configuration and environment variables. WebDAV restoration can subsequently reload remote configuration and accounts, so environment variables do not universally remain the final authority. Check the active path and effective values in the console.

Environment changes need a process restart or container recreation. Some console changes apply immediately; listener/path changes can require restart and reconnection.

### Environment variables

Defaults below refer to code defaults. Bundled configuration, saved values and image environment can differ; Docker data/log paths are described in the [deployment guide](./getting-started.md).

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

See the [code defaults](https://github.com/XCQ0607/lxserver/blob/main/src/defaultConfig.ts).

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

## Advanced account and path settings

### Configuration fragment

This example illustrates the separate Subsonic listener and a user directory. Merge the fields into your existing object; do not replace a complete configuration with this fragment:

```js
module.exports = {
  'subsonic.enable': true,
  'subsonic.standalone': true,
  'subsonic.port': 4050,
  'user.enableCustomMusicDir': true,
  users: [
    {
      name: 'user1',
      password: 'replace-with-your-user-password',
      enableCustomMusicDir: true,
      customMusicDir: '/library',
      allowOperateCustomMusicDir: false,
      allowWriteCustomMusicDir: false,
    },
  ],
}
```

`/library` is a Linux/container example. A direct Windows run can use a real path such as `D:/Music`. Leave operation/write permissions disabled while verifying browsing and playback. A separate Docker listener also needs a `4050:4050` port mapping.

### Set a temporary startup environment

Bash:

```bash
DATA_PATH=/absolute/path/to/test-data PORT=9528 npm run dev
```

PowerShell:

```powershell
$env:DATA_PATH = 'D:\lxserver-test-data'
$env:PORT = '9528'
npm run dev
```

These commands do not change other terminals' environments. Use a directory separate from your regular instance and check that the test configuration does not restore the same WebDAV namespace.

Use user management for custom paths, operation/write permissions, automatic downloads and account disablement. Manual configuration uses the JavaScript configuration object's users array; existing users.json and remote restoration also affect the final account list. Editing only the root example config does not necessarily override deployed accounts.

Paths belong to the server's environment: host paths for source runs, container paths for Docker. Application permission cannot override a read-only filesystem mount. Browsing another location does not move audio; storage migration is a separate operation.

## Checks after changing configuration

- Ports: verify main/separate Subsonic listeners and matching container mappings.
- Paths: check player, console and clients; avoid duplicated proxy prefixes.
- Proxies: distinguish outgoing category proxies from media forwarding; verify search and actual playback separately.
- Directories: check mounts, account permissions and scans, not just saved strings.
- WebDAV: check remote namespace, exclusions, recovery logs and effective settings.

See [deployment](./getting-started.md) and [operations](./operations.md).
