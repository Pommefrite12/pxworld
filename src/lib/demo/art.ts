/**
 * Generated pictures for the DEMONSTRATION data of a test site (pixel art, little logos, patterns, landscapes). Pure and deterministic:
 * the same seed always gives the same picture, no file, no network. A picture is an RGB raster, one pixel per pixel of the parcel.
 * (Nothing here is ever used by the real site: see `scripts/seed-demo.mts`.)
 */
export type RGB = [number, number, number];
export interface Raster { w: number; h: number; data: Uint8Array }

/* ------------------------------------------------------------------ randomness */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!,
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;

/* ------------------------------------------------------------------ drawing */
export const makeRaster = (w: number, h: number, bg: RGB): Raster => {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { data[i * 3] = bg[0]; data[i * 3 + 1] = bg[1]; data[i * 3 + 2] = bg[2]; }
  return { w, h, data };
};
const put = (r: Raster, x: number, y: number, c: RGB) => {
  if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
  const i = (y * r.w + x) * 3; r.data[i] = c[0]; r.data[i + 1] = c[1]; r.data[i + 2] = c[2];
};
const rect = (r: Raster, x: number, y: number, w: number, h: number, c: RGB) => {
  for (let j = Math.max(0, Math.round(y)); j < Math.min(r.h, Math.round(y + h)); j++) for (let i = Math.max(0, Math.round(x)); i < Math.min(r.w, Math.round(x + w)); i++) put(r, i, j, c);
};
const disc = (r: Raster, cx: number, cy: number, rad: number, c: RGB, inner = 0) => {
  for (let j = Math.floor(cy - rad); j <= Math.ceil(cy + rad); j++) for (let i = Math.floor(cx - rad); i <= Math.ceil(cx + rad); i++) {
    const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy);
    if (d <= rad && d >= inner) put(r, i, j, c);
  }
};
const poly = (r: Raster, pts: [number, number][], c: RGB) => {
  const ys = pts.map((p) => p[1]), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(r.h - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k]!, [bx, by] = pts[(k + 1) % pts.length]!;
      if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) xs.push(ax + ((y + 0.5 - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]! - 0.5); x < xs[k + 1]! - 0.5; x++) put(r, x, y, c);
  }
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map((v) => Math.round(v)) as RGB;
const luma = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/* ------------------------------------------------------------------ a 5 × 7 pixel font (A–Z) */
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
};
export const textWidth = (text: string, scale: number) => text.length * 6 * scale - scale;
const glyph = (r: Raster, ch: string, x: number, y: number, s: number, c: RGB) => {
  const rows = FONT[ch.toUpperCase()]; if (!rows) return;
  for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) if (rows[j]! & (16 >> i)) rect(r, x + i * s, y + j * s, s, s, c);
};
const text = (r: Raster, str: string, x: number, y: number, s: number, c: RGB) => { for (let k = 0; k < str.length; k++) glyph(r, str[k]!, x + k * 6 * s, y, s, c); };

/* ------------------------------------------------------------------ palettes and little icons */
const PALETTES: RGB[][] = [
  [[240, 67, 22], [43, 53, 224], [252, 249, 242], [31, 37, 64], [255, 201, 60]],
  [[25, 211, 255], [255, 46, 147], [233, 229, 255], [31, 37, 64], [106, 76, 255]],
  [[16, 185, 129], [250, 204, 21], [239, 68, 68], [59, 130, 246], [255, 255, 255]],
  [[17, 24, 39], [236, 72, 153], [251, 146, 60], [250, 250, 250], [99, 102, 241]],
  [[254, 243, 199], [251, 146, 60], [190, 18, 60], [30, 58, 138], [22, 101, 52]],
  [[240, 249, 255], [56, 189, 248], [3, 105, 161], [8, 47, 73], [250, 204, 21]],
  [[253, 242, 248], [244, 114, 182], [168, 85, 247], [76, 29, 149], [253, 224, 71]],
  [[236, 253, 245], [52, 211, 153], [5, 150, 105], [6, 78, 59], [251, 191, 36]],
];
const ICONS: Record<string, string[]> = {
  heart: ["..##...##..", ".####.####.", "###########", "###########", "###########", ".#########.", "..#######..", "...#####...", "....###....", ".....#....."],
  star: [".....#.....", ".....#.....", "....###....", "###########", ".#########.", "..#######..", "...#####...", "..###.###..", ".###...###.", ".#.......#."],
  smile: ["...#####...", ".##.....##.", ".#.......#.", "#..##.##..#", "#..##.##..#", "#.........#", "#.#.....#.#", ".#.#####.#.", ".##.....##.", "...#####..."],
  ghost: ["...#####...", "..#######..", ".#########.", ".##..#..##.", ".##..#..##.", ".#########.", ".#########.", ".#########.", ".##.###.##.", ".#...#...#."],
  rocket: ["....##.....", "...####....", "..######...", "..##..##...", "..######...", "..######...", ".########..", ".##.##.##..", "....##.....", "...#..#...."],
  sun: ["#....#....#", ".#...#...#.", "..#.###.#..", "...#####...", "##.#####.##", "...#####...", "..#.###.#..", ".#...#...#.", "#....#....#", "....###...."],
};
export const ART_STYLES = ["invader", "plasma", "emblem", "stripes", "mosaic", "landscape", "icon", "word"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

const WORDS = ["PIXEL", "WORLD", "HELLO", "ART", "WAVE", "LOVE", "COOL", "ZEN", "FOX", "SUN", "MOON", "STAR", "JOY", "WOW", "NEON", "MINT", "BLUE", "GOLD"];

/* ------------------------------------------------------------------ the styles */
function invader(w: number, h: number, g: Rng): Raster {
  const pal = g.pick(PALETTES), bg = g.chance(0.5) ? pal[3]! : pal[2]!, fg = luma(bg) < 128 ? g.pick([pal[0]!, pal[1]!, pal[4]!]) : g.pick([pal[0]!, pal[1]!, pal[3]!]);
  const r = makeRaster(w, h, bg), gw = g.pick([7, 9, 11]), gh = g.pick([7, 9, 11]), half = (gw + 1) / 2;
  const bits: boolean[][] = Array.from({ length: gh }, () => Array.from({ length: half }, () => g.chance(0.55)));
  for (let j = 0; j < gh; j++) bits[j]![half - 1] = bits[j]![half - 1]! || j % 2 === 0;
  const s = Math.max(1, Math.floor(Math.min(w / (gw + 2), h / (gh + 2)))), ox = Math.floor((w - gw * s) / 2), oy = Math.floor((h - gh * s) / 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (bits[j]![i < half ? i : gw - 1 - i]) rect(r, ox + i * s, oy + j * s, s, s, fg);
  const stars = [pal[4]!, pal[1]!, pal[0]!, pal[2]!, pal[3]!].filter((c) => c !== bg && c !== fg), star = g.pick(stars.length ? stars : [fg]); for (let k = 0; k < Math.max(6, (w * h) / 900); k++) { const x = g.int(0, w - 1), y = g.int(0, h - 1); if (x < ox - s || x > ox + gw * s + s || y < oy - s || y > oy + gh * s + s) put(r, x, y, star); }
  return r;
}
function plasma(w: number, h: number, g: Rng): Raster {
  const pal = g.pick(PALETTES), a = pal[0]!, b = pal[1]!, c = pal[4]!, r = makeRaster(w, h, a);
  const [f1, f2, f3, f4] = [g.int(3, 9) / Math.max(w, 1) * 6, g.int(3, 9) / Math.max(h, 1) * 6, g.int(2, 6) / Math.max(w, h) * 6, g.next() * 6];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (Math.sin(x * f1 + f4) + Math.sin(y * f2) + Math.sin((x + y) * f3) + Math.sin(Math.hypot(x - w / 2, y - h / 2) * f3 * 1.7)) / 4 * 0.5 + 0.5;
    put(r, x, y, v < 0.5 ? mix(a, b, v * 2) : mix(b, c, (v - 0.5) * 2));
  }
  return r;
}
function emblem(w: number, h: number, g: Rng, label: string): Raster {
  const pal = g.pick(PALETTES), bg = pal[g.int(0, 4)]!, m = Math.min(w, h), cx = w / 2, cy = h / 2, r = makeRaster(w, h, bg);
  const c1 = pal.find((c) => Math.abs(luma(c) - luma(bg)) > 70) ?? pal[3]!, c2 = pal.find((c) => c !== bg && c !== c1 && Math.abs(luma(c) - luma(c1)) > 20) ?? pal[2]!;
  const shape = g.int(0, 3), R = m * 0.4;
  if (shape === 0) disc(r, cx, cy, R, c1); else if (shape === 1) poly(r, [[cx, cy - R], [cx + R, cy], [cx, cy + R], [cx - R, cy]], c1);
  else if (shape === 2) rect(r, cx - R * 0.85, cy - R * 0.85, R * 1.7, R * 1.7, c1); else poly(r, [[cx, cy - R], [cx + R * 0.95, cy + R * 0.8], [cx - R * 0.95, cy + R * 0.8]], c1);
  disc(r, cx, cy, m * 0.46, c2, m * 0.43);
  const ch = (label.match(/[A-Za-z]/)?.[0] ?? "P").toUpperCase(), s = Math.max(1, Math.floor((m * 0.34) / 7));
  glyph(r, ch, Math.round(cx - (5 * s) / 2), Math.round(cy - (7 * s) / 2), s, luma(c1) < 128 ? c2 : bg);
  return r;
}
function stripes(w: number, h: number, g: Rng): Raster {
  const pal = g.pick(PALETTES), k = g.int(3, 7), kind = g.int(0, 2), r = makeRaster(w, h, pal[0]!), cols = Array.from({ length: k }, () => g.pick(pal));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = kind === 0 ? y / h : kind === 1 ? x / w : ((x + y) / (w + h));
    put(r, x, y, cols[Math.min(k - 1, Math.floor(t * k))]!);
  }
  if (g.chance(0.6)) { const m = Math.min(w, h); disc(r, w / 2, h / 2, m * 0.22, pal[2]!); disc(r, w / 2, h / 2, m * 0.12, pal[3]!); }
  return r;
}
function mosaic(w: number, h: number, g: Rng): Raster {
  const pal = g.pick(PALETTES), line = pal[3]!, r = makeRaster(w, h, pal[2]!), t = Math.max(1, Math.round(Math.min(w, h) / 60));
  const split = (x: number, y: number, ww: number, hh: number, d: number) => {
    if (d === 0 || ww < 12 * t || hh < 12 * t || (d < 3 && g.chance(0.18))) { rect(r, x, y, ww, hh, g.chance(0.62) ? g.pick(pal) : pal[2]!); return; }
    if (ww > hh) { const c = Math.round(ww * (0.3 + g.next() * 0.4)); split(x, y, c, hh, d - 1); split(x + c, y, ww - c, hh, d - 1); rect(r, x + c - t / 2, y, t, hh, line); }
    else { const c = Math.round(hh * (0.3 + g.next() * 0.4)); split(x, y, ww, c, d - 1); split(x, y + c, ww, hh - c, d - 1); rect(r, x, y + c - t / 2, ww, t, line); }
  };
  split(0, 0, w, h, 4);
  rect(r, 0, 0, w, t, line); rect(r, 0, h - t, w, t, line); rect(r, 0, 0, t, h, line); rect(r, w - t, 0, t, h, line);
  return r;
}
function landscape(w: number, h: number, g: Rng): Raster {
  const pal = g.pick(PALETTES), top = pal[g.int(2, 4)]!, bot = pal[g.int(0, 1)]!, r = makeRaster(w, h, top);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(r, x, y, mix(top, bot, Math.min(1, (y / (h * 0.7)) ** 1.2)));
  disc(r, w * (0.25 + g.next() * 0.5), h * (0.28 + g.next() * 0.15), Math.min(w, h) * 0.13, pal[4]!);
  for (const [k, col] of [[0.62, mix(pal[3]!, pal[2]!, 0.35)], [0.76, pal[3]!]] as [number, RGB][]) {
    const a = g.next() * 6, f = (2 + g.next() * 3) / w * 6, pts: [number, number][] = [[0, h], [0, h * k]];
    for (let x = 0; x <= w; x += Math.max(1, Math.floor(w / 40))) pts.push([x, h * k - (Math.sin(x * f + a) * 0.5 + 0.5) * h * 0.2 - Math.sin(x * f * 2.3 + a) * h * 0.04]);
    pts.push([w, h]); poly(r, pts, col);
  }
  return r;
}
function icon(w: number, h: number, g: Rng): Raster {
  const pal = g.pick(PALETTES), name = g.pick(Object.keys(ICONS)), art = ICONS[name]!, r = makeRaster(w, h, pal[g.int(2, 4)]!);
  const gw = art[0]!.length, gh = art.length, s = Math.max(1, Math.floor(Math.min(w / (gw + 4), h / (gh + 4)))), ox = Math.floor((w - gw * s) / 2), oy = Math.floor((h - gh * s) / 2);
  const bg = r.data.slice(0, 3), bgc: RGB = [bg[0]!, bg[1]!, bg[2]!], fg = pal.find((c) => Math.abs(luma(c) - luma(bgc)) > 80) ?? pal[3]!;
  // a frame and a scatter of confetti so that two creations with the same icon and colours still differ
  const frame = mix(bgc, fg, 0.35), tk = Math.max(1, Math.round(Math.min(w, h) / 40));
  rect(r, 0, 0, w, tk, frame); rect(r, 0, h - tk, w, tk, frame); rect(r, 0, 0, tk, h, frame); rect(r, w - tk, 0, tk, h, frame);
  for (let k = 0; k < g.int(10, 40); k++) { const x = g.int(tk, w - tk - 1), y = g.int(tk, h - tk - 1); if (x < ox - s || x > ox + gw * s + s || y < oy - s || y > oy + gh * s + s) rect(r, x, y, tk, tk, mix(bgc, g.pick(pal), 0.6)); }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (art[j]![i] === "#") { rect(r, ox + i * s + s * 0.3, oy + j * s + s * 0.5, s, s, mix(bgc, [0, 0, 0], 0.35)); }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (art[j]![i] === "#") rect(r, ox + i * s, oy + j * s, s, s, name === "heart" ? [239, 68, 68] : name === "sun" || name === "star" ? [250, 204, 21] : fg);
  return r;
}
function word(w: number, h: number, g: Rng, label: string): Raster {
  const pal = g.pick(PALETTES), bg = pal[g.pick([2, 3, 0])]!, r = makeRaster(w, h, bg), str = g.pick(WORDS), s = Math.max(1, Math.floor(Math.min((w * 0.84) / textWidth(str, 1), (h * 0.5) / 7)));
  const fg = pal.find((c) => Math.abs(luma(c) - luma(bg)) > 90) ?? pal[1]!, tw = textWidth(str, s), x = Math.round((w - tw) / 2), y = Math.round((h - 7 * s) / 2);
  for (let k = 0; k < Math.max(2, h / (3 * s)); k++) rect(r, 0, k * 3 * s * 0.9, w, Math.max(1, s * 0.5), mix(bg, fg, 0.1));
  text(r, str, x + s, y + s, s, mix(bg, [0, 0, 0], 0.4)); text(r, str, x, y, s, fg);
  rect(r, x, y + 9 * s, tw, Math.max(1, s), pal[4]!);
  void label;
  return r;
}

/** One picture for a parcel of `w × h`. `label` gives the initial of an emblem. Deterministic in (style, w, h, seed, label). */
export function renderArt(style: ArtStyle, w: number, h: number, seed: number, label = "P"): Raster {
  const g = rng(seed * 2654435761 + w * 31 + h);
  switch (style) {
    case "invader": return invader(w, h, g);
    case "plasma": return plasma(w, h, g);
    case "emblem": return emblem(w, h, g, label);
    case "stripes": return stripes(w, h, g);
    case "mosaic": return mosaic(w, h, g);
    case "landscape": return landscape(w, h, g);
    case "icon": return icon(w, h, g);
    case "word": return word(w, h, g, label);
  }
}
