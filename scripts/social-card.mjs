/**
 * Renders the link preview, public/social-card.png: the title card at 4x,
 * cropped to 1200x630, the size Open Graph and X expect.
 *
 *   npm run dev            # in another terminal
 *   npm run social-card
 *
 * It photographs the running game rather than redrawing the art, so the card
 * never drifts from what players see. Rerun it whenever the title card changes.
 * The crop only drops the dark headland and the "(click to skip)" hint, and
 * 4x is a whole number, so every pixel stays sharp.
 */
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : process.env.BASE ?? 'http://localhost:5173'
const OUT = 'public/social-card.png'

const SCALE = 4
const CARD = { w: 1200, h: 630 }
// in game pixels: centred horizontally, from the top of the sky down
const CROP = { x: (320 - CARD.w / SCALE) / 2, y: 0 }

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  } catch {
    console.error(`Could not reach ${BASE}. Start the dev server first: npm run dev`)
    await browser.close()
    process.exit(1)
  }
  await page.waitForFunction(() => window.__game, null, { timeout: 15000 })
  await page.waitForTimeout(1300)

  // PRESS START, then wait for the title card: faded in by 1s, fading out at 7.9s.
  await page.locator('#screen').click()
  await page.waitForFunction(() => window.__game.mode === 'title')
  await page.evaluate(() => { window.__game.display.pointer.over = false })
  await page.waitForTimeout(4000)

  const png = await page.evaluate(
    ([scale, card, crop]) => {
      const screen = document.querySelector('#screen')
      const out = document.createElement('canvas')
      out.width = card.w
      out.height = card.h
      const ctx = out.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(screen, crop.x, crop.y, card.w / scale, card.h / scale, 0, 0, card.w, card.h)
      return out.toDataURL('image/png').split(',')[1]
    },
    [SCALE, CARD, CROP],
  )
  const mode = await page.evaluate(() => window.__game.mode)
  await browser.close()

  if (mode !== 'title') {
    console.error(`The title card was gone before the picture was taken (mode: ${mode}).`)
    process.exit(1)
  }
  const bytes = Buffer.from(png, 'base64')
  await writeFile(OUT, bytes)
  console.log(`${OUT}: ${CARD.w}x${CARD.h}, ${Math.round(bytes.length / 1024)} KB`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
