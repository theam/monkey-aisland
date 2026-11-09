/**
 * The promo: not a trailer. A trailer for a five-minute game would be about
 * as long as the game, so instead the trailer is a character, and the player
 * does what anyone would do with a trailer that long.
 *
 * Read it like a screenplay. Each step happens after the one before it.
 * Lines take as long as they take to read at their `pace`; silent steps take
 * `for` seconds. `start` kicks things off alongside the step, without
 * waiting for them: walking, the door, the music, the small print.
 *
 * Every claim here is true of the game as it ships — no install, no sign-up,
 * every pixel drawn by code, a few minutes long. Keep it that way: engineers
 * fact-check recruiting videos, so anything said about the company has to be
 * true as well.
 */

export type Who = 'salesman' | 'player'

/**
 * How fast a line goes by. `rush` is the salesman in full flow: overwhelming,
 * and only just readable. `blitz` is the run-up to being stopped, roughly
 * twice that: not meant to be read, only survived. Nobody in this video gets
 * the game's own pacing.
 */
export type Pace = 'normal' | 'fast' | 'rush' | 'blitz'

/** The salesman's body language, from the step it is set on until changed. */
export type Manner =
  | 'stand' // grinning, waiting for you to finish walking
  | 'flail' // the arms, the famous arms
  | 'freeze' // stopped dead, in whatever shape the arms were in
  | 'think' // a hand on the chin
  | 'point' // at you
  | 'deadpan' // grin off, arms down
  | 'present' // ta-da

export type Action =
  | 'player_walks_in'
  | 'small_print'
  | 'music_stops'
  | 'music_resumes'
  | 'door_opens'
  | 'player_leaves'
  | 'salesman_to_centre'
  | 'end_card'

export type Step = {
  who?: Who
  text?: string
  pace?: Pace
  /** seconds a silent step lasts; for a line, extra time on screen */
  for?: number
  /** the line is cut off after this many seconds, mid-word */
  cut?: number
  manner?: Manner
  start?: Action[]
}

/**
 * The small print, under the one technical claim he makes, the way car
 * adverts do it: half the size of everything else and gone with the line.
 * Anyone who pauses to read it gets the last sentence.
 */
export const SMALL_PRINT =
  '*Claim made by sales. Sales has no idea what it means. ' +
  "Paused the video to read this? You're our kind of engineer."

export const END_CARD = {
  wordmark: 'the agile monkeys.',
  hiring: "We're hiring.",
  url: 'monkeyaisland.theagilemonkeys.com',
}

export const SCRIPT: Step[] = [
  // Under a second of walking, and he is already talking.
  { start: ['player_walks_in'], for: 0.7, manner: 'stand' },
  {
    who: 'salesman', manner: 'flail', pace: 'fast',
    text: 'Howdy! You look like a great engineer who loves coding and doing fun stuff!',
  },
  {
    who: 'salesman', pace: 'fast',
    text: "At The Agile Monkeys we're HIRING! So we made a small game to catch people like you!",
  },
  // From here he stops breathing.
  { who: 'salesman', pace: 'rush', text: 'A point-and-click adventure! (Definitely not inspired by any classic game.)' },
  // From here to being stopped, twice as fast again. The small print is
  // only there for people who pause.
  { who: 'salesman', pace: 'blitz', for: 0.3, start: ['small_print'], text: 'Did you know that every pixel is drawn with code?*' },
  {
    who: 'salesman', pace: 'blitz',
    text: 'Runs in your browser! No install! No sign-up! No uploading your CV and then typing your CV in again!',
  },
  {
    who: 'salesman', pace: 'blitz',
    text: 'How many monkeys would The Agile Monkeys hire if The Agile Monkeys hired monkeys?',
  },
  { who: 'salesman', pace: 'blitz', cut: 0.9, text: "They DO! And if you act now, I'll throw in a second monk-" },

  // The record stops.
  {
    who: 'player', manner: 'freeze', start: ['music_stops'],
    text: "Why don't you just tell me where I can play it?",
  },
  { for: 0.3 },
  { who: 'salesman', manner: 'think', text: '…Huh. I was told people nowadays need a video to engage.' },
  // ta-da, at the empty void
  { who: 'salesman', manner: 'present', pace: 'fast', text: 'So take a look at this TRAILER of the game!' },
  { who: 'player', text: "I don't need a trailer for a five-minute game. I just want to play." },
  // …and he hears a requirement.
  {
    who: 'salesman', manner: 'flail', pace: 'rush', cut: 2.2,
    text: "Great! Let's estimate it and put it into a sprint! How many story points? Two? " +
      'Does it fit into the next spr-',
  },
  // Programming, Motherfucker: the methodology. Every engineer knows it,
  // so "mother" and a grawlix is all it needs.
  { who: 'player', manner: 'freeze', text: 'I just want to play, mother#@%&!' },
  { who: 'salesman', manner: 'deadpan', pace: 'fast', text: '…Fair.' },

  // And we're back.
  {
    who: 'salesman', manner: 'flail', pace: 'fast', start: ['music_resumes', 'door_opens', 'player_leaves'],
    text: 'In you go! Enjoy!',
  },
  // He sees them out: through the door, and the door shut, before he moves.
  { for: 1.0, manner: 'stand' },
  { start: ['salesman_to_centre'], for: 0.6 },
  { who: 'salesman', manner: 'deadpan', text: '…Still watching? Kids these days swipe away after eight seconds.' },
  { who: 'salesman', manner: 'present', pace: 'fast', for: 0.3, text: "WE'RE HIRING!" },
  { start: ['end_card'], for: 3.1 },
]

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * Reading time, shaped like the game's dialogue pacing (ui.yaml `pacing`) but
 * much quicker, because the whole thing has to fit in under forty seconds:
 * `normal` is about 26 characters a second, `fast` about 30, `rush` about 50 —
 * overwhelming, and only just readable if you already know the words — and
 * `blitz` about 90.
 */
const PACES: Record<Pace, { perChar: number; base: number; perLine: number; min: number }> = {
  normal: { perChar: 38, base: 400, perLine: 100, min: 900 },
  fast: { perChar: 32, base: 300, perLine: 60, min: 800 },
  rush: { perChar: 20, base: 150, perLine: 0, min: 600 },
  blitz: { perChar: 10, base: 100, perLine: 0, min: 700 },
}

export function readingTime(text: string, pace: Pace, lineCount: number): number {
  const p = PACES[pace]
  const ms = p.base + text.length * p.perChar + Math.max(0, lineCount - 1) * p.perLine
  return Math.max(p.min, ms) / 1000
}

export type Line = { who: Who; text: string; pace: Pace; from: number; to: number }

export type Timeline = {
  lines: Line[]
  manners: { manner: Manner; from: number }[]
  actions: { action: Action; at: number }[]
  duration: number
}

/** Lay the script out in time. `wrap` says how many lines a text wraps to. */
export function buildTimeline(script: Step[], wrap: (text: string) => number): Timeline {
  const tl: Timeline = { lines: [], manners: [], actions: [], duration: 0 }
  let t = 0
  for (const step of script) {
    if (step.manner) tl.manners.push({ manner: step.manner, from: t })
    for (const action of step.start ?? []) tl.actions.push({ action, at: t })
    let length = step.for ?? 0
    if (step.who && step.text) {
      const pace = step.pace ?? 'normal'
      const read = readingTime(step.text, pace, wrap(step.text))
      length = step.cut ?? read + (step.for ?? 0)
      tl.lines.push({ who: step.who, text: step.text, pace, from: t, to: t + length })
    }
    t += length
  }
  tl.duration = t
  return tl
}

export function actionAt(tl: Timeline, action: Action): number {
  const found = tl.actions.find((a) => a.action === action)
  if (!found) throw new Error(`promo script has no "${action}"`)
  return found.at
}
