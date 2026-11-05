# Cloud backup and recovery

Use **System settings → Cloud backup scope** to select data types independently for WebDAV and OpenList. Selecting both destinations stores two copies; it does not synchronize the destinations with each other. Each provider still needs its own enabled connection.

## Included files

| Type | Scope | Restore destination |
| --- | --- | --- |
| `music` | `data/music/**`, including audio, lyrics, covers and `music_index.json` | The current data directory, retaining relative paths |
| `userFiles` | `users/source/**`, `source/**`, `uploads/**` | The same relative paths in the current data directory |
| `snapshots` | Playlist/dislike snapshot bodies and `snapshotInfo.json`, including extensionless bodies | Original relative paths; external playlist snapshots use the current `snapshot.backupPath` |
| `userData` | Other user files under `users/<account-directory>/**` | The same account directories and relative paths |
| `system` | `config.js` and JSON files in the data directory root, including `users.json` and `serverInfo.json` | Current `CONFIG_PATH` for configuration; current data directory for JSON |

Cache, runtime data, logs, temporary files, SQLite working databases/WAL and local backup archives are always excluded. Directory links are not followed. External custom music directories are not included. Preserve account directory names during recovery. Music indexes and audio are grouped together. System and user data can contain credentials or device information.

## System configuration

```js
module.exports = {
  'backup.webdav.types': ['music', 'userFiles', 'snapshots', 'userData', 'system'],
  'backup.openlist.types': ['music', 'userFiles', 'snapshots', 'userData', 'system'],
  'backup.webdav.mirrorDeletes': false,
  'backup.webdav.restoreOnStartup': false,
}
```

An empty type array disables data backup for that destination. The admin UI validates and saves these fields in the active configuration file. Deselecting a type does not remove existing cloud copies.

The old `webdav.excludeCache` and `webdav.excludeMusic` interfaces remain for compatibility. Explicit type arrays control the new scope; cache is always excluded. The old `openlist.backupSystemConfig` applies only to the legacy flow without explicit types, avoiding a second system-backup switch in the new UI.

## Provider behavior

WebDAV incremental backup stores selected files under `webdav.syncPath`; ZIP backup archives the same scope under `webdav.backupPath`. Separate successful baselines prevent incremental uploads from suppressing ZIP backups. Failed uploads remain eligible for retry.

Local offline ZIP export/import uses the saved WebDAV-column scope without requiring an enabled connection or accessing the cloud. The UI states this explicitly so partial exports are not mistaken for whole-server backups. Daily local configuration history remains controlled by `configBackup.*`; it does not replace a data backup.

Cloud files are retained after local deletion by default. Enable `backup.webdav.mirrorDeletes` to propagate deletions to scattered files; historical ZIPs remain unchanged. Backup and restore operations do not run concurrently within one WebDAV instance.

OpenList stores data at `<openlist.root>/_data/<relative-path>`. Data backup uploads files and retains local copies. `openlist.syncInterval` controls scheduled runs. Recovery enumerates cloud files directly, so a fresh installation can recover without the previous SQLite database.

Advanced permanent playback caching is separate. Per-user cache rules may upload disposable cache files, delete local copies after verification, or provide Subsonic direct/proxy delivery. Selecting `music` in the backup matrix does not enable cache uploading. Song, snapshot and system backup are no longer controlled twice by these per-user cache rules.

Before removing a local playback-cache copy, SHA-256 verification reads the actual cloud bytes. This adds a remote verification transfer. Files modified during transfer are retained. Normal data backup never removes local files after upload.

## Recovery procedure

1. Configure the destination server's cloud connection, data directory, `CONFIG_PATH` and snapshot mounts.
2. Select and save the types to restore. Configure `snapshot.backupPath` before restoring external snapshots; cloud absolute paths are never used as destinations.
3. Restore scattered files or a specified ZIP from WebDAV, or use OpenList's restore action. Only selected types are downloaded. Matching local files are replaced, local-only files remain, and no files are uploaded during restore.
4. Check results and logs. Downloads use temporary files and rename after completion. A multi-file restore is not an atomic transaction; inspect partial failures and retry.
5. Restart the service to reload accounts, playlists, sources and music indexes. Refreshing the browser alone does not reload all server-side state.

Startup restore is disabled by default. Set `backup.webdav.restoreOnStartup=true` only when unattended disaster recovery is intended; matching files will be overwritten. Automatic recovery tries ZIP only when the scattered directory is missing or has no selected files. Authentication/network errors do not imply an empty cloud. Failed recovery never initializes the cloud by uploading local files.

Old ZIPs are filtered using the current selection, even if they contain caches. Legacy per-user OpenList audio remains accessible through compatible cache flows; the new unified restore reads `_data` and does not guess or move legacy directories.

## Validation limits

Regression coverage uses real SQLite, a local HTTP OpenList fixture, a WebDAV client substitute, ZIP archives and fresh restore directories. It covers selection, cache exclusion, retry behavior and selected Subsonic delivery paths. It does not establish compatibility with every real cloud mount, WebDAV server or Subsonic client. Verify a small backup in an independent directory before relying on it.
