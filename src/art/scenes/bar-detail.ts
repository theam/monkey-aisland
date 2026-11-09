/**
 * El Patilla: painting implementation. Room is 440 wide; the camera follows.
 *
 * Warm interior, one cold note (the door back out to the dock) so the room has
 * something to be warm against. Layout must match scene-bar.yaml:
 *   8..48     the door out to the dock
 *   72..118   fireplace
 *   128..168  notice board
 *   186..262  the big table where the three engineers sit
 *   312..438  the bar counter; bottles on the wall behind it
 *
 * The counter front is painted into the FOREGROUND layer so the barman stands
 * behind it instead of on it.
 */
import { Framebuffer } from '../../engine/framebuffer'
import { C } from '../../engine/palette'
import type { RNG } from '../../engine/rng'
import { drawTextCentered } from '../../engine/font'
import {
  BAYER4, BAYER8, catenary, disc, ditherRect, gradientV, hline, lightPool, line, polyFill,
  rect, speckle, vignette, vline, type Pt,
} from '../../engine/draw'

const FLOOR_Y = 112
const LAMPS = [96, 208, 330]
/** Near end of the bar counter. The walkbox in scene-bar.yaml stops before it. */
const COUNTER_X = 316
/** The service gate sits between the walkable floor and the counter. */
const GATE_X = 304

export function paintBar(fb: Framebuffer, rng: RNG): void {
  // --- walls ---------------------------------------------------------------
  // rough plaster over stone, warmer near the lamps
  gradientV(fb, { x: 0, y: 0, w: fb.w, h: FLOOR_Y }, [C.wood0, C.wood1, C.wood2, C.wood3], 0.1, 0.85, BAYER8)
  speckle(fb, { x: 0, y: 0, w: fb.w, h: FLOOR_Y }, rng.fork('plaster'), [C.wood1, C.wood4], 0.05)


  // Wainscoting along the bottom of the wall: vertical planks, darker than the
  // plaster, so the cast has something plain to stand against.
  const WAINSCOT = FLOOR_Y - 30
  ditherRect(fb, { x: 0, y: WAINSCOT, w: fb.w, h: FLOOR_Y - WAINSCOT }, C.wood0, C.wood1, 0.45, BAYER8)
  for (let x = 0; x < fb.w; x += 9) {
    vline(fb, x, WAINSCOT + 3, FLOOR_Y - 1, C.wood0)
    vline(fb, x + 1, WAINSCOT + 3, FLOOR_Y - 1, C.wood2)
  }
  // capping rail
  hline(fb, 0, fb.w - 1, WAINSCOT, C.wood4)
  hline(fb, 0, fb.w - 1, WAINSCOT + 1, C.wood5)
  hline(fb, 0, fb.w - 1, WAINSCOT + 2, C.wood1)

  // --- ceiling beams -------------------------------------------------------
  ditherRect(fb, { x: 0, y: 0, w: fb.w, h: 10 }, C.wood0, C.wood1, 0.4, BAYER4)
  for (let x = -6; x < fb.w; x += 54) {
    ditherRect(fb, { x, y: 0, w: 11, h: 16 }, C.wood1, C.wood2, 0.45, BAYER4)
    vline(fb, x, 0, 15, C.wood4)
    vline(fb, x + 10, 0, 15, C.wood0)
    hline(fb, x, x + 10, 15, C.wood0)
  }

  // --- floor ---------------------------------------------------------------
  gradientV(
    fb,
    { x: 0, y: FLOOR_Y, w: fb.w, h: 144 - FLOOR_Y },
    [C.wood2, C.wood3, C.wood4, C.wood6],
    0.1,
    0.9,
    BAYER8,
  )
  for (let i = 0; i < 10; i++) {
    const y = FLOOR_Y + Math.round(Math.pow(i / 10, 1.4) * (143 - FLOOR_Y))
    hline(fb, 0, fb.w - 1, y, C.wood1)
  }
  for (let x = 6; x < fb.w; x += 31) vline(fb, x, FLOOR_Y, 143, C.wood2)
  hline(fb, 0, fb.w - 1, FLOOR_Y, C.wood6)
  speckle(fb, { x: 0, y: FLOOR_Y, w: fb.w, h: 144 - FLOOR_Y }, rng.fork('floor'),
    [C.wood2, C.wood7], 0.02)

  // --- the door back out to the dock: the one cold thing in the room -------
  door(fb, 8, 40)

  // --- fireplace -----------------------------------------------------------
  fireplace(fb, 72, 46)

  // --- notice board --------------------------------------------------------
  noticeBoard(fb, rng.fork('notices'), 130, 58)

  // --- the shelf of Arehucas behind the bar --------------------------------
  bottleShelf(fb, rng.fork('bottles'), 336, 54)

  // --- back bar ------------------------------------------------------------
  ditherRect(fb, { x: COUNTER_X, y: 84, w: 440 - COUNTER_X, h: 10 }, C.wood2, C.wood3, 0.5, BAYER4)
  hline(fb, COUNTER_X, 437, 84, C.wood6)

  // --- table and stools ----------------------------------------------------
  table(fb, 186, 104, 76)
  stool(fb, 176, 130)
  stool(fb, 268, 128)
  stool(fb, 226, 134)

  // --- hanging oil lamps ---------------------------------------------------
  for (const x of LAMPS) {
    hangingLamp(fb, x, 0, 34)
    lightPool(fb, x, 40, 62, C.fire4, 0.55, BAYER8, 0.9)
    lightPool(fb, x, 120, 66, C.fire3, 0.3, BAYER8, 2.4)
  }

  // a couple of pictures nobody looks at
  smallFrame(fb, 284, 40, 26, 20)
  smallFrame(fb, 44, 52, 20, 24)

  vignette(fb, C.wood0, 0.55)
}

/** Drawn after the actors: the barman stands behind this. */
export function paintBarForeground(fb: Framebuffer): void {
  // counter front
  ditherRect(fb, { x: COUNTER_X, y: 100, w: 440 - COUNTER_X, h: 30 }, C.wood2, C.wood3, 0.45, BAYER4)
  // counter top, catching the lamplight, with a lip overhanging the near end
  hline(fb, COUNTER_X - 4, 439, 98, C.wood9)
  hline(fb, COUNTER_X - 4, 439, 99, C.wood8)
  hline(fb, COUNTER_X - 4, 439, 100, C.wood7)
  hline(fb, COUNTER_X - 3, 439, 101, C.wood5)
  // the visible END of the counter: a lit vertical edge, so it reads as a solid
  // object with a near side rather than a flat band across the room
  vline(fb, COUNTER_X, 100, 130, C.wood7)
  vline(fb, COUNTER_X + 1, 101, 130, C.wood6)
  // panelling
  for (let x = COUNTER_X + 8; x < 440; x += 18) {
    vline(fb, x, 104, 126, C.wood1)
    vline(fb, x + 1, 104, 126, C.wood4)
  }
  hline(fb, COUNTER_X, 439, 128, C.wood1)
  hline(fb, COUNTER_X, 439, 129, C.wood0)
  // a brass rail
  hline(fb, COUNTER_X + 3, 437, 112, C.gold1)

  // The service gate: this is what stops the player walking behind the bar.
  // Without something physical here, the walkbox edge reads as a glitch.
  barGate(fb, GATE_X, 99, COUNTER_X - GATE_X + 1, 31)

  // mugs left on the counter
  mug(fb, COUNTER_X + 18, 98)
  mug(fb, COUNTER_X + 40, 98)
  mug(fb, 402, 98)

  // the near edge of the big table, so people can sit "behind" it
  ditherRect(fb, { x: 186, y: 118, w: 76, h: 5 }, C.wood3, C.wood4, 0.5, BAYER4)
  hline(fb, 186, 261, 117, C.wood7)
  hline(fb, 186, 261, 122, C.wood1)
}

export function animateBar(fb: Framebuffer, t: number): void {
  // fire
  const f = Math.sin(t * 9) * 0.5 + Math.sin(t * 14.3) * 0.5
  const fx = 95
  const fy = 96
  disc(fb, fx, fy - 3 + f * 0.6, 7 + f, C.fire2)
  disc(fb, fx + f, fy - 5, 5, C.fire3)
  disc(fb, fx - f * 0.5, fy - 7 - f, 3, C.fire5)
  disc(fb, fx + f * 0.6, fy - 9 - f * 1.5, 1.5, C.fire7)
  lightPool(fb, fx, fy - 6, 40 + f * 4, C.fire4, 0.4, BAYER8, 1.1)

  // lamps swing very slightly and flicker
  LAMPS.forEach((x, i) => {
    const s = Math.sin(t * 1.2 + i * 2.1) * 1.4
    const fl = Math.sin(t * (8 + i * 1.3) + i) * 0.5 + Math.sin(t * (12 + i)) * 0.5
    disc(fb, x + s, 36, 3 + fl * 0.4, C.fire4)
    disc(fb, x + s, 35, 1.8, C.fire6)
    disc(fb, x + s, 34.5, 0.9, C.fire7)
    if (fl > 0.3) lightPool(fb, x + s, 38, 22, C.fire5, 0.2, BAYER4, 1)
  })
}

// ---------------------------------------------------------------------------

function door(fb: Framebuffer, x: number, y: number): void {
  rect(fb, x - 4, y - 4, 48, 80, C.wood1)
  ditherRect(fb, { x, y, w: 40, h: 74 }, C.wood2, C.wood3, 0.5, BAYER4)
  // the night outside, seen through the top half
  ditherRect(fb, { x: x + 4, y: y + 4, w: 32, h: 26 }, C.sea1, C.sea3, 0.4, BAYER8)
  hline(fb, x + 4, x + 35, y + 4, C.sea5)
  for (let i = 0; i < 7; i++) {
    fb.set(x + 6 + i * 4, y + 8 + ((i * 5) % 18), C.moon1)
  }
  // planks + hinges
  for (let i = 0; i < 5; i++) vline(fb, x + 4 + i * 8, y + 32, y + 72, C.wood1)
  for (const hy of [y + 38, y + 64]) {
    hline(fb, x, x + 12, hy, C.rock4)
    hline(fb, x, x + 12, hy + 1, C.rock2)
  }
  disc(fb, x + 34, y + 52, 1.6, C.gold2)
  // cold light spilling in
  lightPool(fb, x + 20, y + 60, 40, C.sea5, 0.3, BAYER8, 1.4)
}

function fireplace(fb: Framebuffer, x: number, y: number): void {
  const w = 46
  const h = 66
  // stone surround
  ditherRect(fb, { x: x - 6, y, w: w + 12, h }, C.rock2, C.rock3, 0.5, BAYER8)
  for (let yy = y; yy < y + h; yy += 8) {
    hline(fb, x - 6, x + w + 5, yy, C.rock1)
    for (let xx = x - 6 + (yy % 16 === 0 ? 0 : 8); xx < x + w + 5; xx += 16) {
      vline(fb, xx, yy, yy + 7, C.rock1)
      hline(fb, xx + 1, xx + 14, yy + 1, C.rock5)
    }
  }
  // mantel
  ditherRect(fb, { x: x - 10, y: y - 6, w: w + 20, h: 7 }, C.wood2, C.wood4, 0.5, BAYER4)
  hline(fb, x - 10, x + w + 9, y - 6, C.wood7)
  // the opening
  polyFill(fb, [
    [x, y + h], [x, y + 22], [x + w / 2, y + 12], [x + w, y + 22], [x + w, y + h],
  ] as Pt[], C.wood0)
  // logs
  for (let i = 0; i < 4; i++) {
    const lx = x + 8 + i * 7
    line(fb, lx, y + h - 4, lx + 8, y + h - 12, C.wood2)
    line(fb, lx + 1, y + h - 4, lx + 9, y + h - 12, C.wood4)
  }
  // embers
  disc(fb, x + w / 2, y + h - 6, 8, C.fire1)
  disc(fb, x + w / 2, y + h - 6, 5, C.fire2)
}

/**
 * The notice board. Sized around its contents rather than the other way round:
 * "HIRING" is 35px in this font, so the card under it has to be at least 38 and
 * the board at least 46, or the letters spill off the paper.
 */
function noticeBoard(fb: Framebuffer, rng: RNG, x: number, y: number): void {
  const w = 48
  const h = 38
  rect(fb, x - 2, y - 2, w + 4, h + 4, C.wood1)
  ditherRect(fb, { x, y, w, h }, C.wood4, C.wood5, 0.5, BAYER4)
  hline(fb, x, x + w - 1, y, C.wood7)
  // Scribbled notes nobody reads: a lute teacher, a lost parrot, a deploy rota.
  const notes: Array<[number, number, number, number, number]> = [
    [x + 3, y + 3, 18, 13, C.wood9],
    [x + 25, y + 4, 19, 12, C.wood10],
  ]
  for (const [nx, ny, nw, nh, col] of notes) {
    rect(fb, nx, ny, nw, nh, col)
    hline(fb, nx, nx + nw - 1, ny + nh - 1, C.wood5)
    for (let i = 2; i < nh - 2; i += 3) {
      hline(fb, nx + 2, nx + nw - 3 - rng.int(0, 4), ny + i, C.wood4)
    }
    fb.set(nx + Math.floor(nw / 2), ny + 1, C.red2)
  }

  // The one that matters gets a clean card, wide enough for the word on it.
  const cardW = 40
  const cardH = 14
  const cx = x + Math.round((w - cardW) / 2)
  const cy = y + 19
  rect(fb, cx, cy, cardW, cardH, C.moon2)
  hline(fb, cx, cx + cardW - 1, cy + cardH - 1, C.wood5)
  vline(fb, cx + cardW - 1, cy, cy + cardH - 1, C.wood5)
  fb.set(cx + Math.floor(cardW / 2), cy + 1, C.red2)
  drawTextCentered(fb, 'HIRING', cx + cardW / 2, cy + 3, { color: C.red1 })
}

function bottleShelf(fb: Framebuffer, rng: RNG, x: number, y: number): void {
  const w = 96
  for (let s = 0; s < 2; s++) {
    const sy = y + s * 16
    // the shelf plank
    ditherRect(fb, { x, y: sy + 12, w, h: 3 }, C.wood2, C.wood4, 0.5, BAYER4)
    hline(fb, x, x + w - 1, sy + 12, C.wood7)
    // bottles
    let bx = x + 2
    while (bx < x + w - 5) {
      const bh = rng.int(8, 12)
      const bw = rng.int(3, 5)
      const glass = rng.pick([C.teal2, C.teal3, C.wood6, C.fire2, C.teal1])
      rect(fb, bx, sy + 12 - bh, bw, bh, glass)
      vline(fb, bx, sy + 12 - bh, sy + 11, rng.bool(0.5) ? C.teal4 : C.wood8)
      // neck
      vline(fb, bx + Math.floor(bw / 2), sy + 12 - bh - 3, sy + 12 - bh, glass)
      // label
      if (rng.bool(0.6)) hline(fb, bx, bx + bw - 1, sy + 12 - Math.floor(bh / 2), C.wood10)
      bx += bw + rng.int(1, 3)
    }
  }
  // a sign over the shelf
  ditherRect(fb, { x: x + 16, y: y - 14, w: 64, h: 12 }, C.wood8, C.wood9, 0.5, BAYER4)
  hline(fb, x + 16, x + 79, y - 14, C.wood10)
  hline(fb, x + 16, x + 79, y - 3, C.wood4)
  drawTextCentered(fb, 'AREHUCAS', x + 48, y - 13, { color: C.wood1 })
}

function table(fb: Framebuffer, x: number, y: number, w: number): void {
  // top
  ditherRect(fb, { x, y, w, h: 8 }, C.wood4, C.wood5, 0.5, BAYER4)
  hline(fb, x, x + w - 1, y, C.wood8)
  hline(fb, x, x + w - 1, y + 7, C.wood1)
  // legs
  for (const lx of [x + 6, x + w - 8]) {
    vline(fb, lx, y + 8, y + 26, C.wood2)
    vline(fb, lx + 1, y + 8, y + 26, C.wood4)
  }
  // things on the table
  mug(fb, x + 14, y)
  mug(fb, x + 30, y)
  mug(fb, x + 54, y)
  rect(fb, x + 40, y - 2, 9, 3, C.moon1) // a napkin with an architecture diagram
  line(fb, x + 41, y - 1, x + 47, y - 1, C.rock3)
}

function stool(fb: Framebuffer, x: number, y: number): void {
  ditherRect(fb, { x: x - 6, y, w: 13, h: 4 }, C.wood3, C.wood5, 0.5, BAYER4)
  hline(fb, x - 6, x + 6, y, C.wood7)
  for (const lx of [x - 5, x + 4]) line(fb, lx, y + 4, lx + (lx < x ? -1 : 1), y + 14, C.wood2)
  line(fb, x, y + 4, x, y + 14, C.wood2)
}

/**
 * A little hinged gate across the end of the bar, closed. Lighter than the
 * counter front so it reads as a separate thing standing in the player's way.
 */
function barGate(fb: Framebuffer, x: number, y: number, w: number, h: number): void {
  const bottom = y + h - 1
  // hinge post
  vline(fb, x, y, bottom, C.wood2)
  vline(fb, x + 1, y, bottom, C.wood5)
  for (const hy of [y + 5, y + h - 8]) {
    hline(fb, x, x + 4, hy, C.rock4)
    hline(fb, x, x + 4, hy + 1, C.rock2)
  }
  // top and bottom rails
  hline(fb, x, x + w - 1, y + 2, C.wood6)
  hline(fb, x, x + w - 1, y + 3, C.wood4)
  hline(fb, x, x + w - 1, bottom - 3, C.wood4)
  hline(fb, x, x + w - 1, bottom - 2, C.wood2)
  // slats
  for (let sx = x + 3; sx < x + w - 1; sx += 4) {
    vline(fb, sx, y + 4, bottom - 4, C.wood4)
    vline(fb, sx + 1, y + 4, bottom - 4, C.wood2)
  }
  // diagonal brace — the detail that makes it read as a gate and not a fence
  line(fb, x + 1, bottom - 4, x + w - 2, y + 4, C.wood6)
  line(fb, x + 2, bottom - 4, x + w - 1, y + 4, C.wood3)
  // latch on the far side
  hline(fb, x + w - 3, x + w + 1, y + Math.round(h / 2), C.gold2)
  fb.set(x + w + 1, y + Math.round(h / 2) + 1, C.gold1)
}

function mug(fb: Framebuffer, x: number, y: number): void {
  rect(fb, x, y - 7, 6, 7, C.wood6)
  vline(fb, x, y - 7, y - 1, C.wood8)
  vline(fb, x + 5, y - 7, y - 1, C.wood3)
  hline(fb, x, x + 5, y - 7, C.wood9)
  // handle
  fb.set(x + 6, y - 6, C.wood5)
  fb.set(x + 7, y - 5, C.wood5)
  fb.set(x + 6, y - 4, C.wood5)
}

function hangingLamp(fb: Framebuffer, x: number, ceilingY: number, len: number): void {
  vline(fb, x, ceilingY, ceilingY + len - 8, C.rock2)
  catenary(fb, [x - 7, ceilingY + len - 10], [x + 7, ceilingY + len - 10], 2, C.rock3)
  // the lantern body
  ditherRect(fb, { x: x - 5, y: ceilingY + len - 8, w: 11, h: 10 }, C.rock2, C.rock3, 0.5, BAYER4)
  rect(fb, x - 3, ceilingY + len - 6, 7, 6, C.fire2)
  disc(fb, x, ceilingY + len - 3, 2.2, C.fire5)
  hline(fb, x - 6, x + 6, ceilingY + len - 9, C.rock4)
  hline(fb, x - 5, x + 5, ceilingY + len + 2, C.rock2)
}

function smallFrame(fb: Framebuffer, x: number, y: number, w: number, h: number): void {
  rect(fb, x, y, w, h, C.wood2)
  hline(fb, x, x + w - 1, y, C.wood5)
  vline(fb, x, y, y + h - 1, C.wood4)
  ditherRect(fb, { x: x + 2, y: y + 2, w: w - 4, h: h - 4 }, C.wood6, C.wood7, 0.4, BAYER4)
  // a vague seascape, because every bar has one
  hline(fb, x + 3, x + w - 4, y + Math.floor(h / 2), C.sea3)
  polyFill(fb, [
    [x + 4, y + h - 4], [x + 9, y + Math.floor(h / 2) - 3], [x + 15, y + h - 4],
  ] as Pt[], C.rock2)
}
