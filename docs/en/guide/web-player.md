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

### Song ratings

After signing in to a local account, rate songs from 1 to 5 stars or clear ratings using the player, song menus, artist detail, charts, local music, and custom directories. Favorites → My ratings provides a searchable rating collection.

Web and Subsonic share per-user `ratings` and `ratingOrigins` in `subsonic-meta.json`. Rating snapshots live in `rating/snapshot/`; `rating/songs.json` stores essential Web-submitted song descriptions without playback URLs or authentication parameters. Ratings do not modify playlists or audio tags. Current ratings and song descriptions belong to the user-data backup scope; snapshots belong to the snapshots scope.

Online songs use source-specific IDs, preferring QQ song mids. Unlinked local files use stable registry IDs shared by Web and Subsonic. Once linked, the online ID becomes authoritative: reads and writes share the online version and other linked copies. If the online version already has a rating, it wins and the local score record is deleted. Otherwise the local score, origin and history move to the online ID, and the local entry is deleted. Relinking selects the new online ID; titles are never used to merge ratings. Files recognized as new after importing, rebuilding, or moving are not automatically matched to old ratings by name.

Low ratings only add dislike rules when linking and the threshold allow it. Raising or clearing ratings does not delete dislike rules. Direct Web ratings record `web`; Web rating-to-dislike linking records `web-rating-link`; direct Subsonic ratings record `subsonic`. Partial snapshot/link failures are reported after the rating is saved. Lists load ratings in batches and refresh periodically or when returning to the page.


### Rating identity, reconciliation and backups

Unlinked local songs use local IDs. Linking keeps an existing online score or migrates the local score when the online version is unrated, then removes the local score record. The dialog shows the target ID and linked copy count; Admin Data View no longer has rating status labels or filters.

The two supplement actions remain additive. Saving settings does not delete historical rules. To apply a changed threshold, select the user and choose Recalculate by threshold, preview the changes, then execute. Only invalid reasons traceable to a specific rating ID are removed. Rules with manual or other valid reasons remain; historical rules without precise provenance are preserved. Disabling linking does not trigger cleanup.

My ratings → Export rating backup includes scores, origins, song descriptions and local link references, without audio files. New rating snapshots also contain descriptions. Importing/restoring a rating backup in the admin interface restores scores and available descriptions while preserving current favorites and file links. Link references are for comparison: backup paths never locate or move files or revert associations. A score-only backup cannot recreate missing covers or titles.

Recommendation exclusion uses the same policy for daily, random and similar tracks: matching dislike rules and scores at or below the threshold are excluded. This is independent of ordinary list hiding and automatic linking.

Admin rating and dislike dashboards support platform, action origin, cover availability, record age, combined keywords and score filters. Platform options show user totals, including zero-count platforms. Click the score distribution to filter, change page size, inspect records or export the current selection. Rating statistics follow platform, origin, age and keyword filters; type and score further narrow the list.

### Per-user dislike auto-rating

Settings → Logic → Dislike auto-rating is saved to the current account on the server and defaults to off. Adding a Web song dislike supplements 1 star only when unrated; existing ratings remain. Other users and the low-score threshold do not control this preference. The global reverse-link switch has been removed. Admin backfill is an independent, previewable operation and works with auto-rating off or threshold zero. Sources are labeled Web manual rating, Subsonic manual rating, Dislike automatic rating, and Admin backfill. The preference is stored in each user’s `rating/preferences.json`; score backup restore does not change this preference.

Playlist detail supports direct rating. Open rating collections refresh periodically, on returning to the page and after local rating/dislike actions, preserving filters and list scroll. Each entity retains up to 30 recent score changes, including clearing, backfill and restore; identical submissions keep origin timestamps. Old history is not fabricated. Failed auto-rating reports partial completion while retaining the dislike. Recoverable restore write errors roll back files; this does not guarantee cross-file atomicity during process termination or power loss.


### Metadata repair and synchronization status

Identical scores keep their origin and timestamp while allowing available metadata to be repaired. Direct ratings and automatic/admin backfill share one write service; backfill only supplements missing scores. Resolved Subsonic metadata is stored in the user's `rating/songs.json`, reducing dependence on runtime caches. Favorite operations retain rating origins and history.

My ratings and admin Ratings show pending work with Retry failed items. The user's `rating/sync-status.json` tracks backfill writes, catalog writes, unresolved metadata and snapshot failures. Retries preserve newer scores; metadata resolution still depends on provider availability. Corrupt primary rating files block writes and exports without replacing the original. Corrupt status files request manual inspection instead of being cleared.

Admin previews separate additions, already-rated skips, duplicate linked identities and resolution failures. Saved scores with failed snapshots report partial completion. Version checks avoid unnecessary full refreshes. The Web collection average follows the current selection; the distribution follows the other filters, so users can switch score levels.
