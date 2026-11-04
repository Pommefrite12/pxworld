import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * "100 days to save the world" (art direction Glitch): the countdown and the interface that goes with it. It is OFF unless a date
 * is configured (NEXT_PUBLIC_WORLD_END_AT) — the e2e server sets none — and `?preview=J-9` shows any chapter without touching it.
 */
const doomParts = ['[data-testid="doom-ticker"]', '[data-testid="doom-plate"]', '[data-testid="doom-message"]', '[data-testid="doom-stats"]'];

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1360, height: 860 }); });

test("it is off by default: the site is exactly what it was", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("find-your-spot")).toHaveText("Find your spot");
  await expect(page.getByTestId("sold-pixels")).toBeVisible(); // the ordinary counter card
  await page.waitForTimeout(1500); // the countdown mounts after hydration: give it the chance to (wrongly) appear
  for (const sel of doomParts) await expect(page.locator(sel), sel).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector("header")!.classList.contains("doom-header"))).toBe(false);
});

test("a preview shows the countdown, the story and the interface that goes with it", async ({ page }) => {
  await page.goto("/?preview=J-9");
  const plate = page.getByTestId("doom-plate");
  await expect(plate).toBeVisible();
  await expect(plate).toContainText("UNSTABLE SYSTEM");
  await expect(plate).toContainText("PREVIEW"); // a simulation says so
  const digits = await plate.locator(".doom-n").allInnerTexts();
  expect(digits.slice(0, 3)).toEqual(["09", "06", expect.stringMatching(/^(40|41)$/)]); // 9 days, 6 h, 41 min (a second or two may have passed)
  await expect(plate.locator("i")).toHaveText(["DAYS", "HOURS", "MINUTES", "SECONDS"]);
  await expect(page.getByTestId("doom-ticker")).toBeVisible();
  await expect(page.getByTestId("doom-message")).toHaveText("How much of the world will be left standing?"); // chapter 3 (J30 → J8)
  await expect(page.getByTestId("find-your-spot")).toHaveText("Save my plot");
  // the counter card tells the same real figures in the story's words
  const stats = page.getByTestId("doom-stats");
  await expect(stats).toContainText("World saved");
  await expect(page.getByTestId("doom-saved-percent")).toHaveText(/%$/);
  await expect(stats).toContainText("still in danger");
  // the bar is an ordinary one: a track and a fill, with its two ends named (no segments, no stray colours)
  const bar = page.getByTestId("doom-bar");
  await expect(bar).toHaveAttribute("role", "progressbar");
  await expect(stats.locator(".doom-seg")).toHaveCount(0);
  await expect(stats).toContainText("0 %");
  await expect(stats).toContainText("100 %");
  const track = (await bar.boundingBox())!, fill = (await page.getByTestId("doom-bar-fill").boundingBox())!;
  const share = Number(await bar.getAttribute("aria-valuenow"));
  expect(fill.width, "the fill is the share of the land that is saved, on the whole width of the track").toBeLessThanOrEqual(Math.max(3, (track.width * share) / 100) + 1);
  expect(track.width).toBeGreaterThan(150);
  // no "D-9" / "J-9" next to the logo any more, and the countdown is kept small
  await expect(page.locator("header")).not.toContainText(/\b[DJ]-\d/);
  const plateBox = (await plate.boundingBox())!;
  expect(plateBox.width, "a small plate").toBeLessThanOrEqual(400);
  // the tile is the whole story card (stripe, title, countdown, two buttons) and stays small, so that the map is what one sees; the countdown itself is small
  expect(plateBox.height, "…in height too: title, countdown and buttons together").toBeLessThanOrEqual(215);
  expect((await plate.locator(".doom-digits").boundingBox())!.height, "the digits themselves are small").toBeLessThanOrEqual(80);
  await expect(page.getByTestId("doom-title")).toHaveText("Save the world. And the pizza with it.");
  // the title is ONE line (it saves a line of the map), and it fits the tile
  const oneLine = await page.getByTestId("doom-title").evaluate((el) => { const r = el.getBoundingClientRect(), lh = parseFloat(getComputedStyle(el).lineHeight) + 0; return { lines: Math.round((r.height - 7) / lh), overflow: el.scrollWidth > el.clientWidth }; });
  expect(oneLine, "one line, not wider than the tile").toEqual({ lines: 1, overflow: false });
  // …and big enough to read, with a second half that is not smeared by its effect
  const look = await page.getByTestId("doom-title").evaluate((el) => { const m = el.querySelector(".m")!, cs = getComputedStyle(m); return { font: parseFloat(getComputedStyle(el).fontSize), shadow: cs.textShadow, color: cs.color }; });
  expect(look.font, "the title is big enough to read").toBeGreaterThanOrEqual(19);
  const offsets = [...look.shadow.matchAll(/(-?\d+(?:\.\d+)?)px (-?\d+(?:\.\d+)?)px/g)].map((m) => Math.max(Math.abs(Number(m[1])), Math.abs(Number(m[2]))));
  expect(Math.max(0, ...offsets), "the effect on the second half is a 1 px edge, not a smear").toBeLessThanOrEqual(1);
  await expect(page.getByTestId("doom-save")).toHaveText("Save my plot");
  await expect(page.getByTestId("comic-open")).toBeVisible();
  await expect(plate.locator("p", { hasText: "When the countdown" })).toHaveCount(0); // no paragraph: the map stays visible
  await expect(page.getByTestId("latest-tile")).toContainText("Latest rescues");
  // and it counts down: the seconds move
  const sec = () => plate.locator(".doom-n").nth(3).innerText();
  const first = await sec();
  await expect.poll(sec, { timeout: 5000 }).not.toBe(first);
});

test("each chapter of the story says its own sentence, and the end says so", async ({ page }) => {
  const expected: Record<string, string> = {
    "J-90": "The countdown has begun.",
    "J-50": "Anomaly detected: the world is becoming unstable.",
    "J-20": "How much of the world will be left standing?",
    "J-3": "Last chance to save: leave your mark before it is too late.",
  };
  for (const [preview, text] of Object.entries(expected)) {
    await page.goto(`/?preview=${preview}`);
    await expect(page.getByTestId("doom-message"), preview).toHaveText(text);
  }
  await page.goto("/?preview=0");
  const plate = page.getByTestId("doom-plate");
  await expect(plate).toContainText("WORLD DELETED");
  await expect(plate.locator(".doom-n")).toHaveText(["00", "00", "00", "00"]);
  await expect(page.getByTestId("doom-message")).toHaveText(/^The world has been deleted\. (No plot survived\.|\d+ plots? survived\.)$/);
  await expect(page.getByTestId("find-your-spot")).toHaveText("Meet the survivors");
  await expect(page.getByTestId("doom-ticker")).toHaveAttribute("data-phase", "5");
});

test("the survivors are the real parcels: the message never invents a number", async ({ page, request }) => {
  const stats = await (await request.get("/api/stats")).json();
  await page.goto("/?preview=0");
  const text = await page.getByTestId("doom-message").innerText();
  const n = stats.parcels as number;
  expect(text).toBe(n === 0 ? "The world has been deleted. No plot survived." : `The world has been deleted. ${n} plot${n === 1 ? "" : "s"} survived.`);
});

test("French, and the preview follows the visitor from page to page until switched off", async ({ page }) => {
  await page.goto("/fr?preview=J-9");
  await expect(page.getByTestId("doom-plate")).toContainText("SYSTÈME INSTABLE");
  await expect(page.getByTestId("doom-plate").locator("i")).toHaveText(["JOURS", "HEURES", "MINUTES", "SECONDES"]);
  await expect(page.getByTestId("doom-message")).toHaveText("Quelle partie du monde restera debout ?");
  await expect(page.getByTestId("find-your-spot")).toHaveText("Sauver ma parcelle");
  // another page of the site (client navigation): the strip and the chip are still there, the plate belongs to the map
  await page.getByRole("link", { name: /Découvrir/ }).click();
  await expect(page).toHaveURL(/\/fr\/discover/);
  await expect(page.getByTestId("doom-ticker")).toBeVisible();
  await expect(page.getByTestId("doom-plate")).toHaveCount(0);
  // switched off: back to the ordinary site
  await page.goto("/fr?preview=off");
  await page.waitForTimeout(1200);
  for (const sel of doomParts) await expect(page.locator(sel), sel).toHaveCount(0);
});

test("someone who asked for fewer animations gets none: the strip stands still and the digits do not stutter", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?preview=J-9");
  await expect(page.getByTestId("doom-plate")).toBeVisible();
  expect(await page.locator(".doom-ticker-run").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
  expect(await page.locator(".doom-group.glitch .doom-n").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
});

test("the story keeps the interface accessible (axe, WCAG 2.1 A/AA) at the start, in the last week and at the end", async ({ page }) => {
  for (const preview of ["J-87", "J-3", "0"]) {
    await page.goto(`/?preview=${preview}`);
    await expect(page.getByTestId("doom-plate")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${preview} ${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  }
});

test("the countdown does not cover a parcel's card, and the buy panel keeps the whole map", async ({ page }) => {
  await page.goto("/?preview=J-9&buy=1");
  await expect(page.getByTestId("buy-status")).toBeVisible();
  await expect(page.getByTestId("doom-plate")).toHaveCount(0); // buying: nothing in the way
});

test("the plate, the sentence and the buttons of the end share one axis, in the middle of the screen", async ({ page }) => {
  for (const width of [1360, 700]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/fr?preview=0"); // the end: all three are there, and the sentence wraps on a narrower screen
    const parts = ["doom-plate", "doom-message", "doom-actions"].map((id) => page.locator(`[data-testid="${id}"]:visible`));
    for (const p of parts) await expect(p).toHaveCount(1);
    const centres: number[] = [];
    for (const p of parts) { const b = (await p.boundingBox())!; centres.push(b.x + b.width / 2); }
    for (const c of centres) expect(Math.abs(c - width / 2), `width ${width}: centres ${centres.join(", ")}`).toBeLessThanOrEqual(1);
  }
});

test("after zero nothing can be bought: the button leads to the survivors, and no link opens the shop", async ({ page }) => {
  await page.goto("/fr?preview=0");
  const cta = page.getByTestId("find-your-spot");
  await expect(cta).toHaveText("Voir les survivants");
  await expect(cta).toHaveAttribute("href", /\/discover$/);
  await cta.click();
  await expect(page).toHaveURL(/\/fr\/discover/);
  // the deep links that used to open the shop do not any more
  for (const url of ["/?preview=0&buy=1", "/?preview=0&bx=19000&by=11700&bw=10&bh=10"]) {
    await page.goto(url);
    await expect(page.getByTestId("doom-plate")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("buy-status"), url).toHaveCount(0);
  }
  // …while before the end the same button still opens it
  await page.goto("/?preview=J-9");
  await page.getByTestId("find-your-spot").click();
  await expect(page.getByTestId("buy-status")).toBeVisible();
});

test("the countdown reaching zero while somebody chooses a spot closes the shop under their feet", async ({ page }) => {
  await page.goto("/?preview=T-12");
  await expect(page.getByTestId("doom-plate")).toBeVisible();
  await page.getByTestId("find-your-spot").click();
  await expect(page.getByTestId("buy-status")).toBeVisible();
  await expect(page.getByTestId("buy-status")).toHaveCount(0, { timeout: 25_000 }); // zero: the panel closes by itself
  await expect(page.getByTestId("find-your-spot")).toHaveText("Meet the survivors", { timeout: 25_000 });
});
