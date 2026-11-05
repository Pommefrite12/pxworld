import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * "Fund it together", step 1: a creator designs a big parcel, sends it to moderation (nothing is paid, nothing is held), a moderator
 * approves it (the zone is reserved) or rejects it (with a reason), the creator can withdraw it. Driven through the real HTTP API and
 * the real pages. Self-contained: its own users, in a stretch of land no other spec uses (x 24 000 – 24 700, y 10 400).
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const png = (w: number, h: number, c = "#d02a8a") => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

async function api(email: string, role?: "admin" | "moderator"): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const r = await ctx.post("/api/dev/login", { data: { email, role } });
  expect(r.ok()).toBeTruthy();
  return ctx;
}
/** Signs the browser in (the cookies of the dev login are shared with the page). */
const signIn = async (page: Page, email: string, role?: "admin" | "moderator") => {
  const r = await page.request.post("/api/dev/login", { data: { email, role } });
  expect(r.ok()).toBeTruthy();
};
async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

type R = { x: number; y: number; w: number; h: number };
const A: R = { x: 24_000, y: 10_400, w: 100, h: 100 };
const B: R = { x: 24_300, y: 10_400, w: 100, h: 100 };
const C: R = { x: 24_600, y: 10_400, w: 100, h: 100 };

const send = async (ctx: APIRequestContext, r: R, title: string, extra: Record<string, string> = {}) =>
  ctx.post("/api/campaigns", {
    multipart: { x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h), days: "14", title, description: "A wall for everybody", image: { name: "c.png", mimeType: "image/png", buffer: await png(r.w, r.h) }, ...extra },
  });
const free = async (ctx: APIRequestContext, r: R) => ((await (await ctx.get(`/api/availability?x=${r.x}&y=${r.y}&w=${r.w}&h=${r.h}`)).json()) as { free: boolean }).free;

test.describe.serial("group projects: send, moderate, hold, withdraw", () => {
  let alice: APIRequestContext, bob: APIRequestContext, mod: APIRequestContext, visitor: APIRequestContext;
  let aliceCampaign = "";

  test.beforeAll(async () => {
    [alice, bob, mod] = await Promise.all([api("alice.group@example.test"), api("bob.group@example.test"), api("mod.group@example.test", "moderator")]);
    visitor = await pwRequest.newContext({ baseURL: BASE });
  });
  test.afterAll(async () => { await Promise.all([alice, bob, mod, visitor].map((c) => c.dispose())); });

  test("a visitor cannot send a project: an account is needed", async () => {
    expect((await send(visitor, A, "No account")).status()).toBe(401);
  });

  test("alice sends a project: the goal is the price of the parcel, computed by the server; it is pending and holds nothing", async () => {
    const r = await send(alice, A, "The wall of Alice");
    expect(r.status(), await r.text()).toBe(201);
    const j = await r.json();
    aliceCampaign = j.id;
    expect(j.code).toMatch(/^[0-9a-f]{10}$/);
    const [unit] = await sql<{ value: number }>("select value from public.app_settings where key = 'price_unit_cents'");
    expect(j.goalCents).toBe(100 * 100 * Number(unit!.value));
    const [row] = await sql<{ status: string; parcel_id: string | null; duration_days: number }>("select status, parcel_id, duration_days from public.campaigns where id = $1", [aliceCampaign]);
    expect(row).toMatchObject({ status: "pending", parcel_id: null, duration_days: 14 });
    expect(await free(bob, A)).toBe(true); // nothing is held while moderators have not looked
  });

  test("one project at a time, a parcel too small, a duration that does not exist, a title missing: all refused", async () => {
    const again = await send(alice, C, "A second one");
    expect(again.status()).toBe(409);
    expect((await again.json()).error).toBe("px_campaign_already_active");
    const small = await send(bob, { ...B, w: 50, h: 50 }, "Too small");
    expect(small.status()).toBe(422);
    expect((await small.json()).error).toBe("px_campaign_too_small");
    const days = await send(bob, B, "Ten days", { days: "10" });
    expect(days.status()).toBe(400);
    expect((await days.json()).error).toBe("px_invalid_campaign");
    const untitled = await send(bob, B, "");
    expect(untitled.status()).toBe(400);
    expect((await untitled.json()).error).toBe("title_required");
    expect((await sql("select 1 from public.campaigns where creator_id = (select id from public.profiles where username like 'bob.group%')")).length).toBe(0);
  });

  test("the creation of a pending project is shown to its creator and to the staff, nobody else", async () => {
    const get = (ctx: APIRequestContext) => ctx.get(`/api/campaigns/${aliceCampaign}/image`);
    const ok = await get(alice);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("image/png");
    expect(ok.headers()["cache-control"]).toContain("no-store");
    expect((await get(mod)).status()).toBe(200);
    expect((await get(bob)).status()).toBe(404);
    expect((await get(visitor)).status()).toBe(404);
  });

  test("alice sees it waiting for moderation in her account", async ({ page }) => {
    await signIn(page, "alice.group@example.test");
    await page.goto("/account");
    await page.getByTestId("my-campaigns").click();
    await expect(page).toHaveURL(/\/account\/campaigns$/);
    const item = page.getByTestId("campaign-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("The wall of Alice");
    await expect(item.getByTestId("campaign-status")).toHaveText("Waiting for moderation");
    await expect(item).toContainText("14 days");
    await expect(item.getByTestId("campaign-withdraw")).toBeVisible();
  });

  test("only staff reach the queue; the moderator sees the project with its goal and approves it: the zone is held", async ({ page }) => {
    await signIn(page, "bob.group@example.test");
    await page.goto("/admin/campaigns");
    await expect(page).not.toHaveURL(/\/admin/); // a plain user is sent back to the home page
    await expect(page.getByTestId("campaign-queue-item")).toHaveCount(0);
    await page.context().clearCookies();
    await signIn(page, "mod.group@example.test", "moderator");
    await page.goto("/admin/campaigns");
    const item = page.getByTestId("campaign-queue-item").filter({ hasText: "The wall of Alice" });
    await expect(item).toBeVisible();
    await expect(item.getByTestId("campaign-goal")).toContainText(/\d/);
    await expect(item.locator("img")).toHaveAttribute("src", `/api/campaigns/${aliceCampaign}/image`);
    await item.getByTestId("approve-campaign").click();
    await expect(page.getByTestId("campaign-queue-item").filter({ hasText: "The wall of Alice" })).toHaveCount(0);
    await expect(page.getByTestId("campaign-handled")).toContainText("The wall of Alice");
    await expect(page.getByTestId("campaign-handled").getByTestId("campaign-status").first()).toHaveText("Open");
    const [row] = await sql<{ status: string; parcel_id: string; deadline: Date }>("select status, parcel_id, deadline from public.campaigns where id = $1", [aliceCampaign]);
    expect(row!.status).toBe("open");
    // the decision is also announced to the creator, on her account page
    await page.context().clearCookies();
    await signIn(page, "alice.group@example.test");
    await page.goto("/account");
    await expect(page.getByTestId("news-project_open")).toContainText("The wall of Alice");
    await expect(page.getByTestId("news-project_open")).toContainText("was approved");
    const days = (new Date(row!.deadline).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.01);
  });

  test("while the project is open nobody can buy or start a project on its zone", async () => {
    expect(await free(bob, A)).toBe(false);
    expect(await free(bob, { x: A.x + 40, y: A.y + 40, w: 30, h: 30 })).toBe(false);
    const buy = await bob.post("/api/checkout", { multipart: { x: String(A.x + 10), y: String(A.y + 10), w: "30", h: "30", title: "Mine now", image: { name: "c.png", mimeType: "image/png", buffer: await png(30, 30) } } });
    expect(buy.status()).toBe(409);
    expect((await buy.json()).error).toBe("px_parcel_unavailable");
    const rival = await send(bob, A, "Same spot");
    expect(rival.status()).toBe(409);
    expect((await rival.json()).error).toBe("px_parcel_unavailable");
    // a held zone is not a sold one
    const stats = await (await bob.get("/api/stats")).json();
    expect(stats.soldPixels ?? 0).toBeLessThan(10_000);
  });

  test("alice sees it open, withdraws it, and the zone is free again", async ({ page }) => {
    await signIn(page, "alice.group@example.test");
    await page.goto("/account/campaigns");
    const item = page.getByTestId("campaign-item");
    await expect(item.getByTestId("campaign-status")).toHaveText("Open: collecting");
    page.once("dialog", (d) => void d.accept());
    await item.getByTestId("campaign-withdraw").click();
    await expect(item.getByTestId("campaign-status")).toHaveText("Withdrawn");
    await expect(item.getByTestId("campaign-withdraw")).toHaveCount(0);
    expect(await free(bob, A)).toBe(true);
    expect((await alice.post(`/api/campaigns/${aliceCampaign}/cancel`)).status()).toBe(409); // already withdrawn
    expect((await bob.post(`/api/campaigns/${aliceCampaign}/cancel`)).status()).toBe(404); // and it was never bob's
  });

  test("the real path: bob designs in the same editor, nothing is paid, and a moderator refuses it with a reason bob can read", async ({ page }) => {
    await signIn(page, "bob.group@example.test");
    await page.goto(`/map?bx=${B.x}&by=${B.y}&bw=${B.w}&bh=${B.h}`);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await expect(page.getByTestId("buy-collective")).toBeEnabled();
    await expect(page.getByTestId("buy-collective")).toHaveText("Fund it together");
    await page.getByTestId("buy-collective").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("co-collective-note")).toContainText("Nothing is paid now");
    await expect(dialog.getByTestId("to-review")).toBeDisabled();
    const canvas = dialog.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9, { steps: 12 });
    await page.mouse.up();
    await dialog.getByTestId("to-review").click();

    await dialog.getByTestId("co-title").fill("Bob's mural");
    await expect(dialog.getByTestId("co-total")).toContainText(/\d/); // the goal
    await expect(dialog.getByTestId("co-pay")).toBeDisabled(); // terms not accepted yet
    await dialog.getByTestId("co-days-7").click();
    await expect(dialog.getByTestId("co-days-7")).toHaveAttribute("aria-pressed", "true");
    await dialog.getByTestId("co-accept").check();
    await expect(dialog.getByTestId("co-pay")).toHaveText("Send to moderation");
    await dialog.getByTestId("co-pay").click();

    await expect(dialog.getByTestId("co-collective-sent")).toBeVisible(); // no payment page: it stays here
    expect(new URL(page.url()).pathname).toBe("/map");
    expect(await free(alice, B)).toBe(true); // nothing is held
    await dialog.getByTestId("co-collective-mine").click();
    await expect(page).toHaveURL(/\/account\/campaigns$/);
    const item = page.getByTestId("campaign-item");
    await expect(item).toContainText("Bob's mural");
    await expect(item).toContainText("7 days");
    await expect(item.getByTestId("campaign-status")).toHaveText("Waiting for moderation");

    // the moderator refuses it, with a reason
    const mp = await page.context().browser()!.newContext();
    const modPage = await mp.newPage();
    await signIn(modPage, "mod.group@example.test", "moderator");
    await modPage.goto("/admin/campaigns");
    const queued = modPage.getByTestId("campaign-queue-item").filter({ hasText: "Bob's mural" });
    await queued.getByTestId("reject-campaign").click();
    await queued.getByRole("textbox").fill("Please remove the logo");
    await queued.getByTestId("reject-campaign").click();
    await expect(modPage.getByTestId("campaign-queue-item").filter({ hasText: "Bob's mural" })).toHaveCount(0);
    await mp.close();

    await page.reload();
    await expect(item.getByTestId("campaign-status")).toHaveText("Refused");
    await expect(item.getByTestId("campaign-reason")).toHaveText("Reason: Please remove the logo");
    await page.goto("/account");
    await expect(page.getByTestId("news-project_rejected")).toContainText("Bob's mural");
    await expect(page.getByTestId("news-project_rejected")).toContainText("Reason: Please remove the logo");
    expect(await free(alice, B)).toBe(true);
    // refused: bob may try again (one active project at a time, and this one is over)
    expect((await send(bob, C, "Bob's second try")).status()).toBe(201);
  });

  test("the button explains itself on a parcel that is too small; it speaks French", async ({ page }) => {
    await signIn(page, "carol.group@example.test");
    await page.goto(`/map?bx=${B.x}&by=${B.y + 300}&bw=50&bh=50`);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await expect(page.getByTestId("buy-collective")).toBeDisabled();
    await expect(page.getByTestId("buy-collective-note")).toContainText("10,000");
    await page.goto(`/fr/map?bx=${B.x}&by=${B.y + 300}&bw=100&bh=100`);
    await expect(page.getByTestId("buy-collective")).toHaveText("Financer à plusieurs");
    await expect(page.getByTestId("buy-collective")).toBeEnabled();
  });
});
