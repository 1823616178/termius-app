# 动效性能检测与强制开启 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 默认按设备能力和真实帧率决定完整／轻量／关闭动效，并允许用户强制开启。

**Architecture:** 独立纯函数负责判定，workbench 统一保存偏好和应用根节点状态；首页剑境只报告真实渲染帧率。设置页显示判定结果，CSS 与 WebGL 使用同一实际档位。

**Tech Stack:** Vue 3、TypeScript、Three.js、Electron、Vitest、Playwright。

**执行约束：** 当前工作区有大量用户未提交改动，本次不隔离到缺少这些改动的工作树，不全量格式化或提交。用户未要求本次提交；每个任务通过验证即可，不执行计划模板中的自动提交。

---

### Task 1: 可测试的动效性能判定

**Files:**

- Create: `src/renderer/src/services/motion-performance.ts`
- Test: `tests/unit/motion-performance.test.ts`

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  assessMotionCapability,
  resolveMotionPreference,
  sampleMotionFrame
} from '../../src/renderer/src/services/motion-performance'

it.each([
  [{ webgl2Supported: true, hardwareConcurrency: 16, deviceMemory: 16 }, 'full'],
  [{ webgl2Supported: true, hardwareConcurrency: 4, deviceMemory: 16 }, 'light'],
  [{ webgl2Supported: true, hardwareConcurrency: 2, deviceMemory: 16 }, 'off'],
  [{ webgl2Supported: true, hardwareConcurrency: 16, renderer: 'ANGLE (SwiftShader)' }, 'off'],
  [{ webgl2Supported: false, hardwareConcurrency: 16 }, 'off']
])('evaluates real capability inputs', (input, tier) => {
  expect(assessMotionCapability(input).tier).toBe(tier)
})

it('allows full to override weak hardware and reduced motion', () => {
  const capability = assessMotionCapability({ webgl2Supported: false, reducedMotion: true })
  expect(resolveMotionPreference('full', capability).tier).toBe('full')
  expect(resolveMotionPreference('auto', capability).tier).toBe('off')
  expect(resolveMotionPreference('off', capability).tier).toBe('off')
})

it('requires two slow samples and never upgrades a forced tier', () => {
  expect(sampleMotionFrame({ tier: 'full', fps: 30, slowWindows: 0 }).tier).toBe('full')
  expect(sampleMotionFrame({ tier: 'full', fps: 30, slowWindows: 1 }).tier).toBe('light')
  expect(sampleMotionFrame({ tier: 'light', fps: 20, slowWindows: 1 }).tier).toBe('off')
  expect(sampleMotionFrame({ tier: 'full', fps: 60, slowWindows: 1 }).slowWindows).toBe(0)
})
```

- [x] **Step 2: 验证测试先失败**

Run: `yarn vitest run tests/unit/motion-performance.test.ts`
Expected: FAIL，服务模块尚不存在。

- [x] **Step 3: 实现纯判定与受控图形探测**

```ts
export type MotionTier = 'full' | 'light' | 'off'
export type MotionPreference = 'auto' | MotionTier
export interface MotionEnvironment {
  webgl2Supported: boolean
  renderer?: string
  hardwareConcurrency?: number
  deviceMemory?: number
  reducedMotion?: boolean
}
export interface MotionCapability {
  tier: MotionTier
  reason: string
  webgl2Supported: boolean
  softwareRenderer: boolean
  cpuCores: number | null
  memoryGb: number | null
}
export interface MotionFrameSample {
  tier: MotionTier
  fps: number
  slowWindows: number
  reason: string
}
export const REDUCED_MOTION_REASON = '系统已开启减少动态效果，已自动关闭'
export function parseMotionPreference(value: string | null): MotionPreference {
  return value === 'full' || value === 'light' || value === 'off' ? value : 'auto'
}
export function isSoftwareRenderer(renderer: string): boolean {
  return /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(renderer)
}
function optionalPositiveNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
export function assessMotionCapability(input: MotionEnvironment): MotionCapability {
  const cpuCores = optionalPositiveNumber(input.hardwareConcurrency)
  const memoryGb = optionalPositiveNumber(input.deviceMemory)
  const softwareRenderer = isSoftwareRenderer(input.renderer ?? '')
  const base = { webgl2Supported: input.webgl2Supported, softwareRenderer, cpuCores, memoryGb }
  if (input.reducedMotion) return { ...base, tier: 'off', reason: REDUCED_MOTION_REASON }
  if (!input.webgl2Supported) {
    return { ...base, tier: 'off', reason: '未检测到可用的 WebGL2，已关闭 3D 动效' }
  }
  if (softwareRenderer) {
    return { ...base, tier: 'off', reason: '检测到软件渲染器，已关闭 3D 动效以节省资源' }
  }
  if ((cpuCores !== null && cpuCores <= 2) || (memoryGb !== null && memoryGb <= 2)) {
    return { ...base, tier: 'off', reason: '设备处理器或内存资源不足，已自动关闭动效' }
  }
  if ((cpuCores !== null && cpuCores <= 4) || (memoryGb !== null && memoryGb <= 4)) {
    return { ...base, tier: 'light', reason: '设备资源有限，已自动启用轻量动效' }
  }
  return { ...base, tier: 'full', reason: '图形与设备性能初检通过，将按实际帧率调整' }
}
export function resolveMotionPreference(
  preference: MotionPreference,
  capability: MotionCapability
): Pick<MotionFrameSample, 'tier' | 'reason'> {
  if (preference === 'full') return { tier: 'full', reason: '已强制开启完整动效，不会自动降级' }
  if (preference === 'light') return { tier: 'light', reason: '已手动选择轻量动效，不会自动降级' }
  if (preference === 'off') return { tier: 'off', reason: '已手动关闭动效' }
  return { tier: capability.tier, reason: capability.reason }
}
export function sampleMotionFrame(
  input: Pick<MotionFrameSample, 'tier' | 'fps' | 'slowWindows'>
): MotionFrameSample {
  const fps = Math.round(Math.max(0, input.fps))
  if (input.tier === 'off') return { tier: 'off', fps, slowWindows: 0, reason: '动效已关闭' }
  const nextTier =
    input.tier === 'full' && fps < 42 ? 'light' : input.tier === 'light' && fps < 24 ? 'off' : null
  if (!nextTier) {
    return { tier: input.tier, fps, slowWindows: 0, reason: `实测 ${fps} fps，运行正常` }
  }
  const slowWindows = input.slowWindows + 1
  if (slowWindows < 2) {
    return { tier: input.tier, fps, slowWindows, reason: `实测 ${fps} fps，继续观察性能` }
  }
  return {
    tier: nextTier,
    fps,
    slowWindows: 0,
    reason: nextTier === 'light' ? '实测帧率持续偏低，已切换轻量动效' : '实测帧率持续偏低，已关闭动效'
  }
}
export function probeMotionGraphics(
  canvas: HTMLCanvasElement
): Pick<MotionEnvironment, 'webgl2Supported' | 'renderer'> {
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' })
    if (!gl) return { webgl2Supported: false }
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_RENDERER_WEBGL: number
    } | null
    const renderer = String(gl.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER))
    return { webgl2Supported: true, renderer }
  } catch {
    return { webgl2Supported: false }
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
```

浏览器探测只读取 `WEBGL_debug_renderer_info`；不可用时保留通用 renderer，不声称未知显卡为软件渲染。所有纯判定不访问 DOM。

- [x] **Step 4: 验证服务测试通过**

Run: `yarn vitest run tests/unit/motion-performance.test.ts`
Expected: 全部通过，包括未知硬件参数不惩罚、软件显卡变体、降低而不自动回升。

### Task 2: 统一偏好、能力检测和帧率反馈

**Files:**

- Modify: `src/renderer/src/stores/workbench.ts:1-42,109-121,328-423,dispose`
- Modify: `src/renderer/src/App.vue:21-55,123-131`
- Test: `tests/e2e/workbench.spec.ts:181-297`

- [x] **Step 1: 扩展桌面用例，先验证旧实现缺少自动／强制行为**

```ts
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2, configurable: true })
})
await page.reload()
await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
await page.getByRole('button', { name: '设置', exact: true }).click()
await page.getByRole('combobox', { name: '动效与性能档' }).click()
await page.getByRole('option', { name: '强制开启', exact: true }).click()
await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
await page.reload()
await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
await page.emulateMedia({ reducedMotion: 'reduce' })
await page.getByRole('button', { name: '工作台', exact: true }).click()
await expect(page.locator('[data-variant="welcome"]')).toHaveAttribute('data-ready', 'true')
```

同时增加软件 renderer 自动关闭、自动模式系统减少动态效果、手动关闭后场景释放及重新开启的断言。真实 WebGL 失败重试用例预置 `orbit:motion-tier=full`，确保测试的仍是已有 Three.js 初始化重试，不被前置探测拦截。

- [x] **Step 2: 运行定向桌面测试确认失败**

Run: `yarn build && yarn playwright test workbench.spec.ts --grep "motion performance"`
Expected: 自动档或强制档选项不存在。

- [x] **Step 3: 在 store 中接入**

新增 `motionPreference=ref<MotionPreference>('auto')`、`motionTier=ref<MotionTier>('off')`、能力和原因 ref、`recordMotionFrameRate(fps)`、`motionStatus` computed。读取偏好使用：

```ts
motionPreference.value = parseMotionPreference(localStorage.getItem('orbit:motion-tier'))
```

仅偏好变更或系统减少动态效果事件重新评估；运行时降级保留在当前状态中，主题或高对比度应用不得将其重置。根节点同步：

```ts
document.documentElement.dataset.motion = motionTier.value
document.documentElement.dataset.motionPreference = motionPreference.value
document.documentElement.dataset.motionReason = motionReason.value
```

`App.vue` 监听 `motionPreference` 并保存，单独监听 `highContrast`。`disposeWorkbenchListeners` 同时清理媒体查询监听。

- [x] **Step 4: 验证类型与相关测试**

Run: `yarn typecheck`
Expected: 新偏好和实际档位类型区分正确，无隐式 DOM 扩展类型。

### Task 3: 首页采样、资源释放与强制覆盖 CSS

**Files:**

- Modify: `src/renderer/src/components/OrbitStage3D.vue`
- Modify: `src/renderer/src/components/BorderFlyingSword.vue`
- Modify: `src/renderer/src/pages/WorkspacePage.vue`
- Modify: `src/renderer/src/styles/global.scss`
- Modify: `src/renderer/src/services/card-tilt.ts`（仅当实际档位引用仍成立时无需改动）

- [x] **Step 1: 以端到端断言驱动行为**

运行 Task 2 的定向桌面测试，确认运行时及 reduced-motion 覆盖断言，保留已有 WebGL 恢复断言。

- [x] **Step 2: 在已有 tick 中采样而不增加渲染循环**

欢迎场景每累计约 3 秒真实渲染帧调用 `onFrameRate`；compact、隐藏、暂停、inactive、off 不采样。使用已有 `requestAnimationFrame` 时间戳：

```ts
if (lastRenderTick && props.variant === 'welcome') {
  sampledFrames += 1
  if (now - sampleStarted >= 3000) {
    props.onFrameRate?.((sampledFrames * 1000) / (now - sampleStarted))
    sampleStarted = now
    sampledFrames = 0
  }
}
```

实际实现先渲染再汇总，清理 `stopLoop` 的采样状态。关闭时停止 RAF，`scene.dispose(false)` 释放 Three.js 资源但不主动丢失 canvas 上下文；重新开启沿用现有异步 disposed/canAnimate 检查。不得删除已有 `lastRenderTick`、时间累计、`contextLost` 和 `dispose(releaseContext)` 修复。

- [x] **Step 3: 强制档覆盖减少动态效果**

```scss
@media (prefers-reduced-motion: reduce) {
  :root:not([data-motion-preference='full']) *,
  :root:not([data-motion-preference='full']) *::before,
  :root:not([data-motion-preference='full']) *::after {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
  }
}
```

边框和首页操作按钮的 media 规则同样只在未强制时隐藏。正常自动／手动轻量／关闭行为不变。

- [x] **Step 4: 运行定向测试**

Run: `yarn playwright test workbench.spec.ts --grep "homepage sword realm|sword animation resumes|sword initialization failure|motion performance" --output=test-results/motion-performance`
Expected: 全部通过，页面无 pageerror。

### Task 4: 设置页、文档和端到端验收

**Files:**

- Modify: `src/renderer/src/pages/SettingsPage.vue:18-48,104-108,304-322,797-815`
- Modify: `doc/03-UI-DESIGN-SYSTEM.md:234-246`
- Modify: `doc/02-FUNCTIONAL-SPEC.md:169`
- Modify: `doc/07-IMPLEMENTATION-STATUS.md:17-24`
- Modify: `tests/e2e/workbench.spec.ts:181-297`

- [x] **Step 1: 设置页提供四态选项和真实状态**

```ts
const motionTierOptions = [
  { value: 'auto', label: '自动（推荐）' },
  { value: 'full', label: '强制开启' },
  { value: 'light', label: '轻量' },
  { value: 'off', label: '关闭' }
]
```

绑定 `motionPreference`，新增合规类 `container_settings_motion_body_status` 和 `container_settings_motion_body_description`，显示 `motionStatus.tier`、原因与实测 fps。强制时显示资源占用警告。状态文本说明这是当前设备的启发式检测，不宣传未验证的绝对性能。

- [x] **Step 2: 格式化并运行全量静态及单元检查**

Run: `yarn prettier --write src/renderer/src/services/motion-performance.ts src/renderer/src/stores/workbench.ts src/renderer/src/App.vue src/renderer/src/components/OrbitStage3D.vue src/renderer/src/components/BorderFlyingSword.vue src/renderer/src/pages/WorkspacePage.vue src/renderer/src/pages/SettingsPage.vue src/renderer/src/styles/global.scss tests/unit/motion-performance.test.ts tests/e2e/workbench.spec.ts`
Run: `yarn typecheck && yarn format:check && yarn test && yarn build`
Expected: 全通过；检查是否触及无关文件。

- [x] **Step 3: 实际验证自动、强制、关闭及原剑境回归**

Run: `yarn playwright test workbench.spec.ts --grep "homepage sword realm|sword animation resumes|sword initialization failure|motion performance" --output=test-results/motion-performance`
Expected: 全部通过，读取设置和剑境截图；验证刷新持久化、系统减少动态效果覆盖、WebGL 失败重试。

- [x] **Step 4: 更新真实验证记录和交付状态**

仅记录实际通过的检查。没有执行安装包打包、安装／卸载或所有业务页面视觉矩阵时明确说明。检查 `git status --short` 和定向 diff，保留所有用户改动，不提交、不覆盖安装器。

## 独立审查后的修正记录

- 启动顺序：`OrbitStage3D.vue` 不再把缺失的 `data-motion` 当成完整档。`motion-performance.ts` 的 `parseMotionTier` 仅接受明确的 full/light，未初始化或非法值保持 off，避免子组件 mounted 时提前导入 Three.js。
- 采样副作用：`applyMotionPreferences` 只在根属性实际变化时写入；健康 FPS 采样不再触发同值属性 MutationObserver、场景选项同步和强制 canvas resize。真实 canvas setter 监测先复现一次采样额外写入 4 次，再验证修复后无额外写入。
- 重检与代次：设置页新增“重新检测动效性能”按钮；每次偏好刷新增加 `data-motion-generation`，组件在新代次的第一真实渲染帧重新采样，避免混用手动档或旧检测周期。
- 清理异常：临时 WebGL context 的释放操作有独立异常保护，单测模拟 `loseContext()` 抛错，确认不会改变成功探测结果。
- 真实生命周期：桌面用例监测 WebGL draw/delete 调用，验证关闭后资源删除、绘制停止、context 保留及重新开启后的真实绘制；WebGL 恢复后在点击任何控制按钮前连续比较真实像素。手动轻量档也经过两个以上慢采样窗口验证，不会被自动关闭。
- 保持边界：没有修改用户的剑阵、主剑造型、托盘文案或其他未提交业务改动，没有提交或重新打包。
