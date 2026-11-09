/**
 * Renders the promo (promo.html) to an MP4: every frame painted by the real
 * game code in headless Chromium, piped raw to ffmpeg, scaled up with
 * nearest-neighbour so every pixel stays square, with the main theme
 * underneath — stopping dead when the salesman is interrupted and picking up
 * where it left off when he recovers.
 *
 *   npm run dev            # in another terminal
 *   npm run promo-video                      # 1920x1080
 *   npm run promo-video -- --format square   # 1080x1080
 *   npm run promo-video -- --no-crickets     # a silent awkward pause
 *
 * Needs ffmpeg on the PATH. Writes to video/ (git-ignored).
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const BASE = arg('base', process.env.BASE ?? 'http://localhost:5173')
const FORMAT = arg('format', 'wide')
const OUT = arg('out', `video/monkey-aisland-promo-${FORMAT}.mp4`)
const CRICKETS = !args.includes('--no-crickets')
const BATCH = 10 // frames per round trip to the page
const VOLUME = 0.8

/** Two crickets, left and right of centre, from `start` to `stop` seconds: the `[a3]` input. */
function cricketsFrom(start, stop) {
  const one = (hz, every, offset, rate) =>
    `sin(2*PI*${hz}*t)*lt(mod(t+${offset},${every}),0.1)*gt(sin(2*PI*${rate}*t),0.35)`
  const a = one(4600, 0.55, 0, 36)
  const b = one(5100, 0.71, 0.23, 41)
  const length = stop - start
  return (
    `aevalsrc=exprs='0.05*${a}+0.015*${b}|0.015*${a}+0.04*${b}':s=44100:d=${length},` +
    `afade=t=in:d=0.4,afade=t=out:st=${length - 0.1}:d=0.1,` +
    `adelay=delays=${Math.round(start * 1000)}:all=1[a3]`
  )
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err))

  try {
    await page.goto(`${BASE}/promo.html?format=${FORMAT}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  } catch {
    console.error(`Could not reach ${BASE}. Start the dev server first: npm run dev`)
    await browser.close()
    process.exit(1)
  }
  await page.waitForFunction(() => window.__promo, null, { timeout: 15000 })
  if (errors.length) throw errors[0]
  const promo = await page.evaluate(() => {
    const { rgbFrames: _r, show: _s, ...meta } = window.__promo
    return meta
  })

  const { width: w, height: h, scale, fps, frames, duration, music } = promo
  const end = frames / fps
  const fadeIn = 0.5 // both times the music comes in
  const fadeOut = 2
  const tail = end - music.resumesAt
  // The theme plays from the drop until the interruption, stops, then carries
  // on from the same bar when the salesman gets going again, and fades out
  // under the end card.
  //
  // In the silence, crickets: the oldest joke in the book for an awkward
  // pause, and the sound of a night on the original's island. Two of them,
  // synthesised like everything else here: sine bursts at 4.6 and 5.1 kHz,
  // gated into chirps. `--no-crickets` leaves the silence silent.
  const crickets = CRICKETS ? cricketsFrom(music.stopsAt + 0.9, music.resumesAt) : null
  const audio = [
    '[1:a]asplit=2[m1][m2]',
    `[m1]atrim=start=${music.from}:duration=${music.stopsAt},asetpts=PTS-STARTPTS,` +
      `afade=t=in:d=${fadeIn},afade=t=out:st=${music.stopsAt - 0.04}:d=0.04[a1]`,
    `[m2]atrim=start=${music.from + music.stopsAt}:duration=${tail},asetpts=PTS-STARTPTS,` +
      `afade=t=in:d=${fadeIn},afade=t=out:st=${tail - fadeOut}:d=${fadeOut},` +
      `adelay=delays=${Math.round(music.resumesAt * 1000)}:all=1[a2]`,
    ...(crickets ? [crickets] : []),
    `[a1][a2]${crickets ? '[a3]' : ''}amix=inputs=${crickets ? 3 : 2}:normalize=0:duration=longest,` +
      `volume=${VOLUME},atrim=duration=${end}[a]`,
  ].join(';')
  const video =
    `[0:v]scale=${w * scale}:${h * scale}:flags=neighbor:out_color_matrix=bt709,format=yuv420p,` +
    'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709[v]'

  await mkdir(path.dirname(OUT), { recursive: true })
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-r', String(fps), '-i', 'pipe:0',
    '-i', path.join('public', music.src),
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'animation',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', String(end), '-movflags', '+faststart',
    OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] })
  const exited = once(ffmpeg, 'close')
  ffmpeg.stdin.on('error', () => {}) // reported by the exit code instead

  for (let i = 0; i < frames; i += BATCH) {
    const count = Math.min(BATCH, frames - i)
    const b64 = await page.evaluate(([i, n]) => window.__promo.rgbFrames(i, n), [i, count])
    if (!ffmpeg.stdin.write(Buffer.from(b64, 'base64'))) await once(ffmpeg.stdin, 'drain')
    process.stdout.write(`\r${Math.min(frames, i + count)}/${frames} frames`)
  }
  ffmpeg.stdin.end()
  const [code] = await exited
  await browser.close()
  process.stdout.write('\n')
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`)
  if (errors.length) throw errors[0]
  console.log(`${OUT}: ${w * scale}x${h * scale}, ${duration.toFixed(1)} s at ${fps} fps`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
