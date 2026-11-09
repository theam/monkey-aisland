/**
 * The sound contract the game talks to. The real implementation lives in
 * src/audio (WebAudio synthesis plus optional recorded music).
 */
export type SoundSystem = {
  /**
   * Build the audio graph and start fetching/decoding music immediately, before
   * any user gesture. Decoding is allowed on a suspended context, so doing this
   * at boot is what makes the music start the instant the player first clicks
   * instead of seconds later.
   */
  preload(): void
  /** Called on the first user gesture — browsers require it to start output. */
  unlock(): void
  /** Crossfade to a named track, or stop with null. */
  music(id: string | null): void
  sfx(id: string): void
  setMusicEnabled(on: boolean): void
  setSfxEnabled(on: boolean): void
  setVolume(v: number): void
  readonly ready: boolean
  /**
   * Tuning aid for recorded music: skip ahead so the loop join arrives in
   * `seconds`, instead of waiting for the whole track. Returns false if there
   * is no recorded track playing.
   */
  previewLoopJoin?(seconds?: number): boolean
}

export const nullSound: SoundSystem = {
  preload() {},
  unlock() {},
  music() {},
  sfx() {},
  setMusicEnabled() {},
  setSfxEnabled() {},
  setVolume() {},
  ready: false,
}
