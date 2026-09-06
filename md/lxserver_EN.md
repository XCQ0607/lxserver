# LX Music Sync Server (Enhanced Edition)

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

[Documentation](https://xcq0607.github.io/lxserver/) | [WebPlayer](../README_EN.md) | [Changelog](changelog.md)

This project provides both a powerful [WebPlayer](../README_EN.md) and a professional **LX Music Data Sync Service** with a Web visualization dashboard.

## ✨ Sync Server Key Features

### 📊 Dashboard
Intuitive Web interface to monitor service status and connections in real-time.
![Dashboard](仪表盘.png)

### 👥 User Management
Easily add/delete users and modify sync keys via the UI to manage multi-device access permissions.
![User Management](用户管理.png)

### 🎵 Deep Data Management
- View playlists and song lists online for all users.
- Support for searching and sorting to quickly locate songs.
- Support for batch clearing redundant data or deleting playlists.
  ![Data View](数据查看.png)

### 💾 Snapshot Management
- **Auto Backup**: Server automatically generates historical data snapshots.
- **Local Download**: Snapshots can be downloaded as `lx_backup.json` for direct import into LX Music clients.
- **One-click Rollback**: Roll back data to a specific snapshot point to prevent data loss.
  ![Snapshot Management](快照管理.png)

### 📂 File & System Logs
Built-in lightweight file management system for viewing, downloading, and searching system logs online.
![System Logs](系统日志.png)

### ☁️ WebDAV Real-time Cloud Sync
- Supports Nutstore, Nextcloud, Alist, and other standard WebDAV drives.
- Supports scheduled full data backup to the cloud.
- Supports one-click restoration from cloud after server reset.
  ![WEBDAV Sync](WEBDAV同步.png)

---

## 📖 Dashboard Guide

1. **Access Dashboard**: Visit `http://your-ip:9527`.
2. **Initial Setup**: Change your default password in "System Config" immediately after first login.
3. **Add User**: Create sync accounts in the "User Management" page. The generated password is the key for LX Music client connection. (Default: username `admin`, password `password`).
4. **Backup Strategy**: It's highly recommended to configure cloud backup in "WebDAV Sync" for data safety.

> 💡 For more technical details (Docker deployment, Nginx config, variables, etc.), please return to the **[Project Homepage (README_EN.md)](../README_EN.md)**.
