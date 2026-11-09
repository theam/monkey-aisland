/**
 * The analytics endpoint: POST /api/event.
 *
 * The browser posts each analytics event here; this checks it and forwards it
 * to PostHog with a project token kept in the Worker's secrets, so there is no
 * token in the page or in the repository for anyone to lift.
 *
 * What it refuses, cheapest check first:
 *   - anything but a POST from one of the game's own pages (Origin header);
 *   - more than the rate limit allows from one address (wrangler.jsonc);
 *   - a body that is too large, is not JSON, or is not an event the game sends
 *     (events.ts).
 *
 * Accepted events get 204 whether or not they are forwarded, so the response
 * tells a forger nothing about which project they reached, if any.
 */

import { parseEvent, type GameEvent } from './events'

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** Cloudflare's rate-limiting binding, keyed by the client's address. */
  EVENT_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> }
  /** Production PostHog project token. A Worker secret. */
  POSTHOG_KEY?: string
  /** Development project token, for preview URLs and `wrangler dev`. Optional secret. */
  POSTHOG_DEV_KEY?: string
  /** PostHog ingestion host. */
  POSTHOG_HOST?: string
  /** Comma-separated hostnames whose events go to the production project. */
  PRODUCTION_HOSTS?: string
}

export interface Context {
  waitUntil(promise: Promise<unknown>): void
}

export const EVENT_PATH = '/api/event'

/** A real event is about 300 bytes. */
const MAX_BODY = 2048

const DEFAULT_HOST = 'https://eu.i.posthog.com'

const empty = (status: number, headers?: HeadersInit) => new Response(null, { status, headers })

export async function handleEvent(request: Request, url: URL, env: Env, ctx: Context): Promise<Response> {
  if (request.method !== 'POST') return empty(405, { allow: 'POST' })

  // Browsers always send Origin on a POST and never let a page lie about it,
  // so this stops other sites from turning their visitors into our players.
  // A script can set any Origin it likes; the checks below are for that.
  if (request.headers.get('origin') !== url.origin) return empty(403)

  const address = request.headers.get('cf-connecting-ip') ?? ''
  if (env.EVENT_LIMITER && address) {
    const { success } = await env.EVENT_LIMITER.limit({ key: address })
    if (!success) return empty(429)
  }

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return empty(413)
  const text = await request.text()
  if (text.length > MAX_BODY) return empty(413)

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return empty(400)
  }
  const event = parseEvent(body)
  if (!event) return empty(400)

  const key = projectToken(url.hostname, env)
  if (key) ctx.waitUntil(forward(postHogEvent(event, key, address), env))
  return empty(204)
}

/**
 * Production hosts send to the production project; anywhere else — a preview
 * URL, `wrangler dev` — is us testing, and goes to the development project,
 * or nowhere when it has no token.
 */
export function projectToken(hostname: string, env: Env): string | undefined {
  const production = (env.PRODUCTION_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)
  return (production.includes(hostname) ? env.POSTHOG_KEY : env.POSTHOG_DEV_KEY) || undefined
}

export function postHogEvent(event: GameEvent, token: string, address: string, now = new Date()) {
  return {
    api_key: token,
    event: event.event,
    distinct_id: event.visit,
    // The Worker's clock, not the client's: a forged event cannot be backdated.
    timestamp: now.toISOString(),
    properties: {
      ...event.props,
      // Anonymous event: counted without building a person profile for a
      // throwaway id.
      $process_person_profile: false,
      $lib: 'monkey-aisland-worker',
      // PostHog's GeoIP reads the country from this, as it read the browser's
      // own address before the Worker sat in between. The project discards it
      // afterwards, with every field finer than the country.
      ...(address ? { $ip: address } : { $geoip_disable: true }),
    },
  }
}

async function forward(payload: ReturnType<typeof postHogEvent>, env: Env): Promise<void> {
  const host = (env.POSTHOG_HOST || DEFAULT_HOST).replace(/\/$/, '')
  try {
    const response = await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) console.warn('posthog rejected an event', response.status)
  } catch (err) {
    console.warn('posthog unreachable', err)
  }
}
