import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The comic strip of the story (six pictures, opened from a button). It belongs to the story, so it only exists where the story does:
 * `?preview=J-9` here (the e2e server configures no date).
 */
test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1360, height: 860 }); });

test("it is not there without the story", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("sold-pixels")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("comic-open")).toHaveCount(0);
});

test("a button opens it; the pictures follow one another with the buttons, the arrow keys and the dots; Escape closes it", async ({ page }) => {
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  const comic = page.getByTestId("comic");
  await expect(comic).toBeVisible();
  const image = page.getByTestId("comic-image");
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 1 of 6");
  await expect(page.getByTestId("comic-panel-title")).toHaveText("A world full of things");
  await expect(image).toHaveAttribute("src", "/story/panel-1.png");
  await expect(page.getByTestId("comic-prev")).toBeDisabled();
  await expect(page.getByTestId("comic-cta")).toHaveCount(0); // the call to action comes with the last picture

  // the picture is really loaded (not a broken link)
  await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(960);

  await page.getByTestId("comic-next").click();
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 2 of 6");
  await expect(image).toHaveAttribute("src", "/story/panel-2.png");
  await expect(image).toHaveAttribute("alt", /hooded figure/);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 3 of 6");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 2 of 6");
  await page.getByRole("button", { name: "Picture 5 of 6" }).click();
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 5 of 6");

  await page.keyboard.press("Escape");
  await expect(comic).toHaveCount(0);
  await expect(page.getByTestId("comic-open")).toBeVisible();
  await expect(page.getByTestId("buy-panel")).toHaveCount(0); // closing is not buying

  // opened again, it starts from the beginning
  await page.getByTestId("comic-open").click();
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 1 of 6");
});

test("the last picture ends on the call to action, which closes the strip and opens the purchase", async ({ page }) => {
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  await page.getByRole("button", { name: "Picture 6 of 6" }).click();
  await expect(page.getByTestId("comic-next")).toBeDisabled();
  await expect(page.getByTestId("comic-panel-title")).toHaveText("And what you draw on it is saved too");
  await expect(page.getByTestId("comic")).toContainText("A fiction made for Pixel World");
  await page.getByTestId("comic-save").click();
  await expect(page.getByTestId("comic")).toHaveCount(0);
  await expect(page.getByTestId("buy-panel")).toBeVisible();
});

test("automatic reading is off until asked for, then moves on by itself", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  await page.clock.runFor(20_000);
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 1 of 6"); // nothing moves on its own
  await page.getByTestId("comic-play").click();
  await expect(page.getByTestId("comic-play")).toHaveAttribute("aria-pressed", "true");
  await page.clock.runFor(7_100);
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 2 of 6");
  await page.clock.runFor(7_100 * 5);
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 6 of 6");
  await expect(page.getByTestId("comic-play")).toHaveAttribute("aria-pressed", "false"); // it stops on the last one
});

test("it speaks French, and it is accessible (axe) on a picture and on the last one", async ({ page }) => {
  await page.goto("/fr?preview=J-9");
  await page.getByTestId("comic-open").click();
  await expect(page.getByTestId("comic-position")).toHaveText("Image 1 sur 6");
  await expect(page.getByTestId("comic-panel-title")).toHaveText("Un monde plein de choses");
  const scan = () => new AxeBuilder({ page }).include('[data-testid="comic"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect((await scan()).violations, "first picture").toEqual([]);
  await page.getByRole("button", { name: "Image 6 sur 6" }).click();
  await expect(page.getByTestId("comic-save")).toHaveText("Sauver ma parcelle");
  expect((await scan()).violations, "last picture").toEqual([]);
});

test("it fits a phone: no sideways scrolling, the picture and the buttons are all visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  const box = await page.getByTestId("comic-image").boundingBox();
  expect(box!.width).toBeGreaterThan(330);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(await page.getByTestId("comic").evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
  for (const id of ["comic-prev", "comic-next", "comic-play", "comic-close"]) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.x + b!.width, id).toBeLessThanOrEqual(390);
    expect(b!.x, id).toBeGreaterThanOrEqual(0);
  }
});
