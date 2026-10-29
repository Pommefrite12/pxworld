import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * The main user journey, end to end, against a real PostgreSQL and the real Next.js server.
 * Stripe is the local mock (no network, no money); everything after "payment confirmed" is the real code path:
 * the synthetic event goes through the same handler as the verified webhook.
 */

const SPOT = { x: 25_000, y: 10_000, w: 20, h: 20 };

async function signIn(page: Page, email: string, next = "/") {
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-submit").click();
  await page.waitForURL((u) => !u.pathname.includes("/auth/"), { timeout: 30_000 });
}

async function newUser(browser: Browser, email: string, next = "/") {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  await signIn(page, email, next);
  return { ctx, page };
}

test.describe.serial("buy → pay → moderate → publish", () => {
  let parcelCode = "";
  let assetId = "";

  test("the counter is real: nothing is sold at the start", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByTestId("sold-pixels")).toHaveText("0");
    const stats = await (await request.get("/api/stats")).json();
    expect(stats).toMatchObject({ totalPixels: 1_000_000_000, soldPixels: 0, owners: 0, parcels: 0, publishedCreations: 0 });
    // the map canvas is there and has been painted
    await expect(page.getByRole("application")).toBeVisible();
  });

  test("an anonymous visitor can explore and is sent to sign in before buying; the spot is kept", async ({ page }) => {
    await page.goto(`/?bx=${SPOT.x}&by=${SPOT.y}&bw=${SPOT.w}&bh=${SPOT.h}`);
    const panel = page.getByTestId("buy-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await expect(page.getByTestId("buy-price")).toHaveText("€400");
    await expect(page.getByTestId("buy-area")).toContainText("400");
    await page.getByTestId("buy-continue").click(); // "Sign in to continue"
    await page.waitForURL(/\/auth\/sign-in/);
    await page.getByTestId("auth-email").fill("alice@example.test");
    await page.getByTestId("auth-submit").click();
    // back on the map with the same selection restored
    await page.waitForURL(/bx=25000/);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
  });

  test("alice designs, pays and receives the parcel only after the (mock) webhook", async ({ browser }) => {
    const { ctx, page } = await newUser(browser, "alice@example.test", `/?bx=${SPOT.x}&by=${SPOT.y}&bw=${SPOT.w}&bh=${SPOT.h}`);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("to-review")).toBeDisabled(); // nothing designed yet

    // draw directly in the parcel with the pencil: a diagonal stroke
    const canvas = dialog.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9, { steps: 12 });
    await page.mouse.up();
    await expect(dialog.getByTestId("to-review")).toBeEnabled();
    await dialog.getByTestId("to-review").click();

    await dialog.getByTestId("co-title").fill("Hello world");
    await expect(dialog.getByTestId("co-total")).toHaveText("€400");
    await expect(dialog.getByTestId("co-pay")).toBeDisabled(); // terms not accepted yet
    await dialog.getByTestId("co-accept").check();
    await dialog.getByTestId("co-pay").click();

    // redirected to the (mock) payment page: nothing is attributed yet
    await page.waitForURL(/\/dev\/checkout\//);
    const orderId = page.url().split("/").pop()!;
    const before = await page.request.get(`/api/orders/${orderId}`);
    expect((await before.json()).status).toBe("pending");
    const statsBefore = await (await page.request.get("/api/stats")).json();
    expect(statsBefore.soldPixels).toBe(0); // reservation ≠ sale

    // hitting the success URL directly proves nothing either
    await page.goto(`/checkout/success?order=${orderId}`);
    // …but the server-side order is still pending, so we go back and "pay"
    await page.goto(`/dev/checkout/${orderId}`);
    await page.getByTestId("dev-pay").click();
    await page.waitForURL(/checkout\/success/);
    await expect(page.getByTestId("checkout-result")).toHaveAttribute("data-state", "paid", { timeout: 30_000 });
    await page.getByTestId("view-parcel").click();
    await page.waitForURL(/\/p\/[0-9a-f]{10}/);
    parcelCode = page.url().split("/").pop()!.split("?")[0]!;
    expect(parcelCode).toMatch(/^[0-9a-f]{10}$/);
    await expect(page.getByText(/waiting for moderation/i)).toBeVisible();

    // my parcels + orders
    await page.goto("/account/parcels");
    await expect(page.getByTestId("my-parcel")).toHaveCount(1);
    await expect(page.getByText("Awaiting moderation").or(page.getByText("Add your creation"))).toBeVisible();
    await page.goto("/account/orders");
    await expect(page.getByTestId("order-status")).toHaveText("Paid");
    await ctx.close();
  });

  test("the sold pixels are counted, but the creation is not public before moderation", async ({ page, request }) => {
    const stats = await (await request.get("/api/stats")).json();
    expect(stats).toMatchObject({ soldPixels: 400, parcels: 1, owners: 1, publishedCreations: 0 });
    const tile = await (await request.get("/api/map/tiles/25/10")).json();
    expect(tile).toHaveLength(1);
    expect(tile[0].slice(0, 5)).toEqual([parcelCode, SPOT.x, SPOT.y, SPOT.w, SPOT.h]);
    expect(tile[0][5]).toBeNull(); // no public asset yet
    await page.goto("/");
    await expect(page.getByTestId("sold-pixels")).toHaveText("400");
  });

  test("nobody else can buy any of those pixels (client check and server check)", async ({ browser }) => {
    const { ctx, page } = await newUser(browser, "bob@example.test", `/?bx=${SPOT.x + 10}&by=${SPOT.y + 10}&bw=20&bh=20`);
    await expect(page.getByTestId("buy-status")).toContainText(/overlaps an existing parcel/i);
    await expect(page.getByTestId("buy-continue")).toBeDisabled();
    // and the server refuses even if the client is bypassed
    const form = new FormData();
    for (const [k, v] of Object.entries({ x: SPOT.x + 10, y: SPOT.y + 10, w: 20, h: 20 })) form.set(k, String(v));
    const png = await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 20; c.height = 20;
      const g = c.getContext("2d")!; g.fillStyle = "#f00"; g.fillRect(0, 0, 20, 20);
      return c.toDataURL("image/png");
    });
    form.set("image", new Blob([Buffer.from(png.split(",")[1]!, "base64")], { type: "image/png" }), "c.png");
    const res = await page.request.post("/api/checkout", { multipart: { x: String(SPOT.x + 10), y: String(SPOT.y + 10), w: "20", h: "20", image: { name: "c.png", mimeType: "image/png", buffer: Buffer.from(png.split(",")[1]!, "base64") } } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("px_parcel_unavailable");
    // an adjacent parcel is fine
    await page.goto(`/?bx=${SPOT.x + 20}&by=${SPOT.y}&bw=20&bh=20`);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await ctx.close();
  });

  test("security: anonymous and non-staff users cannot use protected endpoints", async ({ browser, request }) => {
    expect((await request.post("/api/checkout", { multipart: { x: "1", y: "1", w: "10", h: "10" } })).status()).toBe(401);
    expect((await request.post("/api/admin/action", { data: { action: "hide_parcel", parcelId: "00000000-0000-0000-0000-000000000000", hidden: true } })).status()).toBe(401);
    const { ctx, page } = await newUser(browser, "mallory@example.test");
    const r = await page.request.post("/api/admin/action", { data: { action: "suspend_user", userId: "00000000-0000-0000-0000-000000000000", suspended: true } });
    expect(r.status()).toBe(403);
    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin/); // redirected away
    await ctx.close();
  });

  test("a moderator approves the creation; it becomes public and shareable", async ({ browser, request }) => {
    const { ctx, page } = await newUser(browser, "admin@example.test", "/admin/moderation");
    await expect(page.getByTestId("queue-item")).toHaveCount(1);
    await expect(page.getByTestId("queue-item")).toContainText("Hello world");
    await page.getByTestId("approve").click();
    await expect(page.getByTestId("queue-empty")).toBeVisible();

    // audit log recorded it
    await page.goto("/admin/audit");
    await expect(page.getByTestId("audit-row").filter({ hasText: "asset.approve" })).toHaveCount(1);
    await page.goto("/admin");
    await ctx.close();

    const stats = await (await request.get("/api/stats")).json();
    expect(stats.publishedCreations).toBe(1);
    const tile = await (await request.get("/api/map/tiles/25/10")).json();
    assetId = tile[0][5];
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/);
    const img = await request.get(`/api/assets/${assetId}`);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toBe("image/png");
    const bytes = await img.body();
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // public parcel card
    const card = await (await request.get(`/api/parcels/${parcelCode}`)).json();
    expect(card).toMatchObject({ code: parcelCode, w: 20, h: 20, area: 400, creation: { title: "Hello world", assetId } });
    expect(card.owner.username).toBe("alice");
  });

  test("the permalink has social previews and opens the map on the parcel", async ({ page, request }) => {
    const res = await request.get(`/p/${parcelCode}`);
    const html = await res.text();
    expect(html).toContain('property="og:title"');
    expect(html).toContain(`/api/og/parcel/${parcelCode}`);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`rel="canonical" href="http://localhost:3100/p/${parcelCode}"`);
    const og = await request.get(`/api/og/parcel/${parcelCode}`);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
    await page.goto(`/p/${parcelCode}`);
    await expect(page.getByRole("heading", { name: "Hello world" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByTestId("zoom-level")).not.toHaveText("0.03×"); // zoomed in on the parcel
  });

  test("discover lists the published creation and the sitemap exposes its permanent URL", async ({ page, request }) => {
    await page.goto("/discover");
    await expect(page.getByRole("link", { name: /Hello world/ }).first()).toBeVisible();
    const sm = await (await request.get("/sitemap.xml")).text();
    expect(sm).toContain(`/p/${parcelCode}`);
    expect((await (await request.get("/robots.txt")).text())).toContain("Sitemap:");
  });

  test("the interface is bilingual", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Un milliard de pixels");
    await expect(page.getByTestId("find-your-spot")).toHaveText("Trouvez votre place");
    await page.goto("/fr/discover");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Découvrir");
  });
});
