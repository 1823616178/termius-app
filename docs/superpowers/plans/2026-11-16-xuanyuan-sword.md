# 轩辕剑主剑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将首页主剑升级为可旋转展示的黄金轩辕剑，同时完整保留用户最新剑阵与性能改动。

**Architecture:** 使用独立 `xuanyuan-sword.ts` 模块生成八面宽刃、UV 纹饰和立体剑装；场景仅负责创建模型和主题联动。所有纹理由本地 Canvas 生成，所有其他几何可在 Node 中测试。

**Tech Stack:** Three.js 0.187.0、TypeScript、Vitest、Electron/Playwright。

**Assumptions:** 自动模式下采用程序化黄金圣剑；不修改飞剑阵法、不覆盖用户未提交改动、不新增依赖、不自行提交或推送。

---

### Task 1: 定义可验证的剑身与剑装

**Files:**

- Create: `tests/unit/xuanyuan-sword.test.ts`
- Create: `src/renderer/src/services/xuanyuan-sword.ts`

- [x] 写入几何和模型测试：剑身全宽大于 `0.5`、剑尖高于 `2.35`、前后厚度大于 `0.16`、UV 在 `[0,1]`；护手有真实深度；模型使用纹饰纹理并包含至少五股剑穗。

```ts
const blade = createXuanyuanBladeGeometry()
blade.computeBoundingBox()
expect(blade.boundingBox!.max.x - blade.boundingBox!.min.x).toBeGreaterThan(0.5)
expect(blade.boundingBox!.max.z - blade.boundingBox!.min.z).toBeGreaterThan(0.16)
expect(blade.getAttribute('uv')).toBeDefined()
```

- [x] 运行 `yarn vitest run tests/unit/xuanyuan-sword.test.ts`，确认因模块尚不存在而失败。
- [x] 实现 `createXuanyuanBladeGeometry`：每个截面八个顶点，顺序为中脊、斜面、刃口、背斜面及背面对称顶点；使用非索引三角形、平面法线和按 `(x,y)` 计算的 UV。提供上扬云纹护手几何及模型工厂。
- [x] 再运行上述测试，确认通过；检查几何位置和法线全部为有限数值，并验证主剑三角形预算低于 18,000。
- [x] 审查此任务的 diff；仅在用户要求时创建提交。

### Task 2: 轩辕黄金材质与文化纹饰

**Files:**

- Modify: `src/renderer/src/services/xuanyuan-sword.ts`
- Test: `tests/unit/xuanyuan-sword.test.ts`

- [x] 增加模型材质测试，传入 `new THREE.Texture()` 作为剑光和纹饰纹理，断言 `bladeMaterial.map` 使用纹饰，金属度大于 `0.8`，`tasselGroup.children.length >= 5`。

```ts
const engravingTexture = new THREE.Texture()
const model = createMainSword(new THREE.Texture(), engravingTexture)
expect(model.bladeMaterial.map).toBe(engravingTexture)
expect(model.bladeMaterial.metalness).toBeGreaterThan(0.8)
expect(model.tasselGroup.children.length).toBeGreaterThanOrEqual(5)
```

- [x] 先运行测试并确认对旧接口失败，再实现暖金剑面、亮金刃口、双面贴合几何浮雕、云纹兽面剑格、碧玉剑心、双螺旋缠柄及红穗。
- [x] 实现 `createXuanyuanInscriptionTexture()`，以 512×1024 Canvas 绘制与 UV 对齐的日月星辰、山川和水纹，设置 `SRGBColorSpace`，不读取远程资源。
- [x] 运行模型单测，确认纹理、剑穗和性能预算通过。
- [x] 审查 diff；仅在用户要求时创建提交。

### Task 3: 场景接入与回归验证

**Files:**

- Modify: `src/renderer/src/services/sword-models.ts`
- Modify: `src/renderer/src/services/sword-scene.ts`
- Modify: `doc/03-UI-DESIGN-SYSTEM.md`
- Modify: `doc/07-IMPLEMENTATION-STATUS.md`

- [x] 将旧 `createBladeGeometry`、`createMainSword` 和 `MainSwordModel` 移到独立模块，场景直接导入新模块；保留飞剑、葫芦、酒盏及地裂代码。
- [x] 创建纹饰纹理并传入 `createMainSword(glowTexture, inscriptionTexture)`。主剑默认色调由青灰钢调整为暖金，光辉使用金色；保留主题和错误状态联动。
- [x] 运行 `yarn typecheck && yarn format:check && yarn test && yarn build`，要求全部通过。
- [x] 运行首页剑境、插剑序章和真实终端相关 Playwright 用例，使用独立输出目录保存实际渲染截图。
- [x] 实际读取截图，确认剑尖、剑格、剑穗不被裁切，纹饰在旋转中附着于剑身，场景按钮不被遮挡。
- [x] 更新现有视觉文档中的主剑描述和本次实际验证结果；不写入未运行的检查。
- [x] 检查 `git status`，只报告本任务改动，不覆盖或提交用户的其他工作。

### Task 4: 加长剑刃并保持纹饰比例

**Files:**

- Modify: `src/renderer/src/services/xuanyuan-sword.ts`
- Test: `tests/unit/xuanyuan-sword.test.ts`

- [x] 先把几何断言改为剑尖高于 `3.5`、刃长大于 `4.3`、刃长与宽度比大于 `8`，浮雕跨度大于 `2.8`。

```ts
const blade = createXuanyuanBladeGeometry()
blade.computeBoundingBox()
const bounds = blade.boundingBox!
const length = bounds.max.y - bounds.min.y
const width = bounds.max.x - bounds.min.x
expect(bounds.max.y).toBeGreaterThan(3.5)
expect(length).toBeGreaterThan(4.3)
expect(length / width).toBeGreaterThan(8)
```

- [x] 运行 `yarn vitest run tests/unit/xuanyuan-sword.test.ts`，确认旧剑因剑尖 `2.42`、刃长 `3.14` 而失败。
- [x] 将 `BLADE_TIP` 设为 `3.65`，各剑身截面的 Y 坐标按 `(3.65 - BLADE_BASE) / (2.42 - BLADE_BASE)` 比例延伸，X/Z 尺寸不变。护手、剑柄、场景缩放和阵形均不改。
- [x] 纹饰 Canvas 高度改为 1536；文字位于 Y=0.5/1.12，日轮位于 Y=2.12，星形位于 Y=2.65，浮雕长剑槽延伸至 Y=2.9。日轮和星形的局部半径不放大，避免拉长图案。
- [x] 再运行模型测试及 `yarn typecheck`，确认通过；检查归宗和插剑截图中剑尖、护手、剑穗的边界。
- [x] 运行受影响桌面用例，再执行 `yarn pack:win && yarn release:checksums`，验证新安装包及打包目录运行效果。
- [x] 更新既有设计和验证文档，检查工作区 diff；不自行提交或推送。
