/**
 * What the game is allowed to report, and nothing else.
 *
 * The browser posts each analytics event to /api/event. The Worker checks it
 * against this list and only then forwards it to PostHog, with a project token
 * the browser never sees. An unknown event, an extra property, a string where
 * a flag belongs: the whole event is dropped.
 *
 * A forged event that passes is still possible — whatever a real browser can
 * send, a script can send too — but it can only say what the game itself says.
 *
 * Adding an event to the game? Add it here, and to the Privacy panel
 * (ui.yaml `counting`), in the same change. Without the first it never
 * arrives; without the second the panel is wrong.
 */

type Kind = 'flag' | 'count' | 'id' | 'tag'

export type Props = Record<string, string | number | boolean>

export type GameEvent = { event: string; visit: string; props: Props }

/** Carried by every event: seconds into the visit, and the arrival link's campaign tags. */
const COMMON: Record<string, Kind> = {
  at: 'count',
  utm_source: 'tag',
  utm_medium: 'tag',
  utm_campaign: 'tag',
  utm_content: 'tag',
  utm_term: 'tag',
}

const EVENTS: Record<string, Record<string, Kind>> = {
  game_opened: { touch: 'flag', portrait: 'flag' },
  game_started: {},
  intro_ended: { skipped: 'flag', seconds: 'count' },
  dialog_opened: { dialog: 'id' },
  won_duel: {},
  handoff_shown: {},
  chat_opened: {},
}

/** `reached_lookout`, `reached_dock`, …: one per room, named after the scene. */
const REACHED = /^reached_[a-z0-9_]{1,32}$/

/** Scene and dialog ids, as content names them. */
const ID = /^[a-z0-9_-]{1,40}$/

/** A campaign tag as src/engine/campaign.ts normalises it. */
const TAG = /^[a-z0-9._-]{1,120}$/

/** crypto.randomUUID(), or the client's fallback where that is missing. */
const VISIT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|anon-[a-z0-9]{8,40})$/

/** A day, in seconds. No visit lasts longer than that and still means anything. */
const MAX_COUNT = 24 * 60 * 60

function fits(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case 'flag':
      return typeof value === 'boolean'
    case 'count':
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_COUNT
    case 'id':
      return typeof value === 'string' && ID.test(value)
    case 'tag':
      return typeof value === 'string' && TAG.test(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The event in a request body, if it is one the game could have sent; null
 * otherwise. The body is `{ event, visit, props }`, as src/engine/analytics.ts
 * writes it.
 */
export function parseEvent(body: unknown): GameEvent | null {
  if (!isRecord(body)) return null
  const { event, visit, props = {} } = body
  if (typeof event !== 'string' || typeof visit !== 'string' || !VISIT.test(visit)) return null
  if (!isRecord(props)) return null

  const allowed = EVENTS[event] ?? (REACHED.test(event) ? {} : null)
  if (!allowed) return null

  const clean: Props = {}
  for (const [key, value] of Object.entries(props)) {
    const kind = allowed[key] ?? COMMON[key]
    if (!kind || !fits(kind, value)) return null
    clean[key] = value as string | number | boolean
  }
  return { event, visit, props: clean }
}
