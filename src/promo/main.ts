/**
 * The promo preview page (promo.html): plays the stage in real time with the
 * music, scrubs, and switches format. It also exposes the deterministic frame
 * API that scripts/promo-video.mjs drives to render the MP4.
 *
 *   ?format=wide|square   which frame to show
 *   ?t=12.5               start paused at this second
 */
import { PALETTE_HEX, buildLut } from '../engine/palette'
import { FINE, FORMATS, Stage, type Format } from './stage'

const MUSIC = 'audio/main-theme.mp3'
/** Where the theme proper starts (game.yaml, audio.files.theme.intro_end). */
const MUSIC_FROM = 10.031
const FPS = 30

const params = new URLSearchParams(location.search)
const format: Format = params.get('format') === 'square' ? 'square' : 'wide'
const stage = new Stage(format)
const { w, h } = stage.out

const canvas = document.getElementById('screen') as HTMLCanvasElement
canvas.width = w
canvas.height = h
const ctx = canvas.getContext('2d', { alpha: false })
if (!ctx) throw new Error('2D canvas not available')
const image = ctx.createImageData(w, h)
const u32 = new Uint32Array(image.data.buffer)
const lut = buildLut()

function show(t: number): void {
  stage.paint(t).toU32(u32, lut)
  ctx!.putImageData(image, 0, 0)
}

function fit(): void {
  const vp = canvas.parentElement!
  const s = Math.max(1, Math.floor(Math.min(vp.clientWidth / w, vp.clientHeight / h)))
  canvas.style.width = `${w * s}px`
  canvas.style.height = `${h * s}px`
}
new ResizeObserver(fit).observe(canvas.parentElement!)

// --- the music: plays, stops dead when interrupted, picks up where it was ---

const stopsAt = stage.at('music_stops')
const resumesAt = stage.at('music_resumes')

/** Where in the music file we should be at video time `t`, or null for silence. */
function musicAt(t: number): number | null {
  if (t < stopsAt) return MUSIC_FROM + t
  if (t < resumesAt) return null
  return MUSIC_FROM + stopsAt + (t - resumesAt)
}

const audio = new Audio(MUSIC)
const VOLUME = 0.8
/** seconds the music takes to come in, both times (as in the render) */
const FADE_IN = 0.5

function syncMusic(t: number, playing: boolean): void {
  const want = playing ? musicAt(t) : null
  if (want === null) {
    if (!audio.paused) audio.pause()
    return
  }
  const entered = t < stopsAt ? 0 : resumesAt
  audio.volume = VOLUME * Math.min(1, (t - entered) / FADE_IN)
  if (audio.paused || Math.abs(audio.currentTime - want) > 0.25) audio.currentTime = want
  if (audio.paused) void audio.play().catch(() => {})
}

// --- controls -----------------------------------------------------------------

const play = document.getElementById('play') as HTMLButtonElement
const scrub = document.getElementById('scrub') as HTMLInputElement
const time = document.getElementById('time') as HTMLSpanElement
const formatSelect = document.getElementById('format') as HTMLSelectElement
formatSelect.value = format
scrub.max = String(stage.duration)

let t = Math.min(stage.duration, Number(params.get('t') ?? 0) || 0)
let playing = false
let last = 0

function render(): void {
  show(t)
  scrub.value = String(t)
  time.textContent = `${t.toFixed(2)} / ${stage.duration.toFixed(1)}`
}

function setPlaying(on: boolean): void {
  playing = on
  play.textContent = on ? 'Pause' : 'Play'
  if (on && t >= stage.duration) t = 0
  last = performance.now()
  syncMusic(t, on)
}

play.addEventListener('click', () => setPlaying(!playing))
scrub.addEventListener('input', () => {
  t = Number(scrub.value)
  render()
  syncMusic(t, playing)
})
formatSelect.addEventListener('change', () => {
  const q = new URLSearchParams(location.search)
  q.set('format', formatSelect.value)
  location.search = q.toString()
})
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault()
    setPlaying(!playing)
  }
})

function frame(now: number): void {
  if (playing) {
    t += (now - last) / 1000
    last = now
    if (t >= stage.duration) {
      t = stage.duration
      setPlaying(false)
    }
    syncMusic(t, playing)
    render()
  }
  requestAnimationFrame(frame)
}
render()
requestAnimationFrame(frame)

// --- the renderer's API -------------------------------------------------------

const RGB = PALETTE_HEX.map((hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
})

/**
 * Frames `first` .. `first + count - 1` as raw 24-bit RGB, base64, at the
 * stage's output size — ffmpeg scales them the rest of the way with
 * nearest-neighbour, which keeps every pixel square.
 */
function rgbFrames(first: number, count: number): string {
  const bytes = new Uint8Array(w * h * 3 * count)
  let o = 0
  for (let i = first; i < first + count; i++) {
    const px = stage.paint(i / FPS).px
    for (let p = 0; p < px.length; p++) {
      const c = RGB[px[p]]
      bytes[o++] = c[0]
      bytes[o++] = c[1]
      bytes[o++] = c[2]
    }
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

;(window as unknown as Record<string, unknown>).__promo = {
  format,
  width: w,
  height: h,
  scale: FORMATS[format].scale / FINE,
  fps: FPS,
  frames: Math.ceil(stage.duration * FPS),
  duration: stage.duration,
  music: { src: MUSIC, from: MUSIC_FROM, stopsAt, resumesAt },
  actions: stage.timeline.actions,
  rgbFrames,
  show,
}
