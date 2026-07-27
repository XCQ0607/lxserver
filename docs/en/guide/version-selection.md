# Choosing Between V1 and V2

Both V1 and V2 can play, cache, and download music. They are not simply old and new releases; they use different storage models for different deployment needs.

## Quick Decision

- Choose **V1** when you want to browse downloaded tracks in your NAS file manager and copy, rename, back up, or scan them with external media tools.
- Choose **V2** when a family or multiple accounts share one server and stronger user isolation, sharing, and storage deduplication matter more.

## Detailed Comparison

| Item | V1 | V2 |
| --- | --- | --- |
| Typical users | Individuals, one user, or a few users | Families, multiple users, shared NAS deployments |
| Downloads | Downloads music to the server | Downloads music to the server |
| File management | `/music` and `/cache` contain readable filenames and expose the source files directly | Media is managed through the Web UI and database; direct physical-file changes are discouraged |
| Physical storage | User-facing file directories | SQLite index plus a content-addressed `DATA_PATH/media` repository |
| Duplicate files | Different users may store separate copies of the same track | Identical content can be reused across users to reduce duplicate storage |
| Multi-user features | Basic user isolation with a straightforward directory layout | Stronger isolation, administrator source sharing, and user-to-user playlist sharing |
| External file tools | Works well with NAS file managers, backup software, and media organizers | Access should go through the application; physical objects use SHA-256 hash names |

## Who Should Use V1

V1 is designed for users who treat the music files themselves as the primary asset. Downloaded tracks remain directly visible under the mounted `/music` directory, while cached tracks are stored under `/cache`. NAS file managers, backup software, and other media tools can process these files directly.

If your main requirement is to download tracks and retain direct access to the source files, V1 is the better fit.

## Who Should Use V2

V2 is designed for multiple accounts sharing one NAS. SQLite stores users, media metadata, and ownership relationships, while audio is stored in a content-addressed repository under `DATA_PATH/media`. Multiple users can reference the same audio content without storing duplicate physical files.

V2 still supports music downloads, but its Download Library and Cache Area are logical categories. The underlying physical files are internal media objects and should not be manually renamed or moved.

## Deployment and Migration Limits

The V1 and V2 persistent-data layouts are incompatible:

- Do not mount or share the same data directory between the two versions.
- V2 is not an in-place upgrade and cannot start directly from V1 data.
- Before moving from V1 to V2, back up playlists and required data, deploy V2 from scratch, and then import them.
- Keeping V1 is usually the safer choice when direct management of existing music files remains important.

Repositories:

- V1: <https://github.com/bobcc4/lxserver>
- V2: <https://github.com/bobcc4/lxserver-v2>
