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

Compatible clients include Yinliu, Feishin and Symfonium. The server implements Subsonic/OpenSubsonic endpoints for library browsing, search, playback and related features; the UI and available features vary by client. See [Subsonic protocol support](../api/subsonic.md) for coverage and limits.

| Field | Value |
| --- | --- |
| Server URL | `http://server-ip:9527/rest` |
| Username | An account created in the admin console |
| Password | That account's sync password |

Some clients append `/rest` themselves. Follow their URL prompt to avoid `/rest/rest`.

By default Subsonic shares the main port. Separate listening requires `subsonic.standalone=true` and a positive `subsonic.port` (default port value: `4050`). **Setting `SUBSONIC_PORT` alone does not enable it.** Map that port in Docker as well. `subsonic.path` controls the protocol path.

Online search uses `subsonic.onlineSearch` and `subsonic.onlineSearchMode`: `fallback` supplements insufficient local results; `merge` combines local and online results; `local_only` stays local. Query prefixes include `wy:`, `tx:`, `kw:`, `kg:`, `mg:`, `online:` and `local:`. Online playback still needs a working custom source.

Local library selection follows the account's saved storage location plus its enabled custom directory. A temporary browsing switch in the web UI does not change that library. Read-only local/custom playlists can be exposed separately. Pure local playlists stay on the server; only the online portion of mixed playlists enters LX native sync. See [Subsonic local music library](./subsonic-local-library.md).



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
| `subsonic.cachePlaylist` | Include cache-directory tracks in the local playlist, default false; does not shrink the complete library used by other endpoints |
| `subsonic.cacheOnPlay` | Save online audio during playback, default false |
| `subsonic.saveDownload` | Whether downloads are saved on the server, **default off**. Download detection is built in (standard `/rest/download` plus bare okhttp + gzip stream downloads); when enabled, detected files go to the music download dir instead of cache. When off, audio is still delivered to the client but the server keeps no file, no play-prefetch and no backup upload |
| `subsonic.playCacheFirst` | Prefer an existing server file, default false; server carries the file traffic |
| `subsonic.quality.*` / `subsonic.source.*` | Quality and platform/script candidate selection, not guaranteed availability |
| `subsonic.transcode.enabled` | Playback-time server transcoding, default false; requires ffmpeg, separate from remaster replacement downloads |
| `subsonic.transcode.format` / `subsonic.transcode.maxConcurrent` | Defaults: mp3, concurrency 2; formats mp3/opus/aac |
| Favorites and ratings | Local favorites use star/unstar; rating/dislike links have independent switches |
| Internet radio | Account-scoped create/update/delete/list endpoints; client editing UI depends on client support |

Local tracks have independent IDs; associating a platform does not make them online tracks. Updating at the same path generally retains identity, while moving/renaming externally can assign a new ID. Mixed playlists preserve local members/order separately. Deleting a playlist does not delete its audio files.

Artwork, word lyrics, scan display and folders depend on both protocol and client support. A web setting does not imply an equivalent control exists in every third-party client. See [Subsonic local music library](./subsonic-local-library.md) for details.

## Console modules

| Module | Typical actions | Notes |
| --- | --- | --- |
| Status/devices | Inspect uptime, resources and connected devices | Device connectivity does not prove a download task is running |
| Users | Create, rename, disable and assign directories | Distinguish removing an account from deleting its data |
| Data/snapshots | Inspect playlists and restore past state | Verify account and timestamp before restoring |
| Configuration | Paths, authentication, proxies, cache and Subsonic | Environment/WebDAV recovery can affect the next start |
| Backup management | Local backups, WebDAV, OpenList, recovery and verification | Connections/scopes in Cloud backup; preview recovery and restart when requested |
| File manager | Upload, edit, move and archive server files | Administrative filesystem access, not ordinary library permission |
| Logs/maintenance | Inspect errors, reload or restart | Changed ports/paths require a new connection address |

## First sync and recovery

Create the account before connecting. Review merge/overwrite direction and back up existing playlists. To recover, select the correct account and snapshot time, reconnect clients and check lists. Playlist restoration does not restore deleted audio files.

### Aligning existing filenames after a naming-format change

After switching the format in Settings → Song naming, **only newly created files use the new format**; existing files are not renamed automatically. Two manual entries under Cloud backup → OpenList align the whole library with the currently effective format:

- **Preview (read-only)**: `POST /api/openlist/cache/rename` with `mode: "preview"` (the default). Changes nothing and is safe to call repeatedly. Returns `scanned` / `ready` / `unchanged` / `conflicts` / `missing` counts, the effective pattern per user, and each old → new filename.
- **Apply rename**: `POST /api/openlist/cache/rename` with `mode: "apply"`. Optional `user` / `folder` / `limit`; `cloud: false` limits changes to local disk and the backup database.

Each file is updated in four places together, so no duplicate uploads or orphaned files appear:

| Place | What changes |
| --- | --- |
| Local disk | Audio file, same-stem `.lrc`, external cover cache (re-hashed under the new filename) |
| Cache index | `filename` / `lyricFilename` in `cache_index.json` / `music_index.json` |
| OpenList backup DB | `local_path` / `remote_path` / `name` / `cache_metadata` in `openlist_backup_files`, the `openlist_local_files` path and filename, attachment local/remote paths |
| Cloud | OpenList's native rename API (audio plus same-stem attachments) — **metadata only, audio bytes are never re-uploaded** |

The target format comes entirely from existing config (per-user `settings.json` `serverCacheNamingPattern` first, then global `cache.namingPattern`), reusing `getFileName` for all five patterns and its collision-suffix rule. **No format is hard-coded, no config is modified, and nothing happens automatically.** Target-name collisions are skipped, never overwritten; each item is idempotent, so re-running after an interruption converges the remaining work. When cloud sync is disabled, local files and DB rows (including `remote_path`) are still updated so a later sync uploads under the new name instead of leaving stale paths.

Concurrency protection: renaming touches the cloud, then the local disk, then the backup DB, leaving a brief window where the local file already has the new name while the DB still has the old one. A sync landing in that window would treat the new name as a new file, insert a duplicate row and upload it again. Rename therefore runs **mutually exclusive** with sync, background verification and the upload queue: the apply entry point refuses to start while any of them is running, and no new sync or verification starts mid-rename. Preview is read-only and unaffected.

**Scope is audio plus its same-stem attachments only.** Playlists, dislike/rating snapshots (`snapshot_*.json`, `snapshotInfo.json`) and user settings are not renamed — their filenames are structural (derived from user and data type, not the song naming pattern) and their bodies store song IDs, not audio filenames. The only adjacent file that changes is `music_index.json` / `cache_index.json`: its `filename` / `lyricFilename` entries are rewritten and saved during the rename, so the next sync sees a content-hash change and re-uploads that one data file. If that backup type is not enabled, the cloud copy never existed.

The recovery manifest `_system/recovery/latest.json` is an **overall snapshot, not a per-record backup**: at the end of a full sync a local content fingerprint is compared with the last cloud copy; identical means zero writes, zero object probes and zero history traversal. Only changed content adds hash-addressed objects plus two small JSON files (`history/`, `latest.json`). Audio files are immutable and independent — uploaded once, never re-sent because of a manifest publish. Playlists, config and databases are cumulative/mutable, so their history versions are content-deduplicated and pruned by the configured retention days.

User sync and automatic downloads are separate. Account download permission, playlist selection and quality settings determine what is downloaded; enabling LX sync alone does not download every track.

### Sync cost and tuning

The cost comes mainly from "one remote probe plus one full-file SHA-256 per registered row, every round", not from uploaded bytes. Defaults now keep it bounded:

| Mechanism | Default behavior |
| --- | --- |
| Scheduled full sync | `openlist.syncInterval = 60` minutes |
| Background status check | `openlist.verifyInterval = 5` minutes |
| Event-driven sync | Config saves and audio/snapshot writes only set a dirty flag and are merged; at least 5 minutes between event-triggered syncs. Manual and scheduled syncs bypass the throttle |
| Verified rows | No per-row `getFileInfo` on normal rounds; rechecked only on a baseline change, abnormal state, pending `upload-delete` cleanup, or the hourly fallback |
| Local content hash | One SHA-256 per file per sync round; always recomputed across rounds, so same-size edits with a restored mtime are still detected |

`openlist-backup.db` (with its WAL/SHM files) is runtime state and is **never uploaded** to OpenList. After losing the database, recovery relies on the cloud manifest and its content-addressed objects.

To reduce cost further, tune config before changing code: raise `openlist.verifyInterval` and `openlist.syncInterval`, narrow `backup.openlist.types` to the needed `snapshots` / `system` types, and lower `configBackup.retentionDays` to shrink config-history listing. The trade-off is longer cloud visibility delay. Do not switch to per-record immediate uploads, and there is no need to lower the manifest publish frequency — unchanged content means zero writes and zero object probes.

## File manager

The console uses VueFinder with virtual roots `root://` (working directory) and `data://` (data). It supports upload, rename, copy/move, delete, text editing and ZIP archive/extraction. APIs require administrator authentication; media preview can use a dedicated temporary media session.

The application limits uploads to 1 GiB per file and text edits to 8 MiB; a reverse proxy may impose smaller limits. Storage roots cannot themselves be modified, and path validation rejects escapes and symlink traversal. Save/delete acts on real files: verify the destination and backup first.

## API tokens

Personal persistent tokens can be named, expired, disabled or removed for scripts. Administrator endpoints still need administrator credentials. Subsonic uses its own username/password protocol authentication. These credentials are not interchangeable.

See [API reference](../api/reference.md) for request/response details and [operations](./operations.md) for backups and migration.
