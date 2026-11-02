import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * Buying without an account: the visitor gives an e-mail address and nothing else.
 * Behind the scenes that address gets a guest account — with NO session, a neutral public name, and an order that only
 * the holder of the signed link can follow. (File name sorts after journey/moderation on purpose: it sells pixels in
 * central Africa, an area no other spec uses, but the journey spec asserts exact global counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 21_167, y: 17_681, w: 20, h: 20 }; // Democratic Republic of the Congo
const png = (w: number, h: number, c = "#e8401f") => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

/**
 * A visitor with no cookie at all, from an address of their own (the limits are per address: without this every test
 * would share the one 127.0.0.1 and use up the others' allowance).
 */
let nextAddress = 10;
const anonymous = () => pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${nextAddress++}` } });

const checkout = async (ctx: APIRequestContext, rect: { x: number; y: number; w: number; h: number }, email?: string) =>
  ctx.post("/api/checkout", { multipart: { x: String(rect.x), y: String(rect.y), w: String(rect.w), h: String(rect.h), ...(email === undefined ? {} : { email }), image: { name: "c.png", mimeType: "image/png", buffer: await png(rect.w, rect.h) } } });

test.describe.serial("buying without an account", () => {
  test("an e-mail address is enough: design, pay, and the parcel belongs to a guest account with no session", async ({ page }) => {
    await page.goto(`/map?bx=${SPOT.x}&by=${SPOT.y}&bw=${SPOT.w}&bh=${SPOT.h}`);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i, { timeout: 20_000 });
    await expect(page.getByTestId("sign-in-link")).toBeVisible(); // really anonymous
    await page.getByTestId("buy-continue").click();

    const dialog = page.getByRole("dialog");
    const canvas = dialog.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.8, { steps: 12 });
    await page.mouse.up();
    await dialog.getByTestId("to-review").click();

    // the only extra field: an e-mail address. Paying needs the terms AND a plausible address.
    await expect(dialog.getByTestId("co-email")).toBeVisible();
    await dialog.getByTestId("co-title").fill("No account needed");
    await dialog.getByTestId("co-accept").check();
    await expect(dialog.getByTestId("co-pay")).toBeDisabled();
    await dialog.getByTestId("co-email").fill("not-an-email");
    await expect(dialog.getByTestId("co-pay")).toBeDisabled();
    await dialog.getByTestId("co-email").fill("Guest.Buyer@Example.test");
    await expect(dialog.getByTestId("co-pay")).toBeEnabled();
    await dialog.getByTestId("co-pay").click();

    // the (mock) payment page opens without any sign-in; the signed link in the URL is what identifies the order
    await page.waitForURL(/\/dev\/checkout\/[0-9a-f-]{36}\?t=[0-9a-f]{32}$/);
    await page.getByTestId("dev-pay").click();
    await page.waitForURL(/checkout\/success/);
    await expect(page.getByTestId("checkout-result")).toHaveAttribute("data-state", "paid", { timeout: 30_000 });
    const successUrl = page.url();

    // we say where the sign-in link went — masked — and never show the whole address
    const notice = page.getByTestId("guest-notice");
    await expect(notice).toContainText("gu•••@ex•••.test");
    await expect(notice).not.toContainText("guest.buyer");
    await expect(page.getByTestId("sign-in-link")).toBeVisible(); // still no session: typing an address proves nothing
    await page.goto("/account/parcels");
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    // the e-mail link is what signs a buyer in (development has no mailbox: the success page has a stand-in button)
    await page.goto(successUrl); // the link Stripe sent the buyer back to still works, and still identifies the order
    await expect(page.getByTestId("checkout-result")).toHaveAttribute("data-state", "paid", { timeout: 30_000 });
    await page.getByTestId("dev-open-account").click();
    await page.waitForURL(/\/account\/parcels/);
    await expect(page.getByTestId("my-parcel")).toHaveCount(1);

    // the account exists once, is flagged as a guest, and its public name does not leak the address
    const [row] = await sql<{ n: number; guest: boolean; username: string }>(
      `select count(*)::int as n, bool_or(u.raw_user_meta_data ->> 'guest' = 'true') as guest, max(p.username) as username
         from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = 'guest.buyer@example.test'`);
    expect(row).toMatchObject({ n: 1, guest: true });
    expect(row!.username).toMatch(/^pixel-[0-9a-f]{6}$/);
    const [parcel] = await sql<{ code: string }>(`select p.code from public.parcels p join auth.users u on u.id = p.owner_id where lower(u.email) = 'guest.buyer@example.test'`);
    const pub = await (await page.request.get(`/api/parcels/${parcel!.code}`)).json();
    expect(pub.owner.username).toBe(row!.username);
  });

  test("the address is checked, and a bad request never creates an account", async () => {
    const ctx = await anonymous();
    for (const email of [undefined, "", "nobody", "a@b", "x y@example.test", `${"a".repeat(250)}@example.test`]) {
      const r = await checkout(ctx, { x: SPOT.x + 100, y: SPOT.y, w: 20, h: 20 }, email);
      expect(r.status(), String(email)).toBe(400);
      expect((await r.json()).error).toBe("invalid_email");
    }
    // a request that is wrong for another reason (open sea) is refused before any account is made
    const sea = await checkout(ctx, { x: 1_000, y: 1_000, w: 20, h: 20 }, "ghost@example.test");
    expect(sea.status()).toBe(422);
    expect(await sql(`select 1 from auth.users where email = 'ghost@example.test'`)).toHaveLength(0);
    await ctx.dispose();
  });

  test("an address that already has a regular account must sign in: a stranger cannot buy into somebody's profile", async () => {
    const owner = await pwRequest.newContext({ baseURL: BASE });
    expect((await owner.post("/api/dev/login", { data: { email: "regular.person@example.test" } })).ok()).toBeTruthy();
    const before = await sql<{ n: number }>(`select count(*)::int as n from public.orders`);
    const ctx = await anonymous();
    const r = await checkout(ctx, { x: SPOT.x + 100, y: SPOT.y, w: 20, h: 20 }, "Regular.Person@example.test");
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe("account_exists");
    expect(await sql<{ n: number }>(`select count(*)::int as n from public.orders`)).toEqual(before); // nothing was reserved
    await Promise.all([owner.dispose(), ctx.dispose()]);
  });

  test("an order is followed with its signed link only; abandoning it frees the pixels", async () => {
    const ctx = await anonymous();
    const spot = { x: SPOT.x + 200, y: SPOT.y, w: 20, h: 20 };
    const r = await checkout(ctx, spot, "order.owner@example.test");
    expect(r.status(), await r.text()).toBe(200);
    const { orderId, url } = await r.json();
    const token = new URL(url, BASE).searchParams.get("t")!;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const free = async () => (await (await ctx.get(`/api/availability?x=${spot.x}&y=${spot.y}&w=${spot.w}&h=${spot.h}`)).json()).free;
    expect(await free()).toBe(false); // held while the buyer pays

    // without the link, with a wrong one, or with the link of another order: the order does not exist
    for (const q of ["", "?t=" + "0".repeat(32), "?t=nonsense"]) expect((await ctx.get(`/api/orders/${orderId}${q}`)).status(), q).toBe(404);
    const other = await checkout(ctx, { ...spot, x: spot.x + 100 }, "someone.else@example.test");
    const otherToken = new URL((await other.json()).url, BASE).searchParams.get("t")!;
    expect((await ctx.get(`/api/orders/${orderId}?t=${otherToken}`)).status()).toBe(404);
    expect((await ctx.delete(`/api/orders/${orderId}?t=${otherToken}`)).status()).toBe(404);

    const status = await (await ctx.get(`/api/orders/${orderId}?t=${token}`)).json();
    expect(status).toMatchObject({ status: "pending", parcelCode: null, guestEmail: "or•••@ex•••.test" });
    expect((await ctx.delete(`/api/orders/${orderId}?t=${token}`)).ok()).toBeTruthy();
    expect(await free()).toBe(true);
    await ctx.dispose();
  });

  test("the same address buys again into the same guest account, and a stranger's session sees nothing of it", async () => {
    const ctx = await anonymous();
    const a = await checkout(ctx, { x: SPOT.x + 400, y: SPOT.y, w: 20, h: 20 }, "repeat.buyer@example.test");
    const b = await checkout(ctx, { x: SPOT.x + 400, y: SPOT.y + 100, w: 20, h: 20 }, "REPEAT.buyer@example.test");
    expect(a.status(), await a.text()).toBe(200);
    expect(b.status(), await b.text()).toBe(200);
    const owners = await sql<{ n: number }>(
      `select count(distinct user_id)::int as n from public.orders o join auth.users u on u.id = o.user_id where lower(u.email) = 'repeat.buyer@example.test'`);
    expect(owners[0]!.n).toBe(1);
    expect(await sql(`select 1 from auth.users where lower(email) = 'repeat.buyer@example.test'`)).toHaveLength(1);

    // a signed-in stranger cannot read the guest's order either, even knowing its id
    const stranger = await pwRequest.newContext({ baseURL: BASE });
    await stranger.post("/api/dev/login", { data: { email: "stranger@example.test" } });
    const { orderId } = await a.json();
    expect((await stranger.get(`/api/orders/${orderId}`)).status()).toBe(404);
    await Promise.all([ctx.dispose(), stranger.dispose()]);
  });

  test("a suspended guest account can no longer buy, with or without a session", async () => {
    const ctx = await anonymous();
    const first = await checkout(ctx, { x: SPOT.x + 600, y: SPOT.y, w: 20, h: 20 }, "banned.guest@example.test");
    expect(first.ok()).toBeTruthy();
    const admin = await pwRequest.newContext({ baseURL: BASE });
    await admin.post("/api/dev/login", { data: { email: "admin.guest@example.test", role: "admin" } });
    const [u] = await sql<{ id: string }>(`select id from auth.users where email = 'banned.guest@example.test'`);
    expect((await admin.post("/api/admin/action", { data: { action: "suspend_user", userId: u!.id, suspended: true, reason: "test" } })).status()).toBe(200);
    const again = await checkout(ctx, { x: SPOT.x + 600, y: SPOT.y + 100, w: 20, h: 20 }, "banned.guest@example.test");
    expect(again.status()).toBe(403);
    expect((await again.json()).error).toBe("px_account_suspended");
    await Promise.all([ctx.dispose(), admin.dispose()]);
  });

  test("guests are rate-limited per address: attempts are capped, and so are new accounts", async () => {
    const spammer = await anonymous();
    // attempts: refused for the 9th (cheap requests: the limit is checked before anything else)
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) codes.push((await checkout(spammer, { x: SPOT.x, y: SPOT.y, w: 20, h: 20 }, "nope")).status());
    expect(codes).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 429]);
    await spammer.dispose();

    // new accounts: six per address and hour, the seventh is refused (and creates nothing)
    const maker = await anonymous();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await checkout(maker, { x: SPOT.x + 800 + i * 30, y: SPOT.y + 300, w: 20, h: 20 }, `bulk${i}@example.test`)).status());
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
    expect(await sql(`select 1 from auth.users where email = 'bulk6@example.test'`)).toHaveLength(0);
    await maker.dispose();
  });
});
