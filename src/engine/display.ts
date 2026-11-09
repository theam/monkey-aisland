/**
 * Screen + input. Owns the canvas, responsive scaling, the RGBA conversion,
 * and the pointer/keyboard state the game reads once per frame.
 */
import { Framebuffer } from './framebuffer'
import { buildLut } from './palette'
import { TOUCH_PRIMARY_QUERY } from '../platform/media'
import { isOverlayOpen } from './overlay'

export const SCREEN_W = 320
export const SCREEN_H = 200
/** The room view — the SCUMM layout puts the verb panel under it. */
export const ROOM_H = 144

/** DOM controls whose key presses the game must leave alone. */
const PAGE_CONTROLS = 'button, a[href], input, select, textarea, summary'

export type Pointer = {
  x: number
  y: number
  /** inside the canvas at all */
  over: boolean
  down: boolean
  justPressed: boolean
  justReleased: boolean
  rightJustPressed: boolean
  /** true when the last input came from a touch — used to soften hover-only UI */
  touch: boolean
  /** double click within 350ms, used for "run"/skip */
  doubleClick: boolean
}

export class Display {
  readonly canvas: HTMLCanvasElement
  readonly fb: Framebuffer
  readonly pointer: Pointer = {
    x: 160, y: 100, over: false, down: false,
    justPressed: false, justReleased: false, rightJustPressed: false,
    touch: false, doubleClick: false,
  }

  /** Keys pressed since last frame (lowercased, e.g. 'escape', ' ', 'a'). */
  readonly keysPressed = new Set<string>()
  readonly keysDown = new Set<string>()

  private ctx: CanvasRenderingContext2D
  private image: ImageData
  private u32: Uint32Array
  private lut: Uint32Array
  private lastClickAt = 0
  private readonly touchPrimary = matchMedia(TOUCH_PRIMARY_QUERY)

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    canvas.width = SCREEN_W
    canvas.height = SCREEN_H
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas not available')
    this.ctx = ctx
    this.ctx.imageSmoothingEnabled = false
    this.image = ctx.createImageData(SCREEN_W, SCREEN_H)
    this.u32 = new Uint32Array(this.image.data.buffer)
    this.lut = buildLut()
    this.fb = new Framebuffer(SCREEN_W, SCREEN_H)

    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('orientationchange', () => this.resize())
    window.visualViewport?.addEventListener('resize', () => this.resize())
    const viewport = canvas.parentElement
    if (viewport) new ResizeObserver(() => this.resize()).observe(viewport)
    this.bindInput()
  }

  get usesTouchControls(): boolean {
    return this.touchPrimary.matches
  }

  /** Swap in palette overrides (palette-cycling animation) — cheap. */
  setPaletteOverrides(overrides?: ReadonlyMap<number, string>): void {
    this.lut = buildLut(overrides)
  }

  private resize(): void {
    const viewport = this.canvas.parentElement
    const availW = viewport?.clientWidth ?? window.innerWidth
    const availH = viewport?.clientHeight ?? window.innerHeight
    const raw = Math.min(availW / SCREEN_W, availH / SCREEN_H)
    const integerScale = Math.floor(raw)
    const s = this.usesTouchControls || integerScale < 1 ? raw : integerScale
    this.canvas.style.width = `${Math.round(SCREEN_W * s)}px`
    this.canvas.style.height = `${Math.round(SCREEN_H * s)}px`
  }

  private toLogical(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * SCREEN_W
    const y = ((clientY - r.top) / r.height) * SCREEN_H
    return [x, y]
  }

  private bindInput(): void {
    const c = this.canvas

    const move = (e: PointerEvent) => {
      const [x, y] = this.toLogical(e.clientX, e.clientY)
      this.pointer.x = x
      this.pointer.y = y
      this.pointer.over = x >= 0 && y >= 0 && x < SCREEN_W && y < SCREEN_H
      this.pointer.touch = e.pointerType === 'touch'
    }

    c.addEventListener('pointermove', move)
    c.addEventListener('pointerenter', move)
    c.addEventListener('pointerleave', () => {
      this.pointer.over = false
    })

    c.addEventListener('pointerdown', (e) => {
      move(e)
      c.setPointerCapture?.(e.pointerId)
      if (e.button === 2) {
        this.pointer.rightJustPressed = true
      } else {
        this.pointer.down = true
        this.pointer.justPressed = true
        const now = performance.now()
        if (now - this.lastClickAt < 350) this.pointer.doubleClick = true
        this.lastClickAt = now
      }
      e.preventDefault()
    })

    c.addEventListener('pointerup', (e) => {
      move(e)
      if (e.button !== 2) {
        this.pointer.down = false
        this.pointer.justReleased = true
      }
      e.preventDefault()
    })

    c.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('keydown', (e) => {
      // A key aimed at a real control on the page — the Privacy link, a button
      // in an overlay — belongs to that control. Otherwise Space on the
      // Privacy link would start the game instead of opening the panel.
      if (e.target instanceof Element && e.target.closest(PAGE_CONTROLS)) return
      // So does any key while an overlay is open, wherever focus is. The
      // Escape that closes the privacy panel would otherwise still be waiting
      // for the start screen on the next frame, and count as "any key".
      if (isOverlayOpen()) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
      this.keysPressed.add(k)
      this.keysDown.add(k)
      // Don't hijack browser shortcuts, but do stop page scroll on space/arrows.
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => {
      this.keysDown.clear()
      this.pointer.down = false
    })
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pointer.justPressed = false
    this.pointer.justReleased = false
    this.pointer.rightJustPressed = false
    this.pointer.doubleClick = false
    this.keysPressed.clear()
  }

  present(): void {
    this.fb.toU32(this.u32, this.lut)
    this.ctx.putImageData(this.image, 0, 0)
  }
}
