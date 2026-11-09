/**
 * The Monkey AIsland — boot.
 */
import { Display } from './engine/display'
import { loadContent } from './engine/content'
import { Game, NOT_START_KEYS } from './engine/game'
import { GameState } from './engine/state'
import { Analytics } from './engine/analytics'
import { readCampaign } from './engine/campaign'
import { isOverlayOpen, showPrivacyPanel } from './engine/overlay'
import type { SoundSystem } from './engine/sound'
import * as clock from './engine/clock'
import { buildCast } from './art/cast'
import { buildPainters } from './art/scenes'
import { usesTouchPrimaryInput } from './platform/media'
import { setupOrientationHint } from './platform/orientation-hint'

const boot = document.getElementById('boot') as HTMLDivElement

/** Page controls whose clicks must not unlock audio and start the music. */
const NOT_PLAY_GESTURES = '#privacy-link, #overlay, #phone-orientation-hint'

function fail(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.error(err)
  boot.classList.remove('gone')
  boot.innerHTML = ''
  const box = document.createElement('div')
  const h = document.createElement('div')
  h.textContent = 'THE GAME FAILED TO LOAD'
  h.style.marginBottom = '1.5em'
  const pre = document.createElement('pre')
  pre.className = 'err'
  pre.textContent = message
  const hint = document.createElement('div')
  hint.className = 'err'
  hint.style.marginTop = '1.5em'
  hint.textContent =
    'If you are editing the YAML in public/content/, the message above is almost certainly about that.'
  box.appendChild(h)
  box.appendChild(pre)
  box.appendChild(hint)
  boot.appendChild(box)
}

async function main(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement | null
  if (!canvas) throw new Error('no #screen canvas in the page')

  if (usesTouchPrimaryInput()) document.body.classList.add('touch')
  const orientationHint = document.getElementById('phone-orientation-hint')
  if (orientationHint) setupOrientationHint(orientationHint)

  const params = new URLSearchParams(location.search)
  // Progress is never saved, so a reload is always a fresh game. This only
  // clears progress written by earlier builds.
  GameState.clearLegacySave()

  const display = new Display(canvas)
  const content = await loadContent()
  if (params.has('debug')) content.config.debug = true
  document.title = content.config.title || document.title

  const sprites = buildCast()
  const painters = buildPainters()
  const game = new Game(display, content, sprites, painters)

  // Analytics before begin(), so the first scene is counted like every other.
  // Off unless game.yaml configures it; `?analytics` logs events to the console
  // instead of sending them, which is how you check the funnel while writing.
  // The ad's utm_ tags ride on every event and on to the hiring chat. Only
  // those five names are read; campaign.ts says why.
  const campaign = readCampaign(location.search)
  game.campaign = campaign
  const analytics = new Analytics(
    params.has('analytics')
      ? { ...content.config.analytics, debug: true }
      : content.config.analytics,
    campaign,
  )
  game.attachAnalytics(analytics)

  // The notice comes before the counting: a Privacy link on the start screen,
  // where the page-load event is the only thing counted yet, and gone once the
  // game starts. Clicking it does not press START; the start screen waits
  // underneath.
  const privacyLink = document.getElementById('privacy-link') as HTMLButtonElement | null
  if (privacyLink) {
    const counting = { copy: content.ui.counting, analytics }
    privacyLink.textContent = content.ui.counting.link
    privacyLink.hidden = false
    privacyLink.addEventListener('click', () => {
      showPrivacyPanel(counting, () => privacyLink.focus())
    })
    game.onPlayStarted = () => {
      privacyLink.hidden = true
    }
  }

  analytics.trackOnce('game_opened', {
    // How the screen is shaped, not who is looking at it: the game has a
    // separate touch layout and it is worth knowing which one people get.
    touch: usesTouchPrimaryInput(),
    portrait: window.innerHeight > window.innerWidth,
  })

  game.begin()
  if (params.has('skipintro')) game.skipIntro()
  // Dev-server hooks: poke at state from the console while writing content,
  // and let the browser checks (scripts/*.mjs) drive the game. A production
  // build has none of them.
  const devHooks = import.meta.env.DEV ? (window as unknown as Record<string, unknown>) : {}
  devHooks.__game = game

  // Audio is loaded after the first frame so a slow synth graph never delays
  // the picture, and only unlocked on a user gesture (browser policy).
  // Build the audio graph and start decoding the music straight away, so the
  // theme begins the moment the player clicks rather than seconds afterwards.
  // Output still only starts on a real gesture, as browsers require.
  let sound: SoundSystem | null = null
  try {
    const { createAudio } = await import('./audio')
    sound = createAudio(content.config.audio)
    game.attachSound(sound)
    sound.preload()
    const preview = () => sound?.previewLoopJoin?.(3) ?? false
    devHooks.__loopCheck = preview
    if (params.has('loopcheck')) window.setTimeout(preview, 1500)
  } catch (err) {
    console.warn('audio unavailable', err)
  }

  // Unlocking plays the theme that is already queued, so only a gesture that
  // means "play" may do it. The Privacy link, the panel it opens and the
  // orientation hint are the page, not the game, and Tab is how you reach
  // them: START unlocks after all of those.
  const unlockOnce = (event: Event) => {
    if (isOverlayOpen()) return
    if (event.target instanceof Element && event.target.closest(NOT_PLAY_GESTURES)) return
    if (event instanceof KeyboardEvent && NOT_START_KEYS.has(event.key.toLowerCase())) return
    window.removeEventListener('pointerdown', unlockOnce)
    window.removeEventListener('keydown', unlockOnce)
    sound?.unlock()
  }
  window.addEventListener('pointerdown', unlockOnce)
  window.addEventListener('keydown', unlockOnce)

  boot.classList.add('gone')
  window.setTimeout(() => boot.remove(), 600)

  let last = clock.now()
  const tick = (dt: number): void => {
    const t = clock.now()
    game.update(dt, t)
    game.draw(t)
    display.present()
    display.endFrame()
  }

  const frame = () => {
    const t = clock.now()
    const dt = Math.min(0.05, (t - last) / 1000)
    last = t
    tick(dt)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // Headless/hidden-tab stepper. requestAnimationFrame is throttled to zero in
  // a hidden tab, which is correct for players and useless for automated
  // testing, so expose a deterministic manual step.
  devHooks.__step = (ms = 16, steps = 1) => {
    for (let i = 0; i < steps; i++) {
      clock.advance(ms)
      last = clock.now()
      tick(ms / 1000)
    }
    return { mode: (game as unknown as { mode: string }).mode }
  }
}

main().catch(fail)
