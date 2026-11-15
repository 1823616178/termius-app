import { describe, expect, it } from 'vitest'
import { resolveUiThemeVariables } from '../../src/renderer/src/services/ui-themes'

describe('UI theme scene materials', () => {
  it('keeps high-contrast scene overrides authoritative over inline theme variables', () => {
    const standard = resolveUiThemeVariables('bagua-taiji', undefined, 'standard')
    const high = resolveUiThemeVariables('bagua-taiji', undefined, 'high')
    expect(high['--color-scene-steel']).toBe('#e8f0e9')
    expect(high['--color-scene-metal-soft']).toBe('rgba(234, 200, 122, 0.2)')
    expect(high['--color-scene-mist']).toBe('rgba(127, 224, 195, 0.14)')
    expect(standard['--color-scene-steel']).not.toBe(high['--color-scene-steel'])
  })

  it('preserves custom colors in standard contrast', () => {
    const variables = resolveUiThemeVariables('custom', { accentSecondary: '#112233' }, 'standard')
    expect(variables['--color-accent-secondary']).toBe('#112233')
  })
})
