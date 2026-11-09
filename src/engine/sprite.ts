/**
 * Sprites are authored as ASCII grids: one character per pixel, mapped to
 * palette names. It looks ridiculous in a text editor and it is by far the
 * most maintainable way to hand-draw pixel art inside a codebase — you can
 * see the character's face in the source.
 *
 *   '.' and ' ' are always transparent.
 */
import { Framebuffer } from './framebuffer'
import { C, type ColorName } from './palette'

export type SpriteDef = {
  id: string
  /** char -> palette name (or raw index) */
  colors: Record<string, ColorName | number>
  /** frame name -> rows of pixels */
  frames: Record<string, string[]>
  /**
   * Where the sprite's "feet" are, relative to the grid. Default: bottom
   * centre, which is what the walk system wants.
   */
  anchor?: [number, number]
}

export type Sprite = {
  id: string
  frames: Map<string, Framebuffer>
  anchorX: number
  anchorY: number
  w: number
  h: number
}

export function buildSprite(def: SpriteDef): Sprite {
  const frames = new Map<string, Framebuffer>()
  let maxW = 0
  let maxH = 0

  const lut = new Map<string, number>()
  for (const [ch, col] of Object.entries(def.colors)) {
    lut.set(ch, typeof col === 'number' ? col : (C as Record<string, number>)[col] ?? 0)
  }

  for (const [name, rows] of Object.entries(def.frames)) {
    const h = rows.length
    let w = 0
    for (const r of rows) w = Math.max(w, r.length)
    const fb = new Framebuffer(w, h)
    for (let y = 0; y < h; y++) {
      const row = rows[y]
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (ch === '.' || ch === ' ') continue
        const c = lut.get(ch)
        if (c === undefined) {
          throw new Error(`sprite "${def.id}" frame "${name}": no colour mapped for '${ch}'`)
        }
        fb.set(x, y, c)
      }
    }
    frames.set(name, fb)
    maxW = Math.max(maxW, w)
    maxH = Math.max(maxH, h)
  }

  if (!frames.has('stand')) {
    throw new Error(`sprite "${def.id}" must define a "stand" frame`)
  }

  const anchor = def.anchor ?? [Math.floor(maxW / 2), maxH]
  return { id: def.id, frames, anchorX: anchor[0], anchorY: anchor[1], w: maxW, h: maxH }
}

/**
 * Draw a sprite frame with its anchor (feet) at (x, y). Optionally mirrored
 * and scaled — scaling is nearest-neighbour on purpose: characters further up
 * the screen are smaller, and they must stay made of the same chunky pixels.
 */
export function drawSprite(
  target: Framebuffer,
  sprite: Sprite,
  frame: string,
  x: number,
  y: number,
  opts: { flipX?: boolean; tint?: number; scale?: number } = {},
): void {
  const fb = sprite.frames.get(frame) ?? sprite.frames.get('stand')!
  const s = opts.scale ?? 1

  if (s === 1) {
    const ax = opts.flipX ? fb.w - 1 - sprite.anchorX : sprite.anchorX
    target.blit(fb, Math.round(x) - ax, Math.round(y) - sprite.anchorY, opts)
    return
  }

  const dw = Math.max(1, Math.round(fb.w * s))
  const dh = Math.max(1, Math.round(fb.h * s))
  const ax = Math.round(sprite.anchorX * s)
  const ay = Math.round(sprite.anchorY * s)
  const ox = Math.round(x) - (opts.flipX ? dw - 1 - ax : ax)
  const oy = Math.round(y) - ay
  for (let dy = 0; dy < dh; dy++) {
    const sy = Math.min(fb.h - 1, Math.floor((dy / dh) * fb.h))
    for (let dx = 0; dx < dw; dx++) {
      const sx = Math.min(fb.w - 1, Math.floor((dx / dw) * fb.w))
      const c = fb.px[sy * fb.w + sx]
      if (c === 0) continue
      target.set(ox + (opts.flipX ? dw - 1 - dx : dx), oy + dy, opts.tint ?? c)
    }
  }
}

/**
 * A flat, dithered ellipse shadow under an actor. Cheap, but it glues
 * characters to the ground instead of leaving them floating.
 */
export function dropShadow(
  target: Framebuffer, x: number, y: number, rx: number, color: number,
): void {
  const ry = Math.max(1, Math.round(rx * 0.32))
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / ry
    const span = rx * Math.sqrt(Math.max(0, 1 - t * t))
    for (let dx = -Math.round(span); dx <= Math.round(span); dx++) {
      if (((x + dx + y + dy) & 1) === 0) continue // 50% dither
      target.set(Math.round(x + dx), Math.round(y + dy), color)
    }
  }
}
