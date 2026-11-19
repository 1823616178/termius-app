export const AUTO_SYNC_DEBOUNCE_MS = 3_000
export const AUTO_SYNC_IMMEDIATE_MS = 120
export const AUTO_SYNC_RESUME_MS = 2_500

export function resolveAutoSyncDelay(immediate: boolean, remainingGraceMs: number): number {
  return Math.ceil(Math.max(immediate ? AUTO_SYNC_IMMEDIATE_MS : AUTO_SYNC_DEBOUNCE_MS, remainingGraceMs))
}
