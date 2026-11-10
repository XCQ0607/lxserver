# Subsonic local music library

Subsonic clients can access the current account's server music files, cache and custom music directory. This page covers directory scope, playlist settings, media access and persistent data. See [Subsonic protocol support](../api/subsonic.md) for endpoint coverage.

## Setup and directory scope

1. Select the account's persistent storage location in the console. For NAS storage, enable its custom music directory and ensure the server process can read it.
2. Enable the required local playlist entries under **Subsonic settings** and save.
3. Select the **NAS local music (storage + custom directory)** music folder in the client to browse local albums, artists, genres and tracks. Directory browsing also provides a NAS entry.
4. After adding or updating files, use the client's scan action to call `startScan` and refresh the index.

| Account storage setting | Built-in library scope |
| --- | --- |
| `data` | The account's `music` and `cache` under the data directory |
| `root` | The account's `music` and `cache` under the program root |
| Enabled custom directory | Accessible files in that directory, in addition to built-in storage; the same physical file is included only once |

A temporary directory switch in the web file manager does not change Subsonic's library scope. Changing account storage or disabling the custom directory changes subsequent requests. Saved track IDs cannot bypass the current access scope.

## Local playlist settings

The console's **Subsonic settings → Local playlists** section provides:

| Setting | Default | Behavior |
| --- | --- | --- |
| `subsonic.localPlaylist` | `true` | Expose the read-only local-tracks playlist for the account; disabling it hides both local and custom-directory playlists |
| `subsonic.customPlaylist` | `true` | Expose a separate custom-directory playlist when the parent switch and the account's custom directory are enabled |
| `subsonic.cachePlaylist` | `false` | Include the selected storage location's `cache` tracks in the local playlist; otherwise include only `music` |

The server places local playlists near the beginning of the list; client-side sorting takes precedence in the client. Enabled entries remain available even when empty. Disabling the parent switch retains the child settings.

Custom-directory tracks are displayed separately from built-in tracks. If the custom directory points to built-in `music` or `cache`, files belong to built-in storage first and are not duplicated in the custom playlist. Cache tracks remain subject to the cache-playlist switch. These switches control playlist presentation, not the complete library used by search, albums and ratings.

## Browsing, search and scans

- Explicit NAS-folder selection uses the local library for album browsing and related endpoints. Default newest/random recommendations still use the online recommendation pool and do not automatically include NAS albums.
- `local:query` searches local files only. Ordinary searches follow server search settings; explicit online searches use the online branch.
- The index reads track number, disc number, album artist, year and genre. Albums are grouped by directory, album name and album artist to keep versions in different directories separate.
- Results are cached for 30 seconds while directory scope remains unchanged. `startScan` forces a refresh; `getScanStatus` returns scan state, track count and failure information.

## Playback, artwork and lyrics

Local tracks support details, streaming, downloads and HTTP Range requests. Track and album durations are returned as integer seconds while precise durations remain internal. File sizes are actual byte counts.

With server transcoding enabled and ffmpeg available, local playback supports format conversion, bitrate limits and time offsets. See [transcoding and media limits](../api/subsonic.md#transcoding-and-media-limits).

### Lyric sources

Lyrics are resolved in this order:

1. A non-empty external LRC file with the same basename.
2. Embedded audio lyrics.
3. The web player's server-side lyric cache.
4. The linked music platform's online lyric endpoint.

Online fallback uses linked platform IDs only; it does not guess another track by title. Requests have timeouts, share concurrent work per account and briefly cache successful results. Structured lyrics can include original, translated and transliterated text; ordinary lyrics follow the translation setting. Multiple timestamps, integer-second timestamps and offsets are supported. Word-timed content is not additionally converted to OpenSubsonic's word-level format.

### Artwork sources

Local tracks use embedded or directory artwork and accept client-added `al-`, `ar-`, `tr-`, `sg-` and `mg-` prefixes. Access remains restricted to the current account's files.

Ordinary user playlist lists and details return a consistent artwork token. Resolution prefers playlist network artwork, then attempts to obtain missing artwork for a linked online playlist, then falls back to the first track's artwork, including local artwork. Empty playlists without artwork return empty content. Resolution is account-scoped.

## File identity and platform links

Each local file has an independent `local_<UUID>` ID. Linking an online platform does not change that ID or rewrite audio tags. Responses expose local identity and link status through `lxStorage=local`, `lxLinked` and `comment`; presentation depends on the client.

Local and online tracks are not automatically merged by title. Identity is stored by physical path: updating a file at the same path or linking a platform retains its ID; externally moving or renaming it creates a new file identity, without fingerprint tracking. Tracks outside the current scope disappear from results, but playlist references and favorites remain and can recover when the original scope is restored.

## Favorites and playlist synchronization

| Operation | Storage and synchronization |
| --- | --- |
| Create a purely local playlist | Stored on the server only; excluded from official LX client sync |
| Create a mixed playlist | Online tracks enter the native playlist; local members and mixed order are stored separately |
| Resynchronize an online playlist | Online members follow synchronization changes; local members remain; new online members are appended to the combined list by default |
| Remove a track by position | Resolve the position against the mixed list visible to the client |
| Delete a mixed playlist | Remove the native online playlist and local supplemental state, without deleting audio files |
| Favorite a local track | Use `star` / `unstar`; directly adding local members to the built-in favorites playlist returns guidance to use favorites |

If another synchronization operation deletes the native playlist, local supplemental members can still appear as a server-side playlist. Playback history, queues and bookmarks can resolve local tracks.

## Backup and troubleshooting

Back up these files with the account's user data:

| File | Contents |
| --- | --- |
| `subsonic-local-registry.json` | File identities and metadata; not disposable cache |
| `subsonic-local-state.json` | Local favorites, purely local playlists and mixed-playlist supplemental state |

For a missing library, check account storage selection, custom-directory enablement and server filesystem permissions, then scan and inspect `getScanStatus`. For missing cache tracks in the local playlist, check `subsonic.cachePlaylist`.

Some clients use track `size` to decide whether to load playlist artwork. Online tracks prefer source-provided byte counts, otherwise estimate from bitrate and duration; unknown duration without a known size still returns 0. Estimates are not used for actual audio Content-Length or Range responses.

Large-library scanning depends on directory access and tag-reading performance. Transcoding depends on ffmpeg and server resources. Artwork, lyrics, scan progress and other controls also depend on client implementation.
