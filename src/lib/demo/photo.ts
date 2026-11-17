/**
 * "Realistic pixel art": a picture drawn the smooth way (lit fills, gradient skies, glows, reflections, haze: see `scene.ts`), then made of pixels —
 * averaged to the fineness it is kept at (a quarter of a pixel of the grid by default), reduced to a palette of a few dozen colours and dithered with an
 * ordered pattern, so that it has the depth of a photograph and the plain pixels of the rest of the site. Pure and deterministic, like the rest of the kit;
 * nothing here is a photograph, a logo or a real person. Used by `capitals.ts`.
 */
import { C, Canvas, type RGB, type Raster } from "./scene";
import { makeRaster } from "./art";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shadeRGB = (c: RGB, t: number): RGB => [c[0] * (1 - t), c[1] * (1 - t), c[2] * (1 - t)];

/** A palette of `n` colours for the picture (median cut on a sample), as RGB triples. */
export function medianCut(r: Raster, n: number): RGB[] {
  const px: RGB[] = [];
  for (let i = 0; i < r.w * r.h; i += 5) px.push([r.data[i * 3]!, r.data[i * 3 + 1]!, r.data[i * 3 + 2]!]);
  const boxes: RGB[][] = [px];
  const range = (b: RGB[]) => { let best = 0, ch = 0; for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of b) { if (p[c]! < lo) lo = p[c]!; if (p[c]! > hi) hi = p[c]!; } if (hi - lo > best) { best = hi - lo; ch = c; } } return { best, ch }; };
  while (boxes.length < n) {
    let bi = -1, bs = 0, bch = 0;
    for (let i = 0; i < boxes.length; i++) { const b = boxes[i]!; if (b.length < 2) continue; const { best, ch } = range(b), score = best * Math.sqrt(b.length); if (score > bs) { bs = score; bi = i; bch = ch; } }
    if (bi < 0) break;
    const b = boxes[bi]!.sort((p, q) => p[bch]! - q[bch]!), mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => { let rr = 0, gg = 0, bb = 0; for (const p of b) { rr += p[0]; gg += p[1]; bb += p[2]; } const k = Math.max(1, b.length); return [Math.round(rr / k), Math.round(gg / k), Math.round(bb / k)] as RGB; });
}

/** Every dot becomes the nearest colour of a palette, after an ordered-dither nudge (`spread`: how far, in levels, 0 = none). */
export function quantize(r: Raster, colors = 56, spread = 22): Raster {
  const pal = medianCut(r, colors), out = makeRaster(r.w, r.h, C.black), cache = new Map<number, number>();
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const q = (y * r.w + x) * 3, off = (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.47) * spread;
    const cr = Math.max(0, Math.min(255, r.data[q]! + off)), cg = Math.max(0, Math.min(255, r.data[q + 1]! + off)), cb = Math.max(0, Math.min(255, r.data[q + 2]! + off));
    const key = ((cr >> 2) << 12) | ((cg >> 2) << 6) | (cb >> 2);
    let k = cache.get(key);
    if (k === undefined) {
      let best = 1e9; k = 0;
      for (let i = 0; i < pal.length; i++) { const p = pal[i]!, d = (p[0] - cr) ** 2 * 0.9 + (p[1] - cg) ** 2 * 1.2 + (p[2] - cb) ** 2 * 0.8; if (d < best) { best = d; k = i; } }
      cache.set(key, k);
    }
    const p = pal[k]!; out.data[q] = p[0]; out.data[q + 1] = p[1]; out.data[q + 2] = p[2];
  }
  return out;
}

/* ------------------------------------------------------------------ value noise (seeded): clouds, grain, foliage */
const hash = (x: number, y: number, seed: number) => { let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (t: number) => t * t * (3 - 2 * t);
const noise2 = (x: number, y: number, seed: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};
/** Fractal noise from 0 to 1: `oct` layers, each twice as fine and half as strong. */
export const fbm = (x: number, y: number, seed: number, oct = 5) => { let v = 0, amp = 0.5, f = 1, tot = 0; for (let o = 0; o < oct; o++) { v += amp * noise2(x * f, y * f, seed + o * 17); tot += amp; amp *= 0.5; f *= 2; } return v / tot; };
const smoothstep = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A square picture with the extra brushes a realistic scene needs: haze, window grids, reflections, soft clouds. Square on purpose: shapes keep their proportions. */
export class Photo extends Canvas {
  constructor(size: number, seed = 1, res = 4) { super(size, size, C.black, seed, res, 1); }

  /** A veil of colour over a band, its strength going from `a0` (at `y0`) to `a1` (at `y1`): haze at the horizon, a fade to dark. */
  veil(y0: number, y1: number, c: RGB, a0: number, a1: number) {
    const j0 = Math.max(0, Math.round(y0 * this.h)), j1 = Math.min(this.h, Math.round(y1 * this.h));
    for (let j = j0; j < j1; j++) { const a = a0 + (a1 - a0) * ((j - j0) / Math.max(1, j1 - j0 - 1)); for (let i = 0; i < this.w; i++) this.blend(i, j, c, a); }
    return this;
  }

  /** A rectangle filled with a vertical gradient (a lit façade, a sky of its own). */
  vgrad(x: number, y: number, w: number, h: number, top: RGB, bottom: RGB) {
    const x0 = Math.round(x * this.w), x1 = Math.round((x + w) * this.w), y0 = Math.round(y * this.h), y1 = Math.round((y + h) * this.h);
    for (let j = Math.max(0, y0); j < Math.min(this.h, y1); j++) { const c = mix(top, bottom, (j - y0) / Math.max(1, y1 - y0 - 1)); for (let i = Math.max(0, x0); i < Math.min(this.w, x1); i++) this.put(i, j, c); }
    return this;
  }

  /** A horizontal gradient (the lit side of a tower to its shaded side). */
  hgrad(x: number, y: number, w: number, h: number, left: RGB, right: RGB) {
    const x0 = Math.round(x * this.w), x1 = Math.round((x + w) * this.w), y0 = Math.round(y * this.h), y1 = Math.round((y + h) * this.h);
    for (let i = Math.max(0, x0); i < Math.min(this.w, x1); i++) { const c = mix(left, right, (i - x0) / Math.max(1, x1 - x0 - 1)); for (let j = Math.max(0, y0); j < Math.min(this.h, y1); j++) this.put(i, j, c); }
    return this;
  }

  /** A grid of windows on a façade: `lit` of them (a share, 0 to 1) in `on`, the others in `off`. */
  windows(x: number, y: number, w: number, h: number, cols: number, rows: number, on: RGB, off: RGB, lit = 0.4, fill = 0.55) {
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const isOn = this.g.next() < lit, ww = cw * fill, hh = ch * fill;
      this.rect(x + c * cw + (cw - ww) / 2, y + r * ch + (ch - hh) / 2, ww, hh, isOn ? mix(on, [255, 255, 255], this.g.next() * 0.3) : off);
    }
    return this;
  }

  /** A soft round patch of colour, `a` of it at the centre and nothing at the edge (a cloud, a puff of steam). */
  puff(x: number, y: number, rad: number, c: RGB, a = 0.7) {
    const cx = x * this.w, cy = y * this.h, r = rad * this.s;
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) / r;
      if (d < 1) this.blend(i, j, c, a * Math.min(1, (1 - d) * 2.2));
    }
    return this;
  }
  /** A cloud: several puffs, lit on top (`lit`) and shaded underneath (`shade`). */
  cloudy(x: number, y: number, size: number, lit: RGB, shade: RGB, a = 0.8) {
    for (const [dx, dy, r] of [[-1.3, 0.25, 0.75], [-0.5, 0, 1], [0.5, -0.1, 1.1], [1.4, 0.2, 0.8], [0.1, 0.35, 0.9]] as const) this.puff(x + dx * size, y + dy * size * 0.6, r * size, shade, a * 0.8);
    for (const [dx, dy, r] of [[-1.2, 0.15, 0.6], [-0.4, -0.12, 0.85], [0.5, -0.2, 0.9], [1.3, 0.1, 0.6]] as const) this.puff(x + dx * size, y + dy * size * 0.6, r * size, lit, a);
    return this;
  }

  /**
   * Water: everything above the waterline `y` is mirrored below it, darker, tinted and rippled (`strength`: how much of the mirror image shows).
   * Call it after the scene above the line is drawn, then draw what floats on top.
   */
  reflect(y: number, tint: RGB, strength = 0.7, fade = 0.55, ripple = 0.004) {
    const yl = Math.round(y * this.h), src = Uint8ClampedArray.from(this.d);
    for (let j = yl; j < this.h; j++) {
      const sj = yl - (j - yl) - 1; if (sj < 0) break;
      const depth = (j - yl) / Math.max(1, this.h - yl), k = strength * (1 - depth * fade);
      const wob = Math.round(Math.sin(j * 0.45 + this.g.next() * 2) * ripple * this.w * (0.4 + depth));
      for (let i = 0; i < this.w; i++) {
        const si = Math.max(0, Math.min(this.w - 1, i + wob)), q = (sj * this.w + si) * 3, o = (j * this.w + i) * 3, streak = 1 + (this.g.next() - 0.5) * 0.18;
        for (let c = 0; c < 3; c++) this.d[o + c] = this.d[o + c]! * (1 - k) + (src[q + c]! * 0.85 * streak) * k * 0.65 + tint[c]! * k * 0.35;
      }
    }
    return this;
  }

  /** A disc shaded from `top` to `bottom`, with horizontal slats cut out of its lower half (a retro sun): `slats` of them, wider as they go down. */
  sunDisc(x: number, y: number, rad: number, top: RGB, bottom: RGB, slats = 0) {
    const cx = x * this.w, cy = y * this.h, r = rad * this.s;
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) {
      const t = (j + 0.5 - (cy - r)) / (2 * r), u = Math.max(0, (t - 0.5) / 0.5);
      if (slats && t > 0.5 && (u * slats) % 1 < 0.12 + 0.5 * u) continue;
      const c = mix(top, bottom, Math.max(0, Math.min(1, t)));
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) if (Math.hypot(i + 0.5 - cx, j + 0.5 - cy) <= r) this.put(i, j, c);
    }
    return this;
  }

  /**
   * Real clouds: a field of fractal noise between `y0` and `y1`, thresholded by `cover` (0 to 1), lit from `light` (top left by default): bright where the
   * cloud faces the sun, grey-blue underneath, soft at the edges. Blended over the sky already drawn.
   */
  clouds(y0: number, y1: number, cover: number, lit: RGB, shade: RGB, o: { scale?: number; seed?: number; stretch?: number; sun?: [number, number]; alpha?: number } = {}) {
    const scale = o.scale ?? 4, seed = o.seed ?? 3, stretch = o.stretch ?? 2.2, alpha = o.alpha ?? 0.92, sun = o.sun ?? [0.3, 0];
    const j0 = Math.max(0, Math.round(y0 * this.h)), j1 = Math.min(this.h, Math.round(y1 * this.h)), eps = Math.max(2, this.w * 0.012);
    for (let j = j0; j < j1; j++) {
      const band = Math.sin(((j - j0) / Math.max(1, j1 - j0)) * Math.PI) ** 0.7;
      for (let i = 0; i < this.w; i++) {
        const u = (i / this.w) * scale, v = ((j / this.h) * scale) * stretch, n = fbm(u, v, seed) * band;
        const dens = smoothstep(1 - cover - 0.12, 1 - cover + 0.2, n + 0.0);
        if (dens <= 0.01) continue;
        const nl = fbm(u + (sun[0] * eps) / this.w * scale, v + ((sun[1] - 1) * eps) / this.h * scale * stretch, seed) * band;
        const light = Math.max(0, Math.min(1, 0.55 + (n - nl) * 9));
        this.blend(i, j, mix(shade, lit, light), dens * alpha);
      }
    }
    return this;
  }

  /** Grain on a region: its brightness is multiplied by fractal noise (stone, grass, sand, water), `amount` 0 to 1, `scale` = size of the patches. */
  texture(x: number, y: number, w: number, h: number, amount = 0.25, scale = 40, seed = 5) {
    const x0 = Math.max(0, Math.round(x * this.w)), x1 = Math.min(this.w, Math.round((x + w) * this.w)), y0 = Math.max(0, Math.round(y * this.h)), y1 = Math.min(this.h, Math.round((y + h) * this.h));
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
      const f = 1 + (fbm((i / this.w) * scale, (j / this.h) * scale, seed, 4) - 0.5) * 2 * amount, q = (j * this.w + i) * 3;
      this.d[q] = this.d[q]! * f; this.d[q + 1] = this.d[q + 1]! * f; this.d[q + 2] = this.d[q + 2]! * f;
    }
    return this;
  }

  /** A mass of foliage: many small leaf clusters in an ellipse, darker underneath and lighter on top (a tree, a bush). */
  foliage(x: number, y: number, rx: number, ry: number, dark: RGB, light: RGB, n = 90) {
    for (let k = 0; k < n; k++) {
      const a = this.g.next() * Math.PI * 2, r = Math.sqrt(this.g.next()), px = x + Math.cos(a) * rx * r, py = y + Math.sin(a) * ry * r, top = Math.max(0, Math.min(1, 0.5 - (py - y) / (2 * ry) + (this.g.next() - 0.5) * 0.5));
      this.disc(px, py, (0.012 + this.g.next() * 0.018) * (rx + ry) * 8, mix(dark, light, top));
    }
    return this;
  }

  /** A palm: a curved tapering trunk and fronds with their leaflets. `lean` bends the trunk sideways (a share of the width). */
  palmTree(x: number, base: number, h: number, lean: number, trunk: RGB, leaf: RGB, leafLight: RGB = leaf) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([x + lean * t * t, base - h * t]); }
    const L: [number, number][] = [], R: [number, number][] = [];
    pts.forEach(([px, py], i) => { const w = 0.016 * (1 - (i / 10) * 0.55); L.push([px - w, py]); R.push([px + w, py]); });
    this.poly([...L, ...R.reverse()], trunk);
    for (let i = 1; i < 10; i += 2) { const [px, py] = pts[i]!; this.line(px - 0.016, py, px + 0.016, py, 0.003, shadeRGB(trunk, 0.35)); }
    const [cx, cy] = pts[10]!;
    for (let f = 0; f < 11; f++) {
      const ang = -Math.PI * 0.95 + (f / 10) * Math.PI * 0.95 * 1.0 + (this.g.next() - 0.5) * 0.15, len = h * (0.5 + this.g.next() * 0.2);
      const ex = cx + Math.cos(ang) * len, ey = cy + Math.sin(ang) * len * 0.55 + len * 0.42 * Math.abs(Math.cos(ang));
      const mx = cx + Math.cos(ang) * len * 0.55, my = cy + Math.sin(ang) * len * 0.55 - len * 0.12;
      const rib: [number, number][] = []; for (let i = 0; i <= 12; i++) { const t = i / 12, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t; rib.push([a * cx + b * mx + c * ex, a * cy + b * my + c * ey]); }
      for (let i = 0; i + 1 < rib.length; i++) this.line(rib[i]![0], rib[i]![1], rib[i + 1]![0], rib[i + 1]![1], 0.007 * (1 - i / 14), leaf);
      for (let i = 2; i < rib.length - 1; i++) {
        const [rx, ry] = rib[i]!, sz = 0.055 * (1 - i / 14) * (len / h) * 1.6, dx = rib[i + 1]![0] - rib[i - 1]![0], dy = rib[i + 1]![1] - rib[i - 1]![1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
        const c = i % 2 ? leaf : leafLight;
        this.line(rx, ry, rx + nx * sz + dx / l * sz * 0.5, ry + ny * sz + dy / l * sz * 0.5 + sz * 0.5, 0.0035, c).line(rx, ry, rx - nx * sz + dx / l * sz * 0.5, ry - ny * sz + dy / l * sz * 0.5 + sz * 0.5, 0.0035, c);
      }
    }
    this.disc(cx, cy + 0.006, 0.014, shadeRGB(trunk, 0.2));
    return this;
  }

  /** A dotted line of small lights (a bridge, a street): `n` lights from (x1, y1) to (x2, y2). */
  lights(x1: number, y1: number, x2: number, y2: number, n: number, c: RGB, size = 1.4) {
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0.5 : i / (n - 1); this.glow(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0.012 * size, c, 0.9); this.dot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, c, 0.5 * size); }
    return this;
  }

  /** The picture as it is kept: averaged down from the finer drawing, a soft vignette, then pixels (a palette of `colors`, dithered). */
  finishPhoto(colors = 56, spread = 22): Raster {
    const W = this.pw * this.res, H = this.ph * this.res, out = makeRaster(W, H, C.black), o = out.data, SSN = 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < SSN; j++) for (let i = 0; i < SSN; i++) { const k = ((y * SSN + j) * this.w + (x * SSN + i)) * 3; r += this.d[k]!; g += this.d[k + 1]!; b += this.d[k + 2]!; }
      const d = Math.hypot((x + 0.5) / W - 0.5, (y + 0.5) / H - 0.5) / 0.7071, v = d <= 0.6 ? 1 : 1 - 0.18 * ((d - 0.6) / 0.4) ** 2, q = (y * W + x) * 3;
      o[q] = (r / 4) * v; o[q + 1] = (g / 4) * v; o[q + 2] = (b / 4) * v;
    }
    return quantize(out, colors, spread);
  }
}
