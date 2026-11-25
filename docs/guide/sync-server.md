# 同步服务、账号与管理后台

### 浏览器

| 入口 | 默认地址 | 用途 |
| --- | --- | --- |
| Web 播放器 | `http://服务器IP:9527/` | 搜索、播放、歌单和本地音乐管理 |
| 管理后台 | `http://服务器IP:9527/admin` | 用户、系统配置、备份、日志和文件管理 |

可以通过 `PLAYER_PATH` 和 `ADMIN_PATH` 改变路径。例如播放器设为 `/music` 后，访问 `http://服务器IP:9527/music`。两个路径不能相同，也不能占用 `/api` 路径；根路径使用 `/`。

手机和电脑使用相同地址访问。音频自动播放、锁屏播放和媒体按键行为还受浏览器及系统权限影响。

### LX Music 桌面端与移动端

在 LX Music 的“设置 → 同步设置”中选择自定义服务器。

| 模式 | 连接地址示例 | 密码 | 要求 |
| --- | --- | --- | --- |
| 用户路径模式，默认开启 | `http://192.168.1.100:9527/user1` | user1 的同步密码 | `USER_ENABLE_PATH=true`，按用户名区分用户，允许不同用户密码相同 |
| 根路径模式，默认关闭 | `http://192.168.1.100:9527` | 对应用户的同步密码 | `USER_ENABLE_ROOT=true`，用户密码必须唯一 |

这里填写个人账号的同步密码。连接同步服务不使用 `/admin`、`/rest` 或播放器访问密码。

首次同步时留意客户端给出的合并、覆盖方向。已有歌单建议先备份，再决定哪一端的数据作为基准。同步协议和配置细节见 [同步服务说明](https://github.com/XCQ0607/lxserver/blob/main/md/lxserver.md)。

### Subsonic 客户端

支持使用音流、Feishin、Symfonium 等客户端访问已实现的 Subsonic/OpenSubsonic 接口。各客户端支持的功能不同，接口范围和已知限制见 [Subsonic 协议支持](../api/subsonic.md)。

默认连接信息：

| 项目 | 填写内容 |
| --- | --- |
| 服务地址 | `http://服务器IP:9527/rest` |
| 用户名 | 后台创建的个人账号 |
| 密码 | 该账号的同步密码 |

部分客户端会自动拼接 `/rest`；这类客户端按其提示填写主机地址，避免最终请求变成 `/rest/rest`。

默认与主服务共用端口。需要独立端口时，在后台开启独立监听，或在配置中设置 `subsonic.standalone=true`，并设置 `subsonic.port`。端口默认值为 `4050`，**只设置 `SUBSONIC_PORT` 不会开启独立监听**。Docker 还需要额外映射对应端口；协议路径由 `subsonic.path` 决定。

在线搜索由 `subsonic.onlineSearch` 和 `subsonic.onlineSearchMode` 控制：

| 模式 | 行为 |
| --- | --- |
| `fallback` | 本地搜索不足时补充在线结果 |
| `merge` | 合并本地与在线结果 |
| `local_only` | 仅搜索本地内容 |

搜索词还支持 `wy:`、`tx:`、`kw:`、`kg:`、`mg:` 指定平台，以及 `online:`、`local:` 前缀指定搜索范围。在线播放仍依赖可用的自定义音源。

Subsonic 本地曲库按当前账号的持久化存储设置读取音乐和缓存，并加入该账号已启用的自定义目录。网页中临时切换浏览目录，不会改变 Subsonic 的曲库范围。

默认返回只读的“本地歌曲”歌单；自定义目录可以单独显示。纯本地歌单保存在服务端，不进入 LX 官方客户端同步；混合歌单中的在线歌曲和本地成员分别保存。详情见 [Subsonic 本地音乐库](./subsonic-local-library.md)。



## 账号与权限

### 三种密码的用途

| 凭据 | 配置位置 | 用途 |
| --- | --- | --- |
| 管理员密码 | `admin.password` / `ADMIN_PASSWORD` | 管理后台、系统配置和管理员操作 |
| 播放器访问密码 | `player.password` / `WEBPLAYER_PASSWORD` | 开启 `player.enableAuth` 后进入 Web 播放器 |
| 用户同步密码 | 后台用户管理或 `LX_USER_<用户名>` | 个人账号登录、LX Music 同步及 Subsonic 登录 |

播放器访问密码控制进入播放器，不会自动建立个人账号或授予目录写入权限。

### 公共访问与个人权限

`user.enablePublicRestriction` 控制公共权限限制，默认开启。具体能力还由对应开关决定，不能仅凭“已经登录”判断某个操作一定可用。

| 配置项 | 控制内容 |
| --- | --- |
| `user.enablePublicNonAdminLocalMusic` | 非管理员访问公共本地音乐 |
| `user.enablePublicNonAdminBrowserDownload` | 非管理员浏览器下载 |
| `user.enablePublicNonAdminServerCache` | 非管理员向服务器缓存或写入歌曲 |
| `user.enablePublicFavorites`、`user.enablePublicNonAdminAccess` | 公开收藏的展示与访问 |
| `user.enableLoginCacheRestriction` | 登录用户缓存设置限制 |
| `user.enableCacheSizeLimit`、`user.cacheSizeLimit` | 缓存容量限制 |

自定义音乐目录还需要给具体用户设置 `enableCustomMusicDir` 和 `customMusicDir`。`allowOperateCustomMusicDir` 控制删除、洗版等操作，`allowWriteCustomMusicDir` 控制关联、元数据和歌词写入。挂载目录可读不代表自动允许修改文件。

需要脚本访问时，可在个人 Token 管理中创建持久化 API Token，设置名称、有效期并按需禁用或删除。用户 Token 不等于管理员密码；每个脚本单独分配 Token，后续可以单独撤销。接口鉴权方式见 [API 参考](../api/reference.md)。

## Subsonic 本地库与播放选项

| 设置 / 功能 | 行为与条件 |
| --- | --- |
| 本地音乐文件夹 | 明确选择本地文件夹时使用本地库分支；默认推荐池不等同于 NAS 全部专辑 |
| `subsonic.localPlaylist` / `subsonic.customPlaylist` | 分别控制只读本地歌单和独立自定义目录歌单，后者依赖前者及账号目录启用 |
| `subsonic.cachePlaylist` | 是否在本地歌单中包含缓存目录歌曲，默认 false；不缩减其他接口共用的完整曲库 |
| `subsonic.cacheOnPlay` | 播放在线资源时触发落盘缓存，默认 false |
| `subsonic.saveDownload` | 下载请求是否保存到服务器，**默认否**。识别为内建能力（标准 `/rest/download` 与裸 okhttp + gzip 的 stream 下载）；开启后落盘到 music 下载目录而非 cache。默认关闭时仅投递给客户端，服务器不落盘、不触发播放预缓存、不补传备份 |
| `subsonic.playCacheFirst` | 优先通过服务器已有文件播放，默认 false；使用时服务器承担文件传输 |
| `subsonic.quality.*` / `subsonic.source.*` | 控制候选音质和跨平台/脚本优选，不保证每首都有目标音质 |
| `subsonic.transcode.enabled` | 播放时服务端转码，默认 false，需要可用 ffmpeg；与洗版下载替换不同 |
| `subsonic.transcode.format` / `subsonic.transcode.maxConcurrent` | 默认 mp3、并发 2，可配置格式为 mp3/opus/aac |
| 收藏与评分 | 本地歌曲通过 star/unstar 管理收藏；评分与不喜欢的双向联动有单独开关 |
| 网络电台 | 实现按账号保存、创建、更新、删除电台的协议接口，客户端是否提供编辑入口取决于其支持 |

本地歌曲使用独立 ID，关联平台不会把它变成在线歌曲。文件在原路径更新通常保留身份，外部移动或重命名文件则可能产生新 ID。混合歌单的本地成员与顺序单独保存；删除歌单不等于删除音频文件。

客户端封面、逐字歌词、扫描进度与可用的目录展示受协议和客户端能力共同影响。网页版有某个设置不代表第三方客户端会提供同名控件。详细本地库行为见 [Subsonic 本地音乐库](./subsonic-local-library.md)。

## 后台各模块的用途

| 模块 | 常用操作 | 注意事项 |
| --- | --- | --- |
| 状态与设备 | 查看运行时间、资源占用和连接设备 | 设备在线不代表后台下载一定在执行 |
| 用户管理 | 新建、重命名、禁用账号，设置自定义目录 | 删除账号时区分移除账号与删除数据 |
| 数据与快照 | 查看歌单、恢复历史快照 | 恢复会改变同步端后续读取的数据，先确认账号和时间 |
| 系统配置 | 路径、认证、代理、缓存和 Subsonic 设置 | 环境变量和 WebDAV 恢复可能改变下一次启动值 |
| 备份管理 | 本地备份、WebDAV、OpenList、数据恢复及内容校验 | 连接与范围在“云端备份”；恢复前预览，完成后按提示重启 |
| 文件管理 | 查看与编辑服务器文件、上传、压缩和解压 | 这是管理员文件操作，不按普通用户曲库权限授权 |
| 日志与维护 | 查看错误、重新加载配置、重启服务 | 端口或路径变化后需要使用新地址连接 |

## 首次同步与恢复

先在后台创建用户，再连接客户端。检查首次同步的合并/覆盖方向，已有歌单先备份。恢复快照时选择正确用户与时间，恢复后让客户端重新连接并检查列表；恢复歌单不会找回已经删除的音频。

### 切换命名格式后同步存量文件名

在「设置 → 歌曲命名方式」切换格式后，**只有新产生的文件会用新格式**，已有文件不会自动改名。后台「云端备份 → OpenList」提供两个手动入口，把存量文件一次性对齐到当前生效的命名格式：

- **预览待改名清单（只读）**：`POST /api/openlist/cache/rename`，`mode: "preview"`（默认）。不改动任何内容，可反复调用。返回 `scanned` / `ready` / `unchanged` / `conflicts` / `missing` 统计，各用户实际生效的命名模式，以及逐条的旧名 → 新名。
- **执行重命名**：`POST /api/openlist/cache/rename`，`mode: "apply"`。可选 `user` / `folder` / `limit`，`cloud: false` 可只改本地与备份库。

执行时对每个文件同步四处，保证不产生重复上传或孤儿文件：

| 位置 | 改动内容 |
| --- | --- |
| 本地磁盘 | 音频文件、同名的 `.lrc` 歌词、外部封面缓存（按新文件名重写哈希） |
| 本地缓存索引 | `cache_index.json` / `music_index.json` 的 `filename`、`lyricFilename` |
| OpenList 备份库 | `openlist_backup_files` 的 `local_path` / `remote_path` / `name` / `cache_metadata`，`openlist_local_files` 的路径与文件名，附件的本地与远端路径 |
| 云端 | 调用 OpenList 原生重命名接口改文件名（含同 stem 附件），**只改元数据，不重新上传音频字节** |

命名格式完全取自现有配置（用户级 `settings.json` 的 `serverCacheNamingPattern` 优先，其次全局 `cache.namingPattern`），复用 `getFileName` 的全部 5 种格式与冲突后缀规则，**不写死格式、不修改配置、不自动迁移**。目标名冲突一律跳过而不覆盖；执行逐项幂等，中途失败后重跑会自动收敛未完成的部分。云端同步未启用时，仍会改本地与备份库（含 `remote_path`），下次启用同步时会按新名上传，不会残留旧路径记录。

执行期间的并发保护：改名会依次改云端 → 本地 → 备份库，中间存在「本地已是新名、备份库仍是旧名」的秒级窗口。若此时正好跑同步，新文件名会被当成新文件插入重复记录并再传一份。因此改名与同步、后台校验、上传队列**互斥串行**：有同步/校验/上传在跑时执行入口直接拒绝，改名期间也不会启动新的同步或校验。预览是只读的，不受影响。

**范围只限音频及其同 stem 附件**。歌单、不喜欢、评分快照（`snapshot_*.json`、`snapshotInfo.json`）与用户设置等数据文件不改名——它们的文件名是结构化的（由用户与数据类型决定），不随歌曲命名格式变化，正文里存的是歌曲 ID 而非音频文件名。唯一会被连带更新的是 `music_index.json` / `cache_index.json`：改名时已改写其中的 `filename` / `lyricFilename` 并落盘，下一次同步按内容哈希发现变化后自动重传这一份数据文件；若该类型未纳入 `backup.openlist.types`，则云端本来就没有它。

恢复清单 `_system/recovery/latest.json` 是**整体快照，不是逐条记录备份**：全量同步结束时先在本地算内容指纹，与云端上一份相同则零写入、零对象探测、零历史遍历；只有内容变化时才补齐新增的按 hash 内容寻址对象，并写 `history/` 与 `latest.json` 两个小文件。音频是不可变独立文件，一次上传永久有效；歌单、配置与数据库属于累加/可变数据，其历史版本按内容去重保存，并按「云端历史版本保留天数」清理。

用户数据同步与自动下载分别配置。用户级自动下载开关、歌单选择和音质设置决定实际下载范围；仅打开 LX 同步不会下载整个歌单的音频。

### 同步开销与调优

同步开销主要来自「每轮对每个已登记记录做一次远端探测 + 本地全文件 SHA-256」，而不是上传字节。默认已按以下方式收敛：

| 机制 | 默认行为 |
| --- | --- |
| 定时全量同步 | `openlist.syncInterval = 60` 分钟 |
| 后台状态检查 | `openlist.verifyInterval = 5` 分钟 |
| 事件驱动同步 | 配置保存、音频/快照落盘等事件只置脏标记并合并，两次事件同步之间至少 5 分钟；手动按钮与定时同步不受节流 |
| 已验证记录 | 常态轮询不再逐行 `getFileInfo`；仅在基线变化、状态异常、`upload-delete` 待清理或每小时兜底核对时查询 |
| 本地内容指纹 | 一轮同步内同一文件只算一次 SHA-256，跨轮一律重算，因此「同大小 + 恢复 mtime 的内容改写」仍能被检测 |

`openlist-backup.db`（及其 WAL/SHM）属于运行态索引，**从不上传到 OpenList**；数据库丢失时依靠云端恢复清单与内容寻址对象重建。

需要进一步降开销时，优先调整配置而不是改代码：调大 `openlist.verifyInterval` 与 `openlist.syncInterval`；收窄 `backup.openlist.types` 只保留必要的 `snapshots` / `system`；调小 `configBackup.retentionDays` 以缩小配置历史目录的列举规模。代价是云端可见性延迟变长。不建议改成「每加一条记录即时上传」，也没有必要降低恢复清单的发布频率——它内容未变时是零写入、零对象探测。

## 文件管理器

当前后台使用 VueFinder，支持程序运行目录和数据目录两种虚拟根：`root://`、`data://`。常用操作包括上传、重命名、复制/移动、删除、文本编辑、ZIP 压缩/解压。文件 API 使用管理员鉴权，媒体预览可使用专门的短期媒体会话。

单文件上传上限为 1 GiB，文本编辑上限为 8 MiB；反向代理可能有更小的限制。不能修改存储根本身，路径校验不允许越界或遍历符号链接。删除与保存会作用于真实文件，先核对路径和备份。

## API Token

个人设置中的持久化 Token 可命名、设置有效期、禁用和删除，用于脚本调用个人数据接口。管理员接口仍使用管理员鉴权；Subsonic 客户端使用该协议的用户名/密码认证，不能把这几种凭据混用。

更多请求示例与响应格式见 [API 参考](../api/reference.md)。备份与迁移步骤见 [运行维护](./operations.md)。
