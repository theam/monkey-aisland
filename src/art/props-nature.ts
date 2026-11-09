/**
 * Outdoor props: sky, moon, sea, cliffs, palms. Shared by the lookout and the
 * dock so the two exteriors look like the same island on the same night.
 *
 * Every function is deterministic: pass an RNG, never call Math.random.
 */
import { Framebuffer } from '../engine/framebuffer'
import { C, RAMPS } from '../engine/palette'
import { RNG, valueNoise1D } from '../engine/rng'
import {
  BAYER8, catmull, clamp, disc, ditherRect, gradientV, hline, line, mixCached,
  polyFill, rimLight, smoothstep, speckle, vline, type Pt,
} from '../engine/draw'

/** Night sky with a dithered gradient, stars, and soft cloud bands. */
export function nightSky(fb: Framebuffer, rng: RNG, horizonY: number): void {
  gradientV(fb, { x: 0, y: 0, w: fb.w, h: horizonY }, RAMPS.sky, 0.02, 0.62, BAYER8, smoothstep)

  // Stars: fewer and dimmer near the horizon, where the sky is bright.
  const stars = Math.round(fb.w * 0.5)
  for (let i = 0; i < stars; i++) {
    const x = Math.floor(rng.next() * fb.w)
    const y = Math.floor(rng.next() * horizonY * 0.85)
    const near = 1 - y / (horizonY * 0.85)
    if (rng.next() > 0.25 + near * 0.75) continue
    const bright = rng.next()
    fb.set(x, y, bright > 0.93 ? C.moon2 : bright > 0.7 ? C.moon1 : C.sky7)
  }

  // Cloud bands: long, low-contrast, slightly lighter than the sky behind them.
  const bands = 4
  for (let b = 0; b < bands; b++) {
    const y0 = Math.round(horizonY * (0.18 + 0.18 * b) + rng.range(-4, 4))
    const h = rng.int(3, 7)
    const noise = valueNoise1D(rng.fork(b), fb.w, 42 + b * 17, 3)
    for (let x = 0; x < fb.w; x++) {
      const density = noise[x]
      if (density < 0.48) continue
      const thick = Math.round((density - 0.48) * 2 * h)
      for (let y = y0; y < y0 + thick; y++) {
        const src = fb.get(x, y)
        const t = 0.35 + 0.3 * ((density - 0.48) * 2)
        if (((x + y) & 1) === 0 || density > 0.72) fb.set(x, y, mixCached(src, C.sky7, t))
      }
    }
  }
}

/** The moon, with a halo that bleeds into the sky. */
export function moon(fb: Framebuffer, cx: number, cy: number, r: number): void {
  for (let ring = Math.round(r * 4); ring > r; ring--) {
    const t = 1 - (ring - r) / (r * 3)
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180
      const x = Math.round(cx + Math.cos(rad) * ring)
      const y = Math.round(cy + Math.sin(rad) * ring)
      if (!fb.inside(x, y)) continue
      if (((x + y) & 1) === 1 && t < 0.55) continue
      fb.set(x, y, mixCached(fb.get(x, y), C.moon1, t * 0.5))
    }
  }
  disc(fb, cx, cy, r, C.moon2)
  disc(fb, cx + 1, cy + 1, r * 0.92, C.moon2)
  // a couple of maria so it isn't a featureless dot
  disc(fb, cx - r * 0.3, cy - r * 0.2, Math.max(1, r * 0.22), C.moon1)
  disc(fb, cx + r * 0.35, cy + r * 0.3, Math.max(1, r * 0.18), C.moon1)
}

/**
 * Sea from `horizonY` down to `toY`, with a moonlit shimmer column and a few
 * long swell lines. Rows near the horizon get compressed detail (perspective).
 */
export function sea(
  fb: Framebuffer, rng: RNG, horizonY: number, toY: number, moonX: number,
): void {
  gradientV(fb, { x: 0, y: horizonY, w: fb.w, h: toY - horizonY }, RAMPS.sea, 0.75, 0.18, BAYER8)

  // horizon line: the brightest thing in the picture after the moon
  hline(fb, 0, fb.w - 1, horizonY, C.sea6)
  hline(fb, 0, fb.w - 1, horizonY - 1, C.sea5)

  // swell lines, denser near the horizon
  const rows = toY - horizonY
  for (let i = 0; i < rows * 1.6; i++) {
    const t = Math.pow(rng.next(), 0.6)
    const y = Math.round(horizonY + 1 + t * (rows - 2))
    const len = rng.int(6, 30) + Math.round(t * 26)
    const x = Math.floor(rng.next() * fb.w)
    const c = t < 0.4 ? C.sea5 : t < 0.75 ? C.sea4 : C.sea3
    hline(fb, x, x + len, y, c)
  }

  // Moon reflection: a path of FLAT dashes, near-aligned under the moon and
  // widening as it comes towards the shore. Wander the centres too much and
  // the stack of dashes reads as a tree instead of as water.
  for (let y = horizonY + 1; y < toY; y++) {
    const t = (y - horizonY) / Math.max(1, toY - horizonY)
    // dashes get longer and the path gets a little wider with proximity, so the
    // reflection reads as a widening wedge rather than a column
    const len = 2 + t * 26 + rng.range(-1, 3)
    const drift = rng.range(-1.5, 1.5) - t * 1.5
    const cx = moonX + drift
    if (rng.next() < 0.16) continue // a few rows stay dark: broken water
    hline(fb, cx - len / 2, cx + len / 2, y, t < 0.45 ? C.moon1 : C.sea7)
    // a dimmer outrider now and then, always horizontal
    if (rng.next() < 0.35) {
      const side = rng.bool() ? 1 : -1
      const ox = cx + side * (len / 2 + rng.range(2, 7))
      const ol = 1 + t * 4
      hline(fb, ox - ol / 2, ox + ol / 2, y, C.sea6)
    }
  }
}

/**
 * A cliff / headland mass. `profile` gives the skyline as [x, y] control
 * points; everything below is filled and shaded, with a rim light on top.
 */
export function cliffMass(
  fb: Framebuffer,
  rng: RNG,
  profile: Pt[],
  opts: {
    /** 0 = distant haze, 1 = full contrast foreground */
    contrast?: number
    /** light comes from this x — the moon */
    lightX?: number
    bottom?: number
    ramp?: readonly number[]
    /** add cracks and speckle */
    detail?: boolean
  } = {},
): void {
  const contrast = opts.contrast ?? 1
  const bottom = opts.bottom ?? fb.h - 1
  const ramp = opts.ramp ?? RAMPS.rock
  const pts = catmull(profile, 8)

  // Rasterise the skyline into a height per column, but only across the span
  // the profile actually covers — a headland must not fill the whole screen.
  const heights = new Float32Array(fb.w).fill(Number.NaN)
  let spanMin = Infinity
  let spanMax = -Infinity
  for (const [x, y] of pts) {
    if (x < spanMin) spanMin = x
    if (x > spanMax) spanMax = x
    const xi = Math.round(x)
    if (xi < 0 || xi >= fb.w) continue
    heights[xi] = Number.isNaN(heights[xi]) ? y : Math.min(heights[xi], y)
  }
  const x0 = Math.max(0, Math.round(spanMin))
  const x1 = Math.min(fb.w - 1, Math.round(spanMax))

  // forward-fill gaps inside the span only
  let lastKnown = Number.NaN
  for (let x = x0; x <= x1; x++) {
    if (!Number.isNaN(heights[x])) lastKnown = heights[x]
    else if (!Number.isNaN(lastKnown)) heights[x] = lastKnown
  }
  for (let x = x1; x >= x0; x--) {
    if (Number.isNaN(heights[x]) && x + 1 <= x1 && !Number.isNaN(heights[x + 1])) {
      heights[x] = heights[x + 1]
    }
  }

  // roughen the silhouette a little so it doesn't look like a spline
  const rough = valueNoise1D(rng, fb.w, 7, 2)
  for (let x = x0; x <= x1; x++) {
    if (Number.isNaN(heights[x])) continue
    heights[x] += (rough[x] - 0.5) * 2.2
  }

  const baseIdx = Math.round(clamp(1 + contrast * 1.2, 0, ramp.length - 1))
  const midIdx = Math.min(ramp.length - 1, baseIdx + 2)
  const lightIdx = Math.min(ramp.length - 1, baseIdx + 4)
  const lightX = opts.lightX ?? fb.w * 0.75

  for (let x = x0; x <= x1; x++) {
    if (Number.isNaN(heights[x])) continue
    const top = Math.round(heights[x])
    // Slope-based shading: faces turned towards the moon catch light.
    const hR = heights[Math.min(x1, x + 3)]
    const hL = heights[Math.max(x0, x - 3)]
    const dh = (hR - hL) / 6
    const towardsLight = Math.sign(lightX - x) === Math.sign(dh) ? Math.min(1, Math.abs(dh)) : 0
    for (let y = top; y <= bottom; y++) {
      const depth = (y - top) / Math.max(6, bottom - top)
      let idx = baseIdx
      if (depth < 0.12 && towardsLight > 0.15) idx = midIdx
      else if (depth < 0.05) idx = midIdx
      const dither = ((x + y) & 1) === 0
      fb.set(x, y, dither && depth < 0.3 ? ramp[Math.min(ramp.length - 1, idx + 1)] : ramp[idx])
    }
    if (towardsLight > 0.25) fb.set(x, top, ramp[lightIdx])
  }

  rimLight(fb, heights, ramp[Math.min(ramp.length - 1, baseIdx + 3)], 0, 1)

  if (opts.detail !== false && contrast > 0.5) {
    // cracks
    for (let i = 0; i < Math.round(fb.w / 22); i++) {
      let x = rng.int(2, fb.w - 3)
      if (Number.isNaN(heights[x])) continue
      let y = heights[x] + rng.range(4, 14)
      const len = rng.int(6, 20)
      for (let s = 0; s < len; s++) {
        fb.set(Math.round(x), Math.round(y), ramp[Math.max(0, baseIdx - 1)])
        x += rng.range(-0.8, 0.8)
        y += rng.range(0.4, 1.2)
        if (y > bottom) break
      }
    }
    speckle(
      fb,
      { x: 0, y: 0, w: fb.w, h: bottom },
      rng,
      [ramp[Math.max(0, baseIdx - 1)], ramp[midIdx]],
      0.035,
      [ramp[baseIdx], ramp[baseIdx + 1] ?? ramp[baseIdx]],
    )
  }
}

/**
 * A palm tree. Silhouette-first: the trunk is a curve, the fronds are drooping
 * feathers. `light` > 0 puts a rim on the moonlit side.
 */
export function palm(
  fb: Framebuffer,
  rng: RNG,
  baseX: number,
  baseY: number,
  height: number,
  opts: { dark?: number; light?: number; lean?: number; fronds?: number } = {},
): void {
  const dark = opts.dark ?? C.leaf0
  const light = opts.light ?? C.leaf3
  const lean = opts.lean ?? rng.range(-0.28, 0.28)
  const topX = baseX + lean * height
  const topY = baseY - height

  // trunk: two-pixel wide curve, slight taper
  const trunkPts: Pt[] = [
    [baseX, baseY],
    [baseX + lean * height * 0.35, baseY - height * 0.4],
    [topX, topY],
  ]
  const curve = catmull(trunkPts, 12)
  for (let i = 0; i < curve.length; i++) {
    const [x, y] = curve[i]
    const t = i / curve.length
    const w = 2.6 * (1 - t * 0.55)
    for (let dx = -w / 2; dx <= w / 2; dx += 0.5) {
      fb.set(Math.round(x + dx), Math.round(y), dx < -w * 0.15 ? light : dark)
    }
    // trunk rings
    if (i % 5 === 0) fb.set(Math.round(x + w / 2), Math.round(y), light)
  }

  // fronds
  const n = opts.fronds ?? rng.int(6, 8)
  for (let f = 0; f < n; f++) {
    const a = (-Math.PI / 2) + ((f / (n - 1)) - 0.5) * Math.PI * 1.65 + rng.range(-0.12, 0.12)
    const len = height * rng.range(0.34, 0.52)
    const droop = rng.range(0.5, 1.1)
    const spine: Pt[] = []
    for (let s = 0; s <= 10; s++) {
      const t = s / 10
      spine.push([
        topX + Math.cos(a) * len * t,
        topY + Math.sin(a) * len * t + droop * len * t * t * 0.75,
      ])
    }
    for (let s = 1; s < spine.length; s++) {
      line(fb, spine[s - 1][0], spine[s - 1][1], spine[s][0], spine[s][1], dark)
    }
    // leaflets
    for (let s = 2; s < spine.length; s++) {
      const [x, y] = spine[s]
      const [px, py] = spine[s - 1]
      const nx = -(y - py)
      const ny = x - px
      const nl = Math.hypot(nx, ny) || 1
      const spread = 2.2 * (1 - s / spine.length) + 1.4
      for (const dir of [-1, 1]) {
        for (let k = 1; k <= spread; k++) {
          const lx = x + (nx / nl) * k * dir
          const ly = y + (ny / nl) * k * dir + k * 0.35
          fb.set(Math.round(lx), Math.round(ly), k > spread - 1 ? light : dark)
        }
      }
    }
  }
}

/** Low stone parapet / wall, seen from the front. */
export function stoneWall(
  fb: Framebuffer, rng: RNG, x0: number, x1: number, y0: number, h: number,
): void {
  const ramp = RAMPS.rock
  ditherRect(fb, { x: x0, y: y0, w: x1 - x0, h }, ramp[2], ramp[3], 0.45, BAYER8)
  hline(fb, x0, x1, y0, ramp[5])
  hline(fb, x0, x1, y0 + 1, ramp[4])
  hline(fb, x0, x1, y0 + h - 1, ramp[0])

  // stones
  let x = x0
  let row = 0
  for (let y = y0 + 2; y < y0 + h - 1; y += 4) {
    x = x0 + (row % 2 === 0 ? 0 : 5)
    while (x < x1) {
      const w = rng.int(7, 13)
      vline(fb, x, y, Math.min(y0 + h - 2, y + 3), ramp[1])
      hline(fb, x, Math.min(x1, x + w), y, ramp[1])
      // top-left highlight on each stone
      hline(fb, x + 1, Math.min(x1, x + w - 1), y + 1, ramp[4])
      x += w
    }
    row++
  }
}

/** A wooden signpost with arms. Text is drawn by the caller. */
export function signpost(
  fb: Framebuffer, x: number, baseY: number, height: number,
): void {
  vline(fb, x, baseY - height, baseY, C.wood3)
  vline(fb, x + 1, baseY - height, baseY, C.wood5)
  vline(fb, x + 2, baseY - height, baseY, C.wood2)
  // a little pile of stones at the base
  hline(fb, x - 3, x + 5, baseY, C.rock2)
  hline(fb, x - 2, x + 4, baseY - 1, C.rock3)
}

/** A plank sign board (for the signpost or a wall). Returns the inner rect. */
export function signBoard(
  fb: Framebuffer, x: number, y: number, w: number, h: number,
): { x: number; y: number; w: number; h: number } {
  // Pale weathered wood, so dark lettering on top is actually readable.
  ditherRect(fb, { x, y, w, h }, C.wood8, C.wood9, 0.5, BAYER8)
  hline(fb, x, x + w - 1, y, C.wood10)
  hline(fb, x, x + w - 1, y + h - 1, C.wood4)
  vline(fb, x, y, y + h - 1, C.wood9)
  vline(fb, x + w - 1, y, y + h - 1, C.wood4)
  return { x: x + 2, y: y + 2, w: w - 4, h: h - 4 }
}

/** A burning torch or brazier: pole, flame, and a pool of warm light. */
export function torch(fb: Framebuffer, x: number, baseY: number, height: number): void {
  vline(fb, x, baseY - height, baseY, C.wood2)
  vline(fb, x + 1, baseY - height, baseY, C.wood4)
  const ty = baseY - height
  disc(fb, x + 0.5, ty - 1, 2.6, C.fire2)
  disc(fb, x + 0.5, ty - 2, 1.8, C.fire4)
  disc(fb, x + 0.5, ty - 3, 1.1, C.fire6)
}

/**
 * El Teide, seen across the water from Gran Canaria: 3,715 m, on another
 * island, 100 km away, and still the biggest thing on the horizon. Hazy blue
 * with a lit western flank and a snow cap.
 */
export function teide(
  fb: Framebuffer, rng: RNG, cx: number, baseY: number, height: number, width: number,
): void {
  const half = width / 2
  // The classic profile: a long shallow shield with the cone perched on top.
  const shoulder = height * 0.42
  const profile: Pt[] = [
    [cx - half, baseY],
    [cx - half * 0.62, baseY - shoulder * 0.55],
    [cx - half * 0.3, baseY - shoulder],
    [cx - half * 0.13, baseY - height * 0.86],
    [cx - 1, baseY - height],
    [cx + 2, baseY - height * 0.99],
    [cx + half * 0.16, baseY - height * 0.82],
    [cx + half * 0.34, baseY - shoulder * 0.92],
    [cx + half * 0.7, baseY - shoulder * 0.4],
    [cx + half, baseY],
  ]
  const pts = catmull(profile, 6)

  const heights = new Float32Array(fb.w).fill(Number.NaN)
  for (const [x, y] of pts) {
    const xi = Math.round(x)
    if (xi < 0 || xi >= fb.w) continue
    heights[xi] = Number.isNaN(heights[xi]) ? y : Math.min(heights[xi], y)
  }
  const x0 = Math.max(0, Math.round(cx - half))
  const x1 = Math.min(fb.w - 1, Math.round(cx + half))
  let last = Number.NaN
  for (let x = x0; x <= x1; x++) {
    if (!Number.isNaN(heights[x])) last = heights[x]
    else if (!Number.isNaN(last)) heights[x] = last
  }

  // Body: dithered between two sky-adjacent blues so it reads as distance.
  for (let x = x0; x <= x1; x++) {
    const top = heights[x]
    if (!Number.isFinite(top)) continue
    for (let y = Math.round(top); y <= baseY; y++) {
      const lit = x < cx - 1 // moon is to the right, so the far flank is darker
      const c = lit
        ? ((x + y) & 1) === 0 ? C.sky4 : C.sky3
        : ((x + y) & 1) === 0 ? C.sky3 : C.sky2
      fb.set(x, y, c)
    }
    // rim along the skyline
    fb.set(x, Math.round(top), x < cx ? C.sky6 : C.sky5)
  }

  // Snow cap: the top fifth, ragged at its lower edge.
  const capBottom = baseY - height * 0.78
  for (let x = x0; x <= x1; x++) {
    const top = heights[x]
    if (!Number.isFinite(top)) continue
    const limit = capBottom + rng.range(-1.5, 2.5)
    for (let y = Math.round(top); y <= limit; y++) {
      if (y > baseY) break
      fb.set(x, y, x < cx ? C.moon2 : C.moon0)
    }
  }

  // A thread of smoke from the crater, because it is still a volcano.
  let sx = cx
  for (let i = 0; i < 9; i++) {
    sx += rng.range(-0.9, 1.4)
    fb.set(Math.round(sx), Math.round(baseY - height - 1 - i * 1.4), C.sky5)
  }
}

/**
 * A banana plant: stubby fibrous trunk, a fan of big paddle leaves that droop
 * under their own weight, and sometimes a hand of fruit.
 */
export function bananaPlant(
  fb: Framebuffer,
  rng: RNG,
  baseX: number,
  baseY: number,
  height: number,
  opts: { dark?: number; mid?: number; light?: number; fruit?: boolean } = {},
): void {
  const dark = opts.dark ?? C.leaf1
  const mid = opts.mid ?? C.leaf3
  const light = opts.light ?? C.leaf6
  const trunkTop = baseY - height * 0.42

  // trunk: fat at the bottom, fibrous
  for (let y = baseY; y >= trunkTop; y--) {
    const t = (baseY - y) / (baseY - trunkTop)
    const w = Math.max(1, Math.round((3.2 - t * 1.4) * (height / 26)))
    hline(fb, baseX - w, baseX + w, y, mid)
    fb.set(baseX - w, y, light)
    fb.set(baseX + w, y, dark)
    if (((y - baseY) & 3) === 0) fb.set(baseX + w - 1, y, dark)
  }

  // leaves: a fan, each a long lens shape drooping at the tip
  const n = rng.int(5, 7)
  for (let i = 0; i < n; i++) {
    const spread = (i / (n - 1) - 0.5) * 2 // -1 .. 1
    const ang = -Math.PI / 2 + spread * 1.15 + rng.range(-0.1, 0.1)
    const len = height * rng.range(0.5, 0.78)
    const droop = 0.9 + Math.abs(spread) * 1.5

    const spine: Pt[] = []
    for (let s = 0; s <= 12; s++) {
      const t = s / 12
      spine.push([
        baseX + Math.cos(ang) * len * t,
        trunkTop + Math.sin(ang) * len * t + droop * len * t * t * 0.5,
      ])
    }
    // the blade: widest in the middle, tapering both ends
    for (let s = 1; s < spine.length; s++) {
      const [x, y] = spine[s]
      const [px_, py_] = spine[s - 1]
      const t = s / spine.length
      const width = Math.sin(t * Math.PI) * (height * 0.115) + 0.8
      const nx = -(y - py_)
      const ny = x - px_
      const nl = Math.hypot(nx, ny) || 1
      for (let k = -width; k <= width; k += 0.6) {
        const lx = Math.round(x + (nx / nl) * k)
        const ly = Math.round(y + (ny / nl) * k)
        const edge = Math.abs(k) > width - 0.9
        fb.set(lx, ly, edge ? dark : k < 0 ? light : mid)
      }
      // midrib
      fb.set(Math.round(x), Math.round(y), dark)
    }
  }

  if (opts.fruit ?? rng.bool(0.5)) {
    // a hand of bananas hanging just under the crown
    const fx = baseX + rng.int(-2, 2)
    const fy = trunkTop + Math.round(height * 0.14)
    for (let row = 0; row < 3; row++) {
      const w = 3 - row
      for (let k = -w; k <= w; k++) {
        fb.set(fx + k, fy + row * 2, row === 0 ? C.gold2 : C.gold1)
      }
    }
    vline(fb, fx, trunkTop, fy, dark)
  }
}

/** Distant island silhouettes on the horizon — cheap depth. */
export function distantIslands(fb: Framebuffer, rng: RNG, horizonY: number): void {
  const n = rng.int(2, 4)
  for (let i = 0; i < n; i++) {
    const cx = rng.range(0, fb.w)
    const w = rng.range(30, 90)
    const h = rng.range(4, 11)
    const pts: Pt[] = []
    for (let s = 0; s <= 10; s++) {
      const t = s / 10
      pts.push([cx - w / 2 + w * t, horizonY - Math.sin(t * Math.PI) * h * (0.7 + rng.next() * 0.6)])
    }
    pts.push([cx + w / 2, horizonY], [cx - w / 2, horizonY])
    polyFill(fb, pts, C.sky3)
    // a hint of a rim so they read as land, not fog
    for (let s = 1; s < 10; s++) {
      const p = pts[s]
      fb.set(Math.round(p[0]), Math.round(p[1]), C.sky4)
    }
  }
}

