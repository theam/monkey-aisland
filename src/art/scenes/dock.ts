/**
 * Scene 2 — the dock. Wide room, horizontal walk only, with a gallery of
 * paintings about The Agile Monkeys nailed to the rock face on the way to
 * El Patilla.
 *
 * Painted in full by src/art/scenes/dock-detail.ts (see that file for the
 * plank work, the ship, and the picture frames).
 */
import type { ScenePainter } from '../../engine/room'
import { paintDock, animateDock } from './dock-detail'

export const dock: ScenePainter = {
  id: 'dock',
  paint: paintDock,
  animate: animateDock,
}
