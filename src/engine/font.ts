/**
 * Hand-authored bitmap font, SCUMM-flavoured.
 *
 * Cell is 5 wide x 9 tall. Rows, top to bottom:
 *   0        diacritics (accents, tildes)
 *   1..6     capital height (6px)
 *   3..6     x-height (4px)
 *   7..8     descenders
 * Glyph width is derived from the right-most used column, so the font is
 * proportional for free. Baseline sits just under row 6.
 *
 * '#' = ink, anything else = empty. Rows are separated by '/'.
 * Spanish glyphs are included on purpose: we are on a Canarian island and
 * people's names have accents in them.
 */
import { Framebuffer } from './framebuffer'

const G: Record<string, string> = {
  // --- Uppercase (rows 1-6) -------------------------------------------------
  A: '...../.###./#...#/#...#/#####/#...#/#...#',
  B: '...../####./#...#/####./#...#/#...#/####.',
  C: '...../.###./#...#/#..../#..../#...#/.###.',
  D: '...../####./#...#/#...#/#...#/#...#/####.',
  E: '...../#####/#..../####./#..../#..../#####',
  F: '...../#####/#..../####./#..../#..../#....',
  G: '...../.###./#...#/#..../#..##/#...#/.###.',
  H: '...../#...#/#...#/#####/#...#/#...#/#...#',
  I: '...../###../.#.../.#.../.#.../.#.../###..',
  J: '...../..###/...#./...#./...#./#..#./.##..',
  K: '...../#...#/#..#./#.#../##.../#.#../#..##',
  L: '...../#..../#..../#..../#..../#..../#####',
  M: '...../#...#/##.##/#.#.#/#.#.#/#...#/#...#',
  N: '...../#...#/##..#/#.#.#/#..##/#...#/#...#',
  O: '...../.###./#...#/#...#/#...#/#...#/.###.',
  P: '...../####./#...#/#...#/####./#..../#....',
  Q: '...../.###./#...#/#...#/#.#.#/#..#./.##.#',
  R: '...../####./#...#/#...#/####./#..#./#...#',
  S: '...../.####/#..../.###./....#/#...#/.###.',
  T: '...../#####/..#../..#../..#../..#../..#..',
  U: '...../#...#/#...#/#...#/#...#/#...#/.###.',
  V: '...../#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '...../#...#/#...#/#...#/#.#.#/##.##/#...#',
  X: '...../#...#/.#.#./..#../..#../.#.#./#...#',
  Y: '...../#...#/#...#/.#.#./..#../..#../..#..',
  Z: '...../#####/...#./..#../.#.../#..../#####',

  // --- Lowercase ------------------------------------------------------------
  // x-height is 5 rows (2..6); ascenders start at row 1; descenders reach 8.
  a: '...../...../.##./...#/.###/#..#/.###',
  b: '...../#.../#.../###./#..#/#..#/###.',
  c: '...../...../.###/#.../#.../#.../.###',
  d: '...../...#/...#/.###/#..#/#..#/.###',
  e: '...../...../.##./#..#/####/#.../.###',
  f: '...../..##/.#../###./.#../.#../.#..',
  g: '...../...../.###/#..#/#..#/.###/...#/###.',
  h: '...../#.../#.../###./#..#/#..#/#..#',
  i: '.#.../...../.#../.#../.#../.#../.#..',
  j: '..#../...../..#./..#./..#./..#./..#./..#./##..',
  k: '...../#.../#.../#.#./##../#.#./#..#',
  l: '...../.#../.#../.#../.#../.#../.#..',
  m: '...../...../#####/#.#.#/#.#.#/#.#.#/#...#',
  n: '...../...../###./#..#/#..#/#..#/#..#',
  o: '...../...../.##./#..#/#..#/#..#/.##.',
  p: '...../...../###./#..#/#..#/###./#.../#...',
  q: '...../...../.###/#..#/#..#/.###/...#/...#',
  r: '...../...../#.##/##../#.../#.../#...',
  s: '...../...../.###/#.../.##./...#/###.',
  t: '...../.#../.#../###./.#../.#../.###',
  u: '...../...../#..#/#..#/#..#/#..#/.###',
  v: '...../...../#...#/#...#/#...#/.#.#./..#..',
  w: '...../...../#...#/#...#/#.#.#/#.#.#/.#.#.',
  x: '...../...../#...#/.#.#./..#../.#.#./#...#',
  y: '...../...../#..#/#..#/#..#/#..#/.###/...#/###.',
  z: '...../...../####/...#/..#./.#../####',

  // --- Digits ---------------------------------------------------------------
  '0': '...../.###./#..##/#.#.#/##..#/#...#/.###.',
  '1': '...../..#../.##../..#../..#../..#../.###.',
  '2': '...../.###./#...#/...#./..#../.#.../#####',
  '3': '...../####./....#/.###./....#/....#/####.',
  '4': '...../...#./..##./.#.#./#..#./#####/...#.',
  '5': '...../#####/#..../####./....#/#...#/.###.',
  '6': '...../..##./.#.../####./#...#/#...#/.###.',
  '7': '...../#####/....#/...#./..#../..#../..#..',
  '8': '...../.###./#...#/.###./#...#/#...#/.###.',
  '9': '...../.###./#...#/#...#/.####/...#./.##..',

  // --- Punctuation ----------------------------------------------------------
  ' ': '...../...../...../...../...../...../.....',
  '.': '...../...../...../...../...../...../#....',
  ',': '...../...../...../...../...../.#.../#....',
  ':': '...../...../...../...../#..../...../#....',
  ';': '...../...../...../...../#..../.#.../#....',
  '!': '...../#..../#..../#..../#..../...../#....',
  '?': '...../.##./#..#/...#/..#./..../..#.',
  "'": '...../#..../#....',
  '"': '...../#.#../#.#..',
  '`': '...../#..../.#...',
  '-': '...../...../...../...../####.',
  '_': '...../...../...../...../...../...../...../####.',
  '+': '...../...../...../.#.../####./.#...',
  '=': '...../...../...../####./...../####.',
  '*': '...../...../.#.../###../.#...',
  '/': '...../...#/...#/..#./.#../#.../#...',
  '\\': '...../#.../#.../.#../..#./...#/...#',
  '(': '...../..#./.#../.#../.#../.#../..#.',
  ')': '...../.#../..#./..#./..#./..#./.#..',
  '[': '...../.##./.#../.#../.#../.#../.##.',
  ']': '...../.##./..#./..#./..#./..#./.##.',
  '<': '...../...../..#./.#../#.../.#../..#.',
  '>': '...../...../#.../.#../..#./.#../#...',
  '|': '...../.#../.#../.#../.#../.#../.#../.#..',
  '#': '...../.#.#./#####/.#.#./#####/.#.#.',
  '%': '...../##..#/##.#./..#../.#.##/#..##',
  '&': '...../.##../#..#./.##../#.#.#/.##.#',
  '@': '...../.###./#...#/#.###/#.#.#/#.###/.##..',
  '$': '...../..#../.####/##.../...##/####./..#..',
  '~': '...../...../...../.##.#/#..#.',
  '^': '...../..#../.#.#./#...#',
  '·': '...../...../...../...../.#...',
  '…': '...../...../...../...../...../...../#.#.#',
  '«': '...../...../...../.#.#./#.#../.#.#.',
  '»': '...../...../...../#.#../.#.#./#.#..',
  '€': '...../..##./.#.../####./.#.../####./..##.',
  '¿': '...../..#../...../..#../.#.../#...#/.###.',
  '¡': '...../.#.../...../.#.../.#.../.#.../.#...',

  // --- Spanish / Canarian accented forms ------------------------------------
  // Lowercase carries its diacritic on rows 0-1, uppercase on row 0.
  á: '..#../.#.../.##./...#/.###/#..#/.###',
  é: '..#../.#.../.##./#..#/####/#.../.###',
  í: '..#../.#.../.#../.#../.#../.#../.#..',
  ó: '..#../.#.../.##./#..#/#..#/#..#/.##.',
  ú: '..#../.#.../#..#/#..#/#..#/#..#/.###',
  ñ: '.##.#/#..#./###./#..#/#..#/#..#/#..#',
  ü: '#.#../...../#..#/#..#/#..#/#..#/.###',
  ç: '...../...../.###/#.../#.../#.../.###/..#./.#..',
  Á: '..##./.###./#...#/#...#/#####/#...#/#...#',
  É: '..##./#####/#..../####./#..../#..../#####',
  Í: '..##./###../.#.../.#.../.#.../.#.../###..',
  Ó: '..##./.###./#...#/#...#/#...#/#...#/.###.',
  Ú: '..##./#...#/#...#/#...#/#...#/#...#/.###.',
  Ñ: '.#.#./#...#/##..#/#.#.#/#..##/#...#/#...#',
  Ü: '#.#../#...#/#...#/#...#/#...#/#...#/.###.',
}

export const CELL_H = 9
export const LINE_H = 10
export const SPACE_W = 3
export const LETTER_SPACING = 1

type Glyph = { rows: string[]; w: number }

const CACHE = new Map<string, Glyph>()

function glyph(ch: string): Glyph | null {
  const cached = CACHE.get(ch)
  if (cached) return cached
  const raw = G[ch]
  if (raw === undefined) return null
  const rows = raw.split('/')
  // pad to CELL_H rows so callers can index freely
  while (rows.length < CELL_H) rows.push('')
  let w = 0
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) if (r[i] === '#' && i + 1 > w) w = i + 1
  }
  const g: Glyph = { rows, w: Math.max(w, 1) }
  CACHE.set(ch, g)
  return g
}

export function charWidth(ch: string): number {
  if (ch === ' ') return SPACE_W
  const g = glyph(ch)
  return g ? g.w : 4
}

export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charWidth(ch) + LETTER_SPACING
  return Math.max(0, w - LETTER_SPACING)
}

export type TextStyle = {
  color: number
  /** 1px drop shadow at +1/+1. Massively improves legibility over painted art. */
  shadow?: number
  /** full 8-way outline (used for the sentence line over busy scenes) */
  outlineColor?: number
}

export function drawChar(fb: Framebuffer, ch: string, x: number, y: number, style: TextStyle): number {
  if (ch === ' ') return SPACE_W + LETTER_SPACING
  const g = glyph(ch)
  if (!g) return 4 + LETTER_SPACING

  if (style.outlineColor !== undefined) {
    for (let row = 0; row < CELL_H; row++) {
      const r = g.rows[row]
      for (let col = 0; col < r.length; col++) {
        if (r[col] !== '#') continue
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            fb.set(x + col + dx, y + row + dy, style.outlineColor)
          }
        }
      }
    }
  } else if (style.shadow !== undefined) {
    for (let row = 0; row < CELL_H; row++) {
      const r = g.rows[row]
      for (let col = 0; col < r.length; col++) {
        if (r[col] === '#') fb.set(x + col + 1, y + row + 1, style.shadow)
      }
    }
  }

  for (let row = 0; row < CELL_H; row++) {
    const r = g.rows[row]
    for (let col = 0; col < r.length; col++) {
      if (r[col] === '#') fb.set(x + col, y + row, style.color)
    }
  }
  return g.w + LETTER_SPACING
}

export function drawText(fb: Framebuffer, text: string, x: number, y: number, style: TextStyle): number {
  let cx = x
  for (const ch of text) cx += drawChar(fb, ch, cx, y, style)
  return cx - x
}

export function drawTextCentered(
  fb: Framebuffer, text: string, cx: number, y: number, style: TextStyle,
): void {
  drawText(fb, text, Math.round(cx - textWidth(text) / 2), y, style)
}

/** Greedy word wrap to a pixel width. Respects explicit \n. */
export function wrapText(text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('')
      continue
    }
    let cur = ''
    for (const word of para.split(/\s+/)) {
      if (word === '') continue
      const probe = cur === '' ? word : cur + ' ' + word
      if (textWidth(probe) <= maxW || cur === '') cur = probe
      else {
        out.push(cur)
        cur = word
      }
    }
    if (cur !== '') out.push(cur)
  }
  return out
}

/**
 * Wrap into a shape that reads well over a character's head: a small number of
 * lines, balanced in length, MI-style. Tries progressively narrower widths so
 * we don't get a 40-char line followed by one orphan word.
 */
export function balanceWrap(text: string, maxW: number): string[] {
  const first = wrapText(text, maxW)
  if (first.length <= 1) return first
  let best = first
  for (let w = maxW; w >= maxW * 0.55; w -= 6) {
    const lines = wrapText(text, w)
    if (lines.length > first.length) break
    const widths = lines.map(textWidth)
    const spread = Math.max(...widths) - Math.min(...widths)
    const bestSpread =
      Math.max(...best.map(textWidth)) - Math.min(...best.map(textWidth))
    if (lines.length === first.length && spread < bestSpread) best = lines
  }
  return best
}

/**
 * The same bitmap font with every pixel drawn as an NxN block — for title
 * cards. Scaling the pixels (rather than using a bigger typeface) is what keeps
 * a title looking like it belongs to the rest of the screen.
 */
export function drawTextScaled(
  fb: Framebuffer, text: string, x: number, y: number, scale: number, style: TextStyle,
): number {
  let cx = x
  for (const ch of text) {
    if (ch === ' ') {
      cx += (SPACE_W + LETTER_SPACING) * scale
      continue
    }
    const g = glyph(ch)
    if (!g) {
      cx += (4 + LETTER_SPACING) * scale
      continue
    }
    for (let row = 0; row < CELL_H; row++) {
      const r = g.rows[row]
      for (let col = 0; col < r.length; col++) {
        if (r[col] !== '#') continue
        const px0 = cx + col * scale
        const py0 = y + row * scale
        if (style.outlineColor !== undefined) {
          for (let oy = -1; oy <= scale; oy++) {
            for (let ox = -1; ox <= scale; ox++) {
              fb.set(px0 + ox, py0 + oy, style.outlineColor)
            }
          }
        } else if (style.shadow !== undefined) {
          for (let oy = 0; oy < scale; oy++) {
            for (let ox = 0; ox < scale; ox++) {
              fb.set(px0 + ox + scale, py0 + oy + scale, style.shadow)
            }
          }
        }
      }
    }
    // ink pass second, so outlines never cover the letter itself
    for (let row = 0; row < CELL_H; row++) {
      const r = g.rows[row]
      for (let col = 0; col < r.length; col++) {
        if (r[col] !== '#') continue
        for (let oy = 0; oy < scale; oy++) {
          for (let ox = 0; ox < scale; ox++) {
            fb.set(cx + col * scale + ox, y + row * scale + oy, style.color)
          }
        }
      }
    }
    cx += (g.w + LETTER_SPACING) * scale
  }
  return cx - x
}

export function textWidthScaled(text: string, scale: number): number {
  return textWidth(text) * scale
}

export function drawTextScaledCentered(
  fb: Framebuffer, text: string, cx: number, y: number, scale: number, style: TextStyle,
): void {
  drawTextScaled(fb, text, Math.round(cx - textWidthScaled(text, scale) / 2), y, scale, style)
}

