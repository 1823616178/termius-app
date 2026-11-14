import { motionTier } from '../stores/workbench'

export function applyCardTilt(event: PointerEvent, maxDeg = 5.5): void {
  if (motionTier.value !== 'full') return
  const card = event.currentTarget as HTMLElement | null
  if (!card) return
  const rect = card.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const nx = ((event.clientX - rect.left) / rect.width - 0.5) * 2
  const ny = ((event.clientY - rect.top) / rect.height - 0.5) * 2
  const rx = (-ny * maxDeg).toFixed(2)
  const ry = (nx * maxDeg).toFixed(2)
  card.style.setProperty('--card-rx', `${rx}deg`)
  card.style.setProperty('--card-ry', `${ry}deg`)
}

export function resetCardTilt(event: PointerEvent): void {
  const card = event.currentTarget as HTMLElement | null
  if (!card) return
  card.style.removeProperty('--card-rx')
  card.style.removeProperty('--card-ry')
}
