/**
 * Audio entry point. Sound effects and fallback scores are synthesised in
 * WebAudio; the configured main theme can use a recording.
 */
import type { SoundSystem } from '../engine/sound'
import type { AudioConfig } from '../engine/content'
import { AudioEngine } from './engine'

let instance: AudioEngine | null = null

export function createAudio(config: AudioConfig): SoundSystem {
  if (!instance) instance = new AudioEngine(config)
  return instance
}
