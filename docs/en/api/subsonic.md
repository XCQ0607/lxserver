# Subsonic protocol support

The server implements Subsonic / OpenSubsonic endpoints to expose LX playlists, online sources and account-local music to compatible clients. Behavior depends on server settings, source availability and client capabilities. This page describes functional coverage, not identical interfaces across clients.

See [Subsonic local music library](../guide/subsonic-local-library.md) for directories, identities and playlist persistence, and [sync server settings](../guide/sync-server.md) for connection setup.

## Connection

The default protocol path is `/rest`, sharing the main service port; `subsonic.path` customizes it. Separate listening requires both `subsonic.standalone` and a valid `subsonic.port`. Setting the port alone does not enable a separate listener.

Authenticate with the user account's sync password, not the administrator password. JSON and XML are supported. Example paths are illustrative; clients must supply protocol authentication, version and other required parameters.

```text
GET /rest/ping.view?u=<user>&t=<token>&s=<salt>&v=1.16.1&c=<client>&f=json
```

## Supported endpoints

### System, browsing and search

| Methods | Behavior and limits |
| --- | --- |
| `ping`, `getLicense`, `getUser` | Connection checks, license information and current-user information |
| `getMusicFolders` | Server-configured entry, NAS local music and online platforms |
| `getMusicDirectory` | Directories, albums, playlists and local music |
| `getIndexes`, `getArtists`, `getArtistList` | Artist indexes; `getArtistList` is a compatibility entry |
| `getArtist`, `getArtistInfo`, `getArtistInfo2` | Artist details and information |
| `getAlbum`, `getAlbumInfo`, `getAlbumInfo2` | Album tracks, descriptions and artwork |
| `getAlbumList`, `getAlbumList2` | Album lists, recommendations and recent playback; explicit NAS-folder selection uses the local branch |
| `getGenres` | Online or local-library genre information |
| `search`, `search2`, `search3` | Source selection follows online-search settings and query prefixes |
| `startScan`, `getScanStatus` | Refresh the local index and report scan state, counts and failures, rather than a fixed placeholder |

Online search uses `subsonic.onlineSearch` and `subsonic.onlineSearchMode`: `fallback` supplements insufficient local results, `merge` combines results and `local_only` stays local. Use `local:`, `online:` or platform prefixes to restrict scope. Online playback still requires a working custom source.

### Media, playlists and favorites

| Methods | Behavior and limits |
| --- | --- |
| `getSong` | Online or local track details |
| `stream`, `download` | Audio access; local files support Range, while online resources depend on source resolution |
| `getCoverArt` | Track, album and playlist artwork, with a `size` parameter |
| `getLyrics`, `getLyricsBySongId` | Ordinary and structured lyrics; see the local-library guide for sources and word-level limitations |
| `getPlaylists`, `getPlaylist` | User, shared and enabled read-only local playlists |
| `createPlaylist`, `updatePlaylist`, `deletePlaylist` | User playlist management; built-in and shared playlists have write restrictions |
| `getStarred`, `getStarred2`, `star`, `unstar` | Read and update favorites |
| `setRating` | Store per-user ratings from 0–5; 0 clears the rating |

See [favorites and playlist synchronization](../guide/subsonic-local-library.md#favorites-and-playlist-synchronization) for local/mixed playlist rules, deletion behavior and backup files.

### Discovery and radio

| Methods | Behavior and limits |
| --- | --- |
| `getRandomSongs`, `getSongsByGenre`, `getSongsByGenre2` | Random or genre-filtered tracks, including a local-library branch |
| `getSimilarSongs`, `getSimilarSongs2`, `getSonicSimilarTracks` | Select similar tracks using conditions such as the same artist; no acoustic analysis |
| `getTopSongs` | Artist top tracks |
| `getRecommendedSongs`, `getDailySongs`, `getSongsByTag` | Server recommendations; the last two are aliases, and `getSongsByTag` does not perform independent tag search |
| `getInternetRadioStations` | Available official stations, user stations and source-playlist stations |
| `createInternetRadioStation`, `updateInternetRadioStation`, `deleteInternetRadioStation` | User station management; a plural delete compatibility entry is also accepted |

Daily recommendations obtain tracks from online recommended albums, deduplicate them and use stable shuffling within a day. Upstream failures can fall back to the last successful results. Per-account filtering excludes tracks in the disliked rating range: `0 < rating <= subsonic.dislikeRating`, whose default threshold is 1.

Server-generated station streams use absolute URLs with expiring tickets rather than long-lived credentials. External user station URLs are returned as configured. Reverse proxies must pass the correct protocol information, and clients must be able to reach these URLs. Unavailable official upstream stations are temporarily hidden.

### Playback activity, queues and bookmarks

| Methods | Behavior and limits |
| --- | --- |
| `scrobble` | Store the requested track playback records, accepting playback timestamps |
| `reportPlayback` | Update state and position; record history only for `stopped` without `ignoreScrobble=true` |
| `getNowPlaying` | Recent playback activity, optionally with position; not live monitoring of every client |
| `getPlayQueue`, `savePlayQueue` | Persist a queue per user |
| `getPlayQueueByIndex`, `savePlayQueueByIndex` | Read/write queues by index; an out-of-range current index returns a parameter error |
| `getBookmarks`, `createBookmark`, `deleteBookmark` | Persist bookmarks per user |

## Transcoding and media limits

| Setting | Default | Purpose |
| --- | --- | --- |
| `subsonic.transcode.enabled` | `false` | Enable server transcoding |
| `subsonic.transcode.format` | `mp3` | Target format: `mp3`, `opus` or `aac` |
| `subsonic.transcode.maxConcurrent` | `2` | Maximum concurrent transcodes |

Transcoding requires available ffmpeg. `stream` / `download` can select transcoding based on client bitrate requirements; `timeOffset` is measured in seconds. OpenSubsonic `getTranscodeDecision` / `getTranscodeStream` provide decisions and signed parameters.

Without ffmpeg, online resources can fall back to their original links, which may not match client format requirements. Target format, source availability and server resources affect playback.

## OpenSubsonic extensions

`getOpenSubsonicExtensions` advertises these extensions, all at version 1:

| Extension | Capability |
| --- | --- |
| `formPost` | Form POST parameters |
| `songLyrics` | Structured lyrics |
| `playbackReport` | Playback state and position reports |
| `sonicSimilarity` | Similar-track entry using heuristic selection |
| `indexBasedQueue` | Index-based queue management |
| `transcodeOffset` | Transcode time offsets |
| `transcoding` | Transcode decisions and streams |

Advertising an extension means its endpoint exists; client calls and presentation still depend on client implementation.

## Unsupported scope

Video, podcasts, chat, sharing and server-account administration through Subsonic are outside the current implementation. Typical unsupported methods include `getVideos`, `getPodcasts`, `getChatMessages`, `createShare`, `createUser`, `updateUser`, `deleteUser`, `changePassword` and `getAvatar`.

Unsupported methods return `Method not found`. Manage accounts through the console. For missing controls or compatibility issues, compare this coverage with the methods actually requested by the client.
