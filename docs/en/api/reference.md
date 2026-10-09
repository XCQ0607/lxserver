# Server API Reference

LX Sync Server provides a comprehensive and robust suite of RESTful and SSE streaming API endpoints for managing sync server data, multi-user accounts, audio file caching, custom directories, and system operations.

---

## Overview & Authentication

To ensure security, server endpoints enforce different authentication mechanisms based on the operation's sensitivity level:

1. **Administrator Authentication (`x-frontend-auth`)**:
   - Header: `x-frontend-auth: <Admin Password>`
   - Uses the master administrator password (`admin.password`). Required for global configurations, user administration, file manager, WebDAV backup/restore, and server process restarts.
2. **User Token Authentication (`x-user-token`)**:
   - Header: `x-user-token: <Token>` or Query string: `?token=<Token>` for stream endpoints.
   - Uses a session token issued upon login or a persistent API token. Used for operating user-specific playlists, favorite libraries, dislike rules, cache management, and sound effects.
3. **Web Player Cookie Authentication (`lx_player_session`)**:
   - Uses an HttpOnly `lx_player_session` cookie for independent web player access control.
4. **Public / Guest Mode (`_open`)**:
   - Access without password or with `user=_open` / `x-user-name: _open`, governed by `user.enablePublicRestriction` and `user.enablePublicFavorites`.

> [!NOTE]
> Unless otherwise specified (e.g. audio streams or binary downloads), all API requests and responses use JSON format (`Content-Type: application/json; charset=utf-8`).

---

## 1. Authentication & Account Management API

### 1.1 Admin: Service Status & Monitoring
- **`GET /api/status`**
  - **Auth**: Administrator (`x-frontend-auth`)
  - **Description**: Returns CPU usage, memory consumption, active devices, uptime, loaded music sources count, WebDAV status, and operating system info.

### 1.2 Admin: User Management
- **`GET /api/users`**
  - **Auth**: Administrator (`x-frontend-auth`)
  - **Description**: List all users, passwords, and custom music directory permissions.
- **`POST /api/users`**
  - **Auth**: Administrator (`x-frontend-auth`)
  - **Body**: `{"name": "username", "password": "password"}`
  - **Description**: Create a new user and initialize user storage directory.
- **`PUT /api/users`**
  - **Auth**: Administrator (`x-frontend-auth`)
  - **Body**: `{"name": "oldName", "newName": "newName", "password": "...", "enableCustomMusicDir": true, "customMusicDir": "/path/to/music", "allowOperateCustomMusicDir": true, "allowWriteCustomMusicDir": true, "enableAutoDownload": false}`
  - **Description**: Rename user (auto-migrating physical files and sync state), update password, or change directory permissions.
- **`DELETE /api/users`**
  - **Auth**: Administrator (`x-frontend-auth`)
  - **Body**: `{"names": ["user1", "user2"], "deleteData": true}`
  - **Description**: Batch or single user deletion, with optional physical directory cleanup.

### 1.3 User: Authentication & Credentials
- **`POST /api/user/verify`**
  - **Description**: Legacy plain username/password verification (`{"username": "...", "password": "..."}`).
- **`POST /api/user/login`**
  - **Body**: `{"username": "...", "password": "..."}`
  - **Response**: `{"success": true, "token": "lx_tk_...", "username": "..."}`
  - **Description**: Login and issue a dynamic Session Token.
- **`POST /api/user/logout`**
  - **Auth**: User Token (`x-user-token`)
  - **Description**: Invalidate the current session token.
- **`GET /api/user/auth/verify`**
  - **Auth**: User Token (`x-user-token`)
  - **Response**: `{"valid": true, "username": "...", "enableCustomMusicDir": true, "allowOperateCustomMusicDir": true, "enableAutoDownload": true}`
  - **Description**: Verify token validity and retrieve current user feature flags.

### 1.4 Admin: Quick Verify
- **`POST /api/admin/verify`**
  - **Body**: `{"password": "..."}`
  - **Description**: Validate administrator password.

---

## 2. Token Security Management API (Persistent API Keys)

Used for managing persistent API Tokens for third-party scripts and clients. Requires `x-user-token`.

- **`GET /api/user/token/config`**: Get token system status and all user tokens.
- **`POST /api/user/token/config`**: Enable or disable persistent token authentication (`{"enabled": true/false}`).
- **`POST /api/user/token/add`**: Generate a new persistent token (`{"name": "Name", "expireDays": 30, "expiresAt": 1720000000000}`).
- **`POST /api/user/token/remove`**: Remove a token (`{"token": "lx_tk_..."}` or `{"tokenMasked": "..."}`).
- **`POST /api/user/token/update`**: Update token name or expiration time (`{"tokenMasked": "...", "name": "...", "expiresAt": ...}`).
- **`POST /api/user/token/toggle`**: Enable or disable a token (`{"tokenMasked": "...", "disabled": true}`).
- **`GET /api/user/token/logs`**: Get audit logs for a specific token (`?tokenMasked=...`).

---

## 3. Playlists, Snapshots & Music Library API

### 3.1 Playlists Data
- **`GET /api/data?user=<username>`**: Get user's complete playlist data along with favorite artists/albums and dislike rules.
- **`GET /api/user/list`**: Get complete playlist data for current authenticated user.
- **`POST /api/user/list`**: Overwrite user playlists (creates snapshot and broadcasts sync event).
- **`POST /api/music/user/list/add`**: Batch append songs to a playlist (`{"listId": "...", "musicInfos": [...], "location": "top"|"bottom"}`).
- **`POST /api/music/user/list/remove`**: Batch remove songs from a playlist (`{"listId": "...", "songIds": [...]}`).
- **`POST /api/data/delete-playlist`**: Delete a single playlist (`{"user": "...", "id": "..."}`).
- **`POST /api/data/rename-playlist`**: Rename a playlist (`{"user": "...", "id": "...", "name": "..."}`).
- **`POST /api/data/delete-song`**: Delete a song from a playlist (`{"user": "...", "listId": "...", "songId": "..."}`).
- **`POST /api/data/batch-delete-songs`**: Batch delete songs from a playlist (`{"user": "...", "listId": "...", "songIds": [...]}`).

### 3.2 Historical Snapshots
- **`GET /api/data/snapshots?user=<username>`**: List snapshots for a user.
- **`GET /api/data/snapshot?user=<username>&id=<snapshotId>`**: Get data for a specific snapshot.
- **`POST /api/data/restore-snapshot?user=<username>`**: Restore to a specific snapshot (`{"id": "..."}`).
- **`POST /api/data/delete-snapshot?user=<username>`**: Delete a snapshot (`{"id": "..."}`).
- **`POST /api/data/upload-snapshot?user=<username>&filename=<name>&time=<timestamp>`**: Upload external backup (supports auto-conversion of LX Music `playList_v2` format).

### 3.3 Music Library: Favorite Artists & Albums (with Subsonic 2-way Sync)
- **`GET /api/user/library/artists`**: Get favorite artists (automatically fetches missing avatars).
- **`POST /api/user/library/artists`**: Overwrite favorite artists (removes from dislike rules and syncs Subsonic starred).
- **`GET /api/user/library/albums`**: Get favorite albums (auto-completes cover artwork).
- **`POST /api/user/library/albums`**: Overwrite favorite albums (syncs Subsonic starred).

### 3.4 Dislike Rules Library
- **`GET /api/user/dislike/library/artists`**: Get disliked artists.
- **`POST /api/user/dislike/library/artists`**: Update disliked artists (removes from favorites and invalidates cache).
- **`GET /api/user/dislike/library/albums`**: Get disliked albums.
- **`POST /api/user/dislike/library/albums`**: Update disliked albums.
- **`GET /api/music/dislike`**: Get parsed rule set for dislike matching.
- **`POST /api/music/dislike/add`**: Add dislike rule (`{"type": "music"|"singer"|"album", ...}`).
- **`POST /api/music/dislike/remove`**: Remove dislike rule.

### 3.5 User Preferences & Sound Effects
- **`GET /api/user/settings`**: Get user settings.
- **`POST /api/user/settings`**: Save user settings (network list check interval, download quality preferences, etc.).
- **`GET /api/user/sound-effects`**: Get user sound effect & equalizer presets.
- **`POST /api/user/sound-effects`**: Save user sound effects.

---

## 4. Music Search, Resolution & Online Media API

### 4.1 Search & Leaderboards
- **`GET /api/music/search`**: Search songs across platforms (`kw`, `kg`, `tx`, `wy`, `mg`).
- **`GET /api/music/tipSearch`**: Search keyword suggestions (`?source=...&text=...`).
- **`GET /api/music/hotSearch`**: Real-time hot search keywords from online platforms.
- **`GET /api/music/songList/tags`**: Get playlist category tags.
- **`GET /api/music/songList/list`**: Get curated playlists by tag.
- **`GET /api/music/songList/detail`**: Get playlist tracks details (`?source=...&id=...`).
- **`GET /api/music/songList/search`**: Online search for public playlists.
- **`GET /api/music/songList/userPlaylist`**: Get user public playlists from platforms.
- **`GET /api/music/leaderboard/boards`**: Get leaderboard categories.
- **`GET /api/music/leaderboard/list`**: Get songs inside a leaderboard.

### 4.2 Audio URL Resolution & Streaming
- **`POST /api/music/url`**: Resolve audio direct URL (supports quality fallback and multi-source matching).
  - Pass Header `x-req-id: <id>` to track progress.
- **`GET /api/music/progress?reqId=<id>`**: **SSE streaming endpoint**, subscribe to real-time custom source resolution progress.
- **`POST /api/music/quality/size`**: Probe real audio file size across available qualities.
- **`GET /api/music/lyric` / `POST /api/music/lyric`**: Fetch lyrics and translations (lrc, tlrc, rlyric, lxlyric).
- **`POST /api/music/comment`**: Fetch song comments (hot & new comments).
- **`GET /api/music/download`**: Download proxy with automatic ID3 tag, cover art, and lyric injection.

### 4.3 Enhanced Metadata Details
- **`GET /api/music/artistDetail`**: Rich artist profile, follower count, and HD artwork.
- **`GET /api/music/artistAlbums`**: Paged albums of an artist.
- **`GET /api/music/artistSongs`**: Paged songs of an artist.
- **`GET /api/music/albumSongs`**: Get all tracks inside an album.

---

## 5. Server File Cache & Download Queue API

### 5.1 Cache Configuration & Info
- **`POST /api/music/cache/config`**: Set storage mode (`root` / `data`) and naming pattern template (`namingPattern`).
- **`GET /api/music/cache/directories`**: Get real physical absolute paths for cache and download directories.
- **`POST /api/music/cache/sync`**: Rebuild and synchronize local cache index.
- **`GET /api/music/cache/stats`**: Get user's cache statistics (total count, disk bytes).
- **`GET /api/music/cache/list`**: Get detailed list of all cached audio files.
- **`GET /api/music/cache/check`**: Check if a song is already cached on the server.
- **`GET /api/music/cache/cover`**: Get embedded artwork image stream (`?filename=...`).
- **`GET /api/music/cache/file/<user>/<filename>`**: Stream cached audio files (supports HTTP Range).

### 5.2 Subdirectories & Categorization
- **`GET /api/music/cache/subdirs`**: List all subcategories/subdirectories.
- **`POST /api/music/cache/mkdir`**: Create a subfolder (`{"folder": "music", "subPath": "Category"}`).
- **`POST /api/music/cache/categorize`**: Move files into a subcategory folder.
- **`POST /api/music/cache/subdirs/rename`**: Rename a subfolder.
- **`POST /api/music/cache/subdirs/delete`**: Delete a subfolder (with option to delete files within).
- **`POST /api/music/cache/rename`**: Batch rename existing cached files according to current naming pattern.
- **`POST /api/music/cache/move`**: Move file path.
- **`POST /api/music/cache/switch-base`**: Switch cache base directory.

### 5.3 Offline Download Queue & Task Control
- **`GET /api/music/cache/queue`**: List persistent server download queue tasks.
- **`POST /api/music/cache/queue`**: Batch enqueue download tasks (`{"tasks": [...], "concurrency": 3}`).
- **`POST /api/music/cache/queue/concurrency`**: Update download concurrency limit.
- **`POST /api/music/cache/queue/resume`**: Resume or retry failed queue tasks.
- **`POST /api/music/cache/queue/remove`**: Remove tasks from download queue.
- **`POST /api/music/cache/download`**: Trigger immediate single song download.
- **`POST /api/music/cache/stop`**: Stop or pause active download tasks.
- **`GET /api/music/cache/progress`**: Get percentage progress of active downloads.

### 5.4 File Operations & Tagging
- **`POST /api/music/cache/remove`**: Delete cached audio files.
- **`POST /api/music/cache/clear`**: Clear all cached music files for the user.
- **`GET /api/music/cache/lyric` / `POST /api/music/cache/lyric`**: Read or update local lyric cache.
- **`POST /api/music/cache/lyric/clear`**: Clear local lyric cache.
- **`POST /api/music/cache/link`**: Manually link song metadata and rewrite ID3 tags.
- **`POST /api/music/cache/updateMetadata`**: Batch search and overwrite ID3 metadata & cover art.
- **`GET /api/music/cache/embedLyric` / `POST /api/music/cache/embedLyric`**: Embed lyrics into audio USLT tags.
- **`POST /api/music/identify`**: Identify local unknown audio files via AcoustID fingerprinting.

---

## 6. Custom Music Directory & Audio Remastering

### 6.1 Custom Music Directory (`/api/music/custom/*`)
- **`GET /api/music/custom/list`**: List all songs scanned in custom music directory.
- **`POST /api/music/custom/sync`**: Force rescan of custom directory.
- **`GET /api/music/custom/file` / `GET /api/music/custom/file/*`**: Stream audio from custom directory.
- **`GET /api/music/custom/cover`**: Get embedded cover image.
- **`POST /api/music/custom/remove`**: Delete audio file (requires `allowOperateCustomMusicDir` permission).
- **`POST /api/music/custom/link`**: Manually update ID3 tags (requires `allowWriteCustomMusicDir` permission).
- **`POST /api/music/custom/updateMetadata`**: Overwrite ID3 metadata from online sources (requires `allowWriteCustomMusicDir` permission).
- **`GET /api/music/custom/embedLyric` / `POST /api/music/custom/embedLyric`**: Embed lyrics into local files.

### 6.2 Remaster & Quality Upgrade (`/api/music/remaster/*`)
- **`POST /api/music/remaster/start`**: Start remaster queue (downloads higher quality lossless files to replace lower bitrates).
- **`GET /api/music/remaster/status`**: Get remaster task status and progress.
- **`POST /api/music/remaster/cancel`**: Cancel active remaster queue.

---

## 7. Sync Download & Task Scheduler

### 7.1 Sync Download Task
- **`GET /api/user/sync-download/status`**: Get user sync download status, playlist configs, and next scheduled run time.
- **`PUT /api/user/sync-download/settings`**: Update sync download quality preference and per-playlist switches.
- **`POST /api/user/sync-download/trigger`**: Manually trigger immediate download sync.
- **`POST /api/user/sync-download/cancel`**: Pause or cancel active sync task.
- **`GET /api/user/sync-download/progress`**: Poll real-time sync progress.
- **`POST /api/user/sync-download/migrate-storage`**: Migrate downloaded music across storage locations (`root` ↔ `data` ↔ `custom`).

### 7.2 Background Task Scheduler
- **`GET /api/tasks/status`** (alias `/api/music/tasks/status`): Get scheduler status for all background tasks.
- **`POST /api/tasks/trigger`** (alias `/api/music/tasks/trigger`): Manually execute a scheduled task (`?id=network_list_autocheck`).
- **`GET /api/tasks/user-data` / `POST /api/tasks/user-data`**: Retrieve or clear task badge / notification state.

---

## 8. Custom Source Scripts Management API

- **`GET /api/custom-source/list`**: List all loaded custom source scripts, versions, supported platforms, and quality mappings.
- **`POST /api/custom-source/validate`**: Validate script syntax and metadata structure.
- **`POST /api/custom-source/import`**: Import script from a remote URL.
- **`POST /api/custom-source/upload`**: Upload local script file.
- **`POST /api/custom-source/toggle`**: Enable or disable a custom source.
- **`POST /api/custom-source/delete`**: Delete a custom source.
- **`POST /api/custom-source/reorder`**: Adjust custom sources loading priority.
- **`POST /api/custom-source/update-platforms`**: Update supported platforms mapping.

---

## 9. Global Config, WebDAV Backup & Operations (Admin)

### 9.1 Global Configuration & Maintenance
- **`GET /api/config`**: Get full global configuration tree.
- **`POST /api/config`**: Incrementally update configuration items (ports, paths, subsonic behaviors, proxy settings).
- **`POST /api/config/test-proxy`**: Test proxy server connectivity.
- **`POST /api/admin/reload`**: Hot reload `config.js`, `users.json`, and user script sources.
- **`POST /api/restart`** (alias `/api/admin/restart`): Safely restart server process.
- **`GET /api/logs`**: Read access and error logs.
- **`GET /api/stats`**: Performance and memory usage statistics.
- **`POST /api/utils/check-dir`**: Validate if a local directory exists and is accessible.

### 9.2 Local Config Backups
- **`GET /api/config/backups`**: List configuration snapshots.
- **`POST /api/config/backup-now`**: Create immediate config snapshot.
- **`GET /api/config/backups/download?file=<name>`**: Download backup archive.
- **`DELETE /api/config/backups/<fileName>`**: Delete config backup.
- **`POST /api/config/backups/restore`**: Restore configuration snapshot.
- **`GET /api/backup/download`**: Export full user data backup.
- **`POST /api/backup/upload`**: Import and restore user data backup.

### 9.3 WebDAV Cloud Sync & Remote Backups
- **`POST /api/webdav/test`**: Test WebDAV connection and credentials.
- **`POST /api/webdav/sync`**: Trigger full bidirectional WebDAV sync.
- **`POST /api/webdav/sync-file`**: Sync single file to WebDAV.
- **`POST /api/webdav/backup`**: Create remote WebDAV backup archive.
- **`GET /api/webdav/backups`**: List backups stored on WebDAV.
- **`DELETE /api/webdav/backup`**: Delete remote backup (`?file=...`).
- **`POST /api/webdav/restore`**: Restore data from WebDAV backup.
- **`GET /api/webdav/logs`**: Get WebDAV synchronization logs.
- **`GET /api/webdav/progress`**: **SSE streaming endpoint**, real-time sync progress.

### 9.4 File Manager API (ElFinder Connector)
- **`GET /api/elfinder/connector` / `POST /api/elfinder/connector`**: Backend connector for ElFinder web file manager.
- **`GET /api/files`**: List files in data directory.
- **`GET /api/files/download`**: Download files from data directory.
- **`POST /api/files` / `PUT /api/files`**: Upload or update files.
- **`DELETE /api/files`**: Delete files.

---

## 10. Web Player & Native Sync Endpoints

### 10.1 Web Player Endpoints
- **`GET /api/music/config`**: **Public endpoint**, returns Web Player runtime paths, auth status, and public access rules.
- **`POST /api/music/auth`**: Validate player access password and issue `lx_player_session` cookie.
- **`POST /api/music/auth/logout`**: Invalidate player session.
- **`GET /api/music/auth/verify`**: Verify player session status.
- **`GET /js/config.js`**: Dynamically injects backend configuration into frontend `window.CONFIG`.

### 10.2 Native LX Sync Protocol Endpoints
- **`GET /hello`** (or `/<username>/hello`): Handshake and liveness probe.
- **`GET /id`** (or `/<username>/id`): Get server unique ID (`ServerId`).
- **`POST /ah`** (or `/<username>/ah`): Auth negotiation and client pairing.
- **`WebSocket Upgrade (WS)`**: Client upgrades HTTP connection to WebSocket Server for encrypted real-time sync.
