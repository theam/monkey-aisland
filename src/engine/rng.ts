/**
 * Deterministic PRNG. Art generators must never call Math.random(): the
 * paintings have to look identical on every reload, on every machine, forever.
 * mulberry32 — small, fast, good enough for clouds and coastlines.
 */
export class RNG {
  private s: number

  constructor(seed: number | string) {
    this.s = typeof seed === 'string' ? hashString(seed) : seed >>> 0
    if (this.s === 0) this.s = 0x9e3779b9
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** integer in [min, max] inclusive */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** float in [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  bool(p = 0.5): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  /** Fisher–Yates, returns a new array. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }

  fork(salt: number | string): RNG {
    return new RNG(typeof salt === 'string' ? hashString(salt) ^ this.s : (salt ^ this.s) >>> 0)
  }
}

export function hashString(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 1D value noise with cosine interpolation — coastlines, cliff silhouettes,
 * cloud bands. `octaves` adds detail at halving amplitude.
 */
export function valueNoise1D(rng: RNG, length: number, wavelength: number, octaves = 3): Float32Array {
  const out = new Float32Array(length)
  let amp = 1
  let wl = Math.max(2, wavelength)
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const n = Math.ceil(length / wl) + 2
    const pts = new Float32Array(n)
    for (let i = 0; i < n; i++) pts[i] = rng.next()
    for (let x = 0; x < length; x++) {
      const p = x / wl
      const i = Math.floor(p)
      const f = p - i
      const s = (1 - Math.cos(f * Math.PI)) * 0.5
      out[x] += (pts[i] * (1 - s) + pts[i + 1] * s) * amp
    }
    total += amp
    amp *= 0.5
    wl = Math.max(2, wl * 0.5)
  }
  for (let x = 0; x < length; x++) out[x] /= total
  return out
}
