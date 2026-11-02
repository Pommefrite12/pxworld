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
  const r = await api.post("/api/checkout", { multipart: { x: String(SPOT.x), y: String(SPOT.y), w: String(SPOT.w), h: String(SPOT.h), title: "Grid test", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
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
  const r = await api.post("/api/checkout", { multipart: { x: String(COAST.x), y: String(COAST.y), w: "60", h: "60", title: "Coast test", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
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
      else if (Math.abs(d[i]! - 201) < 4 && Math.abs(d[i + 1]! - 223) < 4 && Math.abs(d[i + 2]! - 232) < 4) sea++;
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
  const r = await api.post("/api/checkout", { multipart: { x: String(SPOT2.x), y: String(SPOT2.y), w: String(SPOT2.w), h: String(SPOT2.h), title: TITLE, image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [SPOT2.x, SPOT2.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);

  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto("/");
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
