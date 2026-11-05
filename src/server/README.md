# 服务端目录

按职责归类，入口保留在 `index.ts` 和 `server.ts`。

| 目录 | 职责 |
| --- | --- |
| auth/ | 身份验证、安全校验、收藏权限 |
| http/ | HTTP 文件响应 |
| integrations/ | Subsonic、投屏、elFinder 协议集成 |
| media/ | 封面代理与缩略图 |
| music/ | 本地音乐、缓存、目录、音质与电台 |
| sources/ | 自定义音源管理与调用 |
| sync/ | WebSocket 同步协议 |
| task/ | 定时任务、下载、重制、自动匹配队列 |
| utils/ | 服务端共享工具 |

新增模块放入对应职责目录；跨模块引用可使用 `@/server/...`。
本次仅调整文件组织和引用，大型路由文件的内部拆分留作后续独立重构。
