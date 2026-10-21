# OpenList 备份 — TODO / 后续规划

> 当前状态：以下条目**尚未实现**，仅记录设计意图与待办，供后续迭代。

## 1. 跨设备数据库同步（导入/导出）【待实现】

### 背景
`openlist-backup.db`（SQLite，路径 `data/openlist-backup.db`）现已承载备份文件的完整元数据，
含 `user / folder_type / local_path / remote_path / size / name / source / songmid / quality /
singer / album / img / mode / status / remote_mtime / deleted_at` 等字段。

其中 `source / songmid / quality / singer / album / img` 是为「上传 → 下载还原」预留的媒体元数据，
使一份备份数据在另一台设备下载后能恢复完整的媒体信息（歌手/专辑/封面等）。

### 目标
让同一 OpenList 账号下的多台 lx-server 设备，能通过**数据库导入/导出**互通备份清单与策略，
而不必每台设备都重新扫描本地、重新上传。

### 方案草案（未实现）
- **导出**：将 `openlist_backup_files`（含 `openlist_backup_attachments`、`openlist_local_files`）
  按 `(user, folder_type, local_path)` 维度序列化为 JSON / SQL dump（建议带 `mode` 策略与
  `deleted_at` 软删标记，便于增量合并）。
- **导入**：目标设备读取导出文件，按唯一约束 `UPSERT` 合并；冲突策略建议：
  - 以「远端是否存在该 `remote_path`」为权威，存在则采用导出方记录（含 `mode` 策略与媒体元数据）；
  - `mode`（备份策略）**必须随导入覆盖**（与同步时的 upsert 行为不同——此处是显式迁移，应整体迁移策略）。
- **触发方式**：管理界面按钮 / CLI 子命令（导出落盘为文件，导入读取文件后合并）。
- **注意**：本地实际音频文件仍需由各设备按需从 OpenList 下载还原；本同步只迁移「元数据与策略」，
  不搬运二进制。

### 优先级
中。需先做：导出/导入的序列化 schema 与冲突合并测试。

---

## 2. 已落地的相关修复（备查）
- 上传路径（`onFileCached`）已把 `source/songmid/quality/name/singer/album/img` 写入备份行。
- 下载/同步路径（`downloadOne` / `downloadDirection`）经 `buildDownloadMeta` 优先复用备份行元数据，
  否则退化按文件名解析（`parseFilenameMeta`），使还原的缓存条目带媒体信息。
- `upsertBackupFile` 冲突更新保留 `mode`（备份策略）不被静默覆盖（仅插入时写入）。
