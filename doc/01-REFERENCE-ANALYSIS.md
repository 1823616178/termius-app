# 参考项目与竞品分析

调研日期：2026-11-14。本文区分「代码事实」「官方资料」「截图观察」「本项目方案」。没有运行或实测鸿蒙、Tabby、Termius、FinalShell 应用；不能据此声称其性能、所有功能或最新版本体验已验证。

## 1. 鸿蒙项目：实际分析范围

来源根目录：`C:\Users\lx182\DevEcoStudioProjects\ssh_client_ohos`。以下相对路径均以此为根。

已检查 README、CLAUDE.md、docs/DESIGN.md、docs/TASKS.md、docs/api-v1.md，以及 pages、view、viewmodel、service、theme、common/model、common/sync 和 C++ 连接／加密实现中的关键路径。仓库内没有完整应用截图，鸿蒙视觉分析来自布局、颜色和动画代码。

### 1.1 功能与架构事实

- `pages/HostListPage.ets`：主机搜索、分组折叠、快速连接、活动会话、编辑与连接菜单。
- `pages/Index.ets`：小屏单栏、中屏主机列表与嵌入终端、大屏增加右侧 SFTP／片段／转发面板；迷你终端与全页终端之间有会话接管逻辑。
- `pages/TerminalPage.ets`、`viewmodel/PaneTree.ets`：标签、分屏、拖动预览、焦点、全屏和独立窗口相关实现。当前页面主要入口偏向双窗格，不能直接把它描述成无限分屏成熟方案。
- `view/TerminalCanvas.ets`、`view/terminal/`：自绘终端、字体、IME、物理键盘、选区、滚动、鼠标与帧调度。
- `service/SessionManager.ets`：连接状态、凭据获取、指纹交互、保活、重连、网络切换及窗口／窗格绑定。
- `pages/AppearancePage.ets`、`theme/ThemePresets.ets`：9 套预设、20 个终端色位、字号、行高、光标、背景配置和配色导入相关代码。
- `service/sync/`：认证、设备管理、加密保险库、同步状态机、离线修改、版本冲突、历史恢复等模块。
- C++ 内核为 libssh2、OpenSSL、libvterm、libargon2；`cpp/io/EventLoop.cpp` 依赖 epoll/eventfd，不能把现有 native 桥原样编译为 Windows 后端。

### 1.2 文档与代码不一致之处

**跳板机并未完成端到端链路。** `service/portforward/ProxyJump.ets` 有路径规划，但 `SessionManager.ets` 的生产 `transportReady` 路径仍受底层传输能力限制。Windows 应独立实现并用真实多跳服务器验收。

**SFTP 上传界面仍存在样例入口。** `pages/SftpPage.ets` 的 `onUploadStub()` 使用固定 sample 路径；下载已接保存选择器。不能将 README 的完整传输描述作为所有 UI 流程已完成的证据。

**同步范围比旧设计小。** `service/sync/SyncSerializer.ets` 严格输出 servers、tunnels、groups；主题、片段、完整 known_hosts、跳板、初始命令等不上云。`SyncRuntime.ets` 明确保留本地 `groupId`，新同步主机使用 `groupId: null`。

**私钥同步有缺口。** `loadHostSecrets()` 暂不上行私钥；`applyIncomingSecrets()` 暂不落地远端私钥。未知字段／私钥透传也必须用真实往返测试确认，不能仅凭注释承诺不会丢数据。

**密码学命名空间以代码为准。** `common/sync/SyncProtocol.ets` 与 `cpp/crypto/sync_params.h` 使用 `ssh-port-mapper/*` 和 `SPM1`，旧设计文档中的独立命名空间或 SCO1 不应被新客户端采用。

### 1.3 UI 代码观察

深色背景为 `#03060A`，表面 `#0A1220`，强调色 `#00E5FF`；大圆角、卡片、触摸目标、长按和滑动菜单带有移动端特征。`Motion.ets` 含 150/220/300ms 动效、开屏展示与跃迁参数。`AstroSplashOverlay.ets`、`ServerConnect3DOverlay.ets` 用 Canvas 投影、星尘、轨道、吉祥物和连接阶段提示建立品牌感。

Windows 版保留会话状态清晰、主题可调、连接阶段可见的优点；改为鼠标与键盘优先、紧凑密度、可停靠面板和统一工作区。既有代码里为本地列表设置的固定加载动效不直接沿用：数据就绪应立即可操作。

## 2. Tabby：终端工作流参考

官方列出多种本地 Shell、SSH/SFTP、跳板、持久转发、分屏、快捷键、字体和括号粘贴等能力。[官方功能页](https://tabby.sh/about/features)、[官方仓库](https://github.com/Eugeny/tabby)。

查看了官方仓库的 [终端截图](https://raw.githubusercontent.com/Eugeny/tabby/master/docs/readme-terminal.png)：顶部标签占用小，主体用于多个终端窗格，Shell、编辑器与监控 TUI 可以并排。截图是仓库样例，不代表最新 Windows 界面。

本项目借鉴：本地与远程统一会话模型、拖动分屏、配置模板、快捷键体系、Nerd Font 与宽字符测试。首版不承接其全部协议和插件生态。

## 3. Termius：信息架构与工作区参考

官网展示 Hosts、Keychain、SFTP、Port forwarding、Snippets、Known Hosts、Logs 与加密 Vault；工作区文章说明 Focus、Split 和广播工作流。[官网](https://termius.com/)、[官方工作区介绍](https://termius.com/blog/workspaces-focus-without-losing-context)。

查看了文章中的 [Split view 截图](https://framerusercontent.com/images/ew0AC9ClqrInFSOqXed26ebCiM.jpg)：分组标签、统一边界和窗格标题建立层级，终端内容仍是主要视觉区域。本文据此借鉴层次组织，未验证其各平台交互。

本项目借鉴：主机与凭据分离管理、工作区保存、会话聚焦、轻量连接入口。设计采用自己的石墨与紫青色系，不复制其商标、图标或页面素材；团队协作不进入首版。

## 4. FinalShell：运维同屏体验参考

官方介绍列出终端与 SFTP 同屏、无需服务器插件的性能监控、CPU／内存／网络／磁盘及进程信息等能力。[官方介绍](https://www.hostbuf.com/t/988.html)。

查看了官网的 [工作台截图](https://www.hostbuf.com/upload/image/20210110/1610264529229005910.jpg)：左侧服务器指标、中间终端、底部文件区域，信息密度较高。图片标题显示 3.8.3，是历史样例，不能当作当前版本精确外观。

本项目借鉴其同屏工作流：终端旁查看资源状态、下方处理文件。使用可折叠监控栏、短趋势图和按需详情改善空间分配；不把完整监控面板固定占据每一个分屏。

## 5. 本项目的综合方案

- 以会话工作区为中心：远程 SSH、本地 PowerShell/CMD/WSL 混合编排。
- 左侧负责资产导航，中部负责终端，右侧负责当前服务器指标，底部负责 SFTP／传输／片段。
- 账号、身份、密码、密钥与同步范围分别表达，避免用户把“记住用户名”误认为“上传密码”。
- 自有 DOM 使用可追踪的 class 名称；实例标识与样式角色分离，便于定位同时避免生成成千上万份 CSS。
- 3D 聚焦开屏、连接等待和空状态，正常输入时释放渲染资源。
- 不把 README、营销文案或截图当作完整验收依据；功能设计与测试矩阵独立编制。

## 6. 实现依据索引

- [electron-vite](https://electron-vite.org/guide/)：多进程构建组织。
- [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)：宿主与凭据边界。
- [ssh2](https://github.com/mscdex/ssh2)：SSH 通道、SFTP、代理、认证与转发基础。
- [node-pty](https://github.com/microsoft/node-pty)、[WSL 命令](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)：本地伪终端与发行版发现。
- [xterm.js 控制序列](https://xtermjs.org/docs/api/vtfeatures/)、[流量控制](https://xtermjs.org/docs/guides/flowcontrol/)：终端能力与背压。
- [tmux FAQ](https://github.com/tmux/tmux/wiki/FAQ)：终端类型与显示兼容。
- [Linux proc 文档](https://docs.kernel.org/filesystems/proc.html)：监控数据源。
- [OpenSSH ssh](https://man.openbsd.org/ssh)、[sshd_config](https://man.openbsd.org/sshd_config)：转发语义及服务端限制。

外部链接是调研时来源，开发锁版时重新核对。上文之外的布局尺寸、性能预算、流程与验收条件均为本项目设计提案。
