/**
 * The title card, in the shape of the original's: a moonlit sea seen from a
 * dark headland, the title stacked in the middle of the sky, and a slow reveal
 * timed to the theme's long intro.
 *
 * This is the full 320x200 screen, not a room — there is no verb panel here.
 */
import { Framebuffer } from '../../engine/framebuffer'
import { C } from '../../engine/palette'
import { RNG } from '../../engine/rng'
import { SCREEN_H, SCREEN_W } from '../../engine/display'
import {
  BAYER8, disc, hline, lightPool, vignette,
} from '../../engine/draw'
import {
  bananaPlant, cliffMass, distantIslands, moon, nightSky, palm, sea, teide,
} from '../props-nature'

const HORIZON = 104
const SEA_BOTTOM = 138
const MOON_X = 232
const MOON_Y = 34

/** Painted once; the timeline in game.ts composites text and fades over it. */
export function paintTitle(): Framebuffer {
  const fb = new Framebuffer(SCREEN_W, SCREEN_H, C.black)
  const rng = new RNG('title-card')

  nightSky(fb, rng, HORIZON)
  moon(fb, MOON_X, MOON_Y, 9)
  distantIslands(fb, rng.fork('islands'), HORIZON)
  teide(fb, rng.fork('teide'), 92, HORIZON, 40, 110)
  sea(fb, rng.fork('sea'), HORIZON, SEA_BOTTOM, MOON_X)

  // The headland we are standing on: near-black, filling the bottom third.
  cliffMass(
    fb,
    rng.fork('near'),
    [
      [-20, 150],
      [40, 142],
      [110, 136],
      [180, 139],
      [250, 134],
      [340, 144],
    ],
    { contrast: 0.35, lightX: MOON_X, bottom: SCREEN_H - 1, ramp: [C.black, C.ink, C.rock0, C.rock1, C.rock2], detail: false },
  )

  // A couple of silhouettes on the ridge so the skyline isn't a straight edge.
  // Not pure black: at this size a solid silhouette reads as a smudge, so they
  // get just enough interior tone to be legible as palms.
  palm(fb, rng.fork('p1'), 26, 142, 38, { lean: 0.26, dark: C.rock0, light: C.rock2 })
  palm(fb, rng.fork('p2'), 296, 138, 32, { lean: -0.22, dark: C.rock0, light: C.rock2 })
  bananaPlant(fb, rng.fork('b1'), 62, 150, 22, {
    dark: C.rock0, mid: C.rock1, light: C.rock2, fruit: false,
  })

  // A lantern on the path, the one warm thing in the picture.
  const lx = 258
  const ly = 150
  hline(fb, lx - 1, lx + 1, ly - 8, C.rock2)
  disc(fb, lx, ly - 4, 2.4, C.fire3)
  disc(fb, lx, ly - 4, 1.3, C.fire6)
  lightPool(fb, lx, ly - 4, 26, C.fire3, 0.35, BAYER8, 1.2)

  vignette(fb, C.black, 0.6)
  return fb
}

/** Cheap per-frame life: water glints and a flickering lantern. */
export function animateTitle(fb: Framebuffer, t: number): void {
  for (let y = HORIZON + 3; y < SEA_BOTTOM; y += 2) {
    const depth = (y - HORIZON) / (SEA_BOTTOM - HORIZON)
    const strength = Math.sin(t * (0.5 + depth * 0.9) + y * 1.7) * 0.5 + 0.5
    if (strength < 0.45) continue
    const w = 1 + Math.round(depth * 7 * strength)
    const x = Math.round(MOON_X + Math.sin(y * 2.3) * (3 + depth * 8))
    hline(fb, x - w, x + w, y, depth < 0.45 ? C.moon1 : C.sea7)
  }
  const f = Math.sin(t * 9) * 0.5 + Math.sin(t * 13.1) * 0.5
  disc(fb, 258, 146 + f * 0.3, 2.5 + f * 0.4, C.fire3)
  disc(fb, 258, 145.5, 1.3, C.fire6)
}
