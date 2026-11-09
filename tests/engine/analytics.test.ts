import { readFileSync } from 'node:fs'
import { load as parseYaml } from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Analytics } from '../../src/engine/analytics'
import { readCampaign } from '../../src/engine/campaign'
import { analyticsConfigProblems, countingNoticeProblems, type CountingCopy } from '../../src/engine/content'

/**
 * These tests are the privacy rules written down as assertions. The module's
 * promises — nothing unless configured, nothing after a "no", nothing a player
 * wrote, nothing that survives the tab — are the kind that decay quietly, so
 * they get pinned here.
 */

type Sent = { url: string; body: Record<string, unknown> }

let sent: Sent[] = []
let stored: Map<string, string>

function stubBrowser(nav: Record<string, unknown> = {}): void {
  // Force the fetch path. sendBeacon returning false is its documented
  // fallback, and fetch is the transport whose body we can read synchronously
  // — a Blob only gives up its contents through a promise.
  vi.stubGlobal('navigator', { sendBeacon: () => false, ...nav })
}

beforeEach(() => {
  sent = []
  stored = new Map()
  stubBrowser()
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) })
    return Promise.resolve({ ok: true })
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const configured = () => new Analytics({ provider: 'posthog' })
const props = (i = 0) => sent[i].body.props as Record<string, unknown>

describe('analytics is off unless configured', () => {
  it('sends nothing with no config at all', () => {
    const a = new Analytics(undefined)
    a.track('game_opened')
    expect(a.status).toBe('off')
    expect(sent).toHaveLength(0)
  })

  it('sends nothing when the provider is none', () => {
    const a = new Analytics({ provider: 'none' })
    a.track('game_opened')
    expect(sent).toHaveLength(0)
  })

  it('never sends from an automated browser, so CI cannot pollute anything', () => {
    stubBrowser({ webdriver: true })
    const a = configured()
    a.track('game_opened')

    expect(a.status).toBe('off')
    expect(sent).toHaveLength(0)
  })
})

describe('events go to the Worker, never straight to PostHog', () => {
  it('posts to /api/event on the game’s own host', () => {
    configured().track('game_opened')

    expect(sent[0].url).toBe('/api/event')
  })

  it('sends the event, the visit and the properties, and no token', () => {
    configured().track('game_opened', { touch: true })

    expect(Object.keys(sent[0].body).sort()).toEqual(['event', 'props', 'visit'])
    expect(sent[0].body.event).toBe('game_opened')
    expect(JSON.stringify(sent[0].body)).not.toContain('phc_')
  })

  it('refuses a game.yaml that still carries tokens or production hosts', () => {
    const legacy = { provider: 'posthog', key: 'phc_x', dev_key: 'phc_y', production_hosts: [] }
    expect(analyticsConfigProblems(legacy as Parameters<typeof analyticsConfigProblems>[0])).toHaveLength(3)
  })

  it('accepts the shipped config', () => {
    const game = parseYaml(readFileSync('public/content/game.yaml', 'utf8')) as {
      analytics: Parameters<typeof analyticsConfigProblems>[0]
    }
    expect(game.analytics?.provider).toBe('posthog')
    expect(analyticsConfigProblems(game.analytics)).toEqual([])
  })
})

describe('no means no', () => {
  it('sends nothing when the browser sends Global Privacy Control', () => {
    stubBrowser({ globalPrivacyControl: true })
    const a = configured()
    a.track('game_opened')

    expect(a.status).toBe('browser_signal')
    expect(sent).toHaveLength(0)
  })

  it('sends nothing when the browser sends Do Not Track', () => {
    stubBrowser({ doNotTrack: '1' })
    configured().track('game_opened')

    expect(sent).toHaveLength(0)
  })

  it('stops the moment the player opts out, and stays stopped on the next visit', () => {
    const a = configured()
    a.track('game_opened')
    a.optOut()
    a.track('game_started')

    expect(sent).toHaveLength(1)
    expect(a.status).toBe('opted_out')

    const nextVisit = configured()
    nextVisit.track('game_opened')
    expect(nextVisit.status).toBe('opted_out')
    expect(sent).toHaveLength(1)
  })

  it('stores nothing but the opt-out, and only once the player asks', () => {
    const a = configured()
    a.track('game_opened')
    expect(stored.size).toBe(0)

    a.optOut()
    expect([...stored.values()]).toEqual(['1'])

    a.optIn()
    expect(stored.size).toBe(0)
  })

  it('resumes counting after opting back in', () => {
    const a = configured()
    a.optOut()
    a.optIn()
    a.track('game_started')

    expect(a.status).toBe('counting')
    expect(sent).toHaveLength(1)
  })

  it('does not let the in-game switch override the browser signal', () => {
    stubBrowser({ globalPrivacyControl: true })
    const a = configured()
    a.optIn()
    a.track('game_opened')

    expect(a.status).toBe('browser_signal')
    expect(sent).toHaveLength(0)
  })

  it('still honours an opt-out when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('private browsing')
      },
      setItem: () => {
        throw new Error('private browsing')
      },
      removeItem: () => {
        throw new Error('private browsing')
      },
    })
    const a = configured()
    expect(a.status).toBe('counting')
    a.optOut()
    a.track('game_opened')

    expect(sent).toHaveLength(0)
  })
})

describe('what leaves the browser', () => {
  it('sends identifiers, numbers and flags', () => {
    configured().track('dialog_opened', { dialog: 'duel', touch: false })

    expect(sent).toHaveLength(1)
    expect(props().dialog).toBe('duel')
    expect(props().touch).toBe(false)
    expect(typeof props().at).toBe('number')
  })

  it('drops anything long enough to be prose', () => {
    configured().track('oops', { line: 'x'.repeat(121), short: 'fine' })

    expect(props().line).toBeUndefined()
    expect(props().short).toBe('fine')
  })

  it('drops multi-line strings, objects and arrays', () => {
    configured().track('oops', { note: 'two\nlines', blob: { a: 1 }, list: [1, 2] })

    expect(props().note).toBeUndefined()
    expect(props().blob).toBeUndefined()
    expect(props().list).toBeUndefined()
  })

  it('carries the arrival link’s campaign tags on every event', () => {
    const campaign = readCampaign('?utm_source=x&utm_campaign=Launch%20Q4&twclid=2-abc123')
    const a = new Analytics({ provider: 'posthog' }, campaign)
    a.track('game_opened')
    a.track('chat_opened')

    for (const i of [0, 1]) {
      expect(props(i).utm_source).toBe('x')
      expect(props(i).utm_campaign).toBe('launch-q4')
      expect(props(i)).not.toHaveProperty('twclid')
    }
  })

  it('sends no campaign properties when the visit arrived without tags', () => {
    configured().track('game_opened')

    expect(Object.keys(props()).filter((k) => k.startsWith('utm_'))).toEqual([])
  })
})

describe('the visitor id', () => {
  it('differs between visits, so two sessions are two strangers', () => {
    configured().track('game_opened')
    configured().track('game_opened')

    expect(sent[0].body.visit).not.toBe(sent[1].body.visit)
  })

  it('is stable within one visit, so a funnel can be followed', () => {
    const a = configured()
    a.track('game_opened')
    a.track('chat_opened')

    expect(sent[0].body.visit).toBe(sent[1].body.visit)
  })
})

describe('once-only events', () => {
  it('fires a funnel step exactly once per visit', () => {
    const a = configured()
    a.trackOnce('reached_dock')
    a.trackOnce('reached_dock')

    expect(sent).toHaveLength(1)
  })

  it('keeps events that share a name apart by key', () => {
    const a = configured()
    a.trackOnce('dialog_opened', { dialog: 'nayara' }, 'dialog_opened:nayara')
    a.trackOnce('dialog_opened', { dialog: 'duel' }, 'dialog_opened:duel')
    a.trackOnce('dialog_opened', { dialog: 'nayara' }, 'dialog_opened:nayara')

    expect(sent.map((s) => (s.body.props as Record<string, unknown>).dialog)).toEqual(['nayara', 'duel'])
  })

  it('does not use up a step while the visit is not being counted', () => {
    const a = configured()
    a.optOut()
    a.trackOnce('reached_bar')
    a.optIn()
    a.trackOnce('reached_bar')

    expect(sent).toHaveLength(1)
  })
})

describe('analytics never breaks the game', () => {
  it('swallows a transport that throws', () => {
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('blocked by an extension')
      },
    })
    vi.stubGlobal('fetch', () => {
      throw new Error('offline')
    })

    expect(() => configured().track('game_opened')).not.toThrow()
  })
})

describe('the privacy panel has to name who gets the counts', () => {
  const copy = (processors: CountingCopy['processors']): CountingCopy => ({
    link: 'Privacy',
    title: 'What this game counts',
    paragraphs: [],
    folded: 'f',
    rights: { label: 'r', email: 'e', complaint: 'c', complaint_url: 'u' },
    processors,
    status: { off: 'a', counting: 'b', opted_out: 'c', browser_signal: 'd' },
    opt_out: 'x',
    opt_in: 'y',
    close: 'z',
  })

  it('refuses a provider the notice does not name', () => {
    expect(countingNoticeProblems('posthog', copy({}))).toHaveLength(1)
  })

  it('accepts a provider the notice names, and no provider at all', () => {
    expect(countingNoticeProblems('posthog', copy({ posthog: 'PostHog' }))).toEqual([])
    expect(countingNoticeProblems('none', copy({}))).toEqual([])
  })

  it('names the provider in the shipped copy', () => {
    const ui = parseYaml(readFileSync('public/content/en/ui.yaml', 'utf8')) as { counting: CountingCopy }
    expect(countingNoticeProblems('posthog', ui.counting)).toEqual([])
  })
})
