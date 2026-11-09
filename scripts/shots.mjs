/**
 * Visual + functional check harness.
 *
 *   npm run dev          # in another terminal
 *   npm run shots        # writes shots/*.png and prints a report
 *   npm run shots -- --scale 4
 *
 * Why this exists: the game is 320x200 pixel art, so "looks fine" has to be
 * judged at an exact integer scale, and the interesting bugs are things like a
 * stray line crossing a painting. This grabs every screen at a known scale and
 * walks every conversation, reporting console errors and dead ends.
 *
 * It drives the game through the same hooks the game exposes for development
 * (`window.__game`), so it tests the real thing rather than a mock.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'

const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const BASE = baseIndex >= 0 ? args[baseIndex + 1] : process.env.BASE ?? 'http://localhost:5173'
const scale = Number(args[args.indexOf('--scale') + 1]) || 4
const OUT = 'shots'

const W = 320 * scale
const H = 200 * scale

const report = { shots: [], errors: [], dialogs: [], checks: [], route: [] }

async function main() {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })

  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`))

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  } catch {
    console.error(`Could not reach ${BASE}. Start the dev server first: npm run dev`)
    await browser.close()
    process.exit(1)
  }
  await page.waitForFunction(() => window.__game, null, { timeout: 15000 })

  const shot = async (name) => {
    const path = `${OUT}/${name}.png`
    await page.locator('#screen').screenshot({ path })
    report.shots.push(path)
  }

  const advanceDialogToChoice = () =>
    page.evaluate(async () => {
      const g = window.__game
      const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 4))
      for (let step = 0; step < 200 && g.dialog.options().length === 0; step++) {
        g.hushAll()
        await yieldFrame()
      }
    })

  // ---- the link preview --------------------------------------------------
  // og:image points at production, which a local run can't reach, so check
  // the same path on this server: it exists, and is the size the tags claim.
  report.checks.push(await page.evaluate(async () => {
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content ?? ''
    const image = new URL(meta('og:image'))
    const res = await fetch(image.pathname)
    const img = new Image()
    img.src = URL.createObjectURL(await res.blob())
    await img.decode().catch(() => {})
    const canonical = document.querySelector('link[rel="canonical"]')?.href ?? ''
    const check = {
      name: 'link preview tags and image',
      image: image.pathname,
      status: res.status,
      size: `${img.naturalWidth}x${img.naturalHeight}`,
      claimed: `${meta('og:image:width')}x${meta('og:image:height')}`,
      card: meta('twitter:card'),
    }
    check.pass =
      res.ok &&
      image.protocol === 'https:' &&
      check.size === check.claimed &&
      check.card === 'summary_large_image' &&
      meta('og:url') === canonical &&
      meta('og:title') !== '' && meta('og:description') !== '' && meta('og:image:alt') !== ''
    return check
  }))

  // ---- the two opening screens -------------------------------------------
  await page.waitForTimeout(1300) // let the start screen finish fading in
  await shot('01-start')

  await page.locator('#screen').click({ position: { x: W / 2, y: H / 2 } })
  await page.waitForTimeout(2500)
  await shot('02-intro')

  // ---- the rooms ---------------------------------------------------------
  await page.goto(`${BASE}/?skipintro`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__game)
  await page.waitForTimeout(400)

  const place = async (scene, entry, x, cam) =>
    page.evaluate(
      ([s, e, px, c]) => {
        const g = window.__game
        g.dialog.stop()
        g.hushAll()
        g.speech.length = 0
        g.enterScene(s, e)
        g.hushAll()
        g.speech.length = 0
        if (px !== null) g.player.place(px, 134)
        if (c !== null) g.camX = c
        g.display.pointer.over = false
      },
      [scene, entry, x, cam],
    )

  await place('lookout', undefined, null, 0)
  await page.waitForTimeout(500)
  await shot('03-lookout')

  // a close look at the player, scaled up, to judge the character art
  await page.evaluate(() => {
    const g = window.__game
    g.player.place(160, 138)
    g.display.pointer.over = false
  })
  await page.waitForTimeout(300)
  await page.locator('#screen').screenshot({
    path: `${OUT}/04-player-closeup.png`,
    clip: { x: 120 * scale, y: 90 * scale, width: 80 * scale, height: 54 * scale },
  })
  report.shots.push(`${OUT}/04-player-closeup.png`)

  for (const [i, cam] of [0, 200, 400].entries()) {
    await place('dock', 'west', cam + 150, cam)
    await page.waitForTimeout(400)
    await shot(`05-dock-${i}`)
  }

  for (const [i, cam] of [0, 120].entries()) {
    await place('bar', 'west', cam === 0 ? 90 : 290, cam)
    await page.waitForTimeout(400)
    await shot(`06-bar-${i}`)
  }

  // ---- a conversation, with the options panel showing --------------------
  await place('lookout', undefined, 200, 0)
  await page.evaluate(() => window.__game.performAction({ type: 'dialog', id: 'nayara' }))
  await advanceDialogToChoice()
  await page.waitForFunction(() => window.__game.dialog.options().length > 0, null, { timeout: 30000 })
  await page.waitForTimeout(200)
  await shot('07-dialogue')

  // ---- the funnel: the last screen links straight to the hiring chat ----
  await page.evaluate(() => {
    const g = window.__game
    g.dialog.stop()
    g.performAction({ type: 'interstitial', id: 'to_the_chat' })
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/08-interstitial.png` })
  report.shots.push(`${OUT}/08-interstitial.png`)

  const chatLink = page.locator('#overlay .interstitial a.mi-btn')
  const chatHref = await chatLink.getAttribute('href')
  const handoffChecks = {
    name: 'the last screen links straight to the hiring chat, and can be put off',
    chatLinked: chatHref === 'https://hiring.theagilemonkeys.com/?utm_source=monkey-aisland',
    opensNewTab: (await chatLink.getAttribute('target')) === '_blank',
    noLegalDetour: (await page.locator('#overlay .notice').count()) === 0,
    noApiEndpoint: (await page.locator('form').count()) === 0,
  }
  // "Not yet" goes back to the island.
  await page.locator('#overlay .interstitial button.mi-link').click()
  await page.waitForTimeout(100)
  handoffChecks.notYetReturnsToGame = !(await page.locator('#overlay').isVisible())
  // Following the link: stop the real navigation (CI must not start a
  // conversation in the production chat) and check the game says take your time.
  await page.evaluate(() => window.__game.performAction({ type: 'interstitial', id: 'to_the_chat' }))
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    document.addEventListener('click', (event) => event.preventDefault(), { capture: true, once: true })
  })
  await chatLink.click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/09-after-chat.png` })
  report.shots.push(`${OUT}/09-after-chat.png`)
  handoffChecks.saysTakeYourTime = await page.evaluate(
    () =>
      document.querySelector('#overlay .interstitial p')?.textContent ===
      window.__game.content.ui.interstitials.after_chat.paragraphs[0],
  )
  await page.locator('#overlay .interstitial button.mi-btn').click()
  await page.waitForTimeout(100)
  handoffChecks.backToIsland = !(await page.locator('#overlay').isVisible())
  report.checks.push({
    ...handoffChecks,
    pass: Object.entries(handoffChecks).every(([key, value]) => key === 'name' || value === true),
  })

  // ---- an ad's campaign tags reach the chat link; its click id does not ----
  await page.goto(
    `${BASE}/?skipintro&utm_source=x&utm_medium=paid-social&utm_campaign=Launch%20Q4&twclid=2-abc`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.waitForFunction(() => window.__game)
  await page.evaluate(() => window.__game.performAction({ type: 'interstitial', id: 'to_the_chat' }))
  await page.waitForTimeout(300)
  const campaignHref = await page.locator('#overlay .interstitial a.mi-btn').getAttribute('href')
  const campaignChecks = {
    name: 'the chat link carries the campaign the player arrived with, and nothing else',
    campaignLinked:
      campaignHref ===
      'https://hiring.theagilemonkeys.com/?utm_source=monkey-aisland&utm_medium=paid-social&utm_campaign=launch-q4',
  }
  report.checks.push({ ...campaignChecks, pass: campaignChecks.campaignLinked })

  // ---- the privacy panel: the notice comes before the counting -----------
  // ?analytics turns counting on in debug mode (console only), so the panel
  // shows everything it would in production, switch included.
  await page.goto(`${BASE}/?analytics`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__game)
  // The boot screen goes once audio is attached (or has failed to). Then count
  // unlocks: unlocking is what starts the queued theme, and only START may.
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('gone') ?? true)
  await page.evaluate(() => {
    const sound = window.__game.sound
    const unlock = sound.unlock.bind(sound)
    window.__unlocks = 0
    sound.unlock = () => {
      window.__unlocks++
      unlock()
    }
  })
  await page.waitForTimeout(300)
  const privacyLink = page.locator('#privacy-link')
  const linkOnStart = await privacyLink.isVisible()
  // Keyboard players reach it with Tab, and Tab must not count as "any key".
  await page.keyboard.press('Tab')
  const tabReachesLink = await page.evaluate(
    () => document.activeElement?.id === 'privacy-link' && window.__game.mode === 'start',
  )
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/10-privacy.png` })
  report.shots.push(`${OUT}/10-privacy.png`)
  const panel = page.locator('.privacy-panel')
  const panelOpens = await panel.isVisible()
  // The switch sits with the status line it changes, at the top.
  const switchWithStatus = await page.evaluate(
    () => document.querySelector('.privacy-panel .counting-status-box .counting-toggle') !== null,
  )
  await page.keyboard.press('a')
  await page.waitForTimeout(100)
  const readingDoesNotStart = await page.evaluate(() => window.__game.mode === 'start')
  await panel.locator('.counting-toggle').click()
  const optedOut = await page.evaluate(
    () =>
      localStorage.getItem('monkey-aisland.analytics-opt-out.v1') === '1' &&
      document.querySelector('.counting-status')?.textContent === window.__game.content.ui.counting.status.opted_out,
  )
  await panel.locator('.counting-toggle').click()
  const optedBackIn = await page.evaluate(() => localStorage.getItem('monkey-aisland.analytics-opt-out.v1') === null)
  // Click the text first, so focus is on the page rather than a button: the
  // Escape that closes the panel must not reach the start screen either.
  await panel.locator('p').first().click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  const closesToStart =
    !(await page.locator('#overlay').isVisible()) && (await page.evaluate(() => window.__game.mode === 'start'))
  const musicWaitsForStart = await page.evaluate(
    () => window.__unlocks === 0 && (window.__game.sound.files?.id ?? null) === null,
  )
  await page.locator('#screen').click({ position: { x: W / 2, y: H / 2 } })
  await page.waitForTimeout(200)
  const startStartsMusic = await page.evaluate(() => window.__unlocks > 0)
  const privacyChecks = {
    name: 'privacy panel before START, with a working opt-out',
    linkOnStart,
    tabReachesLink,
    panelOpens,
    readingDoesNotStart,
    switchWithStatus,
    optedOut,
    optedBackIn,
    closesToStart,
    musicWaitsForStart,
    startStartsMusic,
    linkGoneOnceStarted: !(await privacyLink.isVisible()),
  }
  report.checks.push({
    ...privacyChecks,
    pass: Object.entries(privacyChecks).every(([key, value]) => key === 'name' || value === true),
  })

  // A browser that sends Global Privacy Control gets its answer first, no
  // switch to argue with, and the rest folded away because none of it applies.
  const gpcPage = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await gpcPage.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true })
  })
  await gpcPage.goto(`${BASE}/?analytics`, { waitUntil: 'domcontentloaded' })
  await gpcPage.waitForFunction(() => window.__game)
  await gpcPage.waitForTimeout(300)
  await gpcPage.locator('#privacy-link').click()
  await gpcPage.waitForTimeout(200)
  await gpcPage.screenshot({ path: `${OUT}/11-privacy-gpc.png` })
  report.shots.push(`${OUT}/11-privacy-gpc.png`)
  const gpcChecks = await gpcPage.evaluate(() => {
    const section = document.querySelector('.privacy-panel .counting')
    const folded = section?.querySelector('details.counting-folded')
    return {
      name: 'privacy panel answers a browser signal first, with nothing to switch',
      statusFirst: section?.firstElementChild?.classList.contains('counting-status-box') === true,
      saysBrowserSignal:
        section?.querySelector('.counting-status')?.textContent ===
        window.__game.content.ui.counting.status.browser_signal,
      noSwitch: section?.querySelector('.counting-toggle')?.hidden === true,
      factsFolded: Boolean(folded) && !folded.open,
    }
  })
  await gpcPage.close()
  report.checks.push({
    ...gpcChecks,
    pass: Object.entries(gpcChecks).every(([key, value]) => key === 'name' || value === true),
  })

  // ---- walk every conversation ------------------------------------------
  await page.goto(`${BASE}/?skipintro`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__game)
  report.dialogs = await page.evaluate(async () => {
    const g = window.__game
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const out = []
    for (const id of [...g.content.dialogs.keys()]) {
      g.dialog.stop()
      g.enterScene(id === 'nayara' ? 'lookout' : 'bar', 'west')
      g.performAction({ type: 'dialog', id })
      let steps = 0
      let maxRows = 0
      const noWayOut = []
      while (g.dialog.active && steps < 60) {
        // fast-forward whatever is being said
        for (let i = 0; i < 200 && g.dialog.active && g.dialog.options().length === 0; i++) {
          g.hushAll()
          await sleep(4)
        }
        if (!g.dialog.active) break
        const rows = g.choiceRows().rows
        if (!rows.length) break
        maxRows = Math.max(maxRows, rows.length)
        // Every decision must offer a way out: either the automatic one, or an
        // exit the author wrote (in which case the automatic one steps aside).
        if (!rows.some((r) => r.index === -1)) {
          const node = g.dialog.tree?.nodes?.[g.dialog.nodeId]
          const authored = (node?.choices ?? []).some(
            (c) => c.exit === true || c.action?.type === 'exit' || c.goto === 'leave',
          )
          if (!authored) noWayOut.push(`${g.dialog.treeId}/${g.dialog.nodeId}`)
        }
        // Prefer something not yet said, so sub-menus are explored instead of
        // ping-ponging between a menu and its parent; when everything has been
        // said, take the way out.
        const fresh = rows.find((r) => r.index !== -1 && !r.used)
        const pick = fresh ?? rows[rows.length - 1]
        g.dialog.choose(pick.index)
        steps++
        if (g.mode === 'overlay') {
          document.querySelector('#overlay button.mi-btn')?.click()
          break
        }
      }
      out.push({ id, steps, maxRows, noWayOut })
    }
    return out
  })

  // ---- the route, driven by real clicks on the exits ---------------------
  // A broken exit blocks a candidate completely, so this walks the whole way in
  // the way a player does rather than by calling enterScene().
  await page.goto(`${BASE}/?skipintro`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__game)
  await page.evaluate(() => {
    const g = window.__game
    g.hushAll()
    g.speech.length = 0
  })
  const clickRoom = async (roomX, roomY) => {
    const camX = await page.evaluate(() => Math.round(window.__game.camX))
    await page.locator('#screen').click({
      position: { x: (roomX - camX) * scale, y: roomY * scale },
    })
  }
  const waitScene = async (name) => {
    try {
      await page.waitForFunction((n) => window.__game.state.scene === n, name, { timeout: 12000 })
      return true
    } catch {
      return false
    }
  }
  const route = []
  await clickRoom(308, 120) // the path down to the dock
  route.push({ to: 'dock', ok: await waitScene('dock') })
  await page.evaluate(() => {
    const g = window.__game
    g.hushAll()
    g.speech.length = 0
    g.player.place(640, 134)
    g.camX = 400
  })
  await page.waitForTimeout(300)
  await clickRoom(689, 100) // the door of El Patilla
  route.push({ to: 'bar', ok: await waitScene('bar') })
  report.route = route

  // ---- pixel checks: things that have actually broken before -------------
  report.checks.push(...(await page.evaluate(() => {
    const g = window.__game
    const checks = []

    // 1. The company name stays inside the top lookout sign.
    g.enterScene('lookout', 'west')
    const lookout = g.rooms.get('lookout').base
    let lookoutSignInkOn = 0
    let lookoutSignInkOff = 0
    for (let y = 95; y <= 102; y++) {
      for (let x = 56; x <= 171; x++) {
        if (lookout.get(x, y) !== 48) continue
        const insideBoard = x >= 64 && x <= 163
        if (insideBoard) lookoutSignInkOn++
        else lookoutSignInkOff++
      }
    }
    checks.push({
      name: 'THE AGILE MONKEYS lettering inside its board',
      inkOn: lookoutSignInkOn,
      inkOff: lookoutSignInkOff,
      pass: lookoutSignInkOff === 0 && lookoutSignInkOn > 0,
    })

    // 2. Nothing drawn straight through a painting. Only the CANVAS band is
    //    checked: the frame and the caption plate are legitimately flat, but a
    //    canvas row is always dithered, so one flat row there means a line has
    //    been drawn across it — which is how two cx/cy typos were found.
    g.enterScene('dock', 'west')
    const dock = g.rooms.get('dock').base
    const BOARD_X = [120, 196, 272, 348, 424, 500]
    const BW = 48
    const streaks = []
    for (const bx of BOARD_X) {
      for (let y = 61; y <= 78; y++) {
        const c0 = dock.get(bx + 2, y)
        let same = 0
        for (let x = bx + 2; x < bx + BW - 2; x++) if (dock.get(x, y) === c0) same++
        if (same === BW - 4) streaks.push({ board: bx, y, colour: c0 })
      }
    }
    checks.push({
      name: 'dock paintings free of drawn-through lines',
      streaks: streaks.length,
      where: streaks.slice(0, 4),
      pass: streaks.length === 0,
    })

    // 3. The HIRING card's lettering stays on its card.
    g.enterScene('bar', 'west')
    const bar = g.rooms.get('bar').base
    let off = 0
    let on = 0
    for (let y = 55; y < 105; y++) {
      for (let x = 120; x < 195; x++) {
        if (bar.get(x, y) !== 75) continue
        const onCard = x >= 134 && x <= 173 && y >= 77 && y <= 90
        if (onCard) on++
        else off++
      }
    }
    checks.push({ name: 'HIRING lettering inside its card', inkOn: on, inkOff: off, pass: off === 0 && on > 0 })

    // 4. Reading time must scale with line length, not clamp.
    const long = "Someone has scratched underneath: 'we are hiring. yes, still. yes, really.' And under THAT, in a different hand: 'nowhere was nicer.'"
    const p = g.content.ui.pacing
    const est = Math.min(p.max, p.base + long.length * p.perChar + 2 * p.perLine)
    const cps = long.length / (est / 1000)
    checks.push({ name: 'longest line readable', seconds: +(est / 1000).toFixed(2), charsPerSecond: +cps.toFixed(1), pass: cps < 22 })

    return checks
  })))

  await browser.close()

  // ---- report ------------------------------------------------------------
  const bad = [
    ...report.errors.map((e) => `console error: ${e}`),
    ...report.dialogs.filter((d) => d.steps === 0).map((d) => `dialogue ${d.id} produced no options`),
    ...report.dialogs.filter((d) => d.noWayOut.length > 0).map((d) => `dialogue ${d.id}: no way out at ${d.noWayOut.join(', ')}`),
    ...report.dialogs.filter((d) => d.maxRows > 6).map((d) => `dialogue ${d.id}: ${d.maxRows} options on screen at once (max 6, no paging)`),
    ...report.route.filter((r) => !r.ok).map((r) => `clicking the exit to ${r.to} did not travel`),
    ...report.checks.filter((c) => !c.pass).map((c) => `check failed: ${c.name} ${JSON.stringify(c)}`),
  ]

  console.log(`\n${report.shots.length} screenshots written to ${OUT}/ at ${scale}x (${W}x${H})`)
  console.log(`route by clicking: ${report.route.map((r) => `${r.to}:${r.ok ? 'ok' : 'FAIL'}`).join('  ')}`)
  console.log(`dialogues walked: ${report.dialogs.map((d) => `${d.id}:${d.steps}`).join('  ')}`)
  for (const c of report.checks) console.log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name} ${JSON.stringify(c)}`)
  if (bad.length) {
    console.error(`\n${bad.length} problem(s):`)
    for (const b of bad) console.error(`  - ${b}`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
