import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The comic strip of the story (eight pictures, opened from a button). It belongs to the story, so it only exists where the story does:
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
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 1 of 8");
  await expect(page.getByTestId("comic-text")).toHaveText("Humans… I have been watching you for a very long time.");
  await expect(image).toHaveAttribute("src", "/story/panel-1.webp");
  await expect(page.getByTestId("comic-prev")).toBeDisabled();
  await expect(page.getByTestId("comic-cta")).toHaveCount(0); // the call to action comes with the last picture

  // the picture is really loaded (not a broken link)
  await expect.poll(() => image.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(1280);

  await page.getByTestId("comic-next").click();
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 2 of 8");
  await expect(image).toHaveAttribute("src", "/story/panel-2.webp");
  await expect(image).toHaveAttribute("alt", /hooded figure/);
  await expect(page.getByTestId("comic-text")).toHaveText("I have analysed your world. My conclusion is final: it must disappear.");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 3 of 8");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 2 of 8");
  await page.getByRole("button", { name: "Picture 5 of 8" }).click();
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 5 of 8");

  await page.keyboard.press("Escape");
  await expect(comic).toHaveCount(0);
  await expect(page.getByTestId("comic-open")).toBeVisible();
  await expect(page.getByTestId("buy-panel")).toHaveCount(0); // closing is not buying

  // opened again, it starts from the beginning
  await page.getByTestId("comic-open").click();
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 1 of 8");
});

test("the last picture ends on the call to action, which closes the strip and opens the purchase", async ({ page }) => {
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  await page.getByRole("button", { name: "Picture 8 of 8" }).click();
  await expect(page.getByTestId("comic-next")).toBeDisabled();
  await expect(page.getByTestId("comic-text")).toContainText("Show me what your world deserves to keep.");
  await expect(page.getByTestId("comic")).toContainText("A fiction made for Pixel World");
  await page.getByTestId("comic-save").click();
  await expect(page.getByTestId("comic")).toHaveCount(0);
  await expect(page.getByTestId("buy-panel")).toBeVisible();
});

test("there is no automatic reading: nothing moves on its own", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  await expect(page.getByTestId("comic-play")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /automati/i })).toHaveCount(0);
  await page.clock.runFor(60_000);
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 1 of 8");
});

test("a picture comes in with a wipe: from the right when going on, from the left when going back, and the old one goes under it", async ({ page }) => {
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  const image = page.getByTestId("comic-image");
  await expect(image).not.toHaveAttribute("data-wipe", /.+/); // the first picture simply is there
  // what the picture is doing, read in one go (the old one is only kept for a moment under the new one)
  const doing = () => image.evaluate((i) => ({ wipe: (i as HTMLElement).dataset.wipe ?? null, animation: getComputedStyle(i).animationName, old: document.querySelectorAll('[data-testid="comic-image-old"]').length }));

  await page.getByTestId("comic-next").click();
  const next = await doing();
  expect(next.wipe, "going on").toBe("next");
  expect(next.animation, "a wipe from the right").toBe("comic-wipe-next");
  expect(next.old, "the picture that goes is still under the new one").toBe(1);
  await expect(page.getByTestId("comic-image-old")).toHaveAttribute("src", "/story/panel-1.webp");
  await expect.poll(() => page.getByTestId("comic-image-old").count(), { timeout: 3000 }).toBe(0); // then it is gone

  await page.getByTestId("comic-prev").click();
  const back = await doing();
  expect(back.wipe, "going back").toBe("prev");
  expect(back.animation, "a wipe from the left").toBe("comic-wipe-prev");
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 1 of 8");

  // jumping with a dot goes the way the picture is: forwards from the right, backwards from the left
  await page.getByRole("button", { name: "Picture 6 of 8" }).click();
  await expect(image).toHaveAttribute("data-wipe", "next");
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Picture 3 of 8" }).click();
  await expect(image).toHaveAttribute("data-wipe", "prev");
});

test("a visitor who asked for less motion gets the picture at once, with no wipe", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?preview=J-9");
  await page.getByTestId("comic-open").click();
  await page.getByTestId("comic-next").click();
  await expect(page.getByTestId("comic-position")).toHaveText("Picture 2 of 8");
  expect(await page.getByTestId("comic-image").evaluate((i) => getComputedStyle(i).animationName)).toBe("none");
});

test("the window is only as big as what it shows: no empty space, on a computer, a tablet and a phone", async ({ page }) => {
  for (const [w, h] of [[1360, 860], [760, 1100], [390, 800]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/?preview=J-9");
    await page.getByTestId("comic-open").click();
    for (const goTo of [null, "Picture 8 of 8"]) {
      if (goTo) await page.getByRole("button", { name: goTo }).click();
      await page.waitForTimeout(600);
      const m = await page.getByTestId("comic").evaluate((d) => {
        const r = d.getBoundingClientRect(), lastBottom = (d.lastElementChild as HTMLElement).getBoundingClientRect().bottom;
        return { height: r.height, empty: r.bottom - lastBottom, vh: window.innerHeight, scrolls: d.scrollHeight > d.clientHeight + 1 };
      });
      expect(m.empty, `${w}×${h} ${goTo ?? "first"}: space under the last line`).toBeLessThanOrEqual(20);
      expect(m.height, `${w}×${h}: it never needs more than the screen`).toBeLessThan(m.vh);
      if (h >= 1000) expect(m.height, `${w}×${h}: and does not fill a tall screen for nothing`).toBeLessThan(m.vh * 0.8);
      expect(m.scrolls, `${w}×${h}: nothing to scroll`).toBe(false);
    }
    await page.keyboard.press("Escape");
  }
});

test("it speaks French, and it is accessible (axe) on a picture and on the last one", async ({ page }) => {
  await page.goto("/fr?preview=J-9");
  await page.getByTestId("comic-open").click();
  await expect(page.getByTestId("comic-position")).toHaveText("Image 1 sur 8");
  await expect(page.getByTestId("comic-text")).toHaveText("Humains… Je vous observe depuis bien longtemps.");
  const scan = () => new AxeBuilder({ page }).include('[data-testid="comic"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect((await scan()).violations, "first picture").toEqual([]);
  await page.getByRole("button", { name: "Image 8 sur 8" }).click();
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
  for (const id of ["comic-prev", "comic-next", "comic-close"]) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.x + b!.width, id).toBeLessThanOrEqual(390);
    expect(b!.x, id).toBeGreaterThanOrEqual(0);
  }
});
