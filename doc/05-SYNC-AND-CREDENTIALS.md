# 账号、凭据与同步兼容设计

版本：v1.0 · 日期：2026-11-14。本文以鸿蒙当前源码为兼容依据，旧 README/设计中的“全量同步”和独立密码学命名空间不作为契约。

源码根目录：`C:\Users\lx182\DevEcoStudioProjects\ssh_client_ohos`。主要依据：`entry/src/main/ets/common/sync/SyncProtocol.ets`、`service/sync/SyncSerializer.ets`、`SyncRuntime.ets`、`SyncMerge.ets`、`cpp/crypto/sync_params.h`、`aad.cpp` 与 `docs/api-v1.md`。

## 1. 三种用户概念

1. **应用账号**：云同步服务的用户，包含账号标识、deviceId 与 token 会话。
2. **SSH 身份**：客户端保存的用户名、认证方式和凭据引用，可复用于多台主机。
3. **远端系统用户**：服务器既有登录账户。本客户端不会因为保存 SSH 身份而创建或修改服务器用户。

未登录应用账号仍能保存主机、身份与凭据，并使用 SSH、本地终端、SFTP 和隧道。云账号切换不改变已连接服务器上的用户身份。

## 2. 本地保存与解锁

### 2.1 保存粒度

用户名、密码、私钥文件引用、导入私钥副本、私钥口令、应用 refresh token 各有独立存储类型。主机可引用共享身份，也可保留本机单独覆盖。

用户名属于普通配置；密码、私钥、口令与 token 必须加密保存。外部私钥“引用文件”模式只保存路径，不自动复制原文；文件权限/丢失/内容改变需在连接前诊断。导入副本模式把内容存入本地加密保险库。

### 2.2 加密布局

生成随机本地数据密钥，使用 AES-256-GCM 加密凭据记录，随机且不重复的 nonce，AAD 绑定本地记录 ID、类型和格式版本；数据密钥通过 Windows 系统能力保护。可通过 Electron safeStorage 实现系统保护，API 使用锁定 Electron 版本支持的非阻塞路径。[safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage)。

本地数据密钥与云端 Vault key 是两个不同密钥，不能混用。系统保护不可用时拒绝“永久保存”，允许仅本次会话使用，不回退明文。

可选应用主密码采用额外的密钥包裹层；开启后不能保留绕过主密码的自动解密副本。忘记本地主密码的恢复语义必须在设置前说明。仅遮挡窗口的“应用锁”不能宣传为主密码密码学保护。

DPAPI 主要保护不同 Windows 用户之间的磁盘数据，不承诺抵御同一用户权限的恶意程序。JavaScript 字符串不能保证清零，使用最短生命周期与可覆盖 Buffer 减少暴露，不写“明文在内存绝不存在”。

### 2.3 使用与撤销

后台服务凭 credentialId 申请短期解密，不向 renderer 返回已保存秘密的明文；用户主动查看/导出是单独受控动作。自动填写认证表单不依赖从后台返回整个保险库。

锁屏/锁定后禁止新解密，清除可释放的解密缓存；已建立 SSH/隧道按设置继续或断开。删除凭据检查引用并提示受影响主机；正在运行的连接不必立即失效，但下次认证必须更新。

便携迁移通过独立口令加密备份包完成；拷贝 DPAPI 密文到另一台电脑通常不能解密。普通导出与诊断包绝不包含秘密。

## 3. 应用登录状态保存

“记住账号”仅保存显示标识；“保持登录”保存系统保护的 refresh token。access token 优先内存；deviceId 与服务端设备记录一致；不保存账号明文密码用于自动登录。

按现有 API 文档，access token 有效期 900s，refresh token 30 天且单次轮换。客户端必须以服务端实际响应/错误为准；所有并发 401 共享一个刷新任务，避免复用旧 refresh token 导致整个 family 失效。

刷新成功后先原子保存新 token，再释放等待请求；崩溃或网络不确定导致旧 token 已消费时，按服务错误进入重新登录，不无限重复提交旧 token。

退出账号停止同步调度、清除 token、锁定云 Vault；保留还是移除该账号的本地配置由显式选择决定。切换账号使用独立 namespace，旧 outbox 不得上传到新账号。

## 4. 现有同步 wire schema

顶层只有：`schemaVersion`、`updatedAt`、`preferences`、`servers`、`tunnels`、`groups`。当前 schemaVersion 为 1。客户端必须使用明确 DTO 投影，不能把本地数据库对象直接 JSON.stringify 后上传。

### 4.1 主机

每个 server 的 `profile` 只有：`id`、`name`、`host`、`port`、`username`、`authType`、`hostFingerprint`、`keepalive`。

可选 `secrets` 有 password、passphrase、privateKey、privateKeyEncoding、privateKeyFormat、privateKeyFingerprint。私钥出现时相关编码/格式/指纹字段必须齐全并通过解析校验。最终编码与指纹算法必须与对端实际校验器和 fixture 一致，不能自行命名。

`SyncServerRecord.id` 是鸿蒙内部合并辅助值，不写入 wire server 外层。字段出现规则、空值与省略规则都需固定。

### 4.2 转发

tunnel 字段：id、name、serverId、groupId、type、listenHost、listenPort、destHost、destPort、destServerId、autoReconnect、enabled。可同步 L/R/D 的规则；本机当前监听、PID、字节计数和自动启动授权不上云。

旧客户端可能遇到其他 type；不支持的记录必须保留原始数据并标记不可执行，不能加载时丢弃、下一次同步悄悄删除。

### 4.3 分组与偏好

group 字段：id、name、color。preferences 字段：syncPasswords、syncPrivateKeys。

主机 profile **没有 groupId**；tunnel.groupId 是隧道分组，不能偷偷借用它表达主机归属。鸿蒙本地分组颜色也存在透传缓存与模型差异，必须测试多轮往返。

## 5. 首版同步范围

- 主机基础字段、分组对象、L/R/D 规则：首版双向互通目标。
- SSH 密码/口令：用户显式开启后同步；默认关闭。本地保存与云端同步是独立开关。
- 私钥：本地保存首版完整实现；跨鸿蒙双向同步暂受源项目上/下行缺口限制。只有双方能力与 round-trip 验收完成后，才允许用户把它当作可靠备份。
- 身份模板：本机保存 identityId 与引用关系；同步时投影为每主机 username/authType/secrets。远端导入不根据相同用户名猜测共享身份，不自动合并密码。
- 主机归属、标签、备注、主题、布局、快捷键、Shell 程序路径、跳板链、初始化命令、tmux 配置、监控历史、完整 known_hosts：当前仅本机。
- hostFingerprint 虽在基础主机中，但不是完整 known_hosts。导入后显示来源与验证状态，首次连接仍按安全策略确认，不把缺失公钥材料伪装为已验证记录。

Windows 读取当前版本文档后再次上传，应逐字段保留本机不理解但协议允许的既有数据。若遇到更高 schemaVersion 或无法安全 round-trip 的字段，转只读/待升级，不能删除未知内容后覆盖云端。

特别注意：鸿蒙当前私钥回传是否完整不能只靠注释判断。即使 Windows 正确上传私钥，旧鸿蒙保存其他配置时仍可能造成丢失；因此首版跨端私钥开关必须被能力门槛约束，而不是只在说明文字里警告。

## 6. 密码学兼容参数

现有源码常量：

- Argon2id：内存 65,536 KiB，迭代 3，并行 1，输出 32 字节，salt 16 字节；密码派生结果用于包裹/解锁 Vault key，具体格式按现有实现。
- AES-256-GCM：nonce 12 字节，tag 16 字节，tag 拼接及编码严格遵循现有 envelope。
- HKDF recovery info：`ssh-port-mapper/recovery-kek/v1`，输出 32 字节。
- 文档 AAD domain：`ssh-port-mapper/sync-document/v1`。
- 密码包裹 AAD domain：`ssh-port-mapper/vault-key/password/v1`。
- 恢复包裹 AAD domain：`ssh-port-mapper/vault-key/recovery/v1`。
- 恢复密钥前缀：`SPM1`，raw base64url 段 43 字符，校验大写 hex 12 字符。

AAD 编码为 domain 后按顺序附加 `|UTF8字节长度:字段值`。文档字段顺序是 vaultId、schemaVersion、keyVersion；密码/恢复包裹绑定 keyVersion。JS string.length 不是 UTF-8 字节长度，必须使用正确编码长度。

本地上限按鸿蒙常量：文档 2,097,152 字节、单条私钥 262,144 字节、主机 5,000 条。序列化明文大小与加密信封传输大小分别核对服务端限制，不因 base64 放大在上传后才报错。

不要自行重写恢复密钥校验算法或改变 hash 输入。开发时从现有 `vault.cpp`、`aad.cpp` 和黄金向量建立互操作 fixture，逐字节验证；新产品名称不改变已部署密码学命名空间。

## 7. API 与同步状态机

生产基址可配置但必须 HTTPS；调试 localhost 例外只限开发环境。协议路径以源码 `docs/api-v1.md` 为基准：auth、me、devices、vault、sync/document、sync/revisions。

后端策略优先复用鸿蒙正在使用的服务与账号体系。参考项目设计曾指向 `G:\code\ssh-tool-server`，本次没有检查该服务的代码、运行状态或线上配置，因此“复用部署”需在 M0/M4 以契约测试确认，不能直接假定历史路径和接口部署仍一致。

主要状态：signed_out、disabled、locked、idle、syncing、synced、offline、conflict、error、auth_error。账号已登录不代表 Vault 已解锁；网络在线不代表所有本地变更已上传。

首次同步流程：

1. 登录并获得设备绑定 token。
2. HEAD 同步文档；区分 VAULT_NOT_FOUND 与 SYNC_DOCUMENT_NOT_FOUND。
3. 创建或解锁保险库；云端存在数据时先下载并生成合并预览。
4. 解密、验证 schema/引用/大小，形成 base/local/remote 合并。
5. 无冲突则事务保存本地投影，提交带 If-Match 的加密新文档。
6. 收到成功 revision 后更新 base/outbox 与显示时间；失败不把未上传标为成功。

revision 为十进制字符串，不能转 JS number，避免超过 2^53 的精度丢失。ETag 形如 `"revision-123"`；首次创建使用 `"revision-0"`。

要求幂等的写请求生成 UUID；重试同一业务请求时复用原 key 与完全相同的请求体/密文，不能重新生成 nonce 后仍使用旧 key。重新合并是新业务请求，必须新 key。

修改后默认 3s 防抖；前台恢复、联网恢复、手动刷新触发检查，后台轮询按服务限制设置。429 遵守 Retry-After，5xx/网络故障退避；401 刷新失败转登录，不删除本地配置。

## 8. 合并、删除与冲突

以稳定 ID 对齐 base/local/remote。一边未改则采用另一边；同字段不同修改、同 ID 双新增、删除与修改相撞均进入冲突。服务器时间戳只用于显示，不作为唯一胜负依据。

UI 展示对象、字段、两侧来源；秘密只显示“已更改/已移除”，用户选择本机或云端，不能在 diff 展示明文。冲突解决前保留本地数据、base 和待上传修改的加密快照。

全量文档中的缺失项只有在成功解密、完整解析、通过引用验证后才能视为删除。下载超时、损坏、部分解析或未知版本不能触发批量删库。事务导入保留本机专有列，删除共享对象时处理引用。

多个窗口共用一个同步协调器和 refresh mutex，禁止各自独立 PUT 同一文档。离线修改允许积累，但不能把旧 HTTP 请求无限串行重放；应合并为最新本地状态后再进行三方合并。

## 9. 敏感同步关闭、轮换与恢复

关闭密码/私钥同步需要清理当前云文档及服务端保留历史，按现有 `/vault/rotate` 事务完成 keyVersion 更新、密钥信封和新文档提交，更新恢复密钥，并展示需要保存的新恢复材料。

遇到 revision 冲突先重新合并，网络失败维持“清理待完成”，不能显示成功。旧离线设备可能持有旧密钥/历史明文，不能承诺远程擦除其本地副本；重新上线必须识别 keyVersion 与最新敏感开关，防止旧缓存重新上传。

修改账号密码不自动等于更新 Vault 包裹密码。流程必须独立处理账号改密、Vault rewrap 和必要重新认证，任何中途失败都保留可恢复路径。

恢复密钥仅在创建/轮换时显式展示；不写日志、不自动复制、不进入普通配置导出。历史恢复先预览差异并生成新 revision，不覆盖本机未同步修改。

## 10. 协议扩展路线

### 阶段 A：保持现有格式

首版采用兼容 DTO，确保基础配置与可用敏感字段互通；Windows 新功能存本机。绝不在 v1 中增加 host.groupId、identityId 或 workspace。

### 阶段 B：完整跨端能力

升级目标包括主机归属、身份引用与私钥完整读写。需要制定版本能力协商、双方 schema 迁移、旧客户端只读/阻止覆盖方案，以及服务端是否支持多文档/版本约束的验证。

不能仅把 schemaVersion 改为 2 就上线：旧端的严格校验、全量写回和潜在字段丢失必须先解决。是否沿用单文档或增加独立文档空间由跨端专项确定；本轮不修改外部项目。

## 11. 兼容验收门槛

- 同一固定向量在 Windows 与鸿蒙得到一致的 KDF、AAD、密文、hash 与恢复密钥结果。
- Windows→云→鸿蒙→云→Windows 多轮往返，主机/转发/分组不丢字段。
- 私钥缺口修复前完整互通开关不可误开放；未知数据必须保留或停止写入。
- 并发刷新、token 轮换、409、429、离线恢复、损坏信封、超大文档、旧 keyVersion、账号切换、删除冲突均有测试。
- 本地磁盘、同步缓存、日志、诊断包和 renderer 持久化存储不出现测试用明文秘密。
