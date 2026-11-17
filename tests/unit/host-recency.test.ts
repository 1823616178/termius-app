import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  loadHostRecency,
  markHostUsed,
  recentHostIds,
  sortHostsByRecency
} from '../../src/renderer/src/services/host-recency'

afterEach(() => {
  recentHostIds.value = []
  vi.unstubAllGlobals()
})

describe('recent connection ordering', () => {
  it('promotes used hosts while keeping unused hosts in their original order without mutating input', () => {
    const source = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(sortHostsByRecency(source, ['c', 'deleted', 'a']).map((host) => host.id)).toEqual([
      'c',
      'a',
      'b',
      'd'
    ])
    expect(source.map((host) => host.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('persists usage and moves an existing host back to the top exactly once', () => {
    let stored: string | null = null
    const storage = {
      getItem: () => stored,
      setItem: vi.fn((_key: string, value: string) => {
        stored = value
      })
    }
    vi.stubGlobal('localStorage', storage)
    markHostUsed('a')
    markHostUsed('b')
    markHostUsed('a')
    markHostUsed('a')
    expect(storage.setItem).toHaveBeenCalledTimes(3)
    recentHostIds.value = []
    loadHostRecency()
    expect(recentHostIds.value).toEqual(['a', 'b'])
  })

  it('sanitizes old data and recovers from malformed history', () => {
    const storage = { getItem: () => '["c",false,null,"c","",4,"a"]' }
    vi.stubGlobal('localStorage', storage)
    loadHostRecency()
    expect(recentHostIds.value).toEqual(['c', 'a'])
    storage.getItem = () => '{broken'
    loadHostRecency()
    expect(recentHostIds.value).toEqual([])
  })

  it('keeps usage ordering available when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Unavailable')
      },
      setItem: () => {
        throw new Error('Unavailable')
      }
    })
    expect(() => loadHostRecency()).not.toThrow()
    expect(() => markHostUsed('a')).not.toThrow()
    expect(recentHostIds.value).toEqual(['a'])
  })
})
