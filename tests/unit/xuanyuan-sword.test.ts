import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  createMainSword,
  createXuanyuanBladeGeometry,
  createXuanyuanBladeOrnaments,
  createXuanyuanGuardGeometry
} from '../../src/renderer/src/services/xuanyuan-sword'

function boundsOf(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox()
  return geometry.boundingBox!
}

function disposeModel(model: ReturnType<typeof createMainSword>): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  model.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return
    if ('geometry' in object) geometries.add(object.geometry)
    materials.add(object.material)
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

describe('Xuanyuan hero sword', () => {
  it('uses a broad eight-facet blade with parallel edges and a short point', () => {
    const blade = createXuanyuanBladeGeometry()
    const bounds = boundsOf(blade)
    const bladeWidth = bounds.max.x - bounds.min.x
    const bladeLength = bounds.max.y - bounds.min.y
    expect(bladeWidth).toBeGreaterThan(0.5)
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(0.16)
    expect(bounds.max.y).toBeGreaterThan(3.5)
    expect(bladeLength).toBeGreaterThan(4.3)
    expect(bladeLength / bladeWidth).toBeGreaterThan(8)
    expect(bounds.min.y).toBeCloseTo(-0.72)
    const positions = blade.getAttribute('position')
    const normals = blade.getAttribute('normal')
    const uv = blade.getAttribute('uv')
    expect(positions.count).toBeGreaterThanOrEqual(96)
    expect(normals.count).toBe(positions.count)
    expect(uv.count).toBe(positions.count)
    for (const attribute of [positions, normals, uv]) {
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
    }
    expect(Array.from(uv.array).every((value) => value >= 0 && value <= 1)).toBe(true)

    const halfWidthNear = (lo: number, hi: number): number => {
      let max = 0
      for (let index = 0; index < positions.count; index++) {
        const y = positions.getY(index)
        if (y >= lo && y <= hi) max = Math.max(max, Math.abs(positions.getX(index)))
      }
      return max
    }
    const baseHalfWidth = halfWidthNear(-0.73, -0.71)
    expect(halfWidthNear(2.9, 3.2)).toBeGreaterThan(baseHalfWidth * 0.8)
    expect(halfWidthNear(3.35, 3.45)).toBeLessThan(baseHalfWidth * 0.5)
    expect(halfWidthNear(3.6, 3.66)).toBeLessThan(0.01)
    blade.dispose()
  })

  it('builds a pierced cloud-flame guard sweeping back toward the grip', () => {
    const guard = createXuanyuanGuardGeometry()
    const bounds = boundsOf(guard)
    expect(bounds.max.x).toBeGreaterThan(0.45)
    expect(bounds.max.x).toBeLessThan(0.62)
    expect(bounds.max.y - bounds.min.y).toBeGreaterThan(0.15)
    expect(bounds.max.y - bounds.min.y).toBeGreaterThan(0.8)
    expect(guard.parameters.shapes).toBeInstanceOf(THREE.Shape)
    expect(bounds.max.z - bounds.min.z).toBeGreaterThan(0.08)
    guard.dispose()
  })

  it('conforms celestial and mountain reliefs to both blade faces', () => {
    const grooveMaterial = new THREE.MeshStandardMaterial()
    const inlayMaterial = new THREE.MeshStandardMaterial()
    const ornaments = createXuanyuanBladeOrnaments(grooveMaterial, inlayMaterial)
    expect(ornaments.children).toHaveLength(2)
    const bounds = new THREE.Box3()
    ornaments.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.computeBoundingBox()
      bounds.union(object.geometry.boundingBox!)
      expect(Array.from(object.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true)
    })
    expect(bounds.max.y - bounds.min.y).toBeGreaterThan(2.8)
    expect(bounds.max.z).toBeGreaterThan(0.07)
    expect(bounds.min.z).toBeLessThan(-0.07)
    ornaments.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
    })
    grooveMaterial.dispose()
    inlayMaterial.dispose()
  })

  it('combines engraved golden steel, a luminous halo and layered silk tassels', () => {
    const glowTexture = new THREE.Texture()
    const engravingTexture = new THREE.Texture()
    const model = createMainSword(glowTexture, engravingTexture)
    expect(model.bladeMaterial.map).toBe(engravingTexture)
    expect(model.bladeMaterial.emissiveMap).toBe(engravingTexture)
    expect(model.bladeMaterial.metalness).toBeGreaterThan(0.8)
    expect(model.silverMaterial.metalness).toBeGreaterThan(0.85)
    expect(new THREE.Box3().setFromObject(model.scabbard).max.y).toBeGreaterThan(4.4)
    expect(model.glow.material.map).toBe(glowTexture)
    expect(model.group.getObjectByName('XuanyuanBladeOrnaments')).toBeDefined()
    expect(model.tasselGroup.children.length).toBeGreaterThanOrEqual(5)
    let triangles = 0
    model.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const geometry = object.geometry
      triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3
    })
    expect(triangles).toBeLessThan(18_000)
    disposeModel(model)
    glowTexture.dispose()
    engravingTexture.dispose()
  })
})
