/**
 * One source of time for the whole game.
 *
 * Everything that measures duration — speech timing, animation, fades — reads
 * from here rather than calling performance.now() directly. That keeps the
 * game frame-rate independent and, usefully, makes it steppable: a test (or a
 * headless browser whose requestAnimationFrame is throttled to zero) can drive
 * it forwards deterministically with `advance()`.
 */
let offset = 0

export function now(): number {
  return performance.now() + offset
}

/** Push the clock forwards. Only used by the dev/test stepper. */
export function advance(ms: number): void {
  offset += ms
}
