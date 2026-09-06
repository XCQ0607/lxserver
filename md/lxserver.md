# LX Music Sync Server (Enhanced Edition)

<!-- ![lxserver](https://socialify.git.ci/XCQ0607/lxserver/image?description=1&forks=1&issues=1&logo=https://raw.githubusercontent.com/XCQ0607/lxserver/refs/heads/main/public/icon.svg&owner=1&pulls=1&stargazers=1&theme=Auto) -->
![lxserver](https://socialify.git.ci/XCQ0607/lxserver/image?description=1&forks=0&issues=0&logo=https://raw.githubusercontent.com/XCQ0607/lxserver/refs/heads/main/public/icon.svg&owner=1&pulls=0&stargazers=0&theme=Auto)

<div align="center">
  <p>
    <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status">
    <img src="https://img.shields.io/badge/version-v2.0.1-blue?style=flat-square" alt="Version">
    <img src="https://img.shields.io/badge/node-%3E%3D16-green?style=flat-square" alt="Node Version">
    <img src="https://img.shields.io/github/license/XCQ0607/lxserver?style=flat-square" alt="License">
    <br>
    <br>
    <a href="https://github.com/XCQ0607/lxserver/stargazers"><img src="https://img.shields.io/github/stars/XCQ0607/lxserver?style=flat-square&color=ffe16b" alt="GitHub stars"></a>
    <a href="https://github.com/XCQ0607/lxserver/network/members"><img src="https://img.shields.io/github/forks/XCQ0607/lxserver?style=flat-square" alt="GitHub forks"></a>
    <a href="https://github.com/XCQ0607/lxserver/issues"><img src="https://img.shields.io/github/issues/XCQ0607/lxserver?style=flat-square&color=red" alt="GitHub issues"></a>
    <a href="https://github.com/XCQ0607/lxserver/commits/main"><img src="https://img.shields.io/github/last-commit/XCQ0607/lxserver?style=flat-square&color=blueviolet" alt="Last Commit"></a>
    <img src="https://img.shields.io/github/commit-activity/m/XCQ0607/lxserver?style=flat-square&color=ff69b4" alt="Commit Activity">
    <a href="https://github.com/XCQ0607/lxserver/releases"><img src="https://img.shields.io/github/downloads/XCQ0607/lxserver/total?style=flat-square&color=blue" alt="Total Downloads"></a>
  </p>
</div>

[帮助文档 Documentation](https://xcq0607.github.io/lxserver/) | [网页播放器 WebPlayer](../README.md) | [更新日志 Changelog](changelog.md)

本项目不仅内置了功能强大的 [网页播放器](../README.md)，还提供了专业的 **LX Music 数据同步服务**，支持 Web 可视化管理。

## ✨ 同步服务器核心特性

### 📊 仪表盘

直观的 Web 界面，实时掌握服务状态与连接数。
![仪表盘](仪表盘.png)

### 👥 用户管理

支持通过界面快捷添加、删除用户，修改同步密钥，轻松管理多设备连接权限。
![用户管理](用户管理.png)

### 🎵 数据深度管理

- 在线查看所有用户的歌单和歌曲列表。
- 支持搜索与排序，方便快速定位歌曲。
- 支持批量清理冗余数据或删除歌单。
  ![数据查看](数据查看.png)

### 💾 快照管理 (Snapshot)

- **自动备份**：服务器自动生成历史数据快照。
- **本地下载**：快照可下载为 `lx_backup.json`，直接导入 LX Music 客户端。
- **一键回滚**：支持将数据回滚到指定的快照点，防止误删带来的损失。
  ![快照管理](快照管理.png)

### 📂 文件与系统日志

内置轻量级文件管理系统，支持在线查看、下载和检索系统运行日志，排查问题更直观。
![系统日志](系统日志.png)

### ☁️ WebDAV 云端实时同步

- 支持坚果云、Nextcloud、Alist 等标准 WebDAV 网盘。
- 支持定时自动将服务器全量数据备份至云端。
- 支持在服务器重置后从云端一键拉回所有数据。
  ![WEBDAV同步](WEBDAV同步.png)

---

## 📖 管理后台操作指南

1. **登录管理后台**：访问 `http://your-ip:9527`。
2. **初始化配置**：首次登录请立即进入“系统配置”修改默认密码。
3. **添加用户**：在“用户管理”页面创建同步账号，生成的密码即为 LX Music 移动端/桌面端连接时使用的密钥。默认用户名admin，密码password。
4. **备份策略**：建议在“WebDAV 同步”中配置云端备份，双重保障数据安全。

> 💡 更多技术细节（如 Docker 部署、Nginx 配置、变量列表等）请返回 **[项目首页 (README.md)](../README.md)** 查看。
