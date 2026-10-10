# Sync Service & Management Console Guide

LX Music Sync Server includes a professional Web Management Console (located by default at `/admin`, i.e., `http://IP:9527/admin`), used for monitoring service status, managing user accounts and multi-device connections, inspecting playlists and snapshots, and configuring server options.

## Login and Authentication

Accessing the management console (default `http://IP:9527/admin`) requires entering the administrator password.

- **Default Password**: `123456`
- **Modify Password**: You can override the default password by setting the environment variable `ADMIN_PASSWORD`, or go to the "System Config" page to modify it after logging in. The password will be persisted in the `data/config.js` file on the server.

## 🔗 Client Sync & Connection Setup

The server provides flexible connection methods for various clients:

### 1. LX Music Client Synchronization (Desktop / Mobile)
Go to client "Settings → Sync Settings" and choose Custom Server:
- **User Path Mode (Recommended, enabled by default `USER_ENABLE_PATH=true`)**:
  - **Connection URL**: `http://<server-ip>:9527/<username>` (e.g. `http://192.168.1.100:9527/user1`)
  - **Connection Password**: Password of the corresponding user.
  - **Mechanism**: The server routes requests directly to the user's isolated data sandbox based on the username in the URL. **Allows different users to use identical passwords**.
- **Root Path Mode (Requires enabling `USER_ENABLE_ROOT=true` in System Config)**:
  - **Connection URL**: `http://<server-ip>:9527` (without username in URL)
  - **Connection Password**: Password of the corresponding user.
  - **Mechanism**: The connection URL is the root path; the server auto-matches the user via the handshake password. **Note: In this mode, all user passwords must remain strictly unique**.

### 2. Subsonic Music Client Connection (Yinliu / Feishin / Symfonium, etc.)
Fully compatible with Subsonic / OpenSubsonic protocols:
- **Server Address (Server URL)**:
  - **Default Shared Main Port**: `http://<server-ip>:9527/rest` (Subpath controlled by `SUBSONIC_PATH`, default `/rest`).
  - **Standalone Listening Port** (if `SUBSONIC_PORT` > 0, e.g., `4533`): `http://<server-ip>:4533/rest`.
- **Username & Password**: The username and password created in the "User Management" dashboard.
- **Global Online Search**: Search and stream tracks across platforms directly inside Subsonic clients. Prefix with `wy:`, `tx:`, `kw:`, `kg:`, `mg:` to select platforms, or `online:` / `local:` to toggle search modes.

## Functional Module Description

### 1. Dashboard

Displays the current service's running status and basic statistical information:

- **Basic Indicators**: Displays the number of devices currently connected via WebSocket, memory (RAM) occupied by the Node.js process, and continuous running time (Uptime) since the service started.
- **User Statistics**: Displays the total number of users created in the system.
- **Running Logs**: The front-end displays real-time console log output, facilitating viewing request history and error information.

### 2. User and Device Management (Access & Devices)

Used for managing multi-accounts and viewing currently connected client devices.

- **Multi-account separation**: Multiple user accounts can be created. The playlist data and settings corresponding to each account are stored independently on the server side and do not affect each other.
- **Device Management**: You can view the client devices currently connecting to the service and the IP source, and support forcibly disconnecting specified device connections.
- **Delete User and Clean Data**: When deleting a user account, you can choose to simultaneously clear all historical playlist data and cache files corresponding to that user on the server.

### 3. Data Tracker & Viewer

Used for directly reviewing user synchronization data on the web page side.

- **Playlist Detail Review**: You can browse all classified music lists, song information and favorite records saved on the server.
- **Snapshots and Rollback**: The system will automatically save historical snapshots (Snapshot) of playlist data when synchronization changes occur. When a client mistakenly clears or abnormally overwrites, you can download previous complete data here, or perform a one-click rollback restoration directly against the server.

### 4. WebDAV Backup and Synchronization (WebDAV Backup)

Used for periodically packaging and transmitting server-side data to third-party WebDAV storage.

- **Periodic Backup**: After configuring and enabling a WebDAV account, the server will start a timed task (default every 60 minutes) to package and upload all current user records to the specified network disk.
- **Automatic Pull Recovery**: When starting on a brand new server with empty data for the first time, if it is detected that WebDAV environment variables are filled, the server side will first download the latest backup file from the network disk and overwrite it to the local, thereby completing the import and recovery of old data.

### 5. System Settings and Maintenance

Regular file cleanup operations can be executed on the web page:

- **Cache Cleanup**: Clicking relevant buttons can command the server to directly delete old media cache files or log records, thereby releasing disk space.
- **Export Logs**: Short-term operation exception logs generated by the server can be packaged and downloaded for error analysis.
