# Sword Realm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time Three.js homepage with a periodic gathering sword formation, a continuously border-flying sword, wine vessels, and a refined ink-gold application theme.

**Architecture:** Keep the existing Vue component API but move WebGL ownership into a disposable scene service and deterministic animation into pure functions. Use one lazily loaded WebGL scene, one lightweight DOM/CSS border sword, CSS ink scenery, and existing motion/theme preferences.

**Tech Stack:** Vue 3, TypeScript, Three.js, SCSS, Canvas textures, Vitest, Electron Playwright.

---

### Task 1: Deterministic sword and border motion

**Files:**
- Create: `src/renderer/src/services/sword-motion.ts`
- Create: `src/renderer/src/services/border-flight.ts`
- Test: `tests/unit/sword-motion.test.ts`
- Test: `tests/unit/border-flight.test.ts`

- [ ] **Step 1: Write failing motion tests**

```ts
import { describe, expect, it } from 'vitest'
import { formationCount, gatheringStrength, sampleSwordPose } from '../../src/renderer/src/services/sword-motion'

describe('sword formation choreography', () => {
  it('uses bounded full and light instance counts', () => {
    expect(formationCount('full', false)).toBe(144)
    expect(formationCount('light', false)).toBe(32)
    expect(formationCount('full', true)).toBe(12)
  })

  it('gathers near the climax and rests at both loop boundaries', () => {
    expect(gatheringStrength(0)).toBe(0)
    expect(gatheringStrength(13)).toBeGreaterThan(0.95)
    expect(gatheringStrength(20)).toBe(0)
  })

  it('is deterministic, finite and periodic', () => {
    const first = sampleSwordPose(7, 144, 1.25)
    const repeated = sampleSwordPose(7, 144, 1.25)
    const nextLoop = sampleSwordPose(7, 144, 21.25)
    expect(first).toEqual(repeated)
    expect(first.position.x).toBeCloseTo(nextLoop.position.x, 8)
    expect(first.position.y).toBeCloseTo(nextLoop.position.y, 8)
    expect(first.position.z).toBeCloseTo(nextLoop.position.z, 8)
    for (const value of [...Object.values(first.position), ...Object.values(first.direction)]) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the motion test and verify failure**

Run: `yarn vitest run tests/unit/sword-motion.test.ts`
Expected: FAIL because `sword-motion.ts` does not exist.

- [ ] **Step 3: Implement the motion API**

Export `Vec3`, `SwordPose`, `LOOP_SECONDS = 20`, `clamp01`, `smoothstep`, `formationCount(tier, compact)`, `gatheringStrength(time)`, and `sampleSwordPose(index, total, time)`. Use seeded ratios from the index, integer angular frequency multiples of `2π / 20`, and a smooth gather envelope that rises over phases 0.42–0.65 and falls over 0.68–0.90. Derive direction by sampling position 16ms later so swords follow their actual trajectory.

- [ ] **Step 4: Write the failing border-path test**

```ts
import { describe, expect, it } from 'vitest'
import { createBorderFlightPath } from '../../src/renderer/src/services/border-flight'

describe('border flight path', () => {
  it('creates a closed rounded rectangle inside the homepage', () => {
    const path = createBorderFlightPath(800, 500, 12, 18)
    expect(path).toContain('M 30 12')
    expect(path).toContain('Q 788 12 788 30')
    expect(path.trim().endsWith('Z')).toBe(true)
  })

  it('clamps invalid dimensions and radius to a visible loop', () => {
    expect(createBorderFlightPath(0, 0, 12, 999)).toBe(createBorderFlightPath(160, 120, 12, 48))
  })
})
```

- [ ] **Step 5: Run the border test, implement, and rerun both**

Run: `yarn vitest run tests/unit/border-flight.test.ts tests/unit/sword-motion.test.ts`
Expected first: FAIL because `border-flight.ts` does not exist. Implement straight segments joined by quadratic corners and clamp width/height/radius/inset. Expected after implementation: 2 files PASS.

- [ ] **Step 6: Commit the tested motion primitives**

```bash
git add src/renderer/src/services/sword-motion.ts src/renderer/src/services/border-flight.ts tests/unit/sword-motion.test.ts tests/unit/border-flight.test.ts
git commit -m "feat: add deterministic sword formation motion"
```

### Task 2: Lazy real 3D scene

**Files:**
- Modify: `package.json`
- Modify: `yarn.lock`
- Create: `src/renderer/src/services/sword-scene.ts`
- Replace: `src/renderer/src/components/OrbitStage3D.vue`

- [ ] **Step 1: Install exact Three.js runtime and type packages**

Run `yarn add three@0.187.0 && yarn add -D @types/three@0.187.0`. Confirm the manifest and lockfile parse. Do not stage unrelated existing manifest hunks.

- [ ] **Step 2: Define the disposable scene contract**

```ts
export interface SwordSceneOptions {
  variant: 'welcome' | 'compact'
  tier: 'full' | 'light'
  state: string
  boost: boolean
  palette: { accentA: string; accentB: string; seal: string; text: string }
}
export interface SwordScene {
  resize(width: number, height: number, dpr: number): void
  setPointer(x: number, y: number): void
  update(options: SwordSceneOptions): void
  render(timeSeconds: number): void
  dispose(): void
}
export function createSwordScene(canvas: HTMLCanvasElement, options: SwordSceneOptions): SwordScene
```

- [ ] **Step 3: Implement the shared models and scene**

Use a merged low-poly sword geometry in `InstancedMesh`, a separate detailed faceted main sword, emissive formation rings, additive glow sprites, deterministic points, and 16 dynamic trails in full mode. Build the gourd with `LatheGeometry`, a canvas `酒` texture, cork and cinnabar tassel. Build the wine bowl with a lathed clay body, amber liquid disk, lip and two animated ripple rings. Hide both vessels in compact mode. Share and dispose all geometries, materials and textures.

- [ ] **Step 4: Connect Vue lifecycle and static fallback**

Dynamically import `createSwordScene` only after mount. Preserve the public props and semantic classes. Start RAF only when active, visible, unpaused and motion is enabled. Observe resize and root theme attributes; render time zero for off/reduced motion. On import or WebGL failure show `orbit-icon.svg` without surfacing an uncaught page error.

- [ ] **Step 5: Verify types and production bundling**

Run: `yarn typecheck && yarn build`
Expected: strict TypeScript, semantic-class checks and all Electron bundles PASS; Three.js appears in a lazily loaded renderer chunk.

- [ ] **Step 6: Commit the 3D engine**

Stage only new scene/component files, the full lockfile, and the dependency-only manifest hunk. Commit with `feat: render immersive three-dimensional sword realm`.

### Task 3: Border sword and homepage composition

**Files:**
- Create: `src/renderer/src/components/BorderFlyingSword.vue`
- Modify: `src/renderer/src/pages/WorkspacePage.vue`

- [ ] **Step 1: Implement one semantic DOM flying sword**

Create blade, ridge, guard, grip and tassel elements with five-part classes. Set the generated rounded path as `offset-path`, animate `offset-distance` from 0% to 100% over 16 seconds, use `offset-rotate: auto`, and add a fading sword-qi pseudo-element. Disable animation under off/reduced motion and update the path with `ResizeObserver`.

- [ ] **Step 2: Recompose the welcome template**

Keep the existing heading `让连接，井然有序。`, descriptions and both business buttons. Add the full-size stage, separate ink mountain/cloud layers, border sword, a concise `万剑归宗` scene label, and vessel captions that are decorative and hidden from accessibility APIs. Do not add startup waits or click interceptors.

- [ ] **Step 3: Implement responsive safe zones**

Use a two-column composition at widths above 960px and a centered, lower-detail composition below that threshold. Constrain title measure, preserve 32px minimum controls, keep the welcome scrollable at short heights, and set every decorative layer to `pointer-events: none`.

- [ ] **Step 4: Run semantic and desktop checks**

Run: `yarn check:classes && yarn test:e2e`
Expected: semantic registry and existing desktop scenarios PASS, including the unchanged welcome heading and local terminal action.

- [ ] **Step 5: Commit the homepage**

```bash
git add src/renderer/src/components/BorderFlyingSword.vue src/renderer/src/pages/WorkspacePage.vue
git commit -m "feat: compose cinematic sword realm homepage"
```

### Task 4: Theme refinement and documentation

**Files:**
- Modify: `src/renderer/src/styles/_tokens.scss`
- Modify: `src/renderer/src/styles/global.scss`
- Modify: `src/renderer/src/services/ui-themes.ts`
- Modify: `src/renderer/src/components/NavRail.vue`
- Modify: `doc/03-UI-DESIGN-SYSTEM.md`
- Modify: `doc/07-IMPLEMENTATION-STATUS.md`

- [ ] **Step 1: Add shared material variables and theme mappings**

Add wine amber, metal highlight, ink mist and scene glow variables. Derive them from existing primary/secondary colors so all five-element and custom themes affect the scene. Preserve high-contrast text and terminal backgrounds.

- [ ] **Step 2: Refine global surfaces and navigation**

Use subtle metal top edges, layered ink surfaces and short opacity/transform feedback. Do not animate terminal text, add full-window particles, or obscure focus rings.

- [ ] **Step 3: Update actual design and implementation records**

Replace the obsolete abstract-polyhedron and no-persistent-home-scene statements with the approved sword-realm behavior. Record exact implemented counts, motion tiers, fallback and verification results only after commands finish.

- [ ] **Step 4: Run the complete verification suite**

Run: `yarn typecheck && yarn format:check && yarn test && yarn build && yarn test:e2e`
Expected: all commands PASS. Exercise real Electron full/light/off modes, resize, page switches and a real local terminal; capture the homepage screenshot produced by the existing E2E test.

- [ ] **Step 5: Review and commit the remaining scoped files**

Run `git diff --check`, inspect `git diff` and `git status --short`, remove only generated artifacts created by this task that are not deliverables, stage the listed theme/docs files, and commit with `style: refine ink gold theme and sword realm docs`. Finally inspect all commits and the remaining dirty paths to confirm pre-existing user changes were not included.
