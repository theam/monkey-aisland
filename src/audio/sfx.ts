/**
 * Sound effects, synthesised on demand. Small graphs, short lives.
 */
import { noteToFreq } from './voices'

type Ctx = AudioContext

let noiseBuf: AudioBuffer | null = null
function noise(ctx: Ctx): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf
  const len = Math.floor(ctx.sampleRate * 0.8)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let s = 0x1234567
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    d[i] = (s / 0x3fffffff) - 1
  }
  noiseBuf = buf
  return buf
}

function blip(
  ctx: Ctx,
  dest: AudioNode,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
  delay = 0,
): void {
  const t = ctx.currentTime + delay
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(peak, t + Math.min(0.012, dur * 0.2))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g)
  g.connect(dest)
  o.start(t)
  o.stop(t + dur + 0.05)
}

function burst(
  ctx: Ctx,
  dest: AudioNode,
  filter: 'lowpass' | 'highpass' | 'bandpass',
  freq: number,
  q: number,
  dur: number,
  peak: number,
  delay = 0,
  rate = 1,
): void {
  const t = ctx.currentTime + delay
  const n = ctx.createBufferSource()
  n.buffer = noise(ctx)
  n.playbackRate.value = rate
  const f = ctx.createBiquadFilter()
  f.type = filter
  f.frequency.value = freq
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(peak, t + Math.min(0.01, dur * 0.25))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  n.connect(f)
  f.connect(g)
  g.connect(dest)
  n.start(t)
  n.stop(t + dur + 0.05)
}

export function playSfx(ctx: Ctx, dest: AudioNode, id: string): void {
  switch (id) {
    case 'step':
      burst(ctx, dest, 'bandpass', 420, 1.6, 0.06, 0.12)
      break
    case 'stepwood':
      burst(ctx, dest, 'bandpass', 240, 3, 0.08, 0.16)
      blip(ctx, dest, 'sine', 150, 90, 0.05, 0.06)
      break
    case 'click':
      blip(ctx, dest, 'square', 1400, 900, 0.03, 0.06)
      break
    case 'pickup':
      blip(ctx, dest, 'triangle', 660, 1320, 0.09, 0.14)
      blip(ctx, dest, 'triangle', 990, 1760, 0.09, 0.1, 0.07)
      break
    case 'whoosh':
      burst(ctx, dest, 'lowpass', 900, 0.8, 0.45, 0.16, 0, 0.6)
      break
    case 'door':
      blip(ctx, dest, 'sawtooth', 120, 70, 0.4, 0.07)
      burst(ctx, dest, 'bandpass', 700, 4, 0.35, 0.07)
      break
    case 'mug':
      blip(ctx, dest, 'square', 320, 180, 0.09, 0.16)
      burst(ctx, dest, 'bandpass', 1800, 2, 0.06, 0.1)
      break
    case 'pour':
      for (let i = 0; i < 14; i++) {
        burst(ctx, dest, 'bandpass', 1100 + i * 90, 6, 0.05, 0.05, i * 0.035, 1.4)
      }
      break
    case 'gulp':
      for (let i = 0; i < 3; i++) blip(ctx, dest, 'sine', 220 - i * 30, 120, 0.09, 0.12, i * 0.13)
      break
    case 'screech':
      // monkey. Not a nice noise.
      for (let i = 0; i < 5; i++) {
        blip(ctx, dest, 'sawtooth', 900 + i * 120, 1800 - i * 90, 0.07, 0.09, i * 0.055)
      }
      break
    case 'seagull':
      blip(ctx, dest, 'triangle', 1200, 800, 0.14, 0.07)
      blip(ctx, dest, 'triangle', 1100, 700, 0.12, 0.06, 0.2)
      blip(ctx, dest, 'triangle', 1000, 640, 0.16, 0.05, 0.38)
      break
    case 'wave':
      burst(ctx, dest, 'lowpass', 700, 0.7, 1.2, 0.09, 0, 0.4)
      break
    case 'fail':
      // the sad trombone, in three notes of pure disappointment
      blip(ctx, dest, 'sawtooth', noteToFreq('Bb3'), noteToFreq('Bb3'), 0.18, 0.12)
      blip(ctx, dest, 'sawtooth', noteToFreq('A3'), noteToFreq('A3'), 0.18, 0.12, 0.18)
      blip(ctx, dest, 'sawtooth', noteToFreq('Ab3'), noteToFreq('G3'), 0.55, 0.13, 0.36)
      break
    case 'success':
      blip(ctx, dest, 'triangle', noteToFreq('C5'), noteToFreq('C5'), 0.1, 0.12)
      blip(ctx, dest, 'triangle', noteToFreq('E5'), noteToFreq('E5'), 0.1, 0.12, 0.1)
      blip(ctx, dest, 'triangle', noteToFreq('G5'), noteToFreq('G5'), 0.1, 0.12, 0.2)
      blip(ctx, dest, 'triangle', noteToFreq('C6'), noteToFreq('C6'), 0.4, 0.14, 0.3)
      break
    case 'insult':
      blip(ctx, dest, 'square', 220, 180, 0.12, 0.1)
      blip(ctx, dest, 'square', 180, 140, 0.16, 0.1, 0.1)
      break
    case 'page':
      burst(ctx, dest, 'highpass', 3000, 1, 0.12, 0.07, 0, 1.6)
      break
    default:
      blip(ctx, dest, 'square', 900, 700, 0.03, 0.05)
  }
}
