/**
 * The start screen: the first thing on the screen, and the press that gets us
 * out of it is what unlocks audio, so the music is already running when the
 * title card appears.
 *
 * Deliberately not pixel-art-island: this is The Agile Monkeys' own mark, in
 * their own strict black and white. It gives the colourful title card that
 * follows something to arrive against.
 */
import { Framebuffer } from '../../engine/framebuffer'
import { C } from '../../engine/palette'
import { RNG } from '../../engine/rng'
import { SCREEN_H, SCREEN_W } from '../../engine/display'
import { disc, hline, rect, vignette } from '../../engine/draw'
import { drawTextScaledCentered } from '../../engine/font'

const MARK_CX = 160
const MARK_CY = 66
const MARK_R = 25

export function paintStart(wordmark: string): Framebuffer {
  const fb = new Framebuffer(SCREEN_W, SCREEN_H, C.black)
  const rng = new RNG('start-card')

  // A very quiet dither over the black, so the screen has some tooth to it
  // rather than looking like a rendering failure.
  for (let i = 0; i < 1400; i++) {
    const x = Math.floor(rng.next() * SCREEN_W)
    const y = Math.floor(rng.next() * SCREEN_H)
    fb.set(x, y, rng.bool(0.7) ? C.ink : C.grey1)
  }

  drawMark(fb, MARK_CX, MARK_CY)

  // --- wordmark ------------------------------------------------------------
  drawTextScaledCentered(fb, wordmark, SCREEN_W / 2, 106, 2, { color: C.white })

  // a hairline rule under it
  hline(fb, 96, 224, 126, C.grey2)
  hline(fb, 118, 202, 127, C.grey1)

  vignette(fb, C.black, 0.5)
  return fb
}

/** The t• mark: a filled disc with the letterform knocked out of it. */
export function drawMark(fb: Framebuffer, cx: number, cy: number): void {
  disc(fb, cx, cy, MARK_R, C.moon2)
  disc(fb, cx, cy, MARK_R - 1, C.white)

  // the 't', knocked out
  const s = 3
  const tX = cx - 11
  const tY = cy - 9
  rect(fb, tX + 3, tY, 3, 18, C.black) // stem
  rect(fb, tX, tY + 5, 9, 3, C.black) // crossbar
  rect(fb, tX + 3, tY + 15, 8, 3, C.black) // foot
  // the bullet
  rect(fb, cx + 8, cy + 6, s, s, C.black)
}
