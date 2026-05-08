# LXServer Synology SPK 打包说明

本目录用于构建 DSM 7 可用的 SPK 套件，依赖群晖官方 `Node.js_v20` 运行 `lxserver`。
可在本仓库内直接打包（默认使用当前工作区源码），也支持按配置拉取指定 `lxserver` 仓库与分支进行打包。

## 可配置项

- `LXSERVER_LOCAL_DIR`：直接使用本地源码目录（优先级最高）。在 GitHub Actions 中默认会设置为当前仓库工作区。
- `LXSERVER_REPO`：源码仓库地址（默认 `https://github.com/XCQ0607/lxserver.git`）
- `LXSERVER_REF`：源码分支/标签/提交（默认 `main`）
- `SPK_VERSION_OVERRIDE`：覆盖 SPK `INFO` 版本号（可选）
- `TARGET_ARCH_TAG`：产物文件名中的架构后缀（默认 `uname -m`）

## 目录结构

- `spk/INFO`：SPK 包元信息模板
- `spk/scripts/start-stop-status`：服务启动/停止/状态脚本
- `spk/conf/privilege`：DSM 7 运行用户权限声明
- `spk/conf/resource`：资源声明
- `spk/PACKAGE_ICON.PNG`：套件图标（64x64）
- `spk/PACKAGE_ICON_256.PNG`：套件图标（256x256）
- `build-spk.sh`：一键构建 `.spk`（Linux / macOS / WSL）

## GitHub Actions 自动构建

工作流文件：`.github/workflows/synology-spk.yml`

默认矩阵产物：

- `x86_64`（`linux/amd64`）
- `aarch64`（`linux/arm64`）

手动触发（`workflow_dispatch`）可配置：

- `lxserver_repo`：源码仓库地址
- `lxserver_ref`：源码分支/标签/提交
- `spk_version_override`：可选版本覆盖
- `publish_release`：是否发布 GitHub Release（默认 `true`）
- `release_tag`：发布标签（可选，不填则自动生成）

构建完成后会生成 Release（并附带 `.spk` 文件），同时保留 Actions Artifacts。

## 本地调试（可选）

如果需要本地排查构建问题，可手动执行：

```bash
chmod +x packaging/synology-spk/build-spk.sh
./packaging/synology-spk/build-spk.sh
```

## 安装说明

1. 先在群晖套件中心安装 `Node.js v20`。
2. 在套件中心使用“手动安装”选择生成的 `.spk`。
3. 安装后启动套件，默认监听 `9527` 端口。

## 数据目录

通过 `conf/resource` 的 `data-share` 机制，DSM 会创建共享目录 `lxserver`。  
DSM 7 下该共享目录会映射为：`/var/packages/lxserver/shares/lxserver`

程序运行时数据放在：

- `/var/packages/lxserver/shares/lxserver/data`
- `/var/packages/lxserver/shares/lxserver/logs`
- `/var/packages/lxserver/shares/lxserver/cache`
- `/var/packages/lxserver/shares/lxserver/music`

**端口与管理密码**（升级后会保留）：为避免 DSM 升级替换 `target/var`，向导写入的端口与 `FRONTEND_PASSWORD` 对应文件存放在共享目录下：

- `/var/packages/lxserver/shares/lxserver/synology-pkg-var/port`
- `/var/packages/lxserver/shares/lxserver/synology-pkg-var/bind_ip`
- `/var/packages/lxserver/shares/lxserver/synology-pkg-var/admin_password`

首次启动时若发现旧版仍在 `target/var` 下的上述文件，会自动复制到上述目录。

## 端口配置

- 默认端口为 `9527`，持久化路径见上文 `synology-pkg-var/port`
- 默认监听地址为 `::`（优先兼容 IPv6），持久化路径见上文 `synology-pkg-var/bind_ip`
- 安装向导会提示填写“服务端口”和“管理密码”；若留空，则使用默认值（端口 `9527`，管理密码 `123456`）。**仅首次安装**会根据向导写入；套件升级不会用向导再次覆盖已有端口与密码。
- 已提供简体中文安装向导文件：`WIZARD_UIFILES/install_uifile_chs`
- 修改端口后重启套件生效：

```bash
echo 9527 > /var/packages/lxserver/shares/lxserver/synology-pkg-var/port
synopkg restart lxserver
```

- 如需只监听 IPv4，可改为：

```bash
echo 0.0.0.0 > /var/packages/lxserver/shares/lxserver/synology-pkg-var/bind_ip
synopkg restart lxserver
```

## 管理密码

- 安装向导填写的管理密码会写入共享目录下的 `synology-pkg-var/admin_password`（见「数据目录」一节）
- 运行时会自动作为 `FRONTEND_PASSWORD` 注入服务进程
- 若未填写该项，则沿用项目默认密码 `123456`

## 默认源控制

- 套件管理页面可配置：
  - 启用/关闭默认自定义源
  - 启用/关闭默认源自动更新（默认开启）
  - 手动“立即检查并更新默认源”（触发后会重启服务）

## 注意事项

- 该方案是“最小可运行版”SPK，适合自用与二次开发。
- 如需在套件中心展示图标、配置向导、端口设置页面，可继续补充 `PACKAGE_ICON`、`WIZARD_UIFILES`、`ui/` 目录等 DSM 字段。
