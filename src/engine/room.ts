/**
 * A room = a scene definition + its procedurally painted background.
 *
 * The background is painted ONCE into `base` (this is the expensive part), then
 * every frame we memcpy it into `work` and let the painter add its cheap
 * animation (water shimmer, lamp flicker, drifting clouds) on top.
 */
import type { SceneDef, Vec2 } from './content'
import { Framebuffer } from './framebuffer'
import { ROOM_H, SCREEN_W } from './display'
import { RNG } from './rng'
import { polyBounds } from './geom'

export type ScenePainter = {
  id: string
  /** Paint the static background. `fb` is scene width x ROOM_H. */
  paint: (fb: Framebuffer, rng: RNG) => void
  /**
   * Optional foreground layer, drawn AFTER the actors so things can stand in
   * front of them — the bar counter, a barrel, a rope. Leave pixels
   * transparent (index 0) everywhere you want the actors to show through.
   */
  paintForeground?: (fb: Framebuffer, rng: RNG) => void
  /** Optional per-frame overlay, drawn onto a fresh copy of the base. */
  animate?: (fb: Framebuffer, t: number, rng: RNG) => void
  /** Optional palette-cycling: index -> hex, applied globally this frame. */
  paletteCycle?: (t: number) => ReadonlyMap<number, string> | null
}

export class Room {
  readonly def: SceneDef
  readonly painter: ScenePainter
  readonly base: Framebuffer
  readonly work: Framebuffer
  readonly fg: Framebuffer | null
  private rng: RNG
  private walkTop: number
  private walkBottom: number

  constructor(def: SceneDef, painter: ScenePainter) {
    this.def = def
    this.painter = painter
    this.base = new Framebuffer(def.width, ROOM_H, 1 /* black, never transparent */)
    this.work = new Framebuffer(def.width, ROOM_H)
    this.rng = new RNG(`${def.id}:${painter.id}`)
    painter.paint(this.base, this.rng)
    if (painter.paintForeground) {
      this.fg = new Framebuffer(def.width, ROOM_H)
      painter.paintForeground(this.fg, new RNG(`${def.id}:fg`))
    } else {
      this.fg = null
    }
    const b = polyBounds(def.walkbox)
    this.walkTop = b.y
    this.walkBottom = b.y + b.h
  }

  get width(): number {
    return this.def.width
  }

  get walkbox(): readonly Vec2[] {
    return this.def.walkbox
  }

  /** Actor scale from depth: characters shrink as they walk "up" the room. */
  scaleAt(y: number): number {
    const s = this.def.scale
    if (!s) return 1
    const span = this.walkBottom - this.walkTop
    if (span <= 0) return s.bottom
    const t = Math.min(1, Math.max(0, (y - this.walkTop) / span))
    return s.top + (s.bottom - s.top) * t
  }

  maxCamX(): number {
    return Math.max(0, this.width - SCREEN_W)
  }

  /** Fresh frame of background, animation applied. */
  render(t: number): Framebuffer {
    this.work.copyFrom(this.base)
    this.painter.animate?.(this.work, t, this.rng)
    return this.work
  }
}
