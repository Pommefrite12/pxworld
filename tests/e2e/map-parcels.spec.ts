import { expect, request as pwRequest, test } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * How taken parcels look on the map. (Own piece of the map, in Russia/Kazakhstan; named so that it runs after the journey
 * spec, which asserts exact global counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 27_000, y: 11_000, w: 40, h: 40 };
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

  // centred on the parcel, 12 screen pixels per grid pixel: the 1 px and 10 px grids are both clearly drawn on free land
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/map?x=${SPOT.x + SPOT.w / 2}&y=${SPOT.y + SPOT.h / 2}&z=12`);
  const map = page.getByRole("application");
  const scan = (inside: boolean) => map.evaluate((c: HTMLCanvasElement, inside) => {
    const k = c.width / c.clientWidth; // device pixels per CSS pixel
    const cx = c.width / 2, cy = c.height / 2, half = 20 * 12 * k; // the parcel is 40 px × 12 = 480 screen px wide
    const [x0, y0, w, h] = inside ? [cx - half + 8, cy - half + 8, 2 * half - 16, 2 * half - 16] : [8, 8, Math.max(8, cx - half - 16), 200];
    const d = c.getContext("2d")!.getImageData(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)).data;
    const colours = new Map<string, number>();
    for (let i = 0; i < d.length; i += 4) { const key = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`; colours.set(key, (colours.get(key) ?? 0) + 1); }
    return [...colours.entries()].sort((a, b) => b[1] - a[1]);
  }, inside);

  // wait for the creation to be on screen (tiles + image load)
  await expect.poll(async () => (await scan(true))[0]?.[0], { timeout: 30_000 }).toBe(BLUE.join(","));
  const inside = await scan(true);
  expect(inside.map(([k]) => k), "the parcel is one uniform colour: nothing is drawn across it").toEqual([BLUE.join(",")]);
  // …while the free land next to it does carry the grid (and the map): several colours
  const outside = await scan(false);
  expect(outside.length, "the free land around it is gridded").toBeGreaterThan(2);
  await Promise.all([api.dispose(), admin.dispose()]);
});
