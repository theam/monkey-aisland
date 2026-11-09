/**
 * The promo's stage: two characters on black, painted one frame at a time
 * from the script's timeline. Everything is a function of time, so any frame
 * can be painted in any order — the video renderer asks for them one by one,
 * the preview page plays them in real time.
 *
 * It uses the game's own pieces — the puppets, the bitmap font, the palette,
 * the lookout painter — so it looks like the game because it is the game.
 *
 * Frames come out at twice the game's resolution. Everything is painted at
 * the game's and doubled, except the small print, which is drawn on the finer
 * grid: the same font at half the size, which is what small print is for.
 */
import { Framebuffer } from '../engine/framebuffer'
import { C } from '../engine/palette'
import { RNG } from '../engine/rng'
import { BAYER4, BAYER8, hline, rect, vline } from '../engine/draw'
import { LINE_H, balanceWrap, drawTextCentered, drawTextScaledCentered, textWidth } from '../engine/font'
import { drawSprite, dropShadow, type Sprite } from '../engine/sprite'
import { buildCast } from '../art/cast'
import { lookout } from '../art/scenes/lookout'
import { drawMark } from '../art/scenes/start'
import { FLAIL_FRAMES, buildSalesman } from './salesman'
import {
  END_CARD, SCRIPT, SMALL_PRINT, actionAt, buildTimeline, type Action, type Line, type Manner,
  type Timeline,
} from './script'

export type Format = 'wide' | 'square'

/**
 * Frame sizes in game pixels, both at 6x (1920x1080 and 1080x1080), so text
 * and characters are the same size in either. The game itself is 320 wide.
 */
export const FORMATS: Record<Format, { w: number; h: number; scale: number }> = {
  wide: { w: 320, h: 180, scale: 6 },
  square: { w: 180, h: 180, scale: 6 },
}

/** Output pixels per game pixel. Only the small print uses the extra ones. */
export const FINE = 2

const WALK_IN_SPEED = 90 // px/s; the game walks at 62, but nobody here has time
const EXIT_SPEED = 85
const WALK_SPEED = 62
const STEP_PX = 6
const TALK_MS = 140
const FLAIL_MS = 110
const FLAIL_BLITZ_MS = 60 // the arms keep up with the mouth
const DOOR_W = 26
const DOOR_H = 50
const DOOR_S = 0.3
const FADE_OUT_S = 0.35
const FADE_IN_S = 0.5

const COLOR = { salesman: C.gold3, player: C.sayPlayer }
const FREEZE_FRAME = 'flail1'

type Layout = {
  w: number
  h: number
  feetY: number
  playerFrom: number
  playerX: number
  salesmanX: number
  centreX: number
  doorX: number
  wrapW: number
}

function layoutFor(w: number, h: number): Layout {
  const cx = Math.round(w / 2)
  return {
    w,
    h,
    feetY: Math.round(h * (w > h ? 0.74 : 0.7)),
    playerFrom: -12,
    playerX: cx - 28,
    salesmanX: cx + 30,
    centreX: cx,
    // a few strides past the salesman, or as far as the frame allows
    doorX: Math.min(w - Math.round(DOOR_W / 2) - 6, cx + 30 + 56),
    wrapW: Math.min(220, w - 12),
  }
}

export class Stage {
  /** the game-resolution picture */
  readonly fb: Framebuffer
  /** the frame as it goes out: `fb` doubled, plus the small print */
  readonly out: Framebuffer
  readonly timeline: Timeline
  private readonly layout: Layout
  private readonly player: Sprite
  private readonly salesman: Sprite
  private readonly island: Framebuffer
  private readonly card: Framebuffer
  /** scratch for drawing one actor on its own, to dissolve it */
  private readonly layer: Framebuffer

  constructor(format: Format) {
    const { w, h } = FORMATS[format]
    this.fb = new Framebuffer(w, h, C.black)
    this.out = new Framebuffer(w * FINE, h * FINE, C.black)
    this.layer = new Framebuffer(w, h)
    this.layout = layoutFor(w, h)
    const player = buildCast().get('player')
    if (!player) throw new Error('the cast has no player')
    this.player = player
    this.salesman = buildSalesman()
    this.timeline = buildTimeline(SCRIPT, (text) => balanceWrap(text, this.layout.wrapW).length)

    // Behind the door: the lookout, the first room of the game, painted with
    // the same seed the game uses, so it is the same moon.
    this.island = new Framebuffer(320, 144, C.black)
    lookout.paint(this.island, new RNG('lookout:lookout'))
    this.card = this.paintCard()
  }

  get duration(): number {
    return this.timeline.duration
  }

  at(action: Action): number {
    return actionAt(this.timeline, action)
  }

  /** Paint the frame at `t` seconds into `this.out`. */
  paint(t: number): Framebuffer {
    this.paintStage(t)
    enlarge(this.fb, this.out)
    this.paintSmallPrint(this.out, t)
    return this.out
  }

  private paintStage(t: number): void {
    const fb = this.fb
    fb.clear(C.black)
    const end = this.at('end_card')
    if (t >= end + FADE_OUT_S) {
      fb.copyFrom(this.card)
      dissolve(fb, 1 - (t - end - FADE_OUT_S) / FADE_IN_S)
      return
    }

    this.paintDoor(fb, t)
    const line = this.lineAt(t)
    const s = this.salesmanAt(t, line)
    const p = this.playerAt(t, line)
    this.drawActor(fb, this.salesman, s)
    if (p) this.drawActor(fb, this.player, p)
    if (line) {
      const pos = line.who === 'player' ? p : s
      if (pos) this.drawSpeech(fb, line, pos.x, pos.sprite)
    }

    if (t >= end) dissolve(fb, (t - end) / FADE_OUT_S)
  }

  // -------------------------------------------------------------------------

  private lineAt(t: number): Line | null {
    return this.timeline.lines.find((l) => t >= l.from && t < l.to) ?? null
  }

  private mannerAt(t: number): Manner {
    let current = this.timeline.manners[0]
    for (const m of this.timeline.manners) if (m.from <= t) current = m
    return current.manner
  }

  private playerAt(t: number, line: Line | null): Pose | null {
    const L = this.layout
    const walkIn = this.at('player_walks_in')
    const leave = this.at('player_leaves')
    if (t < walkIn) return null
    const talking = line?.who === 'player'

    if (t >= leave) {
      const travelled = (t - leave) * EXIT_SPEED
      const x = L.playerX + travelled
      if (x >= L.doorX) return null // through the door
      // dissolving into the moonlight over the last few steps
      const gone = Math.max(0, (x - (L.doorX - DOOR_W / 2)) / (DOOR_W / 2))
      return { x, frame: walkFrame(travelled), flipX: false, sprite: this.player, gone }
    }
    const travelled = (t - walkIn) * WALK_IN_SPEED
    const x = Math.min(L.playerX, L.playerFrom + travelled)
    if (x < L.playerX) return { x, frame: walkFrame(travelled), flipX: false, sprite: this.player }
    return { x, frame: talking ? talkFrame(t, 'talk1', 'talk2') : 'stand', flipX: false, sprite: this.player }
  }

  private salesmanAt(t: number, line: Line | null): Pose {
    const L = this.layout
    const toCentre = this.at('salesman_to_centre')
    const pos = (frame: string): Pose => ({ x: L.salesmanX, frame, flipX: false, sprite: this.salesman })

    if (t >= toCentre) {
      const travelled = (t - toCentre) * WALK_SPEED
      const x = Math.max(L.centreX, L.salesmanX - travelled)
      if (x > L.centreX) return { x, frame: walkFrame(travelled), flipX: true, sprite: this.salesman }
      const p = this.salesmanFrame(t, line)
      return { ...pos(p), x }
    }
    return pos(this.salesmanFrame(t, line))
  }

  private salesmanFrame(t: number, line: Line | null): string {
    const manner = this.mannerAt(t)
    const talking = line?.who === 'salesman'
    switch (manner) {
      case 'flail':
        return talking ? flailFrame(t, line.pace === 'blitz' ? FLAIL_BLITZ_MS : FLAIL_MS) : 'stand'
      case 'freeze':
        // stopped dead mid-gesture, one hand still in the air
        return FREEZE_FRAME
      case 'think':
        return talking ? talkFrame(t, 'think', 'thinkTalk') : 'think'
      case 'point':
        return talking ? talkFrame(t, 'point', 'pointTalk') : 'point'
      case 'deadpan':
        return talking ? talkFrame(t, 'deadpan', 'deadpanTalk') : 'deadpan'
      case 'present':
        return talking ? talkFrame(t, 'present', 'present2') : 'present'
      case 'stand':
        return talking ? talkFrame(t, 'talk1', 'talk2') : 'stand'
    }
  }

  private drawActor(fb: Framebuffer, sprite: Sprite, p: Pose): void {
    const y = this.layout.feetY
    if (!p.gone) {
      dropShadow(fb, p.x, y, 7, C.ink)
      drawSprite(fb, sprite, p.frame, p.x, y, { flipX: p.flipX })
      return
    }
    // The same ordered dither as the fades, applied to the sprite alone.
    const layer = this.layer
    layer.clear()
    drawSprite(layer, sprite, p.frame, p.x, y, { flipX: p.flipX })
    for (let i = 0; i < layer.px.length; i++) {
      const c = layer.px[i]
      const x = i % layer.w
      if (c && BAYER4[Math.floor(i / layer.w) & 3][x & 3] >= p.gone) fb.px[i] = c
    }
  }

  /** As the game draws speech: centred over the head, in the speaker's colour. */
  private drawSpeech(fb: Framebuffer, line: Line, x: number, sprite: Sprite): void {
    const L = this.layout
    const lines = balanceWrap(line.text, L.wrapW)
    const headTop = L.feetY - sprite.h
    const y0 = Math.max(2, Math.round(headTop - 4 - lines.length * LINE_H))
    const widest = Math.max(...lines.map(textWidth))
    const cx = Math.max(4 + widest / 2, Math.min(L.w - 4 - widest / 2, Math.round(x)))
    lines.forEach((text, i) => {
      drawTextCentered(fb, text, cx, y0 + i * LINE_H, { color: COLOR[line.who], outlineColor: C.black })
    })
  }

  // --- the door into the game ---------------------------------------------

  private doorWidth(t: number): number {
    const opens = this.at('door_opens')
    if (t < opens) return 0
    const L = this.layout
    const through = this.at('player_leaves') + (L.doorX - L.playerX) / EXIT_SPEED
    const closes = through + 0.15
    const k = t < closes
      ? Math.min(1, (t - opens) / DOOR_S)
      : Math.max(0, 1 - (t - closes) / DOOR_S)
    return Math.round(DOOR_W * k)
  }

  private paintDoor(fb: Framebuffer, t: number): void {
    const open = this.doorWidth(t)
    if (open <= 0) return
    const L = this.layout
    const x0 = Math.round(L.doorX - open / 2)
    const left = Math.round(L.doorX - DOOR_W / 2)
    const y1 = L.feetY
    const y0 = y1 - DOOR_H

    // Moonlight on the floor in front of it: the only floor in the void.
    for (let dy = 1; dy <= 7; dy++) {
      const spread = Math.round(open / 2 + dy * 1.5)
      for (let x = L.doorX - spread; x <= L.doorX + spread; x++) {
        const fall = dy / 8 + Math.abs(x - L.doorX) / (spread * 3)
        if (BAYER8[(y1 + dy) & 7][x & 7] > fall) fb.set(x, y1 + dy, dy < 3 ? C.sea4 : C.sea3)
      }
    }

    // The view, revealed rather than squashed as the door opens: the moon
    // over the sea, from the lookout.
    const srcX = 233
    const srcY = 14
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x0 + open; x++) {
        fb.set(x, y, this.island.get(srcX + x - left, srcY + y - y0))
      }
    }

    // the frame
    rect(fb, x0 - 2, y0 - 2, open + 4, 2, C.wood5)
    vline(fb, x0 - 2, y0 - 2, y1, C.wood7)
    vline(fb, x0 - 1, y0, y1, C.wood5)
    vline(fb, x0 + open, y0, y1, C.wood3)
    vline(fb, x0 + open + 1, y0 - 2, y1, C.wood2)
    hline(fb, x0 - 2, x0 + open + 1, y1, C.wood4)
  }

  // --- the small print -----------------------------------------------------

  /** On the fine grid, so `out`, not `fb`. Gone with the line it hangs off. */
  private paintSmallPrint(out: Framebuffer, t: number): void {
    const line = this.lineAt(this.at('small_print'))
    if (!line || t < line.from || t >= line.to) return
    // a tidy block under the price, not a ticker across the whole frame
    const lines = balanceWrap(SMALL_PRINT, Math.min(out.w - 32, 440))
    // Just under their feet, not on the bottom edge: pausing to read it is
    // the joke, and pausing brings up the player's controls over the bottom.
    let y = (this.layout.feetY + 10) * FINE
    for (const text of lines) {
      drawTextCentered(out, text, out.w / 2, y, { color: C.grey4 })
      y += LINE_H
    }
  }

  // --- the end card --------------------------------------------------------

  /** The game's start screen, rearranged: mark, wordmark, the offer, the link. */
  private paintCard(): Framebuffer {
    const { w, h } = this.layout
    const fb = new Framebuffer(w, h, C.black)
    const rng = new RNG('promo-card')
    for (let i = 0; i < Math.round((w * h) / 46); i++) {
      fb.set(Math.floor(rng.next() * w), Math.floor(rng.next() * h), rng.bool(0.7) ? C.ink : C.grey1)
    }
    const cx = Math.round(w / 2)
    const top = Math.round((h - 120) / 2)
    drawMark(fb, cx, top + 26)
    drawTextScaledCentered(fb, END_CARD.wordmark, cx, top + 58, 2, { color: C.white })
    drawTextScaledCentered(fb, END_CARD.hiring, cx, top + 84, 2, { color: C.gold3 })
    drawTextCentered(fb, END_CARD.url, cx, top + 110, { color: C.grey5 })
    return fb
  }
}

/** `gone`: 0 is all there, 1 is dissolved away */
type Pose = { x: number; frame: string; flipX: boolean; sprite: Sprite; gone?: number }

function walkFrame(travelled: number): string {
  return `walk${(Math.floor(travelled / STEP_PX) % 4) + 1}`
}

function talkFrame(t: number, a: string, b: string): string {
  return Math.floor((t * 1000) / TALK_MS) % 2 === 0 ? b : a
}

function flailFrame(t: number, ms: number): string {
  return FLAIL_FRAMES[Math.floor((t * 1000) / ms) % FLAIL_FRAMES.length]
}

/** Nearest-neighbour, by a whole number: every game pixel becomes a FINE x FINE block. */
function enlarge(src: Framebuffer, dst: Framebuffer): void {
  for (let y = 0; y < dst.h; y++) {
    const row = Math.floor(y / FINE) * src.w
    for (let x = 0; x < dst.w; x++) dst.px[y * dst.w + x] = src.px[row + Math.floor(x / FINE)]
  }
}

/** The game's ordered dissolve to black, with all sixteen steps. */
function dissolve(fb: Framebuffer, amount: number): void {
  if (amount <= 0) return
  for (let y = 0; y < fb.h; y++) {
    for (let x = 0; x < fb.w; x++) {
      if (BAYER4[y & 3][x & 3] < amount) fb.set(x, y, C.black)
    }
  }
}
