import { expect, test } from "@playwright/test";

// Runs in the "mobile" Playwright project (Pixel 7 emulation: touch, small viewport).
test.describe("mobile (touch)", () => {
  test("the map is immediately usable, and a spot can be chosen with a tap", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("application")).toBeVisible();
    await expect(page.getByTestId("find-your-spot")).toBeVisible();
    await page.getByTestId("find-your-spot").click();
    await page.waitForTimeout(1200);
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
