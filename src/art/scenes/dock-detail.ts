/**
 * The dock: painting implementation. Room is 720 wide; the camera follows.
 *
 * Layout, left to right (must match public/content/en/scene-dock.yaml):
 *   0..80     rock ramp down from the lookout — the exit back up
 *   80..600   the pier: planks, mooring posts, lamps
 *   120..548  six easel boards about The Agile Monkeys, base y=100
 *   520..680  a moored ship, hull at the waterline
 *   660..720  the front of El Patilla, warm light spilling out of the door
 */
import { Framebuffer } from '../../engine/framebuffer'
import { C, RAMPS } from '../../engine/palette'
import type { RNG } from '../../engine/rng'
import { drawTextCentered } from '../../engine/font'
import {
  BAYER4, BAYER8, catenary, disc, ditherRect, gradientV, hline, lightPool, line, polyFill,
  rect, speckle, vignette, vline, type Pt,
} from '../../engine/draw'
import { cliffMass, distantIslands, moon, nightSky, palm, sea } from '../props-nature'

const HORIZON = 58
const WATER_BOTTOM = 96
const DECK_TOP = 96
const MOON_X = 150

/** x positions of the six boards; base sits on the deck at y=100. */
export const BOARD_X = [120, 196, 272, 348, 424, 500]
const BOARD_W = 48
const BOARD_TOP = 58
/** Lamps sit in the gaps between boards, never over them. */
const LAMP_X = [182, 258, 334, 410, 486, 576]
/** Lantern height: above BOARD_TOP so the flicker never touches a board. */
const LAMP_Y = 44
/** Vertical extent of a board including its legs. */
const BOARD_BOTTOM = BOARD_TOP + 46
/** Left edge of El Patilla's frontage. Nothing watery may cross this. */
const TAVERN_X = 650
/** Right edge of the rock ramp down from the lookout. */
const RAMP_X = 88

/**
 * A horizontal line of water, occluded by everything that stands in front of
 * the sea: the boards, the rock ramp, and the tavern. Anything animated over
 * the water must go through here, or it streaks across the scenery — which is
 * exactly how a swell ended up running into the bar's front door.
 */
function waterHline(fb: Framebuffer, x0: number, x1: number, y: number, c: number): void {
  const yy = Math.round(y)
  const from = Math.max(RAMP_X, Math.round(Math.min(x0, x1)))
  const to = Math.min(TAVERN_X - 1, Math.round(Math.max(x0, x1)))
  const overBoards = yy >= BOARD_TOP && yy <= BOARD_BOTTOM
  for (let x = from; x <= to; x++) {
    if (overBoards) {
      let blocked = false
      for (const bx of BOARD_X) {
        if (x >= bx && x < bx + BOARD_W) {
          blocked = true
          break
        }
      }
      if (blocked) continue
    }
    fb.set(x, yy, c)
  }
}

export function paintDock(fb: Framebuffer, rng: RNG): void {
  nightSky(fb, rng, HORIZON)
  moon(fb, MOON_X, 20, 6)
  distantIslands(fb, rng.fork('islands'), HORIZON)
  sea(fb, rng.fork('sea'), HORIZON, WATER_BOTTOM, MOON_X)

  // --- the headland the path comes down from -------------------------------
  cliffMass(
    fb,
    rng.fork('ramp'),
    [
      [-20, 8],
      [14, 18],
      [40, 40],
      [64, 68],
      [86, 96],
    ],
    { contrast: 1, lightX: MOON_X, bottom: 143 },
  )
  palm(fb, rng.fork('palmA'), 30, 30, 26, { lean: 0.2 })

  // --- moored ship ---------------------------------------------------------
  ship(fb, rng.fork('ship'), 512, 92)

  // --- the pier ------------------------------------------------------------
  deck(fb, rng.fork('deck'))

  // --- mooring posts, ropes and lamps --------------------------------------
  for (const x of [104, 236, 372, 508, 596]) mooringPost(fb, x, DECK_TOP + 4)
  catenary(fb, [104, DECK_TOP], [236, DECK_TOP], 7, C.wood2)
  catenary(fb, [236, DECK_TOP], [372, DECK_TOP], 8, C.wood2)
  catenary(fb, [372, DECK_TOP], [508, DECK_TOP], 7, C.wood2)

  // Lamps live in the GAPS between the boards, and their lanterns hang above
  // the boards' top edge — otherwise the per-frame flicker paints over the art.
  for (const x of LAMP_X) {
    lampPost(fb, x, 100)
    lightPool(fb, x, LAMP_Y, 40, C.fire4, 0.5, BAYER8, 1.15)
    lightPool(fb, x, 104, 34, C.fire3, 0.28, BAYER8, 2.4)
  }

  // --- the gallery ---------------------------------------------------------
  const captions = [
    ['MONKEY', 'HOUSES'],
    ['AI', 'STUDIO'],
    ['EBAY', '2015'],
    ['LOOK', 'BEHIND'],
    ['MKTG', 'BANANAS'],
    ['HIRING', 'ENGRS'],
  ]
  BOARD_X.forEach((x, i) => {
    easelBoard(fb, rng.fork(`board${i}`), x, BOARD_TOP, BOARD_W, 42, captions[i], i)
  })

  // --- clutter -------------------------------------------------------------
  crate(fb, 92, 108, 18, 15)
  crate(fb, 108, 112, 14, 11)
  barrel(fb, 612, 110)
  barrel(fb, 628, 108)
  barrel(fb, 620, 96)
  ropeCoil(fb, 288, 126)
  ropeCoil(fb, 466, 130)

  // --- El Patilla, at the end of the pier ----------------------------------
  tavernFront(fb, 656, 720)

  vignette(fb, C.sky0, 0.42)
}

export function animateDock(fb: Framebuffer, t: number): void {
  // Water glints. These are drawn every frame, on top of the finished
  // background, so they must respect the things standing in front of the water
  // — otherwise they streak straight across the paintings.
  for (let y = HORIZON + 2; y < WATER_BOTTOM - 2; y += 2) {
    const d = (y - HORIZON) / (WATER_BOTTOM - HORIZON)
    const x = MOON_X + Math.sin(t * (0.6 + d) + y * 0.8) * (4 + d * 12)
    waterHline(fb, x - 3 - d * 6, x + 3 + d * 6, y, d < 0.4 ? C.moon1 : C.sea7)
  }
  // a swell rolling under the ship
  const sy = Math.round(90 + Math.sin(t * 0.7) * 1.5)
  waterHline(fb, 500, 690, sy, C.sea5)

  // lamp flicker: each lamp on its own rhythm, all of them clear of the boards
  LAMP_X.forEach((x, i) => {
    const f = Math.sin(t * (7 + i) + i * 2) * 0.5 + Math.sin(t * (11 + i * 0.7)) * 0.5
    disc(fb, x, LAMP_Y, 2.6 + f * 0.4, C.fire5)
    disc(fb, x, LAMP_Y - 0.5, 1.4, C.fire7)
    // Radius stays inside the gap between boards, so the flicker never bleeds
    // onto the paintings.
    if (f > 0.4) lightPool(fb, x, LAMP_Y + 1, 10, C.fire6, 0.2, BAYER4, 1.1)
  })

  // the tavern's doorway glow breathes
  const b = 0.5 + Math.sin(t * 1.6) * 0.06
  lightPool(fb, 690, 112, 30, C.fire4, b * 0.5, BAYER8, 1.3)
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function deck(fb: Framebuffer, rng: RNG): void {
  // the planks, running away from the camera
  gradientV(
    fb,
    { x: 80, y: DECK_TOP, w: fb.w - 80, h: 144 - DECK_TOP },
    [C.wood1, C.wood2, C.wood3, C.wood5, C.wood6],
    0.05,
    0.85,
    BAYER8,
  )
  // plank seams: perspective, so they converge slightly as they go back
  for (let i = 0; i < 26; i++) {
    const y = DECK_TOP + 2 + Math.round(Math.pow(i / 26, 1.5) * (143 - DECK_TOP))
    hline(fb, 80, fb.w - 1, y, C.wood1)
    if (i % 3 === 0) hline(fb, 80, fb.w - 1, y + 1, C.wood4)
  }
  // cross-boards
  for (let x = 84; x < fb.w; x += 23) {
    vline(fb, x, DECK_TOP + 1, 143, C.wood2)
    vline(fb, x + 1, DECK_TOP + 1, 143, C.wood5)
  }
  // the front edge of the pier catches the moon
  hline(fb, 80, fb.w - 1, DECK_TOP, C.wood7)
  hline(fb, 80, fb.w - 1, DECK_TOP + 1, C.wood6)
  speckle(fb, { x: 80, y: DECK_TOP, w: fb.w - 80, h: 144 - DECK_TOP }, rng,
    [C.wood1, C.wood6, C.wood2], 0.03)
}

function mooringPost(fb: Framebuffer, x: number, baseY: number): void {
  rect(fb, x - 3, baseY - 16, 7, 18, C.wood3)
  vline(fb, x - 3, baseY - 16, baseY + 1, C.wood5)
  vline(fb, x + 3, baseY - 16, baseY + 1, C.wood1)
  // rounded cap
  hline(fb, x - 4, x + 4, baseY - 17, C.wood4)
  hline(fb, x - 3, x + 3, baseY - 18, C.wood6)
  hline(fb, x - 2, x + 2, baseY - 19, C.wood7)
  // rope wrapped twice
  for (const dy of [-11, -8]) {
    hline(fb, x - 4, x + 4, baseY + dy, C.wood8)
    hline(fb, x - 4, x + 4, baseY + dy + 1, C.wood5)
  }
}

function lampPost(fb: Framebuffer, x: number, baseY: number): void {
  const top = LAMP_Y - 6
  vline(fb, x, top, baseY, C.rock2)
  vline(fb, x + 1, top, baseY, C.rock4)
  // bracket + lantern
  hline(fb, x - 2, x + 3, top, C.rock3)
  rect(fb, x - 4, top + 1, 9, 9, C.rock1)
  rect(fb, x - 3, top + 2, 7, 7, C.fire2)
  disc(fb, x, LAMP_Y, 2.4, C.fire5)
  disc(fb, x, LAMP_Y - 0.5, 1.2, C.fire7)
  hline(fb, x - 5, x + 5, top, C.rock4)
  hline(fb, x - 4, x + 4, top + 10, C.rock2)
  // base
  hline(fb, x - 3, x + 4, baseY, C.rock2)
  hline(fb, x - 2, x + 3, baseY - 1, C.rock3)
}

/**
 * An A-frame board propped on the pier with a painting on it. The paintings
 * are abstract on purpose: the joke is in the Look at text, the board just has
 * to look like somebody painted it.
 */
function easelBoard(
  fb: Framebuffer,
  rng: RNG,
  x: number,
  y: number,
  w: number,
  h: number,
  caption: string[],
  index: number,
): void {
  const baseY = y + h + 4

  // legs
  line(fb, x + 6, baseY, x + 12, y + h, C.wood2)
  line(fb, x + w - 6, baseY, x + w - 12, y + h, C.wood2)
  line(fb, x + 7, baseY, x + 13, y + h, C.wood4)
  line(fb, x + w - 7, baseY, x + w - 13, y + h, C.wood4)

  // frame
  rect(fb, x, y, w, h, C.wood3)
  hline(fb, x, x + w - 1, y, C.wood6)
  vline(fb, x, y, y + h - 1, C.wood5)
  hline(fb, x, x + w - 1, y + h - 1, C.wood1)
  vline(fb, x + w - 1, y, y + h - 1, C.wood1)

  // canvas
  const cx = x + 3
  const cy = y + 3
  const cw = w - 6
  const ch = h - 24
  ditherRect(fb, { x: cx, y: cy, w: cw, h: ch }, C.wood9, C.wood10, 0.45, BAYER4)

  // a different painted motif per board, all in the same two inks
  const ink = C.wood1
  const ink2 = C.red1
  switch (index) {
    case 0: {
      for (let i = 0; i < 3; i++) {
        const houseX = cx + 3 + i * 13
        rect(fb, houseX, cy + 10, 10, 9, ink)
        polyFill(fb, [
          [houseX - 1, cy + 10], [houseX + 5, cy + 4], [houseX + 11, cy + 10],
        ] as Pt[], i === 1 ? ink2 : ink)
        rect(fb, houseX + 4, cy + 14, 3, 5, C.wood9)
      }
      break
    }
    case 1: {
      // a brain-ish scribble: the AI board
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2
        const r1 = 6 + rng.range(-1.5, 1.5)
        line(fb, cx + cw / 2, cy + ch / 2,
          cx + cw / 2 + Math.cos(a) * r1, cy + ch / 2 + Math.sin(a) * r1 * 0.7, i % 3 ? ink : ink2)
      }
      break
    }
    case 2: {
      polyFill(fb, [
        [cx + 2, cy + 16], [cx + 30, cy + 16], [cx + 26, cy + 21], [cx + 6, cy + 21],
      ] as Pt[], ink)
      vline(fb, cx + 10, cy + 6, cy + 16, ink)
      polyFill(fb, [
        [cx + 11, cy + 6], [cx + 22, cy + 10], [cx + 11, cy + 13],
      ] as Pt[], ink2)
      rect(fb, cx + 27, cy + 7, 11, 9, ink2)
      rect(fb, cx + 29, cy + 9, 7, 5, C.wood9)
      drawTextCentered(fb, 'E', cx + 32.5, cy + 9, { color: ink2 })
      break
    }
    case 3: {
      const headY = cy + 8
      for (const headX of [cx + 12, cx + 21, cx + 30]) {
        disc(fb, headX, headY, 4.5, ink)
        disc(fb, headX - 4, headY - 1, 1.8, ink)
        disc(fb, headX + 4, headY - 1, 1.8, ink)
        disc(fb, headX, headY + 1, 2, C.wood9)
      }
      rect(fb, cx + 14, cy + 13, 14, 8, ink2)
      line(fb, cx + 14, cy + 15, cx + 7, cy + 20, ink2)
      line(fb, cx + 27, cy + 15, cx + 34, cy + 20, ink2)
      break
    }
    case 4: {
      for (let i = 0; i < 3; i++) {
        const bananaX = cx + 2 + i * 10
        const bananaY = cy + 5 + (i % 2) * 3
        line(fb, bananaX, bananaY, bananaX + 2, bananaY + 7, ink)
        line(fb, bananaX + 2, bananaY + 7, bananaX + 6, bananaY + 9, ink)
        line(fb, bananaX + 6, bananaY + 9, bananaX + 8, bananaY + 6, ink)
      }
      rect(fb, cx + 34, cy + 4, 4, 12, ink2)
      hline(fb, cx + 33, cx + 38, cy + 4, ink2)
      disc(fb, cx + 33, cy + 16, 2.2, ink2)
      disc(fb, cx + 39, cy + 16, 2.2, ink2)
      break
    }
    default: {
      drawTextCentered(fb, 'HIRE', cx + cw / 2, cy + 3, { color: ink2 })
      for (let i = 0; i < 5; i++) {
        const personX = cx + 5 + i * 8
        disc(fb, personX, cy + 13, 2, ink)
        rect(fb, personX - 1, cy + 15, 3, 6, ink)
      }
      break
    }
  }

  // caption plate under the painting, both lines inside the frame
  const py = cy + ch + 1
  ditherRect(fb, { x: cx, y: py, w: cw, h: 19 }, C.wood4, C.wood5, 0.5, BAYER4)
  hline(fb, cx, cx + cw - 1, py, C.wood6)
  drawTextCentered(fb, caption[0], cx + cw / 2, py + 2, { color: C.wood10 })
  drawTextCentered(fb, caption[1], cx + cw / 2, py + 10, { color: C.wood10 })
}

function ship(fb: Framebuffer, rng: RNG, x: number, waterY: number): void {
  const bowX = x + 176
  // hull
  polyFill(fb, [
    [x, waterY - 20], [bowX, waterY - 26], [bowX - 8, waterY], [x + 16, waterY],
  ] as Pt[], C.wood2)
  polyFill(fb, [
    [x, waterY - 20], [bowX, waterY - 26], [bowX - 4, waterY - 20], [x + 6, waterY - 15],
  ] as Pt[], C.wood4)
  hline(fb, x, bowX - 6, waterY - 20, C.wood6)
  // gunwale + a row of tiny lit windows
  for (let i = 0; i < 9; i++) {
    const wx = x + 18 + i * 16
    if (rng.bool(0.55)) {
      rect(fb, wx, waterY - 15, 3, 3, C.fire4)
    } else {
      rect(fb, wx, waterY - 15, 3, 3, C.wood1)
    }
  }
  // masts
  for (const [mx, mh] of [[x + 40, 74], [x + 92, 86], [x + 140, 66]] as Pt[]) {
    vline(fb, mx, waterY - 26 - mh, waterY - 22, C.wood3)
    vline(fb, mx + 1, waterY - 26 - mh, waterY - 22, C.wood1)
    // yards
    for (let k = 1; k <= 2; k++) {
      const yy = waterY - 26 - mh + k * (mh / 3)
      hline(fb, mx - 14 + k * 2, mx + 15 - k * 2, yy, C.wood2)
      // furled sail
      ditherRect(
        fb,
        { x: mx - 12 + k * 2, y: yy + 1, w: 24 - k * 4, h: 4 },
        C.wood8, C.wood9, 0.5, BAYER4,
      )
    }
  }
  // rigging
  catenary(fb, [x + 40, waterY - 96], [x + 92, waterY - 108], 6, C.wood2)
  catenary(fb, [x + 92, waterY - 108], [x + 140, waterY - 88], 6, C.wood2)
  line(fb, x + 40, waterY - 98, x + 8, waterY - 22, C.wood2)
  line(fb, x + 140, waterY - 90, bowX - 6, waterY - 24, C.wood2)
  // reflection
  for (let i = 0; i < 40; i++) {
    const rx = x + Math.floor(rng.next() * 176)
    const ry = waterY + 1 + Math.floor(rng.next() * 3)
    fb.set(rx, ry, C.sea1)
  }
}

/**
 * The front of El Patilla.
 *
 * The facade stops at FACADE_BASE and the pier's planks carry on in front of
 * it, so there is visibly floor between the player and the door. When the wall
 * ran all the way to the bottom of the screen the doorway read as being behind
 * a wall, and nobody could tell they were allowed to walk to it.
 */
function tavernFront(fb: Framebuffer, x0: number, x1: number): void {
  const FACADE_BASE = 116
  // wall
  ditherRect(fb, { x: x0, y: 18, w: x1 - x0, h: FACADE_BASE - 18 }, C.wood2, C.wood3, 0.45, BAYER8)
  vline(fb, x0, 18, FACADE_BASE, C.wood6)
  hline(fb, x0, x1 - 1, 18, C.wood5)
  // where the building meets the pier: a sill and its shadow on the deck
  hline(fb, x0, x1 - 1, FACADE_BASE, C.wood6)
  hline(fb, x0, x1 - 1, FACADE_BASE + 1, C.wood1)
  hline(fb, x0, x1 - 1, FACADE_BASE + 2, C.wood0)
  // roof beam
  ditherRect(fb, { x: x0 - 6, y: 12, w: x1 - x0 + 6, h: 7 }, C.wood1, C.wood2, 0.5, BAYER4)

  // doorway, standing open
  const dx = x0 + 16
  const dw = 32
  rect(fb, dx, 66, dw, FACADE_BASE - 66, C.wood1)
  rect(fb, dx + 2, 68, dw - 4, FACADE_BASE - 68, C.fire2)
  rect(fb, dx + 4, 72, dw - 8, FACADE_BASE - 72, C.fire3)
  // frame + lintel, so it reads as a way in rather than a lit panel
  vline(fb, dx - 1, 64, FACADE_BASE, C.wood6)
  vline(fb, dx + dw, 64, FACADE_BASE, C.wood6)
  hline(fb, dx - 2, dx + dw + 1, 64, C.wood7)
  hline(fb, dx - 2, dx + dw + 1, 65, C.wood4)

  // The warm wedge of light thrown across the planks. Drawn BEFORE the steps,
  // so the steps read on top of it rather than being washed away.
  polyFill(fb, [
    [dx + 2, FACADE_BASE + 2], [dx + dw - 2, FACADE_BASE + 2], [dx + dw + 14, 143], [dx - 14, 143],
  ] as Pt[], C.fire2)
  polyFill(fb, [
    [dx + 6, FACADE_BASE + 2], [dx + dw - 6, FACADE_BASE + 2], [dx + dw + 4, 143], [dx - 4, 143],
  ] as Pt[], C.fire3)

  // Two steps down onto the pier: the bit that actually says "walk up here".
  for (let s = 0; s < 2; s++) {
    const sy = FACADE_BASE + 3 + s * 5
    const spread = 5 + s * 6
    ditherRect(
      fb,
      { x: dx - spread, y: sy, w: dw + spread * 2, h: 5 },
      C.wood5, C.wood7, 0.5, BAYER4,
    )
    hline(fb, dx - spread, dx + dw + spread - 1, sy, C.wood9)
    hline(fb, dx - spread, dx + dw + spread - 1, sy + 4, C.wood1)
  }
  // hanging sign
  vline(fb, x0 + 8, 24, 34, C.rock2)
  hline(fb, x0 + 8, x0 + 14, 24, C.rock2)
  ditherRect(fb, { x: x0 - 26, y: 34, w: 44, h: 20 }, C.wood8, C.wood9, 0.5, BAYER4)
  hline(fb, x0 - 26, x0 + 17, 34, C.wood10)
  hline(fb, x0 - 26, x0 + 17, 53, C.wood4)
  drawTextCentered(fb, 'EL', x0 - 4, 36, { color: C.wood1 })
  drawTextCentered(fb, 'PATILLA', x0 - 4, 44, { color: C.wood1 })
  void RAMPS
}

function crate(fb: Framebuffer, x: number, y: number, w: number, h: number): void {
  ditherRect(fb, { x, y, w, h }, C.wood3, C.wood4, 0.5, BAYER4)
  hline(fb, x, x + w - 1, y, C.wood6)
  hline(fb, x, x + w - 1, y + h - 1, C.wood1)
  vline(fb, x, y, y + h - 1, C.wood5)
  vline(fb, x + w - 1, y, y + h - 1, C.wood1)
  line(fb, x + 1, y + 1, x + w - 2, y + h - 2, C.wood2)
  line(fb, x + w - 2, y + 1, x + 1, y + h - 2, C.wood2)
}

function barrel(fb: Framebuffer, x: number, y: number): void {
  const w = 13
  const h = 18
  ditherRect(fb, { x, y, w, h }, C.wood3, C.wood4, 0.5, BAYER4)
  vline(fb, x, y + 1, y + h - 2, C.wood5)
  vline(fb, x + w - 1, y + 1, y + h - 2, C.wood1)
  for (const yy of [y + 2, y + h - 4]) {
    hline(fb, x, x + w - 1, yy, C.rock4)
    hline(fb, x, x + w - 1, yy + 1, C.rock2)
  }
  hline(fb, x + 1, x + w - 2, y, C.wood6)
  hline(fb, x + 1, x + w - 2, y + h - 1, C.wood1)
}

function ropeCoil(fb: Framebuffer, x: number, y: number): void {
  for (let r = 7; r >= 2; r -= 2) {
    for (let a = 0; a < 360; a += 8) {
      const rad = (a * Math.PI) / 180
      fb.set(Math.round(x + Math.cos(rad) * r), Math.round(y + Math.sin(rad) * r * 0.4),
        r > 4 ? C.wood8 : C.wood6)
    }
  }
}
