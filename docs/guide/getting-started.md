# 部署与首次使用

## 选择运行方式

| 方式 | 适用情况 | 需要准备 |
| --- | --- | --- |
| Docker / Docker Compose | NAS、服务器、长期运行 | Docker，保存配置和音乐的宿主机目录 |
| Node.js 源码运行 | 本地开发、自行修改或编译 | Node.js 22 或更高版本、npm、Git |
| Release 服务端压缩包 | 使用已编译的服务端 | Node.js，包含编译产物的发行包 |
| 桌面客户端 | 在桌面窗口中管理与使用服务 | 与操作系统、CPU 架构匹配的安装包 |
| PM2 托管 | 已编译的 Node.js 服务长期运行 | 单独安装 PM2，先完成构建 |

默认主端口是 `9527`。启动后，播放器位于 `/`，管理后台位于 `/admin`，Subsonic 路径为 `/rest`。

## Docker Compose

在准备保存数据的目录中创建 `compose.yaml`：

```yaml
services:
  lx-sync-server:
    image: xcq0607/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data
      - ./cache:/server/cache
      - ./music:/server/music
      # 使用已有音乐目录时再添加挂载，例如：
      # - /mnt/nas/music:/library:ro
    environment:
      NODE_ENV: production
      ADMIN_PASSWORD: "replace-with-your-admin-password"
      ENABLE_WEBPLAYER_AUTH: "true"
      WEBPLAYER_PASSWORD: "replace-with-your-player-password"
      # 创建同步用户，也可以启动后在后台添加：
      # LX_USER_user1: "replace-with-your-user-password"
```

执行：

```bash
docker compose up -d
docker compose logs -f --tail=100
```

也可以将镜像名换成 `ghcr.io/xcq0607/lxserver:latest`。固定版本部署时，把 `latest` 换成镜像仓库实际存在的版本标签。

镜像默认将日志写入 `/server/data/logs`，上述 `data` 挂载已包含日志。如需单独保存，增加 `./logs:/server/logs` 挂载，并同时设置 `LOG_PATH: /server/logs`。只挂载 `/server/logs` 不会改变默认日志位置。

`cache` 和 `music` 挂载用于程序根目录存储模式；选择数据目录存储后，相应文件位于 `/server/data` 下。保留这三个挂载，可以在切换存储模式和更新容器时继续使用原文件。

## Docker Run

以下为 Bash 示例，路径相对于当前目录：

```bash
docker run -d \
  --name lx-sync-server \
  --restart unless-stopped \
  -p 9527:9527 \
  -v "$(pwd)/data:/server/data" \
  -v "$(pwd)/cache:/server/cache" \
  -v "$(pwd)/music:/server/music" \
  -e ADMIN_PASSWORD="replace-with-your-admin-password" \
  -e ENABLE_WEBPLAYER_AUTH=true \
  -e WEBPLAYER_PASSWORD="replace-with-your-player-password" \
  xcq0607/lxserver:latest
```

Windows PowerShell 用户可以使用上面的 Compose 文件，避免多行命令和路径语法的差异。

## 从源码运行

```bash
git clone https://github.com/XCQ0607/lxserver.git
cd lxserver
npm ci
npm run build
npm start
```

构建会生成服务端 JavaScript、播放器样式和文件管理器前端资源，并检查音频指纹工具。安装和首次构建需要访问依赖仓库及相关二进制下载地址。

本地开发使用 `npm run dev`。修改 TypeScript 源码后，生产运行方式需要重新执行 `npm run build`；`npm start` 加载的是 `server/` 中的编译结果。

## Release 与桌面客户端

从 [GitHub Releases](https://github.com/XCQ0607/lxserver/releases) 下载对应文件。桌面版选择匹配系统与架构的安装包，具体提供哪些构建以该次发布的附件为准。

服务端压缩包需要包含 `server/`、`public/`、`index.js` 和 `package.json` 等运行文件。解压后安装生产依赖并启动：

```bash
npm install --omit=dev
node index.js
```

GitHub 自动生成的 Source code 压缩包是源码，不能当作已编译的服务端包使用；使用源码包时按前面的源码步骤构建。

`node index.js` 直接运行编译产物，不执行 npm 生命周期脚本；`npm start` 还会执行音频指纹工具检查和构建信息刷新。使用 npm 启动时需保留发行包中的 `scripts/`。桌面版使用独立的存储设置，端口被占用时会尝试其他端口，以应用实际显示的地址为准。

## PM2 托管与自行构建镜像

先完成依赖安装和构建，再在项目目录执行：

```bash
npm install -g pm2
npm run prd
pm2 status
pm2 logs lx-music-sync-server
pm2 save
```

`npm run prd` 调用 `pm2 start ecosystem.config.js --env production`，不会自动构建。PM2 不在项目依赖内，需要单独安装；`pm2 save` 保存进程列表，系统开机自启还需按部署系统配置。

如需使用自己修改的 Docker 镜像：

```bash
docker build -t lxserver:local .
```

把 Compose 中的镜像改为 `lxserver:local` 后启动。桌面包构建命令为 `npm run electron:dist`，原生模块与打包环境要求取决于目标系统；它属于开发构建流程，不是普通服务端的启动命令。

## 第一次启动后

1. 打开 `http://服务器IP:9527/admin`，使用设置的管理员密码登录。未配置时，默认密码是 `123456`。
2. 在“用户管理”中创建个人账号，设置用户名和同步密码。
3. 打开 `http://服务器IP:9527/`。若启用了播放器访问认证，先输入播放器访问密码，再按需登录个人账号。
4. 需要在线播放时，在自定义源管理中导入可用的音源脚本并启用。
5. 需要管理本地歌曲时，检查存储位置、目录挂载和账号权限，再扫描音乐目录。

管理员密码、播放器访问密码、个人账号密码用途不同，详见“账号与权限”。

## 启动命令的区别

| 命令 | 实际作用 |
| --- | --- |
| `npm start` | 运行 prestart 检查后加载已编译的服务 |
| `node index.js` | 直接加载已编译服务，不执行 npm prestart |
| `npm run dev` | 用 tsx/nodemon 运行源码，适合开发 |
| `npm run prd` | 交给 PM2，以 production 环境运行；需先构建 |
| `docker compose up -d` | 按 Compose 文件创建或启动容器 |
| `npm run electron:dist` | 构建并打包桌面应用，不是服务端托管命令 |

开发模式与生产模式使用同一份目录时仍可能读取同一套数据。试改功能时可通过环境变量另设 `DATA_PATH`，避免开发实例写入常用账号状态。

客户端地址与同步方式见 [同步及后台指南](./sync-server.md)，完整配置见 [配置指南](./configuration.md)，反向代理、升级、备份和排障见 [运行维护](./operations.md)。
