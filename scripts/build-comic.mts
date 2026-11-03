// Builds the pictures of the little comic that tells the story ("the world is in danger: save it, and what it holds, the pizza included").
//
//   npx tsx scripts/build-comic.mts --base http://localhost:3501     (a running site, ideally with an EMPTY database: it is photographed)
//
// It photographs the real map (intact, half destroyed, destroyed), turns it into big pixels, draws the little things that are at stake
// (a pizza, a cat, a guitar, a croissant, a hot-air balloon) with code, puts the hooded figure of `scripts/comic/hooded.png` on top, and
// writes `public/story/panel-1.png` … `panel-6.png`. The pictures carry NO text: the words are in the page (translated, readable).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (name: string, d: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1]! : d; };
const BASE = opt("base", "http://localhost:3501");
const OUT = path.resolve(opt("out", "public/story"));
const FIGURE = path.resolve("scripts/comic/hooded.png"); // the cut-out of the hooded figure (the owner's picture, background removed)
const W = 240, H = 135, S = 4; // the drawing is 240 × 135 big pixels, shown ×4 (960 × 540)

type RGB = readonly [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  night: hex("#0b0720"), violet: hex("#1d1048"), deep: hex("#2a1670"), magenta: hex("#ff2e93"), cyan: hex("#19d3ff"), lav: hex("#e9e5ff"), lav2: hex("#dcd6ff"),
  cream: hex("#fbf5e6"), orange: hex("#f04316"), ink: hex("#1f2540"), white: hex("#ffffff"),
  cheese: hex("#ffc93c"), crust: hex("#e29a45"), crustDark: hex("#a85d1f"), pepper: hex("#d9382f"), outline: hex("#3a1608"),
  cat: hex("#2b2745"), catLight: hex("#4a4470"), eye: hex("#ffe14a"), pink: hex("#ff8fb8"),
  wood: hex("#c4702e"), woodDark: hex("#7a3f14"), neck: hex("#4a2a12"),
  gold: hex("#e8a13c"), goldDark: hex("#b36a1c"), basket: hex("#8a5a2b"),
};

/* ------------------------------------------------------------------ a tiny canvas */
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
class Canvas {
  data = new Float32Array(W * H * 4); // r, g, b, a (0–1)
  put(x: number, y: number, c: RGB, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 4, d = this.data, ba = d[i + 3]!;
    const oa = a + ba * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = (c[k]! * a + d[i + k]! * ba * (1 - a)) / (oa || 1);
    d[i + 3] = oa;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, c, a); }
  disc(cx: number, cy: number, r: number, c: RGB, a = 1) { for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.put(x, y, c, a); }
  poly(pts: [number, number][], c: RGB, a = 1) {
    const ys = pts.map((p) => p[1]), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let k = 0; k < pts.length; k++) {
        const [ax, ay] = pts[k]!, [bx, by] = pts[(k + 1) % pts.length]!;
        if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) xs.push(ax + ((y + 0.5 - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]! - 0.5); x < xs[k + 1]! - 0.5; x++) this.put(x, y, c, a);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1) { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0))); for (let i = 0; i <= n; i++) this.put(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, a); }
  gradient(top: RGB, bottom: RGB) { for (let y = 0; y < H; y++) { const t = y / (H - 1), c: RGB = [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t]; this.rect(0, y, W, 1, c); } }
  /** The picture of the map (any size) as big pixels: every cell of the grid takes the average colour of the part of the picture it covers. */
  async image(buf: Buffer, x = 0, y = 0, w = W, h = H, a = 1, grade?: { saturation?: number; brightness?: number }) {
    let img = sharp(buf).resize(w, h, { fit: "cover", kernel: "lanczos3" });
    if (grade) img = img.modulate(grade);
    const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = (j * w + i) * 4; this.put(x + i, y + j, [data[k]!, data[k + 1]!, data[k + 2]!], (data[k + 3]! / 255) * a); }
  }
  async png(): Promise<Buffer> {
    const px = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H * 4; i++) px[i] = Math.max(0, Math.min(255, Math.round(this.data[i]! * (i % 4 === 3 ? 255 : 1))));
    return sharp(px, { raw: { width: W, height: H, channels: 4 } }).resize(W * S, H * S, { kernel: "nearest" }).png().toBuffer();
  }
}

/* ------------------------------------------------------------------ the things at stake (drawn with shapes, a few big pixels each) */
type Sprite = (c: Canvas, cx: number, cy: number, k: number, keep?: (x: number, y: number) => boolean) => void;
// `keep` lets a caller erase pixels (the dissolve): every pixel goes through it.
function through(c: Canvas, keep?: (x: number, y: number) => boolean): Canvas {
  if (!keep) return c;
  const proxy = Object.create(c) as Canvas;
  proxy.put = (x, y, col, a = 1) => { if (keep(Math.round(x), Math.round(y))) c.put(x, y, col, a); };
  return proxy;
}
const pizza: Sprite = (cv, cx, cy, k, keep) => {
  const c = through(cv, keep), p = (x: number, y: number): [number, number] => [cx + x * k, cy + y * k];
  c.poly([p(-8.6, -8.6), p(8.6, -8.6), p(8.6, -4.2), p(0, 9.6), p(-8.6, -4.2)].map(([x, y]) => [x, y] as [number, number]), C.outline);
  c.poly([p(-7.6, -7.6), p(7.6, -7.6), p(7.6, -5.2), p(-7.6, -5.2)], C.crust);
  c.poly([p(-7.6, -7.6), p(7.6, -7.6), p(7.6, -6.6), p(-7.6, -6.6)], C.crustDark);
  c.poly([p(-6.8, -5), p(6.8, -5), p(0, 8.4)], C.cheese);
  for (const [x, y, r] of [[-3, -2.4, 1.7], [2.6, -2, 1.7], [0, 2.6, 1.6], [-1, -5.2, 1.0]] as const) { c.disc(cx + x * k, cy + y * k, r * k, C.pepper); c.disc(cx + (x - 0.4) * k, cy + (y - 0.4) * k, 0.5 * k, hex("#ff7b6b")); }
};
const cat: Sprite = (cv, cx, cy, k, keep) => {
  const c = through(cv, keep);
  c.disc(cx, cy + 5 * k, 5.6 * k, C.cat); c.disc(cx, cy - 2 * k, 5.2 * k, C.cat);
  c.poly([[cx - 5 * k, cy - 4 * k], [cx - 5.4 * k, cy - 9.6 * k], [cx - 1.6 * k, cy - 6.2 * k]], C.cat); c.poly([[cx + 5 * k, cy - 4 * k], [cx + 5.4 * k, cy - 9.6 * k], [cx + 1.6 * k, cy - 6.2 * k]], C.cat);
  c.poly([[cx - 4.4 * k, cy - 5 * k], [cx - 4.6 * k, cy - 8 * k], [cx - 2.4 * k, cy - 6 * k]], C.pink); c.poly([[cx + 4.4 * k, cy - 5 * k], [cx + 4.6 * k, cy - 8 * k], [cx + 2.4 * k, cy - 6 * k]], C.pink);
  for (const s of [-1, 1]) { c.disc(cx + s * 2.2 * k, cy - 2.4 * k, 1.3 * k, C.eye); c.rect(cx + s * 2.2 * k - 0.3 * k, cy - 3.4 * k, 0.6 * k, 2 * k, C.night); }
  c.poly([[cx - 0.8 * k, cy - 0.2 * k], [cx + 0.8 * k, cy - 0.2 * k], [cx, cy + 0.8 * k]], C.pink);
  c.disc(cx - 2.6 * k, cy + 9.4 * k, 1.9 * k, C.catLight); c.disc(cx + 2.6 * k, cy + 9.4 * k, 1.9 * k, C.catLight);
  c.line(cx + 5 * k, cy + 8 * k, cx + 9 * k, cy + 3 * k, C.cat); c.line(cx + 5 * k, cy + 9 * k, cx + 9.4 * k, cy + 4 * k, C.cat);
};
const guitar: Sprite = (cv, cx, cy, k, keep) => {
  const c = through(cv, keep);
  c.line(cx + 1 * k, cy + 1 * k, cx + 8 * k, cy - 8 * k, C.neck); c.line(cx + 1.8 * k, cy + 1 * k, cx + 8.8 * k, cy - 8 * k, C.neck); c.rect(cx + 7.6 * k, cy - 10.4 * k, 2.4 * k, 3 * k, C.woodDark);
  c.disc(cx - 2 * k, cy + 4 * k, 5.6 * k, C.woodDark); c.disc(cx - 2 * k, cy + 4 * k, 4.8 * k, C.wood); c.disc(cx + 0.4 * k, cy - 0.2 * k, 3.8 * k, C.woodDark); c.disc(cx + 0.4 * k, cy - 0.2 * k, 3.1 * k, C.wood);
  c.disc(cx - 1 * k, cy + 2.4 * k, 1.8 * k, C.night); c.rect(cx - 3.4 * k, cy + 7.6 * k, 2.8 * k, 0.8 * k, C.woodDark);
  c.line(cx - 0.2 * k, cy + 2 * k, cx + 8 * k, cy - 8.2 * k, C.lav2);
};
const croissant: Sprite = (cv, cx, cy, k, keep) => {
  const c = through(cv, keep);
  const seg: [number, number, number][] = [[-8, 3, 2.6], [-5.6, -0.4, 3.4], [-2.2, -2.4, 3.9], [2.2, -2.4, 3.9], [5.6, -0.4, 3.4], [8, 3, 2.6]];
  for (const [x, y, r] of seg) c.disc(cx + x * k, cy + y * k, (r + 0.8) * k, C.goldDark);
  seg.forEach(([x, y, r], i) => { c.disc(cx + x * k, cy + y * k, r * k, i % 2 ? C.gold : hex("#f1b955")); c.disc(cx + (x - 0.5) * k, cy + (y - 0.9) * k, r * 0.4 * k, hex("#ffd98a")); });
};
const balloon: Sprite = (cv, cx, cy, k, keep) => {
  const c = through(cv, keep);
  c.disc(cx, cy - 2 * k, 7.6 * k, C.outline);
  for (let x = -7; x <= 7; x++) for (let y = -9; y <= 5; y++) if (Math.hypot(x + 0.5, (y + 0.5) * 0.95) <= 7) { const band = Math.floor((x + 7) / 3) % 3; c.rect(cx + x * k, cy + (y - 2) * k, Math.ceil(k), Math.ceil(k), [C.magenta, C.cyan, C.orange][band]!); }
  c.line(cx - 4 * k, cy + 3.4 * k, cx - 1.6 * k, cy + 9 * k, C.lav2); c.line(cx + 4 * k, cy + 3.4 * k, cx + 1.6 * k, cy + 9 * k, C.lav2);
  c.rect(cx - 2.2 * k, cy + 9 * k, 4.4 * k, 3 * k, C.basket); c.rect(cx - 2.2 * k, cy + 9 * k, 4.4 * k, 0.8 * k, C.woodDark);
};
const SPRITES = { pizza, cat, guitar, croissant, balloon } as const;

/* ------------------------------------------------------------------ effects */
function stars(c: Canvas, seed: number, n: number) { const r = mulberry(seed); for (let i = 0; i < n; i++) c.put(r() * W, r() * H, r() < 0.15 ? C.cyan : r() < 0.3 ? C.magenta : C.lav, 0.35 + r() * 0.65); }
function glitchBands(c: Canvas, seed: number, n: number, y0 = 0, y1 = H) {
  const r = mulberry(seed);
  for (let i = 0; i < n; i++) { const y = y0 + r() * (y1 - y0), h = 1 + Math.floor(r() * 3), x = r() * W, w = 10 + r() * 70, col = r() < 0.5 ? C.magenta : C.cyan; c.rect(x, y, w, h, col, 0.25 + r() * 0.4); }
}
function debris(c: Canvas, seed: number, n: number, x0: number, x1: number, y0: number, y1: number) {
  const r = mulberry(seed);
  for (let i = 0; i < n; i++) { const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), s = 1 + Math.floor(r() * 2); c.rect(x, y, s, s, [C.cyan, C.magenta, C.lav, C.white][Math.floor(r() * 4)]!, 0.5 + r() * 0.5); }
}
/** A little planet: the map inside a disc, lit from the upper left, with a thin atmosphere. */
async function planet(c: Canvas, map: Buffer, cx: number, cy: number, r: number) {
  const layer = new Canvas(); await layer.image(map, Math.round(cx - r * 1.6), Math.round(cy - r), Math.round(r * 3.2), Math.round(r * 2), 1, { saturation: 1.2 });
  c.disc(cx, cy, r + 5, C.cyan, 0.12); c.disc(cx, cy, r + 2.5, C.cyan, 0.2); c.disc(cx, cy, r + 1, C.cyan, 0.55);
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d > r) continue;
    const i = (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4, col: RGB = [layer.data[i]!, layer.data[i + 1]!, layer.data[i + 2]!];
    const shade = 0.35 + 0.65 * Math.max(0, 1 - Math.hypot(x + 0.5 - (cx - r * 0.35), y + 0.5 - (cy - r * 0.35)) / (r * 1.5)); // lit from the upper left
    c.put(x, y, [col[0] * shade, col[1] * shade, col[2] * shade * 1.05]);
  }
}
const shield = (c: Canvas, cx: number, cy: number, k: number) => {
  c.poly([[cx - 6 * k, cy - 6 * k], [cx + 6 * k, cy - 6 * k], [cx + 6 * k, cy + 1 * k], [cx, cy + 8 * k], [cx - 6 * k, cy + 1 * k]], C.cyan);
  c.poly([[cx - 4.6 * k, cy - 4.6 * k], [cx + 4.6 * k, cy - 4.6 * k], [cx + 4.6 * k, cy + 0.4 * k], [cx, cy + 6 * k], [cx - 4.6 * k, cy + 0.4 * k]], C.lav);
  c.line(cx - 2.2 * k, cy - 0.4 * k, cx - 0.4 * k, cy + 1.8 * k, C.deep); c.line(cx - 0.4 * k, cy + 1.8 * k, cx + 2.6 * k, cy - 2.6 * k, C.deep);
  c.line(cx - 2.2 * k, cy - 1.4 * k, cx - 0.4 * k, cy + 0.8 * k, C.deep); c.line(cx - 0.4 * k, cy + 0.8 * k, cx + 2.6 * k, cy - 3.6 * k, C.deep);
};

/* ------------------------------------------------------------------ the maps (photographed from the real site) */
async function photographMaps(): Promise<Record<"0" | "55" | "100", Buffer>> {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
  const out = {} as Record<"0" | "55" | "100", Buffer>;
  await page.goto(`${BASE}/?preview=off&perf=1`);
  await page.waitForFunction(() => (window as unknown as { __pxEngine?: { geo?: unknown } }).__pxEngine?.geo, null, { timeout: 120_000 });
  await page.addStyleTag({ content: "header,[data-testid='doom-ticker'],[data-testid='map-shell'] .pointer-events-none.absolute{display:none!important} nextjs-portal{display:none!important}" });
  for (const [name, story] of [["0", 0], ["55", 0.55], ["100", 1]] as const) {
    await page.evaluate((i) => { const e = (window as unknown as { __pxEngine: { places: unknown; setStory(i: number | null): void; flyTo(c: { x: number; y: number; scale: number }, ms: number): void } }).__pxEngine; e.places = null; e.setStory(i > 0 ? i : null); e.flyTo({ x: 20000, y: 11800, scale: 0.05 }, 0); }, story);
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => !(window as unknown as { __pxEngine: { geoPending: boolean } }).__pxEngine.geoPending, null, { timeout: 60_000 });
    out[name] = await page.locator("canvas").first().screenshot();
  }
  await browser.close();
  return out;
}

/* ------------------------------------------------------------------ the panels */
const hooded = () => sharp(FIGURE);
/** The hooded figure, `h` tall, with its bottom edge at `bottom` and its centre at `cx`, over a halo of its own colours. */
async function withFigure(canvasPng: Buffer, o: { cx: number; bottom: number; h: number; flip?: boolean; halo?: number; dim?: number }): Promise<Buffer> {
  const h = Math.round(o.h * S);
  let fig = await hooded().resize({ height: h }).toBuffer();
  if (o.flip) fig = await sharp(fig).flop().toBuffer();
  const meta = await sharp(fig).metadata(), fw = meta.width ?? 0;
  const left = Math.round(o.cx * S - fw / 2), top = Math.round(o.bottom * S - h), sw = W * S, sh = H * S;
  // the figure may run past the edges of the picture (a close-up, a bust cut at the bottom): only what is inside is laid on
  const vx0 = Math.max(0, -left), vy0 = Math.max(0, -top), vx1 = Math.min(fw, sw - left), vy1 = Math.min(h, sh - top);
  const crop = (b: Buffer) => sharp(b).extract({ left: vx0, top: vy0, width: vx1 - vx0, height: vy1 - vy0 }).toBuffer();
  const at = { left: left + vx0, top: top + vy0 };
  const layers: sharp.OverlayOptions[] = [];
  if (o.halo) {
    const halo = await sharp(fig).tint({ r: 255, g: 46, b: 147 }).blur(26).modulate({ brightness: 1.4 }).linear(o.halo, 0).toBuffer();
    layers.push({ input: await crop(halo), ...at, blend: "screen" });
  }
  layers.push({ input: await crop(o.dim ? await sharp(fig).linear([o.dim, o.dim, o.dim, 1], [0, 0, 0, 0]).toBuffer() : fig), ...at });
  return sharp(canvasPng).composite(layers).png().toBuffer();
}
async function finish(buf: Buffer, name: string, opts: { scan?: number; vignette?: number } = {}) {
  const sw = W * S, sh = H * S;
  const layers: sharp.OverlayOptions[] = [];
  if (opts.scan) {
    const lines = Buffer.alloc(sw * sh * 4);
    for (let y = 0; y < sh; y += S) for (let x = 0; x < sw; x++) { const i = (y * sw + x) * 4; lines[i] = 5; lines[i + 1] = 0; lines[i + 2] = 20; lines[i + 3] = Math.round(255 * opts.scan); }
    layers.push({ input: await sharp(lines, { raw: { width: sw, height: sh, channels: 4 } }).png().toBuffer() });
  }
  if (opts.vignette) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}"><defs><radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="#0b0720" stop-opacity="0"/><stop offset="100%" stop-color="#0b0720" stop-opacity="${opts.vignette}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`;
    layers.push({ input: Buffer.from(svg) });
  }
  const png = await sharp(buf).composite(layers).png({ palette: true, colors: 96, effort: 8, dither: 0.6 }).toBuffer();
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
  console.log(`${name}.png ${Math.round(png.length / 1024)} KB`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(FIGURE)) throw new Error("scripts/comic/hooded.png is missing (the cut-out of the hooded figure)");
  const maps = await photographMaps();
  const night = () => { const c = new Canvas(); c.gradient(C.night, C.violet); return c; };

  // 1 · the world as it is: calm, and full of things
  {
    const c = new Canvas(); await c.image(maps["0"], 0, 0, W, H, 1, { saturation: 1.35, brightness: 1.06 });
    const r: Array<[keyof typeof SPRITES, number, number, number]> = [["pizza", 150, 52, 1.5], ["cat", 62, 40, 1.5], ["guitar", 190, 98, 1.4], ["croissant", 96, 100, 1.5], ["balloon", 40, 90, 1.5]];
    for (const [n, x, y, k] of r) { c.disc(x, y, 15 * (k / 1.5), C.white, 0.18); SPRITES[n](c, x, y, k); }
    stars(c, 1, 0);
    await finish(await c.png(), "panel-1", { vignette: 0.4 });
  }
  // 2 · something wakes up: the figure appears over the earth
  {
    const c = night(); stars(c, 2, 130); glitchBands(c, 12, 9, 10, 125);
    await planet(c, maps["0"], 52, 92, 30);
    glitchBands(c, 22, 5, 70, 118);
    await finish(await withFigure(await c.png(), { cx: 168, bottom: H, h: 150, halo: 0.55 }), "panel-2", { scan: 0.1, vignette: 0.7 });
  }
  // 3 · the decision: a close-up
  {
    const c = night(); stars(c, 3, 60); glitchBands(c, 33, 16);
    c.rect(0, 64, W, 1, C.magenta, 0.6); c.rect(0, 66, W, 1, C.cyan, 0.4);
    await finish(await withFigure(await c.png(), { cx: 120, bottom: H + 24, h: 190, halo: 0.8 }), "panel-3", { scan: 0.12, vignette: 0.75 });
  }
  // 4 · the erasing: the world dissolves, and what is in it with it
  {
    const c = new Canvas(); await c.image(maps["55"], 0, 0, W, H, 1, { saturation: 1.3 });
    c.rect(0, 0, W, H, C.night, 0.38);
    const r: Array<[keyof typeof SPRITES, number, number, number, number]> = [["pizza", 150, 56, 1.6, 0.35], ["cat", 62, 46, 1.6, 0.6], ["guitar", 196, 100, 1.5, 0.8], ["croissant", 98, 98, 1.6, 0.5], ["balloon", 34, 98, 1.6, 0.9]];
    for (const [n, x, y, k, gone] of r) { const rr = mulberry(x * 7 + y); const keep = (px: number, py: number) => rr() > gone * (0.35 + 0.65 * ((py - (y - 14)) / 28 + 0.2)); SPRITES[n](c, x, y, k, keep); debris(c, x + y, 26, x - 14, x + 18, y - 4, y + 30); }
    glitchBands(c, 44, 8);
    await finish(await withFigure(await c.png(), { cx: 214, bottom: H + 4, h: 70, halo: 0.5, dim: 0.85 }), "panel-4", { scan: 0.08, vignette: 0.6 });
  }
  // 5 · the flaw: a piece of the planet that stays
  {
    const c = new Canvas(); await c.image(maps["100"], 0, 0, W, H, 1, { saturation: 1.3 });
    c.rect(0, 0, W, H, C.night, 0.55); glitchBands(c, 51, 14);
    const x0 = 78, y0 = 36, w = 84, h = 62;
    c.disc(x0 + w / 2, y0 + h / 2, 62, C.cyan, 0.1); c.disc(x0 + w / 2, y0 + h / 2, 48, C.cyan, 0.12);
    await c.image(maps["0"], x0, y0, w, h, 1, { saturation: 1.3, brightness: 1.08 });
    shield(c, x0 + w / 2, y0 - 12, 1.6);
    debris(c, 55, 70, 0, W, 0, H); glitchBands(c, 56, 6);
    await finish(await withFigure(await c.png(), { cx: 30, bottom: H + 6, h: 62, flip: true, halo: 0.4, dim: 0.8 }), "panel-5", { scan: 0.06, vignette: 0.55 });
  }
  // 6 · and what is on it is saved too: the pizza
  {
    const c = new Canvas(); await c.image(maps["100"], 0, 0, W, H, 1, { saturation: 1.3 });
    c.rect(0, 0, W, H, C.night, 0.62); glitchBands(c, 61, 14);
    const x0 = 30, y0 = 26, w = 110, h = 86;
    c.disc(x0 + w / 2, y0 + h / 2, 78, C.cheese, 0.1); c.disc(x0 + w / 2, y0 + h / 2, 62, C.cheese, 0.12);
    c.rect(x0, y0, w, h, C.cream); c.rect(x0, y0 + h - 6, w, 6, hex("#f1e4c4"));
    pizza(c, x0 + w / 2, y0 + h / 2 - 2, 4.2);
    debris(c, 66, 60, 0, W, 0, H); glitchBands(c, 67, 4);
    await finish(await withFigure(await c.png(), { cx: 196, bottom: H + 10, h: 128, halo: 0.5, dim: 0.9 }), "panel-6", { scan: 0.06, vignette: 0.6 });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
