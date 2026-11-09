/**
 * Analytics: how far people get before the hiring chat.
 *
 * It counts what the GAME did — START was pressed, a room was reached, the
 * hiring chat was opened — never anything a player wrote, because a player cannot
 * write anything: every input in this game is a click on a line we authored.
 *
 * Four rules, in order of how much trouble breaking them would cause:
 *
 *   1. Count visits, never people. No cookies, no fingerprint, no id that
 *      outlives the tab: the visitor id is a random UUID in a variable, so two
 *      visits by the same person are two strangers. The only thing this module
 *      ever writes to the browser is the player's own "don't count me", and
 *      only when they ask for it.
 *   2. No means no. Global Privacy Control or Do Not Track in the browser, or
 *      the opt-out in the game's privacy panel, and nothing is sent at all.
 *   3. Nothing but identifiers, numbers and flags leaves the browser. The
 *      sanitiser below enforces it even if a caller gets careless — same rule,
 *      and the same 120-character cut, as the hiring chat's own telemetry.
 *      The one thing from outside the game is the campaign tags of the link
 *      the player arrived by (campaign.ts), which describe the ad, not them.
 *   4. Analytics never breaks the game. Every path here swallows its errors.
 *      A blocked request, an ad blocker, an offline tab: the game plays on.
 *
 * Rules 1–3 are what let this run without a consent banner under Spain's
 * audience-measurement exemption.
 *
 * It is off unless `analytics.provider` is set in game.yaml. An unconfigured
 * game sends nothing at all.
 *
 * Events never go to the analytics provider from here. They are posted to
 * /api/event on the game's own host, where the Worker (worker/) checks
 * them against an allowlist and forwards them with a project token that never
 * reaches the browser, so nobody can lift a token from the page and fill the
 * funnel with junk. Which project they land in is the Worker's decision, made
 * from the hostname. `npm run dev` has no Worker, so a local run sends to a
 * path that is not there; automated browsers never send at all, so the
 * browser checks in CI cannot pollute anything.
 */

import type { Campaign } from './campaign'

export type AnalyticsProvider = 'none' | 'posthog'

export type AnalyticsConfig = {
  /** 'none' (the default) sends nothing. */
  provider?: AnalyticsProvider
  /** Where events are posted: the Worker's endpoint on this host. */
  endpoint?: string
  /** Log events to the console instead of sending them. For development. */
  debug?: boolean
}

/** worker/endpoint.ts answers here. */
const DEFAULT_ENDPOINT = '/api/event'

/**
 * What the privacy panel tells the player about this visit.
 *
 * - `off`: nothing is configured, so the game counts nothing.
 * - `counting`: this visit is being counted.
 * - `opted_out`: the player said no in the privacy panel.
 * - `browser_signal`: the browser said no for them (GPC or DNT).
 */
export type AnalyticsStatus = 'off' | 'counting' | 'opted_out' | 'browser_signal'

/** The player's "don't count me". A choice they made, not an identifier. */
const OPT_OUT_KEY = 'monkey-aisland.analytics-opt-out.v1'

/** Anything longer than this smells like prose rather than an identifier. */
const MAX_STRING = 120

type Primitive = string | number | boolean | null

/**
 * The gate every property passes through. Numbers and booleans go as they are;
 * strings only if they are short and single-line; everything else is dropped
 * without comment. Objects, arrays and functions cannot leave.
 */
function sanitize(props: Record<string, unknown>): Record<string, Primitive> {
  const clean: Record<string, Primitive> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value
    } else if (typeof value === 'string' && value.length <= MAX_STRING && !value.includes('\n')) {
      clean[key] = value
    }
  }
  return clean
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `anon-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/**
 * Global Privacy Control is the signal that has legal weight somewhere; Do Not
 * Track is deprecated, but honouring it costs one comparison. Either one is
 * the player objecting before they have seen the game, and we take it as such.
 */
function browserSaysNo(): boolean {
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
    return nav.globalPrivacyControl === true || nav.doNotTrack === '1'
  } catch {
    return false
  }
}

/** Playwright, Puppeteer, Selenium: the browser checks, not a player. */
function isAutomated(): boolean {
  try {
    return navigator.webdriver === true
  } catch {
    return false
  }
}

function readOptOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1'
  } catch {
    return false
  }
}

function writeOptOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(OPT_OUT_KEY, '1')
    else localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    /* private browsing: the choice still holds for this tab */
  }
}

export class Analytics {
  readonly provider: AnalyticsProvider
  private readonly config: AnalyticsConfig
  /** Playwright and friends: the browser checks, never counted. */
  private readonly automated = isAutomated()
  /** Memory only. Never written anywhere, never survives the tab. */
  private readonly visitor = randomId()
  private readonly startedAt = Date.now()
  private readonly browserSignal = browserSaysNo()
  private optedOut = readOptOut()
  /** Keys of events that must only ever fire once per visit. */
  private fired = new Set<string>()
  /** The arrival link's campaign tags, sent with every event. */
  private readonly campaign: Campaign

  constructor(config: AnalyticsConfig | undefined, campaign: Campaign = {}) {
    this.config = config ?? {}
    this.campaign = campaign
    this.provider = this.config.provider ?? 'none'
    if (this.config.debug && this.status !== 'counting') {
      console.info('[analytics] not counting this visit:', this.status)
    }
  }

  /** Whether the game has somewhere to send events (or is in debug mode). */
  get configured(): boolean {
    if (this.config.debug) return true
    return this.provider === 'posthog' && !this.automated
  }

  get status(): AnalyticsStatus {
    if (!this.configured) return 'off'
    if (this.browserSignal) return 'browser_signal'
    if (this.optedOut) return 'opted_out'
    return 'counting'
  }

  /** True only while this visit is actually being counted. */
  get enabled(): boolean {
    return this.status === 'counting'
  }

  /** The player's objection: stop now, and remember it in this browser. */
  optOut(): void {
    this.optedOut = true
    writeOptOut(true)
  }

  /** Undo optOut(). A browser signal still wins over this. */
  optIn(): void {
    this.optedOut = false
    writeOptOut(false)
  }

  /** Record an event. Safe to call from anywhere, at any time. */
  track(event: string, props: Record<string, unknown> = {}): void {
    if (!this.enabled) return
    try {
      const payload = sanitize({
        ...props,
        // On every event, not once: with no person profile there is nowhere
        // else for "which ad brought this visit" to live.
        ...this.campaign,
        // Seconds into the visit: enough to see how long the middle drags,
        // and far too coarse to identify anybody.
        at: Math.round((Date.now() - this.startedAt) / 1000),
      })
      // Debug prints and stops. Someone adding ?analytics to the deployed game
      // is inspecting the funnel, not contributing to it.
      if (this.config.debug) {
        console.info('[analytics]', event, payload)
        return
      }
      this.post(this.config.endpoint || DEFAULT_ENDPOINT, { event, visit: this.visitor, props: payload })
    } catch (err) {
      // Rule 4. Never let a counter take the game down.
      console.warn('analytics failed', err)
    }
  }

  /**
   * Record an event at most once per visit. Every funnel step goes through
   * here: a step that can fire twice for one visit reports more conversions
   * than there were visits. `key` separates events that share a name, such as
   * one `dialog_opened` per conversation.
   */
  trackOnce(event: string, props: Record<string, unknown> = {}, key = event): void {
    if (!this.enabled || this.fired.has(key)) return
    this.fired.add(key)
    this.track(event, props)
  }

  /**
   * sendBeacon when it exists: it survives the page going away, which matters
   * for the last event of the visit. fetch with keepalive is the fallback, and
   * both are fire-and-forget — we never read the response and never retry.
   *
   * The body is JSON but labelled text/plain. That is a "simple" request, so
   * the browser never needs a CORS preflight for it, and the Worker parses the
   * body whatever the label says.
   */
  private post(url: string, body: unknown): void {
    const json = JSON.stringify(body)
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([json], { type: 'text/plain;charset=UTF-8' })
        if (navigator.sendBeacon(url, blob)) return
      }
    } catch {
      /* fall through to fetch */
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: json,
      keepalive: true,
      // No credentials: there are none to send, and asking for them would be
      // the one thing here that could look like tracking.
      credentials: 'omit',
    }).catch(() => {
      /* offline, blocked, whatever — see rule 4 */
    })
  }
}

/** The do-nothing instance, so callers never have to null-check. */
export const nullAnalytics = new Analytics({ provider: 'none' })
