import { expect, test } from "@playwright/test";

/**
 * The map stays smooth: borders are solid lines (dashes are expensive to rasterise), commune borders only exist at a closer
 * zoom (and their data is only downloaded then), and geography tiles are prepared in advance while the map is idle.
 */
const PARIS = { x: 18_983, y: 11_739 };
type Eng = {
  cam: { x: number; y: number; scale: number }; dpr: number; geoPending: boolean;
  geo: { tilePaths: (...a: unknown[]) => unknown };
  geoTiles: Map<string, unknown>;
  renderGeoTile: (k: number, tx: number, ty: number, strict?: boolean) => { c: HTMLCanvasElement; complete: boolean } | null;
  warmNow: (max?: number) => number;
  warmCandidates: () => unknown[];
  flyTo: (c: { x: number; y: number; scale: number }, ms: number) => void;
};
const engine = (page: import("@playwright/test").Page) => page.waitForFunction(() => { const e = (window as unknown as { __pxEngine?: Eng }).__pxEngine; return Boolean(e && e.geo && !e.geoPending); }, null, { timeout: 60_000 });

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1360, height: 860 }); });

test("borders are solid lines: nothing is dashed while a geography tile is drawn", async ({ page }) => {
  await page.goto(`/map?x=${PARIS.x}&y=${PARIS.y}&z=4`);
  await engine(page);
  const dashed = await page.evaluate(() => {
    const e = (window as unknown as { __pxEngine: Eng }).__pxEngine;
    const proto = CanvasRenderingContext2D.prototype, orig = proto.setLineDash, calls: number[][] = [];
    proto.setLineDash = function (d: number[]) { if (d.length) calls.push(d); return orig.call(this, d); };
    try {
      for (const k of [-3, -1, 0, 1, 2, 3, 4, 5]) { const size = 512 / 2 ** k; e.renderGeoTile(k, Math.floor(e.cam.x / size), Math.floor(e.cam.y / size)); }
    } finally { proto.setLineDash = orig; }
    return calls.length;
  });
  expect(dashed).toBe(0);
});

test("commune borders appear only at a closer zoom, and their data is only downloaded then", async ({ page }) => {
  const communeFiles: string[] = [];
  page.on("request", (r) => { if (/\/data\/geo\/m-/.test(r.url())) communeFiles.push(r.url()); });
  // a view of Paris at ×4: départements, no communes
  await page.goto(`/map?x=${PARIS.x}&y=${PARIS.y}&z=4`);
  await engine(page);
  await page.waitForTimeout(1500);
  expect(communeFiles, "no commune data at ×4").toEqual([]);
  const flags = await page.evaluate(() => {
    const e = (window as unknown as { __pxEngine: Eng }).__pxEngine;
    const orig = e.geo.tilePaths.bind(e.geo), seen: Record<number, boolean> = {};
    let current = 0;
    e.geo.tilePaths = (...a: unknown[]) => { seen[current] = Boolean(a[3]); return orig(...a); };
    for (const k of [1, 2, 3, 4, 5]) { current = k; const size = 512 / 2 ** k; e.renderGeoTile(k, Math.floor(e.cam.x / size), Math.floor(e.cam.y / size)); }
    return seen;
  });
  expect(flags).toEqual({ 1: false, 2: false, 3: false, 4: true, 5: true });
  // closer, the commune cells are requested
  await page.goto(`/map?x=${PARIS.x}&y=${PARIS.y}&z=16`);
  await engine(page);
  await expect.poll(() => communeFiles.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("tiles are prepared in advance while the map is idle: a pan then only blits", async ({ page }) => {
  await page.goto(`/map?x=${PARIS.x}&y=${PARIS.y}&z=2`);
  await engine(page);
  const visible = () => page.evaluate(() => {
    const e = (window as unknown as { __pxEngine: Eng }).__pxEngine;
    const k = Math.ceil(Math.log2(e.cam.scale * e.dpr)), size = 512 / 2 ** k;
    const w = window.innerWidth / 2 / e.cam.scale, h = window.innerHeight / 2 / e.cam.scale;
    return (Math.floor((e.cam.x + w) / size) - Math.floor((e.cam.x - w) / size) + 1) * (Math.floor((e.cam.y + h) / size) - Math.floor((e.cam.y - h) / size) + 1);
  });
  const shown = await visible();
  // 1. nobody asks: the idle scheduler alone builds tiles beyond the visible ones
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pxEngine: Eng }).__pxEngine.geoTiles.size), { timeout: 30_000 }).toBeGreaterThan(shown + 3);
  // 2. let it finish (this call is what each idle slot does, one tile at a time; data of the ring may still be on its way)
  await expect.poll(() => page.evaluate(() => { const e = (window as unknown as { __pxEngine: Eng }).__pxEngine; e.warmNow(); return e.warmCandidates().length; }), { timeout: 30_000 }).toBe(0);
  // 3. a pan of less than a tile: every tile it reveals is already there — the drawing never has to rasterise one
  const drawTimeRenders = await page.evaluate(async () => {
    const e = (window as unknown as { __pxEngine: Eng }).__pxEngine;
    const orig = e.renderGeoTile.bind(e); let n = 0;
    e.renderGeoTile = (k, tx, ty, strict) => { if (strict !== true) n++; return orig(k, tx, ty, strict); }; // the pre-rendering passes `strict`
    e.flyTo({ x: e.cam.x + 100, y: e.cam.y + 60, scale: e.cam.scale }, 0);
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
    e.renderGeoTile = orig;
    return n;
  });
  expect(drawTimeRenders).toBe(0);
});

test("the only grid is the 1 px one, and only in the last stretch of the zoom (from ×24; the maximum is ×48)", async ({ page }) => {
  await page.goto(`/map?x=27200&y=11100&z=2`); // free land in Kazakhstan
  await engine(page);
  const drawn = await page.evaluate(async () => {
    const e = (window as unknown as { __pxEngine: Eng & { drawGrid: (s: number) => void } }).__pxEngine;
    const proto = CanvasRenderingContext2D.prototype, stroke = proto.stroke, grid = e.drawGrid.bind(e);
    let inGrid = false, strokes = 0;
    proto.stroke = function (...a: [] | [Path2D]) { if (inGrid) strokes++; return (stroke as (...x: unknown[]) => void).apply(this, a); };
    e.drawGrid = (s: number) => { inGrid = true; try { grid(s); } finally { inGrid = false; } };
    const out: Record<string, boolean> = {};
    try {
      for (const s of [0.05, 0.3, 0.8, 2, 5, 12, 20, 23, 26, 30, 40, 48]) {
        strokes = 0;
        e.flyTo({ x: 27_200, y: 11_100, scale: s }, 0);
        for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
        out[String(s)] = strokes > 0;
      }
    } finally { proto.stroke = stroke; e.drawGrid = grid; }
    return out;
  });
  expect(drawn).toEqual({ "0.05": false, "0.3": false, "0.8": false, "2": false, "5": false, "12": false, "20": false, "23": false, "26": true, "30": true, "40": true, "48": true });
});
