/**
 * The SCUMM interface, laid out from measurements of the original.
 *
 *   y   0..143  room view
 *   y 144..152  sentence line, centred on x=160
 *   y 153..199  verb plaques (3x3, column-major) + inventory
 *
 * During a conversation the whole band below the room becomes the dialogue
 * options on flat black, exactly like the original.
 *
 * Verb columns:  Give / Open / Close  |  Pick up / Look at / Talk to  |  Use / Push / Pull
 */
import { Framebuffer } from './framebuffer'
import { LETTER_SPACING, LINE_H, drawText, drawTextCentered, textWidth, wrapText } from './font'
import { C } from './palette'
import { ROOM_H, SCREEN_W, SCREEN_H } from './display'
import type { InventoryItem } from './state'
import type { VerbDef } from './content'
import { rectContains } from './geom'

export const SENTENCE_Y = 144
export const PANEL_TOP = 153

/** [x, width] per verb column, measured from the original. */
export const VERB_COL = [
  [1, 38],
  [41, 62],
  [105, 38],
] as const
export const VERB_ROW_Y = [153, 169, 185]
export const VERB_CELL_H = 15

export const INV_ARROW = { x: 145, w: 13, upY: 154, downY: 178, h: 18 }
export const INV_COL_X = [161, 201, 241, 281]
export const INV_COL_W = 39
export const INV_ROW_Y = [156, 180]
export const INV_ROW_H = 20
export const INV_VISIBLE = INV_COL_X.length * INV_ROW_Y.length

export const SOUND_BTN = { x: 306, y: 144, w: 13, h: 9 }

export const CHOICE_ROW_Y = [145, 154, 163, 172, 181, 190]
export const CHOICE_MAX = CHOICE_ROW_Y.length

export type PanelHit =
  | { kind: 'verb'; id: string }
  | { kind: 'item'; item: InventoryItem }
  | { kind: 'invUp' }
  | { kind: 'invDown' }
  | { kind: 'sound' }
  | null

function verbSlot(v: VerbDef): { x: number; w: number; y: number } {
  const col = VERB_COL[v.col] ?? VERB_COL[0]
  return { x: col[0], w: col[1], y: VERB_ROW_Y[v.row] ?? VERB_ROW_Y[0] }
}

export function drawPanelBackground(fb: Framebuffer): void {
  for (let y = ROOM_H; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) fb.set(x, y, C.uiPanel)
  }
}

export function drawSentence(fb: Framebuffer, text: string): void {
  if (!text) return
  drawTextCentered(fb, text, SCREEN_W / 2, SENTENCE_Y, { color: C.uiSentence })
}

export function drawVerbs(
  fb: Framebuffer,
  verbs: VerbDef[],
  currentVerb: string,
  hoveredVerb: string | null,
): void {
  for (const v of verbs) {
    const { x, w, y } = verbSlot(v)
    const active = v.id === currentVerb
    const hover = v.id === hoveredVerb

    // the plaque each verb sits on — the detail everyone forgets
    for (let yy = y; yy < y + VERB_CELL_H - 1; yy++) {
      for (let xx = x; xx < x + w; xx++) fb.set(xx, yy, C.uiPanelEdge)
    }

    const color = hover || active ? C.uiVerbHot : C.uiVerb
    drawTextCentered(fb, v.label, x + w / 2, y + 3, { color, shadow: C.uiVerbShadow })
  }
}

export function drawInventory(
  fb: Framebuffer,
  items: InventoryItem[],
  page: number,
  hovered: InventoryItem | null,
  selected: InventoryItem | null,
): void {
  const start = page * INV_VISIBLE
  const slice = items.slice(start, start + INV_VISIBLE)

  for (let i = 0; i < slice.length; i++) {
    const col = i % INV_COL_X.length
    const row = Math.floor(i / INV_COL_X.length)
    const item = slice[i]
    const x = INV_COL_X[col]
    const y = INV_ROW_Y[row]
    for (let yy = y - 2; yy < y - 2 + INV_ROW_H; yy++) {
      for (let xx = x - 1; xx < x - 1 + INV_COL_W; xx++) fb.set(xx, yy, C.uiPanelEdge)
    }
    const isHot = hovered?.id === item.id || selected?.id === item.id
    const color = isHot ? C.uiVerbHot : C.uiVerb
    // item names are long and the slots are small: two short lines
    const [l1, l2] = splitTwo(item.name, INV_COL_W - 4)
    drawTextCentered(fb, l1, x + INV_COL_W / 2 - 1, y, { color })
    if (l2) drawTextCentered(fb, l2, x + INV_COL_W / 2 - 1, y + 8, { color })
  }

  const pages = Math.max(1, Math.ceil(items.length / INV_VISIBLE))
  if (pages > 1) {
    drawArrow(fb, INV_ARROW.x, INV_ARROW.upY, -1, page > 0 ? C.uiVerb : C.uiPanelEdge)
    drawArrow(fb, INV_ARROW.x, INV_ARROW.downY, 1, page < pages - 1 ? C.uiVerb : C.uiPanelEdge)
  }
}

/** Break a label into at most two lines that fit, ellipsising what is left. */
function splitTwo(name: string, maxW: number): [string, string] {
  if (textWidth(name) <= maxW) return [name, '']
  const words = name.split(' ')
  let a = ''
  let i = 0
  while (i < words.length && textWidth(a === '' ? words[i] : `${a} ${words[i]}`) <= maxW) {
    a = a === '' ? words[i] : `${a} ${words[i]}`
    i++
  }
  if (a === '') a = clip(words[0], maxW)
  let b = words.slice(i).join(' ')
  if (textWidth(b) > maxW) b = clip(b, maxW)
  return [a, b]
}

function clip(s: string, maxW: number): string {
  let out = s
  while (out.length > 1 && textWidth(out + '…') > maxW) out = out.slice(0, -1)
  return out.length < s.length ? out + '…' : out
}

function drawArrow(fb: Framebuffer, x: number, y: number, dir: -1 | 1, color: number): void {
  for (let i = 0; i < 7; i++) {
    const w = dir === -1 ? Math.floor(i / 1.5) : Math.floor((6 - i) / 1.5)
    for (let dx = -w; dx <= w; dx++) fb.set(x + 6 + dx, y + i, color)
  }
}

export function drawSoundButton(fb: Framebuffer, on: boolean, hovered: boolean): void {
  const { x, y } = SOUND_BTN
  const c = hovered ? C.uiVerbHot : C.uiVerb
  fb.set(x + 2, y + 3, c); fb.set(x + 2, y + 4, c); fb.set(x + 2, y + 5, c)
  fb.set(x + 3, y + 2, c); fb.set(x + 3, y + 6, c)
  fb.set(x + 4, y + 1, c); fb.set(x + 4, y + 7, c)
  fb.set(x + 1, y + 3, c); fb.set(x + 1, y + 4, c); fb.set(x + 1, y + 5, c)
  if (on) {
    fb.set(x + 6, y + 2, c); fb.set(x + 7, y + 3, c); fb.set(x + 7, y + 5, c); fb.set(x + 6, y + 6, c)
    fb.set(x + 8, y + 4, c)
  } else {
    for (let i = 0; i < 4; i++) {
      fb.set(x + 6 + i, y + 2 + i, c)
      fb.set(x + 9 - i, y + 2 + i, c)
    }
  }
}

export function hitTestPanel(
  x: number,
  y: number,
  verbs: VerbDef[],
  items: InventoryItem[],
  page: number,
): PanelHit {
  if (rectContains([SOUND_BTN.x, SOUND_BTN.y, SOUND_BTN.w, SOUND_BTN.h], x, y)) return { kind: 'sound' }
  if (y < PANEL_TOP) return null

  for (const v of verbs) {
    const { x: vx, w, y: vy } = verbSlot(v)
    if (rectContains([vx, vy, w, VERB_CELL_H], x, y)) return { kind: 'verb', id: v.id }
  }

  const pages = Math.max(1, Math.ceil(items.length / INV_VISIBLE))
  if (pages > 1) {
    if (rectContains([INV_ARROW.x, INV_ARROW.upY, INV_ARROW.w, INV_ARROW.h], x, y)) return { kind: 'invUp' }
    if (rectContains([INV_ARROW.x, INV_ARROW.downY, INV_ARROW.w, INV_ARROW.h], x, y)) return { kind: 'invDown' }
  }

  const start = page * INV_VISIBLE
  const slice = items.slice(start, start + INV_VISIBLE)
  for (let i = 0; i < slice.length; i++) {
    const col = i % INV_COL_X.length
    const row = Math.floor(i / INV_COL_X.length)
    if (rectContains([INV_COL_X[col] - 1, INV_ROW_Y[row] - 2, INV_COL_W, INV_ROW_H], x, y)) {
      return { kind: 'item', item: slice[i] }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Dialogue options
// ---------------------------------------------------------------------------

export type ChoiceView = { text: string; used: boolean }

/** A row's hit area and the lines it shows. Lines after the first hang past the "1. ". */
export type ChoiceRowLayout = { x: number; y: number; w: number; h: number; lines: string[]; indent: number }

const CHOICE_PITCH = CHOICE_ROW_Y[1] - CHOICE_ROW_Y[0]
const CHOICE_X = 2
const CHOICE_W = SCREEN_W - 6

/**
 * Lay out the options. On desktop the band below the room holds CHOICE_MAX
 * lines, and an option too long for one takes the spare ones instead of being
 * clipped — first come, first served, because the first options are the ones
 * worth reading. Only when the band runs out does an option get an ellipsis.
 */
export function layoutChoiceRows(texts: string[], expanded: boolean): ChoiceRowLayout[] {
  const count = Math.min(texts.length, CHOICE_MAX)
  if (expanded) {
    return texts.slice(0, count).map((text, i) => {
      const top = Math.floor((i * SCREEN_H) / count)
      const h = Math.floor(((i + 1) * SCREEN_H) / count) - top
      const maxLines = Math.max(1, Math.floor((h - 2) / LINE_H))
      return { x: 0, y: top, w: SCREEN_W, h, lines: fitChoiceLines(text, SCREEN_W - 12, maxLines), indent: 0 }
    })
  }

  const out: ChoiceRowLayout[] = []
  let line = 0
  for (let i = 0; i < count; i++) {
    const prefix = /^\d+\.\s+/.exec(texts[i])?.[0] ?? ''
    const indent = prefix ? textWidth(prefix) + LETTER_SPACING : 0
    // leave at least one line for every option still to come
    const spare = CHOICE_MAX - line - (count - i - 1)
    const lines = fitChoiceLines(texts[i].slice(prefix.length), CHOICE_W - indent, Math.max(1, spare))
    lines[0] = prefix + lines[0]
    out.push({ x: 0, y: CHOICE_ROW_Y[line] - 1, w: SCREEN_W, h: lines.length * CHOICE_PITCH + 1, lines, indent })
    line += lines.length
  }
  return out
}

function fitChoiceLines(text: string, maxWidth: number, maxLines: number): string[] {
  const lines = wrapText(text, maxWidth)
  if (lines.length === 0) return ['']
  if (lines.length <= maxLines) return lines
  const visible = lines.slice(0, maxLines)
  visible[maxLines - 1] = clip(lines.slice(maxLines - 1).join(' '), maxWidth)
  return visible
}

/**
 * Draw the dialogue options. There are never more than CHOICE_MAX of them and
 * there is no paging: the original never made you scroll through a menu, and
 * once you do, picking what to say stops feeling like talking.
 */
export function drawChoiceRows(
  fb: Framebuffer,
  rows: ChoiceView[],
  hoveredRow: number,
  expanded = false,
): void {
  if (expanded) fb.clear(C.uiPanel)
  layoutChoiceRows(rows.map((r) => r.text), expanded).forEach((row, i) => {
    const c = rows[i]
    if (!c.text) return
    const color = hoveredRow === i ? C.uiChoiceHot : c.used ? C.uiChoiceUsed : C.uiChoice
    if (!expanded) {
      row.lines.forEach((line, n) => {
        drawText(fb, line, CHOICE_X + (n === 0 ? 0 : row.indent), row.y + 1 + n * CHOICE_PITCH, { color })
      })
      return
    }

    if (hoveredRow === i) {
      for (let y = row.y; y < row.y + row.h; y++) {
        for (let x = 0; x < SCREEN_W; x++) fb.set(x, y, C.uiPanelEdge)
      }
    }
    if (i > 0) {
      for (let x = 4; x < SCREEN_W - 4; x++) fb.set(x, row.y, C.uiPanelEdge)
    }

    const textTop = row.y + Math.max(1, Math.floor((row.h - row.lines.length * LINE_H) / 2))
    row.lines.forEach((line, lineIndex) => {
      drawText(fb, line, 6, textTop + lineIndex * LINE_H, { color })
    })
  })
}

/** Which visible row is at (x, y), or -1. */
export function hitTestChoiceRow(x: number, y: number, texts: string[], expanded = false): number {
  if (!expanded && y < ROOM_H) return -1
  return layoutChoiceRows(texts, expanded).findIndex((r) => rectContains([r.x, r.y, r.w, r.h], x, y))
}

// ---------------------------------------------------------------------------
// Cursor: a grey crosshair with a hole in the middle. It never changes shape,
// exactly like the original — the sentence line is what tells you what you are
// about to do.
// ---------------------------------------------------------------------------

export function drawCursor(fb: Framebuffer, x: number, y: number, hot: boolean): void {
  const cx = Math.round(x)
  const cy = Math.round(y)
  const c = hot ? C.uiVerbHot : C.grey6
  const s = C.black
  for (let i = 2; i <= 6; i++) {
    for (const [dx, dy] of [[-i, 0], [i, 0], [0, -i], [0, i]] as [number, number][]) {
      fb.set(cx + dx + 1, cy + dy + 1, s)
    }
  }
  for (let i = 2; i <= 6; i++) {
    for (const [dx, dy] of [[-i, 0], [i, 0], [0, -i], [0, i]] as [number, number][]) {
      fb.set(cx + dx, cy + dy, c)
    }
  }
}
