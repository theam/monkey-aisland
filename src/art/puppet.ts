/**
 * Character factory.
 *
 * Hand-drawing 7 characters x 8 frames as ASCII grids would be ~2000 lines of
 * unmaintainable art. Instead every character is a "puppet": one carefully
 * tuned body renderer (LucasArts-ish proportions, 3-tone shading, 4-frame walk
 * cycle) plus small hand-drawn ASCII overlays for the bits that actually carry
 * personality — hair, hats, beards, glasses, props.
 *
 * Light comes from the left in every scene, so highlights are on the left edge
 * and the shadow side is on the right. Consistency is what makes a cast look
 * like it was drawn by one person.
 */
import { Framebuffer } from '../engine/framebuffer'
import { C, type ColorName } from '../engine/palette'
import { hline, vline, line, disc } from '../engine/draw'
import { buildSprite, type Sprite, type SpriteDef } from '../engine/sprite'

export type Tri = [ColorName, ColorName, ColorName] // [shadow, mid, light]

export type Overlay = {
  /** ASCII rows; '.' / ' ' are transparent */
  rows: string[]
  colors: Record<string, ColorName>
  /** offset from the head's top-left corner */
  at: [number, number]
  /** draw behind the body instead of in front (e.g. long hair, capes) */
  behind?: boolean
  /** only draw on these frames (default: all) */
  frames?: string[]
}

export type PuppetSpec = {
  id: string
  /** total pixel height, feet to top of head (before hair) */
  height: number
  /** body width multiplier: 0.85 slim, 1 normal, 1.2 burly */
  build?: number
  skin: Tri
  shirt: Tri
  trousers: Tri
  shoes: ColorName
  /** simple 1px belt */
  belt?: ColorName
  /** eye colour (default ink) */
  eyes?: ColorName
  /** mouth colour (default a dark tone of the skin) */
  mouth?: ColorName
  /** shirt sleeves stop here (0 = sleeveless, 1 = full length) */
  sleeve?: number
  /** a monkey tail, drawn from the hip */
  tail?: ColorName
  /** proportionally larger head — reads as "cute"/"comic" */
  headScale?: number
  overlays?: Overlay[]
  /** arms crossed while standing (Big-John) */
  armsCrossed?: boolean
  /** extra frames on top of the shared set, for characters with body language */
  poses?: Record<string, Pose>
  /** sleeves in their own colour, so a patterned body doesn't swallow an arm crossing it */
  sleeves?: ColorName
}

export type Pose = {
  /** vertical body bob */
  bob: number
  /** foot offsets: [leftFootDx, rightFootDx] */
  feet: [number, number]
  /** arm swing: [leftArmDx, rightArmDx] */
  arms: [number, number]
  /** 0 closed, 1 open, 2 wide */
  mouth: number
  /** raise both arms (laughing, cheering) */
  armsUp?: boolean
  /** tilt the head back */
  headTilt?: number
  /**
   * Put each hand somewhere instead of swinging it: [out, down] from its
   * shoulder, left arm then right, `out` measured away from the body. For
   * characters who talk with their arms.
   */
  hands?: [[number, number], [number, number]]
  /** where the elbows go with `hands`, same units; default is a slight bend outwards */
  elbows?: [[number, number], [number, number]]
}

const POSES: Record<string, Pose> = {
  stand: { bob: 0, feet: [-2, 2], arms: [0, 0], mouth: 0 },
  blink: { bob: 0, feet: [-2, 2], arms: [0, 0], mouth: 0 },
  talk1: { bob: 0, feet: [-2, 2], arms: [1, -1], mouth: 1 },
  talk2: { bob: 0, feet: [-2, 2], arms: [-1, 2], mouth: 2 },
  laugh: { bob: -1, feet: [-3, 3], arms: [0, 0], mouth: 2, armsUp: true, headTilt: -1 },
  walk1: { bob: 0, feet: [-4, 4], arms: [3, -3], mouth: 0 },
  walk2: { bob: 1, feet: [-1, 1], arms: [1, -1], mouth: 0 },
  walk3: { bob: 0, feet: [4, -4], arms: [-3, 3], mouth: 0 },
  walk4: { bob: -1, feet: [1, -1], arms: [-1, 1], mouth: 0 },
}

export function buildPuppet(spec: PuppetSpec): Sprite {
  const frames: Record<string, string[]> = {}
  // We render straight into framebuffers, then convert to the ASCII-grid based
  // SpriteDef format so everything downstream stays uniform.
  const colorChars = new Map<number, string>()
  const charColors: Record<string, number> = {}
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+*=~^!$%&@?<>[]{}|;:'
  let next = 0
  const charFor = (c: number): string => {
    let ch = colorChars.get(c)
    if (!ch) {
      if (next >= alphabet.length) throw new Error('puppet: ran out of glyphs for colours')
      ch = alphabet[next++]
      colorChars.set(c, ch)
      charColors[ch] = c
    }
    return ch
  }

  for (const [name, pose] of Object.entries({ ...POSES, ...spec.poses })) {
    if (name === 'blink' && !spec.overlays?.some((o) => o.frames?.includes('blink'))) {
      // no dedicated blink art: skip, the actor falls back to `stand`
      continue
    }
    const fb = renderPose(spec, pose, name)
    const rows: string[] = []
    for (let y = 0; y < fb.h; y++) {
      let row = ''
      for (let x = 0; x < fb.w; x++) {
        const c = fb.get(x, y)
        row += c === 0 ? '.' : charFor(c)
      }
      rows.push(row.replace(/\.+$/, ''))
    }
    frames[name] = rows
  }

  const def: SpriteDef = {
    id: spec.id,
    colors: charColors,
    frames,
    anchor: [Math.floor(gridW(spec) / 2), gridH(spec)],
  }
  return buildSprite(def)
}

function gridW(spec: PuppetSpec): number {
  // Wide enough for the widest overlay as well as the body — long hair and
  // props sit outside the shoulders.
  const body = Math.round(22 * (spec.build ?? 1))
  let widest = 0
  for (const ov of spec.overlays ?? []) {
    for (const row of ov.rows) widest = Math.max(widest, ov.at[0] + row.length)
  }
  // …and for hands thrown out past the shoulders.
  let reach = 0
  for (const pose of Object.values(spec.poses ?? {})) {
    for (const [out] of pose.hands ?? []) reach = Math.max(reach, out)
  }
  const arms = Math.round(13 * (spec.build ?? 1)) + 2 * (reach + 3)
  return Math.max(body, widest + 8, arms)
}

function gridH(spec: PuppetSpec): number {
  return spec.height + 4 // headroom for hats and hair
}

function renderPose(spec: PuppetSpec, pose: Pose, frameName: string): Framebuffer {
  const W = gridW(spec)
  const H = gridH(spec)
  const fb = new Framebuffer(W, H)

  const build = spec.build ?? 1
  const cx = Math.floor(W / 2)
  const bottom = H - 1
  const headScale = spec.headScale ?? 1

  const headH = Math.round(spec.height * 0.25 * headScale)
  const headW = Math.round(headH * 0.92)
  const legH = Math.round(spec.height * 0.38)
  const torsoH = spec.height - headH - legH
  const top = bottom - spec.height + 1 + 4 // 4 = headroom

  const headTop = top + pose.bob + (pose.headTilt ?? 0)
  const torsoTop = headTop + headH
  const hipY = torsoTop + torsoH
  const footY = bottom

  const shoulderW = Math.round(13 * build)
  const hipW = Math.round(9 * build)

  const skin = spec.skin.map((n) => C[n]) as [number, number, number]
  const shirt = spec.shirt.map((n) => C[n]) as [number, number, number]
  const trousers = spec.trousers.map((n) => C[n]) as [number, number, number]
  const shoes = C[spec.shoes]
  const eyes = C[spec.eyes ?? 'ink']
  const mouthC = C[spec.mouth ?? spec.skin[0]]

  // ---- tail (behind everything) -------------------------------------------
  if (spec.tail) {
    const t = C[spec.tail]
    const dir = 1
    let x = cx + Math.round(hipW / 2) * dir
    let y = hipY
    for (let i = 0; i < Math.round(spec.height * 0.5); i++) {
      const ang = i / Math.round(spec.height * 0.5)
      x += dir * (ang < 0.5 ? 1 : 0.4)
      y += ang < 0.35 ? 0.6 : ang < 0.7 ? -0.4 : -0.8
      fb.set(Math.round(x), Math.round(y), t)
      fb.set(Math.round(x), Math.round(y) + 1, t)
    }
  }

  // ---- behind-body overlays (long hair, cloak) ----------------------------
  drawOverlays(fb, spec, cx, headTop, headW, frameName, true)

  // ---- legs ---------------------------------------------------------------
  const legTopY = hipY
  for (const [i, dx] of pose.feet.entries()) {
    const hipX = cx + (i === 0 ? -Math.round(hipW / 4) - 1 : Math.round(hipW / 4) + 1)
    const footX = hipX + dx
    const kneeX = Math.round((hipX + footX) / 2)
    const kneeY = Math.round(legTopY + legH * 0.5)
    // thigh + shin, 3px wide
    for (let w = -1; w <= 1; w++) {
      line(fb, hipX + w, legTopY, kneeX + w, kneeY, trousers[1])
      line(fb, kneeX + w, kneeY, footX + w, footY - 2, trousers[1])
    }
    // shading: right edge dark, left edge light
    line(fb, hipX + 2, legTopY, kneeX + 2, kneeY, trousers[0])
    line(fb, kneeX + 2, kneeY, footX + 2, footY - 2, trousers[0])
    line(fb, hipX - 2, legTopY, kneeX - 2, kneeY, trousers[2])
    // shoe
    hline(fb, footX - 2, footX + 2, footY - 1, shoes)
    hline(fb, footX - 2, footX + 3, footY, shoes)
  }

  // ---- torso --------------------------------------------------------------
  for (let y = torsoTop; y <= hipY; y++) {
    const t = (y - torsoTop) / Math.max(1, hipY - torsoTop)
    const halfW = Math.round((shoulderW * (1 - t) + hipW * t) / 2)
    hline(fb, cx - halfW, cx + halfW, y, shirt[1])
    fb.set(cx - halfW, y, shirt[2])
    fb.set(cx + halfW, y, shirt[0])
    fb.set(cx + halfW - 1, y, shirt[0])
  }
  if (spec.belt) {
    hline(fb, cx - Math.round(hipW / 2) - 1, cx + Math.round(hipW / 2) + 1, hipY - 1, C[spec.belt])
  }

  // ---- arms ---------------------------------------------------------------
  const sleeve = spec.sleeve ?? 0.6
  const sleeveC = spec.sleeves ? C[spec.sleeves] : shirt[1]
  const shoulderY = torsoTop + 1
  const armLen = Math.round(spec.height * 0.34)

  if (spec.armsCrossed && frameName !== 'walk1' && frameName !== 'walk2' && frameName !== 'walk3' && frameName !== 'walk4') {
    // Arms folded: two horizontal forearms across the chest.
    const y = torsoTop + Math.round(torsoH * 0.45)
    hline(fb, cx - shoulderW / 2 + 1, cx + shoulderW / 2 - 1, y, shirt[0])
    hline(fb, cx - shoulderW / 2 + 2, cx + shoulderW / 2 - 2, y + 1, shirt[1])
    fb.set(cx - Math.round(shoulderW / 2) + 1, y + 1, skin[1])
    fb.set(cx + Math.round(shoulderW / 2) - 1, y, skin[1])
  } else {
    for (const [i, dx] of pose.arms.entries()) {
      const side = i === 0 ? -1 : 1
      const sx = cx + side * Math.round(shoulderW / 2)
      let ex = sx + dx
      let ey = shoulderY + armLen
      if (pose.armsUp) {
        ex = sx + side * 4
        ey = shoulderY - Math.round(armLen * 0.45)
      }
      let elbowX = Math.round((sx + ex) / 2) + side
      let elbowY = Math.round((shoulderY + ey) / 2)
      // Whether the sleeve reaches past the elbow. Measured along the arm for
      // placed hands, which can be above the shoulder, where "lower on the
      // screen" stops meaning "further down the arm".
      let sleevedForearm = Math.round(shoulderY + (ey - shoulderY) * sleeve) > elbowY
      if (pose.hands) {
        const [out, down] = pose.hands[i]
        ex = sx + side * out
        ey = shoulderY + down
        const [eOut, eDown] = pose.elbows?.[i] ?? [out / 2 + 2, down / 2 + 1]
        elbowX = Math.round(sx + side * eOut)
        elbowY = Math.round(shoulderY + eDown)
        sleevedForearm = sleeve > 0.5
      }
      for (let w = 0; w < 2; w++) {
        line(fb, sx + w * side, shoulderY, elbowX + w * side, elbowY, sleeveC)
        line(fb, elbowX + w * side, elbowY, ex + w * side, ey, sleevedForearm ? sleeveC : skin[1])
      }
      // bare forearm below the sleeve
      if (sleeve < 0.9) {
        const t0 = Math.max(0, Math.min(1, sleeve))
        const fx = Math.round(sx + (ex - sx) * t0)
        const fy = Math.round(shoulderY + (ey - shoulderY) * t0)
        for (let w = 0; w < 2; w++) line(fb, fx + w * side, fy, ex + w * side, ey, skin[1])
      }
      // hand
      disc(fb, ex + (side > 0 ? 0 : 1), ey + 1, 1.4, skin[2])
    }
  }

  // ---- head ---------------------------------------------------------------
  const hx = cx
  const hy = headTop + Math.floor(headH / 2)
  const rx = headW / 2
  const ry = headH / 2
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const t = y / ry
    if (Math.abs(t) > 1) continue
    const span = Math.round(rx * Math.sqrt(1 - t * t) * (y > 0 ? 0.94 : 1))
    hline(fb, hx - span, hx + span, hy + y, skin[1])
    fb.set(hx - span, hy + y, skin[2])
    fb.set(hx + span, hy + y, skin[0])
  }
  // neck
  hline(fb, hx - 1, hx + 1, torsoTop - 1, skin[0])

  // face: eyes on the upper third, mouth on the lower third
  const eyeY = headTop + Math.round(headH * 0.42)
  const eyeDx = Math.max(1, Math.round(headW * 0.2))
  if (frameName === 'blink') {
    fb.set(hx - eyeDx, eyeY, eyes)
    fb.set(hx + eyeDx, eyeY, eyes)
  } else {
    vline(fb, hx - eyeDx, eyeY, eyeY + 1, eyes)
    vline(fb, hx + eyeDx, eyeY, eyeY + 1, eyes)
  }
  // brow shadow gives them an expression at 9 pixels tall
  hline(fb, hx - eyeDx - 1, hx - eyeDx + 1, eyeY - 2, skin[0])
  hline(fb, hx + eyeDx - 1, hx + eyeDx + 1, eyeY - 2, skin[0])
  // nose
  fb.set(hx + 1, eyeY + 2, skin[0])

  const mouthY = headTop + Math.round(headH * 0.75)
  if (pose.mouth === 0) {
    hline(fb, hx - 1, hx + 1, mouthY, mouthC)
  } else if (pose.mouth === 1) {
    hline(fb, hx - 1, hx + 1, mouthY, mouthC)
    fb.set(hx, mouthY + 1, mouthC)
  } else {
    hline(fb, hx - 2, hx + 2, mouthY, mouthC)
    hline(fb, hx - 1, hx + 1, mouthY + 1, mouthC)
  }

  // ---- front overlays (hair, hats, glasses, props) ------------------------
  drawOverlays(fb, spec, cx, headTop, headW, frameName, false)

  return fb
}

function drawOverlays(
  fb: Framebuffer,
  spec: PuppetSpec,
  cx: number,
  headTop: number,
  headW: number,
  frameName: string,
  behind: boolean,
): void {
  for (const ov of spec.overlays ?? []) {
    if ((ov.behind ?? false) !== behind) continue
    if (ov.frames && !ov.frames.includes(frameName)) continue
    const ox = cx - Math.floor(headW / 2) + ov.at[0]
    const oy = headTop + ov.at[1]
    for (let y = 0; y < ov.rows.length; y++) {
      const row = ov.rows[y]
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (ch === '.' || ch === ' ') continue
        const name = ov.colors[ch]
        if (!name) throw new Error(`puppet ${spec.id}: overlay char '${ch}' has no colour`)
        fb.set(ox + x, oy + y, C[name])
      }
    }
  }
}
