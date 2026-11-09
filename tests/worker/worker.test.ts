import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Analytics } from '../../src/engine/analytics'
import { readCampaign } from '../../src/engine/campaign'
import { parseEvent } from '../../worker/events'
import type { Context, Env } from '../../worker/endpoint'
import worker from '../../worker/index'

/**
 * The Worker is what stands between a public endpoint and the PostHog
 * projects, so these pin what it lets through and what it forwards.
 */

const PROD = 'monkeyaisland.theagilemonkeys.com'
const PREVIEW = 'abc123-monkey-aisland.example.workers.dev'
const VISIT = '6f1c2a54-9b3e-4d7a-8c21-0e5f4a3b2c1d'

type Forwarded = { url: string; body: Record<string, unknown> }

let forwarded: Forwarded[] = []
let pending: Promise<unknown>[] = []

const ctx: Context = { waitUntil: (p) => void pending.push(p) }

function env(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    POSTHOG_KEY: 'phc_production',
    POSTHOG_DEV_KEY: 'phc_development',
    POSTHOG_HOST: 'https://eu.i.posthog.com',
    PRODUCTION_HOSTS: `${PROD}, monkey-aisland.example.workers.dev`,
    ...overrides,
  }
}

type PostOptions = { host?: string; origin?: string; address?: string }

function post(body: unknown, options: PostOptions = {}): Request {
  const { host = PROD, origin = `https://${host}`, address = '203.0.113.7' } = options
  const headers: Record<string, string> = { 'content-type': 'text/plain;charset=UTF-8' }
  if (origin) headers.origin = origin
  if (address) headers['cf-connecting-ip'] = address
  return new Request(`https://${host}/api/event`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function send(request: Request, e: Env = env()): Promise<Response> {
  const response = await worker.fetch(request, e, ctx)
  await Promise.all(pending)
  return response
}

const opened = { event: 'game_opened', visit: VISIT, props: { touch: false, portrait: true, at: 0 } }

beforeEach(() => {
  forwarded = []
  pending = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    forwarded.push({ url, body: JSON.parse(String(init.body)) })
    return new Response(null, { status: 200 })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the allowlist', () => {
  it('accepts every event the game sends, as the game sends it', () => {
    const bodies: unknown[] = []
    vi.stubGlobal('navigator', { sendBeacon: () => false })
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return Promise.resolve({ ok: true })
    })
    const campaign = readCampaign(
      '?utm_source=hn&utm_medium=social&utm_campaign=Launch%20Week&utm_content=top&utm_term=games',
    )
    const a = new Analytics({ provider: 'posthog' }, campaign)
    a.track('game_opened', { touch: true, portrait: false })
    a.track('game_started')
    a.track('intro_ended', { skipped: true, seconds: 4 })
    for (const scene of ['lookout', 'dock', 'bar']) a.track(`reached_${scene}`)
    for (const dialog of ['nayara', 'giorgio', 'bigjohn', 'monkeys_challenge', 'duel']) {
      a.track('dialog_opened', { dialog })
    }
    a.track('won_duel')
    a.track('handoff_shown')
    a.track('chat_opened')

    expect(bodies).toHaveLength(14)
    for (const body of bodies) expect(parseEvent(body), JSON.stringify(body)).not.toBeNull()
  })

  it('drops an event the game never sends', () => {
    expect(parseEvent({ ...opened, event: 'purchase' })).toBeNull()
    expect(parseEvent({ ...opened, event: 'reached_../../admin' })).toBeNull()
  })

  it('drops the whole event for one property it does not expect', () => {
    expect(parseEvent({ ...opened, props: { ...opened.props, email: 'someone' } })).toBeNull()
    expect(parseEvent({ ...opened, props: { ...opened.props, dialog: 'nayara' } })).toBeNull()
  })

  it('drops a property of the wrong type or shape', () => {
    expect(parseEvent({ ...opened, props: { touch: 'yes' } })).toBeNull()
    expect(parseEvent({ ...opened, props: { at: -1 } })).toBeNull()
    expect(parseEvent({ ...opened, props: { at: 1.5 } })).toBeNull()
    expect(parseEvent({ ...opened, props: { at: 10_000_000 } })).toBeNull()
    expect(parseEvent({ ...opened, props: { utm_source: 'Not A Tag' } })).toBeNull()
    expect(parseEvent({ event: 'dialog_opened', visit: VISIT, props: { dialog: '<script>' } })).toBeNull()
  })

  it('drops a visit id that is not one the game makes', () => {
    expect(parseEvent({ ...opened, visit: 'someone@example.com' })).toBeNull()
    expect(parseEvent({ ...opened, visit: '' })).toBeNull()
  })

  it('drops anything that is not an event object', () => {
    for (const body of [null, 'game_opened', [opened], 42]) expect(parseEvent(body)).toBeNull()
  })
})

describe('the endpoint', () => {
  it('serves everything else from the static assets', async () => {
    const response = await send(new Request(`https://${PROD}/index.html`))
    expect(await response.text()).toBe('asset')
  })

  it('only takes POSTs', async () => {
    const response = await send(new Request(`https://${PROD}/api/event`))
    expect(response.status).toBe(405)
  })

  it('only takes events from the game’s own pages', async () => {
    expect((await send(post(opened, { origin: 'https://elsewhere.example' }))).status).toBe(403)
    expect((await send(post(opened, { origin: '' }))).status).toBe(403)
    expect(forwarded).toHaveLength(0)
  })

  it('refuses an address over the rate limit, before reading the body', async () => {
    const limited = env({ EVENT_LIMITER: { limit: async () => ({ success: false }) } })
    expect((await send(post(opened), limited)).status).toBe(429)
    expect(forwarded).toHaveLength(0)
  })

  it('keys the rate limit by the client’s address', async () => {
    const keys: string[] = []
    const counting = env({
      EVENT_LIMITER: {
        limit: async ({ key }) => {
          keys.push(key)
          return { success: true }
        },
      },
    })
    await send(post(opened, { address: '198.51.100.4' }), counting)
    expect(keys).toEqual(['198.51.100.4'])
  })

  it('refuses a body too large to be an event', async () => {
    const response = await send(post({ ...opened, padding: 'x'.repeat(4000) }))
    expect(response.status).toBe(413)
  })

  it('refuses something that is not JSON, or not an event', async () => {
    expect((await send(post('not json'))).status).toBe(400)
    expect((await send(post({ ...opened, event: 'purchase' }))).status).toBe(400)
    expect(forwarded).toHaveLength(0)
  })
})

describe('what reaches PostHog', () => {
  it('sends production hosts to the production project', async () => {
    expect((await send(post(opened))).status).toBe(204)
    expect(forwarded).toHaveLength(1)
    expect(forwarded[0].url).toBe('https://eu.i.posthog.com/i/v0/e/')
    expect(forwarded[0].body.api_key).toBe('phc_production')
  })

  it('sends any other host to the development project', async () => {
    await send(post(opened, { host: PREVIEW }))
    expect(forwarded[0].body.api_key).toBe('phc_development')
  })

  it('accepts and drops events when there is no token for the host', async () => {
    const response = await send(post(opened, { host: PREVIEW }), env({ POSTHOG_DEV_KEY: undefined }))
    expect(response.status).toBe(204)
    expect(forwarded).toHaveLength(0)
  })

  it('sends the checked properties, an anonymous event and the address for the country', async () => {
    await send(post(opened, { address: '203.0.113.7' }))
    const body = forwarded[0].body
    const properties = body.properties as Record<string, unknown>

    expect(body.event).toBe('game_opened')
    expect(body.distinct_id).toBe(VISIT)
    expect(properties).toMatchObject({ touch: false, portrait: true, at: 0 })
    expect(properties.$process_person_profile).toBe(false)
    expect(properties.$ip).toBe('203.0.113.7')
  })

  it('stamps the Worker’s time, whatever the client claims', async () => {
    const before = Date.now()
    await send(post({ ...opened, timestamp: '2001-01-01T00:00:00Z' }))
    // An extra top-level field is ignored, and the stamp is the Worker's own.
    const stamped = Date.parse(String(forwarded[0].body.timestamp))
    expect(stamped).toBeGreaterThanOrEqual(before)
  })

  it('switches GeoIP off rather than look up the Worker’s own address', async () => {
    await send(post(opened, { address: '' }))
    const properties = forwarded[0].body.properties as Record<string, unknown>
    expect(properties).not.toHaveProperty('$ip')
    expect(properties.$geoip_disable).toBe(true)
  })
})
