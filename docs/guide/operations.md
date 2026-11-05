# 运行维护与问题排查

本页适用于已经能启动的服务。首次安装和各启动方式见 [部署指南](./getting-started.md)，目录、权限与配置说明见 [配置指南](./configuration.md)。

## 确认正在运行的实例

排查前先记录页面上的版本和构建指纹，并确认浏览器连接的 IP、端口、路径。源码改动不会自动更新已构建的生产服务；桌面版还可能在端口占用时选择新的端口。

Docker 查看实际容器与日志：

```bash
docker compose ps
docker compose logs --tail=100
```

PM2 查看实例与日志：

```bash
pm2 status
pm2 logs lx-music-sync-server --lines 100
```

不要同时用终端、PM2、桌面版启动多个指向同一数据目录的实例。日志目录以 `LOG_PATH` 为准；镜像默认 `/server/data/logs`，源码运行默认项目 `logs/`。

## 升级与回退

1. 保存数据目录、外部 `CONFIG_PATH`、实际使用的 `cache/music` 和自定义目录。记下当前版本、镜像标签或 Git 提交。
2. 停止旧进程或由原托管方式执行替换；保持卷挂载和目录权限。
3. Docker 更新镜像后重建容器；源码更新后执行 `npm ci`、`npm run build` 再重启。
4. 检查启动日志、账号登录、歌单、一次本地扫描及实际播放。

PM2 源码部署的更新命令（在完成代码更新后）：

```bash
npm ci
npm run build
pm2 restart ecosystem.config.js --env production --update-env
```

回退应用版本不等于回退数据。若新版本已写入配置或用户状态，应依据备份和版本兼容性决定是否恢复数据；不要在未检查的情况下将旧进程指向已变更的数据副本。

## 备份覆盖范围

| 方式 | 适合恢复 | 不能据此假定已保存的内容 |
| --- | --- | --- |
| 歌单快照 | 误删、覆盖后的歌单状态 | 音频文件、整个配置与外部目录 |
| 配置备份 | `config.js` | 所有账号文件、音乐文件 |
| WebDAV 同步/备份 | 纳入同步范围的数据 | 被排除的目录、外部音乐、程序根目录音频 |
| 文件系统备份 | 被复制的实际目录 | 未包含的挂载和外部路径 |

迁移本地库时同时保留账号状态和音频。Subsonic 的本地 ID 登记文件与本地歌单状态应一起保留；外部移动或重命名歌曲文件可能产生新身份。

WebDAV 的增量检测间隔默认 60 分钟，全量备份间隔默认 24 小时，分别由 `SYNC_INTERVAL`、`BACKUP_INTERVAL` 控制。已配置 WebDAV 的启动过程会尝试恢复远端数据，随后重新加载配置和账号；它并不限于第一次启动空目录。

## 反向代理

代理需保留路径，支持 WebSocket，并允许 SSE 和音频流持续返回。下面是同机 Nginx 的 HTTP 转发示例；域名与 HTTPS 证书需按部署环境设置，不要将此 HTTP 示例当作已经启用 TLS。

```nginx
# 放在 http {} 内，与 server {} 同级
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name music.example.com;

    location / {
        proxy_pass http://127.0.0.1:9527;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }
}
```

代理在容器内时，`127.0.0.1` 指代理容器本身，需要改为能到达服务的容器服务名或主机地址。后台文件上传还受代理请求体大小限制，不能只看应用限制。`PROXY_HEADER` 应与可信代理发送的原始 IP 头对应。

路径变更后检查播放器、后台、LX 同步和 `/rest`。外层 HTTPS 配合 HTTP 音频链接时，检查播放器自动代理设置；服务器出站代理与播放器媒体代理不是同一个开关。

## 常见症状

| 症状 | 排查顺序 |
| --- | --- |
| 页面正常，播放失败 | 自定义源启用状态 → 平台/音质支持 → 解析日志 → 音频链接有效期与网络 |
| 本地目录为空 | 账号 → 保存的存储位置 → 容器挂载路径 → 读取权限 → 扫描日志 |
| 写标签失败 | 文件是否可写 → 用户写入权限 → 容器是否只读挂载 → 音频格式是否支持 |
| 设置重启后还原 | 实际配置路径 → 环境变量 → WebDAV 恢复日志 |
| 界面没更新 | 实际进程/容器 → 构建是否完成 → 构建指纹 → 浏览器刷新 |
| 下载没有继续 | 队列状态与错误 → 可用源 → 磁盘/权限 → 恢复任务；关闭网页不等于取消 |
| 自动匹配显示中断 | 服务重启后任务会标记中断，重新选择剩余歌曲 |
| 洗版跳过 | 无关联信息、已是目标音质、目标文件已存在或未获得符合条件的替换 |
| Subsonic 看不到网页中的文件 | 两端账号 → 持久存储设置 → 自定义目录/本地歌单开关 → 客户端刷新 |
| Cast 发现设备但不能播放 | 安全上下文 → 接收端网络访问 → 编码支持 → 媒体请求日志 |

## 提交问题时提供的信息

提供版本和构建指纹、部署方式、系统与架构、客户端版本、复现步骤以及相关错误日志。说明问题发生在搜索、解析、下载、扫描还是播放阶段。日志中的密码、Token、Cookie 和带授权参数的音频链接应先隐藏。
