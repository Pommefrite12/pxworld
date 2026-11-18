import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { lonLatToPixel } from "../../src/lib/grid/geometry";

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
const place = async (ctx: APIRequestContext, r: { x: number; y: number; w: number; h: number }, title = "A free trace", kind?: "land" | "water") =>
  ctx.post("/api/free-parcel", { multipart: { ...(kind ? { kind } : {}), x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h), description: "A short description", title, category: "daily", image: { name: "c.png", mimeType: "image/png", buffer: await png(r.w, r.h, "#e0352b") } } });

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
  const c = await bob.post("/api/checkout", { multipart: { x: String(SPOT.x - 3), y: String(SPOT.y - 3), w: "5", h: "5", description: "A short description", title: "Over a free one", category: "daily", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
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

test("a free imprint on the sea: the same gift on water, with the share of water of a water parcel, the same quota, and a paid WATER parcel covers it", async ({ page }) => {
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
  // its owner can place another one at once (this time on land: the quota is common)
  const again = await place(wanda, { x: 27_820, y: 11_000, w: 2, h: 2 }, "Back on land", "land");
  expect(again.status(), await again.text()).toBe(201);
  void page;
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
  await dialog.getByTestId("co-description").fill("A first free trace.");
  await dialog.getByTestId("co-category").selectOption("daily");
  await expect(dialog.getByTestId("co-total")).toHaveText("Free");
  await dialog.getByTestId("co-accept").check();
  await expect(dialog.getByTestId("co-pay")).toHaveText("Place my trace");
  await dialog.getByTestId("co-pay").click();
  await page.waitForURL(/\/archive\/[0-9a-f]{10}/); // placed: its own archive page, waiting for moderation
  await expect(page.getByTestId("archive-free")).toBeVisible();
  // its author sees what they sent, marked as waiting for moderation
  await expect(page.getByTestId("archive-pending-own")).toContainText(/waiting for moderation/i);
  await expect(page.getByTestId("archive-title")).toHaveText("My first free trace");
  await expect(page.getByTestId("archive-description")).toHaveText("A first free trace.");
  await expect(page.getByTestId("archive-image")).toBeVisible();

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
  // and in the panel of a visitor a size below the paid minimum is refused again, with its explanation, and no free sizes are offered
  await page.context().clearCookies();
  await page.context().addCookies((await dave.storageState()).cookies);
  await page.goto("/map?bx=27870&by=11000&bw=4&bh=6");
  await expect(page.getByTestId("buy-status")).toContainText(/minimum surface is 25/i);
  await expect(page.getByTestId("buy-free")).toHaveCount(0);
  await expect(page.getByTestId("buy-continue")).toBeDisabled();
  // an administrator is not held by the switch (migration 26): its panel still offers the free sizes
  await page.context().clearCookies();
  await page.context().addCookies((await admin.storageState()).cookies);
  await page.goto("/map?bx=27870&by=11000&bw=4&bh=6");
  await expect(page.getByTestId("buy-free-unlimited")).toBeVisible();
  await expect(page.getByTestId("buy-continue")).toBeEnabled();
  await page.goto("/admin/settings");
  await expect(page.getByTestId("s-free-open")).not.toBeChecked();
  expect((await admin.post("/api/admin/action", { data: { action: "set_setting", key: "free_parcels_open", value: true } })).status()).toBe(200);
  expect((await place(dave, { x: 27_860, y: 11_000, w: 2, h: 2 })).status()).toBe(201);
});

test("an administrator places as many free imprints as it wants: no quota, no rate limit; its creations still go through moderation; the panel says so; a visitor stays limited", async ({ page }) => {
  const admin = await as("admin.many@example.test", "admin"), visitor = await as("free-limited@example.test");
  const adminId = (await sql<{ id: string }>(`select id from auth.users where email = 'admin.many@example.test'`))[0]!.id;
  try {
    // fourteen, one beside the other: more than the three of a visitor, and than the twelve an hour of the rate limit
    const codes: string[] = [];
    for (let i = 0; i < 14; i++) {
      const r = await place(admin, { x: 27_800 + i * 4, y: 11_030, w: 2, h: 2 }, `Admin free ${i}`);
      expect(r.status(), `${i}: ${await r.text()}`).toBe(201);
      codes.push(((await r.json()) as { code: string }).code);
    }
    // moderation applies to an administrator like to anybody (so that it can be tried): the fourteen creations wait in the queue and none is shown yet
    expect((await sql<{ n: number }>(`select count(*)::int as n from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.owner_id = $1 and a.status = 'pending'`, [adminId]))[0]!.n).toBe(14);
    const waiting = await (await admin.get(`/api/parcels/${codes[0]!}`)).json();
    expect(waiting).toMatchObject({ tier: "free", creation: null });
    // the administrator approves one by hand in the back office, and it is on the map; the other thirteen are still waiting
    const asset = (await sql<{ id: string }>(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.code = $1 and a.status = 'pending'`, [codes[0]!]))[0]!.id;
    expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: asset, decision: "approve" } })).status()).toBe(200);
    expect((await (await admin.get(`/api/parcels/${codes[0]!}`)).json()).creation).toMatchObject({ title: "Admin free 0" });
    expect((await (await admin.get(`/api/parcels/${codes[13]!}`)).json()).creation).toBeNull();
    expect((await sql<{ n: number }>(`select count(*)::int as n from public.audit_logs where actor_id = $1 and action = 'asset.approve'`, [adminId]))[0]!.n).toBe(1);

    // a visitor is still limited to one at a time
    expect((await place(visitor, { x: 27_900, y: 11_030, w: 2, h: 2 })).status()).toBe(201);
    expect((await (await place(visitor, { x: 27_910, y: 11_030, w: 2, h: 2 })).json()).error).toBe("px_free_quota");

    // the buy panel tells an administrator so, and offers the free sizes
    await page.context().addCookies((await admin.storageState()).cookies);
    await page.setViewportSize({ width: 1360, height: 860 });
    await page.goto(`/map?bx=27930&by=11030&bw=3&bh=3`);
    await expect(page.getByTestId("buy-panel")).toBeVisible();
    await expect(page.getByTestId("buy-free-unlimited")).toContainText("Administrator account: as many free traces as you want");
    await expect(page.getByTestId("buy-free-why")).toHaveCount(0);
    await expect(page.getByTestId("buy-free-3x3")).toBeVisible();
  } finally {
    await sql(`delete from public.parcels where owner_id in (select id from auth.users where email in ('admin.many@example.test', 'free-limited@example.test'))`);
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
  }
});

test("after sending an imprint, its author sees their own preview, title and description (marked as waiting for moderation); the public sees only that it waits; the staff see it too", async ({ page, request }) => {
  const carol = await as("free-pending@example.test"), other = await as("free-pending-other@example.test"), admin = await as("admin.pending@example.test", "admin");
  try {
    const r = await place(carol, { x: 27_960, y: 11_030, w: 3, h: 3 }, "Mon titre en attente");
    expect(r.status(), await r.text()).toBe(201);
    const { code } = (await r.json()) as { code: string };
    const assetId = (await sql<{ id: string }>(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.code = $1 and a.status = 'pending'`, [code]))[0]!.id;

    // its author: the preview, the title and the description, with the mention that it waits
    await page.context().addCookies((await carol.storageState()).cookies);
    await page.goto(`/archive/${code}`);
    await expect(page.getByTestId("archive-title")).toHaveText("Mon titre en attente");
    await expect(page.getByTestId("archive-description")).toHaveText("A short description");
    await expect(page.getByTestId("archive-pending-own")).toContainText("Waiting for moderation");
    await expect(page.getByTestId("archive-pending")).toHaveCount(0);
    const img = page.getByTestId("archive-image");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true); // the picture really loads (the author may fetch a waiting one)

    // the public sees only that it waits: nothing of the title, the description or the picture; the picture itself is not served to it
    const publicHtml = await (await request.get(`/archive/${code}`)).text();
    expect(publicHtml).not.toContain("Mon titre en attente");
    expect(publicHtml).toContain('data-testid="archive-pending"'); // (the words are in every page's messages: it is the rendered marker that counts)
    expect(publicHtml).not.toContain('data-testid="archive-pending-own"');
    expect((await request.get(`/api/assets/${assetId}`)).status()).toBe(404);
    // another account is the public too
    expect(await (await other.get(`/archive/${code}`)).text()).not.toContain("Mon titre en attente");
    expect((await other.get(`/api/assets/${assetId}`)).status()).toBe(404);
    // the staff see it, to moderate it
    expect(await (await admin.get(`/archive/${code}`)).text()).toContain("Mon titre en attente");

    // approved: it is public, and the mention is gone
    expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId, decision: "approve" } })).status()).toBe(200);
    const after = await (await request.get(`/archive/${code}`)).text();
    expect(after).toContain("Mon titre en attente");
    expect(after).not.toContain('data-testid="archive-pending-own"');
    expect(after).not.toContain('data-testid="archive-pending"');
  } finally {
    await sql(`delete from public.parcels where owner_id in (select id from auth.users where email in ('free-pending@example.test'))`);
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
  }
});
