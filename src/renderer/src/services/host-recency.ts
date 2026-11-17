import { ref } from 'vue'

const STORAGE_KEY = 'orbit:recent-hosts'
export const recentHostIds = ref<string[]>([])

export function loadHostRecency(): void {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    recentHostIds.value = Array.isArray(saved)
      ? [
          ...new Set(
            saved.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
          )
        ]
      : []
  } catch {
    recentHostIds.value = []
  }
}

export function markHostUsed(hostId: string): void {
  if (!hostId || recentHostIds.value[0] === hostId) return
  recentHostIds.value = [hostId, ...recentHostIds.value.filter((id) => id !== hostId)]
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recentHostIds.value))
  } catch {
    // Ordering still works for this session if local storage is unavailable.
  }
}

export function sortHostsByRecency<T extends { id: string }>(
  items: readonly T[],
  recentIds: readonly string[]
): T[] {
  const order = new Map(recentIds.map((id, index) => [id, index]))
  return [...items].sort(
    (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
}
