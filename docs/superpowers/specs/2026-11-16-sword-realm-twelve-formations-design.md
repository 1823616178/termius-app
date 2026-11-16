# 剑境定稿设计：去酒碗 · 葫芦动效 · 十二式剑阵

日期：2026-11-16
状态：**定稿 · 已与实现同步**（本文档描述当前代码的实际行为，非待评审提案）
范围：`sword-motion.ts` / `sword-models.ts` / `sword-scene.ts` / `OrbitStage3D.vue` / `WorkspacePage.vue` / `tests/unit/sword-motion.test.ts` / `tests/e2e/workbench.spec.ts`

> 本文取代早前的"十式"提案稿。十二式以用户指定的小说剑阵为名，已全部实现并通过单元 / e2e / 真实 Electron 截图验证。

---

## 0. 目标与原则（已落地）

1. **移除酒碗**：首页不再出现酒盏 / 酒液 / 涟漪 / 酒滴；右侧留白交还剑阵与星空。
2. **葫芦动效**：葫芦升级为"酒仙养剑"动作语言，与剑阵同呼吸、同高潮。
3. **十二式整体剑阵**：60s 大循环、每式 5s、相邻 0.9s 交叉过渡＋"收心一息"pinch，衔接平滑无跳变；右侧阵印 rail 可巡览 / 跳转。
4. **保留已验收资产**：插剑序章（3.8s）、地裂、碎屑、冲击波、主剑轩辕造型（汉剑直刃短锋）、边框飞剑、主题联动、性能分档、降级路径，时序不变。
5. **性能不劣化**：实例上限不变（full 144 / light 32 / compact 12）；无每帧几何重建；剑丝 / 剑网连线仅 1 个 draw call。

---

## 1. 酒碗移除（已落地清单）

| 文件 | 动作 |
| --- | --- |
| `sword-models.ts` | 删除 `WineBowlModel` 与 `createWineBowl()`。**保留 `createWineSeal()`**（"酒"字印贴葫芦）。 |
| `sword-scene.ts` | 删除酒碗导入 / 创建 / 定位 / `visible` / 整块 render 动画；原 `wineLight` 改名 `gourdLight` 并跟随葫芦。 |
| `sword-motion.ts` | 删除 `StageState.wineReveal`；新增葫芦字段（§2）。 |
| `ui-themes.ts` / `WorkspacePage.vue` | `--color-scene-wine / -soft` 琥珀 token 保留（语义=葫芦酒色），无 CSS churn。 |
| 测试 | 无单元引用酒碗；e2e 仅截图变化。 |

---

## 2. 葫芦动效（酒仙养剑）

### 2.1 `GourdModel`（`createGourd()` 返回）

`group / body / cork / cord / seal / sealMaterial / vapor / vaporMaterial / pourRibbon / pourMaterial`。
- `vapor`：24 点预分配 `Points`（DynamicDrawUsage），加法混合，自塞口上升。
- `pourRibbon`：预建 Tube 弧带 `(0,1.2,0)→(0.5,1.35,0.1)→(1.1,1.0,0.2)→(1.6,0.5,0.25)`，半径 0.035；仅动画 opacity / rotation / scale，**不每帧重建**。

### 2.2 StageState 葫芦字段（`sampleStageState`）

| 字段 | 公式 |
| --- | --- |
| `gourdReveal` | `easeOutCubic(clamp01((introT-1.05)/1.05))` |
| `gourdPour` | `clamp01(pulseEnvelope(gt,1,4) + gather*0.3 + 0.08 + 0.06*sin(gt*0.7))` |
| `gourdTilt` | `sin(gt*0.9)*0.10 + gourdPour*0.55` |
| `corkLift` | `gourdPour*0.12 + pulse*0.05` |
| `vaporIntensity` | `gourdReveal*(0.25 + gourdPour*0.75 + pulse*0.4)` |
| `gourdGlow` | `6 + gather*6 + pulse*8` |

> `gourdPour` 只在诛仙高潮窗口（gt 1–4）显著倾身斟酒，平时微酌（≈0.08–0.14），避免常年动作噪声。

### 2.3 场景驱动（`sword-scene.ts` render）

| 动作 | 实现 |
| --- | --- |
| 入场·升坛 | `y = -0.7 + (1-reveal)*-0.95`；`scale = 0.54*(0.35+reveal*0.65)` |
| 悬浮·呼吸 | `y += sin(time*1.3)*0.07`；`body.scale = 1+sin(time*1.3+0.6)*0.02` |
| 巡行·漂移 | `x = -1.25+sin(cycle*0.5)*0.12`；`z = 0.9+cos(cycle*0.5)*0.08` |
| 斟酌·倾斜 | `rot = (0.06+pour*0.12, -0.24+sin(time*0.6)*0.16, 0.08+gourdTilt)` |
| 启塞 | `cork.y = 1.11+corkLift`；`cork.rot.z = pour*0.3` |
| 酒气 | 24 点 `life=fract(time*0.35+v/24)`，`y=1.2+life*1.1`，横摆 `sin/cos(time*…)*0.06*life`；`opacity=intensity*(light?0.25:0.5)`；`size=0.04+intensity*0.03`；`visible=!compact&&intensity>0.02` |
| 斟酒光带 | `visible=!compact&&pour>0.05`；`opacity=pour*0.45`；`rot.z=sin(time*1.2)*0.05`；`scale=0.8+pour*0.4` |
| 绳摆 | `cord.rot.z = sin(time*1.6+1)*0.06 + pour*0.10` |
| 印发光 | `sealMaterial.color = white→brightGold(pulse*0.6)`；`opacity=0.75+gather*0.25` |
| 暖光随形 | `gourdLight.position` 跟随葫芦；`intensity=gourdGlow` |

---

## 3. 十二式总览（`FORMATIONS`，60s 大循环）

每式窗口 `[m*5, (m+1)*5)`。`link` 决定剑丝/剑网连线生成器，`linkColor` 0=金 1=玉 2=朱。

| # | 名称 | 副标 | 剪影 | 朝向 | 色彩倾向 | link |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 诛仙剑阵 | 四门诛戮陷绝 · 杀意朝心 | 四角密集剑簇＋四门朱线朝心 | 指向剑心 | 朱+金，门脉冲 | gates(朱) |
| 2 | 大庚剑阵 | 庚金剑丝 · 隐匿穿空 | 12 条横贯剑丝，剑沿丝滑行 | 沿丝切线 | 高金、细长剑拉伸 | threads(金) |
| 3 | 春黎剑阵 | 幻术为基 · 春影重叠 | 五臂花瓣螺旋＋幻影偏移 | 径向+切线混合 | 高玉（春绿） | none |
| 4 | 青蟠剑阵 | 青元高阶 · 蟠龙绕柱 | 单条三圈蟠龙螺旋柱 | 螺旋切线偏上 | 高玉 | none |
| 5 | 小千剑阵 | 千剑层叠 · 六重呼吸 | 六层同心环逐层呼吸 | 环切线 | 层奇偶金/玉 | none |
| 6 | 大千剑阵 | 大千世界 · 三环浑天 | 三球壳绕异轴旋转（浑天仪） | 旋转切线 | 金主玉辅 | none |
| 7 | 恒山剑阵 | 七人一队 · 攻守相济 | ~20 个七剑罗sette 小队 | 攻=向外/守=向内 | 钢青+玉 | none |
| 8 | 六脉神剑阵 | 六脉剑气 · 依次奔涌 | 六辐条＋行波脉冲外奔 | 径向向外 | 波前高金 | none |
| 9 | 罗汉剑阵 | 少林罗汉 · 立剑如僧 | 平静立剑环（如立僧） | 近竖直微摆 | 铜金、低能量 | none |
| 10 | 九宫八卦剑阵 | 九宫方位 · 交织剑网 | 3×3 宫格剑簇＋经纬对角剑网 | 朝邻宫+切线 | 宫奇偶金/玉 | grid(玉) |
| 11 | 五行连环剑阵 | 五行相生 · 连环合击 | 五角五元素簇＋相生环 | 朝下一元素 | 五行各自配色 | ring(金) |
| 12 | 五九剑阵 | 四五长剑 · 旋盘不息 | 45 亮剑旋盘＋外圈暗回声 | 盘切线 | 高金 | none |

---

## 4. 每式位置 / 朝向 / 能量（实现数学）

记 `N=count`、`i=index`、`gt=time%60`、`rot=gt*0.6`、`HEART=(0.9,0.26)`、`seed/fib/rotateAround` 为模块内确定性helper。

- **M1 诛仙**：`gate=i%4`；`gateCenter(gate)=HEART+(cos(a)*2.5, sin(a)*2.0, -0.6)`，`a=gate*TAU/4+TAU/8+rot*0.12`；簇偏移 `fib(floor(i/4),ceil(N/4))*0.5`；朝向=朝心；`fired=floor(gt*1.2)%4===gate` → energy/stretch/gold/seal 脉冲。
- **M2 大庚**：`k=i%12`；`s=fract(floor(i/12)/ceil(N/12)+gt*0.06)`；`pos=lerp(threadEnds(k), s)`；朝向=丝方向；`stretch=1.6`、`scale=0.16`、`gold=0.8`；shimmer=`sin(gt*3+k)`。
- **M3 春黎**：`arm=i%5`、`t=floor(i/5)/per`；`a=arm*TAU/5+t*2.4+rot*0.3`、`r=0.5+t*2.4`；幻影偏移 `ghost=sin(gt*2+i)*0.12` 垂直于径向；`jade=0.7`。
- **M4 青蟠**：`t=i/N`；`a=t*TAU*3.2+rot*0.5`；`r=1.5+0.35*sin(t*TAU*2+gt*1.5)`；`y=-1.4+t*3.2`；朝向≈`(-sin a,0.9,cos a*0.5)`；`jade=0.8`。
- **M5 小千**：`layer=i%6`；`a=(j/per)*TAU+rot*(layer%2?-0.4:0.4)+layer*0.2`；`r=0.7+layer*0.42+sin(gt*1.2-layer*0.5)*0.12`；`z=-0.9-layer*0.15`；层奇偶金/玉。
- **M6 大千**：`shell=i%3`；`fib` 球点 ×`R=1.2+shell*0.8`，绕轴 `[0,1,0]/[.7,.7,0]/[0,.6,.8]` 旋转 `rot*(0.25+shell*0.12)`（Rodrigues）；朝向=`cross(axis, spun)`。
- **M7 恒山**：`squad=floor(i/7)`、`member=i%7`；队心轨道 `R=2.6`；`mode=smoothstep(-0.2,0.2,sin(gt*0.8+squad))`；罗sette 半径 `lerp(0.24,0.42,mode)`；朝向=守(向内)→攻(向外) 按 mode 混合。
- **M8 六脉**：`mer=i%6`、`s=floor(i/6)/per`；`a=mer*TAU/6+rot*0.1`；`wave=fract(gt*0.5-mer/6)`；`g=exp(-((s-wave)*6)^2)`；`r=0.4+s*3.0`；`stretch=1+1.2g`、`gold=0.4+0.6g`。
- **M9 罗汉**：`a=(i/N)*TAU+rot*0.08`、`R=2.2`；`y=HEART.y+sin(a)*R*0.35-0.2`；朝向≈`(sway,1,sway*0.5)`；`tap=floor(gt*0.5)%N===i` 微脉冲；低能量。
- **M10 九宫**：`cell=i%9`；`cellCenter=(HEART.x+(cell%3-1)*1.5, HEART.y+(floor(cell/3)-1)*1.2, -1.0)`；簇 `fib*0.4` 绕 z 旋转 `rot*0.4+cell`；朝向=朝邻宫+切线 0.4 混合。
- **M11 五行**：`elem=i%5`；`elemCenter` 五角 `R=2.0`、`a=elem*TAU/5-TAU/4+rot*0.15`；簇 `fib*0.45`；朝向=朝下一元素；`active=floor(gt*0.6)%5===elem`；配色表 `[[.8,.1,0],[.15,.8,0],[.1,.2,0],[.2,.05,.7],[.5,.15,.2]]`（金木水火土）。
- **M12 五九**：`i<45` 亮盘 `a=(i/45)*TAU+rot*0.9`、`r=1.6+((i%5)%2)*0.2`、`gold=0.8`；其余外圈暗回声 `R=3.0`、`scale=0.1`、低能量。

每式输出 `SwordPose{position,direction,scale,glow,stretch,energy,gold,jade,seal}`。

---

## 5. 调度、过渡与可控性

### 5.1 大循环与交叉过渡
- `LOOP_SECONDS=60`、`MOVEMENT_SECONDS=5`、`CROSS=0.45`（边界半宽）。
- `formationAt(gt)` → `{index, local, fade, from}`：`local<0.45` 时为上一式→本式的尾段（`from=prev`，`fade=smoothstep(4.55,5.45,local+5)`）；`local>4.55` 时为本式→下一式（`from=index`）；其余 `fade=0`。保证跨边界连续。
- `sampleSwordPose`：`blendPose(a,b,fade,pinch)`，`pinch=sin(fade*π)*0.16`；位置向 HEART 收 `(1-pinch)`（z 收 `1-pinch*0.5`），`glow+=pinch*0.6` → "收心一息"的得体过渡。
- 内部旋转统一 `rot=gt*0.6`，跨式不重置。

### 5.2 高潮权重（`sampleFormationWeights`）
- `gather = smoothstep(0.5,2,gt)*(1-smoothstep(4,5,gt))`（诛仙窗口）。
- `lotus = smoothstep(10,11,gt)*(1-smoothstep(14,15,gt))`（春黎）。
- `volley = smoothstep(35,36,gt)*(1-smoothstep(39,40,gt))`（六脉）。
- `pulsePrimary = pulseEnvelope(gt,1,3)`；`pulseSecondary = pulseEnvelope(gt,2.5,4.2,0.76)`；`pulse=max`。
- `vortex = gather`；`phase = gt/60`；`climaxShockwaveA/B = pulsePrimary/pulseSecondary`。
- `phaseLabel`：序章内沿用"开阵启封·天剑破空/裂地渊鸣/万剑分身/凌虚归阵"；否则 `名称 · 副标`。

### 5.3 按钮与 rail 语义
- `重展剑境` → `replayIntro()`：elapsed/intro 归零，重播序章。
- `即刻归宗` → `jumpToClimax()`：`intro=INTRO`、`elapsed=2`（直落诛仙高潮）＋triggerPulse。
- rail 点击 → `jumpToFormation(i)`：`intro=INTRO`、`elapsed=i*5+2.5`。
- `OrbitStage3D` 新增 `formation` 事件与 `formationIndex()`；`WorkspacePage` 以 `swordFormationIndex` 驱动 rail 高亮与主标题 `scene-name`。

---

## 6. 剑丝 / 剑网连线（单 draw call）

- `LINK_SEGMENT_CAPACITY=48`；预分配 `LineSegments`（position+color，DynamicDrawUsage），加法混合、`depthWrite=false`。
- `sampleFormationLinks(gt, outPos, outWeights, outColorIdx)` 返回段数；仅 `full && !compact && count>0` 可见。
- 生成器：gates=4（门心→心）、threads=12（weight*0.6）、grid=14（6 横+6 纵+2 对角）、ring=5（weight*0.8）。
- 过渡期同时输出主导式 `(1-fade)` 与邻式 `fade` 两组，顶点色=palette[colorIdx]*weight（加法下淡出=趋黑），`setDrawRange(0,count*2)`；`opacity=0.4+pulse*0.3`。

---

## 7. 阵印 rail（可见可控）

- `WorkspacePage` welcome 覆盖层右侧竖排 12 格印（`nav.container_workspace_welcome_body_formrail`，top148/right38）。
- 每格 `:class="c('container_workspace_welcome_body_formseal', 'rail-'+index)"`（满足语义类+实例类 guard），文本=序号；`data-name` 经 `::after` 在 hover/active 时左展式名；`data-active` 朱边框；`aria-label/aria-current` 完备。
- 隐藏条件：`data-motion=off`、reduced-motion、`max-width:900px`、`max-height:560px`。
- 主标题 `scene-name` 动态=`FORMATIONS[swordFormationIndex].name`；`scene-state`=phaseLabel。

---

## 8. 实例配色与性能降级

- 实例色=`steel.lerp(jade,pose.jade).lerp(gold,pose.gold).lerp(seal,pose.seal*0.6)`；pulse→brightGold；error→seal。取代旧的 glow/energy 估色，使每式配色精确可控。
- 十二维纯位置数学，O(N)；无每帧几何/材质重建；连线 1 draw call；vapor 24 点、pourRibbon 预建。
- light：vapor opacity 减半、连线隐藏；compact：葫芦/连线/vapor 隐藏、实例 12；dpr cap、fog、tone mapping 不变；WebGL 失败/reduced/off 沿用 fallback 图与提示。

---

## 9. 测试与验收（已执行）

单元 `sword-motion.test.ts`（10 例）：实例上限+12 式；60s 周期/确定性/有限；十二式顺序命名；边界 ±0.02 位置差 <0.6（过渡连续）；gather 包络；连线段数 4/12/0/14/5 且 weight∈[0,1]；葫芦高潮 pour>0.3 / 平静 <0.3；春黎 lotus>0.9 + 六脉 volley>0.9 且 max stretch>1.4；插剑序章断言不变；全循环有限。
e2e：`即刻归宗`→诛仙；rail 12 格、点第 10 格→九宫八卦剑阵+`data-active`、截图 `sword-jiugong.png`、点回第 1 格→诛仙；上下文丢失恢复→诛仙；缩放/分档/边框飞剑回归。
已执行结果：语义类检查 843 角色通过；full typecheck 通过；生产构建通过；**94 项单元测试全绿**；剑境 e2e 2 例通过；真实 Electron 截图确认诛仙四门+朱线、九宫剑网、插剑序章、1100×700 布局均无酒碗、无裁切、rail 不遮内容。

---

## 10. 验收标准（达成）

1. 任何阶段无酒碗；暖色由葫芦光维持。
2. 葫芦十种可感知动作，高潮呼应剑阵。
3. 十二式依次清晰可辨、过渡平滑；rail 可跳转/自动高亮；主标题联动。
4. 序章/地裂/主剑/边框飞剑/主题/分档/降级回归通过。
5. full 帧率不劣于现状；light/compact 正常降级。
6. 单元+typecheck+构建+e2e 全绿；截图确认剪影与动效。