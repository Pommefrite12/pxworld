import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * "100 days to save the world" on the map itself: the unacquired land is corrupted as the countdown runs down (lavender field with
 * error colours), the acquired parcels stay intact (no frame, no marker). Preview only (`?preview=`): no date is configured.
 * (Named so that it runs after the journey spec, which asserts exact global counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 27_600, y: 11_300, w: 20, h: 20 };
const BLUE = [0x2b, 0x35, 0xe0];

type Eng = { geoPending: boolean; geo: unknown; story: { step: number } | null; worldToScreen(x: number, y: number): { x: number; y: number } };
const ready = (page: Page) => page.waitForFunction(() => { const e = (window as unknown as { __pxEngine?: Eng }).__pxEngine; return Boolean(e && e.geo && !e.geoPending); }, undefined, { timeout: 60_000 });

/** Of the pixels of the planet (intact land, free ocean, corrupted lavender — land or sea), which share is corrupted? */
const corruptedShare = (page: Page) => page.getByRole("application").evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let cream = 0, lav = 0, sparks = 0, ocean = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    if (r === 251 && g === 245 && b === 230) cream++;
    else if (r === 201 && g === 223 && b === 232) ocean++; // free ocean
    else if ((r === 233 && g === 229 && b === 255) || (r === 220 && g === 214 && b === 255)) lav++;
    else if ((r === 25 && g === 211 && b === 255) || (r === 255 && g === 46 && b === 147)) sparks++; // cyan, magenta: the errors
  }
  return { share: cream + lav + ocean === 0 ? 0 : lav / (cream + lav + ocean), lav, sparks };
});

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1360, height: 860 }); });

test("without the story the land is never corrupted; with it, more and more of it as the days pass, all of it at the end", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.waitForTimeout(1500);
  expect((await corruptedShare(page)).lav, "the ordinary map has no lavender at all").toBe(0);

  const at = async (preview: string) => { await page.goto(`/?preview=${preview}`); await ready(page); await expect(page.getByTestId("doom-plate")).toBeVisible(); };
  await at("J-87");
  await expect.poll(async () => (await corruptedShare(page)).sparks, { timeout: 30_000 }).toBeGreaterThan(20); // the first errors: sparks of cyan and magenta
  await page.waitForTimeout(800);
  expect((await corruptedShare(page)).share, "J-87: nothing destroyed yet").toBeLessThan(0.05);
  await at("J-9");
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.3);
  expect((await corruptedShare(page)).share, "J-9: about half").toBeLessThan(0.62);
  await at("0");
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
});

test("the survivors: a parcel stays intact among the corrupted land, with no frame and no marker of any kind", async ({ page }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.230" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.231" } });
  expect((await api.post("/api/dev/login", { data: { email: "survivor@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.survivor@example.test", role: "admin" } })).ok()).toBeTruthy();
  const image = await sharp({ create: { width: SPOT.w, height: SPOT.h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(SPOT.x), y: String(SPOT.y), w: String(SPOT.w), h: String(SPOT.h), title: "Survivor", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [SPOT.x, SPOT.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);
  expect((await api.get("/api/map/beacons")).status(), "the list of markers no longer exists").toBe(404);

  // orange (the story's accent) around the parcel: neither a frame nor a marker, at the scale of the world or right up close
  const orangeAround = (p: Page, radius: number) => p.getByRole("application").evaluate((c: HTMLCanvasElement, [x, y, radius]) => {
    const e = (window as unknown as { __pxEngine: Eng }).__pxEngine, a = e.worldToScreen(x!, y!), k = c.width / c.clientWidth;
    const px = c.getContext("2d")!.getImageData(Math.max(0, Math.round((a.x - radius!) * k)), Math.max(0, Math.round((a.y - radius!) * k)), Math.round(2 * radius! * k), Math.round(2 * radius! * k)).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] === 240 && px[i + 1] === 67 && px[i + 2] === 22) n++;
    return n;
  }, [SPOT.x + 10, SPOT.y + 10, radius]);
  await page.goto("/?preview=0");
  await ready(page);
  await page.waitForTimeout(2500); // long enough for the markers of the old version to have been drawn
  expect(await orangeAround(page, 14), "no marker from afar").toBe(0);

  // zoomed right in, in the middle of the corrupted land: the creation is untouched and the land around it is corrupted
  await page.goto(`/?preview=0&x=${SPOT.x + 10}&y=${SPOT.y + 10}&z=14`);
  await ready(page);
  const scan = (inside: boolean) => page.getByRole("application").evaluate((c: HTMLCanvasElement, inside) => {
    const k = c.width / c.clientWidth, cx = c.width / 2, cy = c.height / 2, half = 10 * 14 * k; // the parcel is 20 px × 14 = 280 css px wide
    const [x0, y0, w, h] = inside ? [cx - half + 8, cy - half + 8, 2 * half - 16, 2 * half - 16] : [Math.max(0, cx - half - 150 * k), cy - 60 * k, 100 * k, 120 * k];
    const d = c.getContext("2d")!.getImageData(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)).data;
    const colours = new Map<string, number>();
    let lavender = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const key = `${d[i]},${d[i + 1]},${d[i + 2]}`; colours.set(key, (colours.get(key) ?? 0) + 1); n++; if (d[i + 2]! > d[i]! + 5 && d[i + 2]! > d[i + 1]!) lavender++; }
    return { colours: [...colours.keys()], lavender: lavender / n };
  }, inside);
  await expect.poll(async () => (await scan(true)).colours, { timeout: 30_000 }).toEqual([BLUE.join(",")]);
  expect((await scan(false)).lavender, "the land around the parcel is corrupted").toBeGreaterThan(0.8);
  expect(await orangeAround(page, 10 * 14 + 12), "no frame around the parcel").toBe(0);
  await Promise.all([api.dispose(), admin.dispose()]);
});

/* ------------------------------------------------------------------ the fringe of the coasts */
test("the coasts of the destroyed land come apart into cyan and magenta; the intact land keeps its clean coast; it costs little", async ({ page }) => {
  await page.goto("/?preview=0");
  await ready(page);
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
  const r = await page.evaluate(() => {
    type Tile = { c: HTMLCanvasElement };
    const e = (window as unknown as { __pxEngine: { geoTiles: Map<string, unknown>; renderGeoTile(k: number, tx: number, ty: number, strict: boolean, fillOnly: boolean, step?: number): Tile | null; paintCoastFringe?: unknown } }).__pxEngine;
    const keys = [...e.geoTiles.keys()].map((key) => key.split("/").map(Number) as [number, number, number]);
    const level = keys.map((q) => q[0]).sort((a, b) => keys.filter((q) => q[0] === b).length - keys.filter((q) => q[0] === a).length)[0]!;
    const tiles = keys.filter((q) => q[0] === level).slice(0, 12);
    const eng = e as { paintCoastFringe?: unknown };
    // cyan and magenta of the fringe (or of a spark): count them in the tiles, rendered with the story at `step`
    const count = (step: number) => {
      let n = 0;
      for (const [k, tx, ty] of tiles) {
        const c = e.renderGeoTile(k, tx, ty, false, false, step)!.c, d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i]!, G = d[i + 1]!, B = d[i + 2]!;
          if ((R < 90 && G > 170 && B > 220) || (R > 220 && G < 110 && B > 110 && B < 190)) n++;
        }
      }
      return n;
    };
    const none = () => {}; // the engine's own method is hidden behind this (and comes back when the property is deleted)
    const withFringe = count(200), half = count(100), intact = count(0);
    eng.paintCoastFringe = none;
    const without = count(200), halfWithout = count(100), intactWithout = count(0);
    delete eng.paintCoastFringe;
    // the cost: the same tiles drawn with and without the fringe, one after the other, several times over; the best time of each
    // (a busy machine only ever makes a run slower: the fastest one is the true cost)
    const draw = () => { const t0 = performance.now(); for (const [k, tx, ty] of tiles) e.renderGeoTile(k, tx, ty, false, false, 200); return performance.now() - t0; };
    let bestWith = Infinity, bestWithout = Infinity;
    for (let i = 0; i < 8; i++) {
      bestWith = Math.min(bestWith, draw());
      eng.paintCoastFringe = none;
      bestWithout = Math.min(bestWithout, draw());
      delete eng.paintCoastFringe;
    }
    return { tiles: tiles.length, level, fringe: withFringe - without, halfFringe: half - halfWithout, intactFringe: intact - intactWithout, extraMs: (bestWith - bestWithout) / tiles.length };
  });
  expect(r.tiles, "tiles to look at").toBeGreaterThan(3);
  expect(r.fringe, `the end state: the coasts are fringed (level ${r.level})`).toBeGreaterThan(300);
  expect(r.halfFringe, "half way: fewer coasts are fringed").toBeLessThan(r.fringe);
  expect(r.intactFringe, "the intact world: no fringe at all").toBe(0);
  expect(r.extraMs, "the fringe costs only a few ms per tile").toBeLessThan(6); // (about 2 ms measured, best of 8, with software rendering)
});

/* ------------------------------------------------------------------ the final sequence */
type FinEng = Eng & { finale: { start: number; waiting: boolean } | null; fin: { front: number } | null; finaleNow: () => number; canvas: HTMLCanvasElement };

/** The corrupted share of the land within a band of the screen (fractions of its width). */
const bandShare = (page: Page, from: number, to: number) => page.getByRole("application").evaluate((c: HTMLCanvasElement, [a, b]) => {
  const x0 = Math.round(c.width * a!), w = Math.round(c.width * (b! - a!)), d = c.getContext("2d")!.getImageData(x0, 0, w, c.height).data;
  let cream = 0, lav = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!, g = d[i + 1]!, bl = d[i + 2]!;
    if (r === 251 && g === 245 && bl === 230) cream++;
    else if ((r === 233 && g === 229 && bl === 255) || (r === 220 && g === 214 && bl === 255)) lav++;
  }
  return cream + lav === 0 ? 0 : lav / (cream + lav);
}, [from, to]);

/** Is there a front of the sweep on the screen: a whole column of cyan, from top to bottom? */
const hasFront = (page: Page) => page.getByRole("application").evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  for (let x = 0; x < c.width; x++) {
    let n = 0;
    for (let y = 0; y < c.height; y++) { const i = (y * c.width + x) * 4; if (d[i] === 25 && d[i + 1] === 211 && d[i + 2] === 255) n++; }
    if (n > c.height * 0.9) return true;
  }
  return false;
});

/** The average brightness of the screen (0 to 255): a white flash makes it jump. */
const brightness = (page: Page) => page.getByRole("application").evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 16) { sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3; n++; }
  return sum / n;
});

/** Every name the map draws goes through fillText: keep what was drawn (where, in which colour) so that a test can tell what the sweep has erased. */
const recordNames = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __names?: { x: number; ink: boolean; ghost: boolean; front: number | null }[]; __pxEngine?: { fin: { front: number } | null } };
  if (w.__names) return;
  w.__names = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof orig>) {
    const style = String(this.fillStyle).replace(/\s/g, "").toLowerCase();
    // `front`: where the sweep was when this name was drawn (null: not sweeping), so that a frame drawn just before the test moved the clock cannot be mistaken for a late one
    w.__names!.push({ x: args[1], ink: style.startsWith("rgba(31,37,64"), ghost: style === "#19d3ff" || style === "#ff2e93", front: w.__pxEngine?.fin?.front ?? null });
    return orig.apply(this, args);
  };
});
const takeNames = (page: Page) => page.evaluate(() => { const w = window as unknown as { __names: { x: number; ink: boolean; ghost: boolean; front: number | null }[] }; const n = w.__names; w.__names = []; return n; });

/** Opens the end state, plays "Replay the destruction", and lets the test set the clock of the sequence. */
async function replay(page: Page) {
  await page.goto("/?preview=0");
  await ready(page);
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
  await page.locator('[data-testid="doom-replay"]:visible').click();
  await page.waitForFunction(() => { const e = (window as unknown as { __pxEngine: FinEng }).__pxEngine; return Boolean(e.finale && !e.finale.waiting); }, undefined, { timeout: 20_000 });
  const start = await page.evaluate(() => (window as unknown as { __pxEngine: FinEng }).__pxEngine.finale!.start);
  return async (seconds: number) => { // the sequence at `seconds`, then let a few frames draw it
    await page.evaluate(([s, t]) => { (window as unknown as { __pxEngine: FinEng }).__pxEngine.finaleNow = () => (s as number) + (t as number) * 1000; }, [start, seconds]);
    await page.waitForTimeout(400);
  };
}

test("the final sequence: a front sweeps the screen from west to east, the land behind it is the end state, the land ahead is not yet", async ({ page }) => {
  const at = await replay(page);
  expect(await page.getByTestId("doom-message").innerText()).toMatch(/^ERROR 0x064/); // the interface says what is happening
  await expect(page.locator('[data-testid="doom-replay"]')).toHaveCount(0); // nothing to replay while it plays
  const transform = () => page.getByRole("application").evaluate((c: HTMLCanvasElement) => c.style.transform);
  await at(0.1);
  expect(await transform(), "the screen shakes at the start").not.toBe("");
  expect(await hasFront(page), "the front is still off the left edge").toBe(false);
  const white = await brightness(page);
  await at(0.3);
  const fading = await brightness(page);
  await at(0.8); // the flash is over
  const plain = await brightness(page);
  expect(white, "the flash: the whole screen goes white").toBeGreaterThan(230);
  expect(white).toBeGreaterThan(fading);
  expect(fading, "and it takes a moment to fade").toBeGreaterThan(plain + 5);
  expect(await transform(), "the shake goes on after the flash").not.toBe("");
  await at(3);
  expect(await hasFront(page), "the front is on the screen").toBe(true);
  await at(7.25); // the front is in the middle of the screen
  const west = await bandShare(page, 0.02, 0.3), east = await bandShare(page, 0.7, 0.98);
  expect(west, "behind the front: the end state").toBeGreaterThan(0.9);
  expect(east, "ahead of it: the world as it was before the end").toBeLessThan(west - 0.2);
  await at(10.5);
  expect(await bandShare(page, 0.02, 0.5)).toBeGreaterThan(0.9);
  await at(13.6); // over: the end state is permanent and nothing is left of the sequence
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pxEngine: FinEng }).__pxEngine.finale), { timeout: 5000 }).toBeNull();
  expect(await hasFront(page)).toBe(false);
  expect((await corruptedShare(page)).share).toBeGreaterThan(0.9);
  expect(await page.getByRole("application").evaluate((c: HTMLCanvasElement) => c.style.transform)).toBe("");
});

test("the sweep erases the names as it passes, and the end state has none", async ({ page }) => {
  const at = await replay(page);
  await recordNames(page); // (a new page load wipes the recorder: it goes in after the replay is started)
  const front = () => page.evaluate(() => (window as unknown as { __pxEngine: FinEng }).__pxEngine.fin?.front ?? null);
  await takeNames(page);
  await at(0.8); // before the sweep: every name is there
  const before = (await takeNames(page)).filter((n) => n.ink);
  expect(before.length, "the map has its names").toBeGreaterThan(5);
  expect(before.some((n) => n.x < 400) && before.some((n) => n.x > 900), "on both sides of the screen").toBe(true);
  await at(7.25); // the front is in the middle
  const x = (await front())!;
  expect(x).toBeGreaterThan(500);
  expect(x).toBeLessThan(900);
  const sweeping = (await takeNames(page)).filter((n) => n.front !== null && n.front > 400 && n.front < 1000); // only what was drawn while the front was in the middle
  const ink = sweeping.filter((n) => n.ink);
  expect(ink.length, "names are still drawn ahead of the front").toBeGreaterThan(2);
  expect(ink.filter((n) => n.x < n.front! - 260), "none is left far behind the front").toHaveLength(0);
  expect(ink.some((n) => n.x > n.front! + 60), "the ones ahead are untouched").toBe(true);
  await at(13.6);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pxEngine: FinEng }).__pxEngine.finale), { timeout: 5000 }).toBeNull();
  await takeNames(page);
  await page.waitForTimeout(600);
  expect((await takeNames(page)).filter((n) => n.ink), "no name is drawn once it is over").toHaveLength(0);
  // …for good: still none after the page is reloaded in the end state
  await page.goto("/?preview=0");
  await ready(page);
  await recordNames(page);
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
  await takeNames(page);
  await page.waitForTimeout(600);
  expect((await takeNames(page)).filter((n) => n.ink)).toHaveLength(0);
});

test("someone who asked for fewer animations gets the end state fading in: no shake, no front, no flash", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const at = await replay(page);
  await recordNames(page);
  for (const t of [0.1, 1.8]) {
    await at(t);
    expect(await page.getByRole("application").evaluate((c: HTMLCanvasElement) => c.style.transform), `t=${t}: no shake`).toBe("");
    expect(await hasFront(page), `t=${t}: no front`).toBe(false);
    expect(await brightness(page), `t=${t}: no flash`).toBeLessThan(235);
  }
  await at(4);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __pxEngine: FinEng }).__pxEngine.finale), { timeout: 5000 }).toBeNull();
  expect((await corruptedShare(page)).share).toBeGreaterThan(0.9);
  await takeNames(page);
  await page.waitForTimeout(600);
  expect((await takeNames(page)).filter((n) => n.ink), "and the names are gone").toHaveLength(0);
});

test("the sequence plays by itself when the countdown reaches zero in front of the visitor, then the world is gone for good", async ({ page }) => {
  await page.goto("/?preview=T-12"); // the page takes a few seconds to be ready: leave room
  await ready(page);
  const plate = page.getByTestId("doom-plate");
  await expect(plate).toBeVisible();
  await expect(page.getByTestId("doom-message")).toHaveText("Last chance to save: leave your mark before it is too late."); // the last seconds belong to the last chapter
  await expect(page.getByTestId("find-your-spot")).toHaveText("Save my plot");
    // zero: the sequence starts by itself (the interface says so, and nothing can be replayed while it plays)
  await expect(page.getByTestId("doom-message")).toHaveText("ERROR 0x064 — DELETION IN PROGRESS", { timeout: 15_000 });
  await expect(plate).toContainText("WORLD DELETED");
  await expect(page.locator('[data-testid="doom-replay"]')).toHaveCount(0);
  // about fourteen seconds later: the end, for good
  await expect(page.getByTestId("doom-message")).toHaveText(/^The world has been deleted\. (No plot survived\.|\d+ plots? survived\.)$/, { timeout: 30_000 });
  await expect(page.getByTestId("find-your-spot")).toHaveText("Meet the survivors");
  await expect(page.locator('[data-testid="doom-replay"]:visible')).toHaveCount(1);
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 15_000 }).toBeGreaterThan(0.9);
  expect(await hasFront(page)).toBe(false);
});

/* ------------------------------------------------------------------ the bug of the destroyed land, every 30 s */
type Zone = { x: number; y: number; w: number; h: number };
type GlitchEng = Eng & {
  glitch: { t0: number; seed: number; zones: Zone[] | null } | null;
  glitchNow(seed?: number): boolean; setGlitchEverywhere(on: boolean): void; setGlitchEvery(ms: number): void; setGlitchGuard(on: boolean): void;
  slowUntil: number; drawMs: number; cam: { x: number; y: number; scale: number }; w: number; h: number; flyTo(c: { x: number; y: number; scale: number }, ms: number): void;
};
const engine = (page: Page) => page.evaluateHandle(() => (window as unknown as { __pxEngine: GlitchEng }).__pxEngine);
/** A fingerprint of everything on the canvas (every 5th pixel is enough to see a band move). */
const fingerprint = (page: Page) => page.getByRole("application").evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 20) h = Math.imul(h ^ (d[i]! | (d[i + 1]! << 8) | (d[i + 2]! << 16)), 16777619) >>> 0;
  return h;
});
/** The headless browser has no graphics card and is always "slow": the tests turn off the stand-down that a slow machine gets. */
async function destroyedWorld(page: Page) {
  await page.goto("/?preview=0");
  await ready(page);
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
  await page.waitForTimeout(1500); // the tiles are all made
  const e = await engine(page);
  await e.evaluate((x) => x.setGlitchGuard(false));
  return e;
}

test("every so often the destroyed land has a computer bug for about a second and a half, then goes back exactly where it was", async ({ page }) => {
  const e = await destroyedWorld(page);
  const calm = await fingerprint(page);
  expect(await fingerprint(page), "nothing moves between two bugs").toBe(calm);

  expect(await e.evaluate((x) => x.glitchNow())).toBe(true);
  expect(await e.evaluate((x) => x.glitchNow()), "a burst already going on is not restarted").toBe(false);
  await expect.poll(() => fingerprint(page), { timeout: 5000, intervals: [60] }).not.toBe(calm); // the bugged zones move
  await expect.poll(() => e.evaluate((x) => x.glitch === null), { timeout: 5000 }).toBe(true); // it is over after about a second and a half
  await expect.poll(() => fingerprint(page), { timeout: 5000 }).toBe(calm); // and everything is back in place, pixel for pixel
});

test("the bug comes by itself, again and again, on the schedule it is given", async ({ page }) => {
  const e = await destroyedWorld(page);
  await e.evaluate((x) => x.setGlitchEvery(2300)); // longer than a burst, so that there is a calm between two
  const seen: number[] = [];
  for (let i = 0; i < 2; i++) {
    await expect.poll(() => e.evaluate((x) => x.glitch !== null), { timeout: 12_000, intervals: [50] }).toBe(true);
    seen.push(await e.evaluate((x) => x.glitch!.t0));
    await expect.poll(() => e.evaluate((x) => x.glitch === null), { timeout: 5000, intervals: [50] }).toBe(true);
  }
  expect(seen[1]!, "a second burst, after the first").toBeGreaterThan(seen[0]!);
  await e.evaluate((x) => x.setGlitchEvery(30_000));
});

test("no bug on the ordinary map, none for a visitor who asked for fewer animations, none on a machine that struggles", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.waitForTimeout(800);
  expect(await (await engine(page)).evaluate((x) => x.glitchNow()), "no story, no bug").toBe(false);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?preview=0");
  await ready(page);
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
  expect(await (await engine(page)).evaluate((x) => x.glitchNow()), "reduced motion: the land stays still").toBe(false);

  // a machine that struggles does without: the site is never slowed down for a decoration
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?preview=0");
  await ready(page);
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
  const e = await engine(page);
  await e.evaluate((x) => { x.setGlitchGuard(true); x.slowUntil = performance.now() + 60_000; });
  expect(await e.evaluate((x) => x.glitchNow()), "a slow frame was seen lately").toBe(false);
  await e.evaluate((x) => { x.slowUntil = 0; x.drawMs = 80; });
  expect(await e.evaluate((x) => x.glitchNow()), "an average frame of 80 ms").toBe(false);
  await e.evaluate((x) => { x.drawMs = 8; });
  expect(await e.evaluate((x) => x.glitchNow()), "a quick machine does it").toBe(true);
});

test("in the bugged zones the map scrolls from right to left, band by band, and the parcels are left alone", async ({ page }) => {
  const e = await destroyedWorld(page);
  await e.evaluate((x) => x.setGlitchEverywhere(true));
  // every band the engine draws during the burst, from the copy of the picture it takes: (where it comes from, where it goes, how wide)
  const bands = await page.getByRole("application").evaluate(async (c: HTMLCanvasElement) => {
    const eng = (window as unknown as { __pxEngine: GlitchEng }).__pxEngine;
    const proto = CanvasRenderingContext2D.prototype, orig = proto.drawImage, out: { from: number; to: number; w: number }[] = [];
    proto.drawImage = function (this: CanvasRenderingContext2D, img: CanvasImageSource, ...a: number[]) {
      if (this.canvas === c && img instanceof HTMLCanvasElement && img !== c && img.width === c.width && img.height === c.height && a.length === 8) out.push({ from: a[0]!, to: a[4]!, w: a[2]! });
      return orig.apply(this, [img, ...a] as unknown as Parameters<typeof orig>);
    } as typeof orig;
    try {
      eng.glitchNow();
      const t0 = performance.now();
      while (eng.glitch && performance.now() - t0 < 3000) await new Promise((r) => requestAnimationFrame(r));
    } finally { proto.drawImage = orig; }
    return out;
  });
  // each band is drawn in two pieces: the big one, moved to the left, then what went out at the left, coming back in at the right
  expect(bands.length, "bands were drawn").toBeGreaterThan(30);
  const pairs: [typeof bands[0], typeof bands[0]][] = [];
  for (let i = 0; i + 1 < bands.length; i += 2) pairs.push([bands[i]!, bands[i + 1]!]);
  expect(pairs.filter(([big]) => big.to > big.from + 0.5), "no band goes to the right").toEqual([]);
  expect(pairs.filter(([big]) => big.to < big.from - 6).length / pairs.length, "most bands have gone well to the left").toBeGreaterThan(0.5);
  expect(pairs.filter(([big, back]) => back.w > big.w).length, "the piece that comes back in at the right is always the smaller one (a band goes at most 40 % of the zone)").toBe(0);
  await expect.poll(() => e.evaluate((x) => x.glitch === null), { timeout: 5000 }).toBe(true);
});

test("the bugged zones cover a part of the world and are somewhere else on the planisphere each time, the first one where one is looking", async ({ page }) => {
  const e = await destroyedWorld(page);
  // twenty bursts, one after the other: where are their zones?
  const bursts = await e.evaluate((x) => {
    const out: Zone[][] = [];
    for (let seed = 1; seed <= 20; seed++) { x.glitch = null; x.glitchNow(seed * 7919); out.push(x.glitch!.zones!.map((z) => ({ ...z }))); }
    x.glitch = null;
    return out;
  });
  const centres = bursts.flat().map((z) => ({ x: (z.x + z.w / 2) % 40_000, y: z.y + z.h / 2 }));
  expect(bursts.every((z) => z.length >= 3), "a few zones in each burst").toBe(true);
  expect(Math.max(...centres.map((c) => c.x)) - Math.min(...centres.map((c) => c.x)), "all along the planisphere").toBeGreaterThan(25_000);
  expect(Math.max(...centres.map((c) => c.y)) - Math.min(...centres.map((c) => c.y)), "from north to south").toBeGreaterThan(12_000);
  expect(new Set(bursts.map((z) => `${Math.round(z[1]!.x / 500)},${Math.round(z[1]!.y / 500)}`)).size, "another place every time").toBeGreaterThan(15);
  expect(bursts.flat().every((z) => z.w >= 6_000 && z.h >= 3_000), "zones that cover part of the world").toBe(true);

  // zoomed in on a place, the first zone is where one looks, so that the bug is not lost off screen
  await e.evaluate((x) => x.flyTo({ x: 18_980, y: 11_700, scale: 0.4 }, 0));
  await page.waitForTimeout(800);
  const looking = await e.evaluate((x) => {
    const half = { w: x.w / 2 / x.cam.scale, h: x.h / 2 / x.cam.scale }, out: boolean[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      x.glitch = null; x.glitchNow(seed * 104729);
      const z = x.glitch!.zones![0]!;
      const mid = z.x + z.w / 2 - 0.45 * z.w; // halfway through its journey to the left
      out.push(Math.abs(mid - x.cam.x) <= half.w && z.y < x.cam.y + half.h && z.y + z.h > x.cam.y - half.h);
    }
    x.glitch = null;
    return out;
  });
  expect(looking.every(Boolean), "the first zone of each burst is on the screen").toBe(true);
});

test("if the visitor moves the map during the bug, the bug ends at once and leaves nothing behind", async ({ page }) => {
  const e = await destroyedWorld(page);
  expect(await e.evaluate((x) => x.glitchNow(77))).toBe(true);
  await page.waitForTimeout(300);
  await e.evaluate((x) => x.flyTo({ x: x.cam.x + 400, y: x.cam.y, scale: x.cam.scale }, 0));
  await expect.poll(() => e.evaluate((x) => x.glitch === null), { timeout: 3000 }).toBe(true);
  await page.waitForTimeout(600);
  const settled = await fingerprint(page);
  await page.waitForTimeout(400);
  expect(await fingerprint(page), "a clean map, not a stale copy").toBe(settled);
});
