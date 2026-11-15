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

  it('keeps every inset edge within the available dimensions', () => {
    const path = createBorderFlightPath(320, 180, 10, 20)
    expect(path).toContain('M 30 10')
    expect(path).toContain('Q 310 170 290 170')
    expect(path).toContain('H 30')
  })
})
