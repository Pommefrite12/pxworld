/**
 * A small kit to DRAW pictures for the demonstration data: hard-edged pixel art in unit coordinates (x and y from 0 to 1 across the parcel, radii
 * and thicknesses as a share of its shorter side), so that the same drawing works for a 20 × 20 and for a 50 × 50 parcel. Pure and deterministic:
 * no file, no network, no randomness except a seeded one. Used by `heritage.ts`; nothing of it is part of the real site.
 */
import { disc as discPx, makeRaster, mix, poly as polyPx, put, rect as rectPx, rng, type RGB, type Raster } from "./art";

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

export class Canvas {
  readonly r: Raster;
  readonly w: number;
  readonly h: number;
  /** The shorter side: radii and thicknesses are shares of it. */
  readonly s: number;
  private readonly g: ReturnType<typeof rng>;
  constructor(w: number, h: number, bg: RGB = C.black, seed = 1) { this.w = w; this.h = h; this.s = Math.min(w, h); this.r = makeRaster(w, h, bg); this.g = rng(seed); }

  fill(c: RGB) { rectPx(this.r, 0, 0, this.w, this.h, c); return this; }
  /** A sky: a vertical gradient from `a` (at `from`) to `b` (at `to`), cut into bands and softened with an ordered dither, like old pixel art. */
  sky(a: RGB, b: RGB, from = 0, to = 1, bands = 7) {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let j = Math.floor(from * this.h); j < Math.ceil(to * this.h); j++) for (let i = 0; i < this.w; i++) {
      const t = Math.max(0, Math.min(1, (j + 0.5 - from * this.h) / Math.max(1, (to - from) * this.h))) * (bands - 1);
      const k = Math.floor(t) + ((t % 1) * 16 > bayer[(j % 4) * 4 + (i % 4)]! ? 1 : 0);
      put(this.r, i, j, mix(a, b, Math.min(bands - 1, k) / (bands - 1)));
    }
    return this;
  }
  /** Rectangle: x, y, width, height in units. */
  rect(x: number, y: number, w: number, h: number, c: RGB) { rectPx(this.r, x * this.w, y * this.h, w * this.w, h * this.h, c); return this; }
  poly(pts: [number, number][], c: RGB) { polyPx(this.r, pts.map(([x, y]) => [x * this.w, y * this.h] as [number, number]), c); return this; }
  tri(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: RGB) { return this.poly([[x1, y1], [x2, y2], [x3, y3]], c); }
  /** Disc: centre in units, radius as a share of the shorter side. */
  disc(x: number, y: number, rad: number, c: RGB, inner = 0) { discPx(this.r, x * this.w, y * this.h, rad * this.s, c, inner * this.s); return this; }
  ring(x: number, y: number, rad: number, thick: number, c: RGB) { return this.disc(x, y, rad, c, Math.max(0, rad - thick)); }
  /** A thick line from (x1, y1) to (x2, y2); `th` is the thickness as a share of the shorter side. */
  line(x1: number, y1: number, x2: number, y2: number, th: number, c: RGB) {
    const ax = x1 * this.w, ay = y1 * this.h, bx = x2 * this.w, by = y2 * this.h, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (th * this.s) / 2, ny = (dx / len) * (th * this.s) / 2;
    polyPx(this.r, [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]], c);
    return this;
  }
  /** Half a disc, flat side down (a dome, an arch). */
  dome(x: number, y: number, rad: number, c: RGB) {
    const cx = x * this.w, cy = y * this.h, rr = rad * this.s;
    for (let j = Math.floor(cy - rr); j < Math.ceil(cy); j++) for (let i = Math.floor(cx - rr); i <= Math.ceil(cx + rr); i++) if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= rr) put(this.r, i, j, c);
    return this;
  }
  /** A chequer of two colours over a rectangle (a cheap texture). */
  checker(x: number, y: number, w: number, h: number, a: RGB, b: RGB) {
    for (let j = Math.round(y * this.h); j < Math.round((y + h) * this.h); j++) for (let i = Math.round(x * this.w); i < Math.round((x + w) * this.w); i++) put(this.r, i, j, (i + j) % 2 ? a : b);
    return this;
  }
  /** One pixel (or a small square of `n` pixels) at a unit position. */
  dot(x: number, y: number, c: RGB, n = 1) { rectPx(this.r, Math.round(x * this.w), Math.round(y * this.h), n, n, c); return this; }
  stars(n: number, c: RGB = C.white, ymax = 0.6) { for (let k = 0; k < n; k++) this.dot(this.g.next(), this.g.next() * ymax, c); return this; }
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
  sun(x: number, y: number, rad: number, c: RGB = C.yellow) { return this.disc(x, y, rad, c); }
  cloud(x: number, y: number, size: number, c: RGB = C.white) { return this.disc(x, y, size, c).disc(x + size * 0.9, y + size * 0.15, size * 0.8, c).disc(x - size * 0.9, y + size * 0.2, size * 0.7, c).rect(x - size * 1.5 / this.w * this.s, y + size * 0.2 / this.h * this.s, 3 * size / this.w * this.s, size * 0.6 / this.h * this.s, c); }
  /** A row of `n` columns between x0 and x1, from ytop to ybot, `th` wide each (share of the shorter side). */
  columns(x0: number, x1: number, ytop: number, ybot: number, n: number, th: number, c: RGB) {
    for (let k = 0; k < n; k++) { const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1); this.rect(x - (th * this.s) / this.w / 2, ytop, (th * this.s) / this.w, ybot - ytop, c); }
    return this;
  }
  /** A wavy band of water. */
  waves(y: number, h: number, a: RGB, b: RGB) {
    this.rect(0, y, 1, h, a);
    for (let j = 0; j < Math.ceil(h * this.h); j += 2) for (let i = (j / 2) % 2 ? 1 : 0; i < this.w; i += 3) put(this.r, i, Math.round(y * this.h) + j, b);
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
      this.rect(cx - half, y - sh, half, sh, k % 2 ? lit : mix(lit, shade, 0.3)).rect(cx, y - sh, half, sh, k % 2 ? shade : mix(shade, lit, 0.2));
    }
    return this;
  }
  /** An arched opening: a rectangle and a half disc, in the colour of what is behind. */
  arch(x: number, y: number, w: number, h: number, c: RGB) { const rad = (w / 2) * this.w / this.s; return this.rect(x - w / 2, y - h * 0.4, w, h * 0.4 + 0.0001, c).dome(x, y - h * 0.4, rad, c); }
}
