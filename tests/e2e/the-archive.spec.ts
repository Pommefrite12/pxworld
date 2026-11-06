import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * The archive: a trace carries a category and the place it is about, and has a page of its own (/archive/<code>) that can be read and shared
 * without the map. Driven through the real HTTP API and the real pages. Self-contained: its own users and its own spot on the map.
 *
 * It is named "the-archive" so that it runs AFTER journey.spec.ts: that one starts by checking that nothing has been sold yet, and this one buys.
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 27_500, y: 10_000, w: 10, h: 10 };

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}
async function login(email: string, role?: "admin" | "moderator"): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  return ctx;
}
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#d98a2b" } }).png().toBuffer();
const checkout = async (ctx: APIRequestContext, fields: Record<string, string>) =>
  ctx.post("/api/checkout", { multipart: { x: String(SPOT.x), y: String(SPOT.y), w: String(SPOT.w), h: String(SPOT.h), title: "La pizza du dimanche", ...fields, image: { name: "c.png", mimeType: "image/png", buffer: await png(SPOT.w, SPOT.h) } } });
const admin = (ctx: APIRequestContext, data: Record<string, unknown>) => ctx.post("/api/admin/action", { data, headers: { origin: BASE } });
const pendingAsset = async (code: string) =>
  (await sql<{ id: string }>(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.code = $1 and a.status = 'pending' order by a.version desc limit 1`, [code]))[0]!.id;

test.describe.serial("a trace in the archive: category, place, and a page of its own", () => {
  let owner: APIRequestContext, mod: APIRequestContext;
  let code = "";
  const author = "archive-owner";

  test.beforeAll(async () => {
    [owner, mod] = await Promise.all([login(`${author}@example.test`), login("archive-mod@example.test", "moderator")]);
  });
  test.afterAll(async () => { await Promise.all([owner, mod].map((c) => c.dispose())); });

  test("the API refuses a category or a country that does not exist, before holding any pixel", async () => {
    const bad = await checkout(owner, { category: "pizza" });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe("invalid_category");
    const badCountry = await checkout(owner, { category: "food", placeCountry: "ITA" });
    expect(badCountry.status()).toBe(400);
    expect((await badCountry.json()).error).toBe("invalid_country");
    expect((await sql(`select 1 from public.parcels where x = $1 and y = $2 and status in ('reserved','active')`, [SPOT.x, SPOT.y])).length).toBe(0);
  });

  test("a purchase with a category and a place: paid, the trace waits for moderation and already has its page", async ({ request }) => {
    const r = await checkout(owner, { category: "food", placeLabel: "  Naples ", placeCountry: "it" });
    expect(r.status(), await r.text()).toBe(200);
    const { orderId } = await r.json();
    expect((await (await owner.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
    code = (await (await owner.get(`/api/orders/${orderId}`)).json()).parcelCode;
    expect(code).toMatch(/^[0-9a-f]{10}$/);
    const a = (await sql<{ category: string; place_label: string; place_country: string }>(`select category, place_label, place_country from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.code = $1`, [code]))[0]!;
    expect(a).toEqual({ category: "food", place_label: "Naples", place_country: "IT" }); // cleaned: spaces, upper-case country

    const html = await (await request.get(`/archive/${code}`)).text();
    expect(html).toContain('data-testid="archive-pending"');
    expect(html).not.toContain('data-testid="archive-image"');
    expect(html).toMatch(/<meta name="robots" content="noindex/); // nothing to index yet
  });

  test("a moderator sees the category and the place with the creation, before deciding", async ({ page }) => {
    await page.context().addCookies((await mod.storageState()).cookies);
    await page.goto("/admin/moderation");
    const item = page.getByTestId("queue-item").filter({ hasText: "La pizza du dimanche" });
    await expect(item.getByTestId("archive-category")).toHaveText("Food and traditions");
    await expect(item.getByTestId("archive-place")).toContainText("Naples, Italy");
    expect((await admin(mod, { action: "review_asset", assetId: await pendingAsset(code), decision: "approve" })).ok()).toBeTruthy();
  });

  test("once approved, the page of the trace tells everything and can be shared", async ({ page, request }) => {
    await page.goto(`/archive/${code}`);
    await expect(page.getByTestId("archive-title")).toHaveText("La pizza du dimanche");
    await expect(page.getByTestId("archive-author")).toHaveText(author);
    await expect(page.getByTestId("archive-date")).toContainText(/Archived on \w+ \d{1,2}, \d{4}/);
    await expect(page.getByTestId("archive-category")).toHaveText("Food and traditions");
    await expect(page.getByTestId("archive-place")).toContainText("Naples, Italy");
    await expect(page.getByTestId("archive-edition")).toHaveText("Founding edition");
    await expect(page.getByTestId("archive-image")).toBeVisible();
    expect(await page.getByTestId("archive-image").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(page.getByTestId("archive-share")).toBeVisible();
    // the page is meant to be found and shared: a title, a description, a share image, a canonical address, indexable
    const html = await (await request.get(`/archive/${code}`)).text();
    expect(html).toContain(`rel="canonical" href="http://localhost:${process.env.E2E_PORT ?? "3100"}/archive/${code}"`);
    expect(html).toContain(`property="og:image" content="http://localhost:${process.env.E2E_PORT ?? "3100"}/api/og/parcel/${code}"`);
    expect(html).not.toMatch(/<meta name="robots" content="noindex/);
    // the button to share copies the link when the device has no share sheet
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await page.evaluate(() => { (navigator as unknown as { share?: unknown }).share = undefined; });
    await page.getByTestId("archive-share").click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied." })).toBeVisible();
    // and the map is one click away, on the same parcel
    await page.getByTestId("archive-on-map").click();
    await page.waitForURL(new RegExp(`/p/${code}$`));
  });

  test("the card on the map shows them too and leads to the archive page", async ({ page }) => {
    await page.goto(`/p/${code}`);
    const card = page.getByRole("article", { name: /Parcel details/i });
    await expect(card.getByTestId("archive-category")).toHaveText("Food and traditions", { timeout: 20_000 });
    await expect(card.getByTestId("archive-place")).toContainText("Naples, Italy");
    await expect(card.getByTestId("card-archive-page")).toHaveAttribute("href", `/archive/${code}`);
  });

  test("the home page lists it, among the recently archived, with its category and place, and leads to its page", async ({ page }) => {
    await page.goto("/");
    const tile = page.getByTestId("home-trace").and(page.locator(`[data-code="${code}"]`));
    await expect(tile).toBeVisible();
    await expect(tile).toContainText("La pizza du dimanche");
    await expect(tile).toContainText("Food and traditions");
    await expect(tile).toContainText("Naples, Italy");
    await expect(tile).toContainText(`by ${author}`);
    // its picture is really there (not only its title): scrolled into view, the image of the trace has been loaded
    await tile.scrollIntoViewIfNeeded();
    await expect.poll(() => tile.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await tile.click();
    await expect(page).toHaveURL(new RegExp(`/archive/${code}$`));
    await expect(page.getByTestId("archive-title")).toHaveText("La pizza du dimanche");
  });

  test("the public JSON carries the archive fields and the edition", async ({ request }) => {
    const j = await (await request.get(`/api/parcels/${code}`)).json();
    expect(j.creation).toMatchObject({ category: "food", placeLabel: "Naples", placeCountry: "IT" });
    expect(j.edition).toEqual({ slug: "fondatrice", name: "Édition fondatrice" });
  });

  test("in French: the same page, in French words", async ({ page }) => {
    await page.goto(`/fr/archive/${code}`);
    await expect(page.getByTestId("archive-date")).toContainText("Archivée le");
    await expect(page.getByTestId("archive-category")).toHaveText("Cuisine et traditions");
    await expect(page.getByTestId("archive-place")).toContainText("Naples, Italie");
    await expect(page.getByTestId("archive-edition")).toHaveText("Édition fondatrice");
  });

  test("a new version keeps its own fields, and the edit form starts from the current ones", async ({ page }) => {
    const r = await owner.post(`/api/parcels/${code}/creation`, { multipart: { title: "La pizza du dimanche", category: "family", placeLabel: "Chez Nonna", image: { name: "c.png", mimeType: "image/png", buffer: await png(SPOT.w, SPOT.h) } } });
    expect(r.status(), await r.text()).toBe(201);
    const v = (await sql<{ category: string; place_label: string; place_country: string | null }>(`select category, place_label, place_country from public.parcel_assets where id = $1`, [await pendingAsset(code)]))[0]!;
    expect(v).toEqual({ category: "family", place_label: "Chez Nonna", place_country: null });
    // the page still shows the approved version until the new one is validated
    await page.goto(`/archive/${code}`);
    await expect(page.getByTestId("archive-category")).toHaveText("Food and traditions");
    // the edit form (in the owner's account) is filled with what the published trace says
    await page.context().addCookies((await owner.storageState()).cookies);
    await page.goto(`/account/parcels/${code}/edit`);
    await expect(page.getByTestId("ec-category")).toHaveValue("food");
    await expect(page.getByTestId("ec-place")).toHaveValue("Naples");
    await expect(page.getByTestId("ec-country")).toHaveValue("IT");
    expect((await admin(mod, { action: "review_asset", assetId: await pendingAsset(code), decision: "approve" })).ok()).toBeTruthy();
    await page.goto(`/archive/${code}`);
    await expect(page.getByTestId("archive-category")).toHaveText("Family and memories");
  });

  test("a trace hidden by moderation shows nothing of its creation; an unknown code is a 404", async ({ page, request }) => {
    const parcelId = (await sql<{ id: string }>(`select id from public.parcels where code = $1`, [code]))[0]!.id;
    expect((await admin(await login("archive-admin@example.test", "admin"), { action: "hide_parcel", parcelId, hidden: true, reason: "test" })).ok()).toBeTruthy();
    await page.goto(`/archive/${code}`);
    await expect(page.getByTestId("archive-pending")).toContainText(/hidden by moderation/i);
    await expect(page.getByTestId("archive-image")).toHaveCount(0);
    await expect(page.getByTestId("archive-category")).toHaveCount(0);
    await page.goto("/");
    await expect(page.locator(`[data-testid="home-trace"][data-code="${code}"]`)).toHaveCount(0); // nor does the home page list it
    expect((await request.get("/archive/0000000000")).status()).toBe(404);
    expect((await request.get("/archive/not-a-code")).status()).toBe(404);
  });
});
