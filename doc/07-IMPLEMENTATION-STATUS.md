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
- 青冥剑境首页：Three.js 真实 3D 轩辕主剑，加长黄金八面宽刃（刃长 4.37，长宽比约 8.4:1）、双面日月星辰与山川浮雕、轩辕铭文、云纹兽面剑格、碧玉剑心和多层红穗；144/32 把实例飞剑、20 秒万剑归宗周期、动态尾迹、酒葫芦与酒盏涟漪；一把 DOM/CSS 3D 飞剑沿首页边框巡航。支持五行及自定义主题联动、窄窗口布局、完整/轻量/关闭动效档、WebGL 静态降级与场景资源释放。默认自动档检测 WebGL2、软件渲染器、处理器和设备内存，并根据持续真实帧率逐级降级；设置页提供自动、强制开启、轻量和关闭，支持偏好持久化、强制覆盖系统减少动态效果和自动模式原地重新检测。

## 已执行的验证

验证机器：Windows 11 专业版 x64，系统 `10.0.26300`；开发 Node `24.15.0`。依赖精确版本记录在 `package.json`、`yarn.lock`，运行时 Electron/Node/ABI 可从设置与测试 bootstrap 获取。

- 2026-11-16 动效性能控制：新增默认自动检测、持续真实帧率逐级降级、强制开启及偏好持久化，保留手动轻量和关闭；强制档覆盖系统减少动态效果，关闭时停止 RAF 并释放 Three.js 资源。独立审查后修复偏好初始化前默认完整、FPS 上报导致重复画布重设、自动档原地重检和采样代次问题，并保护临时 WebGL context 清理异常。`yarn typecheck`、`yarn test`（13 文件、96 项）、`yarn build`（844 个模板角色）通过；完整桌面 16 项通过 15 项，新增启动顺序、健康采样 canvas 写入、真实 draw/delete 调用、恢复后连续像素、原地重检和手动档位测试全部通过。唯一失败为既有托盘测试期待“托盘图标已在右侧工具栏显示”，而工作区原有实现显示“托盘图标已显示”，本次未改动该业务文案或测试。最新证据位于 `test-results/motion-performance-review-full/`，已读取自动与强制设置截图。动效相关文件定向 Prettier 检查通过；全量 `yarn format:check` 因用户并行修改的 `WorkspacePage.vue`、`sword-motion.ts`、`sword-scene.ts`、`tests/unit/sword-motion.test.ts` 存在格式问题而未通过，本次未覆盖这些改动。未重新打包或执行安装器安装/卸载；本轮改动未提交。

- 2026-11-16 轩辕剑主剑升级：`yarn typecheck`、`yarn format:check`、`yarn test`（12 文件、73 项）与 `yarn build` 通过，838 个模板角色检查通过。首页剑阵与动效档、WebGL 上下文恢复、初始化失败重试、真实 PowerShell/CMD 与分屏生命周期四项桌面用例全部通过。单测验证八面宽刃尺寸、UV 浮点边界、立体护手、双面贴合浮雕、材质纹理、剑穗和主剑三角形预算。已实际读取归宗、插剑与窄窗口截图及主剑放大区域，证据位于 `test-results/xuanyuan-sword-final/`。本次仅升级主剑，未修改飞剑数量、阵形或插剑时序。已验证 `release/Graphite-Orbit-Setup-0.1.0.exe`（133,281,253 字节，未签名）与 `latest.yml` 的 SHA512 一致，block map 的 6,401 个数据块逐块匹配，ASAR 包含轩辕剑模型、浮雕与铭文；`release/SHA256SUMS.txt` 已更新并复核。打包目录程序、真实 PowerShell、剑境归宗和插剑画面验证通过，截图位于 `test-results/xuanyuan-packaged/`；未执行安装器系统安装或卸载测试。

- 2026-11-16 轩辕剑加长与打包：刃长由 3.14 增至 4.37（约 39%），护手、剑柄与场景缩放不变，纹饰重新定位且保持自身比例。类型、格式、73 项单测、生产构建、首页剑境、WebGL 恢复、初始化重试和真实终端回归均通过。因正在运行的旧安装器锁定同名输出，新包使用 `release/Graphite-Orbit-Setup-0.1.0-xuanyuan-long.exe`，保留旧文件且不强制关闭用户安装器。新包为 133,282,773 字节，SHA256 为 `f7aca3aed99e21ef5c38e82f5048769f5242fe9d580beaa52d344cb53c923da3`；SHA512、`latest.yml`、6,398 个 block map 数据块、ASAR 与生产构建一致性及 6 项 SHA256 均验证通过。打包目录的真实 SQLite/preload/PowerShell 与轩辕剑画面验证通过，截图位于 `test-results/xuanyuan-long/` 和 `test-results/xuanyuan-long-packaged/`。未执行安装器系统安装或卸载测试。
- 2026-11-15 剑境升级：`yarn typecheck`、`yarn format:check`、`yarn test`（11 文件、65 项）与 `yarn build` 通过。`yarn test:e2e` 的 10 项中 9 项通过，新增用例实际验证 Three.js 就绪、边框位移、窗口缩放路径、缩放后场景截图，以及完整/轻量/关闭动效切换；纯函数单测验证 20 秒周期和归宗汇聚曲线，真实 ConPTY、SSH、分屏和主题用例通过。唯一失败为既有托盘测试仍期待旧文案“托盘图标已在右侧工具栏显示”，而工作区既有 Linux 适配已改为“托盘图标已显示”，本视觉提交不修改该业务文案或测试。可视证据位于 `test-results/desktop/` 与 `test-results/sword-realm-final/`。
- `yarn typecheck`：main、preload、worker、shared、Vue 与测试代码严格类型检查通过。
- `yarn format:check`：此前通过；本次动效审查后的全量检查受四个并行修改文件影响未通过，详见上述动效性能控制记录。
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
- M3–M6：SFTP、监控、L/R/D、账号/兼容同步、签名和发布验收仍有未完成项；首页完整主题/3D 已实现，但不等于所有业务页面的视觉矩阵均已验收。界面显示开发阶段，不生成示例主机、假指标或假进度。
- 系统保护不等于抵御同一 Windows 用户下恶意进程，也不等于可把密文直接复制到另一台机器。运行时认证必然短暂存在明文。

## 接续开发顺序

1. 补齐 M0 真实 OpenSSH/Agent、WSL、TUI/IME、DPI、原生安装与故障清理矩阵，并记录性能基线。
2. 完成 M1 身份/私钥、本地 profile、锁定与迁移备份。
3. 按 [交付计划](06-DELIVERY-AND-ACCEPTANCE.md) 推进 M2 会话生命周期、M3 文件/监控/转发与 M4 兼容同步；保持安全边界和真实失败状态。
