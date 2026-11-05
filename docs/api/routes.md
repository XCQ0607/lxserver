# 当前 HTTP 路由索引

对照当前工作区实现整理。此页是路由入口索引，不是统一响应协议；各端点的鉴权、请求体和返回结构仍以对应处理分支为准。字段列仅列出分支直接读取的部分查询参数或 body 属性，不代表必填项，也不包含所有解构字段。

详解见 [API 参考](./reference.md)。文件管理独立委托给 VueFinder，见参考页文件管理章节；Subsonic 使用配置的协议路径，不属于 `/api/*`。

## login

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/login` | — |

## status

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/status` | — |

## users

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET / POST / PUT / DELETE | `/api/users` | — |

## data

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/data` | `user` |

## data/snapshots

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/data/snapshots` | `user` |

## data/snapshot

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/data/snapshot` | `user`, `id` |

## data/restore-snapshot

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/data/restore-snapshot` | `user` |

## music/user

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/music/user/list/remove` | — |
| POST | `/api/music/user/list/reorder` | — |
| POST | `/api/music/user/list/add` | — |

## data/delete-snapshot

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/data/delete-snapshot` | `user` |

## data/upload-snapshot

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/data/upload-snapshot` | `user`, `time`, `filename` |

## user/verify

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/user/verify` | — |

## user/login

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/user/login` | — |

## user/logout

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/user/logout` | — |

## user/auth

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/user/auth/verify` | — |

## user/list

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/user/list` | `user` |
| POST | `/api/user/list` | `user` |

## user/library

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/user/library/artists` | — |
| POST | `/api/user/library/artists` | — |
| GET | `/api/user/library/albums` | — |
| POST | `/api/user/library/albums` | — |

## user/dislike

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/user/dislike/library/artists` | — |
| POST | `/api/user/dislike/library/artists` | — |
| GET | `/api/user/dislike/library/albums` | — |
| POST | `/api/user/dislike/library/albums` | — |

## user/sync-download

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/user/sync-download/status` | — |
| PUT | `/api/user/sync-download/settings` | — |
| POST | `/api/user/sync-download/trigger` | `playlistId` |
| POST | `/api/user/sync-download/cancel` | — |
| POST | `/api/user/sync-download/pause` | — |
| GET | `/api/user/sync-download/progress` | — |
| POST | `/api/user/sync-download/migrate-storage` | — |

## user/settings

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/user/settings` | — |
| POST | `/api/user/settings` | — |

## user/token

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET / POST | `/api/user/token/config` | — |
| POST | `/api/user/token/add` | — |
| POST | `/api/user/token/remove` | — |
| POST | `/api/user/token/update` | — |
| POST | `/api/user/token/toggle` | — |
| GET | `/api/user/token/logs` | `tokenMasked` |

## user/sound-effects

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/user/sound-effects` | — |
| POST | `/api/user/sound-effects` | — |

## tasks/status

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/tasks/status` | — |

## music/tasks

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/tasks/status` | — |
| POST | `/api/music/tasks/trigger` | `id` |
| GET / POST | `/api/music/tasks/user-data` | `task`, `trim` |

## tasks/trigger

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/tasks/trigger` | `id` |

## tasks/user-data

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET / POST | `/api/tasks/user-data` | `task`, `trim` |

## music/cache

| 方法 | 路径 | 直接读取字段（部分） |
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

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/utils/check-dir` | — |

## music/custom

| 方法 | 路径 | 直接读取字段（部分） |
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

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/music/identify` | — |

## music/lyric

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/lyric` | `source`, `songmid`, `songId`, `id`, `name`, `singer`, `hash`, `interval`, `copyrightId`, `albumId`, `lrcUrl`, `mrcUrl`, `trcUrl` |
| POST | `/api/music/lyric` | — |

## music/download

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET / HEAD | `/api/music/download` | `token`, `url`, `filename`, `inline`, `tag`, `taskId`, `name`, `singer`, `album`, `pic`, `lyric`, `source`, `songmid`, `hash`, `interval` |

## data/delete-playlist

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/data/delete-playlist` | — |

## data/delete-song

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/data/delete-song` | — |

## data/rename-playlist

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/data/rename-playlist` | — |

## data/batch-delete-songs

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/data/batch-delete-songs` | — |

## music/config

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/config` | — |

## music/auth

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/music/auth` | — |
| POST | `/api/music/auth/logout` | — |
| GET | `/api/music/auth/verify` | — |

## music/search

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/search` | `name`, `singer`, `source`, `type`, `limit`, `page` |

## music/tipSearch

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/tipSearch` | `name`, `source` |

## music/artistDetail

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/artistDetail` | `id`, `source` |

## music/artistAlbums

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/artistAlbums` | `id`, `source`, `page` |

## music/artistSongs

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/artistSongs` | `id`, `source`, `order` |

## music/albumSongs

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/albumSongs` | `id`, `source` |

## music/progress

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/progress` | `reqId` |

## music/url

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/music/url` | — |

## music/quality

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/music/quality/size` | — |

## music/hotSearch

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/hotSearch` | `source` |

## music/songList

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/songList/tags` | `source` |
| GET | `/api/music/songList/list` | `source`, `tagId`, `sortId`, `page` |
| GET | `/api/music/songList/detail` | `source`, `id`, `page` |
| GET | `/api/music/songList/search` | `source`, `text`, `page` |
| GET | `/api/music/songList/userPlaylist` | `source`, `uid`, `page` |

## music/leaderboard

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/leaderboard/boards` | `source` |
| GET | `/api/music/leaderboard/list` | `source`, `bangid`, `page` |

## music/comment

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/music/comment` | — |

## music/dislike

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/dislike` | — |
| POST | `/api/music/dislike/add` | — |
| POST | `/api/music/dislike/remove` | — |

## admin/verify

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/admin/verify` | — |

## custom-source/validate

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/validate` | — |

## custom-source/import

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/import` | — |

## custom-source/upload

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/upload` | — |

## custom-source/update

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/update` | — |

## custom-source/list

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/custom-source/list` | `username` |

## custom-source/toggle

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/toggle` | — |

## custom-source/delete

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/delete` | — |

## custom-source/reorder

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/reorder` | — |

## custom-source/update-platforms

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/custom-source/update-platforms` | — |

## config

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET / POST | `/api/config` | — |

## config/backups

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/config/backups` | — |
| GET | `/api/config/backups/download` | `file` |
| POST | `/api/config/backups/restore` | — |

## config/backup-now

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/config/backup-now` | — |

## config/test-proxy

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/config/test-proxy` | — |

## logs

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/logs` | `type`, `lines` |

## stats

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/stats` | — |

## webdav/test

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/webdav/test` | — |

## webdav/sync-file

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/webdav/sync-file` | — |

## webdav/backup

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/webdav/backup` | — |
| DELETE | `/api/webdav/backup` | — |

## webdav/sync

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/webdav/sync` | — |

## webdav/backups

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/webdav/backups` | — |

## webdav/restore

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/webdav/restore` | — |

## webdav/logs

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/webdav/logs` | — |

## webdav/progress

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/webdav/progress` | `auth` |

## backup/download

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/backup/download` | `auth` |

## backup/upload

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/backup/upload` | — |

## admin/reload

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/admin/reload` | — |

## restart

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/restart` | — |

## files/download

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/files/download` | `path` |

## music/auto-link

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| GET | `/api/music/auto-link/status` | — |
| GET | `/api/music/auto-link/candidates` | — |
| POST | `/api/music/auto-link/start` | — |
| POST | `/api/music/auto-link/cancel` | — |

## music/remaster

| 方法 | 路径 | 直接读取字段（部分） |
| --- | --- | --- |
| POST | `/api/music/remaster/start` | — |
| GET | `/api/music/remaster/status` | — |
| POST | `/api/music/remaster/cancel` | — |
