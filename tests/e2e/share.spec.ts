import { expect, test } from "@playwright/test";
import sharp from "sharp";

/**
 * Sharing the story: the home page's share image follows it (ordinary, countdown, the end), in both languages and with the real
 * figures only; after the end, the visitor can share the end of the world (the share sheet of their device, else the link is copied).
 */

test("the share image of the home page: 1200 × 630, ordinary by default, and one of its own for the countdown and for the end", async ({ request }) => {
  const get = async (q: string) => {
    const r = await request.get(`/api/og/home?${q}`);
    expect(r.status(), q).toBe(200);
    expect(r.headers()["content-type"], q).toContain("image/png");
    const body = await r.body();
    const meta = await sharp(body).metadata();
    expect([meta.width, meta.height], q).toEqual([1200, 630]);
    return { body, cache: r.headers()["cache-control"] ?? "" };
  };
  const plain = await get("lang=en"), plainFr = await get("lang=fr");
  const count = await get("lang=en&preview=J-9"), countFr = await get("lang=fr&preview=J-9"), count87 = await get("lang=en&preview=J-87");
  const end = await get("lang=en&preview=0"), endFr = await get("lang=fr&preview=0");
  const all = [plain, plainFr, count, countFr, count87, end, endFr].map((x) => x.body.toString("base64"));
  expect(new Set(all).size, "every state, language and number of days has its own picture").toBe(all.length);
  // no end date is configured on the test server and no preview is asked: the story is off, so the image is the ordinary one
  expect((await get("lang=en&s=e")).body.equals(plain.body), "an address cannot switch the story on by itself").toBe(true);
  expect((await get("lang=en&s=c&d=3")).body.equals(plain.body)).toBe(true);
  expect(plain.cache).toContain("s-maxage=86400"); // the ordinary image keeps for a day
  expect(end.cache, "the end changes with every plot that is claimed: it does not keep long").toContain("max-age=300");
  // a made-up preview says nothing: back to the ordinary image
  expect((await get("lang=en&preview=banana")).body.equals(plain.body)).toBe(true);
});

test("the pages of the site announce the ordinary share image while the story is off", async ({ request }) => {
  for (const [path, lang] of [["/", "en"], ["/fr", "fr"]] as const) {
    const html = await (await request.get(path)).text();
    expect(html).toContain(`/api/og/home?lang=${lang}`);
    expect(html).not.toMatch(/\/api\/og\/home\?lang=\w+&(amp;)?s=/); // no state in the address: nothing of the story is announced
  }
});

test("after the end, the visitor can share it: the share sheet where the device has one", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __shared: unknown[] }).__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: unknown) => { (window as unknown as { __shared: unknown[] }).__shared.push(data); } });
  });
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto("/fr?preview=0");
  const share = page.locator('[data-testid="doom-share"]:visible');
  await expect(share).toHaveText("Partager");
  await share.click();
  const shared = await page.evaluate(() => (window as unknown as { __shared: { title: string; text: string; url: string }[] }).__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]!.url, "the home page in French, never the visitor's preview").toMatch(/\/fr$/);
  expect(shared[0]!.text).toMatch(/^Le monde a été supprimé\. (Aucune parcelle n’a survécu\.|\d+ parcelles? (a|ont) survécu\.)$/); // the real number of plots
  expect(shared[0]!.title).toBe("Pixel World");
});

test("…and where it has none, the link is copied", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { (window as unknown as { __copied: string[] }).__copied.push(t); } } });
  });
  await page.goto("/?preview=0");
  const share = page.locator('[data-testid="doom-share"]:visible');
  await expect(share).toHaveText("Share");
  await share.click();
  await expect(share).toHaveText("Link copied");
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toHaveLength(1);
  expect(copied[0]).toMatch(/^The world has been deleted\. .*survived\. https?:\/\/[^/]+\/$/);
  await expect(share).toHaveText("Share", { timeout: 6000 }); // and it goes back to its label
});

test("before the end, and while the sequence plays, there is nothing to share", async ({ page }) => {
  await page.goto("/?preview=J-9");
  await expect(page.getByTestId("doom-plate")).toBeVisible();
  await expect(page.getByTestId("doom-share")).toHaveCount(0);
  await expect(page.getByTestId("doom-actions")).toHaveCount(0);
});
