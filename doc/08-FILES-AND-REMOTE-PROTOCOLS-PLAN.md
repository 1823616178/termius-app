# 多协议文件工作台、远程桌面（RDP）、设置分域与同步扩展规划

版本：v1.0.0 正式基线规划 · 日期：2026-11-18 · 适用工程：`G:\code\termius-app`（Graphite Orbit）

> 本文档为下一阶段扩展功能的**设计与任务拆解规划**，在获得确认及远程管理服务端配套改造对齐前，不提前改动主业务源码。

---

## 1. 版本基线与后续自动迭代规则

### 1.1 正式版 `v1.0.0` 基线说明

项目已由早期开发版 `0.1.0` 正式升级为 **`1.0.0`**（覆盖 `package.json`、Electron 主进程版本读取、`workbench-state.ts` 初始状态、`TitleBar.vue` / `StatusBar.vue` 兜底展示、`sync-service.ts` 登录设备版本上报、`local-pty` 与 `connection` 工作进程 `TERM_PROGRAM_VERSION`）。`v1.0.0` 基线包含以下已落地核心能力：

- 本地 Shell（PowerShell / CMD / WSL / Linux Shell）与 SSH 多标签、多窗格终端及随附 SFTP 抽屉、端口转发、已知主机信任、加密同步。
- 中英双语切换（`zh-CN` / `en-US`）与全界面国际化。
- 41 款压缩为 `.woff2` 的内置字体 + 系统字体探测 + 自定义 CSS Font Stack，终端字体/颜色与面板字体/颜色完全解耦。
- 终端与面板各自独立的选中即复制（Select-to-Copy）及设置开关、状态栏反馈。
- 五行 / Graphite Orbit 主题体系与 3D 青冥剑境自动性能降级控制。

### 1.2 后续版本号更新约定（SemVer）

自 `v1.0.0` 起，**每次交付更新均直接以当前版本为基线向上递增，不再回到 `0.x`，且无需人工每次提醒**：

- **修订号 `v1.0.x`**：缺陷修复、文案/样式微调、非破坏性小优化。
- **次版本号 `v1.x.0`**：向后兼容的新协议、新页面或大型特性发布。
  - **规划 `v1.1.0`**：设置页按协议分类重构 + 左侧导航新增 **Files（多协议文件页面）** + 独立 VFS 工作进程支持 `SFTP / FTP / FTPS / SMB(Samba) / S3 / WebDAV`。
  - **规划 `v1.2.0`**：左侧导航新增 **Remote（远程桌面页面）** + 支持在 **Windows 与 Ubuntu Linux** 上运行的 **RDP** 客户端、证书信任与远程桌面设置。
  - **规划 `v1.3.0`**：对接升级后的远程管理服务端，启用多协议档案与分域设置的端到端加密（E2EE）跨端同步。
- **主版本号 `v2.0.0`**：仅在出现不向后兼容的重大架构或本地/远端主数据结构破坏性升级时启用。

---

## 2. 总体架构与导航布局规划

### 2.1 最左侧导航栏扩展（`NavRail.vue`）

当前 `Page` 路由联合类型（`src/renderer/src/stores/workbench-state.ts`）为：
`'workspace' | 'hosts' | 'local' | 'tunnels' | 'identities' | 'sync' | 'settings'`。

规划将其扩展为：
`'workspace' | 'hosts' | 'local' | 'files' | 'remote' | 'tunnels' | 'identities' | 'sync' | 'settings'`。

在 `src/renderer/src/components/NavRail.vue` 中按功能动线排布，全部使用 `@lucide/vue` 线性图标与现有五段语义 class 命名规则：

1. **终端工作台**（`workspace`，`<Terminal />`）
2. **文件中心 / Files（新增独立页面）**（`files`，`<FolderSync />` 或 `<HardDrive />`）
   - 语义 class：`container_app_navigation_sidebar_files`
   - 徽标：存在进行中或排队中的多协议文件传输时显示微章数字（类比 `activeTunnelCount`）。
3. **远程桌面 / Remote（新增独立页面）**（`remote`，`<Monitor />`）
   - 语义 class：`container_app_navigation_sidebar_remote`
   - 徽标：存在活动 RDP 会话时显示运行数量微章。
4. **主机库**（`hosts`，`<Server />`）
5. **本机终端**（`local`，`<SquareTerminal />`）
6. **分隔线**（`divider`）
7. **端口转发**（`tunnels`，`<Network />`）
8. **身份与密钥**（`identities`，`<KeyRound />`）
9. 弹性留白 + 底部固定入口：`sync`（`<Cloud />`）、`help`（`<CircleHelp />`）、`settings`（`<Settings />`）。

### 2.2 主题与 UI 设计约束（符合 Graphite Orbit）

新增的两个一级页面及重组的设置页必须严格复用 `src/renderer/src/styles/tokens.scss` 与 `global.scss` 的运行时设计变量：

- 画布与层次：背景沿用 `--color-app-bg` / `--color-surface-canvas` / `--color-surface-1` / `--color-surface-2`，边框 `--color-border` / `--color-border-control`。
- 强调色与状态色：主交互沿用 `--color-accent-primary`（如聚焦边框、当前激活连接/选项卡），传输链路或协议状态标签沿用 `--color-accent-secondary` 与 `--color-success` / `--color-warning` / `--color-error`（并配文字或图标，不依赖纯色表达）。
- 字体隔离严格继承：标题使用 `--font-display`，常规控件/列表使用 `--font-ui` + `--font-size-ui-*`，文件权限掩码、路径输入框、传输速率、Bucket Key 与 RDP 分辨率/延迟数值使用 `--font-term`（等宽）增强对齐可读性。
- 命名与安全校验：所有新增 Vue 模板自有 DOM 元素必须满足 `^container_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*_[a-z][a-z0-9-]*$` 与重复行实例后缀规则，确保 `yarn check:classes` 与 `yarn check:arch` 全量通过。

---

## 3. 独立 Files（SFTP & 多协议文件管理）页面设计

### 3.1 与终端抽屉 `SftpPanel.vue` 的职责边界

| 维度 | 终端内 `SftpPanel.vue`（现有） | 独立 `FilesPage.vue`（新增，v1.1.0） |
| --- | --- | --- |
| 触发方式 | 依附于已打开的 SSH 终端会话右侧抽屉 | 左侧导航 `Files` 一键直达，不需先开启终端标签 |
| 支持协议 | 仅 SFTP（复用当前 SSH 会话） | **SFTP、FTP、FTPS、SMB / Samba、S3（兼容对象存储）、WebDAV** |
| 连接来源 | 当前 SSH 会话自动跟随 | **1. 选择已配置服务器（现有 SSH 主机或已保存文件服务器）**<br>**2. 手动填写参数快速直连（可临时连接或一键保存）** |
| 视图布局 | 单侧远端列表 + 传输队列 | 多标签会话 + 左侧连接/书签侧栏 + 双栏视图（本机 ↔ 远端，或 远端 A ↔ 远端 B 跨协议中转）+ 底部全局传输队列 |

### 3.2 连接数据源与目标选型模型

页面顶部与空态区提供清晰的双模式连接入口：

1. **从已配置服务器选择（Quick Connect from Inventory）**：
   - 统一筛选列表同时展示两类来源，并带协议角标：
     - **已有 SSH 主机（`hosts` 表）**：标注 `SSH -> SFTP`，直接继承 host/port/username/authType/safeStorage 密钥与 known_hosts 指纹；
     - **已保存文件服务器（`file_profiles` 表）**：展示 `SFTP / FTP / FTPS / SMB / S3 / WebDAV` 档案，支持分组、搜索、收藏、排序。
2. **手动添加 / 临时直连面板（Ad-hoc & New Profile Form）**：
   - 选定协议后动态切换协议字段表单，提供「**仅此次连接（不保存）**」与「**保存并连接**」双按钮（表单校验通过后即可入库并即时建立会话，无密码持久化时仅存当前运行期内存直到会话关闭）。

### 3.3 各文件协议字段与技术栈设计

所有协议 I/O 在独立隔离工作进程（建议新增 `src/workers/file-vfs/index.ts` utilityProcess，或基于权限隔离原则独立进程）中执行，渲染进程严禁持有凭证或直接触摸文件系统。

| 协议 | 核心连接字段 | 鉴权与敏感字段（safeStorage 加密） | 协议特有参数 | Node/Electron 主流实现建议 |
| --- | --- | --- | --- | --- |
| **SFTP** | Host, Port (22), Username, 初始路径 | Password / PrivateKey / Passphrase / SSH Agent | 压缩开关、Keepalive、HostKey SHA256 校验 | 复用已有 `ssh2` SFTP 引擎与 `known_hosts` 验证链 |
| **FTP / FTPS** | Host, Port (21 / 990), Username | Password / Anonymous | `tlsMode`: none / explicit-tls / implicit-tls；`transferMode`: pasv / port；路径编码 (`utf-8` / `gbk`)；自签证书确认 | `basic-ftp`（纯 JS、TypeScript 原生、可控 PASV 与 TLS） |
| **SMB / Samba** | Host, Port (445), Share 共享名, Domain / Workgroup, Username | Password / NTLM | 初始子路径、方言协商范围（强制 >= SMB 2.1） | Windows 可评估原生 SMB/Win32 UNC 桥接或跨平台 `@marsaud/smb2` / 轻量 `smbclient` 适配器；Ubuntu 下统一走跨平台 SMBv2/v3 客户端或可选 `gio/libsmbclient` 适配器，保持统一异常语义 |
| **S3** | Endpoint URL（为空则按 AWS 标准）, Region, Bucket | AccessKey ID, SecretAccessKey, SessionToken（可选） | 前缀 Prefix、`forcePathStyle`（MinIO / 私有云常用）、TLS 校验模式、Multipart 分片阈值 | `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`（仅引入 S3 单包，严格控制包体积与 tree-shaking） |
| **WebDAV** | Server URL（含协议与基础路径）, Username | Password / Bearer Token | `authType`: basic / digest / token；自签证书确认、忽略证书错误警示开关、分块大小 | `webdav`（TypeScript 支持完善，流式读写可控） |

### 3.4 统一 VFS 能力矩阵与 UI 交互降级

并非所有协议都拥有 POSIX 权限语义（例如 S3 无传统 `chmod`/`symlink`，WebDAV 无 Unix UID/GID）。VFS 抽象层向渲染端下发 `ProtocolCapabilities`：
- `supportsChmod`: SFTP 为 `true`，FTP 視服务器 `SITE CHMOD` 返回可选，S3/WebDAV/SMB 为 `false`（UI 自动隐藏或禁用权限编辑操作，不显示无效报错）。
- `supportsFoldersAsPrefix`: S3 虚拟目录操作需明确语义（创建空文件夹占位 `prefix/`，递归删除列举全部前缀 Key）。
- `supportsResume` / `supportsServerSideCopy`: 传输队列根据能力展示「断点续传」或「整文件重传」；队列结构尽量复用 `SftpTransferQueue` 与 `SftpProgressEvent` 模型，增加 `protocol` 与 `sessionKey` 字段即可平滑扩展。

---

## 4. 独立 Remote（远程桌面 · RDP）页面设计

### 4.1 Windows 与 Ubuntu 双平台支持原则

`package.json` 已具备 `pack:win` 与 `pack:linux`（AppImage / `.deb`）构建脚手架，本规划要求 RDP 功能在 **Windows（10/11 x64）** 与 **Ubuntu（22.04 / 24.04 x64，涵盖 X11 与 Wayland）** 上均可用，不能强依赖仅限 Windows 的 ActiveX/COM 控件。

### 4.2 双模运行架构（内嵌画布优先 + 原生客户端兜底）

```text
RemoteDesktopPage.vue（多标签画布 + 工具栏 + 会话状态）
   │  二进制桌面帧 / 鼠标键盘输入 / 剪贴板事件 (MessagePort / IPC)
   ▼
RdpBroker (Main Process + 独立 helper / utility 边界)
   ├── 模式 A：内嵌渲染引擎（推荐主路线）
   │      Windows / Ubuntu 统一以 FreeRDP (libfreerdp3 / wfreerdp / 轻量 Native/Daemon)
   │      建立 RDP 会话，解码图像脏矩形 -> MessagePort/Canvas 绘制，支持窗内缩放、
   │      多标签切换、统一主题边框与断开重连。
   └── 模式 B：系统客户端外部/托管拉起（兜底与高保真备选）
          - Windows：生成隔离临时配置调起 `mstsc.exe`（仅非持久化或可控会话句柄）
          - Ubuntu：检测并调用 `xfreerdp3` / `xfreerdp` / `wlfreerdp`（根据 XDG_SESSION_TYPE 自动适配 X11/Wayland），实时监控子进程退出码与 stderr 诊断。
```

**跨平台依赖探测与可观测状态**：
- 启动及打开 `Remote` 页面或设置页的「RDP 后端自检」卡片时，主动检测本机可用的模式 A/模式 B 组件。
- Ubuntu 若系统尚未安装 `freerdp3-x11` / `freerdp3-wayland`（当采用外部二进制模式或共享库动态加载时），页面**不崩溃不静默失败**，而是明确展示缺失组件提示及一行可复制的安装建议（如 `sudo apt install freerdp3-x11`），并在设置页展示探测结果。

### 4.3 页面功能与安全边界

- **连接来源**：与 `Files` 页面一致——左侧可从已保存 `RDP 主机档案` 选择，亦可**基于现有 SSH 主机的 IP/主机名一键创建或发起关联 RDP 连接**，或手动填写 `Host / Port (默认 3389) / Domain / Username / Password` 快速连接。
- **TLS/NLA 证书首次信任（Trust-On-First-Use）**：类似 SSH `known_hosts` 验证弹窗，首次连接未知或证书变更的 RDP 服务端时展示服务器 X.509 SHA256 指纹与到期时间，用户确认后存入本地 `known_rdp_hosts` 表，变更时阻断并警告可能存在中间人攻击。
- **内嵌工具栏能力**：Ctrl+Alt+Del 发送按键、缩放适配模式切换（按面板缩放 / 1:1 滚动）、全屏切换、剪贴板手动刷新/禁用开关、真实会话 RTT/帧率状态指示（严禁造假）。

---

## 5. 设置页重构规划：严格按协议与职责域划分

当前 `src/renderer/src/pages/SettingsPage.vue` 采用纵向顺序平铺所有板块（语言、UI 主题、`TypographySettingsSection` 排版、终端、托盘、安全、更新、关于），尚未体现 **SSH vs 文件协议 vs RDP** 的职责边界。

### 5.1 新版设置页信息架构（`SettingsPage.vue` 左侧/顶部二级分域导航）

| 设置域 | 包含章节 / 设置项 | 作用域与持久化归属 |
| --- | --- | --- |
| **1. 通用与外观（General & Appearance）** | - 界面语言（中文 `zh-CN` / 英文 `en-US`）<br>- UI 主题预设（五行 / 自定义色板） & 高对比度<br>- **面板字体、标题字体、字号、字重、行高与面板文字配色**<br>- **面板选中即复制（`panelCopyOnSelect`）**<br>- 动效与 3D 剑境性能档位（自动/强制/轻量/关闭）<br>- 托盘与关闭按钮行为、本地加密状态、软件更新与关于 | 通用应用设置；本地外观偏好与 `preferences`（同步可控） |
| **2. SSH 与终端（SSH & Terminal）** | - **终端主题（自带/定制前背景色）与字体（等宽 Font / 字号 / 行高 / 字重 / 抗锯齿）**<br>- **终端选中即复制（`copyOnSelect`）**、多行粘贴确认<br>- 光标样式（Block/Bar/Underline）、闪烁开关、WebGL 加速、屏幕阅读器模式<br>- **SSH 协议专项**：默认端口（22）、默认 Keepalive 间隔（秒）、连接超时时间、指纹变更阻断策略、OpenSSH Agent 优先级、默认断开重连策略 | 归属 SSH / 终端作用域；支持「全局默认 + 单个 SSH 主机覆盖」标注 |
| **3. 文件协议（Files · SFTP/FTP/SMB/S3/WebDAV）** | - **文件工作台通用**：默认本地打开目录、同时最大传输并发数（1–8）、单任务限速（KB/s，0 为不限）、冲突默认策略（每次询问 / 覆盖 / 跳过 / 自动重命名）、默认显示隐藏文件（`.`）<br>- **SFTP 专项**：与打开终端共享 SSH 通道 vs 独立通道、符号链接解析模式<br>- **FTP / FTPS 专项**：默认传输模式（被动 PASV / 主动 PORT）、字符编码（UTF-8 / GB18030）、TLS 会话复用<br>- **SMB 专项**：允许的最低协议版本（推荐 SMBv2.1+，禁用高风险 SMBv1）<br>- **S3 专项**：默认 Multipart 分片阈值与块大小、默认 Path-Style 开关<br>- **WebDAV 专项**：分块上传阈值、默认证书校验策略 | 归属文件协议作用域；写入新表 `protocol_settings`（namespace=`files`） |
| **4. 远程桌面（Remote · RDP）** | - **跨平台后端自检与选择**：内置画布渲染（FreeRDP） / 系统外部客户端（Windows `mstsc` / Linux `xfreerdp3` 自定义路径）<br>- **显示与带宽档位**：默认分辨率策略（自适应面板 / 固定常见分辨率）、HiDPI 自动缩放、色深（16/24/32 bit）、桌面效果预设（局域网高画质 / 广域网均衡 / 低带宽极速）<br>- **安全与输入重定向**：默认安全层（自动协商 / 强制 NLA / TLS）、RDP 证书指纹信任策略、双向剪贴板默认开关、音频重定向默认开关、本地目录共享默认策略（关闭或只读映射需确认） | 归属 RDP 作用域；写入 `protocol_settings`（namespace=`rdp`） |

> **关键原则**：每个单台服务器档案（SSH 主机、文件服务器、RDP 服务器）在创建/编辑时均允许设置「**继承全局协议设置**」或「**仅对此主机覆盖**」，避免全局改一次配置覆盖了特殊生产服务器的个性化策略。

---

## 6. 远程同步兼容性分析与远程管理服务端 API 缺口清单（重点）

以下结论基于对仓库现行同步实现的逐行代码审查：
- `src/shared/sync.ts`（Wire Zod Schema & 常量）
- `src/workers/data-crypto/sync-merge.ts`（三方合并与规范化）
- `src/workers/data-crypto/sync-crypto.ts`（KDF、AAD、2 MiB 上限与只读守卫）
- `src/main/sync-service.ts`（HTTP API 客户端、锁库、轮换、修订恢复）
- `src/workers/data-crypto/database.ts`（SQLite 存储结构）

### 6.1 现行同步协议与接口的硬约束（实查事实）

1. **文档版本号锁定与只读保护**：
   - `SYNC_SCHEMA_VERSION = 1`（`src/shared/sync.ts:5`）。
   - `decryptSyncDocument`（`src/workers/data-crypto/sync-crypto.ts:381`）判断 `version > SYNC_SCHEMA_VERSION` 时直接返回 `readOnlySchema: true`，触发只读保护，阻止旧客户端（及现有鸿蒙版客户端）继续写入或自动上传。
2. **固定单文档端点与修订链**：
   - `sync-service.ts` 当前仅调用唯一同步文档路径 `GET /api/v1/sync/document` 与 `PUT /api/v1/sync/document`，修订历史也仅有单条链 `/api/v1/sync/revisions` 与 `/api/v1/sync/revisions/:revision/restore`。
3. **E2EE 明文载荷结构高度特化于 SSH**：
   - `SyncDocumentV1` 顶层仅含：`schemaVersion: 1`, `updatedAt`, `preferences: { syncPasswords, syncPrivateKeys }`, `servers`（SSH `WireServerProfile`: `id, name, host, port, username, authType, hostFingerprint, keepalive` + SSH `secrets`）, `tunnels` (`L | R | D`), `groups`。
   - **`normalizeRemoteDocument`（`sync-merge.ts:226-295`）对 `servers[]` 强行按 SSH 规则缺省填充（`port ?? 22`、`username ?? 'root'`），并将无 `host` 项过滤**——这意味着 **FTP / SMB / S3 / WebDAV / RDP 绝不能塞入现有 `servers[]`**，否则既会导致 S3 URL / Bucket / Domain 字段损坏，也会污染纯 SSH 老客户端与鸿蒙端的主机列表。
4. **Vault 密钥轮换仅接受单个文档**：
   - `POST /api/v1/vault/rotate`（`sync-service.ts:443-455`）请求体固定为 `{ currentPassword, keyEnvelope, document: prep.reencryptedEnvelope }` 并只传单一 `If-Match` 头。
5. **敏感控制开关仅有 SSH 两项**：
   - `WirePreferences` 仅有 `syncPasswords` 与 `syncPrivateKeys`；`SyncConflict['entityType']`（`src/shared/sync.ts:429`）枚举仅含 `'server' | 'tunnel' | 'group' | 'preferences'`。
6. **传输与明文容量硬上限**：
   - `MAX_SYNC_DOCUMENT_BYTES = 2 * 1024 * 1024`（2 MiB，含明文校验与 Base64 密文校验）。

### 6.2 远程管理服务端项目必须修改的 API 缺口清单

为了在不破坏已有 `v1` SSH 同步与鸿蒙客户端互通性的前提下，安全支持**多协议文件档案、RDP 档案、分协议设置及新型凭据（S3 AK/SK、FTP/SMB/WebDAV/RDP 密码与域名、已知证书指纹）**，请同步改造远程管理服务端以下 **6 个核心缺口**：

#### 缺口 1：缺少多文档命名空间（Namespace）端点（最关键架构决策）

- **现状**：仅支持单一文档 `/api/v1/sync/document` 与单一条历史链 `/api/v1/sync/revisions`。若直接把 `schemaVersion` 升为 `2` 覆盖原文档，旧桌面端或鸿蒙端将立刻卡死在“只读保护模式”，无法再同步 SSH 与隧道。
- **需要服务端补充的接口**（保持老接口 `default/core` 100% 向后兼容）：
  - `GET /api/v1/sync/documents/:namespace`（以及无参数旧路径 `/api/v1/sync/document` 等价于 `namespace = "core"`）
  - `PUT /api/v1/sync/documents/:namespace`（各自维护独立的 `revision` 十进制字符串、`ETag / If-Match`、`Idempotency-Key`、`schemaVersion`）
  - `GET /api/v1/sync/documents/:namespace/revisions`
  - `POST /api/v1/sync/documents/:namespace/revisions/:revision/restore`
- **推荐命名空间规划**：
  - `core`（`schemaVersion: 1`）：维持现有 SSH `servers` / `tunnels` / `groups` 与既有鸿蒙互通逻辑不变。
  - `protocols`（`schemaVersion: 2`）：存放新增的 `fileProfiles[]`（SFTP/FTP/FTPS/SMB/S3/WebDAV）、`rdpProfiles[]`（RDP 档案及系统关联 SSH ID）、`knownFileCerts[]`、`knownRdpCerts[]` 与各自密文凭据。
  - `settings`（`schemaVersion: 2`）：存放用户选择跨设备同步的通用外观（可选）与分协议设置（`sshSettings`, `fileSettings`, `rdpSettings`）及细分隐私开关。

#### 缺口 2：缺少服务端能力协商端点（Capability Discovery）

- **现状**：客户端无法探测远端服务端是否已升级支持 `schemaVersion >= 2`、多命名空间或更高的文档体积上限（`maxDocumentBytes`）。
- **需要服务端补充**：新增 `GET /api/v1/capabilities`（或在 `GET /api/v1/me` 返回体中增加 `capabilities` 字段）：
  ```json
  {
    "maxSchemaVersion": 2,
    "supportedNamespaces": ["core", "protocols", "settings"],
    "maxDocumentBytes": 8388608,
    "supportsBatchVaultRotate": true
  }
  ```
- **作用**：客户端检测到服务端尚未支持新命名空间时，UI 可明确提示“当前同步服务端暂仅支持 SSH v1 同步，文件/RDP 档案与扩展设置暂存本机”，不会出现莫名 404/400 或覆盖损坏。

#### 缺口 3：`POST /api/v1/vault/rotate` 仅支持单文档原子轮换

- **现状**：`POST /api/v1/vault/rotate` 只接收单一 `document` 与单一 `If-Match`。当用户关闭某一类敏感信息同步（例如关闭 SSH 密码同步或关闭文件/RDP 凭据同步）或使用恢复密钥重签保管库密钥版本（`keyVersion + 1`）时，若只能上传一个文档，其他命名空间文档将停留在旧 `keyVersion` 或无法在同一次密钥轮换事务中清除服务端历史密文！
- **需要服务端修改**：扩展 `POST /api/v1/vault/rotate`（建议兼容保留旧 `document` 入参同时支持批量 `documents` 数组/字典）：
  - 允许在**单次数据库事务**内验证多个命名空间的 `baseRevision`（防并发写冲突返回 `409`），原子更新 `keyVersion`、`keyEnvelope` 及所有命名空间对应的重加密信封，并在启用敏感清理选项时对指定（或全部）命名空间清理历史密文修订版本。

#### 缺口 4：`PUT /api/v1/sync/document` 对 `schemaVersion` 的校验放宽

- **现状**：若服务端在接收 `PUT /api/v1/sync/document`（或未来 `:namespace`）时硬编码限制 `schemaVersion === 1`，新版本或扩展字段将直接返回 `400/422`。
- **注意密码学 AAD**：客户端在加解密时使用 `orbit-sync-doc:v1|{vaultId}|{schemaVersion}|{keyVersion}` 作为 AES-256-GCM AAD（与服务端保存的外层元数据 `schemaVersion` 绑定）。因此服务端**必须原样存储并在 `GET` 与 `revisions` 中精确回传每个信封提交的 `schemaVersion`**，且允许范围放宽至 `[1..maxSchemaVersion]`。

#### 缺口 5：同步文档大小上限（当前 `2 MiB`）需要扩容或独立配额

- **现状**：`2 MiB` 上限在经过 JSON 序列化与 Base64 膨胀后实际可用净明文不足 `1.5 MiB`。加上 RDP 显示配置/证书链、S3 兼容多套接入点与扩展设置，合并单文件较容易触发限额拒绝。
- **需要服务端修改**：通过多命名空间拆解负载的同时，建议将服务端单文档接收上限由 `2 MiB` 提高至 **`8 MiB`**（或按命名空间配置上限并在 `capabilities.maxDocumentBytes` 声明），客户端再据此进行预检报错。

#### 缺口 6：服务端审计/设备接口元数据校验（如需要）

- **现状**：`POST /api/v1/auth/login` 与 `POST /api/v1/auth/register` 提交 `device: { name, platform, appVersion }`；`GET /api/v1/devices` 展示在线设备。
- **建议调整**：确认服务端对 `platform === 'linux'` 与新 `appVersion >= '1.0.0'`、以及后续携带的新设备能力字段不设过严正则拦截；若服务端做按设备类型统计，可在 `device` 对象中预留 `capabilities: string[]` 可选字段（服务端未知字段宽松忽略或入库）。

### 6.3 客户端 Sync 协议扩展清单（待服务端改造到位后实施）

1. 新增 E2EE `SyncDocumentProtocolsV2`（namespace = `protocols`）与 `SyncDocumentSettingsV2`（namespace = `settings`）Zod Schema；
2. 细粒度敏感同步开关（替代粗粒度全关全开）：
   - `syncPasswords`（SSH 密码，沿用 `core`）
   - `syncPrivateKeys`（SSH 私钥，沿用 `core`）
   - `syncFileCredentials`（FTP/FTPS/SMB/WebDAV 密码与 Token、S3 AccessKey/SecretKey/SessionToken）
   - `syncRdpCredentials`（RDP 用户密码 / Gateway 凭据）
   - `syncProtocolSettings`（SSH / Files / RDP / 外观排版设置的跨设备同步开关）
3. 三方合并与冲突模型扩展：`SyncConflict['entityType']` 增加 `'fileProfile' | 'rdpProfile' | 'protocolSettings'`，并在 `SyncConflictSection.vue` 复用脱敏 diff 视图（秘钥类仅展示“已修改/已移除”）。

---

## 7. 里程碑 Task Plan 与验收标准

### 里程碑 M8（已随 `v1.1.0` 交付，按第 9 节修订边界落地）：设置页按协议重组 + 独立多协议文件页面（Files）

- [x] **T8.1 数据模型与数据库迁移**：`schema_version` 顺序升级至 `4`（含迁移前 `.bak-v3-*` 备份），新增 `file_profiles`（`ftp | ftps | smb | s3 | webdav`）与 `protocol_settings` 表，遵循现行 `safeStorage` 敏感字段加密契约（渲染层永不收发解密后密码/AKSK）。（按第 9 节修订：SFTP 档案直接复用 `hosts` 表；TLS 指纹表 `known_file_certs` 延后，本版提供每档案 `tlsVerify: strict | insecure`。）
- [x] **T8.2 设置页分域重构**：重造 `SettingsPage.vue` 顶部三域分域导航（通用与外观 / SSH 与终端 / 文件协议；按第 9 节修订，RDP 域随 `v1.2.0` M9 一起上线），迁移并归位排版、选中即复制、主题、终端与 GPU 配置、安全与更新板块；接入 SQLite `protocol_settings` 持久化。
- [x] **T8.3 隔离 VFS 工作进程实现**：搭建 `file-vfs` worker + 统一 `FileAdapter` 接口与 `ProtocolCapabilities`，已接通并自测：
  1. SFTP（复用 SSH Connection Worker，支持直接选择现有 SSH 主机或独立新建/临时直连）；
  2. FTP / FTPS（`basic-ftp`，按第 9 节修订为被动模式 PASV + UTF-8 + `tlsVerify`）；
  3. S3（`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`，兼容 MinIO / R2 / AWS / OSS、分片上传进度与取消）；
  4. WebDAV（`webdav@5`，Basic/Digest/Token、流式进度）；
  5. SMB / Samba 按第 9 节修订移出 `v1.1.0`，当前后端显式返回 `'该协议在当前版本尚未提供'`。
- [x] **T8.4 导航与 `FilesPage.vue` 渲染实现**：`NavRail.vue` 增加 `files` 按钮；实现 SSH/文件档案选择栏 + 手动新建/编辑弹窗 + 临时直连 + 按第 9 节修订的单栏远端文件浏览器 + 原生选择器/拖放上传 + 全局传输队列；全元素通过 `yarn check:classes`。
- [x] **T8.5 自动化测试**：单元测试覆盖 Zod 校验（`file-profiles.test.ts`）、schema v4 迁移（`database.test.ts`）与 FTP/WebDAV/S3 Mock Server 集成测试及 SMB 显式拦截（`file-adapters.test.ts`）；Playwright E2E 验证多协议 Files 页（SFTP / WebDAV / S3）及三域设置持久化、中英文切换。

### 里程碑 M9（目标版 `v1.2.0`）：跨平台远程桌面页面（Remote · RDP）

- [ ] **T9.1 数据模型与后端探测**：新增 `rdp_profiles` 与 `known_rdp_hosts` 表；在主进程实现 Windows 与 Ubuntu RDP 能力自检服务（探测内置 FreeRDP 渲染桥 / `mstsc.exe` / `xfreerdp3` / `wlfreerdp` 及 X11/Wayland 会话类型）。
- [ ] **T9.2 RDP 会话托管与画布流传输**：实现内嵌渲染进程/helper 与二进制 `MessagePort`/IPC 帧推送、键盘 Scancode 与鼠标相对/绝对坐标映射、NLA/TLS 证书首次指纹弹窗及变更阻断；支持系统外部客户端兜底模式并回收退出子进程。
- [ ] **T9.3 导航与 `RemoteDesktopPage.vue`**：`NavRail.vue` 增加 `remote` 按钮；支持选择已有 RDP 档案 / 基于 SSH 主机一键关联创建 / 手动输入直连；提供分辨率适应、剪贴板、工具栏与清晰无依赖缺失提示 UI。
- [ ] **T9.4 跨平台测试与验证**：Windows 11 x64 与 Ubuntu 24.04 x64（CI 或实机容器验证）下完成安装探测、画布渲染或 `xfreerdp3` 拉起与进程清理回归、Playwright 桌面端页面/设置/安全边界回归。

### 里程碑 M10（目标版 `v1.3.0`，前置条件：远程管理服务端完成第 6.2 节改造）：多协议 E2EE 同步联调

- [ ] **T10.1 服务端契约对齐**：按第 6.2 节在远程管理服务端落地 `capabilities`、`sync/documents/:namespace`、`revisions`、`maxDocumentBytes` 与批量 `vault/rotate`。
- [ ] **T10.2 客户端多命名空间协调器**：扩展 `sync-service.ts`、`sync-crypto.ts` 与 `sync-merge.ts`，根据服务端能力自动切换 `core` + `protocols` + `settings` 并行/有序同步，旧服务端优雅降级保持 `core(v1)` 只读安全提示。
- [ ] **T10.3 跨端冲突解决与密钥轮换验证**：补全 `fileProfile` / `rdpProfile` / `protocolSettings` 的三方合并、脱敏 diff 弹窗、关闭凭据同步原子轮换清理及 `v1` 鸿蒙老客户端零回归测试。

---

## 8. 下一步等待确认项

1. **远程管理服务端修改确认**：请核对第 **6.2 节（缺口 1–6）** 改造方案（特别是**采用 `/api/v1/sync/documents/:namespace` 多命名空间隔离以兼容鸿蒙端 v1**，以及 `POST /api/v1/vault/rotate` 批量多文档原子轮换），在远程管理服务端完成或确认具体路径/字段规范。
2. **RDP 首选渲染策略确认**：M9 是优先先落地「**内置 FreeRDP 原生桥接内嵌画布**」（包体积略增，需打包/编译跨平台原生 helper），还是首阶段先支持「**检测并托管系统 `xfreerdp3` / `mstsc`（或嵌入窗体）+ 后续演进全内置画布**」。
3. **开发执行顺序确认**：按 `M8（设置分类重构 + Files 多协议页面，发 v1.1.0） -> M9（Remote/RDP 页面，发 v1.2.0） -> M10（同步联调，发 v1.3.0）` 依次推进，确认后即可启动 M8 开发。

---

## 9. 开工前方案复核与修订（2026-11-18，以本节为准，与前文冲突处以本节覆盖）

开工前对照现有源码（`sftp-store.ts` / `SftpPanel.vue` / `sftp-handler.ts` / `database.ts` / `electron.vite.config.ts` / `check-arch.mjs`）与各依赖的实际能力复核，发现原方案有以下问题，已修订：

| # | 原方案 | 问题（已核实） | 修订 |
| --- | --- | --- | --- |
| 1 | SFTP 作为新协议，建 `file_profiles` 档案并另起 SFTP 适配器 | 现有 `connectStandaloneSftpHost` 已支持“独立 SFTP 会话”，走 SSH Connection Worker、known_hosts 信任弹窗与密码加密，且 SSH 主机已进入现有 v1 同步 | **SFTP 档案 = SSH 主机**：Files 页手动添加 SFTP 时写入 `hosts`，直接复用现有引擎与 v1 同步；`file_profiles` 仅存 FTP / FTPS / WebDAV / S3 / SMB。这同时缩小了第 6 节“服务端缺口”的范围（SFTP 无需新 wire 模型） |
| 2 | SMB 使用 `@marsaud/smb2` | 该库 2021-04 后无更新，仅 SMB2，不支持 SMB3 签名/加密，无法兑现“最低 SMBv2.1、禁用 SMBv1”的安全承诺 | **SMB 移出 v1.1.0**，改为 v1.1.x 单独交付：Linux 调用系统 `smbclient`，Windows 走原生 UNC 路径；在能做真实验证前不对外宣称支持 |
| 3 | FTP 支持 PASV/PORT 与 GB18030 编码 | `basic-ftp` 仅支持被动模式；编码仅支持 Node `Buffer` 编码，不含 GBK/GB18030 | 删除 PORT 模式与 GB18030 选项；仅 UTF-8 + 被动模式，并在设置页注明 |
| 4 | 新增 `known_file_certs` 表做 TLS 指纹信任（TOFU） | v1.1.0 工作量与收益不匹配，且 FTPS/WebDAV/S3 的证书固定需要各库的 TLS 钩子 | v1.1.0 改为每档案 `tlsVerify: strict \| insecure`（默认 strict，选 insecure 时红色警告）；指纹固定列入后续版本 |
| 5 | Files 页做“双栏 Local ↔ Remote / Remote ↔ Remote” | 需要新增本地文件系统浏览 IPC 与跨协议中转，体量等同于再做一个文件管理器 | v1.1.0 先做**单栏远端浏览器 + 原生选择器/拖放上传 + 全局传输队列**（与现有 SFTP 抽屉交互一致）；双栏与跨服务器中转列入后续 |
| 6 | 新依赖放 `dependencies` | `electron.vite.config.ts` 对 `dependencies` 做外部化；`webdav@5` 为纯 ESM，外部化后在 CJS 主进程 `require` 会失败；纯 JS 依赖放 `devDependencies` 由 electron-vite 打进产物，包体更小 | `basic-ftp`、`webdav`、`@aws-sdk/client-s3`、`@aws-sdk/lib-storage` 放 `devDependencies`（与现有 renderer-only 依赖同一约定）；原生模块仍放 `dependencies` |
| 7 | 设置页 4 个域（含 RDP） | RDP 页面在 v1.2.0 才交付，v1.1.0 先出 RDP 设置会成为无消费者的死设置 | v1.1.0 设置页三域：**通用与外观 / SSH 与终端 / 文件协议**；RDP 域随 v1.2.0 的 RDP 页一起上线 |
| 8 | 协议设置沿用 localStorage | 主进程/工作进程需要读取并发数、超时、冲突策略，不能依赖渲染进程 | 协议设置落 SQLite `protocol_settings(namespace, document, updated_at)`；渲染层通过 IPC 读写，主进程校验 |

### 9.1 v1.1.0（M8）修订后的交付范围

1. 数据库 schema v4：`file_profiles`、`protocol_settings`（顺序迁移 + 迁移前备份，沿用既有策略）。
2. 设置页三域分类；文件协议设置与 SSH 默认值（默认端口/保活）持久化到 `protocol_settings`。
3. Files 页：SSH 主机（SFTP）+ 已保存文件档案选择；手动添加/临时直连；FTP / FTPS / WebDAV / S3 在独立 `file-vfs` utilityProcess 中运行；单栏浏览、新建/重命名/删除/上传/下载/取消、冲突策略、传输队列。
4. 导航栏 `files` 入口；中英文完整；`check:classes` / `check:arch` / 类型 / 单测 / E2E 全部通过后再发 `v1.1.0`。

### 9.2 未在 v1.1.0 交付（诚实清单）

SMB/Samba、双栏本地↔远端与跨服务器中转、TLS 证书指纹固定、RDP（v1.2.0）、多协议同步（v1.3.0，依赖服务端改造）。
