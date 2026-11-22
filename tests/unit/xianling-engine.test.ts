import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  ACTS,
  BEATS,
  bladePoint,
  CLEAR,
  DRAW_LENGTH,
  drawPose,
  phaseAt
} from '../../src/renderer/src/services/xianling/draw-motion'
import {
  heroPitch,
  heroRoll,
  updateReference
} from '../../src/renderer/src/services/xianling/grand-formations'
import {
  armoryCrestSvgDataUrl,
  astrolabeSvgDataUrl,
  ATLAS,
  COUNT,
  formatChineseOrdinal,
  glyphSvgDataUrl,
  makeLayout,
  STUDY_PARTS
} from '../../src/renderer/src/services/xianling/layouts'
import { buildArmory } from '../../src/renderer/src/services/xianling/model'
import { score } from '../../src/renderer/src/services/xianling/score'
import { archetype } from '../../src/renderer/src/services/xianling/theatre'

describe('Xianling 24-formation engine', () => {
  it('defines 24 formations across two volumes, 7 dance acts and 5 study parts with bilingual metadata', () => {
    expect(ATLAS).toHaveLength(24)
    expect(COUNT).toBe(10000)
    expect(ACTS).toHaveLength(7)
    expect(BEATS).toHaveLength(16)
    expect(STUDY_PARTS).toHaveLength(5)
    for (const [idx, spec] of ATLAS.entries()) {
      expect(spec.name.trim().length).toBeGreaterThan(0)
      expect(spec.short.trim().length).toBeGreaterThan(0)
      expect(spec.english.trim().length).toBeGreaterThan(0)
      expect(spec.story.trim().length).toBeGreaterThan(0)
      expect(spec.storyEn.trim().length).toBeGreaterThan(0)
      expect(spec.nucleus.trim().length).toBeGreaterThan(0)
      expect(spec.nucleusEn.trim().length).toBeGreaterThan(0)
      expect(spec.spell.trim().length).toBeGreaterThan(0)
      expect(spec.spellEn.trim().length).toBeGreaterThan(0)
      expect(spec.primary).toMatch(/^#[0-9a-f]{6}$/i)
      expect(spec.secondary).toMatch(/^#[0-9a-f]{6}$/i)
      expect(glyphSvgDataUrl(idx, spec.primary)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    }
    expect(astrolabeSvgDataUrl()).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(armoryCrestSvgDataUrl()).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(formatChineseOrdinal(0)).toBe('第 一 阵')
    expect(formatChineseOrdinal(9)).toBe('第 十 阵')
    expect(formatChineseOrdinal(23)).toBe('第 二十四 阵')
  })

  it('generates finite 10,000-sword layouts with unit quaternions for all 24 formations', () => {
    for (let id = 0; id < ATLAS.length; id++) {
      const layout = makeLayout(id)
      expect(layout.p.length).toBe(COUNT * 3)
      expect(layout.q.length).toBe(COUNT * 4)
      expect(layout.col.length).toBe(COUNT * 3)
      expect(layout.v.length).toBe(COUNT * 4)
      for (let i = 0; i < COUNT; i += 97) {
        const o3 = i * 3
        const o4 = i * 4
        expect(Number.isFinite(layout.p[o3]!)).toBe(true)
        expect(Number.isFinite(layout.p[o3 + 1]!)).toBe(true)
        expect(Number.isFinite(layout.p[o3 + 2]!)).toBe(true)
        const qLen = Math.hypot(layout.q[o4]!, layout.q[o4 + 1]!, layout.q[o4 + 2]!, layout.q[o4 + 3]!)
        expect(qLen).toBeCloseTo(1, 3)
        expect(layout.v[o4]!).toBeGreaterThan(0)
      }
      if (id >= 12) {
        updateReference(layout, id - 12, 2.5, 0.4)
        expect(Number.isFinite(layout.p[0]!)).toBe(true)
        expect(Number.isFinite(heroRoll(id - 12))).toBe(true)
        expect(Number.isFinite(heroPitch(id - 12))).toBe(true)
      }
    }
  })

  it('evaluates seven-act sword dance choreography and harmonic chorus scores deterministically', () => {
    const seenActs = new Set<number>()
    for (let t = 0; t <= DRAW_LENGTH; t += 0.25) {
      const pose = drawPose(t)
      seenActs.add(phaseAt(t))
      for (const val of [...pose.sw, ...pose.sh, pose.ax, pose.ay, pose.az, pose.by, pose.bz]) {
        expect(Number.isFinite(val)).toBe(true)
      }
      const tip = bladePoint(t, -3.48)
      expect(tip.every(Number.isFinite)).toBe(true)
    }
    expect(seenActs.size).toBe(7)
    expect(drawPose(CLEAR).open).toBeCloseTo(1, 2)

    expect(score(0, null)).toBeNull()
    for (let id = 0; id < ATLAS.length; id++) {
      const s = score(id, 6.5)
      expect(s).not.toBeNull()
      expect(s!.v).toHaveLength(64)
      expect(Number.isFinite(s!.x)).toBe(true)
      expect(Number.isFinite(s!.y)).toBe(true)
      expect(Number.isFinite(s!.z)).toBe(true)
    }
  })

  it('builds the solid-mesh Xianling sword, scabbard, rotors and faceted flying sword archetypes', () => {
    const armory = buildArmory()
    expect(armory.sword.children.length).toBeGreaterThanOrEqual(4)
    expect(armory.sheath.children.length).toBeGreaterThanOrEqual(6)
    expect(armory.rotors).toHaveLength(2)
    expect(armory.sheath.children.some((c) => c.userData.displayOnly)).toBe(true)
    expect(armory.sword.children.every((c) => c.userData.weaponPart)).toBe(true)

    const fullGeo = archetype(false)
    const simpleGeo = archetype(true)
    expect(fullGeo.instanceCount).toBe(COUNT)
    expect(simpleGeo.instanceCount).toBe(COUNT)
    expect(fullGeo.attributes.position!.count).toBeGreaterThan(simpleGeo.attributes.position!.count)

    fullGeo.dispose()
    simpleGeo.dispose()
    for (const rootObj of [armory.sword, armory.sheath]) {
      rootObj.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
    }
    Object.values(armory.materials).forEach((m) => m.dispose())
  })
})
