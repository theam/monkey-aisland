import { describe, expect, it } from 'vitest'

import { hashString, RNG, valueNoise1D } from '../../src/engine/rng'

describe('RNG', () => {
  it('produces the same sequence from the same seed', () => {
    const first = new RNG('island')
    const second = new RNG('island')

    expect(Array.from({ length: 10 }, () => first.next())).toEqual(
      Array.from({ length: 10 }, () => second.next()),
    )
  })

  it('returns inclusive integers within the requested range', () => {
    const rng = new RNG(42)
    const values = Array.from({ length: 1_000 }, () => rng.int(2, 5))

    expect(values.every((value) => Number.isInteger(value) && value >= 2 && value <= 5)).toBe(true)
    expect(new Set(values)).toEqual(new Set([2, 3, 4, 5]))
  })

  it('shuffles without changing the source array', () => {
    const source = [1, 2, 3, 4, 5]
    const shuffled = new RNG(42).shuffle(source)

    expect(source).toEqual([1, 2, 3, 4, 5])
    expect(shuffled).toHaveLength(source.length)
    expect(shuffled.toSorted()).toEqual(source)
  })
})

describe('hashString', () => {
  it('returns a stable unsigned hash', () => {
    expect(hashString('monkey-aisland')).toBe(4_113_994_319)
  })
})

describe('valueNoise1D', () => {
  it('is deterministic and normalized', () => {
    const first = valueNoise1D(new RNG('coast'), 32, 8)
    const second = valueNoise1D(new RNG('coast'), 32, 8)

    expect(first).toEqual(second)
    expect(first).toHaveLength(32)
    expect([...first].every((value) => value >= 0 && value < 1)).toBe(true)
  })
})
