# Playback, lyrics and local music

The player defaults to `/`, configurable with `PLAYER_PATH`. Player access authentication opens the player; personal login selects playlists, settings and directory permissions. A valid browser session normally avoids repeated access-password prompts.


## Playback sources and resolution order

**Prefer existing server audio** (formerly prefer cached songs) includes both the current user's `music` downloads and `cache` playback files. Matching uses indexed platform, song ID and quality; scan/link manually copied files or play them directly from the local library. Users are isolated, with `_open` for public files.

| Files | Runtime-root mode | DATA_PATH mode |
| --- | --- | --- |
| Downloads and adjacent LRC | `<cwd>/music/<user>/` | `<DATA_PATH>/music/<user>/` |
| Playback cache and adjacent LRC | `<cwd>/cache/<user>/` | `<DATA_PATH>/cache/<user>/` |

The persistent per-user serverCacheLocation selects the base. A temporary local-library browsing location does not change the persistent playback base. Custom libraries use a separately configured per-user directory.

### Web audio

Local-library entries directly use their file URL for music, cache or custom directories. Online songs resolve in this order:

1. With prefer-existing-server-audio enabled, probe the user's music/cache. Exact-quality downloads precede cache; other qualities may be fallback candidates.
2. On a local miss, use registered OpenList user cache/download files if the backend playback-source master switch permits it.
3. Reuse a browser-cached URL when enabled. URLs can expire and are not offline audio copies.
4. Resolve an online source-script URL and deliver directly or through the configured proxy.

Cache-song-files controls background writes; prefer-existing-server-audio controls existing-file reads. Disabling writes does not disable reads. Background writes pass the only-download-mode setting: enabled writes to music, otherwise cache, under the selected base. Foreground playback does not wait for the full background download.

### Web lyrics

Prefer-server-local-lyrics is independent of save-lyrics-files:

| Setting | Effect |
| --- | --- |
| Prefer server-local lyrics | User music/cache LRC, then browser lyrics, then online lyrics |
| Save lyric files | Write standalone LRC during lyric fetching/background audio saving; keep it adjacent to existing audio |
| Browser lyric cache | Store/reuse text in this browser |
| Embed lyrics during download | Write audio lyric tags independently of standalone LRC |

Turning local preference off skips standalone-LRC lookup in both frontend and backend. Unlinked local tracks can still use embedded lyrics. Local entries support adjacent LRC in music, cache and custom directories even without a platform identity. Roots are determined by the authenticated user; arbitrary paths and cross-user traversal are not permitted. Audio and lyrics resolve independently.

### Subsonic

Online IDs such as tx_... probe local music/cache when subsonic.playCacheFirst is on. OpenList follows only when the Subsonic OpenList option and openlist.playback.enable are both on; online sources follow on a miss. Turning cache-first off skips both local and OpenList for online IDs. Delivery is normally a redirect, or server-side transcoding when required and enabled. Online-ID lyrics now try local LRC before the SDK, including indexed custom-library lyrics.

Local IDs such as local_... are handled separately. The catalog includes the selected cache/music base and enabled custom directory regardless of cache-first. Missing local audio is an error, not a silent replacement with another online track. Lyrics try adjacent LRC, embedded lyrics, indexed local lyrics, and an online SDK fallback if linked to a platform.

subsonic.cacheOnPlay controls background cache writes after online playback resolution, not existing-file reads. Switching tracks can cancel that task. The online download branch caches even when cacheOnPlay is off. Subsonic background caching explicitly fetches lyrics independently of Web save settings. Early local/OpenList hits avoid duplicate online caching.

### Cloud sources

In the admin UI, **Backup management → Cloud backup → OpenList playback cache → Allow OpenList as a playback source (local first)** is the shared master switch for Web and Subsonic. Web also requires its server-audio preference; Subsonic requires its own cache-first and OpenList options. Saving upload-and-delete rules no longer silently enables playback settings. Legacy enabled Subsonic settings migrate only when the new field is absent; explicit false is respected.

A local database matches user/song/quality before querying one remote file, without directory scans per play. Concurrent lookups are coalesced, download addresses reused for up to 30 seconds, and metadata requests limited to four seconds each. Failed lookups fall back to online sources. Web uses existing proxy preferences; Subsonic uses direct redirects, proxy delivery or transcoding.

Only registered user cache/download backups with the corresponding per-user directory rule enabled are direct playback candidates. Enabling only the ordinary five backup scopes is insufficient. Ordinary _data backups and historical objects are not automatically a music catalog. The shared downloader can also retrieve an OpenList backup into local storage, gated by the master setting independently of Subsonic-only preferences.

WebDAV is not a live audio/lyrics fallback. Restore files manually or through explicit startup restore, then use local playback. See [Cloud backup and recovery](./backup-recovery.md).

### LRC and backup scope

Writing LRC and uploading LRC are separate. Disabling Web standalone-lyric saving stops implicit LRC creation during audio caching without deleting existing files. Ordinary music backups include existing audio, LRC, covers and indexes under data/music. openlist.includeNonAudio only controls the separate user-cache attachment pipeline. Ordinary backups exclude cache, cwd/music and external custom libraries.


## Playback, lyrics and appearance

The responsive player includes a queue, quality selection, playback speed, sleep timer, full-screen lyrics, themes and player backgrounds. Lyrics can include translations, romanization and word highlighting when supplied by the source. Lyric cards offer image layouts for sharing selected lines.

Version and build fingerprint identify the running build, for example `v2.1.4 · build 123abcd`. Include both when reporting custom-build issues.




## Search and discovery

Search platforms are Kuwo (`kw`), Kugou (`kg`), QQ Music (`tx`), NetEase (`wy`) and Migu (`mg`). Choose a platform or use aggregation where supported. Artist, album and playlist search availability varies by platform.

Single-source song search fetches results serially on the server and paginates the received list locally. Upstream depth limits and server budgets mean the received count may differ from a platform's reported total.

Metadata search and audio resolution are separate: platforms provide search data, while custom source scripts resolve playback links. Finding a track does not guarantee a playable URL at every quality.




## Playlists, favorites and queue

Manage personal playlists, favorite artists/albums, online playlists, leaderboards and queue order. Personal data belongs to the signed-in account; public favorites have separate visibility and access settings. Editing a personal sync playlist changes synchronized data. Browsing a platform leaderboard does not automatically import it into your playlists.




## Local files, downloads and matching

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




## Sound effects, casting and background playback

The player has an equalizer and pitch controls. Audio processing depends on browser audio capabilities and resource access. If native playback or AirPlay needs restoring after audio processing, use the sound-effects panel's restore control.

Chromecast is available in supported desktop/Android Chromium browsers in a secure context, normally HTTPS. The receiver must be able to reach the server and media URL. Browser-only `blob:`/file URLs cannot be fetched by the receiver. Casting does not apply browser sound effects or playback speed; iOS uses its native AirPlay path. See the [player guide](../guide/web-player.md).

## Custom sources and scheduled downloads

Import a source script by URL or upload, enable it and choose supported platforms/qualities. Source order and account-specific preferences affect resolution. Missing or expired links, platform restrictions and source failures can still prevent playback.

Network-playlist checks and sync-download tasks are configured separately. Check their last run, next run and result state in the UI. Enabling playlist synchronization alone does not enable automatic audio downloads.




## Account sources and public sources

Source scripts live under the data directory's `users/source/`: `_open` for public scripts and account directories for private scripts. A signed-in account combines available public and private sources; a private script with the same ID takes precedence. Account-specific public-source enable preferences and ordering are stored separately from global settings.

Disabling the private copy does not automatically fall back to the same-ID public script. If a visible source is not used, inspect enable state, supported platforms and account ordering. VM compatibility requires both global `system.allowUnsafeVM` and the script's own option; it is not a universal fix for resolution failures.

## A practical local-library workflow

1. Sign into the intended account and check saved storage versus temporary browse location.
2. Scan and inspect a few files for title, artist, quality and duration.
3. Associate unknown files manually or use automatic matching; inspect recording/version matches.
4. Write metadata/artwork/lyrics only when needed and authorized.
5. Before remastering, review replacement direction and preserve irreplaceable originals.

Automatic matching saves per-track results; a restart marks unfinished work interrupted rather than guaranteeing automatic continuation. Cancellation does not undo completed associations. Remastering downloads another available quality; it cannot reconstruct information lost in a lossy file. Actual quality can differ from the requested target: review individual results.

## Media proxies and link caches

Search data, playback URLs and audio bytes are separate requests. Player media forwarding routes audio through the server; server outgoing proxies control how it contacts platforms/source services. With HTTPS pages and HTTP media URLs, inspect auto-proxy settings.

Local playback depends on file matching, directory and playback settings. Saved remote URLs can expire and require resolution again. Clearing links, clearing lyrics and deleting server audio are different actions; read each operation's scope.

## PWA, mobile and background playback

Supporting browsers can install the player to the home screen. PWA installation does not automatically save every track offline. Operating systems may still restrict background audio, network access and autoplay. Lock-screen controls, AirPlay and device discovery vary by client; first verify ordinary foreground playback.

## Recommendations and dislike rules

Favorite artists/albums and dislike rules are stored separately. Subsonic can hide matching tracks; rating-to-dislike and dislike-to-rating links have separate switches. With linking disabled, a low rating does not itself imply hiding/removal. Duet matching, cross-platform name matching and recommendation filtering also have independent settings.

## Server tasks versus browser tasks

Server downloads, sync-download and matching run in the backend; browser downloads run on the visiting device. Closing the page does not cancel submitted server work. Inspect task status and use its stop/cancel action rather than refreshing to stop it.

See [operations](./operations.md) for diagnosis and [API reference](../api/reference.md) for fields.
