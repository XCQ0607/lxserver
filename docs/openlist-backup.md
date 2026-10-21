# OpenList 音频备份

将 lx-server 用户的**音频缓存 / 下载文件**自动备份到 OpenList（alist 兼容）网盘，并用 SQLite 跟踪每一份备份的**上传状态**，支持按用户、按目录（下载 / 缓存）精细化配置，以及可选的「非音频文件（图片等）一并备份」。

> 设计原则：仅备份**音频文件**；上传成功后以 `getInfo` 轮询确认落盘（规避部分 OpenList 构建「写入成功却返回 500」的已知问题）；数据库只保存 OpenList **纯路径（不含域名 / URL 前缀）**，便于后续定位与下载。

---

## 1. 功能概述

- **菜单入口**：管理后台左侧「OpenList 配置」（位于「WebDAV同步」下方）。
- **配置项**：OpenList 服务器地址、账号 / 密码 / 预置令牌、根目录、验证轮询间隔、上传后是否保留本地文件、是否备份非音频文件、以及**每个用户各自的下载 / 缓存目录**。
- **触发时机**：音频文件在 `fileCache` 落盘并完成索引登记后，自动触发备份钩子（覆盖：播放缓存、用户手动下载到音乐库、同步下载任务三种场景）。
- **状态跟踪**：`待上传(pending) → 上传中(uploading) → 上传完成(completed) → 已验证(verified)`，失败记 `failed`。

---

## 2. 架构与数据流

```
音频落盘 (fileCache.ts)
   │  onFileCached(user, folderType, localPath, meta)
   ▼
OpenListBackupManager
   │  1. 检查 openlist.enable 与用户是否开启备份
   │  2. 按 folderType 取该用户的 下载/缓存 目录（经 fileCache.getCacheDir 解析为应用实际的缓存/下载目录）
   │  3. 若 includeNonAudio：扫描该目录下的图片等非音频文件并一并入队
   │  4. 计算远端路径 root/user/folderType/<相对路径>
   ▼
openlist_backup_files (SQLite)            OpenListClient
   │  INSERT status='pending'             │  PUT /api/fs/put (file-path 头 + 字节体)
   ▼                                       ▼
status -> uploading -> completed           getInfo 轮询确认存在且 size 匹配
   │  verifyPending (定时轮询)
   ▼
status -> verified（并记录纯路径）
   │  keepLocalAfterUpload=false 时删除本地副本
```

模块位置：

| 文件 | 职责 |
|---|---|
| `src/types/config.d.ts` | `openlist.*` 配置键类型 |
| `src/defaultConfig.ts` | `openlist.*` 默认值 |
| `src/server/openlistClient.ts` | OpenList HTTP 客户端（登录 / 上传 / 校验 / 删除） |
| `src/server/openlistBackupDb.ts` | SQLite 元数据库（`openlist_backup_files` 表） |
| `src/server/openlistBackup.ts` | 备份管理器（钩子 / 上传 / 状态机 / 验证轮询 / 删本地） |
| `src/server/fileCache.ts` | 落盘钩子接入点 |
| `src/server/server.ts` | 启动时启动验证轮询调度器 |
| `public/index.html` + `public/app.js` | 配置页 UI 与读写 |

---

## 3. 配置项说明

配置键（扁平点分，随 `/api/config` 持久化）：

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `openlist.enable` | boolean | `false` | 总开关 |
| `openlist.endpoint` | string | `''` | OpenList 地址，如 `http://127.0.0.1:5244` |
| `openlist.username` | string | `''` | 账号（与令牌二选一，令牌优先） |
| `openlist.password` | string | `''` | 密码 |
| `openlist.token` | string | `''` | 预置令牌（优先于账号密码） |
| `openlist.root` | string | **`/lx_music`** | OpenList 内备份根目录（**不含域名**）；可为实例挂载名或自建目录，例如天翼云盘为 `/tyCloud`，则填 `/tyCloud/lx_music` |
| `openlist.keepLocalAfterUpload` | boolean | `true` | 上传完成后是否保留本地文件（`false` 时于 `verified` 后删除本地副本） |
| `openlist.verifyInterval` | number(分钟) | `5` | 验证轮询间隔：轮询 OpenList 确认文件已落库后标记为 `verified` |
| `openlist.includeNonAudio` | boolean | `false` | 是否一并备份下载 / 缓存目录中的图片等非音频文件 |
| `openlist.userBackups` | string(JSON) | `'[]'` | 每用户配置：`[{ user, enabled, backupDownload, backupCache, mode? }]`（目录路径自动拼接，无需填写） |

> `openlist.root` 默认 `/lx_music`：请确保其对应的 OpenList 路径真实存在（实例挂载或自建目录）。例如天翼云盘挂载名为 `tyCloud`，应使用 `/tyCloud/lx_music` 作为根目录。

### 用户级目录配置（前端多选 + 每用户目录）

- 「备份用户」使用现有多选标签样式，数据源为 `GET /api/users`。
- 选中某用户后，可单独开关其**下载目录**与**缓存目录**的备份（默认均开启）；备份路径由后端经 `fileCache.getCacheDir` **解析为应用实际的缓存/下载目录**（通常 `/server/cache/<用户>` 或 `/server/music/<用户>`），与本地结构一致，用户无需手动填写路径。
- 兼容旧数据：旧版手动填写的 `downloadDir` / `cacheDir` 若存在仍会沿用；新版保存的数据字段为 `backupDownload` / `backupCache`（布尔开关）。
- 只有「启用」且目录与落盘文件路径匹配的用户才会被备份。

---

## 4. 上传状态机

```
pending     落盘后入库，等待上传
  │ uploadOne()
uploading   正在上传
  │ OpenListClient.upload() 内部以 getInfo 轮询确认落盘
completed    OpenList API 返回成功（文件已落盘，但网盘后台可能仍在处理）
  │ verifyPending() 定时轮询 OpenList 父目录/list 确认存在且 size 匹配
verified     确认已落库（对应需求「实际请求 openlist 确定网盘已经落库」）
  │ keepLocalAfterUpload=false 时删除本地副本
failed       上传/校验异常（记录 error，可重试）
```

- **completed vs verified**：`completed` 表示 OpenList 接口返回成功；`verified` 表示由验证轮询器**再次实际请求 OpenList** 确认文件可读、size 匹配后才置位——满足「API 返回成功但后台仍在上传」的时序差异。
- 验证轮询器在**服务启动时**即启动（`startVerifyScheduler`），即使暂无新文件落盘，已 `completed` 的记录也会持续被推进到 `verified`。

---

## 5. OpenList 接口契约（已对真实实例实测）

| 操作 | 方法 / 路径 | 说明 |
|---|---|---|
| 登录 | `POST /api/auth/login` | body `{username,password}` → `data.token` |
| 上传 | `PUT /api/fs/put` | 头 `file-path: <远端路径>` + `Content-Type: application/octet-stream` + 原始字节体；部分构建写完文件仍返 500，**成功以 `getInfo` 轮询为准** |
| 校验/直链 | `POST /api/fs/get` | body `{path}` → `{ raw_url, size, name }` |
| 列目录 | `POST /api/fs/list` | 用于验证轮询确认父目录内容 |
| 建目录 | `POST /api/fs/mkdir` | 上传前确保父目录存在 |
| 删除 | `POST /api/fs/remove` | 清理测试 / 删本地前先删远端（按需） |

> 实测实例（天翼云盘 `tyCloud` 挂载）确认：路径必须落在挂载目录下；`multipart POST` 不支持，必须使用 `PUT + file-path` 头。

---

## 6. 路径存储（纯路径，无域名）

每条备份记录（无论 `completed` 还是 `verified`）在 `openlist_backup_files.remote_path` 中保存的是 **OpenList 内纯路径**，例如：

```
/lx_music/testuser/cache/song.mp3
/lx_music/testuser/cache/cover.jpg
```

**不保存任何域名 / URL 前缀**（`raw_url`、`openlistUrl` 等仅在请求时计算，绝不入库）。这样后续可基于 `root` + `remote_path` 重新拼接下载链接，且切换域名 / 反代不影响已存记录。

### 非音频文件（图片等）

- 开启 `openlist.includeNonAudio` 后，音频落盘时会**扫描该用户对应的下载 / 缓存目录**，将其中图片（扩展名 `jpg/jpeg/png/webp/gif/bmp/svg/heic/avif/jpe/tif/tiff` 等）一并加入备份队列，沿用同一 `folderType` 分组。
- 已处于 `uploading/completed/verified` 的文件会被去重跳过。
- 仅备份音频文件的需求下，保持 `includeNonAudio=false` 即可。

---

## 7. 管理与运维

### 查看备份状态

`listBackups()` 返回全部记录，前端可在「OpenList 配置」页扩展状态面板（示例字段：`user / folder_type / local_path / remote_path / status / size / updated_at`）。

### 失败重试

状态为 `failed` 的记录，修正配置（地址 / 账号 / 根目录 / 网络）后，可再次触发该用户的音频落盘（重新缓存 / 下载）即可重新入队；或实现「重试失败项」按钮调用 `uploadOne`。

### 本地删除策略

`openlist.keepLocalAfterUpload=false` 时，**仅在达到 `verified`（远端确认落库）后才删除本地副本**，避免「远端尚未落库却已删本地」导致数据丢失。

---

## 8. 常见问题 / 排错

| 现象 | 可能原因 | 处理 |
|---|---|---|
| 上传后状态长期停在 `completed` | 验证轮询未启动 / 间隔过长 / 远端路径不可达 | 确认 `openlist.enable` 与调度器已启动；调小 `verifyInterval` |
| `mkdir` 失败 `storage not found` | `openlist.root` 指向不存在的挂载 | 改为真实挂载路径（如 `/tyCloud/lx_music`） |
| 用户文件未被备份 | 该用户未「启用」或目录不匹配 | 检查 `openlist.userBackups` 中该用户的 `enabled` 与目录 |
| 图片未备份 | `includeNonAudio=false` | 开启该开关 |
| 本地文件被过早删除 | `keepLocalAfterUpload=false` 且远端尚未落库 | 已修正为 `verified` 后才删；如仍担心，保持 `keepLocalAfterUpload=true` |

---

## 9. 安全提示

- `openlist.password` / `openlist.token` 仅在「OpenList 配置」页提交，经 `/api/config` 持久化到服务端配置；**前端只回显输入框，不在 SQLite 备份表中存储任何凭据**。
- `openlist_backup_files` 仅记录本地路径、远端纯路径、状态与元数据，不含账号密码或网盘直链。
- 预置令牌优先级高于账号密码；若使用令牌，密码字段可留空。
