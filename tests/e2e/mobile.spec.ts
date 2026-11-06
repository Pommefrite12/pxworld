import { expect, request as pwRequest, test } from "@playwright/test";
import sharp from "sharp";

// Runs in the "mobile" Playwright project (Pixel 7 emulation: touch, small viewport).
test.describe("mobile (touch)", () => {
  test("the map is immediately usable, and a spot can be chosen with a tap", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByRole("application")).toBeVisible(); // the home page is the map
    await expect(page.getByTestId("find-your-spot")).toBeVisible();
    await page.waitForFunction(() => Boolean((window as unknown as { __pxEngine?: unknown }).__pxEngine)); // interactive
    await page.getByTestId("find-your-spot").click(); // buy mode, on the same page
    await expect(page.getByTestId("buy-panel")).toBeVisible();
    await page.waitForTimeout(1800);
    const box = (await page.getByRole("application").boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * 0.4, box.y + 120);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i, { timeout: 10_000 });
    await expect(page.getByTestId("buy-continue")).toBeVisible(); // the primary action is never pushed off-screen
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("no horizontal scrolling on content pages", async ({ page }) => {
    for (const p of ["/discover", "/rules", "/auth/sign-in"]) {
      await page.goto(p);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});

/** The home page on a phone: the planisphere above the sentence, both buttons inside the screen and reachable, nothing wider than the screen. */
for (const width of [320, 390, 412]) {
  for (const path of ["/", "/fr", "/about"]) {
    test(`the home page fits a ${width}px phone: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(path);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal scrolling").toBe(true);
      if (path === "/about") return;
      const title = (await page.getByTestId("home-title").boundingBox())!;
      const world = (await page.getByTestId("hero-world").boundingBox())!;
      expect(world.y + world.height, "the planisphere is above the sentence").toBeLessThanOrEqual(title.y + 40);
      for (const id of ["home-leave-trace", "home-explore"]) {
        const b = (await page.getByTestId(id).boundingBox())!;
        expect(b.x, id).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, id).toBeLessThanOrEqual(width + 0.5);
        expect(b.height, `${id} is easy to tap`).toBeGreaterThanOrEqual(44);
      }
      // the primary action is on the first screen, or one short scroll away
      const cta = (await page.getByTestId("home-leave-trace").boundingBox())!;
      expect(cta.y + cta.height).toBeLessThanOrEqual(900);
    });
  }
}

test("the countdown fits a phone: no horizontal scrolling, the plate inside the screen, the strip above the header", async ({ page }) => {
  await page.goto("/?preview=J-9");
  const plate = page.getByTestId("doom-plate");
  await expect(plate).toBeVisible();
  const box = (await plate.boundingBox())!;
  const vw = await page.evaluate(() => window.innerWidth);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const strip = (await page.getByTestId("doom-ticker").boundingBox())!, header = (await page.locator("header").boundingBox())!;
  expect(strip.y + strip.height).toBeLessThanOrEqual(header.y + 0.5);
});

/** The header is one row: logo, a call to action, the language and the account. On the narrowest phones it must still fit, in both languages, with and without the story. */
for (const width of [320, 360, 390, 412]) {
  for (const path of ["/", "/fr", "/?preview=J-9", "/fr?preview=J-9", "/discover", "/fr/discover"]) {
    test(`the header fits a ${width}px phone: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(path);
      await expect(page.locator("header")).toBeVisible();
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const header = document.querySelector("header")!, vw = window.innerWidth;
        const out: string[] = [];
        for (const el of header.querySelectorAll<HTMLElement>("a, button")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue; // hidden at this width
          if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 24)} [${Math.round(r.left)}–${Math.round(r.right)}]`);
        }
        return { outside: out, pageScrolls: document.documentElement.scrollWidth > vw, headerScrolls: header.scrollWidth > header.clientWidth };
      });
      expect(m.outside, "nothing of the header is pushed off the screen").toEqual([]);
      expect(m.pageScrolls, "the page does not scroll sideways").toBe(false);
      expect(m.headerScrolls, "the header does not overflow itself").toBe(false);
    });
  }
}

/** The title of the story tile ("Save the world. And the pizza with it." / "Sauvez le monde. Et la pizza avec.") is one line, whatever the screen, in both languages. */
for (const width of [320, 360, 390, 412]) {
  for (const path of ["/?preview=J-9", "/fr?preview=J-9"]) {
    test(`the title of the story tile is one line on a ${width}px phone: ${path}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(path);
      const title = page.getByTestId("doom-title");
      await expect(title).toBeVisible();
      const m = await title.evaluate((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight); return { lines: Math.round((r.height - parseFloat(cs.paddingTop)) / lh), overflow: el.scrollWidth > el.clientWidth, font: parseFloat(cs.fontSize) }; });
      expect(m.lines, "one line").toBe(1);
      expect(m.overflow, "it fits the tile").toBe(false);
      expect(m.font, "and stays readable").toBeGreaterThanOrEqual(12.8);
    });
  }
}

/** The pages of the group projects fit a phone: no sideways scrolling, and the way to chip in is within reach. */
test.describe("group projects on a phone", () => {
  test("the list and the page of a project fit the screen, the button to chip in is near the top", async ({ page }) => {
    const base = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
    const login = async (email: string, role?: "moderator") => { const c = await pwRequest.newContext({ baseURL: base }); expect((await c.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy(); return c; };
    const [maker, mod] = [await login("maker.phone@example.test"), await login("mod.phone@example.test", "moderator")];
    const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#2b35e0" } }).png().toBuffer();
    const sent = await maker.post("/api/campaigns", { multipart: { x: "25800", y: "10400", w: "100", h: "100", days: "14", title: "A wall seen from a phone", description: "A parcel for everybody, with a rather long description to check that the text wraps and never pushes the page sideways.", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
    expect(sent.status(), await sent.text()).toBe(201);
    const { id, code } = await sent.json();
    expect((await mod.post("/api/admin/action", { data: { action: "review_campaign", campaignId: id, decision: "approve" } })).status()).toBe(200);
    await Promise.all([maker.dispose(), mod.dispose()]);

    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const path of ["/projects", "/fr/projects", `/projects/${code}`, `/fr/projects/${code}`]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      expect(await overflow(), `${path}: no sideways scrolling`).toBeLessThanOrEqual(0);
    }
    await page.goto(`/projects/${code}`);
    const cta = page.getByTestId("contribute-signin");
    await expect(cta).toBeVisible();
    const box = (await cta.boundingBox())!;
    const vh = page.viewportSize()!.height;
    expect(box.y + box.height, "the button is on the first screen").toBeLessThan(vh);
    expect(box.width).toBeGreaterThan(200);
  });
});
