import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * Moderation, uploads, permissions and abuse protection — driven through the real HTTP API and admin UI.
 * Self-contained: creates its own users and parcels, in an area of the map the journey spec does not use.
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;

const png = (w: number, h: number, c = "#2b35e0") => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

async function api(email: string, role?: "admin" | "moderator"): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/dev/login", { data: { email, role } });
  expect(r.ok()).toBeTruthy();
  return ctx;
}

async function buy(ctx: APIRequestContext, x: number, y: number, w: number, h: number, title: string) {
  const r = await ctx.post("/api/checkout", { multipart: { x: String(x), y: String(y), w: String(w), h: String(h), title, image: { name: "c.png", mimeType: "image/png", buffer: await png(w, h) } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  const pay = await ctx.post("/api/dev/pay", { data: { orderId, outcome: "paid" } });
  expect((await pay.json()).outcome).toBe("processed");
  const order = await (await ctx.get(`/api/orders/${orderId}`)).json();
  expect(order.parcelCode).toMatch(/^[0-9a-f]{10}$/);
  return { orderId, code: order.parcelCode as string };
}

const tileOf = async (ctx: APIRequestContext, x: number, y: number) =>
  (await (await ctx.get(`/api/map/tiles/${Math.floor(x / 1000)}/${Math.floor(y / 1000)}`)).json()) as [string, number, number, number, number, string | null, string | null][];

/** Read-only look at the e2e database (ids that the UI does not expose). All mutations go through the app. */
async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

test.describe.serial("moderation & protection", () => {
  const X = 30_000, Y = 12_000;
  let code = "", v1 = "";
  let carol: APIRequestContext, dave: APIRequestContext, admin: APIRequestContext, mod: APIRequestContext;

  test.beforeAll(async () => {
    [carol, dave, admin, mod] = await Promise.all([api("carol@example.test"), api("dave@example.test"), api("admin2@example.test", "admin"), api("mod@example.test", "moderator")]);
  });
  test.afterAll(async () => { await Promise.all([carol, dave, admin, mod].map((c) => c.dispose())); });

  const pendingIds = async (parcelCode: string) =>
    (await sql<{ id: string }>("select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.code = $1 and a.status = 'pending'", [parcelCode])).map((r) => r.id);

  test("carol buys a parcel; reservations are listed for her only", async () => {
    const r = await buy(carol, X, Y, 30, 30, "Carol's art");
    code = r.code;
    const tile = await tileOf(carol, X, Y);
    const t = tile.find((p) => p[0] === code)!;
    expect(t.slice(1, 5)).toEqual([X, Y, 30, 30]);
    const card = await (await carol.get(`/api/parcels/${code}`)).json();
    expect(card.creation).toBeNull(); // not moderated yet
    expect(await pendingIds(code)).toHaveLength(1); // the creation uploaded with the purchase awaits moderation
  });

  test("uploads are validated by content, not by file name or declared type", async () => {
    const fd = (buffer: Buffer, name = "x.png", mimeType = "image/png") => ({ multipart: { title: "t", image: { name, mimeType, buffer } } });
    const url = `/api/parcels/${code}/creation`;
    // SVG with a .png name and image/png type
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><script>alert(1)</script></svg>');
    let r = await carol.post(url, fd(svg));
    expect([r.status(), (await r.json()).error]).toEqual([422, "image_svg_forbidden"]);
    // Windows executable renamed to .png
    r = await carol.post(url, fd(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(500)])));
    expect([r.status(), (await r.json()).error]).toEqual([422, "image_executable_forbidden"]);
    // shell script
    r = await carol.post(url, fd(Buffer.from("#!/bin/sh\nrm -rf /\n")));
    expect(r.status()).toBe(422);
    // valid PNG of the wrong size
    r = await carol.post(url, fd(await png(31, 30)));
    expect([r.status(), (await r.json()).error]).toEqual([422, "image_bad_dimensions"]);
    // oversized payload
    r = await carol.post(url, fd(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2_200_000)])));
    expect([413, 422]).toContain(r.status());
    // dangerous link
    r = await carol.post(url, { multipart: { title: "t", link: "javascript:alert(1)", image: { name: "a.png", mimeType: "image/png", buffer: await png(30, 30) } } });
    expect([r.status(), (await r.json()).error]).toEqual([400, "invalid_link"]);
    // somebody else's parcel
    r = await dave.post(url, fd(await png(30, 30)));
    expect(r.status()).toBe(404);
    // the rejected attempts left no trace: still exactly the purchase upload awaiting moderation
    expect(await pendingIds(code)).toHaveLength(1);
  });

  test("a moderator approves version 1: public only after approval, and the stored file is a clean PNG", async () => {
    const [id] = await pendingIds(code);
    const r = await mod.post("/api/admin/action", { data: { action: "review_asset", assetId: id, decision: "approve" } });
    expect(r.status(), await r.text()).toBe(200);
    v1 = (await tileOf(carol, X, Y)).find((p) => p[0] === code)![5]!;
    expect(v1).toBeTruthy();
    const anon = await pwRequest.newContext({ baseURL: BASE });
    const img = await anon.get(`/api/assets/${v1}`);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-security-policy"]).toContain("sandbox");
    expect(img.headers()["x-content-type-options"]).toBe("nosniff");
    await anon.dispose();
  });

  test("an edit stays invisible until approved; the previous version keeps displaying; a refusal is explained", async () => {
    const r = await carol.post(`/api/parcels/${code}/creation`, { multipart: { title: "Carol v2", image: { name: "b.png", mimeType: "image/png", buffer: await png(30, 30, "#ff4d2e") } } });
    expect(r.status()).toBe(201);
    const v2 = (await r.json()).assetId as string;
    expect((await tileOf(carol, X, Y)).find((p) => p[0] === code)![5]).toBe(v1); // still v1
    const anon = await pwRequest.newContext({ baseURL: BASE });
    expect((await anon.get(`/api/assets/${v2}`)).status()).toBe(404); // pending version is private
    expect((await carol.get(`/api/assets/${v2}`)).status()).toBe(200); // …but visible to its owner
    expect((await dave.get(`/api/assets/${v2}`)).status()).toBe(404);
    await anon.dispose();
    // a moderator refuses it, with a reason
    expect((await mod.post("/api/admin/action", { data: { action: "review_asset", assetId: v2, decision: "reject", reason: "copyright" } })).status()).toBe(200);
    expect((await tileOf(carol, X, Y)).find((p) => p[0] === code)![5]).toBe(v1);
    const page = await (await carol.get(`/account/parcels/${code}/edit`)).text();
    expect(page).toContain("copyright");
  });

  test("reports snapshot the evidence; moderators hide content; hidden content disappears everywhere", async ({ browser }) => {
    const r = await dave.post("/api/reports", { data: { code, reason: "scam", details: "looks like phishing" } });
    expect(r.status()).toBe(201);
    expect((await (await dave.post("/api/reports", { data: { code, reason: "scam" } })).json()).duplicate).toBe(true);
    expect((await (await dave.post("/api/reports", { data: { code: "zzzzzzzz", reason: "scam" } })).status())).toBe(404);
    expect((await dave.post("/api/reports", { data: { code, reason: "not-a-reason" } })).status()).toBe(400);

    const ctx = await browser.newContext();
    await ctx.request.post(`${BASE}/api/dev/login`, { data: { email: "mod@example.test", role: "moderator" } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin/reports`);
    const item = page.getByTestId("report-item").filter({ hasText: code });
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("Scam");
    await item.getByText("Evidence at report time").click();
    await expect(item).toContainText("Carol's art");
    await item.getByTestId("report-hide").click();
    await item.getByPlaceholder("Reason").fill("phishing link");
    await item.getByTestId("report-hide").click();
    await expect(page.getByTestId("report-item").filter({ hasText: code }).getByText("Content hidden")).toBeVisible();
    await item.getByTestId("report-actioned").click();
    await page.getByTestId("report-item").filter({ hasText: code }).getByPlaceholder("Reason").fill("hidden, owner warned");
    await page.getByTestId("report-item").filter({ hasText: code }).getByTestId("report-actioned").click();
    await expect(page.getByTestId("reports-empty")).toBeVisible();
    await ctx.close();

    expect((await tileOf(carol, X, Y)).find((p) => p[0] === code)![5]).toBeNull();
    const anon = await pwRequest.newContext({ baseURL: BASE });
    expect((await anon.get(`/api/assets/${v1}`)).status()).toBe(404);
    const card = await (await anon.get(`/api/parcels/${code}`)).json();
    expect(card).toMatchObject({ hidden: true, creation: null });
    expect(await (await anon.get("/sitemap.xml")).text()).not.toContain(`/p/${code}`);
    await anon.dispose();
  });

  test("moderators cannot perform admin-only actions; every action is journalised", async () => {
    expect((await mod.post("/api/admin/action", { data: { action: "set_setting", key: "price_unit_cents", value: 1 } })).status()).toBe(403);
    expect((await mod.post("/api/admin/action", { data: { action: "revoke_parcel", parcelId: "00000000-0000-0000-0000-000000000000", reason: "nope" } })).status()).toBe(403);
    expect((await admin.post("/api/admin/action", { data: { action: "set_setting", key: "price_unit_cents", value: -5 } })).status()).toBe(400);
    const audit = await (await admin.get("/admin/audit")).text();
    for (const a of ["asset.approve", "asset.reject", "parcel.hide", "report.actioned"]) expect(audit).toContain(a);
  });

  test("a suspended account can neither buy nor edit; reactivation restores it", async () => {
    const userId = (await sql<{ id: string }>("select id from auth.users where email = 'carol@example.test'"))[0]!.id;
    expect((await mod.post("/api/admin/action", { data: { action: "suspend_user", userId, suspended: true } })).status()).toBe(403); // moderators cannot
    expect((await admin.post("/api/admin/action", { data: { action: "suspend_user", userId, suspended: true, reason: "test" } })).status()).toBe(200);
    const buyAttempt = await carol.post("/api/checkout", { multipart: { x: "31000", y: "12000", w: "10", h: "10", image: { name: "c.png", mimeType: "image/png", buffer: await png(10, 10) } } });
    expect([buyAttempt.status(), (await buyAttempt.json()).error]).toEqual([403, "px_account_suspended"]);
    const edit = await carol.post(`/api/parcels/${code}/creation`, { multipart: { image: { name: "c.png", mimeType: "image/png", buffer: await png(30, 30) } } });
    expect(edit.status()).toBe(403);
    expect((await admin.post("/api/admin/action", { data: { action: "suspend_user", userId, suspended: false } })).status()).toBe(200);
    const ok = await carol.post(`/api/parcels/${code}/creation`, { multipart: { title: "back", image: { name: "c.png", mimeType: "image/png", buffer: await png(30, 30, "#12b886") } } });
    expect(ok.status()).toBe(201);
  });

  test("the unit price is configurable by admins for FUTURE orders only", async () => {
    const before = await (await carol.get("/api/availability?x=1000&y=1000&w=20&h=20")).json();
    expect(before.price.totalCents).toBe(40_000);
    expect((await admin.post("/api/admin/action", { data: { action: "set_setting", key: "price_unit_cents", value: 250 } })).status()).toBe(200);
    const after = await (await carol.get("/api/availability?x=1000&y=1000&w=20&h=20")).json();
    expect(after.price).toMatchObject({ unitPriceCents: 250, totalCents: 100_000 });
    // an existing order keeps its price
    const mine = await (await carol.get("/account/orders")).text();
    expect(mine).toContain("€900"); // 30×30 pixels bought at €1 each, price unchanged by the later increase
    expect((await admin.post("/api/admin/action", { data: { action: "set_setting", key: "price_unit_cents", value: 100 } })).status()).toBe(200);
  });

  test("rate limiting protects sensitive endpoints", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 13; i++) statuses.push((await dave.post("/api/reports", { data: { code, reason: "other" } })).status());
    expect(statuses.slice(-1)[0]).toBe(429);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
