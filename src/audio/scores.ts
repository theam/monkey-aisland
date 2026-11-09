/**
 * The soundtrack. Original compositions — same instincts as the LucasArts
 * island music (calypso lilt, off-beat skank, struck-metal lead, walking bass)
 * with our own melodies and harmony.
 *
 * Notation: one token per 16th note, bars separated by `|`.
 *   C4        play C4
 *   -         hold the previous note one more step
 *   .         rest
 *   D3+F3+A3  chord
 *   x         a hit (percussion voices ignore pitch)
 */
import type { VoiceName } from './voices'

export type Note = { note: string | null; dur: number; vel?: number }

export type Part = {
  voice: VoiceName
  gain?: number
  /** step index -> note(s) starting on that step */
  notes: Record<number, Note[]>
  /** loop length in steps; defaults to the score length */
  length?: number
  /** don't play before / after these steps (layer drops, iMUSE-ish) */
  enterAt?: number
  exitAt?: number
}

export type Score = {
  bpm: number
  /** 0..0.5 — pushes odd 16ths late, which is where the groove lives */
  swing?: number
  length: number
  parts: Part[]
}

/** Parse a tracker string into a Part. */
export function part(
  voice: VoiceName,
  bars: string,
  opts: { gain?: number; vel?: number; enterAt?: number; exitAt?: number } = {},
): Part {
  const tokens = bars
    .split('|')
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)

  const notes: Record<number, Note[]> = {}
  let lastStep = -1
  tokens.forEach((tok, i) => {
    if (tok === '.') {
      lastStep = -1
      return
    }
    if (tok === '-') {
      if (lastStep >= 0) for (const n of notes[lastStep]) n.dur += 1
      return
    }
    const pitches = tok === 'x' ? [null] : tok.split('+')
    notes[i] = pitches.map((p) => ({ note: p, dur: 1, vel: opts.vel ?? 1 }))
    lastStep = i
  })

  return {
    voice,
    notes,
    ...(opts.gain !== undefined ? { gain: opts.gain } : {}),
    ...(opts.enterAt !== undefined ? { enterAt: opts.enterAt } : {}),
    ...(opts.exitAt !== undefined ? { exitAt: opts.exitAt } : {}),
  }
}

function score(bpm: number, swing: number, parts: Part[]): Score {
  let length = 0
  for (const p of parts) {
    const steps = Object.keys(p.notes).map(Number)
    const end = steps.length ? Math.max(...steps) + 1 : 0
    // round each part up to a whole bar so loops line up
    const bars = Math.ceil(end / 16)
    p.length = bars * 16
    length = Math.max(length, p.length)
  }
  // Per-part loop lengths stay as they are, so a 2-bar shaker can ride under an
  // 8-bar melody without repeating the melody's silence.
  return { bpm, swing, length, parts }
}

// ---------------------------------------------------------------------------
// "Moonlight over Melee" — the lookout. D natural minor, i–VI–III–VII.
// Sparse, cold, a bit lonely. The steel drum answers itself across the bay.
// ---------------------------------------------------------------------------
const lookout = score(94, 0.16, [
  part(
    'bass',
    `D2 - - . . . A2 - . . D2 - . . . .
     |Bb1 - - . . . F2 - . . Bb1 - . . . .
     |F2 - - . . . C3 - . . F2 - . . . .
     |C2 - - . . . G2 - . . C2 - . . . .
     |D2 - - . . . A2 - . . D2 - . . D3 -
     |Bb1 - - . . . F2 - . . Bb1 - . . . .
     |F2 - - . . . C3 - . . A2 - . . . .
     |G2 - - . . . D3 - . . C3 - . . A2 -`,
    { gain: 0.9 },
  ),
  part(
    'pad',
    `. . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 .
     |. . Bb2+D3+F3 . . . Bb2+D3+F3 . . . Bb2+D3+F3 . . . Bb2+D3+F3 .
     |. . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 .
     |. . C3+E3+G3 . . . C3+E3+G3 . . . C3+E3+G3 . . . C3+E3+G3 .
     |. . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 .
     |. . Bb2+D3+F3 . . . Bb2+D3+F3 . . . Bb2+D3+F3 . . . Bb2+D3+F3 .
     |. . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 .
     |. . G2+Bb2+D3 . . . G2+Bb2+D3 . . . A2+C3+E3 . . . A2+C3+E3 .`,
    { gain: 0.5 },
  ),
  part(
    'steel',
    `. . . . A4 - . F4 - . D4 - - . . .
     |. . F4 - . . D4 - - . . . . . . .
     |. . . . C5 - . A4 - . F4 - - . . .
     |. . G4 - . . E4 - - . . . . . . .
     |. . . . A4 - . D5 - . C5 - - . . .
     |. . A4 - . . F4 - - . . . D4 - . .
     |. . . . C5 - . Bb4 - . A4 - - . . .
     |. . G4 - . . F4 - E4 - . D4 - - - -`,
    { gain: 0.95 },
  ),
  part(
    'marimba',
    `. . . . . . . . . . . . D4 . F4 .
     |. . . . . . . . . . . . Bb3 . D4 .
     |. . . . . . . . . . . . A3 . C4 .
     |. . . . . . . . . . . . G3 . C4 .
     |. . . . . . . . . . . . D4 . A4 .
     |. . . . . . . . . . . . F4 . D4 .
     |. . . . . . . . . . . . C4 . A3 .
     |. . . . . . . . . . . . D4 . . .`,
    { gain: 0.5, enterAt: 64 },
  ),
  part(
    'shaker',
    `x . x . x . x . x . x . x . x .
     |x . x . x . x . x . x . x . x .`,
    { gain: 0.45 },
  ),
  part(
    'conga',
    `. . . . . . x . . . . . x . . .
     |. . . . . . x . . . . x x . . .`,
    { gain: 0.6 },
  ),
  part('kick', `. . . . . . . . x . . . . . . .`, { gain: 0.7 }),
])

// ---------------------------------------------------------------------------
// "The Long Plank" — the dock. F major, brighter, a walking feel, because you
// are actually going somewhere.
// ---------------------------------------------------------------------------
const dockScore = score(110, 0.18, [
  part(
    'bass',
    `F2 - . F2 . . C3 - . . F2 - . A2 - .
     |D2 - . D2 . . A2 - . . D2 - . F2 - .
     |Bb1 - . Bb1 . . F2 - . . Bb1 - . D2 - .
     |C2 - . C2 . . G2 - . . C2 - . E2 - .
     |F2 - . F2 . . C3 - . . F2 - . A2 - .
     |D2 - . D2 . . A2 - . . D2 - . F2 - .
     |Bb1 - . Bb1 . . F2 - . . D2 - . C2 - .
     |C2 - . C2 . . G2 - . . C3 - - . . .`,
    { gain: 0.9 },
  ),
  part(
    'organ',
    `. . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 .
     |. . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 .
     |. . Bb2+D3+F3 . . . Bb2+D3+F3 . . . Bb2+D3+F3 . . . Bb2+D3+F3 .
     |. . C3+E3+G3 . . . C3+E3+G3 . . . C3+E3+G3 . . . C3+E3+G3 .
     |. . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 .
     |. . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 .
     |. . Bb2+D3+F3 . . . Bb2+D3+F3 . . . D3+F3+A3 . . . D3+F3+A3 .
     |. . C3+E3+G3 . . . C3+E3+G3 . . . C3+E3+G3 . . . G2+B2+D3 .`,
    { gain: 0.4 },
  ),
  part(
    'steel',
    `. . . . C5 - . A4 - . F4 - . A4 - .
     |. . D5 - . . A4 - . F4 - - . . . .
     |. . . . F5 - . D5 - . Bb4 - . D5 - .
     |. . E5 - . . C5 - . G4 - - . . . .
     |. . . . C5 - . A4 - . F4 - . C5 - .
     |. . D5 - . . F5 - . E5 - - . . . .
     |. . . . D5 - . Bb4 - . A4 - . F4 - .
     |. . G4 - . . B4 - . C5 - - - . . .`,
    { gain: 0.95 },
  ),
  part(
    'pluck',
    `F3 . . A3 . . C4 . . A3 . . F3 . . .
     |D3 . . F3 . . A3 . . F3 . . D3 . . .
     |Bb2 . . D3 . . F3 . . D3 . . Bb2 . . .
     |C3 . . E3 . . G3 . . E3 . . C3 . . .`,
    { gain: 0.45 },
  ),
  part(
    'shaker',
    `x . x . x . x . x . x . x . x .
     |x . x . x . x . x . x . x x x .`,
    { gain: 0.5 },
  ),
  part(
    'conga',
    `. . . x . . x . . . . x . . x .
     |. . . x . . x . . x . x . . x x`,
    { gain: 0.6 },
  ),
  part('kick', `x . . . . . . . x . . . . . x .`, { gain: 0.7 }),
  part('woodblock', `. . . . . . . . . . . . . . x .`, { gain: 0.4, enterAt: 64 }),
])

// ---------------------------------------------------------------------------
// "El Patilla (Two Drinks In)" — the bar. A minor going somewhere it shouldn't,
// faster, more percussion, everybody slightly out of time on purpose.
// ---------------------------------------------------------------------------
const barScore = score(126, 0.2, [
  part(
    'bass',
    `A2 - . A2 . E3 - . A2 - . C3 . E3 - .
     |F2 - . F2 . C3 - . F2 - . A2 . C3 - .
     |C2 - . C2 . G2 - . C2 - . E2 . G2 - .
     |G2 - . G2 . D3 - . G2 - . B2 . D3 - .
     |A2 - . A2 . E3 - . A2 - . C3 . E3 - .
     |F2 - . F2 . C3 - . F2 - . A2 . C3 - .
     |D2 - . D2 . A2 - . D2 - . F2 . A2 - .
     |E2 - . E2 . B2 - . E2 - . G2 . B2 - .`,
    { gain: 0.95 },
  ),
  part(
    'organ',
    `. . A3+C4+E4 . . . A3+C4+E4 . . . A3+C4+E4 . . . A3+C4+E4 .
     |. . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 .
     |. . C3+E3+G3 . . . C3+E3+G3 . . . C3+E3+G3 . . . C3+E3+G3 .
     |. . G3+B3+D4 . . . G3+B3+D4 . . . G3+B3+D4 . . . G3+B3+D4 .
     |. . A3+C4+E4 . . . A3+C4+E4 . . . A3+C4+E4 . . . A3+C4+E4 .
     |. . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 . . . F3+A3+C4 .
     |. . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 . . . D3+F3+A3 .
     |. . E3+G3+B3 . . . E3+G3+B3 . . . E3+G3+B3 . . . E3+G3+B3 .`,
    { gain: 0.42 },
  ),
  part(
    'steel',
    `. . E5 - . C5 - . A4 - . C5 . E5 - .
     |. . C5 - . A4 - . F4 - . A4 . C5 - .
     |. . G4 - . E4 - . C4 - . E4 . G4 - .
     |. . D5 - . B4 - . G4 - . B4 . D5 - .
     |. . E5 - . C5 - . A4 - . E5 . A5 - .
     |. . C5 - . F5 - . E5 - . C5 . A4 - .
     |. . D5 - . A4 - . F4 - . A4 . D5 - .
     |. . E5 - . B4 - . G4 - E4 - . . . .`,
    { gain: 0.9 },
  ),
  part(
    'marimba',
    `A3 . C4 . E4 . C4 . A3 . C4 . E4 . C4 .
     |F3 . A3 . C4 . A3 . F3 . A3 . C4 . A3 .
     |C3 . E3 . G3 . E3 . C3 . E3 . G3 . E3 .
     |G3 . B3 . D4 . B3 . G3 . B3 . D4 . B3 .`,
    { gain: 0.4, enterAt: 64 },
  ),
  part(
    'shaker',
    `x . x x x . x . x . x x x . x .
     |x . x x x . x . x . x x x x x x`,
    { gain: 0.5 },
  ),
  part(
    'conga',
    `. . x . . x x . . . x . . x x .
     |. . x . . x x . . x x . . x x x`,
    { gain: 0.65 },
  ),
  part('kick', `x . . . . . x . x . . . . . x .`, { gain: 0.75 }),
  part('tamb', `. . . . x . . . . . . . x . . .`, { gain: 0.35 }),
  part('rim', `. . . . . . . . . . . x . . . .`, { gain: 0.4, enterAt: 128 }),
])

export const SCORES: Record<string, Score> = {
  lookout,
  dock: dockScore,
  bar: barScore,
}
