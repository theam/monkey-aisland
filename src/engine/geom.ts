/** Polygon helpers for walkable areas and hit testing. */
import type { Vec2 } from './content'

export function pointInPoly(x: number, y: number, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function closestOnSegment(px: number, py: number, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return [a[0], a[1]]
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return [a[0] + dx * t, a[1] + dy * t]
}

/** Nearest point inside (or on the edge of) the polygon. */
export function clampToPoly(x: number, y: number, poly: readonly Vec2[]): Vec2 {
  if (pointInPoly(x, y, poly)) return [x, y]
  let best: Vec2 = [poly[0][0], poly[0][1]]
  let bestD = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = closestOnSegment(x, y, poly[j], poly[i])
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

export function polyBounds(poly: readonly Vec2[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of poly) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function rectContains(
  r: readonly [number, number, number, number], x: number, y: number,
): boolean {
  return x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]
}

export function rectCenter(r: readonly [number, number, number, number]): Vec2 {
  return [r[0] + r[2] / 2, r[1] + r[3] / 2]
}
