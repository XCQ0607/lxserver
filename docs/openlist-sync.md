# OpenList 备份 / 同步 功能文档

将 lx-server 的缓存/下载音频（以及图片、歌词等附件）备份到 OpenList / alist 挂载网盘，并支持四种同步模式与手动双向同步。

## 1. 核心概念

- **OpenList 账号**：一个网盘挂载实例（如天翼云盘 tyCloud）。通过 `endpoint` + 用户名/密码（或 `token`）登录，`root` 为实例内的挂载根目录（默认 `/lx_music`）。
- **纯路径存储**：备份记录只存 OpenList 内的**纯路径**（如 `/lx_music/user/cache/x.mp3`），不含域名/URL 前缀，便于后续定位与下载。
- **per-user 条目**：每个「用户 + 目录」配置一条 `userBackups` 记录，可独立设置同步目录与模式。

## 2. 四种同步模式

模式在 `userBackups[].mode` 上设置；若未显式设置，则沿用全局 `openlist.keepLocalAfterUpload` 的语义（false→`upload-delete`，true→`upload`）。

| 模式 | 含义 | 本地→远端 | 远端→本地 | 删除行为 |
|------|------|-----------|-----------|----------|
| `upload-delete` | 上传后删除 | ✅ 落盘即上传 | — | 验证(verified)后删本地副本 + 注销缓存索引 |
| `upload` | 仅上传 | ✅ | — | 保留本地 |
| `sync` | 双向同步 | ✅ | ✅ | 任一侧删除则另一侧级联；同名冲突较新者优先 |
| `download` | 仅下载 | — | ✅ | 远端有更新时覆盖本地 |

> `upload` / `upload-delete` / `sync` 模式下，文件**落盘时**由 fileCache 钩子自动触发上传（事件驱动）。
> `download` / `sync` 的「远端→本地」方向，以及全量扫描，通过**手动触发**（见 §6）执行。定时触发为预留能力，配置项 `openlist.syncInterval` 已存在但**暂未启用**。

## 3. 配置项

服务端配置（`config.js` / `/api/config`）：

| 键 | 说明 | 默认 |
|----|------|------|
| `openlist.enable` | 总开关 | false |
| `openlist.endpoint` | OpenList 地址，如 `http://host:5244` | 空 |
| `openlist.username` / `openlist.password` | 登录凭据（二选一与 token 配合） | 空 |
| `openlist.token` | 直接令牌（免登录） | 空 |
| `openlist.root` | 挂载根目录 | `/lx_music` |
| `openlist.keepLocalAfterUpload` | 全局默认「保留本地」；被 `mode` 覆盖 | true |
| `openlist.verifyInterval` | 验证轮询间隔（分钟） | 5 |
| `openlist.syncInterval` | 同步间隔（分钟），**预留，暂未启用** | 60 |
| `openlist.includeNonAudio` | 是否一并备份图片/歌词等附件 | false |
| `openlist.userBackups` | JSON 数组，每条：`{ user, enabled, backupDownload?, backupCache?, mode? }`（目录路径由后端经 `fileCache.getCacheDir` 解析为应用实际的缓存/下载目录，通常 `/server/cache/<用户>` 或 `/server/music/<用户>`，与本地结构一致，无需填写；旧字段 `downloadDir`/`cacheDir` 仅向后兼容） | `[]` |

`userBackups[].mode` 取值：`upload-delete` / `upload` / `sync` / `download`。

## 4. 保存时的强校验

为避免因配置错误导致静默失败，保存配置时执行**强校验**（失败则拒绝保存并返回 422）：

1. 若 `openlist.enable` 为真：使用新凭据调用 OpenList 登录并列出根目录，**实测可用性**；失败抛错（如「账号校验失败：…」）。
2. 校验每个已启用的 `userBackups` 条目：
   - 引用的 `user` 必须存在于 `config.users`；
   - `downloadDir` / `cacheDir` 为旧版兼容字段，若填写则要求指向的目录**存在且可读**，否则报「同步目录不存在或无权限」；新版开关模式由后端经 `fileCache.getCacheDir` 解析实际缓存/下载目录，无需校验。

> 另有独立的 `POST /api/openlist/test` 接口，可在保存前由前端单独「测试连接」。

## 5. 缓存索引联动

- **删除本地文件**：`upload-delete` 模式验证完成后，在删除本地副本的同时调用 `indexManager.remove` 注销缓存索引，避免应用误判本地文件仍然存在。
- **下载/同步补齐**：`download` / `sync` 把远端文件拉到本地后，调用 `indexManager.update` 登记为缓存条目，使应用能直接当作缓存文件使用。
  - 缓存 id 取「文件名(去扩展名)」最佳努力匹配；若远端文件名遵循命名约定即可被正确匹配。

## 6. 手动同步

通过 `POST /api/openlist/sync`（需前端 auth）触发，可带 `{ user?, folder? }` 过滤：

- `download` / `sync`：递归列出远端目录，下载本地缺失文件（同名且本地较新则跳过；`sync` 下远端较新则覆盖），并补齐缓存。
- `sync` 额外执行：上传本地新增文件、检测并级联删除（本地删→删远端+注销缓存；远端删→删本地+注销缓存）。
- `upload` / `upload-delete`：扫描本地音频并上传未完成项。

返回 `{ success, summary: { uploaded, downloaded, deleted, errors } }`。

## 7. 附件模型（图片 / 歌词）

图片、歌词等非音频文件作为**媒体文件的附件**处理，使用独立的 `openlist_backup_attachments` 表：

```
openlist_backup_attachments (
  id, backup_file_id, user, folder_type,
  local_path, remote_path, category, size, status, updated_at
)
```

- `category`：`image` / `lyric` / `other`（按扩展名判定）。
- `backup_file_id` 关联主音频记录（`openlist_backup_files.id`），表达「依附」关系。
- **上传**：上传音频时若 `includeNonAudio` 开启，会扫描同目录的图片/歌词，建立附件记录并一并上传到相同远端目录。
- **级联**：主音频在 `upload-delete` 验证后删除本地时，仅当该附件自身也已 `verified` 且不被其它备份引用，才删除其本地文件；主记录删除时一并清理附件行。

## 8. 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/openlist/backups` | 获取所有备份记录及附件（含状态） |
| POST | `/api/openlist/test` | 测试连接可用性 `{endpoint,username,password,token,root}` |
| POST | `/api/openlist/sync` | 手动触发同步 `{user?, folder?}` |

（以上接口均需 `x-frontend-auth` 头，与 `/api/config` 同源鉴权。）

## 9. 状态机

音频：`pending → uploading → completed → verified`，失败记 `failed`，删除记 `deleted`。
附件：`pending → uploading → completed → verified`，失败 `failed`，删除 `deleted`。

`verified` 表示已轮询 OpenList 确认文件可读（存在且 size 匹配），此时才执行删本地 / 补缓存等后续动作。

## 10. 已知限制

- 下载/同步回填缓存时以文件名为 id，未做音乐元数据反查；若需被播放器按歌曲精确匹配，远端文件名应遵循命名约定。
- 定时同步（基于 `openlist.syncInterval`）尚未启用，当前仅手动触发。
- 双向同步的冲突以「修改时间较新者优先」处理，未做内容哈希比对。

## 11. 删除本地清缓存的逐路径核对（核对记录）

「删除本地文件时必须同时注销缓存索引，避免应用误判本地文件仍存在」是所有模式都要满足的不变式。下面对 `effectiveModeFromRow` 涉及的「删除本地」路径逐条核对：

- **验证轮询路径（`verifyPending`，`openlistBackup.ts`）：** 用 `effectiveModeFromRow(row, cfg)` 做闸门。仅当 `mode === 'upload-delete'` 时，verified 后删除本地副本并调用 `removeLocalCache`（级联清理已 verified 且无其它引用的附件）。`upload` / `download` / `sync` 在此路径**不删本地**（受 `mode === 'upload-delete'` 守卫），符合语义：download 永不回删本地、sync 上传后保留本地副本，故这些模式在此**无需**清缓存。
- **双向删除检测（`deletionDetection`，仅 `sync` 模式调用）：** 是 sync 真正「删本地」的落点。两条分支均调用 `removeLocalCache`：
  - 本地已删 → 删远端 + 注销缓存 + 清附件；
  - 远端已删 → 删本地 + 注销缓存 + 清附件。
- **download 模式：** `deletionDetection` 根本不被调用，验证路径也不会删它，属于单向 remote→local，不存在「删本地」场景，故无需处理。

**结论：无需改动。** `effectiveModeFromRow` 仅作为「上传后删本地」这一支的闸门；download/sync 的删本地发生在 `deletionDetection`，两分支均已清缓存。缓存注销真实落到 `fileCache.indexManager.remove`（封装于 `unregisterOpenListCacheFile`），链路完整。
