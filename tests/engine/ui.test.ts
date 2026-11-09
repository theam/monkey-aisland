import { describe, expect, it } from 'vitest'

import { textWidth } from '../../src/engine/font'
import { layoutChoiceRows } from '../../src/engine/ui'

const LONG =
  "1. It's four hundred lines because it does one thing. Your version does one thing in nine files and a queue."

describe('dialogue choice layout', () => {
  it('keeps the original compact desktop rows', () => {
    const rows = layoutChoiceRows(['1. Yes.', '2. No.', '3. Maybe.', '4. Bye.'], false)

    expect(rows[0]).toMatchObject({ x: 0, y: 144, w: 320, h: 10, lines: ['1. Yes.'] })
    expect(rows[3]).toMatchObject({ x: 0, y: 171, w: 320, h: 10, lines: ['4. Bye.'] })
  })

  it('wraps a long option onto the spare lines instead of clipping it', () => {
    const rows = layoutChoiceRows([LONG, '2. Nobody reads it anyway.', '3. Bye.'], false)

    expect(rows[0].lines.length).toBeGreaterThan(1)
    expect(rows[0].lines.join(' ')).toBe(LONG)
    expect(rows[0].indent).toBe(textWidth('1. ') + 1)
    expect(rows[1].y).toBe(rows[0].y + rows[0].h - 1)
  })

  it('clips only once the band is full, keeping a line for every option', () => {
    const rows = layoutChoiceRows(Array.from({ length: 6 }, (_, i) => `${i + 1}. ${LONG.slice(3)}`), false)

    expect(rows.map((r) => r.lines.length)).toEqual([1, 1, 1, 1, 1, 1])
    expect(rows[0].lines[0].endsWith('…')).toBe(true)
    expect(rows.at(-1)!.y).toBe(189)
  })

  it('shares the full touch screen between choices without gaps', () => {
    const rows = layoutChoiceRows(Array.from({ length: 6 }, (_, i) => `${i + 1}. Option`), true)

    expect(rows[0]).toMatchObject({ x: 0, y: 0, w: 320, h: 33 })
    expect(rows.at(-1)).toMatchObject({ x: 0, y: 166, w: 320, h: 34 })
    expect(rows.reduce((height, row) => height + row.h, 0)).toBe(200)
    expect(rows.every((row, index) => index === 0 || rows[index - 1].y + rows[index - 1].h === row.y)).toBe(true)
  })
})
