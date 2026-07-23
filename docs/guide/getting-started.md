# 快速启动部署指南

欢迎使用 LX Music 数据同步与 Web 播放中枢服务。该平台提供私有化云端数据同步集成方案，并随附功能齐备的在线媒体高品质流播放能力。

## 基础设施依赖

在启动本服务项目前，请确保承载该实例的主机系统（或虚拟机、容器化设施）符合以下最低先决条件：

**直接基于源码运行：**

- **Node.js**: `v16.x` 或更高版本（生产环境推荐采用 `v18.x` 的长期支持 LTS 版本）。
- **网络资源**: 确保业务所需的监听端口（默认配置为 `9527`）已在主机防火墙策略及云服务商安全组规则中正确放行入口流量。

**基于容器化设施运行（生产首选）：**

- `Docker Engine` 引擎运行时。
- `Docker Compose`（当涉及声明式服务编排时必需）。

---

## 部署执行方案与最佳实践

### 方案一：使用桌面客户端

对于桌面用户，我们强烈推荐使用基于 Electron 的**桌面客户端**。它集成了服务器管理与播放器，且具备系统托盘常驻功能。

1. **前往下载**: [GitHub Releases](https://github.com/XCQ0607/lxserver/releases/latest)
2. **选择版本**:
   - **Windows**: 下载 `Universal.exe` (全架构合一) 或 `portable.exe` (绿色版)。
   - **macOS**: 下载 `universal.dmg` (支持 Intel/M1/M2)。
   - **Linux**: 提供 `.deb` (Debian/Ubuntu) 和 `.AppImage` 格式。
3. **初始化**: 首次运行将引导你选择数据存储位置，随后服务将自动在后台启动并在系统托盘可见。

### 方案二：基于 Docker 引擎的容器化部署

本项目支持从 Docker Hub 或 GitHub Packages 拉取镜像：

- **Docker Hub**: `xcq0607/lxserver:latest`
- **GitHub Packages**: `ghcr.io/xcq0607/lxserver:latest`

执行以下指令启动容器：

```bash
docker run -d \
  -p 9527:9527 \
  -v $(pwd)/data:/server/data \
  -v $(pwd)/logs:/server/logs \
  -v $(pwd)/cache:/server/cache \
  -v $(pwd)/music:/server/music \
  --name lx-sync-server \
  --restart unless-stopped \
  xcq0607/lxserver:latest
```

**容器挂载卷 (Volume Mappings) ：**

- `-v $(pwd)/data:/server/data`：该项配置为**核心必选项**。负责将实例内生成的所有应用层状态数据导出宿主机持久保存。
- `-v $(pwd)/logs:/server/logs`：用于承接并输出服务应用层所有分级审计日志的物理挂载点。
- `-v $(pwd)/cache:/server/cache`：用于存放音乐缓存文件，极大提升重复播放时的加载速度。
- `-v $(pwd)/music:/server/music`：用于存放仅下载歌曲文件。

**声明式 Docker Compose ：**
针对需标准化长久管理的生产实施，创建名为 `docker-compose.yml` 的定义配置：

```yaml
version: '3'
services:
  lx-sync-server:
    image: xcq0607/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./logs:/server/logs
      - ./cache:/server/cache
      - ./music:/server/music
    environment:
      - NODE_ENV=production
      # - FRONTEND_PASSWORD=123456
      # - ENABLE_WEBPLAYER_AUTH=true
      # - WEBPLAYER_PASSWORD=yourpassword
```

配置审查无误后，通过指令 `docker-compose up -d` 启动基础架构实例集。

### 方案二：基于物理环境的源码编译部署

针对受限非容器化环境或二次研发拓展场景，需于操作系统直接组装并拉起进程：

```bash
# 1. 由远端代码仓库提取代码的 Main 主线状态至当前目录
git clone https://github.com/XCQ0607/lxserver.git 
cd lxserver

# 2. 调用严格解析流程初始化模块依赖库
npm ci 

# 3. 对 TypeScript 类型及 Vue DOM 模板进行预编译聚合处理
npm run build

# 4. 执行基于内置调度器的生产节点启动命令
npm start
```

*工程实践提示：在无人值守的服务器环境中执行原生应用托管，建议引入譬如 `pm2` 的进程级调度与重启控制系统：`pm2 start npm --name "lxserver" -- start`。*

---

## 负载前置与 Nginx 反向代理接入策略

在暴露至公网的主流程节点前，强烈建议接驳成熟的 Web 守护网关实例。此举旨在安全地应用 SSL 加密以及隐藏内部分发端口特性。

以下为适配系统 WebSocket 双工链接机制及追踪用户源端 IP Header 解析的标准化 Nginx 反派配置参考示例（承接通配 `80 / 443` 端向本服务 `9527` 进行流量穿网与隧道接管转发）：

```nginx
server {
    listen 80;
    server_name music.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:9527;
  
        # 定义 Header 头传递策略以确保 Node 层可取到客户端外网层 IP
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  
        # 补全长连接升级特性定义（对内部的同步通信套接字服务必要条件）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 验证交付组件健康度

在服务实例注册调度完成、且流量隧道建立后，管理员可分别在浏览器检查两个子服务系统的连通状态：

| 模块系统标识                       | 挂载之应用节点层级 | 默认入域核查                                                     | 核心应用能力与操作基建                                                                 |
| ---------------------------------- | ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **基础运维监控与同步服务端** | `/admin`         | 要求输入缺省密钥:`123456`                                      | 执行账户角色控制授权、审查连接端点存活状态，并执行全局 WebDAV 的异地备份调度配置重置。 |
| **富客户端 Web 串流控制台**  | `/` (根路径)      | 可调整（依据管理员是否配置访问密码环境变量）                   | 提供多栈音乐信息流汇聚点检引擎并完成终端用户界面的视听业务渲染逻辑。                   |

有关在实例化生命周期早期实现底层变量的静默导入、以及配置层级重写的更多前序细节知识，请移步浏览查阅《[配置引擎及环境变量注入指南](./configuration.md)》。
