# Sync, accounts and admin console

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

Do not use `/admin`, `/rest` or the player access password for LX sync. Review merge/overwrite direction during the first synchronization and back up existing playlists before choosing a baseline. More details: [sync guide](../guide/sync-server.md).

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



## Accounts and permissions

| Credential | Setting | Purpose |
| --- | --- | --- |
| Administrator password | `admin.password` / `ADMIN_PASSWORD` | Console and administrative operations |
| Player access password | `player.password` / `WEBPLAYER_PASSWORD` | Entering the web player when player access authentication is enabled |
| User sync password | User management / `LX_USER_<username>` | Personal login, LX sync and Subsonic |

The player access password does not create a personal account or grant file-write permission.

Public restrictions default to enabled. Separate settings govern non-admin local music, browser downloads, server cache, public favorites and cache limits. Logging in does not bypass every restriction.

Custom directories require account settings `enableCustomMusicDir` and `customMusicDir`. `allowOperateCustomMusicDir` controls deletion/replacement operations; `allowWriteCustomMusicDir` controls association, metadata and lyric writes. Filesystem permissions apply as well.

For scripts, use the personal Token management UI to create, name, expire, disable or remove persistent API tokens. A user token is not an administrator password. Revoking one token is preferable to sharing account credentials across scripts. See the [API reference](../api/reference.md).

## Subsonic library and playback options

| Setting / feature | Behavior and requirements |
| --- | --- |
| Local music folder | Explicit local-folder selection uses the local library; the default recommendation pool is not the entire NAS library |
| `subsonic.localPlaylist` / `subsonic.customPlaylist` | Read-only local and separate custom-directory playlists; custom depends on the local switch and account directory enablement |
| `subsonic.cacheOnPlay` | Save online audio during playback, default false |
| `subsonic.playCacheFirst` | Prefer an existing server file, default false; server carries the file traffic |
| `subsonic.quality.*` / `subsonic.source.*` | Quality and platform/script candidate selection, not guaranteed availability |
| `subsonic.transcode.enabled` | Playback-time server transcoding, default false; requires ffmpeg, separate from remaster replacement downloads |
| `subsonic.transcode.format` / `subsonic.transcode.maxConcurrent` | Defaults: mp3, concurrency 2; formats mp3/opus/aac |
| Favorites and ratings | Local favorites use star/unstar; rating/dislike links have independent switches |
| Internet radio | Account-scoped create/update/delete/list endpoints; client editing UI depends on client support |

Local tracks have independent IDs; associating a platform does not make them online tracks. Updating at the same path generally retains identity, while moving/renaming externally can assign a new ID. Mixed playlists preserve local members/order separately. Deleting a playlist does not delete its audio files.

Artwork, word lyrics, scan display and folders depend on both protocol and client support. A web setting does not imply an equivalent control exists in every third-party client.

## Console modules

| Module | Typical actions | Notes |
| --- | --- | --- |
| Status/devices | Inspect uptime, resources and connected devices | Device connectivity does not prove a download task is running |
| Users | Create, rename, disable and assign directories | Distinguish removing an account from deleting its data |
| Data/snapshots | Inspect playlists and restore past state | Verify account and timestamp before restoring |
| Configuration | Paths, authentication, proxies, cache and Subsonic | Environment/WebDAV recovery can affect the next start |
| WebDAV | Test, sync, back up and restore | Incremental/full backups have separate intervals |
| File manager | Upload, edit, move and archive server files | Administrative filesystem access, not ordinary library permission |
| Logs/maintenance | Inspect errors, reload or restart | Changed ports/paths require a new connection address |

## First sync and recovery

Create the account before connecting. Review merge/overwrite direction and back up existing playlists. To recover, select the correct account and snapshot time, reconnect clients and check lists. Playlist restoration does not restore deleted audio files.

User sync and automatic downloads are separate. Account download permission, playlist selection and quality settings determine what is downloaded; enabling LX sync alone does not download every track.

## File manager

The console uses VueFinder with virtual roots `root://` (working directory) and `data://` (data). It supports upload, rename, copy/move, delete, text editing and ZIP archive/extraction. APIs require administrator authentication; media preview can use a dedicated temporary media session.

The application limits uploads to 1 GiB per file and text edits to 8 MiB; a reverse proxy may impose smaller limits. Storage roots cannot themselves be modified, and path validation rejects escapes and symlink traversal. Save/delete acts on real files: verify the destination and backup first.

## API tokens

Personal persistent tokens can be named, expired, disabled or removed for scripts. Administrator endpoints still need administrator credentials. Subsonic uses its own username/password protocol authentication. These credentials are not interchangeable.

See [API reference](../api/reference.md) for request/response details and [operations](./operations.md) for backups and migration.
