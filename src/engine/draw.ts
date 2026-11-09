/**
 * Drawing primitives for the indexed framebuffer.
 *
 * This is the paintbrush set the scene painters in src/art/scenes/* use.
 * Everything here is deterministic (pass an RNG in, never call Math.random)
 * and palette-quantised, because that is what makes the result look painted
 * rather than generated.
 */
import { Framebuffer } from './framebuffer'
import { TRANSPARENT, mixIndex } from './palette'
import type { RNG } from './rng'

export type Rect = { x: number; y: number; w: number; h: number }
export type Pt = [number, number]

/** Rects come out of generated art with fractional edges. Pixels don't. */
export function snap(r: Rect): Rect {
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y }
}

// ---------------------------------------------------------------------------
// Ordered dithering matrices (normalised thresholds in [0,1))
// ---------------------------------------------------------------------------

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => v / 16))

export const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((r) => r.map((v) => v / 64))

export type Matrix = number[][]

export function threshold(m: Matrix, x: number, y: number): number {
  // Coordinates arriving from generated art are routinely fractional; indexing
  // the matrix with a float silently yields undefined, so floor first.
  const iy = Math.floor(y)
  const ix = Math.floor(x)
  const row = m[((iy % m.length) + m.length) % m.length]
  return row[((ix % row.length) + row.length) % row.length]
}

// ---------------------------------------------------------------------------
// Basic shapes
// ---------------------------------------------------------------------------

export function px(fb: Framebuffer, x: number, y: number, c: number): void {
  fb.set(x | 0, y | 0, c)
}

export function hline(fb: Framebuffer, x0: number, x1: number, y: number, c: number): void {
  if (x1 < x0) [x0, x1] = [x1, x0]
  for (let x = x0 | 0; x <= (x1 | 0); x++) fb.set(x, y | 0, c)
}

export function vline(fb: Framebuffer, x: number, y0: number, y1: number, c: number): void {
  if (y1 < y0) [y0, y1] = [y1, y0]
  for (let y = y0 | 0; y <= (y1 | 0); y++) fb.set(x | 0, y, c)
}

export function rect(fb: Framebuffer, x: number, y: number, w: number, h: number, c: number): void {
  for (let yy = 0; yy < h; yy++) hline(fb, x, x + w - 1, y + yy, c)
}

export function line(fb: Framebuffer, x0: number, y0: number, x1: number, y1: number, c: number): void {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  for (;;) {
    fb.set(x0, y0, c)
    if (x0 === x1 && y0 === y1) break
    const e2 = err * 2
    if (e2 > -dy) { err -= dy; x0 += sx }
    if (e2 < dx) { err += dx; y0 += sy }
  }
}

/** Filled polygon, even-odd scanline rule. Points may be fractional. */
export function polyFill(fb: Framebuffer, pts: readonly Pt[], c: number): void {
  if (pts.length < 3) return
  let minY = Infinity
  let maxY = -Infinity
  for (const [, y] of pts) {
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const xs: number[] = []
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(fb.h - 1, Math.ceil(maxY)); y++) {
    xs.length = 0
    const scan = y + 0.5
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]
      const [xj, yj] = pts[j]
      if (yi === yj) continue
      if ((scan >= yi && scan < yj) || (scan >= yj && scan < yi)) {
        xs.push(xi + ((scan - yi) / (yj - yi)) * (xj - xi))
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      hline(fb, Math.round(xs[k]), Math.round(xs[k + 1]) - 1, y, c)
    }
  }
}

export function disc(fb: Framebuffer, cx: number, cy: number, r: number, c: number): void {
  const r2 = r * r
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const dy = y - cy
    const span = Math.sqrt(Math.max(0, r2 - dy * dy))
    hline(fb, Math.round(cx - span), Math.round(cx + span), y, c)
  }
}

export function ring(fb: Framebuffer, cx: number, cy: number, r: number, c: number): void {
  let x = r
  let y = 0
  let err = 1 - r
  while (x >= y) {
    for (const [px_, py_] of [
      [x, y], [y, x], [-x, y], [-y, x], [-x, -y], [-y, -x], [x, -y], [y, -x],
    ] as Pt[]) {
      fb.set(Math.round(cx + px_), Math.round(cy + py_), c)
    }
    y++
    if (err < 0) err += 2 * y + 1
    else { x--; err += 2 * (y - x + 1) }
  }
}

export function ellipse(
  fb: Framebuffer, cx: number, cy: number, rx: number, ry: number, c: number,
): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const t = (y - cy) / ry
    if (Math.abs(t) > 1) continue
    const span = rx * Math.sqrt(1 - t * t)
    hline(fb, Math.round(cx - span), Math.round(cx + span), y, c)
  }
}

// ---------------------------------------------------------------------------
// Dithering & gradients
// ---------------------------------------------------------------------------

/**
 * Fill a rect with a 2-colour ordered dither. `mix` 0 = all cA, 1 = all cB.
 * `mixAt` can vary the mix per pixel (for hand-tuned falloff).
 */
export function ditherRect(
  fb: Framebuffer,
  rIn: Rect,
  cA: number,
  cB: number,
  mix: number | ((x: number, y: number) => number),
  m: Matrix = BAYER4,
): void {
  const r = snap(rIn)
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const t = typeof mix === 'number' ? mix : mix(x, y)
      fb.set(x, y, t > threshold(m, x, y) ? cB : cA)
    }
  }
}

/**
 * Dithered vertical gradient down a ramp — the workhorse for skies and water.
 * `t0`/`t1` are ramp positions at the top and bottom of the rect.
 */
export function gradientV(
  fb: Framebuffer,
  rIn: Rect,
  ramp: readonly number[],
  t0 = 0,
  t1 = 1,
  m: Matrix = BAYER4,
  curve: (t: number) => number = (t) => t,
): void {
  const r = snap(rIn)
  const steps = ramp.length - 1
  for (let y = r.y; y < r.y + r.h; y++) {
    const f = r.h <= 1 ? 0 : (y - r.y) / (r.h - 1)
    const t = clamp01(t0 + (t1 - t0) * curve(f)) * steps
    const lo = Math.floor(t)
    const frac = t - lo
    const cA = ramp[Math.min(lo, steps)]
    const cB = ramp[Math.min(lo + 1, steps)]
    for (let x = r.x; x < r.x + r.w; x++) {
      fb.set(x, y, frac > threshold(m, x, y) ? cB : cA)
    }
  }
}

// ---------------------------------------------------------------------------
// Terrain / silhouettes
// ---------------------------------------------------------------------------

/** Draw a 1px rim light along the top edge of a height profile. */
export function rimLight(
  fb: Framebuffer, heights: ArrayLike<number>, c: number, x0 = 0, thickness = 1,
): void {
  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) continue
    for (let t = 0; t < thickness; t++) fb.set(x0 + i, heights[i] + t, c)
  }
}

/** Speckle noise: cheap rock grain, sand, stucco, star fields. */
export function speckle(
  fb: Framebuffer, r: Rect, rng: RNG, colors: readonly number[], density: number,
  onlyOver?: readonly number[],
): void {
  const gate = onlyOver ? new Set(onlyOver) : null
  const n = Math.round(r.w * r.h * density)
  for (let i = 0; i < n; i++) {
    const x = r.x + Math.floor(rng.next() * r.w)
    const y = r.y + Math.floor(rng.next() * r.h)
    if (gate && !gate.has(fb.get(x, y))) continue
    fb.set(x, y, rng.pick(colors))
  }
}

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

const mixCache = new Map<number, number>()

/** mixIndex with memoisation — background painting hits this thousands of times. */
export function mixCached(a: number, b: number, t: number): number {
  const q = Math.round(clamp01(t) * 15)
  const key = (a << 12) | (b << 4) | q
  let v = mixCache.get(key)
  if (v === undefined) {
    v = mixIndex(a, b, q / 15)
    mixCache.set(key, v)
  }
  return v
}

/**
 * Pool of warm (or any) light: blends existing pixels towards `toward` with a
 * radial falloff, dithered so the edge of the pool looks like 1990 and not like
 * a CSS box-shadow. Cheap enough to use several times per background.
 */
export function lightPool(
  fb: Framebuffer,
  cx: number,
  cy: number,
  radius: number,
  toward: number,
  strength = 0.55,
  m: Matrix = BAYER8,
  aspect = 1,
): void {
  const r2 = radius * radius
  for (let y = Math.max(0, Math.floor(cy - radius / aspect)); y <= Math.min(fb.h - 1, Math.ceil(cy + radius / aspect)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(fb.w - 1, Math.ceil(cx + radius)); x++) {
      const dx = x - cx
      const dy = (y - cy) * aspect
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const f = 1 - Math.sqrt(d2) / radius
      const amount = f * f * strength
      // dither the *decision to light at all* near the edge
      if (amount < threshold(m, x, y) * 0.35) continue
      const src = fb.get(x, y)
      if (src === TRANSPARENT) continue
      fb.set(x, y, mixCached(src, toward, amount))
    }
  }
}

/** Corner vignette — pulls the eye to the centre like a painted backdrop. */
export function vignette(fb: Framebuffer, toward: number, strength = 0.4): void {
  const cx = fb.w / 2
  const cy = fb.h / 2
  const maxD = Math.hypot(cx, cy)
  for (let y = 0; y < fb.h; y++) {
    for (let x = 0; x < fb.w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD
      if (d < 0.55) continue
      const a = ((d - 0.55) / 0.45) ** 2 * strength
      const src = fb.get(x, y)
      if (src === TRANSPARENT) continue
      fb.set(x, y, mixCached(src, toward, a))
    }
  }
}

/**
 * Aerial perspective: push a region towards the sky colour so distant things
 * read as distant. Applies only to the listed source colours.
 */
export function haze(
  fb: Framebuffer, r: Rect, toward: number, amount: number, only?: readonly number[],
): void {
  const gate = only ? new Set(only) : null
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const src = fb.get(x, y)
      if (src === TRANSPARENT) continue
      if (gate && !gate.has(src)) continue
      fb.set(x, y, mixCached(src, toward, amount))
    }
  }
}

/** Trace a 1px outline around every non-transparent pixel cluster. */
export function outline(fb: Framebuffer, c: number, r?: Rect): void {
  const reg = r ?? { x: 0, y: 0, w: fb.w, h: fb.h }
  const edges: number[] = []
  for (let y = reg.y; y < reg.y + reg.h; y++) {
    for (let x = reg.x; x < reg.x + reg.w; x++) {
      if (fb.get(x, y) !== TRANSPARENT) continue
      if (
        fb.get(x - 1, y) !== TRANSPARENT || fb.get(x + 1, y) !== TRANSPARENT ||
        fb.get(x, y - 1) !== TRANSPARENT || fb.get(x, y + 1) !== TRANSPARENT
      ) edges.push(x, y)
    }
  }
  for (let i = 0; i < edges.length; i += 2) fb.set(edges[i], edges[i + 1], c)
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

/** Bezier-ish smooth curve through points, sampled per x — for ropes and vines. */
export function catmull(pts: readonly Pt[], samples: number): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = []
  const p = [pts[0], ...pts, pts[pts.length - 1]]
  for (let i = 0; i + 3 < p.length; i++) {
    const [x0, y0] = p[i]
    const [x1, y1] = p[i + 1]
    const [x2, y2] = p[i + 2]
    const [x3, y3] = p[i + 3]
    for (let s = 0; s < samples; s++) {
      const t = s / samples
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
        0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3),
      ])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** A hanging rope/chain between two points (catenary approximation). */
export function catenary(fb: Framebuffer, a: Pt, b: Pt, sag: number, c: number): void {
  const steps = Math.max(4, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])))
  let prev: Pt = a
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = lerp(a[0], b[0], t)
    const y = lerp(a[1], b[1], t) + Math.sin(t * Math.PI) * sag
    line(fb, prev[0], prev[1], x, y, c)
    prev = [x, y]
  }
}
