/**
 * Instruments. Every voice is a small WebAudio graph built per note and
 * garbage-collected when it finishes — at our note density that is far simpler
 * than a voice pool and costs nothing measurable.
 *
 * The palette is deliberately Caribbean-ish: struck metal and wood, nylon
 * pluck, upright bass, hand percussion. Same instincts as the LucasArts
 * soundtracks, entirely our own notes.
 */

export type VoiceName =
  | 'steel'      // steel drum / pan — the lead
  | 'marimba'    // wooden mallet, softer
  | 'pluck'      // nylon guitar
  | 'bass'       // upright bass
  | 'pad'        // warm organ pad
  | 'organ'      // brighter, for the bar
  | 'kick'
  | 'conga'
  | 'shaker'
  | 'hat'
  | 'woodblock'
  | 'tamb'
  | 'rim'

export type VoiceBank = {
  play: (
    voice: VoiceName,
    note: string | null,
    when: number,
    dur: number,
    vel: number,
    dest: AudioNode,
  ) => void
}

const NOTE_OFFSET: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

export function noteToFreq(note: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim())
  if (!m) return 440
  let semis = NOTE_OFFSET[m[1].toLowerCase()]
  if (m[2] === '#') semis += 1
  if (m[2] === 'b') semis -= 1
  const octave = parseInt(m[3], 10)
  const midi = (octave + 1) * 12 + semis
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** A short noise burst buffer, reused by every percussive voice. */
function makeNoise(ctx: AudioContext, seconds = 1): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  // deterministic noise: same texture every session
  let s = 0x2f6e2b1
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    data[i] = (s / 0x3fffffff) - 1
  }
  return buf
}

/** Exponentially decaying noise impulse response — a small stone room. */
function makeReverbIR(ctx: AudioContext, seconds = 1.7, decay = 3.2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let s = 0x9e3779b9
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      const n = (s / 0x3fffffff) - 1
      d[i] = n * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

export function createVoices(ctx: AudioContext): VoiceBank {
  const noise = makeNoise(ctx, 1)

  // shared reverb send
  const conv = ctx.createConvolver()
  conv.buffer = makeReverbIR(ctx)
  const revSend = ctx.createGain()
  revSend.gain.value = 0.32
  const revOut = ctx.createGain()
  revOut.gain.value = 0.5
  revSend.connect(conv)
  conv.connect(revOut)
  let revConnected: AudioNode | null = null

  const connectRev = (dest: AudioNode) => {
    if (revConnected !== dest) {
      try {
        revOut.disconnect()
      } catch {
        /* first time */
      }
      revOut.connect(dest)
      revConnected = dest
    }
  }

  const env = (
    node: AudioNode,
    when: number,
    a: number,
    d: number,
    s: number,
    r: number,
    peak: number,
    dur: number,
    dest: AudioNode,
    revAmount = 0.5,
  ): GainNode => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.linearRampToValueAtTime(peak, when + a)
    g.gain.linearRampToValueAtTime(peak * s, when + a + d)
    const end = when + Math.max(dur, a + d) + r
    g.gain.setTargetAtTime(0.0001, when + Math.max(dur, a + d), r / 3)
    node.connect(g)
    g.connect(dest)
    if (revAmount > 0) {
      const rs = ctx.createGain()
      rs.gain.value = revAmount
      g.connect(rs)
      rs.connect(revSend)
    }
    void end
    return g
  }

  const stop = (nodes: AudioScheduledSourceNode[], at: number) => {
    for (const n of nodes) n.stop(at)
  }

  function play(
    voice: VoiceName,
    note: string | null,
    when: number,
    dur: number,
    vel: number,
    dest: AudioNode,
  ): void {
    connectRev(dest)
    const f = note ? noteToFreq(note) : 220
    const v = Math.max(0.001, Math.min(1.4, vel))

    switch (voice) {
      case 'steel': {
        // FM: a sine carrier with a 3.5x modulator and a fast metallic decay
        const car = ctx.createOscillator()
        car.type = 'sine'
        car.frequency.value = f
        const mod = ctx.createOscillator()
        mod.type = 'sine'
        mod.frequency.value = f * 3.51
        const modGain = ctx.createGain()
        modGain.gain.setValueAtTime(f * 3.2 * v, when)
        modGain.gain.exponentialRampToValueAtTime(f * 0.25, when + 0.16)
        mod.connect(modGain)
        modGain.connect(car.frequency)
        const g = env(car, when, 0.004, 0.13, 0.28, 0.28, 0.3 * v, dur, dest, 0.65)
        car.start(when)
        mod.start(when)
        stop([car, mod], when + dur + 0.5)
        void g
        break
      }
      case 'marimba': {
        const o = ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.value = f
        const o2 = ctx.createOscillator()
        o2.type = 'sine'
        o2.frequency.value = f * 4.02
        const g2 = ctx.createGain()
        g2.gain.value = 0.16 * v
        o2.connect(g2)
        const mix = ctx.createGain()
        o.connect(mix)
        g2.connect(mix)
        env(mix, when, 0.003, 0.1, 0.14, 0.2, 0.34 * v, dur, dest, 0.45)
        o.start(when)
        o2.start(when)
        stop([o, o2], when + dur + 0.4)
        break
      }
      case 'pluck': {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = f
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.Q.value = 3
        lp.frequency.setValueAtTime(Math.min(9000, f * 9), when)
        lp.frequency.exponentialRampToValueAtTime(Math.max(220, f * 1.6), when + 0.22)
        o.connect(lp)
        env(lp, when, 0.002, 0.09, 0.2, 0.22, 0.2 * v, dur, dest, 0.4)
        o.start(when)
        stop([o], when + dur + 0.4)
        break
      }
      case 'bass': {
        const o = ctx.createOscillator()
        o.type = 'triangle'
        o.frequency.setValueAtTime(f * 1.01, when)
        o.frequency.exponentialRampToValueAtTime(f, when + 0.03)
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = 380
        lp.Q.value = 1.2
        o.connect(lp)
        env(lp, when, 0.008, 0.06, 0.75, 0.12, 0.62 * v, dur, dest, 0.12)
        o.start(when)
        stop([o], when + dur + 0.3)
        break
      }
      case 'pad':
      case 'organ': {
        const bright = voice === 'organ'
        const mix = ctx.createGain()
        const detunes = bright ? [0, 12, 19.02, -0.08] : [0, 0.06, -0.07, 12]
        for (const d of detunes) {
          const o = ctx.createOscillator()
          o.type = bright ? 'square' : 'sine'
          o.frequency.value = f * Math.pow(2, d / 12)
          const g = ctx.createGain()
          g.gain.value = (bright ? 0.1 : 0.14) / detunes.length
          o.connect(g)
          g.connect(mix)
          o.start(when)
          stop([o], when + dur + 0.5)
        }
        const lp = ctx.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.value = bright ? 2600 : 1500
        mix.connect(lp)
        env(lp, when, bright ? 0.02 : 0.12, 0.1, 0.85, 0.35, 0.5 * v, dur, dest, 0.7)
        break
      }
      case 'kick': {
        const o = ctx.createOscillator()
        o.type = 'sine'
        o.frequency.setValueAtTime(132, when)
        o.frequency.exponentialRampToValueAtTime(44, when + 0.11)
        env(o, when, 0.002, 0.05, 0.2, 0.09, 0.85 * v, 0.1, dest, 0.08)
        o.start(when)
        stop([o], when + 0.4)
        break
      }
      case 'conga': {
        const o = ctx.createOscillator()
        o.type = 'sine'
        const base = note ? f : 240
        o.frequency.setValueAtTime(base * 1.25, when)
        o.frequency.exponentialRampToValueAtTime(base * 0.82, when + 0.09)
        env(o, when, 0.002, 0.04, 0.12, 0.1, 0.5 * v, 0.09, dest, 0.3)
        const n = ctx.createBufferSource()
        n.buffer = noise
        const hp = ctx.createBiquadFilter()
        hp.type = 'bandpass'
        hp.frequency.value = base * 3
        hp.Q.value = 1.4
        n.connect(hp)
        env(hp, when, 0.001, 0.015, 0.02, 0.03, 0.16 * v, 0.02, dest, 0.2)
        o.start(when)
        n.start(when)
        stop([o, n], when + 0.3)
        break
      }
      case 'shaker': {
        const n = ctx.createBufferSource()
        n.buffer = noise
        n.playbackRate.value = 1.6
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 6800
        bp.Q.value = 1.1
        n.connect(bp)
        env(bp, when, 0.004, 0.02, 0.06, 0.05, 0.2 * v, 0.03, dest, 0.25)
        n.start(when)
        stop([n], when + 0.2)
        break
      }
      case 'hat': {
        const n = ctx.createBufferSource()
        n.buffer = noise
        n.playbackRate.value = 2.4
        const hp = ctx.createBiquadFilter()
        hp.type = 'highpass'
        hp.frequency.value = 9000
        n.connect(hp)
        env(hp, when, 0.001, 0.012, 0.03, 0.03, 0.18 * v, 0.02, dest, 0.2)
        n.start(when)
        stop([n], when + 0.2)
        break
      }
      case 'woodblock': {
        const o = ctx.createOscillator()
        o.type = 'square'
        o.frequency.value = note ? f : 1180
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = note ? f : 1180
        bp.Q.value = 8
        o.connect(bp)
        env(bp, when, 0.001, 0.02, 0.05, 0.04, 0.3 * v, 0.03, dest, 0.4)
        o.start(when)
        stop([o], when + 0.2)
        break
      }
      case 'tamb': {
        const n = ctx.createBufferSource()
        n.buffer = noise
        n.playbackRate.value = 2
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 7600
        bp.Q.value = 0.8
        n.connect(bp)
        env(bp, when, 0.002, 0.05, 0.1, 0.12, 0.22 * v, 0.06, dest, 0.5)
        n.start(when)
        stop([n], when + 0.3)
        break
      }
      case 'rim': {
        const n = ctx.createBufferSource()
        n.buffer = noise
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = 2100
        bp.Q.value = 6
        n.connect(bp)
        env(bp, when, 0.001, 0.01, 0.02, 0.03, 0.28 * v, 0.02, dest, 0.3)
        n.start(when)
        stop([n], when + 0.2)
        break
      }
    }
  }

  return { play }
}
