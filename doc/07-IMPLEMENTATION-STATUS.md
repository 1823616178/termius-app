# 开发进度与验证记录

日期：2026-11-14。对应开发版 `0.1.0`，本文件记录实际实现，其他功能文档继续作为目标规范。**M0、M1 均为进行中，完整首版尚未完成。**

## 已实现

- Yarn 4.18.1 固定版本、仓库内 Yarn 入口、唯一 `yarn.lock`、`node-modules` linker；开发、类型检查、格式检查、单测、桌面 E2E 和 Windows 打包脚本。
- Electron main / sandbox preload / Vue renderer 构建；SQLite Data Worker、Local PTY Host 与 SSH Connection Worker 使用 utilityProcess 隔离。
- 来源窗口与主 frame 校验、显式 IPC 白名单和运行时 Zod 校验；渲染器不具备 Node、任意执行程序或任意文件系统接口。CSP、拒绝应用内远程导航与新窗口、默认拒绝权限请求。
- 主机增删改查、收藏、本地分组、备注、字段与重复名称错误；SQLite WAL 持久化与顺序初始 schema 版本，高版本数据库拒绝打开。
- Windows 异步 safeStorage 保护所选密码；数据进程只接收密文。保存的密码不通过 bootstrap 或编辑接口返回渲染器；系统加密不可用时拒绝保存。
- PowerShell 5.1、PowerShell 7、CMD、WSL 发现；真实 node-pty / ConPTY、输入、resize、退出码与关闭。WSL 缺失或探测超时不阻断其他 Shell。
- SSH 密码与 OpenSSH Agent 连接入口、真实 SHA256 指纹、首次信任及变更提示；已知主机持久化。连接/认证超时与用户确认指纹的等待时间分开。
- MessagePort 二进制终端输出、递增序号、xterm 解析完成后 ACK、高/低水位暂停与恢复、16 MiB 上限、停滞与故障提示；不静默丢弃输出。
- 石墨轨道工作台、本机空状态、主机库与详情、原生对话框焦点管理；终端标签、标签排序、最多四窗格、两窗格比例调整、搜索、多行粘贴预览、复制粘贴、字号与屏幕阅读器开关。
- 自有 DOM 的五段语义 class、窗口与内部 UUID 实例类、模板 AST/SCSS 检查及第三方例外清单。

## 已执行的验证

验证机器：Windows 11 专业版 x64，系统 `10.0.26300`；开发 Node `24.15.0`。依赖精确版本记录在 `package.json`、`yarn.lock`，运行时 Electron/Node/ABI 可从设置与测试 bootstrap 获取。

- `yarn typecheck`：main、preload、worker、shared、Vue 与测试代码严格类型检查通过。
- `yarn format:check`：源代码格式检查通过。
- `yarn install --immutable`：固定依赖可安装，锁文件未被改写；仓库仅保留 `yarn.lock`。
- `yarn test`：14 项单元用例通过；包括非法主机/IPC 数据、终端尺寸/输入限制、顺序 ACK、伪造 ACK 和输出上限。
- `yarn build`：三个进程层和工作进程生产构建通过，258 个模板角色命名检查通过。
- `yarn test:e2e`：4 项桌面用例通过，覆盖离线启动、进程安全设置、实际 DOM 类名、主机编辑与重复名、重启恢复、SQLite/WAL 中不含测试密码明文、真实 PowerShell/CMD 输入输出、分屏比例、关闭 Shell PID 消失、真实剪贴板多行粘贴预览/取消及单行粘贴不重复、SSH 握手/信任/密码认证/中文分块/交互/再次连接，以及真实主机密钥更换后的阻断、旧/新指纹对照与取消。
- 同一桌面测试还验证了超过 5 MiB 的真实 ConPTY 输出及连续输出序号、强制结束 Local PTY Host 的失败提示与新建会话恢复。此结果不等于 10 分钟持续高输出或字节级全流完整性验收。
- `yarn pack:dir`：已生成 Windows x64 ASAR 解包程序；最终 `playwright test packaged.spec.ts --output=test-results/packaged` 的 1 项打包测试通过，验证 `app.isPackaged`、SQLite/preload 加载、PowerShell ConPTY 真实输入输出及关闭标签。
- `yarn pack:win`：已生成 `release/Graphite Orbit Setup 0.1.0.exe`（143,464,625 字节，未签名）。SHA256 为 `541868619F4EFE9BA9CB6A41E4309CC319272ACD01BFFBE79E3284DA0C37277D`。未在用户系统执行安装、卸载或升级，安装器完整生命周期仍待隔离 Windows 环境验收。
- `yarn dev`：已验证开发模式 main/preload 构建、Vite 服务启动与 Electron 拉起；验证后已停止开发进程。
- `yarn report:dependencies`：已生成 410 条已安装包的名称、版本、许可证字段、源路径与许可证文件索引。许可证最终审计仍待 M6。

测试通过不代表 Windows/Linux 全兼容。测试 SSH 服务是本机真实 ssh2 Server，不替代发行版/OpenSSH/tmux 矩阵。没有访问用户真实服务器、修改鸿蒙工程或同步服务端。

可视证据：`test-results/desktop/` 中的 `welcome.png`、`hosts.png`、`split.png`、`host-trust.png`，以及 `test-results/packaged/` 中的 `packaged-terminal.png`。许可证字段清单与语义类注册表位于 `artifacts/`。Yarn 安装仍有 electron-builder 上游 Squirrel peer 提示；当前仅构建 NSIS，已通过对应打包验证。Vitest 的配置加载方式有未来大版本兼容提示，当前固定版本检查通过。

## 当前明确限制

- M0：尚未完成鸿蒙 crypto 黄金向量、实际 OpenSSH Agent、多跳、跨窗口无损状态迁移、WebGL 与中文 IME/TUI/混合 DPI 矩阵。尚无冷启动 p95、完整进程树资源预算和 8 小时稳定性成绩。
- M1：尚未完成共享身份/私钥、分组对象管理、定制 Shell profile/工作目录与环境覆盖、Windows Job Object 对脱离控制台子进程的保证、迁移前备份与用户主动锁库。当前 normal-close 验证仅覆盖受控 Shell；不能宣称任意脱离控制台进程都已清理。
- M2：仅提前打通基础 SSH；未做 MFA、跳板、重连、tmux 初始化、工作区持久化、多窗口与全套快捷键自定义。三或四窗格暂用等分布局；仅两个窗格支持调整比例。
- M3–M6：SFTP、监控、L/R/D、账号/兼容同步、完整主题/3D、签名、更新和发布验收尚未实现。界面显示开发阶段，不生成示例主机、假指标或假进度。
- 系统保护不等于抵御同一 Windows 用户下恶意进程，也不等于可把密文直接复制到另一台机器。运行时认证必然短暂存在明文。

## 接续开发顺序

1. 补齐 M0 真实 OpenSSH/Agent、WSL、TUI/IME、DPI、原生安装与故障清理矩阵，并记录性能基线。
2. 完成 M1 身份/私钥、本地 profile、锁定与迁移备份。
3. 按 [交付计划](06-DELIVERY-AND-ACCEPTANCE.md) 推进 M2 会话生命周期、M3 文件/监控/转发与 M4 兼容同步；保持安全边界和真实失败状态。
