import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { lonLatToPixel } from "../../src/lib/grid/geometry";

/**
 * Free imprints on the SEA (migration 30): the same gift as on land, with the share of water of a water parcel, the quota shared with land, and a paid
 * WATER parcel that covers it. Its own piece of the map, named so that it runs AFTER `map-perf.spec.ts`, which asserts that there is no water parcel
 * anywhere yet (a paid water parcel, and a free one before it is covered, make the map ask for its water layer).
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
let ip = 0;
const contexts: APIRequestContext[] = [];
const as = async (email: string, role?: "admin") => {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${10 + ++ip}` } });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  contexts.push(ctx);
  return ctx;
};
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.dispose())); });

const png = (w: number, h: number, bg: string) => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
const sql = async <T,>(text: string, params: unknown[] = []) => {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try { return (await db.query(text, params)).rows as T[]; } finally { await db.end(); }
};
const place = async (ctx: APIRequestContext, r: { x: number; y: number; w: number; h: number }, title = "A free trace", kind?: "land" | "water") =>
  ctx.post("/api/free-parcel", { multipart: { ...(kind ? { kind } : {}), x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h), description: "A short description", title, category: "daily", image: { name: "c.png", mimeType: "image/png", buffer: await png(r.w, r.h, "#e0352b") } } });

test("a free imprint on the sea: the same gift on water, with the share of water of a water parcel, the same quota, and a paid WATER parcel covers it", async () => {
  const c = lonLatToPixel({ lon: -40, lat: 30 }); // open Atlantic
  const SEA = { x: Math.round(c.x), y: Math.round(c.y), w: 3, h: 3 };
  const LAND = { x: 27_800, y: 11_000, w: 3, h: 3 }; // (the land spot of the first test: only probed here, never taken)
  const wanda = await as("free-wanda@example.test"), xena = await as("free-xena@example.test"), admin = await as("admin.free3@example.test", "admin");
  const stats = async () => (await (await wanda.get("/api/stats")).json()) as { soldPixels: number; parcels: number; freeParcels: number; freePixels: number };
  const before = await stats();

  // the probe knows the kind: free sea here, but not free LAND (no land in it), and a land spot is not free WATER
  const q = (r: { x: number; y: number; w: number; h: number }, kind: string) => `/api/availability?x=${r.x}&y=${r.y}&w=${r.w}&h=${r.h}&free=1&kind=${kind}`;
  expect(await (await wanda.get(q(SEA, "water"))).json()).toMatchObject({ free: true, kind: "water", enough: true, landPixels: 0 });
  expect(await (await wanda.get(q(SEA, "land"))).json()).toMatchObject({ free: false, kind: "land", enough: false });
  expect(await (await wanda.get(q(LAND, "water"))).json()).toMatchObject({ free: false, kind: "water", enough: false });
  expect((await wanda.get(q(SEA, "air"))).status()).toBe(400);
  // the same answers when placing, before anything is stored
  expect((await (await place(wanda, SEA, "On the wrong kind", "land")).json()).error).toBe("px_not_on_land");
  expect((await (await place(wanda, LAND, "On the wrong kind", "water")).json()).error).toBe("px_not_on_water");

  // placed on the sea: 201, active at once, a free WATER parcel, no payment, counted as free (not sold)
  const r = await place(wanda, SEA, "A free trace on the sea", "water");
  expect(r.status(), await r.text()).toBe(201);
  const { code } = (await r.json()) as { code: string };
  expect(await (await wanda.get(`/api/parcels/${code}`)).json()).toMatchObject({ code, tier: "free", kind: "water", w: 3, h: 3, area: 9, coveredAt: null });
  const after = await stats();
  expect(after.soldPixels, "a free parcel is not a sale").toBe(before.soldPixels);
  expect(after.parcels).toBe(before.parcels);
  expect(after.freeParcels).toBe(before.freeParcels + 1);
  expect(after.freePixels).toBe(before.freePixels + 9);

  // one at a time for the account, whatever the kind; nobody can place over it
  expect((await (await place(wanda, { ...SEA, x: SEA.x + 10 }, "Second", "water")).json()).error).toBe("px_free_quota");
  expect((await (await place(xena, { ...SEA, x: SEA.x + 1, y: SEA.y + 1, w: 2, h: 2 }, "Over it", "water")).json()).error).toBe("px_parcel_unavailable");

  // after moderation the tile carries it as a WATER parcel flagged free (so a purchase is never blocked by it)
  const asset = await sql<{ id: string }>(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.code = $1 and a.status = 'pending'`, [code]);
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: asset[0]!.id, decision: "approve" } })).status()).toBe(200);
  const tileUrl = (v: number) => `/api/map/tiles/${Math.floor(SEA.x / 1000)}/${Math.floor(SEA.y / 1000)}?v=${v}`;
  const tile = (await (await wanda.get(tileUrl(Date.now()))).json()) as unknown[][];
  const row = tile.find((p) => p[0] === code);
  expect(row?.[7], "a water parcel").toBe(1);
  expect(row?.[8], "flagged free").toBe(1);

  // a paid LAND parcel on the same rectangle would leave it alone; a paid WATER parcel that touches one corner covers it, whole
  const image = await png(5, 5, "#2b35e0");
  const buy = async (user: APIRequestContext, kind: "land" | "water", rect: { x: number; y: number }) => {
    const c2 = await user.post("/api/checkout", { multipart: { kind, x: String(rect.x), y: String(rect.y), w: "5", h: "5", description: "A short description", title: `Over a free ${kind}`, category: "daily", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
    expect(c2.status(), await c2.text()).toBe(200);
    const { orderId } = await c2.json();
    expect((await (await user.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  };
  await buy(xena, "water", { x: SEA.x - 3, y: SEA.y - 3 });
  const covered = await (await wanda.get(`/api/parcels/${code}`)).json();
  expect(covered).toMatchObject({ code, tier: "free", kind: "water" });
  expect(covered.coveredAt).toBeTruthy();
  const tile2 = (await (await wanda.get(tileUrl(Date.now() + 1))).json()) as unknown[][];
  expect(tile2.find((p) => p[0] === code), "covered: not on the map any more").toBeUndefined();
  expect((await stats()).freeParcels).toBe(before.freeParcels);
});

test("the buy panel offers a free imprint on the sea: in water mode the free sizes are offered, keep the kind, and the price says Free", async ({ page }) => {
  const c = lonLatToPixel({ lon: -45, lat: 28 });
  const SEA = { x: Math.round(c.x), y: Math.round(c.y), w: 3, h: 3 };
  const yara = await as("free-yara@example.test");
  await page.context().addCookies((await yara.storageState()).cookies);
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/map?bx=${SEA.x}&by=${SEA.y}&bw=${SEA.w}&bh=${SEA.h}&bk=water`);
  await expect(page.getByTestId("buy-panel")).toBeVisible();
  await expect(page.getByTestId("buy-kind-water")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("buy-free")).toBeVisible();
  await expect(page.getByTestId("buy-free")).toContainText(/on land or on water/i);
  await expect(page.getByTestId("buy-price")).toHaveText("Free");
  await expect(page.getByTestId("buy-status")).toContainText(/Free spot/i);
  await expect(page.getByTestId("buy-continue")).toHaveText("Create my free trace");
  // a free size keeps the kind (it used to switch back to land)
  await page.getByTestId("buy-free-2x2").click();
  await expect(page.getByTestId("buy-kind-water")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("buy-price")).toHaveText("Free");
  // on land the same sea is not a land parcel
  await page.getByTestId("buy-kind-land").click();
  await expect(page.getByTestId("buy-status")).not.toContainText(/Free spot/i);
  await page.getByTestId("buy-kind-water").click();
  await expect(page.getByTestId("buy-status")).toContainText(/Free spot/i);
  // the dialog is the free one, with the water note of the sea
  await page.getByTestId("buy-continue").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("co-free-note")).toBeVisible();
  await expect(dialog.getByTestId("co-water-note")).toContainText(/blue/i);
});
