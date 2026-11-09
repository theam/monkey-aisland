import { describe, expect, it } from 'vitest'

import type { Vec2 } from '../../src/engine/content'
import { clampToPoly, pointInPoly, polyBounds, rectCenter, rectContains } from '../../src/engine/geom'

const square: readonly Vec2[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]

describe('polygon helpers', () => {
  it('detects points inside and outside a polygon', () => {
    expect(pointInPoly(5, 5, square)).toBe(true)
    expect(pointInPoly(12, 5, square)).toBe(false)
  })

  it('clamps an outside point to the closest edge', () => {
    expect(clampToPoly(12, 4, square)).toEqual([10, 4])
    expect(clampToPoly(5, 5, square)).toEqual([5, 5])
  })

  it('calculates polygon bounds', () => {
    expect(polyBounds(square)).toEqual({ x: 0, y: 0, w: 10, h: 10 })
  })
})

describe('rectangle helpers', () => {
  const rectangle = [10, 20, 30, 40] as const

  it('uses an exclusive right and bottom edge', () => {
    expect(rectContains(rectangle, 10, 20)).toBe(true)
    expect(rectContains(rectangle, 39, 59)).toBe(true)
    expect(rectContains(rectangle, 40, 60)).toBe(false)
  })

  it('calculates the center', () => {
    expect(rectCenter(rectangle)).toEqual([25, 40])
  })
})
