# Graphite Orbit · Windows SSH 工作台

Electron + Vue 3 + TypeScript + SCSS + xterm.js 桌面应用，统一使用 **Yarn 4.18.1**。

当前版本 `0.1.0` 是按 [规划文档](doc/README.md) 开始实现的开发版，处于 M0/M1；完整首版功能尚未全部实现。进度与验证边界见 [开发记录](doc/07-IMPLEMENTATION-STATUS.md)。

## 开发运行

Windows 11 x64，开发 Node **26.13.1**（版本约束见 `.nvmrc` 和 `package.json`，Node 24 仍受支持）。Yarn 已随项目固定在 `.yarn/releases/`，直接运行 `yarn` 即可自动使用该版本（Node 26 起官方已不再内置 Corepack，无需全局安装 Yarn）。

```powershell
yarn install --immutable
yarn dev
```

首次安装会下载固定版本的 Electron，并准备原生依赖。Windows ConPTY 使用 node-pty 随包提供的 Node-API 预编译模块；其他依赖按包的构建元数据处理。需要重新准备时执行 `yarn native:rebuild`。从源码构建原生依赖的环境需要 Visual Studio C++ 构建工具；当前 Windows x64 预编译路径已验证，无需为 node-pty 强制触发 Spectre 工具链编译。

## 当前可使用的流程

- 在“新建主机”中保存名称、地址、端口、用户名、认证方式、本地分组、备注与收藏。搜索、编辑、删除和重复名称检查已接入真实 SQLite 数据库。
- 勾选保存密码时，通过 Electron 异步 safeStorage 使用 Windows 系统保护；不勾选时在连接时输入。已保存密码不返回前端、不预填编辑表单。
- 直接打开 Windows PowerShell、PowerShell 7、CMD 或自动发现的 WSL 发行版。每个本地终端通过独立 PTY Host 中的真实 ConPTY 会话运行。
- 使用密码发起 SSH 会话；首次连接确认真实 SHA256 指纹。已信任指纹自动核对，变更时再次阻断并展示旧/新指纹。OpenSSH Agent 入口已实现，实际 Agent 环境仍待验收。
- 多标签、标签拖动排序、左右/上下分屏、两个窗格的拖动/键盘比例调整、输出搜索、复制粘贴、多行粘贴预览、字号和屏幕阅读器模式。每个标签最多四个窗格，空间不足时阻止分割。

SSH 和本地功能无需登录。终端正文不写入日志或数据库。关闭标签结束对应会话；退出窗口时提示仍持有的会话。当前不自动恢复工作区、重连或重放输入。

## 校验与打包

```powershell
yarn typecheck
yarn format:check
yarn test
yarn test:e2e
yarn test:packaged
yarn report:dependencies
```

`yarn build` 同时执行 Vue 模板 AST 和展开后 SCSS 的语义类检查；结果生成在 `artifacts/semantic-classes.json`。第三方 DOM 例外见 [例外清单](doc/STYLE-EXCEPTIONS.md)。依赖及许可证字段清单生成在 `artifacts/dependencies.json`，不等于完成发布许可证审计。

桌面测试使用临时隔离数据目录和本机随机端口上的真实 SSH 测试服务，不访问用户主机。截图及失败追踪分别保存在 `test-results/desktop/`、`test-results/packaged/`。测试临时数据目录保留在系统临时目录中便于检查；均以前缀 `orbit-e2e-` / `orbit-packaged-` 标识。

```powershell
yarn pack:dir
yarn pack:win
```

解包程序：`release/win-unpacked/Graphite Orbit.exe`；NSIS 开发安装包输出到 `release/`。当前构建未签名，尚不具备生产发布条件。打包不重复编译 node-pty；依赖升级后先执行 `yarn install --immutable` 或 `yarn native:rebuild`，再运行打包测试。

## 数据与开发边界

默认使用 Electron 当前 Windows 用户的应用数据目录。`ORBIT_USER_DATA` 环境变量可为开发/打包测试指定隔离的绝对数据目录；它不是跨设备迁移机制，Windows 保护密文仍绑定当前用户/设备的系统保护环境。

尚未完成：私钥管理、共享身份、MFA、跳板、自动重连、工作区恢复、多窗口、SFTP、服务器监控、L/R/D 转发、账号与鸿蒙兼容同步、3D 开屏、签名和更新。WSL/Agent 以及 Linux/tmux、中文 IME、DPI 和长时稳定性矩阵需要后续实测。不得把当前开发版作为完整 v1.0 验收结果。
