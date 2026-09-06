# Server API Reference

LX Sync Server provides a variety of RESTful API interfaces for automatically obtaining and controlling sync server data and statuses.

## Overview
To ensure security, all APIs require authentication. Currently, two main authentication methods are supported:

1.  **Administrator Authentication (`x-frontend-auth`)**: Uses the global password (`frontend.password`) set during server configuration. Used for sensitive server controls, user management, and global data extraction.
2.  **User Token Authentication (`x-user-token`)**: Uses a dynamic Session Token obtained via the login interface or a persistent API Token generated in the management panel. Used for operating specific user data (e.g., playlists, settings, cache).

Unless otherwise specified, all interfaces **use JSON as the request body and response body** type (`Content-Type: application/json`).

---

## 1. Authentication & Account Management API

### 1.1 Admin: Service Status (`GET /api/status`)
Get the overall memory consumption, device online status, and uptime summary.
- **Header Auth**: `x-frontend-auth: <Admin Password>`

### 1.2 Admin: User Management (`/api/users`)
- **Header Auth**: `x-frontend-auth: <Admin Password>`
- `GET /api/users`: Get a list of all users, their passwords, and permission configurations.
- `POST /api/users`: Create a new user (`{"name": "...", "password": "..."}`).
- `PUT /api/users`: Update user info (Rename, update password or permissions) (`{"name": "...", "newName": "...", "password": "...", "enableCustomMusicDir": false, "customMusicDir": "...", "allowOperateCustomMusicDir": false, "allowWriteCustomMusicDir": false}`).
- `DELETE /api/users`: Delete users (`{"names": ["..."], "deleteData": true}`).

### 1.3 User: Login (`POST /api/user/login`)
Login with username and password to receive a Token.
- **Body**: `{"username": "...", "password": "..."}`
- **Response**: `{"success": true, "token": "lx_tk_...", "username": "..."}`

### 1.4 User: Logout (`POST /api/user/logout`)
Invalidate the current Session Token.
- **Header Auth**: `x-user-token: <Token>`

### 1.5 User: Verify Auth (`GET /api/user/auth/verify`)
Check if the current Token is still valid.
- **Header Auth**: `x-user-token: <Token>`

---

## 2. Token Security Management API
Used to manage persistent API Tokens in the management panel or client. Requires `x-user-token` authentication.

- `GET /api/user/token/config`: Get the current user's Token authentication configuration (enabled status and list).
- `POST /api/user/token/config`: Enable or disable Token authentication (`{"enabled": true/false}`).
- `POST /api/user/token/add`: Generate a new persistent API Token (`{"name": "Name", "expireDays": 7}`).
- `POST /api/user/token/remove`: Delete a specific Token (`{"token": "..."}`).
- `POST /api/user/token/update`: Update Token information (name, expiry).
- `POST /api/user/token/toggle`: Enable or disable a specific generated Token.
- `GET /api/user/token/logs`: Get audit/access logs for a specific Token (requires `tokenMasked` parameter).

---

## 3. Data & Synchronization API
These interfaces manage the core synchronization data for users.

### 3.1 Playlist Management
- `GET /api/user/list`: Get the user's current complete playlist data.
- `POST /api/user/list`: Full overwrite update of the user's playlist data (triggers sync broadcast).
- `POST /api/music/user/list/remove`: Batch delete songs from a specific playlist (`{"listId": "...", "songIds": [...]}`).

### 3.2 Historical Snapshots
- `GET /api/data/snapshots`: Get a list of snapshots.
- `GET /api/data/snapshot`: Get data of a specific snapshot.
- `POST /api/data/restore-snapshot`: Restore to a specific snapshot point.
- `POST /api/data/delete-snapshot`: Delete a specific snapshot.
- `POST /api/data/upload-snapshot`: Manually upload a backup snapshot.

### 3.3 User Settings & Sound Effects
- `GET /api/user/settings`: Get user application settings.
- `POST /api/user/settings`: Update user application settings.
- `GET /api/user/sound-effects`: Get user equalizer/sound effect settings.
- `POST /api/user/sound-effects`: Update user sound effect settings.

---

## 4. Multimedia Core API (Web Player Support)

### 4.1 Search & Tips
- `GET /api/music/search`: Music search (supports `kw`, `kg`, `tx`, `wy`, `mg`).
- `GET /api/music/tipSearch`: Search keyword suggestions.
- `GET /api/music/hotSearch`: Real-time hot search terms from various platforms.

### 4.2 Square & Leaderboards
- `GET /api/music/songList/tags`: Get playlist category tags.
- `GET /api/music/songList/list`: Get selected playlist list for a tag.
- `GET /api/music/songList/detail`: Get playlist details (full song list).
- `GET /api/music/leaderboard/boards`: Get leaderboard categories.
- `GET /api/music/leaderboard/list`: Get songs within a leaderboard.

### 4.3 Playback & Lyrics
- `POST /api/music/url`: Get direct playback link.
  - **Header Support**: Optional `x-req-id` for SSE progress tracking.
  - **Progress**: Sse progress for custom source resolution can be tracked via `GET /api/music/progress?reqId=xxx`.
- `POST /api/music/lyric`: Get lyrics.
- `POST /api/music/comment`: Get song comments (supports `hot`/`new` types).

### 4.4 Download Proxy (`GET /api/music/download`)
Proxy download music files with automatic ID3 tag injection.
- **Params**: `url`, `filename`, `tag=1` (inject tags), `name`, `singer`, `album`, `pic`.

---

## 5. Server-side File Cache API
Users can manage music files and lyrics cached on the server.

- `GET /api/music/cache/stats`: Get the current user's cache statistics (file count, space usage).
- `GET /api/music/cache/list`: Get detailed list of cached files.
- `POST /api/music/cache/download`: Trigger server-side background download and cache.
- `POST /api/music/cache/remove`: Remove specific cached files.
- `POST /api/music/cache/clear`: Clear all music cache.
- `POST /api/music/cache/lyric`: Save or read lyric cache.

### 5.1 Custom Music Directory & Remaster (`/api/music/custom/*`)

Allows users with the `enableCustomMusicDir` permission to mount and manage local music files on the server.

- `GET /api/music/custom/list`: Get custom directory song list.
- `POST /api/music/custom/sync`: Trigger server to rescan and sync custom directory data.
- `GET /api/music/custom/file`: Get single audio file stream.
- `GET /api/music/custom/cover`: Get audio embedded cover image stream.
- `POST /api/music/custom/remove`: Delete audio files and data (requires user to have `allowOperateCustomMusicDir` permission).
- `POST /api/music/custom/link`: Manually link and rewrite audio ID3 tag info (requires user to have `allowWriteCustomMusicDir` permission).
- `POST /api/music/custom/updateMetadata`: Batch fetch metadata from the web and overwrite local files (requires user to have `allowWriteCustomMusicDir` permission).
- `POST /api/music/custom/embedLyric`: Batch write lyrics to local file USLT tags (requires user to have `allowWriteCustomMusicDir` permission).
- `POST /api/music/remaster/start`: Start audio remastering and downgrade transcoding task (if acting on a custom directory, requires user to have `allowOperateCustomMusicDir` permission).

---

## 6. Custom Source Management API
- `GET /api/custom-source/list`: Get a list of imported custom sources.
- `POST /api/custom-source/import`: Import custom source scripts online.
- `POST /api/custom-source/upload`: Upload local script files.
- `POST /api/custom-source/toggle`: Enable or disable a source.
- `POST /api/custom-source/delete`: Delete a custom source.
- `POST /api/custom-source/reorder`: Reorder custom sources.

---

## 7. Global System Configuration API (Admin Only)

Used by the management dashboard for real-time adjustments of server behavior. Requires `x-frontend-auth`.

- `GET /api/config`: Get all current global configuration items (including final values overridden by env vars).
- `POST /api/config`: Incrementally update global configuration.
  - **Supported Keys**: Includes `admin.path`, `player.path`, `subsonic.enableDebug`, `subsonic.onlineSearch`, `subsonic.onlineSearchMode`, `subsonic.onlineSearchSources`, `subsonic.lyricTranslation`, `artist.maxFetchPages`, `cache.namingPattern`, `system.allowUnsafeVM`, etc.
  - **Body Example**: `{"admin.path": "/admin", "player.path": "", "subsonic.enableDebug": false}`
  - **Path Validation**: `admin.path` and `player.path` must start with `/` or be empty, cannot be equal, and cannot start with `/api`.
- `POST /api/admin/reload`: Reload server `config.js`, `users.json`, and custom user source APIs.
- `POST /api/admin/restart`: Safely restart the server process.

---

## 8. Web Player Specific API

Interfaces designed specifically for Web Player frontend logic, supporting Session-based access.

### 8.1 Basic Config & Auth
- `GET /api/music/config`: **Public interface**, get runtime status and base path configuration of the Web Player.
  - **Response Example**: `{"admin.path": "/admin", "player.path": "", "player.enableAuth": false, "user.enablePublicRestriction": true}`
- `POST /api/music/auth`: Validate access password and issue `lx_player_session` HttpOnly Cookie upon success.
- `POST /api/music/auth/logout`: Completely invalidate the current Session.
- `GET /api/music/auth/verify`: Check if the current Session is still valid.

### 8.2 Enhanced Metadata Details
- `GET /api/music/artistDetail`: Get rich artist information.
  - **Params**: `source` (tx/wy), `id` (Artist Mid/ID).
  - **Returns**: Object with `name`, `desc`, `avatar`, `fans`, etc.
- `GET /api/music/artistAlbums`: Paged retrieval of artist's album list.
- `GET /api/music/artistSongs`: Paged retrieval of artist's full song list.
- `GET /api/music/albumSongs`: Get details of all tracks in a specific album.

### 8.3 Real-time Progress (SSE)
- `GET /api/music/progress?reqId=xxx`: real-time subscription to external link resolution and cache progress via Server-Sent Events (SSE).

