/**
 * Recorded-music player: plays an audio file once through its intro, then
 * loops only the musical section, with a short crossfade at the join.
 *
 *   0 ──────────── intro_end ──────────────── loop_end ─────── (end of file)
 *   │   intro,      │   the part that loops    │   never reached (fade-out,
 *   │   plays once  │                          │   applause, whatever)
 *
 * WebAudio's native `loop` + `loopStart`/`loopEnd` would be sample-accurate but
 * gives a hard butt-join, which only sounds right if the loop points land
 * exactly on a bar line. Scheduling overlapping segments with a crossfade
 * instead means an approximately-right loop point still sounds fine — which
 * matters, because loop points are tuned by ear.
 */

export type TrackFile = {
  src: string
  /** seconds; where the intro ends and the loop begins */
  intro_end?: number
  /** seconds; where to jump back to intro_end. Defaults to the file duration. */
  loop_end?: number
  /** seconds of overlap at the join */
  crossfade?: number
  gain?: number
}

type Active = { src: AudioBufferSourceNode; gain: GainNode }

const CHECK_MS = 400
/** schedule the next segment this far ahead of when it needs to start */
const SCHEDULE_AHEAD = 3

export class FilePlayer {
  private ctx: AudioContext
  private dest: AudioNode
  private base: string

  private buffers = new Map<string, AudioBuffer>()
  private loading = new Map<string, Promise<AudioBuffer | null>>()

  private id: string | null = null
  private track: TrackFile | null = null
  private active: Active[] = []
  private nextAt = 0
  private timer: number | null = null
  private out: GainNode

  constructor(ctx: AudioContext, dest: AudioNode, base: string) {
    this.ctx = ctx
    this.dest = dest
    this.base = base
    this.out = ctx.createGain()
    this.out.gain.value = 1
    this.out.connect(this.dest)
  }

  get currentId(): string | null {
    return this.id
  }

  /** True if we have (or are fetching) audio for this id. */
  knows(id: string): boolean {
    return this.buffers.has(id) || this.loading.has(id)
  }

  /** Start fetching and decoding now, so play() is instant later. */
  prefetch(id: string, src: string): Promise<AudioBuffer | null> {
    return this.load(id, src)
  }

  async play(id: string, track: TrackFile): Promise<void> {
    // Already playing this track: leave it alone. Walking between scenes must
    // not restart the music, or the intro would play again.
    if (this.id === id) return

    const buffer = await this.load(id, track.src)
    if (!buffer) return
    // Another play() may have won the race while we were decoding.
    if (this.id === id) return

    this.stop(0.25)
    this.id = id
    this.track = track
    this.out.gain.cancelScheduledValues(this.ctx.currentTime)
    this.out.gain.setValueAtTime(track.gain ?? 1, this.ctx.currentTime)

    const startAt = this.ctx.currentTime + 0.06
    this.scheduleSegment(buffer, 0, startAt, false)
    this.startTimer(buffer)
  }

  private async load(id: string, src: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id)
    if (have) return have
    const pending = this.loading.get(id)
    if (pending) return pending

    const p = (async () => {
      try {
        const url = `${this.base}${src}`.replace(/([^:])\/\//g, '$1/')
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const bytes = await res.arrayBuffer()
        const buf = await this.ctx.decodeAudioData(bytes)
        this.buffers.set(id, buf)
        return buf
      } catch (err) {
        console.warn(`music: could not load "${src}" — falling back to the synth score`, err)
        return null
      } finally {
        this.loading.delete(id)
      }
    })()
    this.loading.set(id, p)
    return p
  }

  /**
   * Play [from .. loopEnd] starting at `at` on the context clock, fading in and
   * out over the crossfade so it blends with its neighbours.
   */
  private scheduleSegment(buffer: AudioBuffer, from: number, at: number, fadeIn: boolean): void {
    const t = this.track!
    const cf = Math.max(0.02, t.crossfade ?? 0.25)
    const loopEnd = Math.min(t.loop_end ?? buffer.duration, buffer.duration)
    const len = Math.max(cf * 3, loopEnd - from)

    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const gain = this.ctx.createGain()
    src.connect(gain)
    gain.connect(this.out)

    if (fadeIn) {
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.linearRampToValueAtTime(1, at + cf)
    } else {
      gain.gain.setValueAtTime(1, at)
    }
    gain.gain.setValueAtTime(1, at + len - cf)
    gain.gain.linearRampToValueAtTime(0.0001, at + len)

    src.start(at, from, len)
    src.stop(at + len + 0.05)

    const entry: Active = { src, gain }
    this.active.push(entry)
    src.onended = () => {
      this.active = this.active.filter((a) => a !== entry)
      try {
        gain.disconnect()
      } catch {
        /* already gone */
      }
    }

    // The next segment starts before this one finishes, by the crossfade.
    this.nextAt = at + len - cf
  }

  private startTimer(buffer: AudioBuffer): void {
    this.stopTimer()
    this.timer = window.setInterval(() => {
      if (!this.track) return
      if (this.ctx.currentTime > this.nextAt - SCHEDULE_AHEAD) {
        const from = this.track.intro_end ?? 0
        this.scheduleSegment(buffer, from, this.nextAt, true)
      }
    }, CHECK_MS)
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  stop(fade = 0.4): void {
    this.stopTimer()
    this.id = null
    this.track = null
    const now = this.ctx.currentTime
    for (const a of this.active) {
      try {
        a.gain.gain.cancelScheduledValues(now)
        a.gain.gain.setValueAtTime(a.gain.gain.value, now)
        a.gain.gain.linearRampToValueAtTime(0.0001, now + fade)
        a.src.stop(now + fade + 0.05)
      } catch {
        /* already stopped */
      }
    }
    this.active = []
  }

  /** Jump the current loop so the join arrives in `seconds` — a tuning aid. */
  previewJoin(seconds = 2): boolean {
    if (!this.track || !this.id) return false
    const buffer = this.buffers.get(this.id)
    if (!buffer) return false
    const t = this.track
    const cf = Math.max(0.02, t.crossfade ?? 0.25)
    const loopEnd = Math.min(t.loop_end ?? buffer.duration, buffer.duration)
    this.stop(0.08)
    this.id = this.id
    this.track = t
    const at = this.ctx.currentTime + 0.12
    const from = Math.max(0, loopEnd - seconds - cf)
    // one short segment ending exactly at the loop point, then the loop resumes
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    const gain = this.ctx.createGain()
    src.connect(gain)
    gain.connect(this.out)
    const len = loopEnd - from
    gain.gain.setValueAtTime(1, at)
    gain.gain.setValueAtTime(1, at + len - cf)
    gain.gain.linearRampToValueAtTime(0.0001, at + len)
    src.start(at, from, len)
    src.stop(at + len + 0.05)
    this.active.push({ src, gain })
    this.nextAt = at + len - cf
    this.startTimer(buffer)
    return true
  }
}
