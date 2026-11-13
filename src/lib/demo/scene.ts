/**
 * A small kit to DRAW pictures for the demonstration data, in unit coordinates (x and y from 0 to 1 across the parcel, radii and thicknesses as a
 * share of its shorter side), so that the same drawing works at any parcel size and at any fineness.
 *
 * `res` is the number of dots per grid pixel: 1 is a pixel, 5 a fifth of a pixel, 10 a tenth of a pixel (the finest the site accepts). The picture
 * is drawn twice as fine as it is kept (`SS`) and averaged down, so that every edge is smooth; every fill is lit from above (and from the left, for
 * round shapes), the sky is a smooth gradient, suns and lamps glow, and `finish()` adds a thin ink line where two colours meet and a soft vignette.
 * Pure and deterministic: no file, no network, no randomness except a seeded one. Used by `heritage.ts`; nothing of it is part of the real site.
 */
import { makeRaster, rng, type RGB, type Raster } from "./art";

export type { RGB, Raster };

/** The palette of the drawings (one place, so that the pictures look like a family). */
export const C = {
  black: [24, 22, 30] as RGB, ink: [44, 36, 56] as RGB, white: [246, 243, 236] as RGB, paper: [238, 224, 190] as RGB,
  skyTop: [84, 150, 226] as RGB, skyLow: [196, 228, 250] as RGB, duskTop: [66, 44, 118] as RGB, duskLow: [250, 156, 96] as RGB, nightTop: [10, 14, 44] as RGB, nightLow: [44, 56, 120] as RGB,
  dawnTop: [120, 120, 200] as RGB, dawnLow: [255, 205, 150] as RGB,
  sand: [228, 192, 122] as RGB, sandDark: [196, 150, 86] as RGB, sandLight: [244, 222, 168] as RGB, stone: [190, 180, 164] as RGB, stoneDark: [132, 122, 112] as RGB, stoneLight: [222, 214, 200] as RGB,
  red: [204, 52, 46] as RGB, redDark: [140, 34, 36] as RGB, orange: [236, 132, 42] as RGB, gold: [236, 188, 62] as RGB, yellow: [250, 224, 90] as RGB,
  green: [64, 146, 72] as RGB, greenDark: [30, 92, 52] as RGB, greenLight: [128, 190, 90] as RGB, teal: [40, 160, 160] as RGB, water: [52, 112, 192] as RGB, waterDark: [30, 70, 140] as RGB, waterLight: [120, 180, 230] as RGB,
  blue: [44, 84, 176] as RGB, navy: [24, 40, 100] as RGB, purple: [112, 62, 152] as RGB, pink: [236, 124, 152] as RGB, magenta: [200, 50, 140] as RGB,
  brown: [122, 82, 50] as RGB, brownDark: [78, 50, 34] as RGB, clay: [196, 110, 70] as RGB, grey: [142, 142, 152] as RGB, greyDark: [88, 88, 100] as RGB, snow: [240, 248, 255] as RGB,
  skin: [226, 170, 128] as RGB, skinDark: [150, 96, 66] as RGB,
};

const SS = 2; // drawn twice as fine as it is kept
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class Canvas {
  /** The size of the parcel, in grid pixels, and the dots per pixel side. */
  readonly pw: number; readonly ph: number; readonly res: number;
  /** The size of what is drawn (twice the fineness it is kept at). */
  readonly w: number; readonly h: number;
  /** The shorter side: radii and thicknesses are shares of it. */
  readonly s: number;
  /** Internal dots in one design pixel (a "pixel" of the size arguments of `dot`, `checker`…). */
  readonly px: number;
  private readonly d: Uint8ClampedArray;
  private readonly g: ReturnType<typeof rng>;
  /** How much a fill is lit from above (0 = flat). */
  grad = 0.16;

  constructor(w: number, h: number, bg: RGB = C.black, seed = 1, res = 1) {
    this.pw = w; this.ph = h; this.res = res;
    this.w = w * res * SS; this.h = h * res * SS; this.s = Math.min(this.w, this.h); this.px = res * SS;
    this.d = new Uint8ClampedArray(this.w * this.h * 3);
    this.g = rng(seed);
    this.fill(bg);
  }

  private put(x: number, y: number, c: RGB) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const i = (y * this.w + x) * 3; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; }
  private blend(x: number, y: number, c: RGB, a: number) { if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return; const i = (y * this.w + x) * 3; const d = this.d; d[i] = d[i]! + (c[0] - d[i]!) * a; d[i + 1] = d[i + 1]! + (c[1] - d[i + 1]!) * a; d[i + 2] = d[i + 2]! + (c[2] - d[i + 2]!) * a; }
  /** A colour lit by its place in the shape: `t` from 0 (top) to 1 (bottom). */
  private lit(c: RGB, t: number, side = 0): RGB { const f = 1 + this.grad * (0.5 - t) - this.grad * 0.4 * side; return [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)]; }

  fill(c: RGB) { for (let i = 0; i < this.d.length; i += 3) { this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; } return this; }
  /** A sky: a smooth vertical gradient from `a` (at `from`) to `b` (at `to`). (`bands` is kept for the old drawings and ignored.) */
  sky(a: RGB, b: RGB, from = 0, to = 1, _bands = 0) {
    const y0 = Math.floor(from * this.h), y1 = Math.ceil(to * this.h);
    for (let j = Math.max(0, y0); j < Math.min(this.h, y1); j++) {
      const t = (j + 0.5 - y0) / Math.max(1, y1 - y0), c = mixc(a, b, t * t * (3 - 2 * t) * 0.5 + t * 0.5);
      for (let i = 0; i < this.w; i++) this.put(i, j, c);
    }
    // what is above and below the band carries on in the colour of its edge (no black gap between a sky and the ground that is drawn later)
    for (let j = 0; j < Math.min(this.h, Math.max(0, y0)); j++) for (let i = 0; i < this.w; i++) this.put(i, j, a);
    for (let j = Math.max(0, y1); j < this.h; j++) for (let i = 0; i < this.w; i++) this.put(i, j, b);
    return this;
  }
  /** Rectangle: x, y, width, height in units. */
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    const x0 = Math.round(x * this.w), y0 = Math.round(y * this.h), x1 = Math.round((x + w) * this.w), y1 = Math.round((y + h) * this.h);
    for (let j = Math.max(0, y0); j < Math.min(this.h, y1); j++) { const col = this.lit(c, (j + 0.5 - y0) / Math.max(1, y1 - y0)); for (let i = Math.max(0, x0); i < Math.min(this.w, x1); i++) this.put(i, j, col); }
    return this;
  }
  poly(pts: [number, number][], c: RGB) {
    const p = pts.map(([x, y]) => [x * this.w, y * this.h] as [number, number]);
    const ys = p.map((q) => q[1]), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const y0 = Math.max(0, Math.floor(ymin)), y1 = Math.min(this.h - 1, Math.ceil(ymax));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let k = 0; k < p.length; k++) {
        const [ax, ay] = p[k]!, [bx, by] = p[(k + 1) % p.length]!;
        if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) xs.push(ax + ((y + 0.5 - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      const col = this.lit(c, (y + 0.5 - ymin) / Math.max(1, ymax - ymin));
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]! - 0.5); x < xs[k + 1]! - 0.5; x++) this.put(x, y, col);
    }
    return this;
  }
  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: RGB) { return this.poly([[x1, y1], [x2, y2], [x3, y3]], c); }
  /** Disc: centre in units, radius as a share of the shorter side. Round shapes are lit from the upper left, like a sphere. */
  disc(x: number, y: number, rad: number, c: RGB, inner = 0) {
    const cx = x * this.w, cy = y * this.h, r = rad * this.s, ri = inner * this.s;
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      const dx = i + 0.5 - cx, dy = j + 0.5 - cy, dd = Math.hypot(dx, dy);
      if (dd > r || dd < ri) continue;
      this.put(i, j, this.lit(c, 0.5 + (dy / r) * 0.35 + (dx / r) * 0.15, dx / r));
    }
    return this;
  }
  ring(x: number, y: number, rad: number, thick: number, c: RGB) { return this.disc(x, y, rad, c, Math.max(0, rad - thick)); }
  /** A thick line from (x1, y1) to (x2, y2); `th` is the thickness as a share of the shorter side. */
  line(x1: number, y1: number, x2: number, y2: number, th: number, c: RGB) {
    const ax = x1 * this.w, ay = y1 * this.h, bx = x2 * this.w, by = y2 * this.h, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (th * this.s) / 2, ny = (dx / len) * (th * this.s) / 2;
    return this.poly([[(ax + nx) / this.w, (ay + ny) / this.h], [(bx + nx) / this.w, (by + ny) / this.h], [(bx - nx) / this.w, (by - ny) / this.h], [(ax - nx) / this.w, (ay - ny) / this.h]], c);
  }
  /** Half a disc, flat side down (a dome, an arch). */
  dome(x: number, y: number, rad: number, c: RGB) {
    const cx = x * this.w, cy = y * this.h, r = rad * this.s;
    for (let j = Math.floor(cy - r); j < Math.ceil(cy); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
      if (Math.hypot(dx, dy) <= r) this.put(i, j, this.lit(c, 0.5 + (dy / r) * 0.5 + (dx / r) * 0.12, dx / r));
    }
    return this;
  }
  /** A chequer of two colours over a rectangle (a cheap texture); each cell is one design pixel. */
  checker(x: number, y: number, w: number, h: number, a: RGB, b: RGB) {
    const x0 = Math.round(x * this.w), y0 = Math.round(y * this.h), x1 = Math.round((x + w) * this.w), y1 = Math.round((y + h) * this.h), cell = Math.max(1, this.px);
    for (let j = Math.max(0, y0); j < Math.min(this.h, y1); j++) for (let i = Math.max(0, x0); i < Math.min(this.w, x1); i++) this.put(i, j, (Math.floor(i / cell) + Math.floor(j / cell)) % 2 ? a : b);
    return this;
  }
  /** A soft light: a radial glow of colour `c` (added over what is there), `rad` as a share of the shorter side. */
  glow(x: number, y: number, rad: number, c: RGB, strength = 0.6) {
    const cx = x * this.w, cy = y * this.h, r = rad * this.s;
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) / r;
      if (d < 1) this.blend(i, j, c, strength * (1 - d) * (1 - d));
    }
    return this;
  }
  /** One round dot (or a few design pixels wide: `n`) at a unit position. */
  dot(x: number, y: number, c: RGB, n = 1) {
    const cx = x * this.w, cy = y * this.h, r = (n * this.px) / 2;
    if (this.res === 1) { for (let j = Math.round(cy - r); j < Math.round(cy + r); j++) for (let i = Math.round(cx - r); i < Math.round(cx + r); i++) this.put(i, j, c); return this; }
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= r) this.put(i, j, c);
    return this;
  }
  stars(n: number, c: RGB = C.white, ymax = 0.6) { const f = this.res > 1 ? 0.45 : 1; for (let k = 0; k < n; k++) { const x = this.g.next(), y = this.g.next() * ymax, big = this.g.next() < 0.25; this.dot(x, y, c, (big ? 1.6 : 1) * f); if (big) this.glow(x, y, 0.03, c, 0.5); } return this; }
  scatter(n: number, x: number, y: number, w: number, h: number, colors: RGB[]) { for (let k = 0; k < n; k++) this.dot(x + this.g.next() * w, y + this.g.next() * h, colors[Math.floor(this.g.next() * colors.length)]!); return this; }
  next() { return this.g.next(); }
  /** The ground: a band from `y` to the bottom. */
  ground(y: number, c: RGB) { return this.rect(0, y, 1, 1 - y, c); }
  /** A triangle mountain with a lit and a shaded side, and optionally a snow cap. */
  mountain(cx: number, base: number, hw: number, h: number, lit: RGB, shade: RGB, snow?: RGB) {
    this.tri(cx - hw, base, cx, base - h, cx, base, lit).tri(cx, base - h, cx + hw, base, cx, base, shade);
    if (snow) this.tri(cx - hw * 0.28, base - h * 0.72, cx, base - h, cx + hw * 0.28, base - h * 0.72, snow);
    return this;
  }
  /** A sun: a disc with a halo. */
  sun(x: number, y: number, rad: number, c: RGB = C.yellow) { this.glow(x, y, rad * 3.2, c, 0.55); return this.disc(x, y, rad, c); }
  cloud(x: number, y: number, size: number, c: RGB = C.white) { return this.disc(x, y, size, c).disc(x + size * 0.9, y + size * 0.15, size * 0.8, c).disc(x - size * 0.9, y + size * 0.2, size * 0.7, c).rect(x - size * 1.5 / this.w * this.s, y + size * 0.2 / this.h * this.s, 3 * size / this.w * this.s, size * 0.6 / this.h * this.s, c); }
  /** A row of `n` columns between x0 and x1, from ytop to ybot, `th` wide each (share of the shorter side). */
  columns(x0: number, x1: number, ytop: number, ybot: number, n: number, th: number, c: RGB) {
    for (let k = 0; k < n; k++) { const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1); this.rect(x - (th * this.s) / this.w / 2, ytop, (th * this.s) / this.w, ybot - ytop, c); }
    return this;
  }
  /** A band of water with little glints of light. */
  waves(y: number, h: number, a: RGB, b: RGB) {
    this.rect(0, y, 1, h, a);
    const step = Math.max(2, Math.round(this.px * 2.2)), y0 = Math.round(y * this.h), y1 = Math.round((y + h) * this.h);
    for (let j = y0 + step, row = 0; j < y1; j += step, row++) for (let i = (row % 2) * step * 2; i < this.w; i += step * 5) for (let t = 0; t < step * 2.2; t++) { this.blend(i + t, j, b, 0.75); this.blend(i + t, j + 1, b, 0.4); }
    return this;
  }
  /** A little figure seen from the front (a head and a body), for crowds and dancers. */
  person(x: number, y: number, size: number, body: RGB, skin: RGB = C.skin) {
    this.disc(x, y - size * 0.62, size * 0.2, skin);
    this.rect(x - (size * 0.2 * this.s) / this.w, y - size * 0.4 * this.s / this.h, (size * 0.4 * this.s) / this.w, (size * 0.55 * this.s) / this.h, body);
    return this;
  }
  /** A palm tree. */
  palm(x: number, base: number, h: number, trunk: RGB = C.brown, leaf: RGB = C.green) {
    this.line(x, base, x + 0.02, base - h, 0.06, trunk);
    const tx = x + 0.02, ty = base - h;
    for (const [dx, dy] of [[-0.14, 0.02], [-0.1, -0.06], [0.1, -0.06], [0.14, 0.02], [0, -0.1]] as const) this.line(tx, ty, tx + dx, ty + dy, 0.07, leaf);
    return this;
  }
  /** A pine tree. */
  pine(x: number, base: number, h: number, c: RGB = C.greenDark) {
    this.tri(x - h * 0.28, base - h * 0.2, x, base - h, x + h * 0.28, base - h * 0.2, c).rect(x - 0.015, base - h * 0.22, 0.03, h * 0.22, C.brownDark);
    return this;
  }
  /** Pyramid with a lit and a shaded side. */
  pyramid(cx: number, base: number, hw: number, h: number, lit: RGB, shade: RGB) { return this.tri(cx - hw, base, cx, base - h, cx, base, lit).tri(cx, base - h, cx + hw, base, cx, base, shade); }
  /** A stepped pyramid (n steps). */
  steps(cx: number, base: number, hw: number, h: number, n: number, lit: RGB, shade: RGB) {
    for (let k = 0; k < n; k++) {
      const half = hw * (1 - k / n), y = base - (h * k) / n, sh = h / n;
      this.rect(cx - half, y - sh, half, sh, k % 2 ? lit : mixc(lit, shade, 0.3)).rect(cx, y - sh, half, sh, k % 2 ? shade : mixc(shade, lit, 0.2));
    }
    return this;
  }
  /** An arched opening: a rectangle and a half disc, in the colour of what is behind. */
  arch(x: number, y: number, w: number, h: number, c: RGB) { const rad = (w / 2) * this.w / this.s; return this.rect(x - w / 2, y - h * 0.4, w, h * 0.4 + 0.0001, c).dome(x, y - h * 0.4, rad, c); }

  /**
   * The picture as it is kept: averaged down from the finer drawing (smooth edges), with a thin ink line where two colours meet and a soft
   * vignette. `res` dots per grid pixel side: the raster is `pw · res` by `ph · res`.
   */
  finish(): Raster {
    const W = this.pw * this.res, H = this.ph * this.res, out = makeRaster(W, H, C.black), o = out.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) { const k = ((y * SS + j) * this.w + (x * SS + i)) * 3; r += this.d[k]!; g += this.d[k + 1]!; b += this.d[k + 2]!; }
      const n = SS * SS, q = (y * W + x) * 3;
      o[q] = r / n; o[q + 1] = g / n; o[q + 2] = b / n;
    }
    if (this.res >= 3) {
      // a thin ink line where two colours meet: the darker of the two neighbouring dots is darkened
      const src = Uint8Array.from(o), L = (q: number) => lum(src[q]!, src[q + 1]!, src[q + 2]!), dark = 0.78, T = 16;
      for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
        const q = (y * W + x) * 3, lc = L(q);
        for (const nq of [q + 3, q + W * 3]) {
          const ln = L(nq);
          if (Math.abs(lc - ln) <= T) continue;
          const t = lc < ln ? q : nq;
          o[t] = o[t]! * dark; o[t + 1] = o[t + 1]! * dark; o[t + 2] = o[t + 2]! * dark;
        }
      }
    }
    // a soft vignette
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5) / W - 0.5, (y + 0.5) / H - 0.5) / 0.7071, v = d <= 0.55 ? 1 : 1 - 0.13 * ((d - 0.55) / 0.45) ** 2, q = (y * W + x) * 3;
      o[q] = o[q]! * v; o[q + 1] = o[q + 1]! * v; o[q + 2] = o[q + 2]! * v;
    }
    return out;
  }
}
