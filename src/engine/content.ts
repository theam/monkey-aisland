/**
 * Content layer.
 *
 * Every word in this game — dialogue, look-at responses, verb labels, the
 * hiring-chat copy, the sarcastic failure lines — lives in YAML under
 * `public/content/`. It is fetched at runtime, so a writer can edit a .yaml,
 * hit reload, and see the change without a build step or a TypeScript compiler
 * anywhere near them.
 */
import { load as parseYaml } from 'js-yaml'
import type { AnalyticsConfig, AnalyticsProvider, AnalyticsStatus } from './analytics'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Vec2 = [number, number]

/**
 * Hard limit on dialogue options, including the automatic way out. The original
 * never made you page through a menu of things to say, and once you do, picking
 * a line stops feeling like talking. Content is validated against this.
 */
export const MAX_CHOICE_ROWS = 6

export type GameConfig = {
  title: string
  locale: string
  start_scene: string
  scenes: string[]
  dialogs: string[]
  ui: string
  chat: {
    url: string
  }
  audio: AudioConfig
  analytics?: AnalyticsConfig
  links: Record<string, string>
  debug?: boolean
}

export type AudioTrackFile = {
  src: string
  /** seconds — the intro plays once, up to here; the loop starts here */
  intro_end?: number
  /** seconds — jump back to intro_end when playback reaches here */
  loop_end?: number
  /** seconds of overlap at the loop join */
  crossfade?: number
  gain?: number
}

export type AudioConfig = {
  music: boolean
  sfx: boolean
  volume: number
  /** 'file' plays the recordings; 'synth' plays the built-in WebAudio scores. */
  source?: 'file' | 'synth'
  files?: Record<string, AudioTrackFile>
  /** scene music id -> key in `files`. Use `default` as a catch-all. */
  scene_tracks?: Record<string, string>
}

export type DialogAction =
  | { type: 'exit' }
  | { type: 'scene'; to: string; entry?: string }
  | { type: 'chat' }
  | { type: 'interstitial'; id: string }
  | { type: 'give'; item: string }
  | { type: 'sfx'; id: string }
  | { type: 'music'; id: string }
  /** hand off to another dialogue tree (shared scenes, minigames) */
  | { type: 'dialog'; id: string }

export type DialogLine = {
  who?: string
  text: string
  /** 'laugh' | 'shrug' | 'point' … purely for sprite emphasis; optional. */
  emote?: string
  sfx?: string
  /** hold this line a bit longer/shorter than the auto-timing */
  hold?: number
}

export type DialogChoice = {
  text: string
  goto?: string
  once?: boolean
  if?: string[]
  unless?: string[]
  set?: string[]
  clear?: string[]
  action?: DialogAction
  /** true = leave the conversation after this line */
  exit?: boolean
  /** if the player's line differs from the menu label */
  say?: string | false
}

export type DialogBranch = {
  if?: string[]
  unless?: string[]
  goto: string
}

export type DialogNode = {
  lines?: (string | DialogLine)[]
  set?: string[]
  clear?: string[]
  action?: DialogAction
  goto?: string
  /**
   * Conditional continuation: the first branch whose if/unless passes wins.
   * Put a branch with no condition last as the fallback.
   */
  branch?: DialogBranch[]
  choices?: DialogChoice[]
}

export type DialogTree = {
  id: string
  speaker: string
  start: string
  nodes: Record<string, DialogNode>
}

export type VerbResponse =
  | string
  | string[]
  | {
      say?: string | string[]
      /** the speaker of `say`; defaults to the player */
      who?: string
      dialog?: string
      action?: DialogAction
      set?: string[]
      clear?: string[]
      sfx?: string
      if?: string[]
      unless?: string[]
      /** alternative response once a flag is set */
      then?: VerbResponse
    }

export type Hotspot = {
  id: string
  name: string
  rect: [number, number, number, number]
  walk_to?: Vec2
  /** where the actor should look after walking there */
  face?: 'left' | 'right'
  /** verb id -> response */
  verbs: Record<string, VerbResponse>
  /** hidden until a flag is set */
  if?: string[]
  unless?: string[]
}

export type SceneExit = {
  id: string
  name: string
  rect: [number, number, number, number]
  to: string
  entry?: string
  walk_to?: Vec2
  if?: string[]
  unless?: string[]
  /** shown instead of travelling, when blocked */
  blocked?: VerbResponse
}

export type SceneActor = {
  id: string
  at: Vec2
  facing?: 'left' | 'right'
  dialog?: string
  name?: string
  sprite?: string
  /** verb responses for this actor beyond Talk to */
  verbs?: Record<string, VerbResponse>
  scale?: number
  if?: string[]
  unless?: string[]
}

export type SceneDef = {
  id: string
  name: string
  background: string
  width: number
  music?: string
  /** camera behaviour: 'follow' scrolls with the player (the dock) */
  camera?: 'fixed' | 'follow'
  player_start: { at: Vec2; facing?: 'left' | 'right' }
  /** named entry points, e.g. entry.west = [10, 130] */
  entries?: Record<string, { at: Vec2; facing?: 'left' | 'right' }>
  /** polygon(s) the player may stand in */
  walkbox: Vec2[]
  /** perspective: actor scale at the top and bottom of the walkbox */
  scale?: { top: number; bottom: number }
  actors?: SceneActor[]
  hotspots?: Hotspot[]
  exits?: SceneExit[]
  /** first-visit narrator lines */
  on_enter?: { lines?: (string | DialogLine)[]; once?: boolean; if?: string[] }[]
}

export type VerbDef = {
  id: string
  label: string
  /** preposition for two-object sentences: Use X *with* Y, Give X *to* Y */
  prep?: string
  /** grid position in the verb panel */
  col: number
  row: number
  /** keyboard shortcut */
  key?: string
}

export type StartCopy = {
  /** the wordmark, lowercase with its terminal dot */
  wordmark: string
  prompt: string
  hint?: string
  footer?: string
}

export type TitleCopy = {
  /** big stacked title lines, drawn scaled up from the bitmap font */
  lines: { text: string; y: number; scale?: number; color?: string }[]
  subtitle?: string
  skip_hint: string
  /** captions that appear during the intro roll, at these times in seconds */
  roll: { at: number; text: string }[]
  /** seconds — when the intro hands over to the game. Match the music. */
  ends_at: number
  /** seconds — when the picture starts fading to black */
  fade_out_at?: number
}

export type UIStrings = {
  verbs: VerbDef[]
  default_verb: string
  /** how long a line of dialogue stays on screen before it advances itself */
  pacing?: { perChar?: number; base?: number; min?: number; max?: number }
  start?: StartCopy
  title?: TitleCopy
  sentence: {
    walk_to: string
    to: string
    with: string
    /** e.g. "Look at" when nothing is selected */
    idle: string
  }
  labels: Record<string, string>
  /** verb id -> pool of sarcastic fallbacks */
  defaults: Record<string, string[]>
  interstitials: Record<
    string,
    { kicker?: string; paragraphs: string[]; button: string; cancel?: string; note?: string; aside?: string }
  >
  counting: CountingCopy
  credits: string[]
}

/**
 * The game's own privacy notice: what it counts about play, and the switch to
 * stop it. Opened from the Privacy link on the start screen. The hiring chat
 * has its own notice for what it collects.
 */
export type CountingCopy = {
  /** the link on the start screen */
  link: string
  /** a line above the title, in the game's voice */
  kicker?: string
  title: string
  /** before the plain paragraphs: where the jokes stop */
  intro?: string
  /** shown while the game is configured to count; `{processor}` is filled in */
  paragraphs: string[]
  /** after the plain paragraphs: where the jokes resume */
  outro?: string
  /** the label the facts fold away under when the browser has already said no */
  folded: string
  /** where to exercise data rights, and the regulator to complain to */
  rights: { label: string; email: string; complaint: string; complaint_url: string }
  /** who receives the counts, one line per provider the game can be set to */
  processors: Partial<Record<AnalyticsProvider, string>>
  /** one line per state the visit can be in */
  status: Record<AnalyticsStatus, string>
  opt_out: string
  opt_in: string
  close: string
}

export type Content = {
  config: GameConfig
  ui: UIStrings
  scenes: Map<string, SceneDef>
  dialogs: Map<string, DialogTree>
  /** speaker id -> display name / colour, from ui.yaml `speakers` */
  speakers: Map<string, { name: string; color: string }>
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const BASE = import.meta.env.BASE_URL ?? '/'

async function fetchYaml<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`.replace(/([^:])\/\//g, '$1/')
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`)
  const text = await res.text()
  try {
    return parseYaml(text) as T
  } catch (err) {
    throw new Error(`YAML error in ${url}: ${(err as Error).message}`)
  }
}

export async function loadContent(): Promise<Content> {
  const config = await fetchYaml<GameConfig>('content/game.yaml')
  requireKeys(config, ['title', 'start_scene', 'scenes', 'dialogs', 'ui'], 'game.yaml')

  const locale = config.locale || 'en'
  const dir = `content/${locale}/`

  const [ui, sceneFiles, dialogFiles] = await Promise.all([
    fetchYaml<UIStrings & { speakers?: Record<string, { name: string; color: string }> }>(dir + config.ui),
    Promise.all(config.scenes.map((f) => fetchYaml<SceneDef>(dir + f))),
    Promise.all(config.dialogs.map((f) => fetchYaml<Record<string, unknown>>(dir + f))),
  ])

  requireKeys(ui, ['verbs', 'sentence', 'defaults', 'counting'], config.ui)
  requireKeys(
    ui.counting,
    ['link', 'title', 'paragraphs', 'folded', 'rights', 'processors', 'status', 'opt_out', 'opt_in', 'close'],
    `${config.ui} counting`,
  )

  const scenes = new Map<string, SceneDef>()
  for (const s of sceneFiles) {
    requireKeys(s, ['id', 'background', 'walkbox', 'player_start'], `scene ${s?.id ?? '?'}`)
    s.width = s.width || 320
    s.camera = s.camera || (s.width > 320 ? 'follow' : 'fixed')
    scenes.set(s.id, s)
  }

  const dialogs = new Map<string, DialogTree>()
  for (const file of dialogFiles) {
    const trees = (file.trees ?? file) as Record<string, Omit<DialogTree, 'id'>>
    for (const [id, tree] of Object.entries(trees)) {
      if (id === 'trees') continue
      if (!tree || typeof tree !== 'object' || !('nodes' in tree)) continue
      dialogs.set(id, {
        id,
        speaker: tree.speaker ?? id,
        start: tree.start ?? 'root',
        nodes: tree.nodes,
      })
    }
  }

  const speakers = new Map<string, { name: string; color: string }>()
  for (const [id, s] of Object.entries(ui.speakers ?? {})) speakers.set(id, s)

  const content: Content = { config, ui, scenes, dialogs, speakers }
  validateContent(content)
  return content
}

function requireKeys(obj: unknown, keys: string[], where: string): void {
  if (!obj || typeof obj !== 'object') throw new Error(`${where}: expected a YAML mapping`)
  const missing = keys.filter((k) => !(k in (obj as Record<string, unknown>)))
  if (missing.length) throw new Error(`${where}: missing required key(s): ${missing.join(', ')}`)
}

/**
 * Catch content mistakes at load time with a readable message rather than
 * halfway through a conversation. Writers will thank us.
 */
function validateContent(c: Content): void {
  const problems: string[] = []

  if (!c.scenes.has(c.config.start_scene)) {
    problems.push(`game.yaml start_scene "${c.config.start_scene}" is not a known scene`)
  }

  for (const scene of c.scenes.values()) {
    if (!Array.isArray(scene.walkbox) || scene.walkbox.length < 3) {
      problems.push(`scene ${scene.id}: walkbox needs at least 3 points`)
    }
    for (const exit of scene.exits ?? []) {
      if (!c.scenes.has(exit.to)) {
        problems.push(`scene ${scene.id}: exit "${exit.id}" points at unknown scene "${exit.to}"`)
      }
    }
    for (const actor of scene.actors ?? []) {
      if (actor.dialog && !c.dialogs.has(actor.dialog)) {
        problems.push(`scene ${scene.id}: actor "${actor.id}" references unknown dialog "${actor.dialog}"`)
      }
    }
  }

  for (const tree of c.dialogs.values()) {
    if (!tree.nodes[tree.start]) {
      problems.push(`dialog ${tree.id}: start node "${tree.start}" does not exist`)
    }
    for (const [nodeId, node] of Object.entries(tree.nodes)) {
      const at = `dialog ${tree.id}/${nodeId}`
      if (node.goto && !tree.nodes[node.goto]) problems.push(`${at}: goto "${node.goto}" does not exist`)
      for (const b of node.branch ?? []) {
        if (!tree.nodes[b.goto]) problems.push(`${at}: branch goto "${b.goto}" does not exist`)
      }
      for (const ch of node.choices ?? []) {
        if (ch.goto && !tree.nodes[ch.goto]) problems.push(`${at}: choice goto "${ch.goto}" does not exist`)
        if (!ch.goto && !ch.action && !ch.exit) problems.push(`${at}: choice "${ch.text}" goes nowhere`)
      }
      // Six options, no paging — see MAX_CHOICE_ROWS. Choices behind an `if`
      // don't count, since they can't all be showing at the start.
      if (node.choices?.length) {
        const always = node.choices.filter((c) => !c.if).length
        const hasExit = node.choices.some(
          (c) => c.exit === true || c.action?.type === 'exit' ||
            (c.goto ? tree.nodes[c.goto]?.action?.type === 'exit' : false),
        )
        const rows = always + (hasExit ? 0 : 1)
        if (rows > MAX_CHOICE_ROWS) {
          problems.push(
            `${at}: ${rows} options would show at once (max ${MAX_CHOICE_ROWS}, including the ` +
              `automatic way out). Split the node into a sub-menu, or gate choices with if/once.`,
          )
        }
      }
      if (!node.choices && !node.goto && !node.action && !node.branch) {
        // A terminal node is fine, but flag genuinely empty ones.
        if (!node.lines?.length) problems.push(`${at}: node is empty`)
      }
    }
  }

  problems.push(...countingNoticeProblems(c.config.analytics?.provider ?? 'none', c.ui.counting))
  problems.push(...analyticsConfigProblems(c.config.analytics))

  if (problems.length) {
    throw new Error(`Content problems:\n  - ${problems.join('\n  - ')}`)
  }
}

/**
 * Turning analytics on without saying so would be the one way to make the
 * privacy panel lie, so the loader refuses to. Switching `analytics.provider`
 * in game.yaml to something the notice does not name fails at load, in dev,
 * before anyone plays it.
 */
export function countingNoticeProblems(provider: AnalyticsProvider, copy: CountingCopy): string[] {
  const problems: string[] = []
  if (provider !== 'none' && !copy.processors?.[provider]) {
    problems.push(
      `game.yaml analytics.provider is "${provider}", but ui.yaml counting.processors has no ` +
        `line for it. The privacy panel has to name who receives the counts.`,
    )
  }
  for (const status of ['off', 'counting', 'opted_out', 'browser_signal'] as const) {
    if (!copy.status?.[status]) problems.push(`ui.yaml counting.status.${status} is missing`)
  }
  return problems
}

/**
 * game.yaml is public: it is served to every visitor and lives in a public
 * repository. The PostHog tokens belong to the Worker's secrets, where nobody
 * can lift them to send junk events, so the loader refuses a game.yaml that
 * still carries one in the shape it used to.
 */
export function analyticsConfigProblems(config: AnalyticsConfig | undefined): string[] {
  const legacy = ['key', 'dev_key', 'production_hosts', 'host'].filter(
    (field) => config && field in config,
  )
  return legacy.map(
    (field) =>
      `game.yaml analytics.${field} is no longer read: PostHog tokens and production hosts are ` +
      `Worker settings (wrangler.jsonc and Worker secrets). Remove it from the file.`,
  )
}

// ---------------------------------------------------------------------------
// Small helpers used by the runtime
// ---------------------------------------------------------------------------

export function normaliseLines(
  lines: (string | DialogLine)[] | undefined,
  defaultWho: string,
): DialogLine[] {
  if (!lines) return []
  return lines.map((l) => (typeof l === 'string' ? { who: defaultWho, text: l } : { who: l.who ?? defaultWho, ...l }))
}

export function isVerbResponseObject(
  r: VerbResponse,
): r is Exclude<VerbResponse, string | string[]> {
  return r !== null && typeof r === 'object' && !Array.isArray(r)
}
