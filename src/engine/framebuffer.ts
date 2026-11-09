/**
 * An 8-bit indexed framebuffer. Every drawing operation in the game writes
 * palette indices here; conversion to RGBA happens once per frame in display.ts.
 */
import { PALETTE_SIZE, TRANSPARENT } from './palette'

export class Framebuffer {
  readonly w: number
  readonly h: number
  readonly px: Uint8Array

  constructor(w: number, h: number, fill = TRANSPARENT) {
    this.w = w
    this.h = h
    this.px = new Uint8Array(w * h)
    if (fill !== 0) this.px.fill(fill)
  }

  clone(): Framebuffer {
    const fb = new Framebuffer(this.w, this.h)
    fb.px.set(this.px)
    return fb
  }

  clear(c = TRANSPARENT): void {
    this.px.fill(c)
  }

  /** Copy another framebuffer of identical size over this one (fast path). */
  copyFrom(src: Framebuffer): void {
    if (src.w !== this.w || src.h !== this.h) throw new Error('copyFrom: size mismatch')
    this.px.set(src.px)
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h
  }

  set(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.px[y * this.w + x] = c
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT
    return this.px[y * this.w + x]
  }

  /**
   * Blit `src` at (dx, dy), skipping transparent pixels.
   * `sx/sy/sw/sh` optionally selects a sub-rectangle of the source.
   * `flipX` mirrors horizontally (used for actors walking left).
   */
  blit(
    src: Framebuffer,
    dx: number,
    dy: number,
    opts: { flipX?: boolean; sx?: number; sy?: number; sw?: number; sh?: number; tint?: number } = {},
  ): void {
    const sx = opts.sx ?? 0
    const sy = opts.sy ?? 0
    const sw = opts.sw ?? src.w
    const sh = opts.sh ?? src.h
    const flip = opts.flipX === true
    for (let y = 0; y < sh; y++) {
      const ty = dy + y
      if (ty < 0 || ty >= this.h) continue
      const srow = (sy + y) * src.w
      const trow = ty * this.w
      for (let x = 0; x < sw; x++) {
        const c = src.px[srow + sx + x]
        if (c === TRANSPARENT) continue
        const tx = dx + (flip ? sw - 1 - x : x)
        if (tx < 0 || tx >= this.w) continue
        this.px[trow + tx] = opts.tint !== undefined ? opts.tint : c
      }
    }
  }

  /** Convert to RGBA into an existing ImageData-compatible Uint32 view. */
  toU32(out: Uint32Array, lut: Uint32Array): void {
    const n = this.px.length
    for (let i = 0; i < n; i++) out[i] = lut[this.px[i]]
  }
}

export { PALETTE_SIZE, TRANSPARENT }
