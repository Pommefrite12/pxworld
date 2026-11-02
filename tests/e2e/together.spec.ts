import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * Drawing together: the owner shares a secret link, anybody holding it paints pixels (no account), and the owner publishes
 * the result as a new version that a moderator must approve. (Named so that it runs after the journey spec, which asserts
 * exact global counters before any sale; it uses its own piece of Brazil.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 12_611, y: 18_744, w: 30, h: 20 };
const png = (w: number, h: number, c = "#2b35e0") => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

let nextAddress = 100;
/** A visitor with no cookie, from an address of their own (the rate limits are per address). */
const visitor = () => pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${nextAddress++}` } });
const login = async (email: string, role?: "admin" | "moderator") => {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${nextAddress++}` } });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  return ctx;
};
const paint = (ctx: APIRequestContext, token: string, p: number[]) => ctx.post(`/api/draw/${token}/pixels`, { data: { p } });
const state = async (ctx: APIRequestContext, token: string, since = 0) => (await ctx.get(`/api/draw/${token}?since=${since}`)).json();

test.describe.serial("drawing together", () => {
  let owner: APIRequestContext, admin: APIRequestContext;
  let code = "", parcelId = "", token = "";

  test.beforeAll(async () => {
    owner = await login("streamer@example.test");
    admin = await login("admin.together@example.test", "admin");
    const r = await owner.post("/api/checkout", { multipart: { x: String(SPOT.x), y: String(SPOT.y), w: String(SPOT.w), h: String(SPOT.h), title: "Chat canvas", image: { name: "c.png", mimeType: "image/png", buffer: await png(SPOT.w, SPOT.h) } } });
    expect(r.status(), await r.text()).toBe(200);
    const { orderId } = await r.json();
    expect((await (await owner.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
    code = (await (await owner.get(`/api/orders/${orderId}`)).json()).parcelCode;
    [{ id: parcelId }] = await sql<{ id: string }>("select id from public.parcels where code = $1", [code]) as [{ id: string }];
    // the first version (blue) is approved, so that the community has a creation to draw on
    const [asset] = await sql<{ id: string }>("select id from public.parcel_assets where parcel_id = $1 and status = 'pending'", [parcelId]);
    expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: asset!.id, decision: "approve" } })).status()).toBe(200);
  });
  test.afterAll(async () => { await Promise.all([owner.dispose(), admin.dispose()]); });

  test("only the owner can create the link, and a stranger or an anonymous visitor cannot", async () => {
    const stranger = await login("someone.else@example.test");
    const anon = await visitor();
    for (const ctx of [stranger, anon]) {
      const r = await ctx.post(`/api/parcels/${code}/collab`, { data: { action: "enable" } });
      expect([401, 404]).toContain(r.status());
    }
    expect((await owner.post(`/api/parcels/${code}/collab`, { data: { action: "nonsense" } })).status()).toBe(400);
    expect(await sql("select 1 from public.parcel_collab")).toHaveLength(0);
    await Promise.all([stranger.dispose(), anon.dispose()]);
  });

  test("the owner creates the link from the page of their parcel", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    expect((await ctx.request.post("/api/dev/login", { data: { email: "streamer@example.test" } })).ok()).toBeTruthy();
    const page = await ctx.newPage();
    await page.goto("/account/parcels");
    await page.getByTestId("draw-together-link").click();
    await expect(page.getByTestId("collab-panel")).toBeVisible();
    await expect(page.getByTestId("collab-url")).toHaveCount(0); // nothing is shared until the owner says so
    await page.getByTestId("collab-create").click();
    await expect(page.getByTestId("collab-url")).toBeVisible();
    const url = await page.getByTestId("collab-url").inputValue();
    token = url.split("/draw/")[1]!;
    expect(token).toMatch(/^[0-9a-f]{40}$/);
    expect(url).toContain(new URL(page.url()).origin); // a full link that can be pasted anywhere
    await expect(page.getByTestId("collab-pixels")).toHaveText("Nothing has been drawn yet.");
    await expect(page.getByTestId("collab-publish")).toBeDisabled(); // nothing to publish yet
    await ctx.close();
  });

  test("anybody with the link sees the canvas and paints, without any account; others see it a moment later", async ({ browser }) => {
    const a = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const b = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const [pa, pb] = [await a.newPage(), await b.newPage()];
    await pa.goto(`/draw/${token}`);
    await pb.goto(`/draw/${token}`);
    await expect(pa.getByRole("heading", { name: "Draw together" })).toBeVisible();
    await expect(pa.getByText("Chat canvas")).toBeVisible(); // the parcel's approved title
    await expect(pa.getByTestId("draw-canvas")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(pb.getByTestId("draw-canvas")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(pa.getByTestId("sign-in-link")).toBeVisible(); // really no account

    // A paints red: pick the red swatch (#ff4d2e) and click three pixels
    await pa.getByRole("button", { name: "#ff4d2e" }).click();
    const box = (await pa.getByTestId("draw-canvas").boundingBox())!;
    const zoom = box.width / SPOT.w;
    for (const [px, py] of [[2, 3], [3, 3], [4, 3]]) await pa.mouse.click(box.x + (px! + 0.5) * zoom, box.y + (py! + 0.5) * zoom);
    await expect(pa.getByTestId("draw-count")).toContainText("3 pixels painted");
    // …and B, who has not touched anything, sees them without reloading
    await expect(pb.getByTestId("draw-count")).toContainText("3 pixels painted", { timeout: 15_000 });
    const onB = await pb.getByTestId("draw-canvas").evaluate((c: HTMLCanvasElement) => [...c.getContext("2d")!.getImageData(3, 3, 1, 1).data]);
    expect(onB).toEqual([0xff, 0x4d, 0x2e, 255]);
    // what is stored: exactly those three pixels
    expect((await sql<{ n: number }>(`select count(*)::int n from public.parcel_collab_pixels where parcel_id = $1`, [parcelId]))[0]!.n).toBe(3);
    await Promise.all([a.close(), b.close()]);
  });

  test("the approved creation is underneath: the canvas starts from it, not from white", async ({ page }) => {
    await page.goto(`/draw/${token}`);
    await expect(page.getByTestId("draw-canvas")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(page.getByTestId("draw-count")).toContainText("3 pixels painted", { timeout: 15_000 });
    const px = await page.getByTestId("draw-canvas").evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!;
      return { blue: [...d.getImageData(20, 10, 1, 1).data], red: [...d.getImageData(2, 3, 1, 1).data] };
    });
    expect(px.blue).toEqual([0x2b, 0x35, 0xe0, 255]); // the owner's approved blue creation
    expect(px.red).toEqual([0xff, 0x4d, 0x2e, 255]); // the community's stroke on top
  });

  test("the public API only changes what it should: deltas, bounds, bad input, size and rate limits", async () => {
    const ctx = await visitor();
    const full = await state(ctx, token);
    expect(full).toMatchObject({ w: SPOT.w, h: SPOT.h, title: "Chat canvas", reset: false, more: false });
    expect(full.p).toHaveLength(9);
    const v0 = full.version;

    expect((await paint(ctx, token, [29, 19, 0x00ff00])).status()).toBe(200);
    const delta = await state(ctx, token, v0);
    expect(delta.p).toEqual([29, 19, 0x00ff00]); // only what changed
    expect((await state(ctx, token, delta.version)).p).toEqual([]);

    for (const bad of [[30, 0, 1], [0, 20, 1], [-1, 0, 1], [0, 0, 16777216], [0, 0], [0, 0, 1, 2], [0, 0, 1.5], [0, 0, "x"]]) {
      const r = await paint(ctx, token, bad as number[]);
      expect(r.status(), JSON.stringify(bad)).toBe(400);
    }
    expect((await ctx.post(`/api/draw/${token}/pixels`, { data: { nope: 1 } })).status()).toBe(400);
    expect((await ctx.post(`/api/draw/${token}/pixels`, { data: { p: Array(6003).fill(0) } })).status()).toBe(400); // more than 2 000 pixels
    expect((await state(ctx, token)).p).toHaveLength(12); // none of the refused requests changed anything
    // unknown / malformed links look the same as a closed one
    for (const t of ["0".repeat(40), "nonsense", token.toUpperCase()]) {
      expect((await ctx.get(`/api/draw/${t}`)).status(), t).toBe(404);
      expect((await paint(ctx, t, [0, 0, 1])).status(), t).toBe(404);
    }
    // a request from another website is refused (the page itself is same-origin)
    expect((await ctx.post(`/api/draw/${token}/pixels`, { data: { p: [0, 0, 1] }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    await ctx.dispose();
  });

  test("each address has a budget per minute", async () => {
    const ctx = await visitor();
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) statuses.push((await paint(ctx, token, [i % SPOT.w, 15, 0x123456])).status());
    expect(statuses.slice(0, 120).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(120).every((s) => s === 429)).toBe(true);
    const other = await visitor(); // somebody else is not affected
    expect((await paint(other, token, [0, 16, 0x123456])).status()).toBe(200);
    await Promise.all([ctx.dispose(), other.dispose()]);
  });

  test("the owner publishes the community drawing: a new pending version = approved creation + strokes, only after a moderator approves", async () => {
    // an owner with nothing pending still publishes; moderators see it as a new version of this parcel
    const r = await owner.post(`/api/parcels/${code}/collab`, { data: { action: "publish" } });
    expect(r.status(), await r.text()).toBe(201);
    const { assetId } = await r.json();
    expect(await sql<{ status: string }>("select status from public.parcel_assets where id = $1", [assetId])).toEqual([{ status: "pending" }]);
    // it is NOT public yet: the map still shows the previous (approved) version
    const tile = await (await owner.get(`/api/map/tiles/${Math.floor(SPOT.x / 1000)}/${Math.floor(SPOT.y / 1000)}`)).json() as [string, number, number, number, number, string | null][];
    const shown = tile.find((p) => p[0] === code)![5];
    expect(shown).not.toBe(assetId);
    expect((await (await owner.get(`/api/parcels/${code}`)).json()).creation.assetId).toBe(shown);

    expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId, decision: "approve" } })).status()).toBe(200);
    const img = await owner.get(`/api/assets/${assetId}`);
    const { data, info } = await sharp(await img.body()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([SPOT.w, SPOT.h]);
    const at = (x: number, y: number) => [...data.subarray((y * SPOT.w + x) * 4, (y * SPOT.w + x) * 4 + 4)];
    expect(at(3, 3)).toEqual([0xff, 0x4d, 0x2e, 255]); // a stroke
    expect(at(29, 19)).toEqual([0x00, 0xff, 0x00, 255]); // another one
    expect(at(20, 10)).toEqual([0x2b, 0x35, 0xe0, 255]); // the creation underneath is kept
    // the title is kept too (not replaced by something generic)
    expect((await (await owner.get(`/api/parcels/${code}`)).json()).creation.title).toBe("Chat canvas");
  });

  test("an empty drawing cannot be published; resetting wipes it for everybody and makes viewers reload", async () => {
    const ctx = await visitor();
    const before = await state(ctx, token);
    expect(before.p.length).toBeGreaterThan(0);
    expect((await owner.post(`/api/parcels/${code}/collab`, { data: { action: "reset" } })).status()).toBe(200);
    const after = await state(ctx, token, before.version);
    expect(after).toMatchObject({ reset: true, p: [] }); // a client that had the old drawing is told to clear it
    expect((await state(ctx, token)).p).toEqual([]);
    const r = await owner.post(`/api/parcels/${code}/collab`, { data: { action: "publish" } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe("collab_empty");
    await ctx.dispose();
  });

  test("a new link replaces the old one; stopping the sharing closes it; turning it on again brings it back", async () => {
    const ctx = await visitor();
    const rotated = await (await owner.post(`/api/parcels/${code}/collab`, { data: { action: "rotate" } })).json();
    expect(rotated.token).toMatch(/^[0-9a-f]{40}$/);
    expect(rotated.token).not.toBe(token);
    expect((await paint(ctx, token, [0, 0, 1])).status()).toBe(404); // the old link is dead
    expect((await ctx.get(`/api/draw/${token}`)).status()).toBe(404);
    expect((await paint(ctx, rotated.token, [0, 0, 1])).status()).toBe(200);
    token = rotated.token;

    expect((await (await owner.post(`/api/parcels/${code}/collab`, { data: { action: "disable" } })).json()).enabled).toBe(false);
    expect((await paint(ctx, token, [1, 1, 1])).status()).toBe(404);
    // the page of a closed link says so, in plain words
    const page = await ctx.get(`/draw/${token}`);
    expect(await page.text()).toContain("no longer active");
    expect(await page.text()).toContain("noindex");
    expect((await (await owner.post(`/api/parcels/${code}/collab`, { data: { action: "enable" } })).json()).token).toBe(token);
    expect((await paint(ctx, token, [1, 1, 1])).status()).toBe(200);
    await ctx.dispose();
  });

  test("moderation can shut a drawing down: a hidden parcel stops accepting strokes", async () => {
    const ctx = await visitor();
    expect((await admin.post("/api/admin/action", { data: { action: "hide_parcel", parcelId: parcelId, hidden: true, reason: "test" } })).status()).toBe(200);
    expect((await paint(ctx, token, [2, 2, 1])).status()).toBe(404);
    expect((await ctx.get(`/api/draw/${token}`)).status()).toBe(404);
    expect((await admin.post("/api/admin/action", { data: { action: "hide_parcel", parcelId: parcelId, hidden: false } })).status()).toBe(200);
    expect((await paint(ctx, token, [2, 2, 1])).status()).toBe(200);
    await ctx.dispose();
  });
});
