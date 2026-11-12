import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * The edition (the 365 days): pre-launch, opening from the back office, postponing, and the closing decided by the clock.
 * The edition is ONE for the whole site, so this file puts it back as it found it (open) when it is done; the specs run one after the other.
 * It never calls /api/edition nor loads the back office while the edition is closed: those record the closing (ending the open group
 * projects), which other specs may be using. The recording itself is covered by tests/db/editions.test.ts.
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const NAME = "Édition fondatrice";

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}
const setPrelaunch = () => sql(`update public.editions set status = 'prelaunch', opens_at = null, closes_at = null, closed_at = null`);
const setOpen = () => sql(`update public.editions set status = 'open', opens_at = now() - interval '1 day', closes_at = now() + interval '364 days', closed_at = null`);
const setClosedAgo = (minutes: number) => sql(`update public.editions set status = 'open', opens_at = now() - interval '366 days', closes_at = now() - make_interval(mins => $1), closed_at = null`, [minutes]);

async function login(email: string, role?: "admin"): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  return ctx;
}
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
async function tryBuy(ctx: APIRequestContext) {
  return ctx.post("/api/checkout", { multipart: { x: "20000", y: "9000", w: "10", h: "10", description: "A short description", title: "Edition test", image: { name: "c.png", mimeType: "image/png", buffer: await png(10, 10) } } });
}
async function openBuyPanel(page: import("@playwright/test").Page) {
  await page.goto("/map?x=26000&y=11000&z=0.6");
  await page.waitForFunction(() => Boolean((window as unknown as { __pxEngine?: unknown }).__pxEngine));
  await page.getByTestId("find-your-spot").click();
  await expect(page.getByTestId("buy-panel")).toBeVisible();
}

test.describe.serial("the edition: pre-launch, opening, postponing, closing", () => {
  test.afterAll(async () => { await setOpen(); });

  test("while open, the public state is readable by anybody and holds nothing private", async ({ request }) => {
    const r = await request.get("/api/edition");
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("no-store");
    const j = await r.json();
    expect(j).toMatchObject({ name: NAME, state: "open", frozen: false });
    expect(Date.parse(j.closesAt)).toBeGreaterThan(Date.now());
    expect(Math.abs(Date.parse(j.serverNow) - Date.now())).toBeLessThan(60_000);
    for (const k of ["id", "snapshot", "hash", "status"]) expect(j).not.toHaveProperty(k);
    // the scheduled job reports what the edition sweep did: nothing is due
    const cron = await request.get("/api/cron/maintenance", { headers: { authorization: "Bearer e2e-cron-secret" } });
    expect((await cron.json()).edition).toBe("idle");
  });

  test("in pre-launch: no date, nothing for sale, and the buy panel says the archive is not open yet", async ({ page }) => {
    await setPrelaunch();
    const buyer = await login("edition-buyer@example.test");
    const j = await (await buyer.get("/api/edition")).json();
    expect(j).toMatchObject({ state: "prelaunch", frozen: false, closesAt: null, opensAt: null });
    const r = await tryBuy(buyer);
    expect(r.status()).toBe(503);
    expect((await r.json()).error).toBe("px_edition_not_open");
    await buyer.dispose();
    await openBuyPanel(page);
    await expect(page.getByTestId("buy-status")).toContainText(/archive opens soon/i);
    await expect(page.getByTestId("buy-continue")).toBeDisabled();
    // the home page tells the same, from the same database: no date, no countdown, and the map can already be explored
    await page.goto("/");
    await expect(page.getByTestId("home-time")).toHaveAttribute("data-state", "prelaunch");
    await expect(page.getByTestId("home-plate-title")).toHaveText("Opening soon");
    await expect(page.getByTestId("home-days-left")).toHaveCount(0);
    await expect(page.getByTestId("home-plate")).toContainText("The map can already be explored");
    // the map carries the clock too: before the opening it says so, and counts nothing
    await page.goto("/map");
    await expect(page.getByTestId("map-clock")).toHaveAttribute("data-state", "prelaunch");
    await expect(page.getByTestId("map-clock-text")).toHaveText("Opening soon");
    await expect(page.getByTestId("map-clock-duration")).toHaveText("365 days from the opening"); // the length is announced; nothing ticks
    await expect(page.getByTestId("map-clock-time")).toHaveCount(0);
    await page.goto("/fr/map");
    await expect(page.getByTestId("map-clock-duration")).toHaveText(/^365 jours\sà partir de l'ouverture$/);
  });

  test("an administrator opens the edition from the back office, by typing its name; the 365 days start at that moment", async ({ page }) => {
    const admin = await login("edition-admin@example.test", "admin");
    const cookies = (await admin.storageState()).cookies;
    await page.context().addCookies(cookies);
    await admin.dispose();
    await page.goto("/admin/edition");
    const state = page.getByTestId("edition-state");
    await expect(state).toHaveAttribute("data-state", "prelaunch");
    const open = page.getByTestId("edition-open");
    await expect(open).toBeDisabled();
    await page.getByTestId("edition-confirm").fill("ouvrir");
    await expect(open).toBeDisabled(); // the wrong word opens nothing
    await page.getByTestId("edition-confirm").fill(NAME.toUpperCase());
    await expect(open).toBeEnabled();
    const before = Date.now();
    await open.click();
    await expect(state).toHaveAttribute("data-state", "open");
    const e = (await sql<{ status: string; opens_at: Date; closes_at: Date }>(`select status, opens_at, closes_at from public.editions`))[0]!;
    expect(e.status).toBe("open");
    expect(Math.abs(e.opens_at.getTime() - before)).toBeLessThan(30_000);
    expect(e.closes_at.getTime() - e.opens_at.getTime()).toBe(365 * 86_400_000);
    const log = await sql<{ actor_role: string }>(`select actor_role from public.audit_logs where action = 'edition.open'`);
    expect(log.length).toBeGreaterThanOrEqual(1);
    // the clock on the map starts at that moment: 365 days less a few seconds, ticking on the server's clock, in both languages
    await page.goto("/map");
    await expect(page.getByTestId("map-clock")).toHaveAttribute("data-state", "open");
    const time = page.getByTestId("map-clock-time");
    await expect(time).toHaveText(/^364d 23h \d{2}m \d{2}s$/);
    await expect(time).toHaveAttribute("role", "timer");
    await expect(time).toHaveAttribute("aria-label", "364 days left");
    const first = await time.innerText();
    await expect.poll(() => time.innerText(), { timeout: 5_000, message: "the seconds run" }).not.toBe(first);
    await page.goto("/fr/map");
    await expect(page.getByTestId("map-clock")).toContainText("Temps restant pour participer");
    await expect(page.getByTestId("map-clock-time")).toHaveText(/^364[\s\u00a0]j 23[\s\u00a0]h/);
  });

  test("the closing can be postponed from the back office (never brought forward), and is audited", async ({ page }) => {
    await page.context().addCookies((await (await login("edition-admin@example.test", "admin")).storageState()).cookies);
    const before = (await sql<{ closes_at: Date }>(`select closes_at from public.editions`))[0]!;
    await page.goto("/admin/edition");
    await page.locator("#ed-note").fill("rehearsal");
    await page.getByTestId("edition-extend").click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect.poll(async () => (await sql<{ closes_at: Date }>(`select closes_at from public.editions`))[0]!.closes_at.getTime()).toBe(before.closes_at.getTime() + 7 * 86_400_000);
    const log = await sql<{ metadata: { note: string } }>(`select metadata from public.audit_logs where action = 'edition.extend' order by created_at desc limit 1`);
    expect(log[0]!.metadata.note).toBe("rehearsal");
  });

  test("a moderator is not an administrator: the actions of the edition are refused", async () => {
    const mod = await pwRequest.newContext({ baseURL: BASE });
    expect((await mod.post("/api/dev/login", { data: { email: "edition-mod@example.test", role: "moderator" } })).ok()).toBeTruthy();
    for (const body of [{ action: "edition_open", confirm: NAME }, { action: "edition_close_now", confirm: NAME }, { action: "edition_snapshot" }]) {
      const r = await mod.post("/api/admin/action", { data: body, headers: { origin: BASE } });
      expect(r.status(), JSON.stringify(body)).toBe(403);
    }
    await mod.dispose();
  });

  test("after the closing date nothing can be bought, by the clock alone, and the buy panel says the edition is closed", async ({ page }) => {
    await setClosedAgo(2); // closed two minutes ago: the payments under way still have their delay
    const buyer = await login("edition-buyer2@example.test");
    const r = await tryBuy(buyer);
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toBe("px_edition_closed");
    await buyer.dispose();
    await openBuyPanel(page);
    await expect(page.getByTestId("buy-status")).toContainText(/edition is closed/i);
    await expect(page.getByTestId("buy-continue")).toBeDisabled();
    // the home page says it too: the edition is a historical archive, explorable, with no days left to count
    await page.goto("/");
    await expect(page.getByTestId("home-time")).toHaveAttribute("data-state", "closed");
    await expect(page.getByTestId("home-plate-title")).toHaveText("Historical archive");
    await expect(page.getByTestId("home-days-left")).toHaveCount(0);
    await expect(page.getByTestId("home-plate").getByRole("link", { name: "Explore the archive" })).toHaveAttribute("href", "/map");
    await page.goto("/map"); // and so does the map: no clock to count, the edition is over
    await expect(page.getByTestId("map-clock")).toHaveAttribute("data-state", "closed");
    await expect(page.getByTestId("map-clock-text")).toHaveText("Closed · archive frozen");
    await expect(page.getByTestId("map-clock-time")).toHaveCount(0);
    expect((await sql<{ status: string }>(`select status from public.editions`))[0]!.status).toBe("open"); // nothing recorded it: the clock decided
  });
});
