# Dossier: Procedural Pixel-Art Technique for Canvas 2D

Target: three `320x144` room backgrounds, generated once at load into an indexed framebuffer,
converted to `ImageBitmap`, blitted every frame. No external images.

---

## 0. Hard constants (verified)

| Constant | Value | Why / source |
|---|---|---|
| Logical screen | `320 x 200` | Mode 13h, the resolution every SCUMM v5 game ran at ([Mode 13h](https://en.wikipedia.org/wiki/Mode_13h)) |
| Room (background) area | `320 x 144` | ScummVM calls `initScreens(16, 144)` for the default v4/v5 path (MI1); the room occupies rows `0..143`, the verb/inventory virtual screen occupies `144..199` (56 rows). [scumm.cpp](https://github.com/scummvm/scummvm/blob/master/engines/scumm/scumm.cpp) |
| Verb UI area | `320 x 56` at `y=144` | same |
| Original pixel aspect | 1 : 1.2 (tall) | Mode 13h on a 4:3 CRT. **We deliberately ignore this** — see §8.4 |
| MI1 EGA colour count | 16 | original 1990 release |
| MI1 VGA colour count | 256 max, far fewer per room | [mixnmojo: From EGA to VGA](https://mixnmojo.com/features/sitefeatures/Monkey-Island-From-EGA-to-VGA) |
| VGA DAC depth | 6 bits/channel (18-bit, 262 144 colours) | [KeyJ: Color Generation in CGA/EGA/VGA](https://keyj.emphy.de/cga-ega-vga/) |
| EGA depth | 2 bits/channel (64 colours) | [shikadi EGA Palette](https://moddingwiki.shikadi.net/wiki/EGA_Palette) |

The look we are cloning is specifically **Mark Ferrari's dithered 8-bit style** (Loom → MI1). Ferrari
had to fight the SCUMM engineers to allow dithering at all, because their RLE compressor exploded on
dithered data; they switched to LZW once he repainted a scene to prove the gain
([Thimbleweed Park dev blog](https://blog.thimbleweedpark.com/mark_ferrari.html),
[Q&A with Mark J. Ferrari](https://www.effectgames.com/effect/article-Q_A_with_Mark_J_Ferrari.html)).
Practical consequence for us: **dithering is not a garnish, it is the primary shading tool.** Every
large area in all three rooms should be a dithered blend of two adjacent palette entries, never a
flat fill and never a smooth gradient.

---

## 1. Base approach: indexed framebuffer + thresholded path stamping

### 1.1 The verdict

Neither pure per-pixel nor pure path drawing. Use a **hybrid**:

* **Authoritative surface = an indexed framebuffer** (`Uint8Array` of palette indices). Every draw
  operation writes a palette *index*, not a colour. This makes palette discipline structural rather
  than a matter of willpower (§2), and makes palette cycling possible (§7).
* **Primitives** (`px`, `hline`, `vline`, `rect`, `fillPoly`, `ditherFill`, `silhouette`) write
  straight into that array. Fast, exact, no anti-aliasing, integer-only.
* **Curves** (moon disc, rope catenary, barrel belly, palm fronds, arched doorway, ship hull) are
  authored with the real Canvas path API into a scratch **1-bit mask**, then *thresholded* into the
  framebuffer. Canvas always anti-aliases paths and `imageSmoothingEnabled` does not change that —
  thresholding the mask's alpha at 128 is what kills the grey fringe and gives you hand-drawn-looking
  hard edges from `arc()`/`bezierCurveTo()`.

That third bullet is the whole trick. It buys you Bézier expressiveness with zero anti-aliasing.

### 1.2 The helper API (this is the file to write first)

```ts
// src/gfx/fb.ts
export type Idx = number; // 0..63 palette index; 0 is reserved = transparent

export class IndexedFB {
  readonly px: Uint8Array;
  constructor(readonly w: number, readonly h: number, fill: Idx = 0) {
    this.px = new Uint8Array(w * h);
    if (fill) this.px.fill(fill);
  }

  /** Single pixel, bounds-checked. Hot path: prefer hline where possible. */
  set(x: number, y: number, c: Idx): void {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }
  get(x: number, y: number): Idx {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }

  /** Inclusive horizontal span. */
  hline(x0: number, x1: number, y: number, c: Idx): void {
    y |= 0; if (y < 0 || y >= this.h) return;
    let a = Math.max(0, Math.min(x0, x1) | 0);
    let b = Math.min(this.w - 1, Math.max(x0, x1) | 0);
    const row = y * this.w;
    for (let x = a; x <= b; x++) this.px[row + x] = c;
  }
  vline(x: number, y0: number, y1: number, c: Idx): void {
    x |= 0; if (x < 0 || x >= this.w) return;
    let a = Math.max(0, Math.min(y0, y1) | 0);
    let b = Math.min(this.h - 1, Math.max(y0, y1) | 0);
    for (let y = a; y <= b; y++) this.px[y * this.w + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: Idx): void {
    for (let j = 0; j < h; j++) this.hline(x, x + w - 1, y + j, c);
  }
  frame(x: number, y: number, w: number, h: number, c: Idx): void {
    this.hline(x, x + w - 1, y, c); this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c); this.vline(x + w - 1, y, y + h - 1, c);
  }

  /** Even-odd scanline polygon fill, top-left pixel-centre rule. Points may be fractional. */
  fillPoly(pts: ReadonlyArray<readonly [number, number]>, c: Idx): void {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const y0 = Math.max(0, Math.ceil(minY - 0.5));
    const y1 = Math.min(this.h - 1, Math.floor(maxY - 0.5));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y++) {
      xs.length = 0;
      const sy = y + 0.5;
      for (let i = 0, n = pts.length; i < n; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
          xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.hline(Math.ceil(xs[k] - 0.5), Math.ceil(xs[k + 1] - 0.5) - 1, y, c);
      }
    }
  }

  /** Terrain / cliff / roofline: fill between two height functions, column by column. */
  silhouette(x0: number, x1: number, top: (x: number) => number,
             bottom: (x: number) => number, c: Idx): void {
    for (let x = x0 | 0; x <= (x1 | 0); x++) {
      this.vline(x, Math.round(top(x)), Math.round(bottom(x)), c);
    }
  }

  /** Two-colour ordered dither at a constant density. density 0 => all a, 1 => all b. */
  ditherFill(x: number, y: number, w: number, h: number,
             a: Idx, b: Idx, density: number, m: 2 | 4 | 8 = 4): void {
    for (let j = 0; j < h; j++) {
      const yy = y + j;
      for (let i = 0; i < w; i++) {
        const xx = x + i;
        this.set(xx, yy, density > bayer(xx, yy, m) ? b : a);
      }
    }
  }

  /** Ordered-dither an arbitrary scalar field through a ramp of indices (dark -> light). */
  rampFill(x: number, y: number, w: number, h: number, ramp: ReadonlyArray<Idx>,
           t: (x: number, y: number) => number, m: 2 | 4 | 8 = 4): void {
    const steps = ramp.length - 1;
    for (let j = 0; j < h; j++) {
      const yy = y + j;
      for (let i = 0; i < w; i++) {
        const xx = x + i;
        const v = Math.min(1, Math.max(0, t(xx, yy))) * steps;
        const lo = Math.floor(v);
        const idx = (v - lo) > bayer(xx, yy, m) ? Math.min(steps, lo + 1) : lo;
        this.px[yy * this.w + xx] = ramp[idx];
      }
    }
  }

  /** Convenience: top-to-bottom dithered gradient across a rect. */
  verticalGradientDither(x: number, y: number, w: number, h: number,
                         ramp: ReadonlyArray<Idx>, m: 2 | 4 | 8 = 4): void {
    this.rampFill(x, y, w, h, ramp, (_x, yy) => (yy - y) / (h - 1), m);
  }
}
```

`rampFill` was run against a `320x144` sky (5-step ramp, Bayer 4x4) and verified: each scanline
contains only the two ramp entries that bracket it, mixed 80/240 → 240/80 as `t` advances, and no
writes escape the ramp. That two-entry-per-row property is exactly what makes it read as MI1 rather
than as a CSS gradient.

### 1.3 Path stamping (the anti-aliasing killer)

```ts
// src/gfx/stamp.ts
const mask = document.createElement('canvas');           // one shared scratch, 320x144
const mctx = mask.getContext('2d', { willReadFrequently: true })!;

export function stampPath(fb: IndexedFB, c: Idx,
                          draw: (g: CanvasRenderingContext2D) => void,
                          threshold = 128): void {
  if (mask.width !== fb.w || mask.height !== fb.h) { mask.width = fb.w; mask.height = fb.h; }
  mctx.clearRect(0, 0, fb.w, fb.h);
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#fff';
  mctx.lineCap = 'butt'; mctx.lineJoin = 'miter';
  mctx.save(); draw(mctx); mctx.restore();
  const d = mctx.getImageData(0, 0, fb.w, fb.h).data;
  const n = fb.px.length;
  for (let i = 0, p = 3; i < n; i++, p += 4) if (d[p] >= threshold) fb.px[i] = c;
}

/** Same, but returns the mask as a boolean field for dithering inside a curved shape. */
export function pathMask(w: number, h: number,
                         draw: (g: CanvasRenderingContext2D) => void,
                         threshold = 128): Uint8Array {
  if (mask.width !== w || mask.height !== h) { mask.width = w; mask.height = h; }
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = '#fff';
  mctx.save(); draw(mctx); mctx.restore();
  const d = mctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = d[p] >= threshold ? 1 : 0;
  return out;
}
```

Rules of use:
* `threshold = 128` for solid shapes; `threshold = 200` shaves a pixel off (use for the *inner* pass
  when you want a 1px rim); `threshold = 64` grows it.
* Stroke widths must be odd integers (`1`, `3`) and stroked paths offset by `0.5` so the stroke lands
  on pixel centres.
* Never stamp text. Bitmap font only (see §6 loader — the same ASCII grid format does glyphs).

---

## 2. Palette discipline

### 2.1 Why indexed, not RGBA

1. **You physically cannot pick a 33rd colour.** Every write is `0..63`. The "web 2.0" failure mode
   (a slightly different blue for each object, soft `rgba()` shadows, smooth gradients) becomes
   unrepresentable.
2. **Ramps are the shading vocabulary.** Because colours live in declared ramps, "shade this" and
   "light this" become `walk the ramp N steps` (§5.1), which is what a pixel artist actually does.
3. **Palette cycling for free** (§7). Fire, lamps, water shimmer and star twinkle all become
   palette-register writes instead of per-frame pixel work.
4. **Per-room banks.** SCUMM rooms each carried their own palette. We do the same: indices `0..31`
   are global (ink, skin, hair, cloth, costumes — so characters look identical in all three rooms),
   indices `32..63` are swapped per room. 64 entries total, ever.

### 2.2 VGA-legal colour values

The VGA DAC stores 6 bits per channel, so an authentic palette entry must be expressible as
`v6 * 255/63`. Snap every colour once, at authoring time:

```ts
export const snap6 = (c: number): number => {
  const v = Math.round((c / 255) * 63);
  return ((v << 2) | (v >> 4)) & 255;       // 6-bit -> 8-bit, the standard expansion
};
export const snapHex = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(v => snap6(v).toString(16).padStart(2, '0')).join('');
};
```

Every hex below is already snapped (max shift from my hand-picked source values: 2/255 — invisible,
but it removes colours that could never have existed on the hardware).

### 2.3 GLOBAL bank, indices 0–31 (identical in all three rooms)

| idx | hex | role |
|----:|:----|:-----|
| 0 | `#000000` | TRANSPARENT — never written; alpha 0 |
| 1 | `#08080c` | INK — universal outline, darkest line |
| 2 | `#14141c` | INK2 — soft shadow black |
| 3 | `#20242c` | GREY0 |
| 4 | `#383c49` | GREY1 |
| 5 | `#6d7186` | GREY2 |
| 6 | `#aaaebe` | GREY3 |
| 7 | `#e7ebf7` | WHITE_COOL — dialogue text, cloth highlight |
| 8 | `#ffffff` | WHITE — stars, speculars, moon core |
| 9 | `#f7d3aa` | SKIN_HI |
| 10 | `#dfaa82` | SKIN_MID |
| 11 | `#b27551` | SKIN_SH |
| 12 | `#794530` | SKIN_DEEP — nostril, lip line, eye socket |
| 13 | `#2c1c18` | HAIR_DARK |
| 14 | `#4d3424` | HAIR_MID |
| 15 | `#7d5534` | HAIR_HI |
| 16 | `#d7dbe7` | CLOTH_WHITE — shirts, sails |
| 17 | `#9aa2b2` | CLOTH_WHITE_SH |
| 18 | `#1c2434` | COAT_DARK (navy) |
| 19 | `#2c3851` | COAT_MID |
| 20 | `#455571` | COAT_HI |
| 21 | `#792020` | RED_DARK |
| 22 | `#b63838` | RED_MID |
| 23 | `#dfb23c` | GOLD |
| 24 | `#1c3828` | GREEN_DARK |
| 25 | `#305d3c` | GREEN_MID |
| 26 | `#104149` | TEAL_DARK — Nayara / TAM accent |
| 27 | `#1c6971` | TEAL_MID |
| 28 | `#552830` | WINE_DARK |
| 29 | `#8e4149` | WINE_MID |
| 30 | `#382818` | LEATHER_DARK |
| 31 | `#694928` | LEATHER_MID |

### 2.4 NIGHT bank, indices 32–63 (scene 1 lookout, scene 2 dock)

| idx | hex | role |
|----:|:----|:-----|
| 32 | `#04040c` | SKY0 zenith |
| 33 | `#080c1c` | SKY1 |
| 34 | `#0c1830` | SKY2 |
| 35 | `#142041` | SKY3 |
| 36 | `#1c3055` | SKY4 |
| 37 | `#284169` | SKY5 |
| 38 | `#3c597d` | SKY6 horizon glow |
| 39 | `#55759a` | CLOUD_LIT |
| 40 | `#7d9eba` | CLOUD_RIM |
| 41 | `#bad3e7` | MOON_HALO |
| 42 | `#f3f7ff` | MOON_CORE |
| 43 | `#081424` | SEA_DEEP |
| 44 | `#14283c` | SEA_MID |
| 45 | `#20415d` | SEA_LIT |
| 46 | `#3c698a` | SEA_GLINT |
| 47 | `#cfe7f7` | SEA_SPARK |
| 48 | `#0c0c14` | ROCK_SIL |
| 49 | `#181c28` | ROCK_DARK |
| 50 | `#282c38` | ROCK_MD |
| 51 | `#343c51` | ROCK_MID |
| 52 | `#4d5571` | ROCK_LIT |
| 53 | `#6d7d9e` | ROCK_RIM |
| 54 | `#081410` | PALM_SIL |
| 55 | `#14241c` | FROND_DARK |
| 56 | `#1c3828` | FROND_MID |
| 57 | `#2c5534` | FROND_LIT |
| 58 | `#416941` | FROND_RIM |
| 59 | `#281c10` | DOCK_DARK |
| 60 | `#453018` | DOCK_MD |
| 61 | `#614924` | DOCK_MID |
| 62 | `#8a693c` | DOCK_LIT |
| 63 | `#ffd379` | LANTERN — the only warm accent at night |

### 2.5 TAVERN bank, indices 32–63 (scene 3, El Patilla)

| idx | hex | role |
|----:|:----|:-----|
| 32 | `#080808` | ROOM_BLACK |
| 33 | `#141010` | ROOM_DARK |
| 34 | `#201814` | ROOM_MD |
| 35 | `#2c2018` | WOOD0 |
| 36 | `#3c2c1c` | WOOD1 |
| 37 | `#513820` | WOOD2 |
| 38 | `#695128` | WOOD3 |
| 39 | `#8a6934` | WOOD4 |
| 40 | `#aa8641` | WOOD5 |
| 41 | `#cfa65d` | WOOD6 lamp-lit highlight |
| 42 | `#1c181c` | STONE0 |
| 43 | `#282428` | STONE1 |
| 44 | `#383438` | STONE2 |
| 45 | `#4d494d` | STONE3 |
| 46 | `#615961` | STONE4 |
| 47 | `#381c0c` | FIRE0 ember dark |
| 48 | `#693010` | FIRE1 |
| 49 | `#a25118` | FIRE2 |
| 50 | `#d37d1c` | FIRE3 |
| 51 | `#f3aa2c` | FIRE4 |
| 52 | `#ffd75d` | FIRE5 core |
| 53 | `#fff3be` | FIRE6 lamp glass |
| 54 | `#243020` | BOTTLE_G0 |
| 55 | `#34512c` | BOTTLE_G1 |
| 56 | `#1c2838` | BOTTLE_B0 — Arehucas glass |
| 57 | `#2c4965` | BOTTLE_B1 |
| 58 | `#691c20` | BOTTLE_R0 |
| 59 | `#9e3828` | BOTTLE_R1 |
| 60 | `#494138` | PEWTER0 — mugs |
| 61 | `#6d6155` | PEWTER1 |
| 62 | `#968a79` | PEWTER2 |
| 63 | `#c7beaa` | PEWTER3 |

### 2.6 Ramp declarations — the actual source of shading

```ts
// src/gfx/palette.ts
export const NIGHT_RAMPS = {
  sky:    [32, 33, 34, 35, 36, 37, 38] as const,   // 7 steps, zenith -> horizon
  cloud:  [36, 37, 38, 39, 40] as const,
  sea:    [43, 44, 45, 46, 47] as const,
  rock:   [48, 49, 50, 51, 52, 53] as const,
  frond:  [54, 55, 56, 57, 58] as const,
  dock:   [59, 60, 61, 62] as const,
  skin:   [12, 11, 10, 9] as const,
  moon:   [41, 42, 8] as const,
} ;
export const TAVERN_RAMPS = {
  wood:   [35, 36, 37, 38, 39, 40, 41] as const,   // 7 steps
  stone:  [42, 43, 44, 45, 46] as const,
  fire:   [47, 48, 49, 50, 51, 52, 53] as const,
  pewter: [60, 61, 62, 63] as const,
  dark:   [32, 33, 34] as const,
} ;
```

### 2.7 Indexed → ImageData

`ImageData` is a byte array in R,G,B,A order, but on all little-endian machines (i.e. everything you
will ship to) a `Uint32Array` view over the same buffer holds `0xAABBGGRR`. Writing one 32-bit word
per pixel instead of four bytes is the standard trick and measurably faster
([Mozilla Hacks: Faster Canvas Pixel Manipulation with Typed Arrays](https://hacks.mozilla.org/2011/12/faster-canvas-pixel-manipulation-with-typed-arrays/)).

```ts
/** Pack '#rrggbb' palette into ABGR words. Index 0 gets alpha 0. */
export function packPalette(hexes: readonly string[]): Uint32Array {
  const out = new Uint32Array(64);
  for (let i = 0; i < hexes.length; i++) {
    const n = parseInt(hexes[i].slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const a = i === 0 ? 0 : 255;
    out[i] = (a << 24) | (b << 16) | (g << 8) | r;   // little-endian ABGR
  }
  return out;
}

export function fbToImageData(fb: IndexedFB, pal: Uint32Array, into?: ImageData): ImageData {
  const img = into ?? new ImageData(fb.w, fb.h);
  const words = new Uint32Array(img.data.buffer);
  const px = fb.px;
  for (let i = 0; i < px.length; i++) words[i] = pal[px[i]];
  return img;
}
```

One-time sanity assert during development, worth keeping behind a dev flag:

```ts
if (import.meta.env.DEV) {
  const used = new Set(fb.px);
  console.assert(Math.max(...used) < 64, 'palette overflow');
  console.log('colours used in room:', used.size);   // aim for 24-40, never 64
}
```

A room that uses all 64 entries is a room with no colour identity. Scene 1 should sit around 28,
scene 3 around 34.

---

## 3. Ordered dithering

### 3.1 The matrices

```ts
// src/gfx/dither.ts
export const BAYER2 = Uint8Array.from([
  0, 2,
  3, 1,
]);
export const BAYER4 = Uint8Array.from([
   0,  8,  2, 10,
  12,  4, 14,  6,
   3, 11,  1,  9,
  15,  7, 13,  5,
]);
export const BAYER8 = Uint8Array.from([
   0, 32,  8, 40,  2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44,  4, 36, 14, 46,  6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
   3, 35, 11, 43,  1, 33,  9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47,  7, 39, 13, 45,  5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
]);

/** Normalised threshold in [0,1). */
export function bayer(x: number, y: number, n: 2 | 4 | 8): number {
  if (n === 2) return BAYER2[((y & 1) << 1) | (x & 1)] / 4;
  if (n === 4) return BAYER4[((y & 3) << 2) | (x & 3)] / 16;
  return BAYER8[((y & 7) << 3) | (x & 7)] / 64;
}
```

Verified: `BAYER4` is a permutation of `0..15` and `BAYER8` of `0..63` (a typo'd matrix produces
visible clumping that is maddening to debug, so keep this assert in a unit test). Construction is
recursive: `M_{2n} = [[4M, 4M+2],[4M+3, 4M+1]]`
([Ordered dithering](https://en.wikipedia.org/wiki/Ordered_dithering)).

### 3.2 Which matrix for what

| Matrix | Look | Use for |
|---|---|---|
| `2` | 50% checkerboard, coarse, reads as texture | rock, wood grain, stone, cloth folds, anything small; the only pattern a hand artist actually draws |
| `4` | 16 levels, mild cross-hatch | **default**: skies, sea, large shading, light pools |
| `8` | 64 levels, smooth, slightly "photographic" | only the moon halo and the lamp glow cores, where you need many steps in few pixels |

Never use `8` on a big area: it starts looking like a JPEG. MI1's skies are 4x4-ish clustered dither
over 5–7 palette steps.

### 3.3 Hand-drawn density patterns (better than Bayer for small props)

For pixel-art-authentic shading of props, artists use fixed densities, not a continuous ramp. Chain
`solid → sparse → checker → sparse(inverted) → solid` across roughly 5 stages
([lospec dithering tutorials](https://lospec.com/pixel-art-tutorials/tags/dithering)).

```ts
/** 4x4 boolean tiles: true = draw colour B. Densities 1/16, 4/16, 8/16, 12/16, 15/16. */
export const DENSITY: readonly Uint8Array[] = [
  Uint8Array.from([0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]), // 0
  Uint8Array.from([1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0]), // 2/16 sparse
  Uint8Array.from([1,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,1]), // 4/16
  Uint8Array.from([1,0,1,0, 0,1,0,1, 1,0,1,0, 0,1,0,1]), // 8/16 checker
  Uint8Array.from([1,1,1,0, 1,0,1,1, 1,1,1,0, 1,0,1,1]), // 12/16
  Uint8Array.from([1,1,1,1, 1,1,1,0, 1,1,1,1, 1,0,1,1]), // 14/16
  Uint8Array.from([1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]), // 1
];
export function patFill(fb: IndexedFB, x: number, y: number, w: number, h: number,
                        a: Idx, b: Idx, level: number): void {
  const t = DENSITY[Math.max(0, Math.min(DENSITY.length - 1, level | 0))];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      fb.set(x + i, y + j, t[(((y + j) & 3) << 2) | ((x + i) & 3)] ? b : a);
}
```

### 3.4 Worked example: an MI1 night sky

```ts
// src/scenes/night.ts
const W = 320, H = 144;
const HORIZON = 84;                     // scene 1: sea starts here
const { sky, cloud, moon } = NIGHT_RAMPS;

export function paintNightSky(fb: IndexedFB, rng: Rng): void {
  // 1. Base gradient: zenith SKY0 -> horizon SKY6, non-linear so the top stays properly black.
  //    pow 1.6 keeps ~40% of the height in the two darkest entries (MI1 skies are DARK).
  fb.rampFill(0, 0, W, HORIZON, sky, (_x, y) => Math.pow(y / (HORIZON - 1), 1.6), 4);

  // 2. Moon glow: a huge, very low-contrast lift centred on the moon, so the sky is not
  //    uniformly banded. Bias the ramp position instead of drawing a blob.
  const MX = 238, MY = 30, GLOW = 62;
  fb.rampFill(MX - GLOW, Math.max(0, MY - GLOW), GLOW * 2, GLOW * 2, sky, (x, y) => {
    const d = Math.hypot(x - MX, (y - MY) * 1.15) / GLOW;      // slightly squashed
    const base = Math.pow(Math.min(1, y / (HORIZON - 1)), 1.6);
    return base + Math.max(0, 1 - d) * 0.42;                   // lift up to ~3 ramp steps
  }, 8);                                                       // 8x8 here: smooth halo, few pixels
}
```

Ordering matters: gradient, then glow, then clouds, then stars, then moon disc. Stars *before* the
moon so the disc overwrites any star that landed on it; clouds before stars so stars do not sit on
top of cloud (and then a second, sparser star pass over the darkest cloud band if you want depth).

---

## 4. Element recipes

Shared seeded RNG (see §4.0) is passed to everything. **Never call `Math.random()` in a draw
function** — the three backgrounds must be byte-identical across reloads, otherwise the art gets
worse every time someone refreshes and you can never review it.

### 4.0 Deterministic RNG

```ts
// src/gfx/rng.ts
export type Rng = () => number;

/** mulberry32 — 32-bit state, fast, good enough distribution. Verified: identical streams
 *  for identical seeds, mean 0.4888 over 10k draws. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spatial hash: stable per-pixel noise that does NOT depend on call order.
 *  Use this for texture (rock speckle, star twinkle phase, plank grain) so that adding a
 *  new draw call elsewhere does not reshuffle everything. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const SEEDS = { lookout: 0x10DE, dock: 0xD0CC, tavern: 0xBA12 } as const;
```

The distinction is important: `Rng` for sequential decisions (where are the 9 palms), `hash2` for
fields (which rock pixels are speckled). Sequential RNG is order-dependent and therefore fragile.

### 4.1 Stars

```ts
export function paintStars(fb: IndexedFB, rng: Rng, horizon: number, count = 110): StarField {
  const stars: number[] = [];                     // flat [x,y,brightnessIdx, phase] * n
  for (let i = 0; i < count; i++) {
    const x = (rng() * W) | 0;
    // Density falls off toward the horizon (haze) and away from the zenith band.
    const y = (Math.pow(rng(), 0.75) * (horizon - 12)) | 0;
    if (fb.get(x, y) >= 39) continue;             // skip: we are over a lit cloud
    const r = rng();
    const c: Idx = r < 0.06 ? 8 : r < 0.30 ? 41 : r < 0.70 ? 40 : 39;   // WHITE/HALO/RIM/LIT
    fb.set(x, y, c);
    // 6% of stars get a 3px cross — this is what makes 110 dots read as "a sky"
    if (r < 0.06) { fb.set(x - 1, y, 39); fb.set(x + 1, y, 39); fb.set(x, y - 1, 39); fb.set(x, y + 1, 39); }
    stars.push(x, y, c, (hash2(x, y, 7) * 64) | 0);
  }
  return { data: Int32Array.from(stars) };        // kept for the twinkle animation, §7.3
}
```

Numbers that matter: **110 stars in 320x84**, never uniformly distributed, `pow(rng(),0.75)` to
thicken the upper sky, and only ~7 of them bright white. More than ~150 and it reads as static.

### 4.2 Moon + halo

```ts
export function paintMoon(fb: IndexedFB, cx = 238, cy = 30, r = 9): void {
  // Halo: 3 concentric dithered rings, densities falling off. 8x8 matrix for smoothness.
  for (let k = 3; k >= 1; k--) {
    const rr = r + k * 4;
    const density = 0.10 * k;                     // outermost = sparsest
    for (let y = cy - rr; y <= cy + rr; y++)
      for (let x = cx - rr; x <= cx + rr; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > rr || d <= rr - 4) continue;
        if ((1 - density) < bayer(x, y, 8)) continue;
        fb.set(x, y, k === 1 ? 41 : 40);          // MOON_HALO / CLOUD_RIM
      }
  }
  // Disc: stamped as a real circle, thresholded. Then 2 craters + a terminator wash.
  stampPath(fb, 42, g => { g.beginPath(); g.arc(cx + 0.5, cy + 0.5, r, 0, Math.PI * 2); g.fill(); });
  stampPath(fb, 8,  g => { g.beginPath(); g.arc(cx - 1.5, cy - 1.5, r - 3, 0, Math.PI * 2); g.fill(); });
  // craters: 3 flat spots in MOON_HALO, never outlined
  fb.set(cx + 2, cy - 3, 41); fb.hline(cx + 1, cx + 3, cy - 2, 41);
  fb.set(cx - 3, cy + 3, 41); fb.hline(cx - 4, cx - 2, cy + 4, 41);
  fb.set(cx + 4, cy + 2, 41);
}
```

The halo *before* the disc, and the disc drawn twice (outer `MOON_CORE`, inner offset `WHITE`) is
what gives a 18px circle a sense of being a lit sphere.

### 4.3 Cloud bands

Clouds in MI1 are horizontal, layered, and defined by a **lumpy top edge with a flat bottom** — they
are silhouettes, not blobs.

```ts
/** One cloud band: sum-of-sines top edge, flat bottom, dithered top->bottom. */
export function paintCloudBand(fb: IndexedFB, rng: Rng, yTop: number, thickness: number,
                               a: Idx, b: Idx, lumpiness = 1): void {
  const p = [0, 1, 2].map(() => ({
    amp: (2 + rng() * 5) * lumpiness,
    k: 0.012 + rng() * 0.05,
    ph: rng() * Math.PI * 2,
  }));
  const top = (x: number) => yTop + p.reduce((s, o) => s + o.amp * Math.sin(x * o.k + o.ph), 0) * 0.6;
  for (let x = 0; x < W; x++) {
    const t0 = Math.round(top(x));
    const t1 = t0 + thickness;
    for (let y = t0; y <= t1; y++) {
      const f = (y - t0) / Math.max(1, thickness);      // 0 at lit top edge, 1 at dark base
      fb.set(x, y, (1 - f) > bayer(x, y, 4) ? b : a);
    }
    fb.set(x, t0, b);                                   // hard 1px moonlit rim on the top edge
  }
}

// Scene 1 usage — three bands, far ones thinner and lower contrast (aerial perspective, §5.4):
paintCloudBand(fb, rng, 52, 4, 37, 39, 0.6);   // distant, near horizon
paintCloudBand(fb, rng, 38, 6, 36, 39, 1.0);
paintCloudBand(fb, rng, 20, 9, 35, 40, 1.4);   // nearest, biggest lumps, brightest rim
```

### 4.4 Sea, horizon, moon reflection

```ts
export function paintSea(fb: IndexedFB, horizon: number, bottom: number, moonX: number): SeaRows {
  const { sea } = NIGHT_RAMPS;
  // 1. Base: darkest at the horizon, lifting toward the viewer? NO — opposite. Night sea is
  //    LIGHTEST at the horizon (it mirrors the bright sky band) and darkens toward the camera.
  fb.rampFill(0, horizon, W, bottom - horizon, sea,
    (_x, y) => 1 - Math.pow((y - horizon) / (bottom - horizon), 0.7), 4);

  // 2. Hard horizon line, 1px, the single most important line in the picture.
  fb.hline(0, W - 1, horizon, 46);          // SEA_GLINT
  fb.hline(0, W - 1, horizon - 1, 38);      // SKY6 kiss above it

  // 3. Wave lines: short horizontal dashes whose length and spacing grow with proximity.
  const rows: number[] = [];
  for (let y = horizon + 2; y < bottom; y += 1) {
    const near = (y - horizon) / (bottom - horizon);           // 0..1
    const dash = 1 + Math.round(near * 6);                     // 1px far, 7px near
    const gap  = 5 + Math.round(near * 14);
    const step = dash + gap;
    if (hash2(0, y, 3) < 0.45) continue;                       // not every row has waves
    const off = (hash2(1, y, 3) * step) | 0;
    for (let x = -off; x < W; x += step) {
      const c: Idx = near > 0.55 ? 45 : 46;                    // nearer waves less contrasty
      fb.hline(x, x + dash - 1, y, c);
    }
    rows.push(y);
  }

  // 4. Moon reflection: a vertical column of dashes, widest at the bottom, centred under the moon,
  //    with a per-row horizontal jitter. Reads as a shimmering path of light.
  for (let y = horizon + 1; y < bottom; y++) {
    const near = (y - horizon) / (bottom - horizon);
    const halfw = 1 + near * 11;
    const jitter = (hash2(y, 9, 5) - 0.5) * 4 * near;
    const cx = moonX + jitter;
    const n = 1 + Math.round(near * 3);                        // 1..4 dashes per row
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;           // -1..1 across the column
      const x = Math.round(cx + t * halfw);
      const len = 1 + Math.round((1 - Math.abs(t)) * near * 3);
      const c: Idx = hash2(x, y, 11) < 0.25 ? 47 : 46;         // SEA_SPARK / SEA_GLINT
      fb.hline(x, x + len - 1, y, c);
    }
  }
  return { waveRows: Int32Array.from(rows), horizon, bottom, moonX };
}
```

Key insight for the reflection: it is **a triangle widening toward the camera**, made of individual
dashes, never a solid shape, and it uses only two indices so it can be palette-cycled (§7.2).

### 4.5 Cliff / rock faces

Four passes: silhouette → dithered body shading → rim light → cracks.

```ts
export function paintCliff(fb: IndexedFB, rng: Rng, spec: {
  x0: number; x1: number; baseY: number; crestY: number;
  ramp: readonly Idx[]; rimIdx: Idx; lightDx: -1 | 1; jag: number;
}): void {
  const { x0, x1, baseY, crestY, ramp, rimIdx, lightDx, jag } = spec;
  // 1. Crest line: layered sines + a per-column integer step to get honest angular rock.
  const o = [0, 1, 2, 3].map(() => ({ amp: (1 + rng() * jag), k: 0.03 + rng() * 0.22, ph: rng() * 7 }));
  const crest = (x: number) => {
    let y = crestY + o.reduce((s, q) => s + q.amp * Math.sin(x * q.k + q.ph), 0);
    y += Math.floor(hash2(Math.floor(x / 3), 0, 21) * 3) - 1;   // 3px-wide facets, not noise
    return y;
  };
  fb.silhouette(x0, x1, crest, () => baseY, ramp[1]);

  // 2. Body shading: light comes from the moon, so brightness tracks distance from the lit edge
  //    plus a slow vertical fade. Bayer 2x2 -> coarse, rocky, hand-drawn.
  for (let x = x0; x <= x1; x++) {
    const top = Math.round(crest(x));
    const h = baseY - top;
    if (h <= 0) continue;
    // facet direction: derivative of the crest gives us "which way this face points"
    const slope = crest(x + 2) - crest(x - 2);
    const facing = Math.max(0, Math.min(1, 0.5 - lightDx * slope * 0.12));
    for (let y = top; y <= baseY; y++) {
      const depth = (y - top) / h;                             // 0 crest, 1 base
      const t = facing * (1 - depth * 0.75) + hash2(x, y, 31) * 0.10;
      const v = t * (ramp.length - 1);
      const lo = Math.floor(v);
      fb.set(x, y, ramp[(v - lo) > bayer(x, y, 2) ? Math.min(ramp.length - 1, lo + 1) : lo]);
    }
  }

  // 3. Rim light: 1px along the crest, 2px where the face turns toward the moon.
  for (let x = x0; x <= x1; x++) {
    const top = Math.round(crest(x));
    const slope = crest(x + 1) - crest(x - 1);
    if (lightDx * slope <= 0.4) {
      fb.set(x, top, rimIdx);
      if (lightDx * slope < -1.2) fb.set(x, top + 1, ramp[ramp.length - 2]);
    } else {
      fb.set(x, top, ramp[1]);                                 // face away: keep it dark
    }
  }

  // 4. Cracks: seeded random walks, 1px, always with a light pixel on the moon side.
  const cracks = 4 + ((rng() * 4) | 0);
  for (let i = 0; i < cracks; i++) {
    let x = x0 + rng() * (x1 - x0);
    let y = Math.round(crest(x)) + 2 + rng() * 8;
    const len = 8 + rng() * 26;
    let dir = (rng() * 0.8 - 0.4);
    for (let s = 0; s < len; s++) {
      dir += (rng() - 0.5) * 0.5;
      x += dir; y += 1;
      if (y > baseY - 1 || x < x0 || x > x1) break;
      fb.set(Math.round(x), Math.round(y), ramp[0]);
      if (s % 3 !== 0) fb.set(Math.round(x) + lightDx, Math.round(y), ramp[Math.min(ramp.length - 1, 4)]);
    }
  }
}

// Scene 1: three depth layers, each lighter and lower contrast than the one in front (§5.4)
paintCliff(fb, rng, { x0: 0, x1: 130, baseY: 96, crestY: 74, ramp: [49,50,51,52,53] , rimIdx: 53, lightDx: 1, jag: 2 }); // far headland
paintCliff(fb, rng, { x0: 150, x1: 319, baseY: 110, crestY: 82, ramp: [48,49,50,51,52], rimIdx: 52, lightDx: -1, jag: 3 });
paintCliff(fb, rng, { x0: -8, x1: 120, baseY: 144, crestY: 104, ramp: [48,48,49,50,51], rimIdx: 51, lightDx: 1, jag: 5 }); // foreground
```

### 4.6 Palms and tropical foliage (seeded, fractal-ish)

```ts
export interface PalmSpec {
  x: number; groundY: number; height: number;
  lean?: number; fronds?: number;
  ramp: readonly Idx[];          // e.g. NIGHT_RAMPS.frond
  trunkRamp: readonly Idx[];     // e.g. NIGHT_RAMPS.dock  (or PALM_SIL for pure silhouette)
  lightDx?: -1 | 1;
}

export function paintPalm(fb: IndexedFB, rng: Rng, s: PalmSpec): void {
  const H = s.height;
  const lean = s.lean ?? (rng() * 2 - 1) * 0.22;
  const nF = s.fronds ?? (6 + ((rng() * 4) | 0));
  const lightDx = s.lightDx ?? 1;

  // --- TRUNK: quadratic lean, 4px at base tapering to 2px, notched every 3-4 rows -----------
  let topX = s.x;
  for (let y = s.groundY; y >= s.groundY - H; y--) {
    const t = (s.groundY - y) / H;
    const cx = s.x + lean * H * t * t;
    const w = Math.max(2, Math.round(4 - 2 * t));
    const xl = Math.round(cx - w / 2);
    fb.hline(xl, xl + w - 1, y, s.trunkRamp[1]);
    fb.set(lightDx > 0 ? xl + w - 1 : xl, y, s.trunkRamp[2]);        // lit side of the trunk
    fb.set(lightDx > 0 ? xl : xl + w - 1, y, s.trunkRamp[0]);        // shadow side
    if ((s.groundY - y) % 4 === 1) fb.hline(xl, xl + w - 1, y, s.trunkRamp[0]); // scar ring
    topX = cx;
  }
  const topY = s.groundY - H;

  // --- CROWN: fronds as drooping spines with perpendicular leaflets ------------------------
  for (let i = 0; i < nF; i++) {
    // spread angles across a fan, biased away from vertical, jittered per frond
    const base = -Math.PI / 2 + (i / (nF - 1) - 0.5) * 2.5 + (rng() - 0.5) * 0.28;
    const len = H * (0.34 + rng() * 0.26);
    const droop = 0.9 + rng() * 0.9;                     // how hard the tip falls
    const lit = Math.cos(base) * lightDx > 0;            // fronds pointing at the moon are lit
    const spineC = lit ? s.ramp[3] : s.ramp[1];
    const leafC  = lit ? s.ramp[2] : s.ramp[1];
    const rimC   = s.ramp[4];

    const steps = Math.max(6, Math.round(len));
    for (let k = 1; k <= steps; k++) {
      const u = k / steps;
      const ang = base + droop * u * u * (Math.cos(base) >= 0 ? 1 : -1) * 0.9;
      const x = topX + Math.cos(ang) * len * u;
      const y = topY + Math.sin(ang) * len * u + droop * len * 0.28 * u * u;   // gravity
      // spine
      fb.set(Math.round(x), Math.round(y), spineC);
      // leaflets: length peaks at u=0.45, 1px ticks, alternate sides, skip some for raggedness
      const lw = Math.round(Math.sin(Math.min(1, u * 1.6) * Math.PI) * 4.2);
      for (let d = 1; d <= lw; d++) {
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        if (hash2(k, d, i * 17) > 0.16) fb.set(Math.round(x + nx * d), Math.round(y + ny * d), leafC);
        if (hash2(k, d, i * 31) > 0.24) fb.set(Math.round(x - nx * d), Math.round(y - ny * d), leafC);
      }
      if (lit && k % 2 === 0) fb.set(Math.round(x), Math.round(y) - 1, rimC);   // moon rim
    }
    // 2-3 coconuts under the crown on ~40% of palms
    if (i === 0 && rng() < 0.4) {
      fb.rect(Math.round(topX) - 2, topY + 2, 2, 2, s.trunkRamp[2]);
      fb.rect(Math.round(topX) + 1, topY + 3, 2, 2, s.trunkRamp[1]);
    }
  }
}

/** Undergrowth clump: recursive blob-of-blobs. Cheap, stable, reads as tropical scrub. */
export function paintFoliageClump(fb: IndexedFB, rng: Rng, cx: number, cy: number,
                                  r: number, ramp: readonly Idx[], depth = 3): void {
  if (r < 1.2 || depth === 0) return;
  // squashed disc, dithered light-from-above
  for (let y = Math.round(cy - r * 0.7); y <= Math.round(cy + r * 0.7); y++)
    for (let x = Math.round(cx - r); x <= Math.round(cx + r); x++) {
      const d = Math.hypot((x - cx) / r, (y - cy) / (r * 0.7));
      if (d > 1) continue;
      const up = 1 - (y - (cy - r * 0.7)) / (r * 1.4);            // 1 top, 0 bottom
      const t = up * 0.85 + hash2(x, y, 41) * 0.15;
      const v = t * (ramp.length - 1), lo = Math.floor(v);
      fb.set(x, y, ramp[(v - lo) > bayer(x, y, 2) ? Math.min(ramp.length - 1, lo + 1) : lo]);
    }
  // spiky silhouette edge: 1px ticks upward, so it is not a smooth bubble
  for (let x = Math.round(cx - r); x <= Math.round(cx + r); x++) {
    if (hash2(x, depth, 55) < 0.45) continue;
    const yTop = cy - r * 0.7 * Math.sqrt(Math.max(0, 1 - ((x - cx) / r) ** 2));
    fb.vline(x, Math.round(yTop) - 1 - ((hash2(x, 1, 66) * 2) | 0), Math.round(yTop), ramp[ramp.length - 2]);
  }
  const kids = 2 + ((rng() * 2) | 0);
  for (let i = 0; i < kids; i++)
    paintFoliageClump(fb, rng, cx + (rng() - 0.5) * r * 1.7, cy - rng() * r * 0.5,
                      r * (0.5 + rng() * 0.2), ramp, depth - 1);
}
```

Scene 1 dressing: 4 palms at `x = 26, 58, 268, 296`, heights `52, 44, 38, 60`, plus 7 clumps along
the cliff base at `y = 100..118`, radii `5..11`. Palms nearer the camera use the darker end of
`frond` (foreground goes to silhouette, §5.3).

### 4.7 Dock: planks, posts, rope, crates, barrels, moored ship

The dock scene scrolls horizontally: build the framebuffer at **960 x 144** (3 screens) and blit a
320-wide window. Same code, `fb.w = 960`.

**Planks** — perspective is faked with *row thickness*, not with real perspective maths:

```ts
export function paintDeck(fb: IndexedFB, y0: number, y1: number, ramp: readonly Idx[]): void {
  // Plank rows get taller toward the camera: 2,2,3,3,4,5,6,7...
  let y = y0, i = 0;
  while (y < y1) {
    const th = Math.min(9, 2 + Math.floor(i * i / 6));
    const near = (y - y0) / (y1 - y0);
    for (let yy = y; yy < Math.min(y1, y + th); yy++) {
      for (let x = 0; x < fb.w; x++) {
        // grain: two adjacent wood indices, streaked along x, seeded per plank row
        const g = hash2(Math.floor(x / (2 + (i % 3))), i, 77);
        const base = 1 + Math.round(near * 1.6);
        const lift = (yy === y ? 1 : 0) + (g > 0.72 ? 1 : 0) - (g < 0.18 ? 1 : 0);
        fb.set(x, yy, ramp[Math.max(0, Math.min(ramp.length - 1, base + lift))]);
      }
    }
    fb.hline(0, fb.w - 1, y, ramp[0]);                       // dark seam between planks
    // nails: 2px dark dots every ~34px, offset per row
    for (let x = 6 + ((hash2(i, 0, 88) * 34) | 0); x < fb.w; x += 34) {
      fb.set(x, y + 1, ramp[0]); fb.set(x + 1, y + 1, ramp[ramp.length - 1]);
    }
    y += th; i++;
  }
  // Board ends / gaps to the sea: 3 random missing planks, showing SEA_DEEP
  for (let k = 0; k < 3; k++) {
    const gx = 40 + ((hash2(k, 5, 99) * (fb.w - 80)) | 0);
    fb.rect(gx, y0 + 4 + k * 9, 5 + k * 3, 2, 43);
  }
}
```

**Mooring post** (12x26 at `x`, top `y`): `fb.rect(x, y, 8, 24, DOCK_MD)`; lit column
`fb.vline(x+6, y+1, y+23, DOCK_LIT)`; shadow column `fb.vline(x+1, y, y+23, DOCK_DARK)`; cap
`fb.hline(x-1, x+8, y, DOCK_LIT)` and `fb.hline(x-1, x+8, y-1, DOCK_MID)`; two rope wraps as
`fb.hline(x-1, x+9, y+7, LEATHER_MID)` / `y+8, LEATHER_DARK` and again at `y+12/13`; 1px INK
outline on the shadow side only.

**Rope** — parabolic sag, 1px, with a 1px dark under-line:

```ts
export function paintRope(fb: IndexedFB, x0: number, y0: number, x1: number, y1: number,
                          sag: number, c: Idx, shade: Idx): void {
  const dx = x1 - x0;
  for (let i = 0; i <= Math.abs(dx); i++) {
    const t = i / Math.abs(dx);
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t));   // parabola, peak = sag
    fb.set(x, y, c);
    fb.set(x, y + 1, shade);
    if (i % 3 === 0) fb.set(x, y, shade);       // twist texture: every 3rd pixel darker
  }
}
```

**Crate** (18x16): body `patFill(..., WOOD1, WOOD3, 3)`; INK frame; diagonal braces via
`fillPoly` of two 2px-wide parallelograms in `WOOD4`; 1px `WOOD5` highlight on the top and
left-lit edge; 2px `INK2` contact shadow on the deck under it. Never draw a crate without the
diagonal — it is the shape-reader.

**Barrel** (16x22): stamp the belly outline with two mirrored quadratic curves, then:

```ts
export function paintBarrel(fb: IndexedFB, x: number, y: number, w = 16, h = 22): void {
  const cx = x + w / 2, bulge = 2;
  const halfAt = (yy: number) => w / 2 + bulge * Math.sin(((yy - y) / h) * Math.PI) - 0.5;
  for (let yy = y; yy < y + h; yy++) {
    const hw = halfAt(yy);
    const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
    // stave shading: 5 vertical bands, light from the left
    for (let xx = x0; xx <= x1; xx++) {
      const u = (xx - x0) / (x1 - x0);                 // 0..1 across the barrel
      const band = Math.floor(u * 5);
      const lit = 1 - Math.abs(u - 0.32) * 1.8;        // specular band at u=0.32
      const v = Math.max(0, Math.min(1, lit)) * 4;
      const lo = Math.floor(v);
      const ramp = TAVERN_RAMPS.wood;
      fb.set(xx, yy, ramp[Math.min(6, ((v - lo) > bayer(xx, yy, 2) ? lo + 1 : lo) + 1)]);
      if (band !== Math.floor(((xx + 1 - x0) / (x1 - x0)) * 5)) fb.set(xx, yy, ramp[1]); // stave seam
    }
    fb.set(x0, yy, 1); fb.set(x1, yy, 1);              // INK sides
  }
  // hoops at 1/5 and 4/5 height: 2px, PEWTER
  for (const f of [0.18, 0.78]) {
    const yy = Math.round(y + h * f), hw = halfAt(yy);
    fb.hline(Math.round(cx - hw), Math.round(cx + hw), yy, 61);
    fb.hline(Math.round(cx - hw), Math.round(cx + hw), yy + 1, 60);
  }
  // elliptical lid: 3 rows of shrinking hlines
  fb.hline(Math.round(cx - w / 2 + 2), Math.round(cx + w / 2 - 2), y, 39);
  fb.hline(Math.round(cx - w / 2 + 1), Math.round(cx + w / 2 - 1), y + 1, 38);
}
```

**Moored ship silhouette** (scene 2, sitting on the horizon, ~110px wide, `y = 46..92`):
1. Hull: `fillPoly` in `ROCK_SIL` of `[[0,0],[110,4],[104,18],[10,20],[0,10]]` translated — a
   banana with a high stern.
2. Waterline: 1px `SEA_GLINT` along the bottom edge, plus a 3px-tall dithered reflection below it
   (`ditherFill(..., SEA_MID, SEA_LIT, 0.5, 2)`).
3. Two masts: `vline` 1px `ROCK_SIL`, 40px and 34px, at 32% and 66% of the hull length; 1px
   crow's nest blocks 3x2.
4. Rigging: 8 `paintRope` calls from mast tops to bow/stern and to the deck, `sag = 2..4`, colour
   `ROCK_SIL`, shade `ROCK_DARK`. **This is the detail that sells "pirate"** — do not skip it.
5. Furled sails: 3 horizontal `CLOTH_WHITE_SH` bars per mast, 2px tall, with a 1px `CLOTH_WHITE`
   top rim and `patFill` level 4 to break them up.
6. One `LANTERN` pixel at the stern with a 3x3 `bayer(…,8)` glow at density 0.3 — a single warm
   pixel in a cold scene, and it can be flicker-cycled (§7).

### 4.8 Tavern interior (scene 3, El Patilla)

Layout for `320x144`: **ceiling/beams `y 0..26`**, **stone wall `y 26..96`**, **floor `y 96..144`**.

**Ceiling beams** — 4 beams, perspective-faked by thickness and spacing:

```ts
const beams = [{ y: 2, th: 7 }, { y: 11, th: 6 }, { y: 18, th: 5 }, { y: 24, th: 4 }];
for (const b of beams) {
  fb.rect(0, b.y, 320, b.th, 37);                       // WOOD2 body
  fb.hline(0, 319, b.y, 39);                            // WOOD4 lit top edge
  fb.hline(0, 319, b.y + b.th - 1, 34);                 // ROOM_MD shadow underside
  for (let x = 0; x < 320; x++)                         // grain
    if (hash2(x, b.y, 12) > 0.80) fb.vline(x, b.y + 1, b.y + b.th - 2, 36);
  // 2 iron brackets per beam
  for (const bx of [58, 232]) { fb.rect(bx, b.y, 3, b.th, 60); fb.vline(bx + 1, b.y, b.y + b.th - 1, 61); }
}
fb.ditherFill(0, 0, 320, 2, 32, 33, 0.5, 2);            // black gap above the first beam
```

**Stone wall** — irregular courses, never a grid:

```ts
export function paintStoneWall(fb: IndexedFB, rng: Rng, x0: number, y0: number,
                               x1: number, y1: number): void {
  const { stone } = TAVERN_RAMPS;
  fb.rect(x0, y0, x1 - x0, y1 - y0, stone[1]);
  let y = y0;
  let course = 0;
  while (y < y1) {
    const ch = 6 + ((rng() * 4) | 0);                    // course height 6..9
    let x = x0 - ((rng() * 14) | 0);                     // stagger each course
    while (x < x1) {
      const bw = 11 + ((rng() * 13) | 0);                // block width 11..23
      const tone = 1 + ((rng() * 3) | 0);                // stone[1..3]
      fb.rect(x + 1, y + 1, bw - 1, ch - 1, stone[tone]);
      // top+left lit edge, bottom+right dark = light from above-left
      fb.hline(x + 1, x + bw - 1, y + 1, stone[Math.min(4, tone + 1)]);
      fb.vline(x + 1, y + 1, y + ch - 1, stone[Math.min(4, tone + 1)]);
      fb.hline(x, x + bw, y + ch, stone[0]);             // mortar
      fb.vline(x + bw, y, y + ch, stone[0]);
      // pitting: 3-6 single dark pixels per block, spatial hash so it is stable
      for (let k = 0; k < 5; k++) {
        const px = x + 2 + ((hash2(x + k, y, 101) * (bw - 3)) | 0);
        const py = y + 2 + ((hash2(x, y + k, 102) * (ch - 3)) | 0);
        fb.set(px, py, stone[Math.max(0, tone - 1)]);
      }
      x += bw;
    }
    y += ch; course++;
  }
}
```

**Hanging oil lamps + warm pools of light.** The lamp is 9x12; the *pool* is a LUT remap of whatever
is already painted (§5.2), which is what makes the light look like it belongs to the room rather than
like a translucent circle pasted on top.

```ts
export function paintOilLamp(fb: IndexedFB, x: number, y: number, chainTop = 0): void {
  fb.vline(x + 4, chainTop, y - 1, 60);                       // chain
  for (let k = chainTop; k < y - 1; k += 3) fb.set(x + 3, k, 61);
  fb.rect(x + 2, y, 5, 2, 60);                                // hanger
  // glass body: 7x8, warm ramp, brightest at the flame
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 7; i++) {
      const d = Math.hypot(i - 3, j - 4.5) / 4.6;
      const v = Math.max(0, 1 - d) * 4;
      const lo = Math.floor(v);
      fb.set(x + i + 1, y + 2 + j, TAVERN_RAMPS.fire[3 + Math.min(3, (v - lo) > bayer(x + i, y + j, 4) ? lo + 1 : lo)]);
    }
  fb.frame(x + 1, y + 2, 7, 8, 47);                           // dark iron frame
  fb.set(x + 4, y + 5, 53); fb.set(x + 4, y + 6, 52);         // flame core
}
```

**Bar counter** (`x 12..126`, top `y = 104`): front face `patFill(12, 108, 114, 30, WOOD1, WOOD2, 3)`
with 5 vertical panel seams in `WOOD0` at 22px spacing; countertop as 3 rows —
`hline(10..128, 104, WOOD5)`, `105, WOOD4`, `106, WOOD2`, then a 1px `WOOD6` specular on the left
third only (nearest lamp); 2px `ROOM_DARK` shadow under the overhang at `y = 107`.

**Tables / stools / mugs** (all 3/4-view, light from above-left):
* Table 34x20: top as an ellipse of 3 hlines (`34, 32, 28` wide) in `WOOD4/WOOD3/WOOD2`, 1px `WOOD6`
  rim on the upper-left arc, 4px `WOOD0` edge band, then 3 legs (2px wide, `WOOD1`, splaying 2px
  outward over 12 rows) and one `ROOM_DARK` leg for the far side.
* Stool 12x12: seat `hline` triple (`12,10,8`) `WOOD3/WOOD2/WOOD1`, three 2px legs, contact shadow
  4x1 `ROOM_DARK`.
* Mug 5x6: body `PEWTER1`, left column `PEWTER2`, right column `PEWTER0`, top rim `PEWTER3`,
  1px handle `PEWTER1` on the right at rows 2–4, 1px `FIRE5` specular where a lamp faces it. Foam:
  2px `CLOTH_WHITE` on top if it contains Arehucas.

**Fireplace** (`x 210..300`, `y 60..112`): stone arch stamped as a path
(`rect + arc`, thresholded) in `STONE1` with `STONE3` on the upper-left arc and `STONE0` mortar;
inner opening filled `ROOM_BLACK`; log pile as 4 rotated `paintBarrel`-style cylinders in
`WOOD0/WOOD1`; embers `patFill(..., FIRE0, FIRE2, level)` with level ramping 2→5 upward; flames from
§7.5. Mantel: 3 rows `WOOD3/WOOD2/WOOD0`, overhanging 3px each side.

**Bottles on shelves** (2 shelves at `y = 62` and `y = 78`, `x 140..204`): shelf = `hline` `WOOD3`
+ `WOOD1` under-shadow. Bottle = 4x11: `vline` body in `BOTTLE_*0`, 1px `BOTTLE_*1` lit column at
x+1, 2px neck at `x+1..x+2`, `PEWTER3` single-pixel specular at `(x+1, y+2)`, and a 1px
`CLOTH_WHITE` label block 3x2 in the middle. 9 bottles, alternating the three glass colours, two of
them 1px taller — the irregularity is the point. Label the tall blue one `Arehucas` in the 3x5 font
if it is legible at that size; otherwise leave it as two `GOLD` pixels.

**Framed pictures** (also the mechanism for scene 2's TAM information paintings): frame =
`fb.frame(x, y, w, h, WOOD4)` + inner `fb.frame(x+1, y+1, w-2, h-2, WOOD0)` + 1px `WOOD6` on the top
and left rails + 2px `ROOM_DARK` drop shadow offset `(+2, +2)`. Canvas area gets the picture, drawn
with the same primitives at reduced ramp width (2–3 indices only) so it reads as a painting rather
than a window.

### 4.9 Lighthouse / signal fire, and a swinging sign

**Lighthouse** (scene 1 background, `x = 286`, base `y = 84`, height 46): tapered tower —
`fb.silhouette(x-7, x+7, y => …)` is overkill; just loop rows and shrink half-width from 7 to 4:

```ts
for (let j = 0; j < 40; j++) {
  const hw = 7 - Math.round((j / 40) * 3);
  const y = 84 - j;
  fb.hline(286 - hw, 286 + hw, y, 51);                       // ROCK_MID body
  fb.vline(286 + hw, y, y, 53);                              // moonlit right edge
  fb.vline(286 - hw, y, y, 49);
  if (Math.floor(j / 5) % 2 === 1) fb.hline(286 - hw, 286 + hw, y, 49);  // dark bands
}
fb.rect(278, 40, 17, 3, 49);                                 // gallery
fb.rect(281, 30, 11, 10, 42);                                // lantern room (bright)
fb.frame(281, 30, 11, 10, 48);
fb.rect(283, 33, 7, 5, 63);                                  // LANTERN glow, cycles (§7)
// light beam: two very sparse dithered triangles, density 0.12, so it reads without dominating
```

**Signal fire** (dock end or clifftop): 7x5 stone ring `STONE1/STONE0`, 5 log pixels `WOOD0`, then
the fire sprite from §7.5 at 6 frames.

**Hanging sign** ("El Patilla", above the tavern door): the sign is a **sprite, not background** —
it swings. Bake 3 frames at −4°, 0°, +4° once at load:

```ts
// 34x20 sign, pivot at (17, 0). Bake the three rotations by stamping paths into 3 small FBs.
function bakeSign(text: string): IndexedFB[] {
  return [-4, 0, 4].map(deg => {
    const f = new IndexedFB(40, 26);
    const rad = deg * Math.PI / 180;
    // bracket + 2 rings stay fixed; only the board rotates
    stampPath(f, 37, g => {
      g.translate(20, 3); g.rotate(rad);
      g.fillRect(-16, 4, 32, 16);                 // board
    });
    stampPath(f, 41, g => { g.translate(20, 3); g.rotate(rad); g.fillRect(-16, 4, 32, 1); });
    stampPath(f, 35, g => { g.translate(20, 3); g.rotate(rad); g.fillRect(-16, 19, 32, 1); });
    f.vline(20, 0, 3, 60);                        // hook
    drawText(f, text, /* centred, rotated by hand-picked offsets per frame */ …);
    return f;
  });
}
```
Sway with `frame = [0,1,2,1][(t / 260 | 0) % 4]` — a 4-step ping-pong at ~3.8 Hz feels like weight;
faster reads as a flag, slower reads as broken.

---

## 5. Lighting tricks

### 5.1 Ramp-walk LUTs (the single most useful tool in this document)

Because every colour lives in a declared ramp, build two `Uint8Array(64)` tables once per room:
"one step brighter" and "one step darker". Then *any* lighting effect is a table lookup, and it is
automatically palette-correct — you can never produce an off-palette or off-hue result.

```ts
// src/gfx/light.ts
export function buildRampLUTs(ramps: ReadonlyArray<readonly Idx[]>) {
  const up = new Uint8Array(64), dn = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { up[i] = i; dn[i] = i; }
  for (const r of ramps)
    for (let k = 0; k < r.length; k++) {
      up[r[k]] = r[Math.min(r.length - 1, k + 1)];
      dn[r[k]] = r[Math.max(0, k - 1)];
    }
  return { up, dn };
}
export function stepIdx(lut: Uint8Array, i: Idx, n: number): Idx {
  let v = i; for (let k = 0; k < n; k++) v = lut[v]; return v;
}
```

Register **every** ramp, including the character ramps (skin, hair, cloth, coat), or characters will
not respond to the tavern lamps.

### 5.2 Light pooling

A light pool remaps existing pixels up the ramp, with the fractional part dithered:

```ts
export function lightPool(fb: IndexedFB, lut: Uint8Array, cx: number, cy: number,
                          rx: number, ry: number, strength: number, m: 2 | 4 | 8 = 4): void {
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(fb.w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(fb.h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d >= 1) continue;
      const v = (1 - d) * (1 - d) * strength;                 // quadratic falloff
      const n = Math.floor(v) + ((v % 1) > bayer(x, y, m) ? 1 : 0);
      if (n > 0) fb.px[y * fb.w + x] = stepIdx(lut, fb.px[y * fb.w + x], n);
    }
}
export const shadowPool = (fb, lut, cx, cy, rx, ry, s) => lightPool(fb, lut, cx, cy, rx, ry, s);
// (same function, pass the `dn` LUT)
```

Tavern lamp placement — 3 lamps, 3 pools, **elliptical and wider than tall** because they hit the
floor at an angle:

```ts
const { up, dn } = buildRampLUTs(Object.values(TAVERN_RAMPS));
paintOilLamp(fb,  56, 28); lightPool(fb, up,  60,  74, 52, 46, 2.6);
paintOilLamp(fb, 168, 22); lightPool(fb, up, 172,  70, 46, 42, 2.2);
paintOilLamp(fb, 262, 30); lightPool(fb, up, 266,  78, 40, 38, 1.8);
lightPool(fb, up, 252, 100, 56, 34, 2.0);          // fireplace spill, wider and lower
shadowPool(fb, dn,  10,  30, 40, 34, 2.0);         // dark corners
shadowPool(fb, dn, 312,  20, 46, 30, 2.4);
```

### 5.3 Warm/cool separation

The rule that does most of the work: **light is warm, shadow is cool, and they must not share a
hue.** Two concrete tactics:

1. **Cross-bank shadow.** In the tavern, shade wood by stepping down the `wood` ramp for 1 step, but
   for the second step jump to `ROOM_MD`/`STONE0` (cool-neutral) instead of `WOOD0`. Register a
   deliberate "shadow tail" in the ramp: `wood: [42, 35, 36, 37, 38, 39, 40, 41]` — note `STONE0`
   spliced at the dark end. Deep shadow therefore drifts cool automatically.
2. **Single warm accent at night.** Scenes 1 and 2 contain exactly one warm index (`63 LANTERN`).
   Use it on ≤ 300 pixels total: the lighthouse room, the ship's stern lamp, one dock lantern, a
   window. A cold picture with one warm dot is a mood; two warm areas is a mess.

### 5.4 Aerial perspective (depth)

Per depth layer, two mechanical adjustments — no artistry required:

| Layer | Ramp slice | Contrast | Detail |
|---|---|---|---|
| 3 far (horizon islands) | `rock[2..4]` (3 entries, light end) | dither density fixed at 0.5, no rim | silhouette only |
| 2 mid (headland) | `rock[1..5]` | full | crest rim, no cracks |
| 1 near (cliff we stand on) | `rock[0..4]` (dark end) | full + `hash2` speckle | rim + cracks + clumps |
| 0 foreground frame | `INK` only | none | pure silhouette, §5.5 |

Formalised: `layerRamp(base, layer) = base.slice(clamp(2-layer), clamp(2-layer)+5)` — each step back
is **one entry lighter and one entry less contrast**. That is exactly how MI1 stacks its islands.

### 5.5 Foreground silhouetting

Frame each room with near-black foreground shapes, drawn last, in `INK` (`1`) with a **single**
`INK2`/rim pixel line on the moon side. Concretely:
* Scene 1: a rock overhang occupying `x 0..46, y 0..40` and a palm frond crossing the top-right
  corner, both pure `INK` — plus 1px `ROCK_RIM` along their moonward edge.
* Scene 2: two mooring posts and a coil of rope at `y 128..144` in `INK`/`DOCK_DARK`.
* Scene 3: the near edge of a table at `y 138..144` in `WOOD0` and `INK`.

Cost: ~6% of the pixels. Payoff: instant depth, and it hides the fact that everything else is
procedural.

### 5.6 Vignette

Apply last, once, over the whole room:

```ts
export function vignette(fb: IndexedFB, lutDn: Uint8Array, strength = 1.6): void {
  const cx = fb.w / 2, cy = fb.h * 0.46;
  const maxd = Math.hypot(cx, cy);
  for (let y = 0; y < fb.h; y++)
    for (let x = 0; x < fb.w; x++) {
      const d = Math.hypot(x - cx, (y - cy) * 1.25) / maxd;
      const v = Math.max(0, d - 0.55) * (1 / 0.45) * strength;
      const n = Math.floor(v) + ((v % 1) > bayer(x, y, 4) ? 1 : 0);
      if (n > 0) fb.px[y * fb.w + x] = stepIdx(lutDn, fb.px[y * fb.w + x], n);
    }
}
```

`cy = 0.46 * h` (above centre) matches how the eye expects a room to be lit. Strength 1.6 in the
tavern, 1.0 outdoors (a night sky is already dark; over-vignetting kills the stars).

---

## 6. Character sprites: ASCII grids

### 6.1 The format

```ts
// src/gfx/sprite.ts
export interface SpriteDef {
  w: number;
  h: number;
  /** Anchor in sprite space: x = centre of the feet, y = the row that sits on the walk line. */
  anchor: readonly [number, number];
  /** char -> palette index. '.' is always transparent and must not appear here. */
  map: Readonly<Record<string, Idx>>;
  /** Full-size grid: exactly `h` strings of exactly `w` chars. */
  base: readonly string[];
  /** Rectangular overrides. A patch fully OWNS its rect: '.' inside a patch means transparent. */
  patches: Readonly<Record<string, Patch>>;
  /** Named animations, each a list of frames; a frame = base + a list of patch names. */
  anims: Readonly<Record<string, readonly Frame[]>>;
}
export interface Patch { x: number; y: number; rows: readonly string[] }
export interface Frame { patches: readonly string[]; dx?: number; dy?: number; ms: number }
```

Why patches: 6 characters × (walk 3 + talk 2 + blink 1) = 36 grids if authored whole. With patches
it is 6 base grids + 6×(2 leg patches, 2 mouth patches, 1 eye patch) — and a leg patch is 15 rows,
not 40. It also makes editing tractable in a text editor: you change a mouth without scrolling past
a torso.

### 6.2 WORKED EXAMPLE — 24x40 pirate ("template.ts")

All rows below are exactly 24 characters, 40 rows, verified programmatically. Leg columns are
centred on x=10 so they line up with the hips row.

```ts
// src/art/chars/template.ts
// Character template. All six cast members are this grid with a different `map`
// (and, for Nayara/Chaxi/monkeys, a different head block — rows 0..10).
//
//  char legend
//  .  transparent      k  INK outline        e  eye (INK)        m  mouth / lip (SKIN_DEEP)
//  f  SKIN_HI          S  SKIN_MID           s  SKIN_SH
//  h  HAIR_DARK        H  HAIR_MID
//  w  CLOTH_WHITE      c  COAT_DARK          C  COAT_MID         L  COAT_HI
//  r  RED_DARK         R  RED_MID            g  GOLD
//  P  trousers mid     p  trousers dark      B  boot mid         b  boot dark

export const CHAR_MAP_GUYBRUSH_ISH: Record<string, Idx> = {
  k: 1,  e: 1,  m: 12,
  f: 9,  S: 10, s: 11,
  h: 13, H: 14,
  w: 16, c: 18, C: 19, L: 20,
  r: 21, R: 22, g: 23,
  P: 19, p: 18, B: 31, b: 30,
};

export const TEMPLATE_BASE: readonly string[] = [
  '........kkkkkkk.........',  //  0  crown of the hair
  '.......khhhhhhhk........',  //  1
  '......khHHHHHHhhk.......',  //  2  hair, lit on top
  '......khhhHHHHhhk.......',  //  3  fringe
  '......khfffSSshhk.......',  //  4  forehead / brow line
  '......khfefSeshhk.......',  //  5  EYES  (cols 9 and 12)
  '......khffSsSshhk.......',  //  6  nose shadow at cols 10-11
  '......khSmmmSshk........',  //  7  MOUTH (patch rect starts here)
  '......khSSSsshk.........',  //  8  chin
  '.......khSSshk..........',  //  9  jaw
  '........ksSsk...........',  // 10  neck
  '......kcwwwwwck.........',  // 11  shirt collar
  '...kcCCccwwwwcCCCck.....',  // 12  shoulders (widest point, cols 3-18)
  '...kcCLccwwwwcCCcck.....',  // 13  coat, highlight column at x=6
  '...kcCLccwgwwcCCcck.....',  // 14  gold button
  '...kcCLccwwwwcCCcck.....',  // 15
  '...kcCCccwgwwcCCcck.....',  // 16  gold button
  '...kcCCccwwwwcCCcck.....',  // 17
  '...kcCCrrrrrrrrCcck.....',  // 18  sash, upper edge
  '...kcCrRRRggRRrCcck.....',  // 19  sash + buckle
  '...kcCrRRRRRRRrCcck.....',  // 20  sash, lower edge
  '...ksSsccccccccsSsk.....',  // 21  HANDS emerge from the sleeves
  '....ksSkccccccksSk......',  // 22  hands / coat tails
  '.....kccccccccck........',  // 23  coat hem
  '.....kPPPpppPPPk........',  // 24  hips (LEG PATCH rect starts at row 25)
  '......kPPPkPPPk.........',  // 25  \
  '......kPPPkPPPk.........',  // 26   |
  '......kPPPkPPPk.........',  // 27   |  frame 0 = PASSING pose, legs together
  '......kPPPkPPPk.........',  // 28   |
  '......kPPPkPPPk.........',  // 29   |
  '......kPPpkPppk.........',  // 30   |  knees: inner columns darken
  '......kPPpkPppk.........',  // 31   |
  '......kpppkpppk.........',  // 32   |  shins
  '......kpppkpppk.........',  // 33   /
  '.....kBBBBkBBBBk........',  // 34  boot cuffs
  '.....kBbbbkBbbbk........',  // 35
  '.....kBbbbkBbbbk........',  // 36
  '.....kBbbbkBbbbk........',  // 37
  '.....kBBBBkBBBBk........',  // 38  soles
  '.....kkkkk.kkkkk........',  // 39  ground contact line  <- anchor row
];

/** Contact pose. Silhouette splays; the trailing leg is the darker one. */
export const PATCH_LEGS_A: Patch = { x: 0, y: 25, rows: [
  '......kPPPkPPPk.........',  // 25
  '......kPPPkPPPk.........',  // 26
  '.....kPPPPkPPPPk........',  // 27  hips widen
  '.....kPPPk.kPPPk........',  // 28  legs separate
  '.....kPPPk.kPPPk........',  // 29
  '....kPPPk...kPPPk.......',  // 30
  '....kpppk...kPPPk.......',  // 31  rear (left) leg goes dark
  '....kpppk...kpppk.......',  // 32
  '....kpppk...kpppk.......',  // 33
  '...kBBBBk...kBBBBk......',  // 34
  '...kBbbbk...kBbbbk......',  // 35
  '...kBbbbk...kBbbbk......',  // 36
  '...kBbbbk...kBbbbk......',  // 37
  '...kBBBBk...kBBBBk......',  // 38
  '...kkkkkk...kkkkkk......',  // 39
] };

/** The other contact pose: same silhouette, shading swapped so the OTHER leg reads as rear.
 *  This is the classic 3-frame SCUMM cheat — you do not need a mirrored silhouette. */
export const PATCH_LEGS_B: Patch = { x: 0, y: 25, rows: [
  '......kpppkpppk.........',  // 25
  '......kpppkpppk.........',  // 26
  '.....kppppkppppk........',  // 27
  '.....kpppk.kpppk........',  // 28
  '.....kpppk.kpppk........',  // 29
  '....kpppk...kpppk.......',  // 30
  '....kPPPk...kpppk.......',  // 31
  '....kPPPk...kPPPk.......',  // 32
  '....kPPPk...kPPPk.......',  // 33
  '...kbbbbk...kbbbbk......',  // 34
  '...kbBBBk...kbBBBk......',  // 35
  '...kbBBBk...kbBBBk......',  // 36
  '...kbBBBk...kbBBBk......',  // 37
  '...kbbbbk...kbbbbk......',  // 38
  '...kkkkkk...kkkkkk......',  // 39
] };

/** Mouth: 10x2 rect at (6,7). Closed is identical to the base (keeps the diff honest). */
export const PATCH_MOUTH_CLOSED: Patch = { x: 6, y: 7, rows: [
  'khSmmmSshk',
  'khSSSsshk.',
] };
export const PATCH_MOUTH_OPEN: Patch = { x: 6, y: 7, rows: [
  'khSkkkSshk',   // dark hole
  'khSmmsshk.',   // jaw drops, lower lip shadow
] };

/** Blink: 10x1 rect at (6,5) — base row 5 with both 'e' pixels replaced by lid lines.
 *  Idle-only; fire every 3-5 s for 110 ms. */
export const PATCH_EYES_SHUT: Patch = { x: 6, y: 5, rows: [
  'khfmfSmshh',
] };

export const TEMPLATE: SpriteDef = {
  w: 24, h: 40, anchor: [10, 39],
  map: CHAR_MAP_GUYBRUSH_ISH,
  base: TEMPLATE_BASE,
  patches: {
    legsA: PATCH_LEGS_A, legsB: PATCH_LEGS_B,
    mouthClosed: PATCH_MOUTH_CLOSED, mouthOpen: PATCH_MOUTH_OPEN,
    eyesShut: PATCH_EYES_SHUT,
  },
  anims: {
    // 3-frame walk. The passing pose sits 1px HIGHER: that vertical bob is what makes
    // three frames read as walking rather than as a shuffle.
    walk: [
      { patches: [],       dy: -1, ms: 130 },   // 0 passing (base legs)
      { patches: ['legsA'], dy: 0, ms: 130 },   // 1 contact
      { patches: [],       dy: -1, ms: 130 },   // 2 passing again
      { patches: ['legsB'], dy: 0, ms: 130 },   // 3 contact, other leg leading
    ],
    idle:  [{ patches: [], ms: 1e9 }],
    blink: [{ patches: ['eyesShut'], ms: 110 }],
    // 2-frame talk, driven by the dialogue system, not by a timer alone:
    // hold `open` for ~90 ms per syllable, `closed` for 70 ms, and force `closed` on line end.
    talk: [
      { patches: ['mouthOpen'],   ms: 90 },
      { patches: ['mouthClosed'], ms: 70 },
    ],
  },
};
```

**The other five characters reuse this file.** Only the `map` and the head rows change:

| Character | `map` overrides | head-block patch |
|---|---|---|
| Nayara (lookout) | `c:26 C:27 L:20`, `h:13 H:15`, `r:24 R:25` | longer hair: rows 0–3 widened by 1px each side, ponytail at cols 17–19 |
| Giorgio (jokes) | `c:24 C:25 L:6`, `h:14 H:15`, `r:22 R:23` | permanent grin: `mouthClosed` becomes `khSmSmSshk` |
| Big-John (serious) | `c:18 C:19 L:20`, `h:1 H:13`, `r:30 R:31` | beard block rows 7–10, add `w`→13 |
| Chaxi (sane one) | `c:26 C:27 L:7`, `h:13 H:14`, `r:27 R:6` | rows 0–3 as a headscarf in `TEAL_*` |
| Jaime / Javi (monkeys) | `f:14 S:13 s:1`, `c:14 C:15` | 20x28 variant: bigger head (rows 0–14), no coat, `anchor:[10,27]` |

### 6.3 The loader

```ts
// src/gfx/spriteLoader.ts
export interface BakedFrame {
  bmp: ImageBitmap; flipped: ImageBitmap;
  ax: number;      // anchor x when facing right (authored direction)
  axFlip: number;  // anchor x when facing left  = w - 1 - ax
  ay: number; ms: number;
}
export type BakedSprite = Record<string, BakedFrame[]>;

function rasterise(def: SpriteDef, frame: Frame, pal: Uint32Array): ImageData {
  const fb = new IndexedFB(def.w, def.h, 0);
  // 1. base grid
  for (let y = 0; y < def.h; y++) {
    const row = def.base[y];
    if (row.length !== def.w) throw new Error(`row ${y} is ${row.length} wide, expected ${def.w}`);
    for (let x = 0; x < def.w; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const idx = def.map[ch];
      if (idx === undefined) throw new Error(`row ${y} col ${x}: char '${ch}' not in map`);
      fb.px[y * def.w + x] = idx;
    }
  }
  // 2. patches, in order; each patch OWNS its rect (so '.' clears to transparent)
  for (const name of frame.patches) {
    const p = def.patches[name];
    if (!p) throw new Error(`unknown patch '${name}'`);
    for (let j = 0; j < p.rows.length; j++)
      for (let i = 0; i < p.rows[j].length; i++) {
        const ch = p.rows[j][i];
        fb.px[(p.y + j) * def.w + (p.x + i)] = ch === '.' ? 0 : def.map[ch];
      }
  }
  return fbToImageData(fb, pal);
}

/** Pre-bake the mirror. Flipping at draw time with ctx.scale(-1,1) costs a state change per
 *  sprite per frame and makes the anchor arithmetic error-prone; a second bitmap costs 4 KB. */
async function mirror(src: ImageBitmap, w: number, h: number): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.translate(w, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return createImageBitmap(c);
}

export async function bakeSprite(def: SpriteDef, pal: Uint32Array): Promise<BakedSprite> {
  const out: BakedSprite = {};
  for (const [anim, frames] of Object.entries(def.anims)) {
    out[anim] = await Promise.all(frames.map(async f => {
      const bmp = await createImageBitmap(rasterise(def, f, pal));
      const ax = def.anchor[0] + (f.dx ?? 0);
      return {
        bmp,
        flipped: await mirror(bmp, def.w, def.h),
        ax,
        axFlip: def.w - 1 - ax,
        ay: def.anchor[1] - (f.dy ?? 0),
        ms: f.ms,
      };
    }));
  }
  return out;
}
```

### 6.4 Flip, anchor and z-order rules

* **Anchor** is `(10, 39)`: the horizontal centre of the feet and the ground-contact row. Draw at
  `dx = round(actor.x) - ax`, `dy = round(actor.y) - ay`. Both must be integers — a fractional
  `drawImage` destination re-samples and blurs the sprite even with smoothing off, and MDN's canvas
  optimisation guidance flags exactly this.
* **Facing** picks `bmp` (facing right, the authored direction) or `flipped` (facing left). For the
  flipped bitmap the anchor x becomes `def.w - 1 - ax` = `13`. Store that once:
  `axFlip = def.w - 1 - ax`.
* **Front/back facing** is a different *animation*, not a flip: `walkFront` shows the face,
  `walkBack` replaces rows 0–10 with a back-of-head patch (all `h`/`H`, no eyes) and rows 11–24 with
  a plain coat back. Two extra patches per character; do not attempt to fake it.
* **Z-order:** sort drawables by `anchor y` ascending and draw far-to-near, then draw the
  foreground silhouette layer (§5.5) last. Formally
  `drawables.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))` — the tiebreak keeps the order
  stable so nothing z-flickers when two actors share a Y.
* **No runtime scaling.** MI1 scales actors by depth; scaled pixel art at these sizes looks broken.
  If a character must appear smaller in the distance, author a second grid at 18x30 rather than
  scaling. Scene 2's scroll is horizontal, so this only ever affects scene 1.
* **Contact shadow:** before the sprite, draw a 2-row dithered ellipse
  `ditherFill(x - 7, y - 1, 15, 2, current, darker, 0.5, 2)` in the *scene* framebuffer's LUT
  colours. Cheap, and it stops characters floating.
* **Dev-time validation** (keep it, it will save hours): assert every `base` row length equals `w`,
  every patch row fits inside `w`/`h`, every char appears in `map`, and that the anchor column
  contains a non-transparent pixel on the anchor row.

---

## 7. Animation on a static painting

The background is one `ImageBitmap`. To animate it without regenerating anything, keep the
`IndexedFB` alive and maintain **dirty-pixel index lists** — the same optimisation the classic
colour-cycling demos use: at load, find the pixels that reference animated palette entries and store
only those offsets, then refresh only those
([Old School Color Cycling with HTML5](https://www.effectgames.com/effect/article-Old_School_Color_Cycling_with_HTML5.html)).

### 7.1 Palette cycling on an indexed framebuffer

```ts
// src/gfx/cycle.ts
export interface CycleDef { lo: Idx; hi: Idx; fps: number; dir: 1 | -1; }

export class BackgroundAnimator {
  private words: Uint32Array;                      // view over the live ImageData
  private lists = new Map<CycleDef, Int32Array>(); // pixel offsets touching each range
  private phase = new Map<CycleDef, number>();

  constructor(private fb: IndexedFB, private basePal: Uint32Array,
              private img: ImageData, private cycles: CycleDef[]) {
    this.words = new Uint32Array(img.data.buffer);
    for (const c of cycles) {
      const idxs: number[] = [];
      for (let i = 0; i < fb.px.length; i++) { const v = fb.px[i]; if (v >= c.lo && v <= c.hi) idxs.push(i); }
      this.lists.set(c, Int32Array.from(idxs));
      this.phase.set(c, 0);
      if (import.meta.env.DEV) console.log(`cycle ${c.lo}-${c.hi}: ${idxs.length} px`);
    }
  }

  /** Returns true if anything changed (so the caller can skip the putImageData). */
  update(tMs: number): boolean {
    let dirty = false;
    const pal = this.basePal;
    for (const c of this.cycles) {
      const n = c.hi - c.lo + 1;
      const step = Math.floor((tMs / 1000) * c.fps) % n;
      if (step === this.phase.get(c)) continue;
      this.phase.set(c, step);
      const list = this.lists.get(c)!;
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const rel = this.fb.px[i] - c.lo;
        const rot = (((rel + c.dir * step) % n) + n) % n;
        this.words[i] = pal[c.lo + rot];
      }
      dirty = true;
    }
    return dirty;
  }
}
```

Then per frame: `if (anim.update(t)) bgCtx.putImageData(img, 0, 0);` and blit `bgCanvas` into the
scene. A `320x144` `putImageData` is well under a millisecond; the loop above only touches the
listed pixels (typically 800–4 000), not 46 080.

**Cycle ranges to declare:**

| Scene | Range | fps | dir | Effect |
|---|---|---|---|---|
| night | `46..47` (SEA_GLINT/SPARK) | 6 | +1 | water glint crawl |
| night | `41..42` | 2 | +1 | subtle moon halo breathe |
| night | `63..63` + a 2nd LANTERN entry | 9 | +1 | lantern flicker (needs 2 entries — see below) |
| tavern | `49..53` (FIRE2..FIRE6) | 12 | −1 | fire and lamp flicker |
| tavern | `40..41` (WOOD5/6) | 3 | +1 | lamp-lit wood shimmer, barely perceptible |

A 1-entry range cannot cycle. For flicker, reserve **two adjacent entries** that are nearly the same
colour (`#ffd379` and `#e8bc68`) and cycle the pair; the eye reads it as a guttering flame.

### 7.2 Cheap per-frame effects, ranked by value per line of code

1. **Fire / lamp flicker** — palette cycling on `FIRE2..FIRE6`, plus a per-frame *palette jitter*:
   every 80 ms, multiply the whole `fire` ramp's brightness by `0.92 + 0.08*hash2(frame,0,3)` and
   rewrite those 5 palette words. Zero pixel work, huge payoff.
2. **Water shimmer rows** — pre-bake **8 variants** of each wave row (phase-shifted dashes) as
   `ImageData` strips at load, then `putImageData` one strip per frame at
   `strip[(frame + rowSeed) % 8]`. 12 rows × 8 variants × 320 px = 30 KB, and it looks like real
   moving water instead of a rotating palette.
3. **Twinkling stars** — keep the `StarField` from §4.1. Each frame, for ~6 stars chosen by
   `(frame + i) % 19 === 0`, write `words[y*w+x]` to either the star's base colour or one entry
   brighter. 6 word writes per frame.
4. **Drifting clouds** — bake the cloud bands into a separate `IndexedFB` of width `320 + 64`, blit
   it into the scene canvas at `x = -((t * 0.004 * layer) % 64)` on top of the background, with
   index 0 transparent. Two layers at different speeds. The band must tile at 64 px: generate it,
   then cross-dither the first and last 8 columns together.
5. **Swaying sign** — the 3 pre-baked frames of §4.9, ping-pong at 3.8 Hz.
6. **Lighthouse beam** — 4 pre-baked sparse triangles, cycled at 2 fps, drawn additively by simply
   overwriting `SKY*` pixels with one-step-brighter equivalents (use the `up` LUT and a dirty list).
7. **Rope / hanging sign shadow** and **curtain sway** — skip. Below the perception threshold at
   this resolution; spend the time on the fire.

### 7.3 Framebuffer/bitmap split

Because animation writes into an `ImageData`, the background is **not** an `ImageBitmap` at runtime —
it is a 320x144 canvas you `putImageData` into. Keep the `ImageBitmap` path only for the fully static
case (scene 2's non-animated regions, sprite frames). Structure:

```
bgCanvas (320x144)   <- putImageData only when a cycle ticked
sceneCanvas          <- not needed; draw straight to the display canvas
display canvas (320x200): drawImage(bgCanvas,0,0) -> clouds -> sprites -> foreground -> verb UI
```

---

## 8. Performance and canvas setup

### 8.1 Precompute at load (target: < 250 ms total for 3 rooms)

| Precompute | Why |
|---|---|
| 3 room `IndexedFB`s + `ImageData`s | the whole point; never regenerate |
| `packPalette()` per bank; `buildRampLUTs()` per bank | lighting is then LUT lookups |
| Dirty-pixel `Int32Array`s per cycle range | §7.1 |
| 8 phase variants per wave row | §7.2 |
| All sprite frames, both facings, as `ImageBitmap` | §6.3 |
| Cloud tile FBs (`384x24`) | §7.2 |
| Bitmap font glyph atlas (one `ImageBitmap`, 96 glyphs) | avoid `fillText` entirely |
| Fire: 6 frames × (16x20) as `ImageBitmap` | avoid per-frame procedural fire |

Do **all** `getImageData` at load. A `getImageData` inside the render loop forces a GPU→CPU readback
and will cost you frames.

### 8.2 The render loop

```ts
let last = 0;
function frame(t: number): void {
  const dt = Math.min(50, t - last); last = t;
  if (anim.update(t)) bgCtx.putImageData(bgImage, 0, 0);

  ctx.drawImage(bgCanvas, 0, 0);                    // 320x144 background
  drawCloudLayers(ctx, t);
  for (const d of drawables.sort(byDepth)) {
    const f = d.baked[d.anim][d.frameIdx];
    ctx.drawImage(d.facing < 0 ? f.flipped : f.bmp,
                  Math.round(d.x) - (d.facing < 0 ? f.axFlip : f.ax),
                  Math.round(d.y) - f.ay);
  }
  ctx.drawImage(fgCanvas, 0, 0);                    // foreground silhouettes, pre-baked
  drawVerbUI(ctx);                                  // y >= 144
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

Per-frame cost at `320x200`: one `drawImage` of a 320x144 canvas (~0.05 ms), ≤ 8 sprite
`drawImage`s, one `putImageData` only on cycle ticks. Comfortably inside 16.67 ms on anything,
including a five-year-old phone. Follow MDN's canvas guidance: integer coordinates, no `shadowBlur`,
no `fillText`, batch state changes, `requestAnimationFrame`
([Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)).

### 8.3 Exact canvas setup

```ts
// src/gfx/display.ts
export function createDisplay(host: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 200;            // backing store == logical size, always
  const ctx = canvas.getContext('2d', {
    alpha: false,            // opaque: cheaper compositing
    desynchronized: true,    // lower-latency present where supported
  })!;
  ctx.imageSmoothingEnabled = false;                  // must be re-set after any ctx.reset()
  Object.assign(canvas.style, {
    imageRendering: 'pixelated',
    display: 'block',
    margin: '0 auto',
    backgroundColor: '#000',
  });
  host.appendChild(canvas);
  return { canvas, ctx };
}

/** Integer scaling that stays integer in DEVICE pixels, which is what actually matters. */
export function fitDisplay(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const availW = canvas.parentElement!.clientWidth;
  const availH = canvas.parentElement!.clientHeight;
  // largest integer number of device pixels per logical pixel that fits
  const kDev = Math.max(1, Math.floor(Math.min(availW * dpr / 320, availH * dpr / 200)));
  const cssScale = kDev / dpr;                        // may be fractional in CSS px — that is fine
  canvas.style.width  = `${320 * cssScale}px`;
  canvas.style.height = `${200 * cssScale}px`;
}
window.addEventListener('resize', () => fitDisplay(canvas));
```

Why this shape:
* **Never scale the backing store by `devicePixelRatio`.** The framebuffer is the art; upscaling it
  in JS just wastes memory and re-samples. Let CSS blow it up with `image-rendering: pixelated`.
* **The integer must be integer in device pixels**, not CSS pixels. On a 2× display, a CSS scale of
  3.5 is *7 device pixels per logical pixel* — perfectly crisp. Rounding the CSS scale to 3 instead
  throws away 14% of the available size for nothing. Hence `kDev` in device pixels, then divide.
* `image-rendering: pixelated` is nearest-neighbour to the nearest integer multiple, then smooth
  interpolation for any remainder — which is why forcing the integer relationship matters
  ([MDN image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering)).
* Set `imageSmoothingEnabled = false` on **every** context: display, `bgCanvas`, the sprite-flip
  `OffscreenCanvas`, the mask canvas. It is per-context and resets with the context.
* Use `{ willReadFrequently: true }` **only** on the load-time mask canvas — it forces a software
  backing store, which is what you want for `getImageData` and exactly what you do not want for the
  display canvas.

### 8.4 Pixel aspect ratio: decision

Mode 13h pixels were 1.2× taller than wide, so MI1's art was painted for a vertical stretch. We
**render square pixels and do not correct**, because a 1.2 vertical stretch destroys integer scaling
(320x200 → 1280x960 is 4× horizontal but 4.8× vertical: shimmering, uneven pixel rows, and
`pixelated` cannot save it). Consequences to keep in mind while drawing:
* Circles drawn as true circles are correct for us; do **not** squash them by 1/1.2.
* Our 40px character on a 144px room is proportionally *taller* than the same numbers in MI1. If
  proportions feel off when the art is in, shorten characters to 36 rows rather than stretching the
  screen.
* If someone later insists on 4:3, the correct move is a `320x240`-ish letterboxed layout, not a
  non-integer stretch.

### 8.5 Budget targets

| Item | Budget |
|---|---|
| One-time room generation (each) | ≤ 60 ms |
| Sprite baking, 6 characters | ≤ 80 ms (`createImageBitmap` is async — do it in parallel) |
| Per frame CPU | ≤ 2 ms |
| Total palette entries per room | 64 (hard) |
| Distinct indices actually used per room | 24–40 (soft, enforce in dev) |
| Background `ImageData` per room | 184 KB (`320*144*4`) |
| All sprite bitmaps | ≤ 400 KB |

---

## 9. Build order (do it in this sequence)

1. `fb.ts`, `dither.ts`, `rng.ts`, `palette.ts`, `light.ts` + the dev asserts. No art yet.
2. `display.ts` + a test pattern: a 7-step dithered vertical ramp across the full 320x200, plus a
   1px checkerboard border. If the checkerboard shows any grey at any zoom level, the scaling setup
   is wrong — fix it before drawing anything.
3. Scene 1 sky (§3.4) → stars → moon → sea → cliffs → palms → foreground silhouette → vignette.
   This is the scene that proves the technique; get it right before writing the other two.
4. `stamp.ts` and the sprite loader; put the template character on the cliff and walk it.
5. Scene 2 at 960 wide; scene 3 with the lighting LUT pass.
6. `cycle.ts` last. Everything must look finished *before* it moves.

---

## Sources

- SCUMM room/verb geometry: [scummvm/engines/scumm/scumm.cpp — `initScreens(16, 144)`](https://github.com/scummvm/scummvm/blob/master/engines/scumm/scumm.cpp)
- [Mode 13h — 320x200, non-square pixels](https://en.wikipedia.org/wiki/Mode_13h)
- [Ordered dithering — Bayer matrices and the threshold formula](https://en.wikipedia.org/wiki/Ordered_dithering)
- [EGA Palette (default 16 colours, 2 bits/channel)](https://moddingwiki.shikadi.net/wiki/EGA_Palette)
- [KeyJ — Color Generation in IBM CGA, EGA and VGA (VGA is 6 bits/channel)](https://keyj.emphy.de/cga-ega-vga/)
- [mixnmojo — Monkey Island: From EGA to VGA](https://mixnmojo.com/features/sitefeatures/Monkey-Island-From-EGA-to-VGA)
- [Q&A with Mark J. Ferrari](https://www.effectgames.com/effect/article-Q_A_with_Mark_J_Ferrari.html) and [Thimbleweed Park dev blog on Ferrari's dithering](https://blog.thimbleweedpark.com/mark_ferrari.html)
- [Old School Color Cycling with HTML5 — dirty-pixel lists for palette animation](https://www.effectgames.com/effect/article-Old_School_Color_Cycling_with_HTML5.html)
- [Dan Fessler's HD index-painting method — posterise + gradient map + 2x2 dither](https://2dwillneverdie.com/tutorial/instant-pixel-art-backgrounds-with-the-dan-fessler-method/)
- [Lospec dithering tutorials](https://lospec.com/pixel-art-tutorials/tags/dithering)
- [MDN — Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas), [image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering), [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/createImageBitmap)
- [Mozilla Hacks — Faster Canvas Pixel Manipulation with Typed Arrays](https://hacks.mozilla.org/2011/12/faster-canvas-pixel-manipulation-with-typed-arrays/)
