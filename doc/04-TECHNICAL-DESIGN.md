# 技术架构与开发设计

版本：v1.0 · 日期：2026-11-14。技术基线已按用户选择确定；精确依赖版本、资源预算和兼容范围在 M0 验证后锁定。本文中的目录、接口与数据结构是开发方案，不表示仓库已包含对应实现。

## 1. 技术栈与选择理由

- Electron：窗口、托盘、系统对话框、应用生命周期与进程隔离。
- Vue 3 + TypeScript：Composition API、`script setup`，页面与交互；开启 strict 类型检查。
- electron-vite：统一 main/preload/renderer 构建；SCSS 用 Dart Sass 实现，运行时主题使用 CSS 自定义属性。
- Pinia：配置视图、导航、工作区状态；不承载终端字节流、私钥和解密后的密码。
- `@xterm/xterm`：终端模型；按需采用 fit/search/web-links/webgl/serialize 等官方扩展。Unicode 与连字扩展须验证版本兼容，不能随意混搭。
- `ssh2`：SSH、PTY 请求、SFTP、direct-tcpip、远程转发和认证；产品级断线恢复、队列、跳板编排自行实现。
- `node-pty`：本地 ConPTY；Windows 原生模块须按 Electron ABI 与架构重建。
- SQLite（候选 better-sqlite3）：单写入方、事务、迁移；原生模块兼容在 M0 验证，不能把同步数据库调用放在渲染线程。
- Electron safeStorage + 本地保险库：系统保护本地密钥；跨端加密使用兼容协议的 AES-GCM/Argon2id 实现，见专项文档。
- [Three.js](https://threejs.org/docs/)：只用于限额的品牌 3D；轻量 SVG 图表优先，复杂监控详情可按需加载 ECharts。
- Vitest、Vue Test Utils、[Playwright Electron](https://playwright.dev/docs/api/class-electron)：纯逻辑、组件和桌面主流程验证。Playwright 的 Electron 自动化接口仍标为实验性，M0 锁定可用组合并保留人工桌面回归。分屏布局先采用本项目 PaneTree，不引入无法控制焦点与 class 的重型布局框架。
- [electron-builder](https://www.electron.build/)：Windows 安装包候选，更新与签名集成在 M0/M6 验证后定案；注意官网可能默认展示 next 文档，锁版使用稳定版本对应说明。

不锁定未经验证的“最新版本”。M0 必须提交依赖清单、`yarn.lock`、Electron/Node ABI、x64 原生模块构建结果、许可证清单及已知兼容问题。开发 Node 版本与 Electron 内嵌 Node 版本分别管理。

依据：[electron-vite](https://electron-vite.org/guide/)、[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[ssh2](https://github.com/mscdex/ssh2)、[node-pty](https://github.com/microsoft/node-pty)。

### 1.1 Yarn 包管理约定

- 开发、CI 和发布构建统一使用 Yarn；依赖添加、升级、移除与项目脚本执行均通过 Yarn，不混用 npm/pnpm。
- M0 验证并锁定现代 Yarn 版本，在 `package.json` 的 `packageManager` 字段记录精确的 `yarn@版本号`，同时记录所需开发 Node 版本及 Yarn 安装方式；不得使用浮动版本。
- 使用 `.yarnrc.yml` 配置 `nodeLinker: node-modules`，按本文原生模块验证要求检查 Electron、`node-pty`、SQLite 与打包工具的兼容性。
- 提交 `package.json`、`yarn.lock` 和 `.yarnrc.yml`；`yarn.lock` 是唯一依赖锁文件，不提交 `package-lock.json` 或 `pnpm-lock.yaml`，不手工编辑锁文件。
- 本地首次安装及有意更新依赖后使用 `yarn install`；CI、验收与发布构建使用 `yarn install --immutable`，锁文件与依赖声明不一致时应失败，不在流水线中自动更新锁文件。
- 工程提供 `dev`、`build`、`typecheck`、`test` 脚本，分别通过 `yarn dev`、`yarn build`、`yarn typecheck`、`yarn test` 执行；当前状态见[开发记录](07-IMPLEMENTATION-STATUS.md)。原生依赖使用 `yarn native:rebuild`，Windows 打包使用 `yarn pack:dir` / `yarn pack:win`，避开 Yarn 内置 `rebuild` / `pack` 命令的同名冲突。

## 2. 进程与职责

### 2.1 Main 与 preload

Main 只负责窗口、托盘、协议入口、文件选择授权、凭据代理和工作进程编排；大量文件 I/O、Argon2、JSON 合并、SSH 加密和数据库迁移不得堵塞主事件循环。

Preload 暴露窄接口，例如 host、session、transfer、monitor、tunnel、vault、sync；不暴露任意 ipcRenderer、Node require、任意 shell 命令执行器或不受限文件系统 API。

渲染器关闭 nodeIntegration，启用 contextIsolation 与 sandbox；固定本地应用 origin 和 CSP，不加载远程页面作为应用界面。外链按协议允许列表经系统打开。SSH 返回内容仅交给终端/文本渲染，不解析为 HTML。

### 2.2 后台工作进程

- Connection Worker：管理 SSH 连接、通道、SFTP、隧道与监控调度。首版以一个 worker 起步，按会话组分片扩展；不为每个标签启动一个 Chromium 窗口。
- Local PTY Host：单独子进程承载 node-pty，管理进程树与退出；native 模块崩溃时不拖垮主窗口。
- Data/Crypto Worker：数据库单写入、同步合并、KDF 与备份；凭据解密请求由 main 的 broker 授权后返回给特定后台服务。
- Renderer：每窗口一个 Vue 工作台，多个 xterm 实例；不保存已存凭据的明文副本。

用户刚输入的密码会短暂经过认证表单；提交后清理表单状态，不进入日志、Pinia 持久化或错误遥测。系统保护不等同于硬件隔离或抵御同一 Windows 用户下恶意程序。

### 2.3 IPC 合约

控制消息使用类型化 DTO 与运行时 schema 校验，包含 requestId、windowId、sessionId、generation；每次重连 generation 递增，丢弃旧连接迟到事件。检查来源窗口和会话所属账号/工作区，不能只检查字段类型。

高频终端流使用 MessagePort/二进制块，不为每个字符发送普通 IPC。控制与数据通道分开；请求可取消，有超时和结构化错误码。限制输入消息大小及速率；销毁窗口时撤销端口与授权。

错误结构：code、scope、retryable、用户文案 key、脱敏诊断 ID。日志不记录私钥、密码、token、认证应答、完整终端内容或同步密文。

## 3. 建议模块组织

```text
src/
  main/              app、windows、tray、credential-broker、ipc-router
  preload/           受限桥与类型化客户端
  workers/
    connection/      ssh、sftp、forward、monitor
    local-pty/       ConPTY 与进程树
    data-crypto/     database、vault、sync、backup
  shared/            DTO、schema、错误码、纯逻辑、协议常量
  renderer/
    pages/           按 UI 文档页面名组织
    components/      自有基础组件和共享组件
    features/        hosts、workspace、terminal、monitor 等
    services/        IPC 客户端、TerminalRegistry
    stores/          低频界面状态
    styles/          tokens、mixins、third-party-adapters
    assets/          字体、图标、原创 3D
tests/               unit、integration、e2e、fixtures、performance
doc/                 本文档集
```

领域服务不依赖 Vue；UI 不直接调用 ssh2/node-pty/数据库；旧鸿蒙业务纯函数可参考语义重写，不搬运 HarmonyOS API 或 epoll 桥。

## 4. 会话、连接与视图模型

区分四个实体：

- TransportConnection：已认证 SSH 连接及其租约，承载 Shell/SFTP/监控/转发通道。
- TerminalSession：一个远程 PTY 或一个本地进程，拥有 sessionId 和 generation。
- TerminalView：渲染器里的 xterm 状态与焦点，不负责连接认证。
- WorkspacePane：布局节点，引用 TerminalSession/TerminalView。

会话与组件生命周期独立。关闭视图时按产品策略释放视图或把会话保留到可见后台列表；最后一个租约释放才关闭相应 transport。监控、SFTP 和隧道可以持有独立租约，不因终端页面切换失效。

首版默认每个独立终端连接一个 transport，避免共享故障影响过大；同主机同身份的监控采样可复用一个已授权 transport 的独立通道。SFTP 大传输可建单独连接，策略经压力测试确定。共享键必须包含账号空间、主机 ID、地址、用户、身份版本和跳板路径，不能只按 IP 合并。

运行状态机：idle → resolving → connecting → handshaking → verifying → authenticating → ready → reconnect-wait/failed → closing → closed。本地会话采用 spawning/running/exited 状态映射到同一 UI 接口。

重连保留 sessionId，更新 generation、认证与 PTY；未发送输入不跨 generation 重放。断线输出带边界标记。窗口崩溃后后台会话可短时保留等待重附着，超时策略可配置；应用完全退出则按规则结束连接。

## 5. 终端数据通路与背压

远程：ssh2 Channel 原始 Buffer → 分块序列 → MessagePort → xterm.write → 完成确认 → 释放窗口额度。

本地：ConPTY/node-pty → 本地 adapter → 同一数据通路。输入反向传给当前聚焦 session，resize 同步给远程 PTY 或本地 PTY。

建议起始参数：块大小 16–64 KiB，合并等待不超过 8ms；每会话在途高水位 1 MiB、低水位 256 KiB、受控总缓冲上限 16 MiB，均为 M0 待调预算。达到高水位暂停上游读取，xterm 处理确认后恢复；不能按“发出 IPC”就确认消费。

ssh2 流 pause/resume 与 node-pty 流控能力各自验证。若本地平台无法可靠暂停，要给出显式溢出策略，禁止无界积压或静默丢弃。安全优先的降级是停止该会话并提示原因，不能假称输出完整。

文本编码保持流式状态，不对任意块独立 UTF-8 解码；多字节字符和 ANSI 序列可跨块。保留 CR/LF/ESC 原始语义，不先做换行归一化。legacy 编码需显式主机配置，默认只保证 UTF-8；CMD 的编码差异单独回归。

终端实例由 TerminalRegistry 管理，置于 Vue 深响应式体系之外。隐藏标签保留解析状态、暂停不必要绘制；可见时 refresh/fit，具体调用以锁定版 API 为准。WebGL 仅对必要可见终端启用，候选上限 4 个，其他使用经验证的默认渲染路径。WebGL context 丢失不得销毁会话。

窗口调整通过 ResizeObserver 测量，requestAnimationFrame 合并，每帧最多一次 resize，拖动结束补发最终行列。字体加载完成后重新测量；隐藏区域不发送 0×0。输入与粘贴批次有优先级，不能被海量输出阻塞。

依据：[xterm.js 流控](https://xtermjs.org/docs/guides/flowcontrol/)。上述缓冲数字是本项目初始设计，不是库默认值或实测结果。

## 6. Linux 与 tmux 兼容方案

### 6.1 能力探测

终端兼容取决于控制序列、字体、locale、terminfo、Shell 和 TUI，不按发行版名称硬编码渲染分支。首次连接可在独立 exec 通道执行只读能力探测，超时后允许普通终端继续工作。

记录 OS 信息、可用 sh、locale、terminfo/tput 能力与 tmux 版本；不存在命令时不视为 SSH 失败。默认 PTY type 为 xterm-256color，环境变量请求被服务器拒绝时记录诊断，不改远端配置。

### 6.2 显示与输入

用 xterm 自身实现 VT/ANSI，不另写正则模拟终端。测试替代屏幕、SGR、DEC 模式、DECCKM、鼠标、bracketed paste、UTF-8、组合字符、中文/框线和 emoji。自定义快捷键先判断 IME composition 状态；输入法候选确认不得误触 Enter 执行两次。

tmux 外层 TERM 匹配客户端；内层由 tmux 设置为 tmux/screen 系列。必要时提供诊断建议而不自动覆盖。真彩、鼠标、剪贴板与字体宽度分别排查。[tmux FAQ](https://github.com/tmux/tmux/wiki/FAQ)、[xterm 序列支持](https://xtermjs.org/docs/api/vtfeatures/)。

tmux 自动附着使用固定命令模板，sessionName 只接受受限字符并按 shell 参数规则引用；不把任意用户名/标题拼入命令。不能在附着已有 tmux 后盲发 initCommands，因为当前 pane 可能正在 vim 或密码提示中。

### 6.3 多窗口迁移

同窗口移窗格移动容器/重绑定布局，不 dispose xterm。跨窗口采用后端连接移交租约，旧前端暂停消费，按序列号进行新端附着。serialize 扩展仅作为状态恢复候选，必须验证替代屏幕、模式、链接、滚动和中文；它不天然等价于完整运行态快照。

M0 未证明无损迁移前，产品显示“在新窗口新建会话”，不宣称活动 vim/tmux 无损搬移。最终首版对已通过矩阵的场景开放迁移，其余保持明确替代动作。

## 7. 本地终端实现

通过系统路径与已知安装路径发现 powershell.exe、pwsh.exe、cmd.exe；保存可执行文件绝对路径与参数数组。发现 WSL 使用 `wsl.exe --list --quiet` 等官方命令；处理输出编码和不可用状态。启动发行版/用户通过独立参数传递，不拼接动态 shell 字符串。[WSL 官方命令](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)。

默认继承安全的用户环境，按 profile 覆盖；cwd 必须是存在的允许目录，失败给出选择目录入口。WSL 路径与 Windows 路径由 adapter 显式转换，不能用字符串替换处理所有路径。

Local PTY Host 对每个进程记录 PID、启动配置、退出码与拥有者。关闭时温和终止、短超时后清理受控进程树；不能 kill 同名的其他 PowerShell。node-pty 与 Windows Job Object/进程树清理策略在 M0 验证；不使用普通 child_process stdout 管道替代交互式 PTY。

## 8. 服务器监控采集设计

### 8.1 采集通道

MonitorScheduler 按连接身份建立共享采集器；前台指标 2s、磁盘 15s、展开进程 5s，后台 10s/暂停。一次采集未结束不发下一次，默认超时 3s；连续 3 次失败退避至 30s，UI 显示过期。

使用只读、固定版本、POSIX sh 兼容的命令模板，在独立无 PTY exec 通道运行；不注入用户交互 Shell，不默认 sudo，不默认上传持久 Agent。命令模板经 GNU/BusyBox 两条路径测试，LC_ALL=C，输出使用稳定标记与分段格式，并验证字段类型/长度。

用户提供的路径、网卡名等不能直接插入命令。尽可能一次读取系统数据后在本地筛选；确需参数时经过白名单与安全引用。能力不足时单项降级，不使整个面板空白。

### 8.2 指标口径

- CPU：相邻 `/proc/stat` 样本求差，total 为 user+nice+system+idle+iowait+irq+softirq+steal，不额外累加 guest/guest_nice。显示口径为 `100 × (Δtotal - Δidle - Δiowait) / Δtotal`，iowait 可单独呈现；首次、负差、重启或无效分母记为未知。
- 内存：`(MemTotal - MemAvailable) / MemTotal`；缺 MemAvailable 时提供明确标为估算的备用口径，不与精确值混淆。Swap 独立计算。
- 负载与运行时间：`/proc/loadavg` 与 `/proc/uptime`；负载不是 CPU 百分比。
- 网络：`/proc/net/dev` 字节计数差除以实际采样间隔；接口重建/计数回退跳过样本；展示 KiB/s 或 MiB/s，不混成 bit/s。
- 磁盘容量：兼容的 `df -P -k` 路径，标明 used/available/size 口径；挂载点转义/空格正确解析，伪文件系统按用户选择过滤。I/O 速率为增强采集能力，不用容量代替。
- 进程：优先受限 `/proc` 或稳定的 ps 字段，限制 Top N 与频率；hidepid/容器权限不足时显示限制，不自动请求 root。

保留本地内存环形历史默认 10 分钟；每项含 value/unit/source/sampledAt/quality/scope。持久历史与跨端同步不在首版。参考：[Linux proc 文档](https://docs.kernel.org/filesystems/proc.html)。

## 9. 转发、SOCKS5 与跳板

TunnelManager 独立于终端视图，状态为 stopped/starting/listening/reconnecting/error/stopping；持有连接租约，设置停止标志后禁止重连竞态再次拉起监听。

L：Node net.Server 接受本机连接，调用 ssh2 direct-tcpip，双向 pipe 并传播背压/half-close。

R：调用远端监听请求并处理转发进入的连接，在 Windows 侧连接目标地址。实际 bind 结果、服务端拒绝、端口冲突分别报错。GatewayPorts 可能限制远端监听范围，不以客户端请求参数冒充最终公网可达性。

D：SOCKS5 TCP CONNECT 握手支持 IPv4/IPv6/域名，域名按远端目标传递以避免不必要的本地解析；不支持的命令返回协议错误。首版默认仅本机监听，非回环监听要求配置访问控制策略。

跳板：每跳 ssh2 session 上的 direct-tcpip stream 作为下一跳传输；层层验证指纹、认证、关闭传播与超时，检测循环并限制 3 跳。MFA/用户取消时按反向顺序释放所有已开资源。

所有隧道有本机运行状态，wire.enabled 仅作为同步配置状态，不能等价为当前设备应自动启动。公网穿透的端点流程和限制按 [OpenSSH ssh](https://man.openbsd.org/ssh)、[sshd_config](https://man.openbsd.org/sshd_config) 验证。

## 10. SFTP 与文件边界

TransferScheduler 管理队列、并发、冲突、重试和偏移；本地路径来自用户选择或授权根目录，后台复核规范化结果。远端文件名、符号链接、`..` 和 Windows 保留名称不能逃逸下载目标；非法名称提供映射和原名记录。

SFTP 与 terminal 使用不同 channel，必要时使用独立 transport，避免大传输抢占输入。大量小文件目录枚举可取消、限并发；不一次性加载整个目录树。跨设备/进程重启恢复时重新核实远端文件元数据，不能复用失效句柄。

文件操作不经过拼接 shell 命令；chmod/rename 等使用 SFTP API。上传覆盖和递归删除前展示实际对象，符号链接默认不递归穿越。权限错误保留现场和重试入口。

## 11. 持久化模型

SQLite 单写者，外键开启，事务写入，WAL 与备份策略结合验证。时间使用 UTC；内部 ID 稳定，SSH 主机地址不作为主键。

- Host：id、账号空间、名称、地址、端口、identityId、用户名覆盖、认证覆盖、localGroupId、连接/终端配置、版本。
- Identity：id、名称、用户名、认证类型、credentialId、版本；多主机引用，删除时检查引用。
- Credential：id、类型、密文/密文文件引用、公钥元数据、保存策略、keyVersion；禁止明文 secret 列。
- HostGroup/HostTag/HostTagLink：本地组织；wire 分组对象由适配器投影，主机归属不擅自同步。
- KnownHost：hostname、port、算法、公钥材料、SHA256、信任时间和来源；代理每跳独立记录。
- LocalShellProfile：程序路径、参数数组、cwd、环境配置、主题引用。
- Workspace：标签描述、PaneTree、比例、工具面板状态；不包含运行句柄。
- TunnelRule/TunnelLocalPolicy：共享配置与本机自动启动策略分离。
- TransferJob：源/目标、偏移、元数据、状态；路径与文件名可敏感，诊断导出需脱敏。
- SyncAccount/SyncState/SyncOutbox：账号空间、版本字符串、base 快照、待合并数据、幂等请求状态；token 另存凭据库。
- Appearance/Snippet/Settings：本地偏好与片段，敏感片段需加密标记。

加密同步缓存、base 与 outbox 同样可能含秘密，不能因为它们不在 Credential 表就明文落盘。数据库变更使用顺序 migration，迁移前备份，失败不覆盖旧库。

## 12. 安全、性能与运维

安全基线包括主机指纹校验、系统保护凭据、最小 IPC、输入校验、协议限制和生产 HTTPS，依据 [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)。远端标题、文件名、OSC、JSON 与 shell 输出全部视为不可信数据。

日志默认结构化、滚动、脱敏；会话输出记录默认关闭，用户启用时说明可能包含秘密，限制目录和保留周期。错误报告只包含脱敏诊断，不自动上传终端内容。

性能必须按整个 Electron 进程树测量，记录冷启动、首个可输入终端、空闲 CPU、内存、输入回显延迟、后台采样开销和 GPU context 数。具体预算见 [验收计划](06-DELIVERY-AND-ACCEPTANCE.md)，未实测前不得宣传“零占用”。

安装包必须验证原生模块、打包路径、字体、3D 静态资源、ConPTY、升级/卸载、签名与更新失败恢复。应用更新不在活跃传输中强制退出。配置按开发/生产环境区分，只放公开服务地址，绝不把服务密钥打包进前端。
