function finiteDimension(value: number, fallback: number, minimum: number): number {
  return Number.isFinite(value) && value >= minimum ? value : fallback
}

function rounded(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

export function createBorderFlightPath(width: number, height: number, inset = 12, radius = 18): string {
  const w = finiteDimension(width, 160, 40)
  const h = finiteDimension(height, 120, 40)
  const safeInset = Math.max(0, Math.min(Number.isFinite(inset) ? inset : 12, Math.min(w, h) / 4))
  const x = safeInset
  const y = safeInset
  const right = w - safeInset
  const bottom = h - safeInset
  const maxRadius = Math.max(0, Math.min(right - x, bottom - y) / 2)
  const r = Math.max(0, Math.min(Number.isFinite(radius) ? radius : 18, maxRadius))

  return [
    `M ${rounded(x + r)} ${rounded(y)}`,
    `H ${rounded(right - r)}`,
    `Q ${rounded(right)} ${rounded(y)} ${rounded(right)} ${rounded(y + r)}`,
    `V ${rounded(bottom - r)}`,
    `Q ${rounded(right)} ${rounded(bottom)} ${rounded(right - r)} ${rounded(bottom)}`,
    `H ${rounded(x + r)}`,
    `Q ${rounded(x)} ${rounded(bottom)} ${rounded(x)} ${rounded(bottom - r)}`,
    `V ${rounded(y + r)}`,
    `Q ${rounded(x)} ${rounded(y)} ${rounded(x + r)} ${rounded(y)}`,
    'Z'
  ].join(' ')
}
