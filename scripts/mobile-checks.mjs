import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : process.env.BASE ?? 'http://localhost:5173'
const OUT = 'shots'

function closeTo(actual, expected, tolerance = 1) {
  return Math.abs(actual - expected) <= tolerance
}

function assertCanvasSize(box, expectedWidth, expectedHeight, label) {
  assert(box, `${label}: canvas has no bounding box`)
  assert(closeTo(box.width, expectedWidth), `${label}: expected width ${expectedWidth}, got ${box.width}`)
  assert(closeTo(box.height, expectedHeight), `${label}: expected height ${expectedHeight}, got ${box.height}`)
}

async function waitForGame(page) {
  await page.goto(`${BASE}/?skipintro`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForFunction(() => window.__game, null, { timeout: 15000 })
  await page.waitForTimeout(300)
}

async function advanceDialogToChoice(page) {
  await page.evaluate(async () => {
    const game = window.__game
    const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 4))
    for (let step = 0; step < 200 && game.dialog.options().length === 0; step++) {
      game.hushAll()
      await yieldFrame()
    }
  })
  await page.waitForFunction(() => window.__game.dialog.options().length > 0, null, { timeout: 15000 })
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const failures = []

  try {
    const phoneContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    })
    const phone = await phoneContext.newPage()
    phone.on('console', (message) => {
      if (message.type() === 'error') failures.push(`phone console: ${message.text()}`)
    })
    phone.on('pageerror', (error) => failures.push(`phone pageerror: ${error.message}`))

    await waitForGame(phone)
    const canvas = phone.locator('#screen')
    const hint = phone.locator('#phone-orientation-hint')

    assert.equal(await hint.isVisible(), true, 'portrait phone should recommend landscape')
    assertCanvasSize(await canvas.boundingBox(), 390, 244, 'portrait phone')
    await phone.waitForTimeout(400)
    await phone.screenshot({ path: `${OUT}/mobile-orientation-hint.png` })
    await hint.locator('[data-dismiss-orientation]').tap()
    assert.equal(await hint.isVisible(), false, 'portrait recommendation should be dismissible')

    await phone.reload({ waitUntil: 'domcontentloaded' })
    await phone.waitForFunction(() => window.__game)
    assert.equal(await hint.isVisible(), true, 'portrait recommendation should appear on a fresh load')

    await phone.setViewportSize({ width: 844, height: 390 })
    await phone.waitForTimeout(200)
    assert.equal(await hint.isVisible(), false, 'landscape phone should not show the recommendation')
    assertCanvasSize(await canvas.boundingBox(), 624, 390, 'landscape phone')
    await canvas.screenshot({ path: `${OUT}/mobile-landscape.png` })

    await phone.setViewportSize({ width: 390, height: 844 })
    await phone.waitForTimeout(200)
    assert.equal(await hint.isVisible(), false, 'recommendation should not return after rotating')

    await phone.evaluate(() => window.__game.performAction({ type: 'dialog', id: 'nayara' }))
    await advanceDialogToChoice(phone)
    const rowCount = await phone.evaluate(() => window.__game.choiceRows().rows.length)
    const portraitCanvas = await canvas.boundingBox()
    assert(portraitCanvas, 'touch dialogue canvas has no bounding box')
    assert(
      portraitCanvas.height / rowCount >= 38,
      `touch dialogue target is only ${portraitCanvas.height / rowCount}px high`,
    )
    await canvas.screenshot({ path: `${OUT}/mobile-dialogue-expanded.png` })
    await canvas.tap({ position: { x: portraitCanvas.width / 2, y: portraitCanvas.height / rowCount / 2 } })
    await phone.waitForFunction(() => window.__game.dialog.busy, null, { timeout: 3000 })

    await phone.setViewportSize({ width: 844, height: 360 })
    await phone.waitForTimeout(200)
    assertCanvasSize(await canvas.boundingBox(), 576, 360, 'dynamic landscape viewport')
    await phone.evaluate(() => {
      const game = window.__game
      game.performAction({ type: 'exit' })
      game.enterScene('lookout')
    })
    const landscapeCanvas = await canvas.boundingBox()
    assert(landscapeCanvas, 'landscape interaction canvas has no bounding box')
    await canvas.tap({
      position: {
        x: (72 / 320) * landscapeCanvas.width,
        y: (176 / 200) * landscapeCanvas.height,
      },
    })
    await phone.waitForFunction(() => window.__game.verb === 'look', null, { timeout: 3000 })
    await phoneContext.close()

    const desktopContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const desktop = await desktopContext.newPage()
    await waitForGame(desktop)
    assert.equal(
      await desktop.locator('#phone-orientation-hint').isVisible(),
      false,
      'narrow desktop viewport must not show the phone recommendation',
    )
    assertCanvasSize(await desktop.locator('#screen').boundingBox(), 320, 200, 'narrow desktop viewport')
    await desktopContext.close()
  } finally {
    await browser.close()
  }

  assert.deepEqual(failures, [])
  console.log('mobile checks passed: portrait, landscape, rotation, touch dialogue, dynamic viewport, desktop exclusion')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
