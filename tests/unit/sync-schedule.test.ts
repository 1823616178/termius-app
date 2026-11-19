import { describe, expect, it } from 'vitest'
import {
  AUTO_SYNC_DEBOUNCE_MS,
  AUTO_SYNC_IMMEDIATE_MS,
  AUTO_SYNC_RESUME_MS,
  resolveAutoSyncDelay
} from '../../src/main/sync-schedule'

describe('sync schedule', () => {
  it('keeps a restore deadline through repeated immediate edits', () => {
    expect(resolveAutoSyncDelay(true, AUTO_SYNC_RESUME_MS)).toBe(2500)
    expect(resolveAutoSyncDelay(true, 1700.5)).toBe(1701)
    expect(resolveAutoSyncDelay(true, -1)).toBe(AUTO_SYNC_IMMEDIATE_MS)
    expect(resolveAutoSyncDelay(false, 800)).toBe(AUTO_SYNC_DEBOUNCE_MS)
  })
})
