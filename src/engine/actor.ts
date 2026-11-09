/**
 * Actors: the player and everyone who stands around insulting them.
 * Positions are in room coordinates; y is the character's feet.
 */
import type { Vec2 } from './content'
import { Framebuffer } from './framebuffer'
import { balanceWrap, LINE_H, drawTextCentered, textWidth } from './font'
import { C } from './palette'
import { clampToPoly } from './geom'
import { drawSprite, dropShadow, type Sprite } from './sprite'
import { ROOM_H, SCREEN_W } from './display'

export type Facing = -1 | 1

export type Speech = {
  lines: string[]
  color: number
  startedAt: number
  endsAt: number
}

const WALK_SPEED = 62 // px/sec at scale 1
const STEP_PX = 6 // advance the walk cycle every N pixels travelled

/**
 * How long a line stays on screen. Overridable from ui.yaml `pacing`.
 *
 * The duration is proportional to the length of the line: `perChar` is the
 * reading budget per character (55ms ≈ 18 characters a second, which is a
 * comfortable pace for a pixel font), `base` is the moment it takes to notice
 * the text at all, and `perLine` pays for the eye movement between wrapped
 * lines. `max` exists only to stop a pathologically long line parking itself on
 * screen — it must stay well clear of real lines, or the longest ones end up
 * with the *least* time per character, which is the opposite of the point.
 */
const PACING = { perChar: 55, base: 800, perLine: 220, min: 1200, max: 12000 }

export function setPacing(p: Partial<typeof PACING> | undefined): void {
  if (!p) return
  Object.assign(PACING, p)
}

/** How long this line should stay on screen, per the configured pacing. */
export function lineDuration(text: string, holdScale = 1, lineCount = 1): number {
  const budget =
    PACING.base + text.length * PACING.perChar + Math.max(0, lineCount - 1) * PACING.perLine
  return Math.min(PACING.max, Math.max(PACING.min, budget)) * holdScale
}

export class Actor {
  readonly id: string
  sprite: Sprite
  x: number
  y: number
  facing: Facing = 1
  scale = 1
  visible = true
  /** actors with a lower z draw first; normally derived from y */
  zBias = 0

  speech: Speech | null = null
  private target: Vec2 | null = null
  private onArrive: (() => void) | null = null
  private walkPhase = 0
  private emote: string | null = null
  private blinkT = 0

  constructor(id: string, sprite: Sprite, x: number, y: number, facing: Facing = 1) {
    this.id = id
    this.sprite = sprite
    this.x = x
    this.y = y
    this.facing = facing
  }

  get walking(): boolean {
    return this.target !== null
  }

  get speaking(): boolean {
    return this.speech !== null
  }

  walkTo(x: number, y: number, walkbox: readonly Vec2[], onArrive?: () => void): void {
    const [cx, cy] = clampToPoly(x, y, walkbox)
    this.target = [cx, cy]
    this.onArrive = onArrive ?? null
  }

  /** Teleport (scene entry). */
  place(x: number, y: number, facing?: Facing): void {
    this.x = x
    this.y = y
    this.target = null
    this.onArrive = null
    if (facing) this.facing = facing
  }

  stop(): void {
    this.target = null
    const cb = this.onArrive
    this.onArrive = null
    cb?.()
  }

  cancelWalk(): void {
    this.target = null
    this.onArrive = null
  }

  faceTowards(x: number): void {
    if (Math.abs(x - this.x) < 2) return
    this.facing = x < this.x ? -1 : 1
  }

  /**
   * Lines clear themselves on a timer, so a conversation plays out whether or
   * not the player clicks. Pacing comes from ui.yaml (see `setPacing`) — the
   * default is tuned to a comfortable reading speed rather than to the length
   * of the sentence, because a long line held for six seconds reads as a hang.
   */
  say(text: string, color: number, now: number, holdScale = 1): void {
    const lines = balanceWrap(text, 220)
    this.speech = {
      lines,
      color,
      startedAt: now,
      endsAt: now + lineDuration(text, holdScale, lines.length),
    }
  }

  hush(): void {
    this.speech = null
  }

  setEmote(e: string | null): void {
    this.emote = e
  }

  update(dt: number, now: number, walkbox: readonly Vec2[], scaleAt: (y: number) => number): void {
    if (this.speech && now >= this.speech.endsAt) this.speech = null

    this.scale = scaleAt(this.y)

    if (this.target) {
      const dx = this.target[0] - this.x
      const dy = this.target[1] - this.y
      const dist = Math.hypot(dx, dy)
      const step = WALK_SPEED * this.scale * dt
      if (dist <= step) {
        this.x = this.target[0]
        this.y = this.target[1]
        this.stop()
      } else {
        const nx = this.x + (dx / dist) * step
        const ny = this.y + (dy / dist) * step
        const [cx, cy] = clampToPoly(nx, ny, walkbox)
        this.x = cx
        this.y = cy
        if (Math.abs(dx) > 1.5) this.facing = dx < 0 ? -1 : 1
        this.walkPhase += step
      }
    }

    this.blinkT += dt
  }

  private currentFrame(now: number): string {
    const f = this.sprite.frames
    if (this.walking) {
      const cycle = ['walk1', 'walk2', 'walk3', 'walk4'].filter((n) => f.has(n))
      if (cycle.length) return cycle[Math.floor(this.walkPhase / STEP_PX) % cycle.length]
      return f.has('stand') ? 'stand' : 'stand'
    }
    if (this.emote && f.has(this.emote)) return this.emote
    if (this.speaking) {
      const talk = ['talk1', 'talk2', 'talk3'].filter((n) => f.has(n))
      if (talk.length) return talk[Math.floor(now / 140) % talk.length]
    }
    if (f.has('blink') && this.blinkT % 4.2 > 4.05) return 'blink'
    if (this.facing === -1 && f.has('standL')) return 'standL'
    return 'stand'
  }

  draw(fb: Framebuffer, camX: number, now: number): void {
    if (!this.visible) return
    const sx = this.x - camX
    if (sx < -40 || sx > SCREEN_W + 40) return
    const frame = this.currentFrame(now)
    // Only the walk cycle is a side view, so it is the only thing worth
    // mirroring — flipping a front-facing stand would just flip the face.
    const flipX = this.facing === -1 && frame.startsWith('walk')
    dropShadow(fb, sx, this.y, Math.max(4, 7 * this.scale), C.ink)
    drawSprite(fb, this.sprite, frame, sx, this.y, { flipX, scale: this.scale })
  }
}

/**
 * Speech text, MI-style: centred over the actor's head, in their colour, with
 * a hard 1px shadow so it survives a busy background. Clamped to the screen.
 */
export function drawSpeech(fb: Framebuffer, actor: Actor, camX: number): void {
  const s = actor.speech
  if (!s) return
  const headTop = actor.y - actor.sprite.h * actor.scale
  let y = Math.round(headTop - 4 - s.lines.length * LINE_H)
  if (y < 2) y = 2
  const maxLineW = Math.max(...s.lines.map(textWidth))
  let cx = Math.round(actor.x - camX)
  cx = Math.max(4 + maxLineW / 2, Math.min(SCREEN_W - 4 - maxLineW / 2, cx))
  for (const line of s.lines) {
    if (y + LINE_H > ROOM_H) break
    drawTextCentered(fb, line, cx, y, { color: s.color, outlineColor: C.black })
    y += LINE_H
  }
}
