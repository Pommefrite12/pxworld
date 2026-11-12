import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * Free imprints: a small parcel (1 to 24 pixels) that anybody with a verified e-mail places for nothing at the start of the edition, and that a
 * paid parcel covers when it touches it. (Own piece of the map; named so that it runs after the journey spec, which asserts exact global
 * counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
let ip = 0;
const contexts: APIRequestContext[] = [];
const as = async (email: string, role?: "admin") => {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${160 + ++ip}` } });
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
const place = async (ctx: APIRequestContext, r: { x: number; y: number; w: number; h: number }, title = "A free trace") =>
  ctx.post("/api/free-parcel", { multipart: { x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h), title, category: "daily", image: { name: "c.png", mimeType: "image/png", buffer: await png(r.w, r.h, "#e0352b") } } });

test("a free imprint: placed for nothing, counted apart, limited per account; a purchase that touches it covers it, and its owner is told", async ({ page }) => {
  const SPOT = { x: 27_800, y: 11_000, w: 3, h: 3 };
  const alice = await as("free-alice@example.test"), bob = await as("free-bob@example.test"), admin = await as("admin.free@example.test", "admin");
  const stats = async () => (await (await alice.get("/api/stats")).json()) as { soldPixels: number; parcels: number; freeParcels: number; freePixels: number };
  const before = await stats();

  // the probe: free land, small enough, nothing there
  const probe = await (await alice.get(`/api/availability?x=${SPOT.x}&y=${SPOT.y}&w=${SPOT.w}&h=${SPOT.h}&free=1`)).json();
  expect(probe).toMatchObject({ free: true, kind: "land" });
  // too big for a gift (25 px is a paid parcel) and not a free size at all
  expect((await alice.get(`/api/availability?x=${SPOT.x}&y=${SPOT.y}&w=5&h=5&free=1`)).status()).toBe(400);
  expect((await place(alice, { ...SPOT, w: 5, h: 5 })).status()).toBe(400);

  // placed: 201, active at once, no payment
  const r = await place(alice, SPOT);
  expect(r.status(), await r.text()).toBe(201);
  const { code } = (await r.json()) as { code: string };
  expect(code).toMatch(/^[0-9a-f]{10}$/);
  const info = await (await alice.get(`/api/parcels/${code}`)).json();
  expect(info).toMatchObject({ code, tier: "free", w: 3, h: 3, area: 9, coveredAt: null });
  const after = await stats();
  expect(after.soldPixels, "a free parcel is not a sale").toBe(before.soldPixels);
  expect(after.parcels).toBe(before.parcels);
  expect(after.freeParcels).toBe(before.freeParcels + 1);
  expect(after.freePixels).toBe(before.freePixels + 9);
  expect((await sql<{ n: number }>(`select count(*)::int as n from public.orders o join public.parcels p on p.id = o.parcel_id where p.code = $1`, [code]))[0]!.n).toBe(0);

  // one at a time per account; nobody can place over it, and an anonymous visitor cannot place at all
  expect((await (await place(alice, { x: 27_810, y: 11_000, w: 2, h: 2 })).json()).error).toBe("px_free_quota");
  expect((await (await place(bob, { x: 27_801, y: 11_001, w: 2, h: 2 })).json()).error).toBe("px_parcel_unavailable");
  const anon = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.250" } });
  expect((await place(anon, { x: 27_830, y: 11_000, w: 2, h: 2 })).status()).toBe(401);
  await anon.dispose();

  // its creation goes through moderation like any other; the tile says it is a free one
  const asset = await sql<{ id: string }>(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.code = $1 and a.status = 'pending'`, [code]);
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: asset[0]!.id, decision: "approve" } })).status()).toBe(200);
  const tile = (await (await alice.get(`/api/map/tiles/27/11?v=${Date.now()}`)).json()) as unknown[][];
  expect(tile.find((p) => p[0] === code)?.[8], "the tile flags it as free").toBe(1);

  // a PURCHASE is never blocked by it: bob buys a 5 × 5 that touches one corner, and pays
  const image = await png(5, 5, "#2b35e0");
  const c = await bob.post("/api/checkout", { multipart: { x: String(SPOT.x - 3), y: String(SPOT.y - 3), w: "5", h: "5", title: "Over a free one", category: "daily", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(c.status(), await c.text()).toBe(200);
  const { orderId } = await c.json();
  expect((await (await bob.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");

  // covered: whole, final, still readable with its mention; no longer on the map; the counters moved
  const covered = await (await alice.get(`/api/parcels/${code}`)).json();
  expect(covered).toMatchObject({ code, tier: "free" });
  expect(covered.coveredAt).toBeTruthy();
  const tile2 = (await (await alice.get(`/api/map/tiles/27/11?v=${Date.now() + 1}`)).json()) as unknown[][];
  expect(tile2.find((p) => p[0] === code), "covered: not on the map any more").toBeUndefined();
  const end = await stats();
  expect(end.freeParcels).toBe(before.freeParcels);
  expect(end.soldPixels).toBe(before.soldPixels + 25);
  await page.context().addCookies((await alice.storageState()).cookies);
  await page.goto(`/archive/${code}`);
  await expect(page.getByTestId("archive-covered")).toContainText("was covered on");
  await expect(page.getByTestId("archive-free")).toHaveText("Free trace");
  await expect(page.getByTestId("archive-on-map")).toHaveCount(0);
  await page.goto(`/p/${code}`); // the permanent address of a covered one is its archive page
  await expect(page).toHaveURL(new RegExp(`/archive/${code}$`));
  // its owner learns it on the account page, and can place another one at once
  await page.goto("/account");
  await expect(page.getByTestId("news-covered")).toContainText("was covered by a paid parcel");
  await page.goto("/account/parcels");
  await expect(page.getByTestId("my-parcel-covered")).toContainText("Covered on");
  const again = await place(alice, { x: 27_810, y: 11_000, w: 2, h: 2 }, "Another");
  expect(again.status(), await again.text()).toBe(201);
});

test("the buy panel offers a free imprint: free sizes, the price says Free, the design and the placing, then the account has used its turn", async ({ page }) => {
  const SPOT = { x: 27_840, y: 11_000, w: 3, h: 3 };
  const carol = await as("free-carol@example.test");
  await page.context().addCookies((await carol.storageState()).cookies);
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/map?bx=${SPOT.x}&by=${SPOT.y}&bw=${SPOT.w}&bh=${SPOT.h}`); // a small rectangle: a free one
  await expect(page.getByTestId("buy-panel")).toBeVisible();
  await expect(page.getByTestId("buy-free")).toBeVisible();
  await expect(page.getByTestId("buy-free-3x3")).toHaveText(/3×3\s*Free/);
  await expect(page.getByTestId("buy-price")).toHaveText("Free");
  await expect(page.getByTestId("buy-status")).toContainText(/Free spot/i);
  await expect(page.getByTestId("buy-continue")).toHaveText("Create my free trace");
  await expect(page.getByTestId("buy-collective")).toHaveCount(0); // a group project is for big parcels
  await expect(page.getByTestId("buy-free-note")).toContainText("precarious");
  await expect(page.getByTestId("buy-custom").locator("legend")).toHaveText("Custom dimensions"); // the width and height fields have a title

  await page.getByTestId("buy-continue").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("co-free-note")).toBeVisible();
  const canvas = dialog.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.85, { steps: 10 });
  await page.mouse.up();
  await dialog.getByTestId("to-review").click();
  await dialog.getByTestId("co-title").fill("My first free trace");
  await dialog.getByTestId("co-category").selectOption("daily");
  await expect(dialog.getByTestId("co-total")).toHaveText("Free");
  await dialog.getByTestId("co-accept").check();
  await expect(dialog.getByTestId("co-pay")).toHaveText("Place my trace");
  await dialog.getByTestId("co-pay").click();
  await page.waitForURL(/\/archive\/[0-9a-f]{10}/); // placed: its own archive page, waiting for moderation
  await expect(page.getByTestId("archive-free")).toBeVisible();
  await expect(page.getByTestId("archive-pending")).toContainText(/as soon as a moderator has validated it/i);

  // the turn is used: the panel says so, and the status explains why a small size is refused
  await page.goto(`/map?bx=${SPOT.x + 10}&by=${SPOT.y}&bw=3&bh=3`);
  await expect(page.getByTestId("buy-free-why")).toContainText("already have a free trace");
  await expect(page.getByTestId("buy-status")).toContainText("already have a free trace");
  await expect(page.getByTestId("buy-continue")).toBeDisabled();
});

test("the free period has an off switch in the back office, and the counter card shows the free ones apart", async ({ page }) => {
  const admin = await as("admin.free2@example.test", "admin");
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.goto("/admin/settings");
  const open = page.getByTestId("s-free-open");
  await expect(open).toBeChecked();
  // the counter card of the map shows the free imprints apart from the sold pixels
  await page.goto("/map");
  await expect(page.getByTestId("free-count")).toContainText(/\+ \d+ free trace/);
  // switched off by the database function the form calls: nothing new can be placed
  const off = await admin.post("/api/admin/action", { data: { action: "set_setting", key: "free_parcels_open", value: false } });
  expect(off.status()).toBe(200);
  const dave = await as("free-dave@example.test");
  expect((await (await place(dave, { x: 27_860, y: 11_000, w: 2, h: 2 })).json()).error).toBe("px_free_closed");
  // and in the panel a size below the paid minimum is refused again, with its explanation, and no free sizes are offered
  await page.goto("/map?bx=27870&by=11000&bw=4&bh=6");
  await expect(page.getByTestId("buy-status")).toContainText(/minimum surface is 25/i);
  await expect(page.getByTestId("buy-free")).toHaveCount(0);
  await expect(page.getByTestId("buy-continue")).toBeDisabled();
  await page.goto("/admin/settings");
  await expect(page.getByTestId("s-free-open")).not.toBeChecked();
  expect((await admin.post("/api/admin/action", { data: { action: "set_setting", key: "free_parcels_open", value: true } })).status()).toBe(200);
  expect((await place(dave, { x: 27_860, y: 11_000, w: 2, h: 2 })).status()).toBe(201);
});
