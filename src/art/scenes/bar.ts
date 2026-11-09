/**
 * Scene 3 — El Patilla, the bar. Warm, low, and full of engineers.
 *
 * Painted in full by src/art/scenes/bar-detail.ts.
 */
import type { ScenePainter } from '../../engine/room'
import { paintBar, paintBarForeground, animateBar } from './bar-detail'

export const bar: ScenePainter = {
  id: 'bar',
  paint: paintBar,
  paintForeground: paintBarForeground,
  animate: animateBar,
}
