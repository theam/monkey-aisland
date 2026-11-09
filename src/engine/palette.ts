/**
 * The Monkey AIsland — global indexed palette.
 *
 * Everything in this game is drawn into an 8-bit indexed framebuffer and only
 * converted to RGBA once per frame. That discipline is what makes procedurally
 * generated art look like it was painted by one person in 1990 instead of like
 * a CSS gradient: every pixel in the game is forced through this list.
 *
 * Index 0 is reserved as fully transparent.
 *
 * Ramps are ordered dark -> light and are the raw material for dithered
 * gradients (see draw.ts `gradientV` / `ditherRect`).
 */

// prettier-ignore
const ENTRIES = [
  ['transparent',  '#000000'],

  // --- Neutrals / UI --------------------------------------------------------
  ['black',        '#000000'],
  ['ink',          '#0a0a0c'],
  ['grey1',        '#2a2a30'],
  ['grey2',        '#4a4a54'],
  ['grey3',        '#6b6377'],
  ['grey4',        '#8b8496'],
  ['grey5',        '#aca6b4'],
  ['grey6',        '#cfc9d6'],
  ['white',        '#ffffff'],

  // --- Night sky (deep blue -> horizon teal) --------------------------------
  ['sky0',         '#05060f'],
  ['sky1',         '#0a0f1e'],
  ['sky2',         '#101a33'],
  ['sky3',         '#16264a'],
  ['sky4',         '#1d3560'],
  ['sky5',         '#274a7a'],
  ['sky6',         '#35638f'],
  ['sky7',         '#4a7fa5'],

  // --- Sea / water ----------------------------------------------------------
  ['sea0',         '#080e1c'],
  ['sea1',         '#0e1c33'],
  ['sea2',         '#152b4a'],
  ['sea3',         '#1f4166'],
  ['sea4',         '#2c5c85'],
  ['sea5',         '#4681a5'],
  ['sea6',         '#6ba7c0'],
  ['sea7',         '#9fcbd8'],

  // --- Moon / cool highlights ----------------------------------------------
  ['moon0',        '#b8c6c0'],
  ['moon1',        '#d8e0d0'],
  ['moon2',        '#f4f0d8'],

  // --- Foliage --------------------------------------------------------------
  ['leaf0',        '#04120c'],
  ['leaf1',        '#071f12'],
  ['leaf2',        '#0d2b19'],
  ['leaf3',        '#14401f'],
  ['leaf4',        '#1d5526'],
  ['leaf5',        '#2a6b2c'],
  ['leaf6',        '#3d8437'],
  ['leaf7',        '#5aa04a'],
  ['leaf8',        '#7cbb60'],
  ['leaf9',        '#a8d47e'],

  // --- Rock / stone (purple-grey, MI's cliffs) ------------------------------
  ['rock0',        '#120e18'],
  ['rock1',        '#1a1520'],
  ['rock2',        '#2b2434'],
  ['rock3',        '#3d3548'],
  ['rock4',        '#524a5e'],
  ['rock5',        '#6b6377'],
  ['rock6',        '#8b8496'],
  ['rock7',        '#aca6b4'],

  // --- Wood -----------------------------------------------------------------
  ['wood0',        '#140b05'],
  ['wood1',        '#1c1109'],
  ['wood2',        '#2e1d10'],
  ['wood3',        '#45291a'],
  ['wood4',        '#5c3823'],
  ['wood5',        '#75482c'],
  ['wood6',        '#8f5c38'],
  ['wood7',        '#a97347'],
  ['wood8',        '#c28f5e'],
  ['wood9',        '#d9ae7f'],
  ['wood10',       '#eccfa4'],

  // --- Fire / lamplight -----------------------------------------------------
  ['fire0',        '#2b0e04'],
  ['fire1',        '#4a1c07'],
  ['fire2',        '#7a2f0a'],
  ['fire3',        '#b4550f'],
  ['fire4',        '#e08a1e'],
  ['fire5',        '#f5b942'],
  ['fire6',        '#ffe08a'],
  ['fire7',        '#fff6d0'],

  // --- Skin -----------------------------------------------------------------
  ['skin0',        '#4a2418'],
  ['skin1',        '#6b3a2a'],
  ['skin2',        '#a86b4c'],
  ['skin3',        '#d99a72'],
  ['skin4',        '#f0c39a'],
  ['skin5',        '#5a3a20'], // monkey fur dark
  ['skin6',        '#8a6034'], // monkey fur mid
  ['skin7',        '#b58a52'], // monkey fur light

  // --- Cloth: reds ----------------------------------------------------------
  ['red0',         '#3a0c18'],
  ['red1',         '#5a1428'],
  ['red2',         '#8f2039'],
  ['red3',         '#c33c4e'],
  ['red4',         '#e8707a'],

  // --- Cloth: blues ---------------------------------------------------------
  ['blue0',        '#0e1c3a'],
  ['blue1',        '#1f3a6b'],
  ['blue2',        '#2e5aa0'],
  ['blue3',        '#4a8bd4'],
  ['blue4',        '#86bcf0'],

  // --- Cloth: purples -------------------------------------------------------
  ['purp0',        '#2a0f3a'],
  ['purp1',        '#4a1a63'],
  ['purp2',        '#6b2a8f'],
  ['purp3',        '#a34bc4'],

  // --- Cloth: gold / yellow -------------------------------------------------
  ['gold0',        '#4a3a08'],
  ['gold1',        '#8a6b12'],
  ['gold2',        '#c9a227'],
  ['gold3',        '#f2d94e'],

  // --- Teal / bottle glass --------------------------------------------------
  ['teal0',        '#06231f'],
  ['teal1',        '#0b3a33'],
  ['teal2',        '#12574a'],
  ['teal3',        '#1d7a66'],
  ['teal4',        '#33a888'],

  // --- UI colours -----------------------------------------------------------
  // Measured off the original: the whole interface sits on one magenta axis.
  ['uiVerb',       '#7c2e7c'], // resting verb text
  ['uiVerbShadow', '#540254'], // 1px drop shadow under the verb text
  ['uiVerbHot',    '#dc52dc'], // hovered / selected verb
  ['uiSentence',   '#dc52dc'], // the sentence line
  ['uiPanel',      '#000000'], // panel background: flat black
  ['uiPanelEdge',  '#140214'], // the verb plaques
  ['uiChoice',     '#9c3a9c'], // dialogue options at rest
  ['uiChoiceHot',  '#dc52dc'], // hovered dialogue option
  ['uiChoiceUsed', '#541454'], // an option you already picked

  // --- Speech colours, one per speaker (MI gives everyone a colour) ---------
  ['sayPlayer',    '#fcfefc'],
  ['sayNayara',    '#7cbb60'],
  ['sayGiorgio',   '#f5b942'],
  ['sayBigJohn',   '#86bcf0'],
  ['sayChaxi',     '#e8707a'],
  ['sayJaime',     '#a8d47e'],
  ['sayJavi',      '#c9a227'],
  ['sayBarman',    '#d99a72'],
  ['sayNarrator',  '#aca6b4'],
] as const

export type ColorName = (typeof ENTRIES)[number][0]

/** Hex strings, index-aligned with the palette. */
export const PALETTE_HEX: string[] = ENTRIES.map((e) => e[1])

/** Named colour -> palette index. `C.wood4`, `C.sky2`, … */
export const C = Object.freeze(
  ENTRIES.reduce<Record<string, number>>((acc, [name], i) => {
    acc[name] = i
    return acc
  }, {}),
) as Readonly<Record<ColorName, number>>

export const TRANSPARENT = 0
export const PALETTE_SIZE = ENTRIES.length

/** Runtime lookup for palette names coming out of YAML content files. */
export function colorByName(name: string | undefined, fallback = C.sayNarrator): number {
  if (!name) return fallback
  const idx = (C as Record<string, number | undefined>)[name]
  return idx === undefined ? fallback : idx
}

/** Ordered ramps, dark -> light. Used for dithered gradients and shading. */
export const RAMPS = {
  sky: [C.sky0, C.sky1, C.sky2, C.sky3, C.sky4, C.sky5, C.sky6, C.sky7],
  sea: [C.sea0, C.sea1, C.sea2, C.sea3, C.sea4, C.sea5, C.sea6, C.sea7],
  leaf: [C.leaf0, C.leaf1, C.leaf2, C.leaf3, C.leaf4, C.leaf5, C.leaf6, C.leaf7, C.leaf8, C.leaf9],
  rock: [C.rock0, C.rock1, C.rock2, C.rock3, C.rock4, C.rock5, C.rock6, C.rock7],
  wood: [
    C.wood0, C.wood1, C.wood2, C.wood3, C.wood4,
    C.wood5, C.wood6, C.wood7, C.wood8, C.wood9, C.wood10,
  ],
  fire: [C.fire0, C.fire1, C.fire2, C.fire3, C.fire4, C.fire5, C.fire6, C.fire7],
  grey: [C.ink, C.grey1, C.grey2, C.grey3, C.grey4, C.grey5, C.grey6, C.white],
  skin: [C.skin0, C.skin1, C.skin2, C.skin3, C.skin4],
  fur: [C.skin5, C.skin6, C.skin7],
  teal: [C.teal0, C.teal1, C.teal2, C.teal3, C.teal4],
} as const

/**
 * Convert the palette (plus any live overrides used for palette-cycling
 * animation) into a Uint32 lookup table in the byte order ImageData expects.
 */
export function buildLut(overrides?: ReadonlyMap<number, string>): Uint32Array {
  const lut = new Uint32Array(PALETTE_SIZE)
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const hex = overrides?.get(i) ?? PALETTE_HEX[i]
    lut[i] = hexToAbgr(hex, i === TRANSPARENT ? 0 : 255)
  }
  return lut
}

/** #rrggbb -> 0xAABBGGRR (little-endian RGBA as seen by a Uint32 view). */
export function hexToAbgr(hex: string, alpha = 255): number {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0
}

/** Blend two palette entries and return the nearest existing palette index. */
export function mixIndex(a: number, b: number, t: number): number {
  const ca = parseInt(PALETTE_HEX[a].slice(1), 16)
  const cb = parseInt(PALETTE_HEX[b].slice(1), 16)
  const r = Math.round((((ca >> 16) & 0xff) * (1 - t) + ((cb >> 16) & 0xff) * t))
  const g = Math.round((((ca >> 8) & 0xff) * (1 - t) + ((cb >> 8) & 0xff) * t))
  const bl = Math.round(((ca & 0xff) * (1 - t) + (cb & 0xff) * t))
  return nearestIndex(r, g, bl)
}

/** Nearest palette index for an arbitrary RGB triple (skips transparent). */
export function nearestIndex(r: number, g: number, b: number): number {
  let best = 1
  let bestD = Infinity
  for (let i = 1; i < PALETTE_SIZE; i++) {
    const c = parseInt(PALETTE_HEX[i].slice(1), 16)
    const dr = ((c >> 16) & 0xff) - r
    const dg = ((c >> 8) & 0xff) - g
    const db = (c & 0xff) - b
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}
