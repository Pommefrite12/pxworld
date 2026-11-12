import { expect, test } from "@playwright/test";
import pg from "pg";

/**
 * The home page (`/`): the planisphere, the sentence, three gestures, the state of the edition, and the way to the map (`/map`).
 * Read-only: it buys nothing (journey.spec.ts, which runs after it, starts by checking that nothing has been sold yet).
 * What it shows about the traces is compared with the database, whatever the other specs left there: it never makes anything up.
 */
async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

test.describe("the home page", () => {
  test("the slogan, the hook, the two ways in, and nothing else under the buttons", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-title")).toContainText("Every era leaves a trace. Here is ours.");
    await expect(page.getByTestId("home-hook")).toHaveText("In 100 years, what will remain of us?"); // the hook, under the slogan
    await expect(page.getByTestId("home-leave-trace")).toHaveText("Leave my trace");
    await expect(page.getByTestId("home-leave-trace")).toHaveAttribute("href", "/map?buy=1");
    await expect(page.getByTestId("home-explore")).toHaveText("Explore the archives");
    await expect(page.getByTestId("home-explore")).toHaveAttribute("href", "/map");
    // nothing else under the buttons: no fine print about the price (it is on the map, in the buy panel and on the "Learn more" page), no legend over the map
    await expect(page.getByTestId("home-fine")).toHaveCount(0);
    const hero = (await page.getByTestId("home-hero").innerText()).toLowerCase();
    expect(hero).not.toContain("per pixel");
    expect(hero).not.toContain("one-time payment");
    expect(hero, "no long dash in the hero: commas").not.toContain("—");
    expect(await page.locator("main").innerText()).not.toContain("Every cyan frame");
    // no leftovers of the old story on the home page
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const gone of ["protocol", "protocole", "doom", "apocalypse", "countdown"]) expect(text, gone).not.toContain(gone);
  });

  test("the header offers the same way in, and the map is one click away", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("header-leave-trace")).toHaveAttribute("href", "/map?buy=1");
    await page.getByTestId("home-explore").click();
    await expect(page).toHaveURL(/\/map$/);
    await expect(page.getByRole("application")).toBeVisible(); // the interactive map
    await page.goto("/");
    await page.getByTestId("home-leave-trace").click();
    await expect(page).toHaveURL(/\/map\?buy=1$/);
    await expect(page.getByTestId("buy-panel")).toBeVisible(); // the buy mode opens straight away
  });

  test("the planisphere is the real world, drawn at night: blue ocean, violet land", async ({ page }) => {
    await page.goto("/");
    const canvas = page.getByTestId("hero-world");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("role", "img");
    const read = () => canvas.evaluate((el: HTMLCanvasElement) => {
      const d = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
      let violet = 0, blue = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 97) {
        const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
        n++;
        if (r >= 45 && r <= 70 && g >= 20 && g <= 45 && b >= 65 && b <= 100) violet++; // the land: #382050 and its two shades
        else if (b > r && b > g && b >= 50 && r <= 40) blue++; // the ocean: #0d1a3e and its shades
      }
      return { w: el.width, h: el.height, violet: violet / n, blue: blue / n };
    });
    // the ocean is painted at once; the land follows when the outlines have been fetched
    await expect.poll(async () => (await read()).violet, { timeout: 20_000 }).toBeGreaterThan(0.1);
    const c = await read();
    expect([c.w, c.h]).toEqual([1600, 1000]);
    expect(c.blue).toBeGreaterThan(0.3); // the oceans keep a blue tint: most of the planet
    expect(c.violet).toBeLessThan(0.6); // and the land is not all of it
  });

  test("the planisphere of the home page is shown whole, never cropped to a zone, on a wide screen and on a phone", async ({ page }) => {
    for (const vp of [{ width: 1920, height: 1080 }, { width: 1360, height: 860 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(vp);
      await page.goto("/");
      const canvas = page.getByTestId("hero-world");
      await expect(canvas).toBeVisible();
      // the whole bitmap is fitted inside its box (a crop would be "cover"), and the box is inside the screen
      expect(await canvas.evaluate((el) => getComputedStyle(el).objectFit), `${vp.width}px`).toBe("contain");
      const b = (await canvas.boundingBox())!;
      expect(b.x, `${vp.width}px`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${vp.width}px`).toBeLessThanOrEqual(vp.width + 0.5);
    }
  });

  test("the planisphere of the home page is alive: the coasts breathe, a band of light crosses the land; and it stands still for a visitor who asked for less motion", async ({ page }) => {
    const read = () => page.getByTestId("hero-world").evaluate((el: HTMLCanvasElement) => {
      const d = el.getContext("2d")!.getImageData(0, 0, el.width, el.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4 * 53) s += d[i]! + d[i + 1]! + d[i + 2]!;
      return s;
    });
    const sample = async () => { const out: number[] = []; for (let i = 0; i < 4; i++) { out.push(await read()); await page.waitForTimeout(700); } return out; };
    await page.goto("/");
    await expect(page.getByTestId("hero-world")).toBeVisible();
    await page.waitForTimeout(2500); // the land is drawn
    expect(new Set(await sample()).size, "the picture changes from one moment to the next").toBeGreaterThan(1);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("hero-world")).toBeVisible();
    await page.waitForTimeout(2500);
    expect(new Set(await sample()).size, "nothing moves for a visitor who asked for less motion").toBe(1);
  });

  test("the eras: five stations in the order they happened, each with its picture, and the last one is Pixel World", async ({ page }) => {
    await page.goto("/");
    const eras = page.getByTestId("era");
    await expect(eras).toHaveCount(5);
    expect(await eras.evaluateAll((els) => els.map((e) => e.getAttribute("data-era")))).toEqual(["cave", "hieroglyphs", "manuscript", "photography", "pixelworld"]);
    await expect(page.getByTestId("home-eras")).toContainText("Humanity has always left a trace.");
    const titles = ["Prehistoric paintings", "Hieroglyphs", "Manuscripts", "Photography", "Pixel World"];
    for (const [i, title] of titles.entries()) {
      const era = eras.nth(i);
      await era.scrollIntoViewIfNeeded();
      await expect(era.getByRole("heading", { level: 3 })).toHaveText(title);
      const img = era.locator("img");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: `the picture of ${title}`, timeout: 20_000 }).toBe(true);
      expect((await img.getAttribute("alt"))!.length, `the picture of ${title} is described`).toBeGreaterThan(30);
    }
    // the first four are a date and a title, nothing more; the last one has its sentence and the way in
    for (const i of [0, 1, 2, 3]) await expect(eras.nth(i).locator(".era-text p:not(.eyebrow)"), `era ${i + 1}: no sentence under the title`).toHaveCount(0);
    await expect(eras.nth(4).locator(".era-text p:not(.eyebrow)")).toHaveText("Our collective archive where everyone leaves a trace of our time on a map of the world, to be read in 100 years.");
    await expect(eras.nth(0)).toContainText("Tens of thousands of years ago");
    await expect(eras.nth(1)).toContainText("More than 5,000 years ago");
    await expect(eras.nth(4)).toContainText("Today");
    await expect(page.getByTestId("eras-leave-trace")).toHaveAttribute("href", "/map?buy=1"); // the story ends on the way in
  });

  test("on a computer the pictures and the words switch sides from one era to the next; on a phone they are stacked", async ({ page }) => {
    await page.goto("/");
    const x = async (i: number) => ({ pic: (await page.getByTestId("era").nth(i).locator("figure").boundingBox())!.x, text: (await page.getByTestId("era").nth(i).locator(".era-text").boundingBox())!.x });
    for (const i of [0, 1, 2, 3]) { await page.getByTestId("era").nth(i).scrollIntoViewIfNeeded(); }
    const first = await x(0), second = await x(1);
    expect(first.pic, "the first picture is on the left").toBeLessThan(first.text);
    expect(second.pic, "the next one is on the right").toBeGreaterThan(second.text);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const phone = await x(0);
    expect(Math.abs(phone.pic - phone.text), "stacked: the picture and the words start at the same edge").toBeLessThan(2);
  });

  test("the eras come in one after the other as the visitor scrolls down to them", async ({ page }) => {
    await page.goto("/");
    const eras = page.getByTestId("era");
    const words = (i: number) => eras.nth(i).locator(".era-text").evaluate((el) => Number(getComputedStyle(el).opacity));
    const pic = (i: number) => eras.nth(i).locator("figure").evaluate((el) => Number(getComputedStyle(el).opacity));
    // the stations below the screen wait, invisible, until the visitor gets to them…
    await expect(eras.nth(4)).toHaveAttribute("data-reveal", "wait");
    await expect(eras.nth(0)).toHaveAttribute("data-reveal", "wait");
    expect(await words(4)).toBe(0);
    expect(await pic(4)).toBe(0);
    // …then each one comes in (its picture and its words), and only that one
    await eras.nth(4).scrollIntoViewIfNeeded();
    await expect(eras.nth(4)).toHaveAttribute("data-reveal", "in");
    await expect.poll(() => words(4)).toBeGreaterThan(0.99);
    await expect.poll(() => pic(4)).toBeGreaterThan(0.99);
    await expect(eras.nth(0), "an era the visitor has not reached is still waiting").toHaveAttribute("data-reveal", "wait");
    await eras.nth(0).scrollIntoViewIfNeeded();
    await expect(eras.nth(0)).toHaveAttribute("data-reveal", "in");
    await expect.poll(() => words(0)).toBeGreaterThan(0.99);
    // an era that has come in stays: scrolling away and back does not hide it again
    await eras.nth(4).scrollIntoViewIfNeeded();
    await expect(eras.nth(0)).toHaveAttribute("data-reveal", "in");
  });

  test("nothing is ever hidden without the script, nor with 'reduce motion'", async ({ page, browser }) => {
    const shown = async (p: import("@playwright/test").Page) => p.getByTestId("era").evaluateAll((els) => els.map((e) => [e.getAttribute("data-reveal"), getComputedStyle(e.querySelector(".era-text")!).opacity, getComputedStyle(e.querySelector("figure")!).opacity]));
    // reduced motion: the script does not arm anything
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("home-title")).toBeVisible();
    await page.waitForTimeout(800); // hydration has run
    expect(await shown(page)).toEqual(Array(5).fill([null, "1", "1"]));
    // no script at all: the page is plain markup
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL: `http://localhost:${process.env.E2E_PORT ?? "3100"}` });
    const bare = await ctx.newPage();
    await bare.goto("/");
    expect(await shown(bare)).toEqual(Array(5).fill([null, "1", "1"]));
    await ctx.close();
  });

  test("in French: the eras, with their dates", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.getByTestId("home-eras")).toContainText("L'humanité a toujours laissé une empreinte.");
    const eras = page.getByTestId("era");
    await expect(eras.nth(0).getByRole("heading", { level: 3 })).toHaveText("Les peintures préhistoriques");
    await expect(eras.nth(1)).toContainText("Il y a plus de 5 000 ans");
    await expect(eras.nth(3).getByRole("heading", { level: 3 })).toHaveText("La photographie");
    await expect(eras.nth(4)).toContainText("Aujourd'hui");
    await expect(eras.nth(4).locator(".era-text p:not(.eyebrow)")).toHaveText("Notre archive collective où chacun laisse une empreinte de notre époque sur une carte du monde, à lire dans 100 ans.");
    await expect(page.getByTestId("eras-leave-trace")).toHaveText("Laisser mon empreinte");
  });

  test("the pictures of the eras are served as WebP, in two sizes, and stay light", async ({ request }) => {
    for (const name of ["cave", "hieroglyphs", "manuscript", "photography", "world"]) {
      for (const w of [720, 1200]) {
        const r = await request.get(`/eras/${name}-${w}.webp`);
        expect(r.status(), `${name} ${w}`).toBe(200);
        expect(r.headers()["content-type"]).toContain("image/webp");
        expect((await r.body()).length, `${name} ${w} is light`).toBeLessThan(250_000);
      }
    }
  });

  test("three gestures, each with a title and a text", async ({ page }) => {
    await page.goto("/");
    const steps = page.getByTestId("home-steps").locator("li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("Choose a parcel");
    await expect(steps.nth(1)).toContainText("Archive what matters");
    await expect(steps.nth(2)).toContainText("Hand it down");
  });

  test("the time section shows the real state of the edition: open, with the days that are left", async ({ page }) => {
    const e = (await sql<{ status: string; closes_at: Date | null }>(`select status, closes_at from public.editions`))[0]!;
    test.skip(e.status !== "open", "the edition is not open: edition.spec.ts covers the other states");
    await page.goto("/");
    const time = page.getByTestId("home-time");
    await expect(time).toHaveAttribute("data-state", "open");
    const left = Number(await page.getByTestId("home-days-left").innerText());
    const expected = Math.ceil((e.closes_at!.getTime() - Date.now()) / 86_400_000);
    expect(Math.abs(left - expected)).toBeLessThanOrEqual(1);
    await expect(time).toContainText("365 days to join the archive.");
    await expect(time).toContainText("Time left to take part");
    await expect(time).toContainText("Founding edition");
  });

  test("the traces of the home are the validated ones only, exactly: none is invented", async ({ page }) => {
    const rows = await sql<{ code: string }>(
      `select p.code from public.parcels p join public.parcel_assets a on a.id = p.published_asset_id join public.profiles u on u.id = p.owner_id
        where p.status = 'active' and p.hidden_at is null and u.status = 'active' and u.deleted_at is null order by a.published_at desc nulls last limit 6`);
    await page.goto("/");
    if (rows.length === 0) {
      await expect(page.getByTestId("home-recent")).toHaveCount(0); // nothing archived yet: no section, no placeholder
      return;
    }
    const codes = await page.getByTestId("home-trace").evaluateAll((els) => els.map((e) => e.getAttribute("data-code")));
    expect(codes).toEqual(rows.map((r) => r.code));
  });

  test("the old addresses still open the map: a place, a trace, the buy mode, a rectangle", async ({ page }) => {
    for (const path of ["/?x=26000&y=11000&z=0.6", "/?buy=1", "/?bx=100&by=100&bw=10&bh=10", "/?hud=1"]) {
      await page.goto(path);
      await expect(page.getByRole("application"), path).toBeVisible();
      await expect(page.getByTestId("home-title"), path).toHaveCount(0);
    }
  });

  test("the page about the project: why, how, the time, what is paid, and the way in", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every era leaves a trace. Here is ours.");
    const body = await page.locator("main").innerText();
    expect(body).toContain("€0.25 per pixel");
    expect(body).toContain("€6.25");
    expect(body).toContain("not real estate");
    await page.getByRole("link", { name: "Leave my trace" }).first().click();
    await expect(page).toHaveURL(/\/map\?buy=1$/);
  });

  test("in French: the slogan, the hook, the buttons", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.getByTestId("home-title")).toContainText("Chaque époque laisse une empreinte. Voici la nôtre.");
    await expect(page.getByTestId("home-hook")).toHaveText("Dans 100 ans, que restera-t-il de nous ?");
    await expect(page.getByTestId("home-leave-trace")).toHaveText("Laisser mon empreinte");
    await expect(page.getByTestId("home-leave-trace")).toHaveAttribute("href", "/fr/map?buy=1");
    await expect(page.getByTestId("home-explore")).toHaveText("Explorer les archives");
    await expect(page.getByTestId("home-fine")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toContain("Chaque cadre cyan");
    await expect(page.getByTestId("home-time")).toContainText("365 jours pour entrer dans l'archive.");
  });

  test("the page is indexable, has a title and a description, and is in the sitemap with the map", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Pixel World/);
    const html = await (await request.get("/")).text();
    expect(html).not.toMatch(/<meta name="robots" content="noindex/);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toMatch(/<loc>[^<]*\/map<\/loc>/);
    expect(sitemap).toMatch(/<loc>[^<]*\/about<\/loc>/);
  });
});
