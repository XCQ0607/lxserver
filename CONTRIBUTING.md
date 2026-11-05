# 贡献指南

欢迎参与 lxserver。可以修 Bug、补测试、改文档，也可以提出功能建议。想找一个任务开始，可以先看 [贡献者招募](RECRUITING.md)。

## 分支怎么用

- `dev` 用于日常开发。普通 PR 都提交到这里。
- `main` 保存正式发布的代码。准备发布时，由维护者把验证过的 `dev` 合入 `main`。
- 每个任务单独建分支，例如 `feat/playlist-search`、`fix/session-expiry`、`docs/setup`。从最新的 `dev` 创建，完成后提 PR，不直接向共享分支推送。

通常的流程是：

```text
任务分支 → PR → dev → 发布 PR → main → 版本标签
```

普通 PR 如果选错了目标分支，改成 `dev` 即可。目前没有自动关闭这类 PR 的机制。

## 开始之前

小修复可以直接提交 PR。新增功能、接口变更、数据迁移或大范围重构，请先开 Issue，说明想解决什么问题、准备怎么改。先讨论范围，避免写完以后才发现方向不合适。

认领已有问题前，看看有没有人正在处理，在 Issue 下留个言。一个 PR 尽量只解决一个问题，不要顺带混入全项目格式化或无关重构。

## 本地开发

需要 Node.js 22 或更高版本、npm 和 Git。Fork 仓库后：

```sh
git clone https://github.com/<你的用户名>/lxserver.git
cd lxserver
git remote add upstream https://github.com/XCQ0607/lxserver.git
git fetch upstream
git switch -c feat/my-feature upstream/dev
npm ci
npm run dev
```

服务默认运行在 `9527` 端口。配置说明见 [README](README.md)。开发时请使用测试账号和单独的数据目录，特别是涉及删除、下载和文件管理的改动。

常用目录：

| 路径 | 内容 |
| --- | --- |
| `src/server/` | 认证、接口、文件、Subsonic、缓存、任务与同步，详见目录内 README |
| `src/modules/` | 共享模块和音乐源相关逻辑 |
| `public/music/` | Web 播放器，JS 目录内另有 README |
| `test/` | 自动化回归测试 |
| `docs/` | 使用说明与 API 文档 |

请修改源文件，不要改 `dist-electron/` 或 `server/` 中的打包副本。Tailwind 改动后运行 `npm run build:css`，文件管理前端改动后运行 `npm run build:files`，检查生成的差异是否符合预期。

## Commit 怎么写

格式为 `type(scope): 描述`，scope 可以省略。中文、英文都可以，标题不超过 120 个字符，与仓库现有 commitlint 规则一致。

```text
fix(auth): 退出登录后使旧会话失效
feat(player): 增加播放队列搜索
test(files): 覆盖路径越界检查
```

常用类型：

| 类型 | 用途 |
| --- | --- |
| `feat` / `fix` | 新功能 / Bug 修复 |
| `docs` / `test` | 文档 / 测试 |
| `refactor` / `perf` | 重构 / 性能优化 |
| `style` | 代码格式调整，不用于描述界面功能变化 |
| `build` / `ci` | 构建、依赖 / 自动化流程 |
| `chore` / `revert` | 其他维护 / 回退 |

描述要能看出改了什么，避免只写 `update` 或 `fix bug`。不兼容变更在正文加上 `BREAKING CHANGE: ...`，说明影响和迁移办法。提交前检查暂存区，不要把本地配置、运行日志或其他任务的修改带进去。

## 提交前检查什么

代码改动先运行：

```sh
npm run test:unit
git diff --check
```

当前可用的快速测试入口是 `test:unit`。`npm test` 仍引用不存在的 CJS 测试文件，尚待修正；提交前自动测试与 PR 测试门禁也还没有接入。测试覆盖范围见 [test/README.md](test/README.md)。

按改动补充检查：

- 服务端 TypeScript：运行 `npx tsc --noEmit`。接口变更检查正常请求、错误参数和权限边界。
- Bug 修复：尽量补一个能复现旧问题的回归测试，不要只测正常情况。
- 页面和播放器：在浏览器里实际操作。布局改动检查桌面与移动端；播放相关改动检查切歌、暂停和刷新恢复。
- 文件、下载和缓存：使用临时数据，检查失败、取消和清理后的状态。
- 构建或文档：运行对应构建。纯文档修改无需为了凑数量增加测试。

PR 中写出实际执行的命令和结果。没跑的检查说明原因；测试文件没找到或执行了 0 项，不能算通过。自动化测试通过也不代表已经验证了真实播放。

## 提交 PR

先同步最新的 `dev`，在本地解决冲突并重新检查：

```sh
git fetch upstream
git merge upstream/dev
# 如有冲突，解决后提交，再执行受影响的检查
git push -u origin feat/my-feature
```

创建 PR 时把目标分支选为 `dev`，按模板说明原来的问题、改完的行为和验证结果。界面改动附截图；接口或数据格式变化说明兼容性。还没完成可以先开 Draft PR。

收到审查意见后继续向同一分支提交即可，不用重开 PR。由维护者负责最终合并。日常 PR 推荐 squash 合并，合并标题也要符合提交规范。

不要提交密码、Token、Cookie、私人日志或音乐文件。安全问题按 [安全说明](.github/SECURITY.md) 私下报告，不要在公开 Issue 中贴出敏感细节。

发布、紧急补丁和维护权限见 [项目治理](GOVERNANCE.md)。参与讨论请遵守 [行为准则](CODE_OF_CONDUCT.md)。
