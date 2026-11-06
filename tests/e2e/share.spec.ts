import { expect, test } from "@playwright/test";
import sharp from "sharp";

/**
 * Sharing the site: the share image of the home page (and of every page without one of its own) is 1200 × 630, in the visitor's language,
 * the same for everybody, and announced by the pages in their metadata.
 */

test("the share image of the home page: 1200 × 630, one in each language, nothing in the address can change what it says", async ({ request }) => {
  const get = async (q: string) => {
    const r = await request.get(`/api/og/home${q}`);
    expect(r.status(), q).toBe(200);
    expect(r.headers()["content-type"], q).toContain("image/png");
    const body = await r.body();
    const meta = await sharp(body).metadata();
    expect([meta.width, meta.height], q).toEqual([1200, 630]);
    return { body, cache: r.headers()["cache-control"] ?? "" };
  };
  const en = await get("?lang=en"), fr = await get("?lang=fr"), none = await get("");
  expect(en.body.equals(fr.body), "each language has its own picture").toBe(false);
  expect(none.body.equals(en.body), "anything but French is English").toBe(true);
  expect(en.cache, "the image does not change from one day to the next").toContain("s-maxage=86400");
  // the old addresses of the countdown story say nothing any more: the same picture
  for (const extra of ["&preview=J-9", "&preview=0", "&s=e", "&s=c&d=3"]) expect((await get(`?lang=en${extra}`)).body.equals(en.body), extra).toBe(true);
  // it is set in the night palette of the site: a dark violet field with gold and cyan in it
  const raw = await sharp(en.body).raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => Array.from(raw.data.subarray((y * raw.info.width + x) * raw.info.channels, (y * raw.info.width + x) * raw.info.channels + 3));
  expect(px(8, 8), "the night violet").toEqual([25, 9, 33]);
  let gold = 0, cyan = 0;
  for (let i = 0; i < raw.data.length; i += raw.info.channels * 13) {
    const [r, g, b] = [raw.data[i]!, raw.data[i + 1]!, raw.data[i + 2]!];
    if (Math.abs(r - 214) < 16 && Math.abs(g - 171) < 16 && Math.abs(b - 114) < 16) gold++;
    if (Math.abs(r - 85) < 16 && Math.abs(g - 199) < 16 && Math.abs(b - 209) < 16) cyan++;
  }
  expect(gold, "gold (the highlighted words, the name)").toBeGreaterThan(200);
  expect(cyan, "cyan (the lit pixels, the call)").toBeGreaterThan(50);
});

test("the pages of the site announce that share image, in their language", async ({ playwright }) => {
  // one fresh context per address: the site remembers the language of a visit in a cookie, and a shared context would carry French over to the next page
  for (const [path, lang] of [["/", "en"], ["/fr", "fr"], ["/map", "en"], ["/fr/discover", "fr"]] as const) {
    const ctx = await playwright.request.newContext({ baseURL: `http://localhost:${process.env.E2E_PORT ?? "3100"}` });
    const html = await (await ctx.get(path)).text();
    await ctx.dispose();
    expect(html, path).toContain(`/api/og/home?lang=${lang}`);
  }
});
