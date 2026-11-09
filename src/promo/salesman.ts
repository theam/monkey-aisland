/**
 * The salesman. No name: he would only use it to sell you something.
 *
 * Built from the same puppet as the rest of the cast, so he looks like he
 * walked out of the bar, plus the things that make a used-ship salesman: hair
 * that has been told what to do, under a cowboy hat nobody asked about, a
 * grin with every tooth in it, a jacket you can hear, and arms that never stop.
 *
 * Overlay coordinates are relative to the top-left corner of the head box,
 * which for this build is 10x11: the face's centre column is x=5, the mouth
 * row is y=8, the chest starts at y=11.
 */
import { buildPuppet, type Overlay, type Pose, type PuppetSpec } from '../art/puppet'
import { C } from '../engine/palette'
import type { Sprite } from '../engine/sprite'

/**
 * The flail: six frames, cycled while he talks. Hands are [out, down] from
 * each shoulder. They go up and down out of step with each other, never in
 * a pattern long enough to read as a dance.
 */
const FLAIL: Pick<Pose, 'hands' | 'bob'>[] = [
  { hands: [[3, -11], [10, 1]], bob: 0 },
  { hands: [[9, -5], [4, -12]], bob: -1 },
  { hands: [[7, -9], [7, -9]], bob: 0 },
  { hands: [[8, 6], [3, -12]], bob: -1 },
  { hands: [[10, -2], [10, -2]], bob: 0 },
  { hands: [[3, -12], [8, 6]], bob: -1 },
]
export const FLAIL_FRAMES = FLAIL.map((_, i) => `flail${i + 1}`)

/** Frames whose mouth is open. The rest grin with it shut. */
const OPEN = new Set(['talk1', 'talk2', 'laugh', 'flail1', 'flail3', 'flail4', 'flail6',
  'point', 'present', 'present2'])
/** Frames with the grin wiped off. */
const FLAT = new Set(['think', 'deadpan'])
const FLAT_OPEN = new Set(['thinkTalk', 'deadpanTalk'])

function pose(p: Partial<Pose>): Pose {
  return { bob: 0, feet: [-3, 3], arms: [0, 0], mouth: 0, ...p }
}

const POSES: Record<string, Pose> = {
  ...Object.fromEntries(FLAIL.map((f, i) => [FLAIL_FRAMES[i], pose(f)])),
  // a hand on the hip, the other at the jaw — beside it, because the head
  // is drawn after the arms and would swallow a hand on the chin itself
  think: pose({ hands: [[1, 12], [-1, -4]], elbows: [[6, 6], [4, 8]] }),
  thinkTalk: pose({ hands: [[1, 12], [-1, -4]], elbows: [[6, 6], [4, 8]] }),
  // straight at whoever is on the left of the screen, other hand on the hip
  point: pose({ hands: [[14, 0], [1, 12]], elbows: [[7, 0], [6, 6]] }),
  pointTalk: pose({ hands: [[14, 1], [1, 12]], elbows: [[7, 0], [6, 6]] }),
  deadpan: pose({ hands: [[0, 14], [0, 14]], elbows: [[1, 7], [1, 7]] }),
  deadpanTalk: pose({ hands: [[0, 14], [0, 14]], elbows: [[1, 7], [1, 7]] }),
  // ta-da
  present: pose({ hands: [[8, -12], [8, -12]] }),
  present2: pose({ hands: [[10, -9], [10, -9]], bob: -1 }),
}

const ALL_FRAMES = ['stand', 'talk1', 'talk2', 'laugh', 'walk1', 'walk2', 'walk3', 'walk4',
  ...Object.keys(POSES)]

function mouth(rows: string[], at: [number, number], frames: string[]): Overlay {
  return { rows, colors: { d: 'skin1', w: 'white', r: 'red0' }, at, frames }
}

const SPEC: PuppetSpec = {
  id: 'salesman',
  height: 42,
  build: 1.08,
  skin: ['skin1', 'skin3', 'skin4'],
  // The body's mid tone only marks where the check goes (checkTheJacket), so
  // it must not be used anywhere else on him. The sleeves stay plain.
  shirt: ['blue1', 'sky6', 'blue3'],
  sleeves: 'blue2',
  trousers: ['ink', 'grey1', 'grey2'],
  shoes: 'black',
  sleeve: 1,
  overlays: [
    // Hair: combed back, held there by something industrial, with a shine.
    {
      rows: [
        '..hhhhhhh..',
        '.hiihhhhhh.',
        'hihhhhhhhhh',
        'hh.......hh',
        'h.........h',
      ],
      colors: { h: 'ink', i: 'grey3' },
      at: [0, -1],
    },
    // The hat: dented crown, dark band, a brim that turns up at the ends.
    // Lit from the left, like everything else.
    {
      rows: [
        '.......lh.hh.......',
        '......lhhhhhd......',
        '.....lhhhhhhhd.....',
        '.....bbbbbbbbb.....',
        'l...lhhhhhhhhhd...d',
        '.lhhhhhhhhhhhhhhdd.',
      ],
      colors: { l: 'wood9', h: 'wood8', d: 'wood6', b: 'wood3' },
      at: [-4, -4],
    },
    // Lapels, collar, and a tie in a red nobody chose for its own sake.
    {
      rows: ['lwwrwwl', '.lwrwl.', '.lwrwl.', '..lrl..', '..lrl..', '...l...'],
      colors: { l: 'blue0', w: 'moon2', r: 'red3' },
      at: [2, 11],
    },
    // The grin, which has more teeth than the face strictly has room for.
    mouth(['d.....d', '.wwwww.'], [2, 7],
      ALL_FRAMES.filter((f) => !OPEN.has(f) && !FLAT.has(f) && !FLAT_OPEN.has(f))),
    mouth(['d.....d', '.wwwww.', '.rrrrr.'], [2, 7], [...OPEN]),
    mouth(['ddd'], [4, 8], [...FLAT]),
    mouth(['ddd', '.r.'], [4, 8], [...FLAT_OPEN]),
  ],
  poses: POSES,
}

/**
 * Two-pixel checks over the body of the jacket. Only the body: on a sleeve
 * two pixels wide a check is just a dotted line. The check is anchored to the
 * collar, so it bounces with him instead of shimmering when he does.
 */
function checkTheJacket(sprite: Sprite): void {
  for (const fb of sprite.frames.values()) {
    let collar = -1
    for (let y = 0; y < fb.h && collar < 0; y++) {
      for (let x = 0; x < fb.w; x++) if (fb.get(x, y) === C.moon2) collar = y
    }
    for (let y = 0; y < fb.h; y++) {
      for (let x = 0; x < fb.w; x++) {
        if (fb.get(x, y) !== C.sky6) continue
        fb.set(x, y, ((x >> 1) + ((y - collar) >> 1)) & 1 ? C.blue4 : C.blue2)
      }
    }
  }
}

export function buildSalesman(): Sprite {
  const sprite = buildPuppet(SPEC)
  checkTheJacket(sprite)
  return sprite
}
