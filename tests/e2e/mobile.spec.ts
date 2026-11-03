import { expect, test } from "@playwright/test";

// Runs in the "mobile" Playwright project (Pixel 7 emulation: touch, small viewport).
test.describe("mobile (touch)", () => {
  test("the map is immediately usable, and a spot can be chosen with a tap", async ({ page }) => {
    await page.goto("/");
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
