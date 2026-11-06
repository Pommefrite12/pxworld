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
  tiles: Map<string, { state: string }>;
  tileQueue: string[];
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

test("zooming out or panning over land never flashes the ocean colour while the new tiles are being drawn", async ({ page }) => {
  await page.goto(`/map?x=27200&y=11100&z=24`); // the steppe near Omsk: land all around
  await engine(page);
  const flashes = await page.evaluate(async () => {
    const e = (window as unknown as { __pxEngine: Eng & { zoomBy: (f: number) => void; scheduleWarm: () => void } }).__pxEngine;
    e.scheduleWarm = () => undefined; // nothing is prepared in advance here: this is about what is shown while tiles are missing
    const canvas = document.querySelector('[role="application"]') as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const points: [number, number][] = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) points.push([Math.round(canvas.width * (0.3 + 0.1 * i)), Math.round(canvas.height * (0.35 + 0.15 * j))]);
    const isOcean = (d: Uint8ClampedArray) => Math.abs(d[0]! - 13) <= 2 && Math.abs(d[1]! - 26) <= 2 && Math.abs(d[2]! - 62) <= 2; // the night ocean
    let frames = 0, bad = 0;
    const sample = () => new Promise<void>((resolve) => requestAnimationFrame(() => {
      frames++;
      if (points.some(([x, y]) => isOcean(ctx.getImageData(x, y, 1, 1).data))) bad++;
      resolve();
    }));
    const settle = async (n: number) => { for (let i = 0; i < n; i++) await sample(); };
    // four zoom-out steps in a row (a wheel), tiles of every new level missing
    for (let i = 0; i < 4; i++) { e.zoomBy(1 / 1.8); await settle(6); }
    await settle(20);
    // then jumps across the land at the level reached: whole columns of tiles never drawn
    for (let i = 0; i < 4; i++) { e.flyTo({ x: e.cam.x + (i % 2 ? -1 : 1) * 500 / e.cam.scale, y: e.cam.y, scale: e.cam.scale }, 0); await settle(3); }
    await settle(20);
    return { frames, bad };
  });
  expect(flashes.frames).toBeGreaterThan(60);
  expect(flashes.bad, `${flashes.bad} of ${flashes.frames} frames showed the ocean colour over land`).toBe(0);
});

test("after a long zoom the tiles of the view are not queued behind the hundred tiles of the way", async ({ page }) => {
  // every metadata tile takes 250 ms to arrive (a real network): in a first-come queue the last ones wait for seconds
  await page.route(/\/api\/map\/tiles\//, async (route) => { await new Promise((r) => setTimeout(r, 250)); await route.continue(); });
  await page.goto("/");
  await engine(page);
  const frames = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.evaluate(() => (window as unknown as { __pxEngine: Eng }).__pxEngine.flyTo({ x: 20_000, y: 12_500, scale: 0.12 }, 0)); // a hundred tiles in view…
  await frames();
  expect(await page.evaluate(() => (window as unknown as { __pxEngine: Eng }).__pxEngine.tiles.size), "the first view wants many tiles").toBeGreaterThan(40);
  const t0 = Date.now();
  await page.evaluate((c) => (window as unknown as { __pxEngine: Eng }).__pxEngine.flyTo({ ...c, scale: 1.5 }, 0), PARIS); // …then a close view elsewhere
  await frames();
  await page.waitForFunction(() => (window as unknown as { __pxEngine: Eng }).__pxEngine.tiles.get("18,11")?.state === "ready", null, { timeout: 15_000 });
  expect(Date.now() - t0, "the tile under the screen is not behind the ones of the way").toBeLessThan(2000);
  const queued = await page.evaluate(() => (window as unknown as { __pxEngine: Eng }).__pxEngine.tileQueue.length);
  expect(queued, "the tiles nobody looks at any more are forgotten").toBeLessThan(6);
});

test("the water layer of the raster tiles is only asked for where there is water (none anywhere: not at all)", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (r) => { if (/\/api\/map\/raster\/.*[?&]k=w/.test(r.url())) asked.push(r.url()); });
  await page.goto("/");
  await engine(page);
  await page.waitForTimeout(2500);
  expect(await (await page.request.get("/api/map/water")).json()).toEqual({ cell: 512, c: [] });
  expect(asked, "no water parcel yet: the world view must not ask for a second layer of tiles").toEqual([]);
});

/* ------------------------------------------------------------------ a modest PC */
type SlowEng = Eng & { slowUntil: number; zoomBy: (f: number) => void; cb: { onCamera?: (c: unknown) => void }; anim: unknown; geoMissing: number };

test("a slow machine makes no new tile while the camera moves, and makes the sharp ones as soon as it stops", async ({ page }) => {
  await page.goto("/map?x=18983&y=11739&z=0.3");
  await engine(page);
  await page.waitForTimeout(1200);
  // the machine has just shown that it struggles (a long frame), and the visitor zooms in: one level further needs new tiles
  const during = await page.evaluate(async () => {
    const e = (window as unknown as { __pxEngine: SlowEng }).__pxEngine;
    let bakedWhileMoving = 0, sawMoving = false;
    const orig = e.renderGeoTile.bind(e);
    e.renderGeoTile = (...a: Parameters<typeof orig>) => { if (e.anim !== null) bakedWhileMoving++; return orig(...a); };
    e.slowUntil = performance.now() + 60_000;
    e.flyTo({ x: e.cam.x, y: e.cam.y, scale: e.cam.scale * 4 }, 600);
    const t0 = performance.now();
    while (performance.now() - t0 < 900 && (e.anim !== null || !sawMoving)) { await new Promise((r) => requestAnimationFrame(r)); if (e.anim !== null) sawMoving = true; }
    return { bakedWhileMoving, sawMoving };
  });
  expect(during.sawMoving, "the test looked while the zoom was running").toBe(true);
  expect(during.bakedWhileMoving, "no tile is made during the movement").toBe(0);
  // once it stops, the sharp tiles come
  await expect.poll(() => page.evaluate(() => {
    const e = (window as unknown as { __pxEngine: SlowEng }).__pxEngine;
    const k = Math.ceil(Math.log2(e.cam.scale * e.dpr)); // the level of the view: its tiles are there
    return e.anim === null && !e.geoPending && [...e.geoTiles.keys()].filter((key) => key.startsWith(`${k}/`)).length >= 2;
  }), { timeout: 30_000 }).toBe(true);
});

test("a fast machine is not made to wait: it makes tiles while the camera moves", async ({ page }) => {
  await page.goto("/map?x=18983&y=11739&z=0.3");
  await engine(page);
  await page.waitForTimeout(1200);
  const baked = await page.evaluate(async () => {
    const e = (window as unknown as { __pxEngine: SlowEng }).__pxEngine;
    let n = 0;
    const orig = e.renderGeoTile.bind(e);
    e.renderGeoTile = (...a: Parameters<typeof orig>) => { if (e.anim !== null) n++; return orig(...a); };
    e.slowUntil = 0; // nothing slow was ever seen
    e.flyTo({ x: e.cam.x, y: e.cam.y, scale: e.cam.scale * 4 }, 600);
    const t0 = performance.now();
    while (performance.now() - t0 < 900 && e.anim !== null) await new Promise((r) => requestAnimationFrame(r));
    return n;
  });
  expect(baked, "tiles are made as usual").toBeGreaterThan(0);
});

test("the page hears about the camera a few times a second while it moves, and always about its last position", async ({ page }) => {
  await page.goto("/map?x=18983&y=11739&z=0.3");
  await engine(page);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const e = (window as unknown as { __pxEngine: SlowEng & { cb: { onCamera: (c: { scale: number }) => void } } }).__pxEngine;
    const w = window as unknown as { __heard: { scale: number }[] };
    w.__heard = [];
    const orig = e.cb.onCamera!.bind(e.cb);
    e.cb.onCamera = (c) => { w.__heard.push(c as { scale: number }); return orig(c); };
  });
  await page.evaluate(() => { // forty notches in one go, as a free-spinning wheel delivers them
    const c = document.querySelector("canvas[role=application]")!;
    for (let i = 0; i < 40; i++) c.dispatchEvent(new WheelEvent("wheel", { deltaY: -60, clientX: 680, clientY: 430, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const w = window as unknown as { __heard: { scale: number }[]; __pxEngine: SlowEng }; return { heard: w.__heard.length, last: w.__heard[w.__heard.length - 1]?.scale, real: w.__pxEngine.cam.scale }; });
  expect(r.heard, "not once per notch").toBeLessThanOrEqual(4);
  expect(r.heard).toBeGreaterThan(0);
  expect(r.last, "the last position is always delivered").toBeCloseTo(r.real, 6);
});
