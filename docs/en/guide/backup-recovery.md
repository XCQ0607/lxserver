# Backup and recovery

Choose what to save and where to keep it before enabling automatic backups. You can keep a local copy, use WebDAV, use OpenList, or enable both cloud destinations. The two providers store independent copies; they do not synchronize with one another.

## Choose a backup method

| What you need | Use |
| --- | --- |
| Recover a previous playlist or dislike list | Playlist/dislike history snapshots |
| Recover server settings | Local configuration history |
| Download data for safekeeping or migration | Local ZIP export/import in Backup management |
| Automatically copy data to cloud storage | WebDAV or OpenList data backup |
| Upload playback cache to OpenList or free local cache space | Separate advanced per-user OpenList cache rules |

Configuration history does not include all user files or audio. Playlist snapshots do not include audio either. To recover a full installation, select the required data types and separately protect external music libraries excluded from the backup.

## Choose what to save

Open **Backup management → Cloud backup → Backup scope**, select types independently for WebDAV and OpenList, and save. Clearing every type disables that destination's data backup without deleting files already uploaded.

| Option | Includes |
| --- | --- |
| Songs and lyrics | Audio, LRC, artwork and music indexes under the data directory's `music` folder |
| User source files | Source scripts, ordering/status files and uploaded user files |
| Playlist and dislike snapshots | Historical snapshots, including the configured external snapshot location |
| User data | User settings, playback history, favorites and other user files |
| System and accounts | Server configuration, account list and system JSON files at the data directory root |

**Ordinary data backup excludes cache, logs, temporary files, local backup archives and external custom music directories. Directory links are not followed.** A separate `music` directory in the program working directory is also excluded. Paths refer to your actual data directory, which may differ from the default `data`.

Advanced OpenList playback caching can upload cache separately for selected users. It is not the same as ordinary data backup. System/account backups may contain credentials; store them somewhere you control.


### Program directory versus data directory

These paths are relative to the program working directory and assume the default `DATA_PATH=data`:

| Location | Ordinary WebDAV / OpenList data backup |
| --- | --- |
| `cache/` | Excluded: program-directory cache |
| `music/` | Excluded: program-directory music separate from the data directory |
| `data/cache/` | Excluded: data-directory playback cache |
| `data/users/account/cache/` | Excluded: per-user cache; cache directories at other levels are excluded too |
| `data/music/` | Included when Songs and lyrics is selected and saved; audio, existing LRC, artwork and indexes |
| External directory, e.g. `D:/Music/` | Excluded; protect separately |

With a custom `DATA_PATH`, the scope is **music under the actual data directory**. For `D:/LXData`, that is `D:/LXData/music`. If the program working directory itself is configured as the data directory, its `music/` can be selected for backup. A blanket rule excluding every root-level music directory would be incorrect. Cache remains excluded.

Saving a scope does not enable the service. WebDAV needs an enabled, configured connection for cloud backup. Local ZIP export/import also uses the WebDAV-column scope but does not require WebDAV to be enabled. Advanced OpenList playback caching has independent user rules that can handle cache without changing ordinary backup exclusions.

## Configure local backups

Open **Backup management → Local backups** for snapshot counts, local configuration history and storage paths.

- Configuration history is enabled by default, runs every 24 hours, retains 7 days and uses the data directory's `backups` folder.
- The default anchor time is `00:00` in the server's local time. Leave it empty to count intervals from startup or rescheduling.
- An empty configuration-backup path uses the default. Relative paths start at the data directory; absolute paths are used directly.
- An empty snapshot path keeps existing per-user snapshot locations. An additional configured location separates snapshots by user.

Local ZIP export/import in **Backup management** does not require WebDAV. It uses the types saved in the WebDAV scope column, so check that selection before exporting.

## Back up with WebDAV

1. Open **Backup management → Cloud backup → WebDAV**, enter the URL and credentials, and enable it.
2. Set incremental and ZIP directories; defaults are `/lx-sync` and `/lx-sync-backups`.
3. Save, then test the connection on the same page. The test reads the saved directories without creating files; it does not prove upload or deletion permissions.
4. Run file synchronization or a full ZIP backup and inspect the result. Start with a small backup and test recovery in a separate installation.

Incremental backup uploads changed files and checks every 60 minutes by default. ZIP archives cover the same selected data; scheduled checks run every 24 hours and create an archive when data changed. A manual full backup can force a new archive.

### Understand the two optional switches

| Switch | Off: recommended default | On |
| --- | --- | --- |
| Delete the WebDAV incremental copy when its local file is deleted | Keep the cloud copy | Next incremental run deletes the tracked counterpart; historical ZIPs remain |
| Overwrite selected local data from WebDAV before every startup | Restore manually when needed | Restore before opening the service; cloud files replace matching local files |

Startup restoration is for deployments deliberately using the cloud as their recovery source. It is not limited to an empty first start and can overwrite newer local data. Failure leaves maintenance mode active and does not upload local data to the cloud.

### Retention and transfer usage

ZIP retention defaults to 5 archives and 0 days (no age limit). Successful uploads clean archives exceeding either limit, always keeping the newest. This does not clean the incremental directory.

Uploads check the response and remote size without downloading the whole file again. Safe replacement requires WebDAV `MOVE`; check server/proxy support if MOVE fails. Matching size is not proof of matching contents.

## Back up with OpenList

1. Open **Backup management → Cloud backup → OpenList**, and enter the endpoint and token or account details.
2. Enter an **existing OpenList mount path** such as `/local` as the root. Do not enter a Windows host path such as `E:\OpenList`; configure that physical path inside OpenList's storage settings.
3. Enable, save and test, then run the immediate backup/cache-sync action.
4. Inspect upload results in the corresponding record tab.

Ordinary backups keep relative paths under `_data` within the configured root. For example, a song might be stored at `/local/_data/music/account/song.mp3`. Its physical disk location depends on the OpenList mount.

Data backups retain local files. Deleting a local file does not automatically delete its `_data` backup. Advanced playback caching has separate user rules and locations; only an explicit upload-and-delete rule removes corresponding cache files after strict verification.

### Upload completion versus content verification

“Upload complete” means upload and remote size checks succeeded, not full content equality. Ordinary backup does not download songs for SHA-256 verification. The Backed up task state and the Content verification filter are independent. Verification results describe the current registered backup fingerprint at a past check time; changed versions or observed cloud changes require another check. Legacy internal verified states alone do not qualify. Upload-and-delete and restoration retain their automatic safety checks.

To check contents, open **Backup management → Records and verification → OpenList → Content verification**:

1. Choose the user, type and scope, then preview estimated transfer usage.
2. The default checks unchecked or changed versions. Choose all current files when investigating later cloud corruption.
3. Confirm and start; the job runs in the background and can be stopped.
4. Review matching contents, mismatches, missing files and read errors. Verification does not automatically repair or overwrite cloud files.

If storage supplies a usable SHA-256 it can be compared directly; otherwise verification reads the remote body and consumes download transfer. Legacy records without upload fingerprints require another backup to establish a baseline. Upload-and-delete cache rules still require strict content verification and may read remote audio and attachments.

## Filter OpenList backup records

In Backup management → Records and verification, select OpenList file records. The record panel contains one set of filters: type buttons, user, storage category, local availability and sorting. Click a status card to filter that status; click again to clear it. Counts reflect other active conditions. Active-condition chips can be removed individually.

Space-separated search terms must all match, across filenames, users, paths and available song metadata. More conditions adds path, snapshot subtype and an inclusive update-date range interpreted in browser-local time. Conditions combine; remove individual chips or reset if nothing matches. Filtering/pagination reuse loaded records; Refresh records and re-entering the record view fetch current results. These controls do not change backup scope or files.

## Restore your data

Recovery runs **from the backup to the current server**. It does not upload local files or delete files that exist only locally.

### WebDAV

1. Confirm the current data/configuration locations and external snapshot path, then save the types to restore.
2. Open **Backup management → Data recovery → WebDAV** and choose the incremental directory or a specific ZIP.
3. Choose missing-only or overwrite. Keeping pre-restore copies is recommended.
4. Preview additions, replacements, index merges and skips before confirming. ZIP preview downloads the entire archive once and reuses it on confirmation; cancelling or expiry removes that temporary archive.
5. Restart the service to reload accounts, playlists, sources and music indexes.

### OpenList

Open **Backup management → Data recovery → OpenList**, select the current backup or an available historical version, choose scope and overwrite behavior, then scan and confirm. Restore records show progress and support continuation, cancellation or rollback where available. A fresh installation can enumerate cloud data without the old backup database.

### Replacement rules and failures

- **Missing-only:** retain existing files and add absent files. Required music/snapshot indexes merge entries; ordinary JSON files are not merged field by field.
- **Overwrite:** matching files in the selected scope come from the backup. Local-only files remain; the directory is not cleared.
- **Pre-restore copies:** kept by default for rollback. Rollback refuses files modified again after restoration. Delete records and copies explicitly when no longer needed.

Required files are staged and checked before local replacement. Download failure changes no originals; write failure attempts rollback. Legacy backups without fingerprints receive size checks and a warning. Allow extra disk space for staged files and pre-restore copies.

Recovery enters maintenance mode. Restart after a manual restore; refreshing the browser is insufficient. If a process stops during commit or rollback fails, use restore records to resolve rollback before restarting normal service.

## Common questions

**“Storage not found”?** Check that the OpenList mount exists, is enabled and matches the configured root. Connecting to OpenList alone does not create writable storage.

**Why are LRC files uploaded?** Songs and lyrics includes existing LRC under the data directory's `music` folder. The advanced cache attachment switch only controls separate cache rules. Disabling lyric generation does not delete existing LRC.

**Nothing changed after restore?** Check source, types, account directories and replacement mode. Missing-only skips existing files. Restart after completion before checking results.

**Do WebDAV and OpenList synchronize with each other?** No. Choose one source explicitly when restoring.

See [configuration](./configuration.md) for keys/defaults and the [backup API](../api/reference.md#backup-api) for scripting.

### Task states and verification results

Record states describe pending uploads, pending downloads, active transfers, backed-up files, items needing attention, failures and paused rules. Local size or modification-time changes flag enabled upload rules for the existing scheduled process. Background content comparison refreshes the baseline when only metadata changed. Disabled services or scopes appear paused. Removing local playback cache after upload does not request cloud deletion.

Content verification is a separate historical result, not a real-time guarantee. Old matching badges are hidden while local changes or transfers are pending. Observed cloud changes mark previous results as needing rechecking and include them in the default verification scope. Select all current files to detect later corruption with unchanged size and timestamps. Refreshing records checks local metadata without downloading cloud bodies. Diagnostic states remain in details and advanced filters. User and type filters also apply to verification results.

### Manual metadata checks and timestamps

In records, choose Check files, select local, cloud or both, and selected records, current filtered results or all records for this connection. Checks cover primary record files; use content verification for attachments. Historical objects are excluded. Checks inspect existence, size and modification time without uploading, downloading bodies, deleting files or producing SHA-256 results. Cloud requests run sequentially and can be stopped while preserving completed observations.

Advanced filters show checked X/Y records and the newest check time for the matching scope; hover for the oldest timestamp. This does not imply every file was checked successfully in one run. Details show per-file timestamps. Listing records refreshes local metadata; manual local check times are retained separately. Cloud observations persist by connection and backup version across restarts. Interrupted jobs must be restarted.
