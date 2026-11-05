# Current HTTP route index

Inventory of the current workspace implementation. This is an entry-point index, not a shared response schema. Authentication, request bodies and response shapes vary by handler. Fields are a partial list of directly read query/body properties, not required-field declarations; destructured fields are not exhaustively listed.

See [API reference](./reference.md). File operations are delegated to VueFinder (see the reference). Subsonic uses its configured protocol path outside `/api/*`.

## login

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/login` | — |

## status

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/status` | — |

## users

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET / POST / PUT / DELETE | `/api/users` | — |

## data

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/data` | `user` |

## data/snapshots

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/data/snapshots` | `user` |

## data/snapshot

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/data/snapshot` | `user`, `id` |

## data/restore-snapshot

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/data/restore-snapshot` | `user` |

## music/user

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/user/list/remove` | — |
| POST | `/api/music/user/list/reorder` | — |
| POST | `/api/music/user/list/add` | — |

## data/delete-snapshot

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/data/delete-snapshot` | `user` |

## data/upload-snapshot

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/data/upload-snapshot` | `user`, `time`, `filename` |

## user/verify

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/user/verify` | — |

## user/login

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/user/login` | — |

## user/logout

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/user/logout` | — |

## user/auth

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/user/auth/verify` | — |

## user/list

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/user/list` | `user` |
| POST | `/api/user/list` | `user` |

## user/library

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/user/library/artists` | — |
| POST | `/api/user/library/artists` | — |
| GET | `/api/user/library/albums` | — |
| POST | `/api/user/library/albums` | — |

## user/dislike

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/user/dislike/library/artists` | — |
| POST | `/api/user/dislike/library/artists` | — |
| GET | `/api/user/dislike/library/albums` | — |
| POST | `/api/user/dislike/library/albums` | — |

## user/sync-download

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/user/sync-download/status` | — |
| PUT | `/api/user/sync-download/settings` | — |
| POST | `/api/user/sync-download/trigger` | `playlistId` |
| POST | `/api/user/sync-download/cancel` | — |
| POST | `/api/user/sync-download/pause` | — |
| GET | `/api/user/sync-download/progress` | — |
| POST | `/api/user/sync-download/migrate-storage` | — |

## user/settings

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/user/settings` | — |
| POST | `/api/user/settings` | — |

## user/token

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET / POST | `/api/user/token/config` | — |
| POST | `/api/user/token/add` | — |
| POST | `/api/user/token/remove` | — |
| POST | `/api/user/token/update` | — |
| POST | `/api/user/token/toggle` | — |
| GET | `/api/user/token/logs` | `tokenMasked` |

## user/sound-effects

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/user/sound-effects` | — |
| POST | `/api/user/sound-effects` | — |

## tasks/status

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/tasks/status` | — |

## music/tasks

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/tasks/status` | — |
| POST | `/api/music/tasks/trigger` | `id` |
| GET / POST | `/api/music/tasks/user-data` | `task`, `trim` |

## tasks/trigger

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/tasks/trigger` | `id` |

## tasks/user-data

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET / POST | `/api/tasks/user-data` | `task`, `trim` |

## music/cache

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/cache/config` | — |
| GET | `/api/music/cache/directories` | — |
| POST | `/api/music/cache/sync` | — |
| GET | `/api/music/cache/subdirs` | `user`, `folder` |
| POST | `/api/music/cache/mkdir` | — |
| POST | `/api/music/cache/categorize` | — |
| POST | `/api/music/cache/subdirs/rename` | — |
| POST | `/api/music/cache/subdirs/delete` | — |
| POST | `/api/music/cache/rename` | — |
| GET | `/api/music/cache/check` | `name`, `singer`, `source`, `songmid`, `songId`, `quality`, `exactQuality` |
| GET | `/api/music/cache/queue` | — |
| POST | `/api/music/cache/queue` | — |
| POST | `/api/music/cache/queue/concurrency` | — |
| POST | `/api/music/cache/queue/resume` | — |
| POST | `/api/music/cache/queue/remove` | — |
| POST | `/api/music/cache/download` | — |
| POST | `/api/music/cache/stop` | — |
| GET | `/api/music/cache/stats` | — |
| POST | `/api/music/cache/clear` | — |
| POST | `/api/music/cache/lyric/clear` | — |
| GET | `/api/music/cache/lyric/orphans` | — |
| POST | `/api/music/cache/lyric/orphans/delete` | — |
| GET | `/api/music/cache/progress` | `ids` |
| GET | `/api/music/cache/list` | `user` |
| GET | `/api/music/cache/cover` | `user`, `token`, `filename`, `size` |
| POST | `/api/music/cache/remove` | — |
| POST | `/api/music/cache/move` | — |
| POST | `/api/music/cache/switch-base` | — |
| POST | `/api/music/cache/updateMetadata` | — |
| GET | `/api/music/cache/embedLyric` | `filename`, `folder` |
| POST | `/api/music/cache/embedLyric` | — |
| POST | `/api/music/cache/link` | — |
| GET | `/api/music/cache/lyric` | `source`, `songmid`, `songId`, `id`, `name`, `singer` |
| POST | `/api/music/cache/lyric` | — |

## utils/check-dir

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/utils/check-dir` | — |

## music/custom

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/custom/list` | — |
| POST | `/api/music/custom/sync` | — |
| handler | `/api/music/custom/file` | `filename`, `user`, `token` |
| GET | `/api/music/custom/cover` | `user`, `token`, `filename`, `size` |
| POST | `/api/music/custom/remove` | — |
| POST | `/api/music/custom/link` | — |
| POST | `/api/music/custom/updateMetadata` | — |
| GET | `/api/music/custom/embedLyric` | `filename` |
| POST | `/api/music/custom/embedLyric` | — |

## music/identify

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/identify` | — |

## music/lyric

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/lyric` | `source`, `songmid`, `songId`, `id`, `name`, `singer`, `hash`, `interval`, `copyrightId`, `albumId`, `lrcUrl`, `mrcUrl`, `trcUrl` |
| POST | `/api/music/lyric` | — |

## music/download

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET / HEAD | `/api/music/download` | `token`, `url`, `filename`, `inline`, `tag`, `taskId`, `name`, `singer`, `album`, `pic`, `lyric`, `source`, `songmid`, `hash`, `interval` |

## data/delete-playlist

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/data/delete-playlist` | — |

## data/delete-song

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/data/delete-song` | — |

## data/rename-playlist

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/data/rename-playlist` | — |

## data/batch-delete-songs

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/data/batch-delete-songs` | — |

## music/config

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/config` | — |

## music/auth

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/auth` | — |
| POST | `/api/music/auth/logout` | — |
| GET | `/api/music/auth/verify` | — |

## music/search

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/search` | `name`, `singer`, `source`, `type`, `limit`, `page` |

## music/tipSearch

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/tipSearch` | `name`, `source` |

## music/artistDetail

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/artistDetail` | `id`, `source` |

## music/artistAlbums

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/artistAlbums` | `id`, `source`, `page` |

## music/artistSongs

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/artistSongs` | `id`, `source`, `order` |

## music/albumSongs

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/albumSongs` | `id`, `source` |

## music/progress

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/progress` | `reqId` |

## music/url

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/url` | — |

## music/quality

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/quality/size` | — |

## music/hotSearch

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/hotSearch` | `source` |

## music/songList

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/songList/tags` | `source` |
| GET | `/api/music/songList/list` | `source`, `tagId`, `sortId`, `page` |
| GET | `/api/music/songList/detail` | `source`, `id`, `page` |
| GET | `/api/music/songList/search` | `source`, `text`, `page` |
| GET | `/api/music/songList/userPlaylist` | `source`, `uid`, `page` |

## music/leaderboard

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/leaderboard/boards` | `source` |
| GET | `/api/music/leaderboard/list` | `source`, `bangid`, `page` |

## music/comment

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/comment` | — |

## music/dislike

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/dislike` | — |
| POST | `/api/music/dislike/add` | — |
| POST | `/api/music/dislike/remove` | — |

## admin/verify

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/admin/verify` | — |

## custom-source/validate

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/validate` | — |

## custom-source/import

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/import` | — |

## custom-source/upload

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/upload` | — |

## custom-source/update

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/update` | — |

## custom-source/list

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/custom-source/list` | `username` |

## custom-source/toggle

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/toggle` | — |

## custom-source/delete

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/delete` | — |

## custom-source/reorder

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/reorder` | — |

## custom-source/update-platforms

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/custom-source/update-platforms` | — |

## config

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET / POST | `/api/config` | — |

## config/backups

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/config/backups` | — |
| GET | `/api/config/backups/download` | `file` |
| POST | `/api/config/backups/restore` | — |

## config/backup-now

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/config/backup-now` | — |

## config/test-proxy

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/config/test-proxy` | — |

## logs

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/logs` | `type`, `lines` |

## stats

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/stats` | — |

## webdav/test

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/webdav/test` | — |

## webdav/sync-file

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/webdav/sync-file` | — |

## webdav/backup

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/webdav/backup` | — |
| DELETE | `/api/webdav/backup` | — |

## webdav/sync

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/webdav/sync` | — |

## webdav/backups

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/webdav/backups` | — |

## webdav/restore

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/webdav/restore` | — |

## webdav/logs

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/webdav/logs` | — |

## webdav/progress

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/webdav/progress` | `auth` |

## backup/download

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/backup/download` | `auth` |

## backup/upload

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/backup/upload` | — |

## admin/reload

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/admin/reload` | — |

## restart

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/restart` | — |

## files/download

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/files/download` | `path` |

## music/auto-link

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| GET | `/api/music/auto-link/status` | — |
| GET | `/api/music/auto-link/candidates` | — |
| POST | `/api/music/auto-link/start` | — |
| POST | `/api/music/auto-link/cancel` | — |

## music/remaster

| Method | Path | Direct fields (partial) |
| --- | --- | --- |
| POST | `/api/music/remaster/start` | — |
| GET | `/api/music/remaster/status` | — |
| POST | `/api/music/remaster/cancel` | — |
