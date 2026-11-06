import { expect, test } from "@playwright/test";

/** The brand: the site icons are the logo's globe, and "pixel" in the logo is set in the site's pixel font. */
test("the site icons are the logo's globe: linked from every page, and served", async ({ page, request }) => {
  for (const path of ["/", "/fr"]) {
    await page.goto(path);
    const icons = await page.locator('head link[rel~="icon"], head link[rel="apple-touch-icon"]').evaluateAll((els) => els.map((e) => ({ rel: (e as HTMLLinkElement).rel, href: (e as HTMLLinkElement).href })));
    expect(icons.some((i) => i.rel.includes("icon") && /favicon\.ico/.test(i.href)), `${path}: favicon.ico linked`).toBe(true);
    expect(icons.some((i) => /icon\.svg/.test(i.href)), `${path}: icon.svg linked`).toBe(true);
    expect(icons.some((i) => i.rel === "apple-touch-icon"), `${path}: apple touch icon linked`).toBe(true);
    for (const i of icons) {
      const r = await request.get(i.href);
      expect(r.status(), i.href).toBe(200);
      expect(r.headers()["content-type"], i.href).toMatch(/^image\//);
    }
  }
  // favicon.ico holds three sizes (16, 32, 48), each a PNG
  const ico = await (await request.get("/favicon.ico")).body();
  expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 3]);
  expect([0, 1, 2].map((i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
  // the SVG icon is the 12 × 12 globe in the archive's cyan and gold
  const svg = await (await request.get("/icon.svg")).text();
  expect(svg).toContain('viewBox="0 0 12 12"');
  expect(svg).toContain("#55c7d1");
  expect(svg).toContain("#d6ab72");
  // the iOS icon is opaque (iOS paints transparency black) and 180 px
  const apple = await request.get((await page.locator('head link[rel="apple-touch-icon"]').first().getAttribute("href"))!);
  const png = await apple.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]);
});

test('"pixel" in the logo is written in the pixel font, "world" in the display font', async ({ page }) => {
  await page.goto("/");
  const logo = page.locator("header a[aria-label]").first();
  const font = (word: string) => logo.getByText(word, { exact: true }).evaluate((e) => getComputedStyle(e).fontFamily);
  expect(await font("pixel")).toContain("Jersey 10");
  expect(await font("world")).toContain("Bricolage");
  // one weight only (no faux bold on a pixel font)
  expect(await logo.getByText("pixel", { exact: true }).evaluate((e) => getComputedStyle(e).fontWeight)).toBe("400");
  await expect(logo).toHaveAccessibleName(/.+/);
});
