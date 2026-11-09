/**
 * Scene painter registry. `background:` in a scene YAML picks one of these.
 */
import { Framebuffer } from '../../engine/framebuffer'
import type { ScenePainter } from '../../engine/room'
import { C } from '../../engine/palette'
import { drawText } from '../../engine/font'
import { gradientV, rect } from '../../engine/draw'
import { RAMPS } from '../../engine/palette'
import { lookout } from './lookout'
import { dock } from './dock'
import { bar } from './bar'

/** Shown when a scene names a background that does not exist yet. */
const fallback: ScenePainter = {
  id: '__fallback',
  paint(fb: Framebuffer) {
    gradientV(fb, { x: 0, y: 0, w: fb.w, h: fb.h }, RAMPS.sky, 0.1, 0.8)
    rect(fb, 0, fb.h - 30, fb.w, 30, C.rock2)
    drawText(fb, 'BACKGROUND NOT PAINTED YET', 30, 60, { color: C.gold3, shadow: C.black })
    drawText(fb, 'CHECK background: IN THE SCENE YAML', 18, 74, { color: C.grey4, shadow: C.black })
  },
}

export function buildPainters(): Map<string, ScenePainter> {
  const list: ScenePainter[] = [lookout, dock, bar, fallback]
  const map = new Map<string, ScenePainter>()
  for (const p of list) map.set(p.id, p)
  map.set('__fallback', fallback)
  return map
}
