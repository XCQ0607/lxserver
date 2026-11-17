# 评分模块

Web 与 Subsonic 共用这组服务。运行数据仍保存于用户目录，源码归类不改变数据位置。

| 文件 | 职责 |
| --- | --- |
| ratingService.ts | 评分读写、歌曲身份解析、描述资料、失败任务重试 |
| ratingIdentityLock.ts | 按用户串行化本地关联与评分写入 |
| ratingMigration.ts | 本地转在线的身份合并、不喜欢原因迁移及事务日志恢复 |
| ratingPreferences.ts | 用户独立的不喜欢自动补分偏好 |
| ratingSnapshot.ts | 评分导入、导出、快照与恢复、元数据锁 |
| ratingValidation.ts | 存储结构与评分历史校验 |

锁顺序为身份锁 → 元数据锁；持有身份锁的调用方使用 writeRatingUnlocked，避免重复取得同一锁。
迁移提交同步完成，不跨 await。事务失败会回滚；未完成日志在评分访问或不喜欢管理器初始化时恢复。
不支持多个服务进程同时写入同一用户数据目录。
