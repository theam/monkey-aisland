/**
 * Scene 1 — the lookout point above the harbour.
 *
 * The first thing anybody sees. Moonlit, cold blues against one warm torch,
 * headlands left and right framing the sea, a path across the bottom third.
 */
import type { ScenePainter } from '../../engine/room'
import { Framebuffer } from '../../engine/framebuffer'
import { C } from '../../engine/palette'
import type { RNG } from '../../engine/rng'
import { drawTextCentered } from '../../engine/font'
import {
  BAYER4, BAYER8, ditherRect, disc, gradientV, hline, lightPool, line, speckle, vignette, vline,
} from '../../engine/draw'
import {
  bananaPlant, cliffMass, distantIslands, moon, nightSky, palm, sea, signBoard, signpost,
  stoneWall, teide, torch,
} from '../props-nature'

const HORIZON = 68
const SEA_BOTTOM = 96
const WALL_TOP = 88
const GROUND_TOP = 100
const MOON_X = 246
const MOON_Y = 24
const TORCH_X = 288
const TORCH_BASE = 132
const TORCH_H = 24

export const lookout: ScenePainter = {
  id: 'lookout',

  paint(fb: Framebuffer, rng: RNG): void {
    nightSky(fb, rng, HORIZON)
    moon(fb, MOON_X, MOON_Y, 7)
    distantIslands(fb, rng.fork('islands'), HORIZON)
    // Tenerife, off to the west. On a clear night you really can see it.
    teide(fb, rng.fork('teide'), 150, HORIZON, 34, 96)
    sea(fb, rng.fork('sea'), HORIZON, SEA_BOTTOM, MOON_X)

    // --- headlands ---------------------------------------------------------
    // left: the big one, close, almost black
    cliffMass(
      fb,
      rng.fork('cliffL'),
      [
        [-16, 22],
        [10, 26],
        [34, 40],
        [56, 58],
        [72, 76],
        [84, 96],
      ],
      { contrast: 1, lightX: MOON_X, bottom: GROUND_TOP + 6 },
    )
    // right: smaller, further away, catching the moon
    cliffMass(
      fb,
      rng.fork('cliffR'),
      [
        [252, 96],
        [268, 78],
        [286, 62],
        [306, 52],
        [336, 46],
      ],
      { contrast: 0.75, lightX: MOON_X, bottom: GROUND_TOP + 4 },
    )

    // --- vegetation on the headlands ---------------------------------------
    palm(fb, rng.fork('palm1'), 26, 40, 34, { lean: 0.22 })
    palm(fb, rng.fork('palm2'), 52, 58, 26, { lean: -0.18 })
    palm(fb, rng.fork('palm3'), 300, 54, 30, { lean: -0.24, dark: C.leaf1, light: C.leaf4 })
    palm(fb, rng.fork('palm4'), 314, 62, 22, { lean: 0.2, dark: C.leaf1, light: C.leaf4 })
    // Bananas, on the terraces, where the wind can't get at them.
    bananaPlant(fb, rng.fork('ban1'), 62, 96, 30, { fruit: true })
    bananaPlant(fb, rng.fork('ban2'), 44, 92, 24, { fruit: false })
    bananaPlant(fb, rng.fork('ban3'), 276, 100, 27, { fruit: true, dark: C.leaf0, mid: C.leaf2, light: C.leaf5 })

    // --- the low wall between the path and a long drop ---------------------
    stoneWall(fb, rng.fork('wall'), 74, 264, WALL_TOP, GROUND_TOP - WALL_TOP + 4)

    // --- the path ----------------------------------------------------------
    const pathRamp = [C.rock1, C.rock2, C.rock3, C.wood4, C.wood5, C.wood6]
    gradientV(fb, { x: 0, y: GROUND_TOP, w: fb.w, h: fb.h - GROUND_TOP }, pathRamp, 0.05, 0.72, BAYER8)
    // wheel ruts and trodden ground
    for (let i = 0; i < 26; i++) {
      const y = rng.int(GROUND_TOP + 3, fb.h - 2)
      const x = rng.int(-10, fb.w)
      const len = rng.int(14, 60)
      hline(fb, x, x + len, y, rng.bool(0.5) ? C.wood3 : C.wood6)
    }
    speckle(fb, { x: 0, y: GROUND_TOP, w: fb.w, h: fb.h - GROUND_TOP }, rng.fork('pebbles'),
      [C.rock4, C.rock5, C.wood2], 0.05)
    // tufts of dry grass along the wall base
    for (let i = 0; i < 34; i++) {
      const x = rng.int(4, fb.w - 4)
      const y = GROUND_TOP + rng.int(1, 5)
      const h = rng.int(2, 5)
      for (let k = 0; k < 3; k++) {
        line(fb, x, y, x + rng.range(-1.6, 1.6), y - h, rng.bool(0.6) ? C.leaf2 : C.leaf4)
      }
    }

    // Moonlight catching the lip of the path. This has to happen BEFORE the
    // signpost and the props, or it draws a bar straight across them.
    ditherRect(fb, { x: 0, y: GROUND_TOP, w: fb.w, h: 3 }, C.rock2, C.rock4, 0.5, BAYER4)

    // --- signpost ----------------------------------------------------------
    signpost(fb, 112, 137, 48)
    // Top board points the way to the company. Bottom board points at nowhere.
    const board = signBoard(fb, 62, 92, 104, 22)
    drawTextCentered(fb, 'THE AGILE MONKEYS', board.x + board.w / 2, board.y + 1, { color: C.wood1 })
    drawTextCentered(fb, 'HIRING >>', board.x + board.w / 2, board.y + 10, { color: C.red1 })
    const board2 = signBoard(fb, 74, 118, 80, 13)
    drawTextCentered(fb, '<< NOWHERE', board2.x + board2.w / 2, board2.y, { color: C.wood1 })

    // --- torch by the path down to the dock --------------------------------
    torch(fb, TORCH_X, TORCH_BASE, TORCH_H)
    lightPool(fb, TORCH_X, TORCH_BASE - TORCH_H, 34, C.fire4, 0.5, BAYER8, 1.1)
    lightPool(fb, TORCH_X, TORCH_BASE - 4, 26, C.fire3, 0.32, BAYER8, 1.6)

    // --- a crate somebody never collected ----------------------------------
    crate(fb, 168, 118, 16, 13)
    crate(fb, 182, 121, 12, 10)

    // --- vignette ----------------------------------------------------------
    vignette(fb, C.sky0, 0.45)
  },

  animate(fb: Framebuffer, t: number): void {
    // Moonlight on the water: short glints that breathe in and out near the
    // reflection column. No long horizontal bars sliding across the bay —
    // those read as a rendering fault rather than as water.
    for (let y = HORIZON + 3; y < WALL_TOP - 1; y += 2) {
      const depth = (y - HORIZON) / (SEA_BOTTOM - HORIZON)
      const phase = t * (0.5 + depth * 0.9) + y * 1.7
      // fade the glint in and out so nothing appears to travel
      const strength = Math.sin(phase) * 0.5 + 0.5
      if (strength < 0.45) continue
      const w = 1 + Math.round(depth * 5 * strength)
      const x = Math.round(MOON_X + Math.sin(y * 2.3) * (3 + depth * 7))
      hline(fb, x - w, x + w, y, depth < 0.45 ? C.moon1 : C.sea7)
    }

    // Torch flame flicker + the light it throws on the ground.
    const f = Math.sin(t * 11) * 0.5 + Math.sin(t * 17.3) * 0.5
    const ty = TORCH_BASE - TORCH_H
    disc(fb, TORCH_X + 0.5, ty - 1 + f * 0.4, 2.8 + f * 0.5, C.fire2)
    disc(fb, TORCH_X + 0.5 + f * 0.6, ty - 2, 1.9, C.fire4)
    disc(fb, TORCH_X + 0.5 + f * 0.4, ty - 3 - f * 0.5, 1.1, C.fire6)
    if (f > 0.35) {
      fb.set(TORCH_X + Math.round(f), ty - 6, C.fire5)
      fb.set(TORCH_X + 1, ty - 7, C.fire3)
    }

    // Twinkle: a few stars pulse on and off.
    for (let i = 0; i < 7; i++) {
      const x = ((i * 7919) % 300) + 8
      const y = ((i * 104729) % 46) + 3
      const on = Math.sin(t * (1.7 + i * 0.31) + i) > 0.72
      fb.set(x, y, on ? C.moon2 : C.sky2)
    }
  },
}

/** A wooden crate. Small enough to live here rather than in a props file. */
function crate(fb: Framebuffer, x: number, y: number, w: number, h: number): void {
  ditherRect(fb, { x, y, w, h }, C.wood3, C.wood4, 0.5, BAYER4)
  hline(fb, x, x + w - 1, y, C.wood6)
  hline(fb, x, x + w - 1, y + h - 1, C.wood1)
  vline(fb, x, y, y + h - 1, C.wood5)
  vline(fb, x + w - 1, y, y + h - 1, C.wood1)
  line(fb, x + 1, y + 1, x + w - 2, y + h - 2, C.wood2)
  line(fb, x + w - 2, y + 1, x + 1, y + h - 2, C.wood2)
  hline(fb, x + 1, x + w - 2, y + Math.floor(h / 2), C.wood5)
}
