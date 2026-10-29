import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

/** Interface-level checks: accessibility, keyboard, search, touch/mobile. Independent of the other specs' data. */

declare global {
  interface Window { __pxEngine?: { cam: { x: number; y: number; scale: number }; fitScale: number; geoPending: boolean } }
}

const camera = async (page: import("@playwright/test").Page) => {
  await page.waitForFunction(() => Boolean(window.__pxEngine), undefined, { timeout: 20_000 }); // the engine exists once the canvas is mounted
  return page.evaluate(() => ({ ...window.__pxEngine!.cam }));
};

test.describe("accessibility (axe, WCAG 2.1 A/AA)", () => {
  for (const path of ["/", "/fr", "/discover", "/rules", "/terms", "/auth/sign-in", "/auth/sign-up"]) {
    test(`no serious violation on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
});

test.describe("map interaction", () => {
  test("geography is fully drawn at every zoom (no missing tiles) and a frame is cheap", async ({ page }) => {
    for (const [x, y, z] of [[24200, 7400, 2.5], [25326, 4882, 12], [10000, 6000, 0.4], [25000, 10000, 40]] as const) {
      await page.goto(`/?x=${x}&y=${y}&z=${z}`);
      await page.waitForFunction(() => window.__pxEngine && !window.__pxEngine.geoPending, undefined, { timeout: 20_000 });
      const ms = await page.evaluate(async () => {
        const e = window.__pxEngine as unknown as { cam: { x: number; scale: number }; invalidate(): void; draw(): void };
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) { e.cam.x += 2 / e.cam.scale; e.draw(); }
        return (performance.now() - t0) / 20;
      });
      expect(ms, `avg draw ms at scale ${z}`).toBeLessThan(40); // generous: CI runners use software rendering
    }
  });

  test("keyboard: arrows pan, plus/minus zoom, 0 recentres", async ({ page }) => {
    await page.goto("/?x=20000&y=8000&z=1");
    const canvas = page.getByRole("application");
    await canvas.focus();
    const before = await camera(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await camera(page)).x).toBeGreaterThan(before.x + 50);
    await page.keyboard.press("+");
    await expect.poll(async () => (await camera(page)).scale).toBeGreaterThan(before.scale * 1.3);
    await page.keyboard.press("0");
    await expect.poll(async () => (await camera(page)).scale, { timeout: 5000 }).toBeLessThan(0.05);
  });

  test("wheel zoom is anchored under the cursor and stays inside the allowed range", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(800);
    const c = await camera(page);
    const box = (await page.getByRole("application").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.4);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    const z = await camera(page);
    expect(z.scale).toBeLessThanOrEqual(48);
    expect(z.scale).toBeGreaterThan(c.scale * 20);
    expect(z.x).toBeGreaterThan(c.x); // zoomed towards the right half
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    expect((await camera(page)).scale).toBeGreaterThanOrEqual(c.scale * 0.99); // never smaller than "whole world"
  });

  test("drag pans the map", async ({ page }) => {
    await page.goto("/?x=25000&y=10000&z=2");
    await page.waitForTimeout(500);
    const before = await camera(page);
    const box = (await page.getByRole("application").boundingBox())!;
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 300, { steps: 8 });
    await page.mouse.up();
    const after = await camera(page);
    expect(after.x).toBeGreaterThan(before.x + 50); // content followed the pointer to the left → camera moved right
    expect(Math.abs(after.y - before.y)).toBeLessThan(5);
  });

  test("geographic search flies to a country and a city, and understands coordinates", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("combobox").first();
    await search.fill("Paris");
    await page.getByRole("listbox").getByRole("option").first().click();
    await expect.poll(async () => (await camera(page)).scale, { timeout: 8000 }).toBeGreaterThan(1);
    const c = await camera(page);
    expect(Math.abs(c.x - 25326)).toBeLessThan(40); // 2.35°E
    expect(Math.abs(c.y - 4882)).toBeLessThan(40); // 48.85°N
    await search.fill("48.85, 2.35");
    await page.getByRole("listbox").getByRole("option").first().click();
    await expect.poll(async () => Math.round((await camera(page)).scale)).toBe(6);
    await page.goto("/fr");
    await page.getByRole("combobox").first().fill("Japon");
    await expect(page.getByRole("listbox").getByRole("option").first()).toContainText("Japon"); // country names follow the interface language
  });

  test("buy mode: clicking the map places a parcel, collisions and bounds are reported", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("find-your-spot").click();
    await page.waitForTimeout(1200);
    const box = (await page.getByRole("application").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i, { timeout: 10_000 });
    // a size below the minimum is refused with an explanation, no parcel can be bought
    await page.getByLabel("Width (px)").fill("5");
    await page.getByLabel("Height (px)").fill("5");
    await expect(page.getByTestId("buy-status")).toContainText(/minimum surface is 100/i);
    await expect(page.getByTestId("buy-continue")).toBeDisabled();
    // the price follows the size immediately
    await page.getByLabel("Width (px)").fill("30");
    await page.getByLabel("Height (px)").fill("40");
    await expect(page.getByTestId("buy-price")).toHaveText("€1,200");
    await expect(page.getByTestId("buy-area")).toContainText("1,200");
  });
});

test.describe("editor", () => {
  test("preview on the map shows the creation pixel-exact inside the selection, and returning keeps the work", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    expect((await ctx.request.post("/api/dev/login", { data: { email: "preview@example.test" } })).ok()).toBeTruthy();
    const page = await ctx.newPage();
    await page.goto("/?bx=40000&by=3000&bw=20&bh=20");
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();
    const dialog = page.getByRole("dialog");
    const canvas = dialog.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    // the canvas is the exact parcel resolution, scaled up for editing
    expect(await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([20, 20]);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await dialog.getByRole("button", { name: "Preview on the map" }).click();
    await expect(page.getByText("Previewing on the map")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((window.__pxEngine as unknown as { previewImage: unknown }).previewImage))).toBe(true);
    await page.getByRole("button", { name: "Back to the editor" }).click();
    await expect(dialog.getByTestId("to-review")).toBeEnabled(); // the drawing survived the round trip
    // the exported image has exactly the parcel's dimensions
    await dialog.getByTestId("to-review").click();
    const img = dialog.getByRole("img", { name: "Final render, pixel for pixel" });
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([20, 20]);
    await ctx.close();
  });

  test("an uploaded photo is cropped to the parcel; unsupported files are refused client-side", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    await ctx.request.post("/api/dev/login", { data: { email: "uploader@example.test" } });
    const page = await ctx.newPage();
    await page.goto("/?bx=41000&by=3000&bw=30&bh=30");
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();
    const dialog = page.getByRole("dialog");
    const photo = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#12b886" } }).png().toBuffer();
    await dialog.locator('input[type="file"]').setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: photo });
    await expect(dialog.getByTestId("to-review")).toBeEnabled();
    await expect(dialog.getByRole("radiogroup", { name: "Fit" }).getByRole("radio", { name: "Fill" })).toBeVisible();
    // the editing canvas keeps the exact parcel resolution whatever the photo size
    expect(await dialog.locator("canvas").first().evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([30, 30]);
    // the pixels of the composed result come from the photo (cover fit → fully green)
    const centre = await dialog.locator("canvas").first().evaluate((c: HTMLCanvasElement) => Array.from(c.getContext("2d")!.getImageData(15, 15, 1, 1).data));
    expect(centre).toEqual([18, 184, 134, 255]);
    // a disguised SVG is refused before any upload happens
    await dialog.locator('input[type="file"]').setInputFiles({ name: "evil.png", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
    await expect(dialog.getByRole("alert")).toContainText(/PNG, JPEG and WebP/);
    await ctx.close();
  });
});
