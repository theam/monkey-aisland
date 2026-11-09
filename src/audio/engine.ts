/**
 * WebAudio engine: recorded or synthesised music plus synthesised sound effects.
 *
 * The full instrument set, the three original scores and the SFX bank live in
 * ./voices, ./scores and ./sfx.
 */
import type { SoundSystem } from '../engine/sound'
import type { AudioConfig } from '../engine/content'
import { createVoices, type VoiceBank } from './voices'
import { SCORES, type Score } from './scores'
import { playSfx } from './sfx'
import { FilePlayer, type TrackFile } from './music-file'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.12
const CROSSFADE = 1.1
const MUSIC_GAIN = 0.22

export class AudioEngine implements SoundSystem {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private voices: VoiceBank | null = null
  private files: FilePlayer | null = null

  private cfg: AudioConfig
  private musicOn = true
  private sfxOn = true
  private volume = 0.7

  private current: string | null = null
  private score: Score | null = null
  private step = 0
  private nextNoteTime = 0
  private timer: number | null = null

  constructor(cfg: AudioConfig) {
    this.cfg = cfg
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  /** Which recorded track, if any, this scene's music id maps to. */
  private fileFor(id: string): { key: string; track: TrackFile } | null {
    if ((this.cfg.source ?? 'synth') !== 'file') return null
    const key = this.cfg.scene_tracks?.[id] ?? this.cfg.scene_tracks?.default
    if (!key) return null
    const track = this.cfg.files?.[key]
    return track ? { key, track } : null
  }

  /** The recorded-music player, for the loop-tuning helper in main.ts. */
  get filePlayer(): FilePlayer | null {
    return this.files
  }

  /**
   * Build the graph and start decoding now. Safe to call before any gesture:
   * the context starts suspended and decodeAudioData works anyway, so the
   * theme is decoded and ready by the time the player clicks.
   */
  preload(): void {
    this.build()
    if (!this.files) return
    for (const [key, track] of Object.entries(this.cfg.files ?? {})) {
      if ((this.cfg.source ?? 'synth') === 'file') void this.files.prefetch(key, track.src)
    }
  }

  private build(): void {
    if (this.ctx) return
    type WithWebkit = typeof window & { webkitAudioContext?: typeof AudioContext }
    const Ctor = window.AudioContext ?? (window as WithWebkit).webkitAudioContext
    if (!Ctor) return
    try {
      this.ctx = new Ctor()
    } catch (err) {
      // Some browsers refuse to construct one before a gesture. unlock() retries.
      console.warn('audio: context not available yet', err)
      return
    }
    this.master = this.ctx.createGain()
    this.master.gain.value = this.volume

    // A gentle limiter so the drunk bar track never clips.
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.knee.value = 8
    comp.ratio.value = 6
    comp.attack.value = 0.004
    comp.release.value = 0.18

    this.musicBus = this.ctx.createGain()
    this.musicBus.gain.value = 0
    this.sfxBus = this.ctx.createGain()
    this.sfxBus.gain.value = 0.9

    this.musicBus.connect(comp)
    this.sfxBus.connect(comp)
    comp.connect(this.master)
    this.master.connect(this.ctx.destination)

    this.voices = createVoices(this.ctx)
    this.files = new FilePlayer(this.ctx, this.musicBus, import.meta.env.BASE_URL ?? '/')
  }

  unlock(): void {
    this.build()
    if (!this.ctx) return
    void this.ctx.resume()
    if (this.current && this.musicOn) {
      // Re-issue the pending track now that the context is running.
      const id = this.current
      this.current = null
      this.music(id)
    }
  }

  setMusicEnabled(on: boolean): void {
    this.musicOn = on
    if (!on) {
      this.fadeMusic(0)
      this.stopLoop()
      this.files?.stop(0.4)
    } else if (this.ctx) {
      this.fadeMusic(this.targetMusicGain())
      const id = this.current
      this.current = null
      if (id) this.music(id)
    }
  }

  setSfxEnabled(on: boolean): void {
    this.sfxOn = on
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
    }
  }

  private targetMusicGain(): number {
    if (!this.musicOn || !this.current) return 0
    return MUSIC_GAIN
  }

  private fadeMusic(to: number, time = CROSSFADE * 0.4): void {
    if (!this.ctx || !this.musicBus) return
    this.musicBus.gain.setTargetAtTime(to, this.ctx.currentTime, time)
  }

  music(id: string | null): void {
    if (id === this.current) return
    this.current = id
    if (!id) {
      this.fadeMusic(0)
      this.stopLoop()
      this.files?.stop()
      this.score = null
      return
    }

    // Recorded music, if this scene maps to a file. Scenes that share a file
    // keep playing it uninterrupted, so the intro is never heard twice.
    const file = this.fileFor(id)
    if (file) {
      if (!this.ctx) return // will be re-issued from unlock()
      this.stopLoop()
      this.score = null
      // Come up fast: this fires on the click that starts the title sequence,
      // and a slow fade on top of the theme's quiet opening reads as "the music
      // hasn't started".
      this.fadeMusic(this.targetMusicGain(), 0.06)
      void this.files?.play(file.key, file.track)
      return
    }

    const score = SCORES[id]
    if (!score) {
      console.warn(`no score named "${id}"`)
      this.score = null
      this.fadeMusic(0)
      return
    }
    this.files?.stop()
    this.score = score
    this.step = 0
    if (!this.ctx) return
    this.nextNoteTime = this.ctx.currentTime + 0.06
    this.fadeMusic(this.targetMusicGain())
    this.startLoop()
  }

  private startLoop(): void {
    if (this.timer !== null || !this.ctx) return
    this.nextNoteTime = Math.max(this.nextNoteTime, this.ctx.currentTime + 0.05)
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  private stopLoop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    const ctx = this.ctx
    const score = this.score
    if (!ctx || !score || !this.voices || !this.musicBus) {
      this.stopLoop()
      return
    }
    if (!this.musicOn) {
      this.stopLoop()
      return
    }
    const stepDur = 60 / score.bpm / 4 // 16th notes
    while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const step = this.step
      for (const part of score.parts) {
        const len = part.length ?? score.length
        const local = step % len
        if (part.enterAt !== undefined && step < part.enterAt) continue
        if (part.exitAt !== undefined && step >= part.exitAt) continue
        const notes = part.notes[local]
        if (!notes) continue
        const swing = local % 2 === 1 ? (score.swing ?? 0) * stepDur : 0
        for (const n of Array.isArray(notes) ? notes : [notes]) {
          this.voices.play(
            part.voice,
            n.note,
            this.nextNoteTime + swing,
            n.dur * stepDur,
            (n.vel ?? 1) * (part.gain ?? 1),
            this.musicBus,
          )
        }
      }
      this.nextNoteTime += stepDur
      this.step = (this.step + 1) % score.length
    }
  }

  sfx(id: string): void {
    if (!this.sfxOn || !this.ctx || !this.sfxBus) return
    playSfx(this.ctx, this.sfxBus, id)
  }

  previewLoopJoin(seconds = 3): boolean {
    return this.files?.previewJoin(seconds) ?? false
  }
}
