/**
 * The cast. Each character is a puppet spec plus hand-drawn overlays for the
 * features that carry the personality.
 *
 * Overlay coordinates are relative to the top-left corner of the head box.
 */
import { buildPuppet, type Overlay, type PuppetSpec } from './puppet'
import type { Sprite } from '../engine/sprite'

function mk(spec: PuppetSpec): PuppetSpec {
  return spec
}

// --- The candidate: you. --------------------------------------------------
// Deliberately androgynous: long hair, no gendered silhouette cues, a green
// field jacket over a lighter shirt, sleeves pushed up. The point is that
// anyone playing can read themselves into it.
const PLAYER = mk({
  id: 'player',
  height: 40,
  build: 0.95,
  skin: ['skin1', 'skin3', 'skin4'],
  shirt: ['leaf1', 'leaf3', 'leaf5'],
  trousers: ['blue0', 'blue1', 'blue2'],
  shoes: 'wood1',
  belt: 'wood2',
  sleeve: 0.55,
  eyes: 'ink',
  overlays: [
    // Long copper hair, drawn behind the body so it falls past the shoulders.
    // It has to be WIDER than the shoulders (13px) in its lower rows, or the
    // torso covers it and the whole thing reads as a helmet.
    {
      rows: [
        '.....hhhhhhh.....',
        '....hhhhhhhhh....',
        '...hhhhhhhhhhh...',
        '..hhhhhhhhhhhhh..',
        '..hhhh.....hhhh..',
        '..hhhh.....hhhh..',
        '..hhhh.....hhhh..',
        '..hhh.......hhh..',
        '..hhh.......hhh..',
        '.hhh.........hhh.',
        '.hhh.........hhh.',
        '.hhh.........hhh.',
        'hhh...........hhh',
        'hhh...........hhh',
        'hh.............hh',
        'hh.............hh',
        '.h.............h.',
      ],
      colors: { h: 'wood5' },
      at: [-4, -3],
      behind: true,
    },
    // The fringe, with a lit strand on the left where the light comes from.
    {
      rows: [
        '..hhhhh..',
        '.ihhhhhh.',
        'iihhhhhhh',
        'ih.....hh',
        'i.......h',
      ],
      colors: { h: 'wood5', i: 'wood7' },
      at: [0, -3],
    },
    // Collar of the shirt showing under the jacket.
    {
      rows: ['.ccccc.', 'cc...cc'],
      colors: { c: 'wood9' },
      at: [1, 9],
    },
    // A satchel strap across the chest. The diagonal is what stops the
    // silhouette being a rectangle with a head on it.
    {
      rows: [
        '..s..........',
        '...s.........',
        '....s........',
        '.....s.......',
        '......ss.....',
        '.......ss....',
        '........ss...',
      ],
      colors: { s: 'wood2' },
      at: [-2, 11],
    },
    // …and the bag it belongs to, on the hip.
    {
      rows: ['bbbbb', 'bbbbb', 'bbbb.'],
      colors: { b: 'wood3' },
      at: [8, 18],
    },
  ],
})

// --- Nayara: the lookout. First human every candidate meets. ---------------
const NAYARA = mk({
  id: 'nayara',
  height: 39,
  build: 0.9,
  skin: ['skin1', 'skin3', 'skin4'],
  shirt: ['teal1', 'teal3', 'teal4'],
  trousers: ['rock1', 'rock3', 'rock4'],
  shoes: 'wood2',
  belt: 'wood4',
  sleeve: 0.55,
  overlays: [
    // Long dark hair, drawn behind the body so it falls past the shoulders and
    // gives her a silhouette you can tell apart from the player at 40 pixels.
    {
      rows: [
        '...hhhhhhh...',
        '..hhhhhhhhh..',
        '.hhhhhhhhhhh.',
        'hhhhhhhhhhhhh',
        'hhhh.....hhhh',
        'hhhh.....hhhh',
        'hhhh.....hhhh',
        'hhhh.....hhhh',
        'hhhhhhhhhhhhh',
        'hhhhhhhhhhhhh',
        '.hhhhhhhhhhh.',
        '.hhhhhhhhhhh.',
        '..hhhhhhhhh..',
        '...hhhhhhh...',
        '....hhhhh....',
      ],
      colors: { h: 'wood1' },
      at: [-2, -3],
      behind: true,
    },
    {
      rows: ['..hhhhh..', '.hhhhhhh.', 'hhhhhhhhh', 'hh.....hh'],
      colors: { h: 'wood1' },
      at: [0, -3],
    },
  ],
})

// --- Giorgio: laughs at his own jokes, which are constant. -----------------
const GIORGIO = mk({
  id: 'giorgio',
  height: 40,
  build: 1.02,
  skin: ['skin1', 'skin2', 'skin3'],
  shirt: ['red1', 'red2', 'red3'],
  trousers: ['wood1', 'wood2', 'wood4'],
  shoes: 'wood1',
  belt: 'gold1',
  sleeve: 0.45,
  mouth: 'red0',
  overlays: [
    {
      // dense curls
      rows: [
        '.hh.hh.h.',
        'hhhhhhhhh',
        'hh.hhh.hh',
        'hhhhhhhhh',
        'hh.....hh',
        'h.......h',
      ],
      colors: { h: 'ink' },
      at: [0, -3],
    },
    {
      // gold chain, worn with total sincerity
      rows: ['.g...g.'],
      colors: { g: 'gold2' },
      at: [1, 10],
    },
  ],
})

// --- Big-John: enormous, quiet, knows why your database is lying. ----------
const BIGJOHN = mk({
  id: 'bigjohn',
  height: 44,
  build: 1.25,
  headScale: 1.08,
  skin: ['skin0', 'skin1', 'skin2'],
  shirt: ['blue0', 'blue1', 'blue2'],
  trousers: ['ink', 'grey1', 'grey2'],
  shoes: 'black',
  belt: 'wood1',
  sleeve: 0.85,
  armsCrossed: true,
  overlays: [
    {
      rows: [
        '.....hhhhhhh.....',
        '....hhhhhhhhh....',
        '...hhhhhhhhhhh...',
        '..hhhhhhhhhhhhh..',
        '..hhhh.....hhhh..',
        '..hhhh.....hhhh..',
        '..hhhh.....hhhh..',
        '..hhh.......hhh..',
        '.hhhh.......hhhh.',
        '.hhh.........hhh.',
        '.hhh.........hhh.',
        'hhhh.........hhhh',
        'hhh...........hhh',
        'hhh...........hhh',
        '.hh...........hh.',
        '.hh...........hh.',
        '..h...........h..',
        '..h...........h..',
      ],
      colors: { h: 'black' },
      at: [-4, -3],
      behind: true,
    },
    {
      rows: [
        '..hhhhhhh..',
        '.hhhhhhhhhh',
        'hhhhhhhhhhh',
        'hhhihhhhhhh',
        'hhii....hhh',
        'hhi......hh',
        'h.........h',
      ],
      colors: { h: 'black', i: 'grey1' },
      at: [0, -3],
    },
  ],
})

// --- Chaxi: the only sane one. Nobody can pronounce her name. --------------
const CHAXI = mk({
  id: 'chaxi',
  height: 38,
  build: 0.92,
  skin: ['skin1', 'skin2', 'skin3'],
  shirt: ['purp1', 'purp2', 'purp3'],
  trousers: ['teal0', 'teal1', 'teal2'],
  shoes: 'wood2',
  belt: 'gold1',
  sleeve: 0.5,
  overlays: [
    {
      rows: ['..hhhhh..', '.hhhhhhh.', 'hhhhhhhhh', 'hh.....hh', 'h.......h'],
      colors: { h: 'wood2' },
      at: [0, -3],
    },
    {
      rows: ['.ggg.ggg.', '.g.g.g.g.', '.ggg.ggg.'],
      colors: { g: 'grey5' },
      at: [0, 3],
    },
  ],
})

// --- El Patilla: the barman with the structurally significant sideburns. ---
const PATILLA = mk({
  id: 'patilla',
  height: 41,
  build: 1.1,
  skin: ['skin1', 'skin2', 'skin3'],
  shirt: ['wood9', 'wood10', 'moon2'],
  trousers: ['wood2', 'wood3', 'wood5'],
  shoes: 'wood1',
  belt: 'wood1',
  sleeve: 0.3,
  overlays: [
    {
      rows: ['..hhhhh..', '.hhhhhhh.', 'hh.hhh.hh'],
      colors: { h: 'wood1' },
      at: [0, -2],
    },
    {
      // THE sideburns. Structural. Load-bearing.
      rows: ['p.......p', 'pp.....pp', 'ppp...ppp', 'ppp...ppp', '.pp...pp.', '.p.....p.'],
      colors: { p: 'wood1' },
      at: [0, 3],
    },
    {
      rows: ['..aaaaa..', '.aaaaaaa.'],
      colors: { a: 'wood10' },
      at: [0, 11],
    },
  ],
})

// --- Jaime & Javi: the monkeys with the challenges. ------------------------
function monkey(id: string, fur: PuppetSpec['skin'], accent: Overlay[]): PuppetSpec {
  return mk({
    id,
    height: 26,
    build: 0.8,
    headScale: 1.3,
    skin: fur,
    shirt: [fur[0], fur[1], fur[2]],
    trousers: [fur[0], fur[1], fur[2]],
    shoes: fur[0],
    sleeve: 0,
    tail: fur[1],
    eyes: 'ink',
    overlays: [
      // ears
      {
        rows: ['e.......e', 'ee.....ee', 'ee.....ee', 'e.......e'],
        colors: { e: fur[1] },
        at: [-1, 2],
      },
      // muzzle
      {
        rows: ['..mmm..', '.mmmmm.', '..mmm..'],
        colors: { m: fur[2] },
        at: [1, 6],
      },
      ...accent,
    ],
  })
}

const JAIME = monkey('jaime', ['skin5', 'skin6', 'skin7'], [
  {
    // tiny pirate bandana
    rows: ['.bbbbbbb.', 'bbbbbbbbb', '..b...b..'],
    colors: { b: 'red2' },
    at: [0, 0],
  },
])

const JAVI = monkey('javi', ['wood2', 'wood4', 'wood6'], [
  {
    // tiny woolly hat, worn indoors, always
    rows: ['.hhhhhhh.', 'hhhhhhhhh', 'hhhhhhhhh'],
    colors: { h: 'leaf5' },
    at: [0, -1],
  },
  {
    rows: ['.ggg.ggg.', '.g.g.g.g.', '.ggg.ggg.'],
    colors: { g: 'grey5' },
    at: [0, 5],
  },
])

const SPECS: PuppetSpec[] = [PLAYER, NAYARA, GIORGIO, BIGJOHN, CHAXI, PATILLA, JAIME, JAVI]

export function buildCast(): Map<string, Sprite> {
  const out = new Map<string, Sprite>()
  for (const spec of SPECS) out.set(spec.id, buildPuppet(spec))
  return out
}
