import { expect, request as pwRequest, test } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * How taken parcels look on the map. (Own piece of the map, in Russia/Kazakhstan; named so that it runs after the journey
 * spec, which asserts exact global counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 27_000, y: 11_000, w: 10, h: 10 };
const GRID_ZOOM = 36; // the 1 px grid only exists in the last stretch of the zoom (from ×24 to ×48)
const BLUE = [0x2b, 0x35, 0xe0, 255];

test("the pixel grid is a guide to FREE land: a taken parcel shows its creation with no grid line across it", async ({ page }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.200" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.201" } });
  expect((await api.post("/api/dev/login", { data: { email: "gridowner@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.grid@example.test", role: "admin" } })).ok()).toBeTruthy();
  const image = await sharp({ create: { width: SPOT.w, height: SPOT.h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(SPOT.x), y: String(SPOT.y), w: String(SPOT.w), h: String(SPOT.h), description: "A short description", title: "Grid test", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const admin_url = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
  const db = new pg.Client({ connectionString: admin_url });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [SPOT.x, SPOT.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);

  // centred on the parcel, 36 screen pixels per grid pixel: the 1 px grid (the only one) is clearly drawn on free land
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/map?x=${SPOT.x + SPOT.w / 2}&y=${SPOT.y + SPOT.h / 2}&z=${GRID_ZOOM}`);
  const map = page.getByRole("application");
  const scan = (inside: boolean) => map.evaluate((c: HTMLCanvasElement, { inside, halfCss }: { inside: boolean; halfCss: number }) => {
    const k = c.width / c.clientWidth; // device pixels per CSS pixel
    const cx = c.width / 2, cy = c.height / 2, half = halfCss * k; // the parcel is 10 px × 36 = 360 screen px wide
    const [x0, y0, w, h] = inside ? [cx - half + 8, cy - half + 8, 2 * half - 16, 2 * half - 16] : [8, 8, Math.max(8, cx - half - 16), 200];
    const d = c.getContext("2d")!.getImageData(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)).data;
    const colours = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) { const key = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`; colours.set(key, (colours.get(key) ?? 0) + 1); }
    return [...colours.entries()].sort((a, b) => b[1] - a[1]);
  }, { inside, halfCss: (SPOT.w / 2) * GRID_ZOOM });

  // wait for the creation to be on screen (tiles + image load)
  await expect.poll(async () => (await scan(true))[0]?.[0], { timeout: 30_000 }).toBe(BLUE.join(","));
  const inside = await scan(true);
  expect(inside.map(([k]) => k), "the parcel is one uniform colour: nothing is drawn across it").toEqual([BLUE.join(",")]);
  // …while the free land next to it does carry the grid: the land colour and the grid line colour
  const outside = await scan(false);
  expect(outside.length, "the free land around it is gridded").toBeGreaterThanOrEqual(2);
  await Promise.all([api.dispose(), admin.dispose()]);
});

test("a parcel on the coast keeps its rectangle, but its drawing is cut along the coast: the sea stays sea", async ({ page }) => {
  const COAST = { x: 18_220, y: 11_340, w: 60, h: 60 }; // the Channel coast: 1 903 of its 3 600 pixels are land (52.9 %)
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.202" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.203" } });
  expect((await api.post("/api/dev/login", { data: { email: "coastowner@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.coast@example.test", role: "admin" } })).ok()).toBeTruthy();
  const probe = await (await api.get(`/api/availability?x=${COAST.x}&y=${COAST.y}&w=60&h=60`)).json();
  expect(probe).toMatchObject({ free: true, onLand: true, landPixels: 1903 });
  const image = await sharp({ create: { width: COAST.w, height: COAST.h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(COAST.x), y: String(COAST.y), w: "60", h: "60", description: "A short description", title: "Coast test", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [COAST.x, COAST.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);

  // centred on the parcel, 10 screen pixels per grid pixel: the rectangle is 600 × 600
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/map?x=${COAST.x + 30}&y=${COAST.y + 30}&z=10`);
  const shares = () => page.getByRole("application").evaluate((c: HTMLCanvasElement) => {
    const k = c.width / c.clientWidth, half = 30 * 10 * k;
    const x0 = Math.round(c.width / 2 - half + 2), y0 = Math.round(c.height / 2 - half + 2), size = Math.round(2 * half - 4);
    const d = c.getContext("2d")!.getImageData(x0, y0, size, size).data;
    let blue = 0, sea = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 0x2b && d[i + 1] === 0x35 && d[i + 2] === 0xe0) blue++;
      else if (Math.abs(d[i]! - 13) < 4 && Math.abs(d[i + 1]! - 26) < 4 && Math.abs(d[i + 2]! - 62) < 4) sea++; // the night ocean
    }
    return { blue: blue / (d.length / 4), sea: sea / (d.length / 4) };
  });
  await expect.poll(async () => (await shares()).blue, { timeout: 30_000 }).toBeGreaterThan(0.2); // the creation is on screen
  const { blue, sea } = await shares();
  expect(blue, "the drawing covers the land part of the rectangle (about 53 %)").toBeGreaterThan(0.44);
  expect(blue, "…and not the sea part").toBeLessThan(0.62);
  expect(sea, "the sea part of the rectangle shows the sea").toBeGreaterThan(0.3);
  await Promise.all([api.dispose(), admin.dispose()]);
});

test("the latest-creations tile shows real published creations; one click flies to the parcel and opens its card; the bar shows the % sold", async ({ page }) => {
  const SPOT2 = { x: 27_200, y: 11_200, w: 30, h: 30 };
  const TITLE = "Latest tile test";
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.204" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.205" } });
  expect((await api.post("/api/dev/login", { data: { email: "latestowner@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.latest@example.test", role: "admin" } })).ok()).toBeTruthy();
  const image = await sharp({ create: { width: SPOT2.w, height: SPOT2.h, channels: 3, background: "#d12b2b" } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(SPOT2.x), y: String(SPOT2.y), w: String(SPOT2.w), h: String(SPOT2.h), description: "A short description", title: TITLE, image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [SPOT2.x, SPOT2.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);

  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto("/map");
  // the % is the real share: what has been sold so far (this and the other tests' parcels) over the land total, never rounded to 0
  const stats = await (await api.get("/api/stats")).json();
  expect(stats.soldPixels).toBeGreaterThan(0);
  const label = await page.getByTestId("sold-percent").innerText();
  expect(label).toMatch(/^0[.,]\d+\s?%$/);
  const shown = Number(label.replace(",", ".").replace(/[^\d.]/g, "")), real = (stats.soldPixels / stats.totalPixels) * 100;
  expect(Math.abs(shown - real) / real, `${label} vs ${real}`).toBeLessThan(0.06); // two significant digits
  // the newest creation is the first one of the tile, and the arrow leads to the whole gallery
  const tile = page.getByTestId("latest-tile");
  await expect(tile.getByTestId("latest-item").first()).toBeVisible();
  await expect(tile.getByTestId("latest-item").first()).toHaveAttribute("aria-label", `Open ${TITLE}`);
  expect(await tile.getByTestId("latest-item").count()).toBeLessThanOrEqual(4);
  await expect(tile.getByTestId("latest-all")).toHaveAttribute("href", /\/discover$/);
  // …a click flies to that parcel and opens its card (title, owner)
  await tile.getByTestId("latest-item").first().click();
  await expect(page.getByRole("article").getByRole("heading", { name: TITLE })).toBeVisible();
  await expect.poll(() => page.evaluate(() => { const e = (window as unknown as { __pxEngine?: { cam: { x: number; y: number; scale: number } } }).__pxEngine; return e ? Math.round(e.cam.x) : 0; }), { timeout: 10_000 }).toBe(SPOT2.x + SPOT2.w / 2);
  await Promise.all([api.dispose(), admin.dispose()]);
});

/**
 * Zooming through ×1 (the map switches from the server's raster pictures to drawing each parcel from its own picture): a big creation
 * is never a flat block of its average colour while its picture is on the way, and zoomed out no place name is written over it.
 * (In Germany, where the names of Brandenburg and Berlin used to be drawn across it. The pictures are slowed down on purpose.)
 */
test("zooming in or out, a big creation is never a flat colour while its picture loads, and no place name is written over it", async ({ page }) => {
  const BIG = { x: 20_100, y: 11_000, w: 260, h: 160 };
  const LEFT = [43, 53, 224], RIGHT = [224, 53, 43]; // two plain halves: their average (133, 53, 133) is a colour the picture does not contain
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.206" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.207" } });
  expect((await api.post("/api/dev/login", { data: { email: "bigowner@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.big@example.test", role: "admin" } })).ok()).toBeTruthy();
  const raw = Buffer.alloc(BIG.w * BIG.h * 3);
  for (let y = 0; y < BIG.h; y++) for (let x = 0; x < BIG.w; x++) raw.set(x < BIG.w / 2 ? LEFT : RIGHT, (y * BIG.w + x) * 3);
  const image = await sharp(raw, { raw: { width: BIG.w, height: BIG.h, channels: 3 } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(BIG.x), y: String(BIG.y), w: String(BIG.w), h: String(BIG.h), description: "A short description", title: "Big creation", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [BIG.x, BIG.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);

  const SLOW = 4_000;
  await page.route("**/api/assets/**", async (route) => { await new Promise((res) => setTimeout(res, SLOW)); await route.continue(); }); // a slow network for the pictures only
  await page.setViewportSize({ width: 1100, height: 760 });
  type Eng = { geo: unknown; geoPending: boolean; dpr: number; worldToScreen(x: number, y: number): { x: number; y: number }; flyTo(cam: { x: number; y: number; scale: number }, ms: number): void };
  const ready = () => page.waitForFunction(() => { const e = (window as unknown as { __pxEngine?: Eng }).__pxEngine; return Boolean(e && e.geo && !e.geoPending); }, undefined, { timeout: 60_000 });
  /** Every sample point of the left (then right) half of the creation, as read on the canvas: how many are not exactly that half's colour. */
  const wrong = (half: "left" | "right") => page.evaluate(([bx, by, bw, bh, rgb, side]) => {
    const e = (window as unknown as { __pxEngine: Eng }).__pxEngine, c = document.querySelector("canvas")!, g = c.getContext("2d")!;
    const [r0, g0, b0] = rgb as number[];
    let bad = 0, n = 0;
    for (let fy = 0.2; fy <= 0.8; fy += 0.1) for (let fx = side === "left" ? 0.1 : 0.6; fx <= (side === "left" ? 0.4 : 0.9); fx += 0.1) {
      const a = e.worldToScreen((bx as number) + (bw as number) * fx, (by as number) + (bh as number) * fy);
      const d = g.getImageData(Math.round(a.x * e.dpr), Math.round(a.y * e.dpr), 1, 1).data;
      n++;
      if (d[0] !== r0 || d[1] !== g0 || d[2] !== b0) bad++;
    }
    return bad / n;
  }, [BIG.x, BIG.y, BIG.w, BIG.h, half === "left" ? LEFT : RIGHT, half] as const);
  const centre = { x: BIG.x + BIG.w / 2, y: BIG.y + BIG.h / 2 };

  // 1. zoomed out (×0.62: the rasters), the names of the region are drawn but not across the creation: its two halves are clean
  await page.goto(`/map?x=${centre.x}&y=${centre.y}&z=0.62`);
  await ready();
  await expect.poll(() => wrong("left"), { timeout: 30_000, message: "the left half of the creation is on screen, with nothing written over it" }).toBe(0);
  expect(await wrong("right"), "nor over the right half").toBe(0);

  // 2. zoom in past ×1 at once: its own picture is 4 s away, the creation already shows its two halves (the raster in memory stands in), not their average
  await page.evaluate(([x, y]) => (window as unknown as { __pxEngine: Eng }).__pxEngine.flyTo({ x: x!, y: y!, scale: 1.7 }, 0), [centre.x, centre.y]);
  await expect.poll(() => wrong("left"), { timeout: SLOW - 1_500, message: "the creation is not a flat block while its picture loads" }).toBe(0);
  expect(await wrong("right")).toBe(0);
  // …and it still shows them once its own picture is there
  await page.waitForTimeout(SLOW + 1_500);
  expect(await wrong("left")).toBe(0);
  expect(await wrong("right")).toBe(0);

  // 3. straight at ×1.7 with nothing in memory (a shared link): the raster of that place is asked for, and shows the creation before its picture arrives
  await page.goto(`/map?x=${centre.x}&y=${centre.y}&z=1.7`);
  await ready();
  await expect.poll(() => wrong("left"), { timeout: SLOW - 1_500, message: "a shared link at ×1.7: no flat block either" }).toBe(0);
  expect(await wrong("right")).toBe(0);
  await Promise.all([api.dispose(), admin.dispose()]);
});

/**
 * While buying, a click on a parcel that is already taken used to do nothing visible but put a blocked rectangle on it. It now opens the
 * parcel's card (the buy panel keeps the right side, the card sits on the left), and the rectangle stays where it was.
 */
test("buying: a click on a taken parcel opens its card (the rectangle stays); a click on free land closes it and places the rectangle", async ({ page }) => {
  const TAKEN = { x: 27_400, y: 11_000, w: 40, h: 30 };
  const TITLE = "Card while buying";
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.208" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.209" } });
  expect((await api.post("/api/dev/login", { data: { email: "cardowner@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.card@example.test", role: "admin" } })).ok()).toBeTruthy();
  const image = await sharp({ create: { width: TAKEN.w, height: TAKEN.h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(TAKEN.x), y: String(TAKEN.y), w: String(TAKEN.w), h: String(TAKEN.h), description: "A short description", title: TITLE, image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [TAKEN.x, TAKEN.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);

  type Eng = { geo: unknown; geoPending: boolean; selection: unknown; parcelAt(x: number, y: number): { code: string } | null; worldToScreen(x: number, y: number): { x: number; y: number } };
  const selection = () => page.evaluate(() => (window as unknown as { __pxEngine: Eng }).__pxEngine.selection);
  await page.setViewportSize({ width: 1360, height: 860 });
  const centre = { x: TAKEN.x + TAKEN.w / 2, y: TAKEN.y + TAKEN.h / 2 };
  await page.goto(`/map?x=${centre.x}&y=${centre.y}&z=8`); // 8 screen px per grid px: the parcel is 320 × 240 on screen
  await page.waitForFunction(() => { const e = (window as unknown as { __pxEngine?: Eng }).__pxEngine; return Boolean(e && e.geo && !e.geoPending); }, undefined, { timeout: 60_000 });
  await page.getByTestId("find-your-spot").click();
  await expect(page.getByTestId("buy-panel")).toBeVisible();
  // the tile of the parcel is there: the engine knows who owns the pixel under the pointer
  await expect.poll(() => page.evaluate(([x, y]) => (window as unknown as { __pxEngine: Eng }).__pxEngine.parcelAt(x!, y!) !== null, [centre.x, centre.y]), { timeout: 30_000 }).toBe(true);

  const box = (await page.getByRole("application").boundingBox())!;
  const at = async (wx: number, wy: number) => { const p = await page.evaluate(([x, y]) => (window as unknown as { __pxEngine: Eng }).__pxEngine.worldToScreen(x!, y!), [wx, wy]); return { x: box.x + p.x, y: box.y + p.y }; };

  // hovering it: the pointing hand (not the crosshair of the free land)
  const c = await at(centre.x, centre.y);
  await page.mouse.move(c.x, c.y);
  await expect.poll(() => page.getByRole("application").evaluate((el) => (el as HTMLElement).style.cursor)).toBe("pointer");
  // a click on it: its card opens (title, owner), the buy panel stays, and no rectangle was put on the taken parcel
  await page.mouse.click(c.x, c.y);
  const card = page.getByRole("article");
  await expect(card.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(page.getByTestId("buy-panel")).toBeVisible();
  expect(await selection(), "no rectangle on a taken parcel").toBeNull();
  // the card and the panel do not cover each other
  const cb = (await card.boundingBox())!, pb = (await page.getByTestId("buy-panel").boundingBox())!;
  expect(cb.x + cb.width, "the card is left of the buy panel").toBeLessThanOrEqual(pb.x);

  // a click on free land (left of the parcel, out of the card's way): the card closes and the rectangle is placed there
  const free = await at(TAKEN.x - 30, centre.y);
  await page.mouse.click(Math.max(box.x + 420, free.x), free.y + 120);
  await expect(card).toHaveCount(0);
  await expect.poll(selection, { timeout: 10_000 }).not.toBeNull();
  await Promise.all([api.dispose(), admin.dispose()]);
});
