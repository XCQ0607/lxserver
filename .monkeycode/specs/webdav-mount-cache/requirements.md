# Requirements Document

## Introduction

在 LX Music Sync Server 中新增「WebDAV 音乐挂载」能力：后台可配置多个 WebDAV 源，将其作为与 OpenList 同级的音乐来源。歌曲采用「边播边缓存到本地」链路——第三方播放器请求播放时，服务端从 WebDAV 流式拉取并同步写入本地缓存目录，缓存完成后直接播放本地文件。任意目录（WebDAV/OpenList/本地缓存目录）可一键收藏为歌单，歌单内歌曲保留来源字段，无需关联在线音源即可直接播放。

## Glossary

- **WebDAV 挂载源**：后台配置的 WebDAV 服务器条目（name/baseUrl/username/password/rootPath/enabled），可配置多个
- **缓存目录**：服务端本地目录 `<dataPath>/webdav-cache/<serverId>/`，存放从 WebDAV 边播边下载的音频文件
- **内部流 URL**：形如 `/api/webdav/stream?server=<id>&path=<path>` 的服务端代理/本地缓存服务地址
- **目录歌单**：把某个目录下收集的歌曲一键收藏为歌单，歌曲条目保留源信息（source/folder/url）可直接播放
- **第三方播放器**：通过 Subsonic API（/rest）接入的外部客户端（如音流、Symfonium、DSub 等）

## Requirements

### Requirement 1：WebDAV 挂载源管理

**User Story:** AS 管理员, I want 在后台增删改查 WebDAV 挂载源并测试连通性, so that 可以把任意 WebDAV 服务作为音乐来源。

#### Acceptance Criteria

1. WHEN 管理员在后台创建 WebDAV 挂载源，系统 SHALL 持久化保存该条目（含 name/baseUrl/username/password/rootPath/enabled 字段）到 `<dataPath>/webdav-mounts.json`
2. WHEN 管理员编辑已有挂载源，系统 SHALL 更新对应条目并持久化
3. WHEN 管理员删除挂载源，系统 SHALL 移除该条目及其本地缓存目录中的文件
4. WHEN 管理员点击测试连接，系统 SHALL 尝试连接该 WebDAV 的 rootPath 并返回连通结果与目录项数量
5. WHEN 系统读取挂载源列表，系统 SHALL 返回全部条目（密码字段仅返回 hasPassword 布尔值，不返回真实密码）

### Requirement 2：目录浏览与音频索引

**User Story:** AS 管理员/用户, I want 浏览 WebDAV 挂载源的目录树并生成音频索引, so that 可以按目录定位和播放歌曲。

#### Acceptance Criteria

1. WHEN 请求浏览指定挂载源的指定目录，系统 SHALL 返回该目录的子目录与文件列表
2. WHEN 请求刷新某挂载源的音频索引，系统 SHALL 从 rootPath 递归收集全部音频文件，映射为与 OpenList 兼容的条目结构（含 source='webdav'、serverId、path、url 内部流地址）
3. WHEN 递归扫描时，系统 SHALL 应用防护限制（深度上限、文件数上限、目录数上限、扫描总时长、并发上限），避免超大远程目录拖垮进程
4. WHEN 音频索引已生成且未过期（TTL 内），系统 SHALL 直接返回缓存索引；WHEN 超过 TTL 或请求强制刷新，系统 SHALL 重新扫描
5. WHEN 扫描的目录含音频文件，系统 SHALL 为每个音频生成条目，字段至少包含 id/name/source='webdav'/serverId/path/url/folder='webdav' 等，确保播放链路可用

### Requirement 3：边播边缓存到本地播放

**User Story:** AS 用户, I want WebDAV 歌曲在请求播放时边播边缓存到本地目录, so that 首次播放秒开、后续播放直接读本地且不依赖 WebDAV 源稳定性。

#### Acceptance Criteria

1. WHEN 播放请求命中本地缓存文件，系统 SHALL 直接以本地文件响应（支持 Range，秒开跳转）
2. WHEN 播放请求未命中缓存且为完整范围请求（无 Range 或 bytes=0-），系统 SHALL 从 WebDAV 流式代理并在写入响应同时把数据写入 `<dataPath>/webdav-cache/<serverId>/` 的临时文件，完整下载后落盘为正式缓存
3. WHEN 播放请求为分段 Range 且未命中缓存，系统 SHALL 仅代理转发该 Range 到 WebDAV，不触发写入
4. WHEN 下载中断/失败，系统 SHALL 清理残留临时文件，不产生损坏的正式缓存
5. WHEN 播放请求需要跟随 WebDAV 重定向（如对象存储签名 URL），系统 SHALL 递归跟随重定向（最多 N 跳）
6. WHEN 查询缓存状态，系统 SHALL 返回单文件缓存进度或整体缓存汇总（文件数/占用大小）；管理员可清空缓存

### Requirement 4：任意目录收藏为歌单

**User Story:** AS 用户, I want 把 WebDAV/OpenList/本地缓存中的任意目录一键收藏为歌单, so that 无需手动逐首添加。

#### Acceptance Criteria

1. WHEN 用户选择当前目录并触发「收藏为歌单」，系统 SHALL 收集该目录及其子目录下的全部歌曲条目
2. WHEN 目录条目含 openlist/webdav 来源歌曲，系统 SHALL 保留其 source/folder/url/serverId/path 字段，加入歌单后仍可直接播放，无需关联在线音源
3. WHEN 目录条目为纯本地缓存歌曲（无平台音源关联），系统 SHALL 参照 openlist 分支豁免音源关联，直接可用
4. WHEN 用户选择目标歌单并确认，系统 SHALL 调用歌单添加接口批量写入并创建快照
5. WHEN 歌单内歌曲被播放，系统 SHALL 优先使用条目自带 url（内部流地址）播放，不走在线音源解析

### Requirement 5：第三方播放器（Subsonic）远程缓存后播放

**User Story:** AS 第三方播放器用户, I want 通过 Subsonic API 播放 WebDAV/OpenList/本地歌曲时服务端先缓存到本地再返回音频流, so that 播放稳定且不依赖远程源实时可用性。

#### Acceptance Criteria

1. WHEN Subsonic stream 请求的 id 解析为 source='webdav'，系统 SHALL 触发边播边缓存流程并以本地缓存流响应，而非返回在线源 302
2. WHEN Subsonic stream 请求的 id 解析为 source='openlist' 或 'local'，系统 SHALL 同样走本地缓存优先链路
3. WHEN 缓存未完整，系统 SHALL 先响应已下载部分（流式），下载完成后后续 Range 请求直接读本地文件
4. WHEN 请求不支持的 source，系统 SHALL 维持现有在线音源解析逻辑不变
5. WHEN stream 请求涉及 WebDAV/OpenList 缓存，系统 SHALL 在返回响应时设置正确的 Content-Type 与 Range 支持

### Requirement 6：前端接入

**User Story:** AS 用户, I want 在管理后台与播放器界面管理 WebDAV 挂载源、浏览目录并收藏歌单, so that 完整使用该功能。

#### Acceptance Criteria

1. WHEN 管理员进入后台 WebDAV 管理视图，系统 SHALL 展示挂载源列表、添加/编辑/删除/测试操作入口
2. WHEN 用户在播放器本地音乐视图切换 WebDAV 源，系统 SHALL 展示目录树并可浏览/播放歌曲
3. WHEN 用户对 WebDAV 目录触发播放，系统 SHALL 在界面显示缓存进度徽标（已缓存/缓存中）
4. WHEN 用户触发「目录收藏为歌单」，系统 SHALL 弹出歌单选择并完成添加，收藏后歌曲可直接播放
