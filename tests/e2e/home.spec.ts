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

  test("the eras: five stations in the order they happened, each with its picture, and the last one is Pixel World", async ({ page }) => {
    await page.goto("/");
    const eras = page.getByTestId("era");
    await expect(eras).toHaveCount(5);
    expect(await eras.evaluateAll((els) => els.map((e) => e.getAttribute("data-era")))).toEqual(["cave", "hieroglyphs", "manuscript", "photography", "pixelworld"]);
    await expect(page.getByTestId("home-eras")).toContainText("Humanity has always left a trace.");
    const titles = ["Cave walls", "Stone and hieroglyphs", "Illuminated manuscripts", "Photography", "Pixel World"];
    for (const [i, title] of titles.entries()) {
      const era = eras.nth(i);
      await era.scrollIntoViewIfNeeded();
      await expect(era.getByRole("heading", { level: 3 })).toHaveText(title);
      const img = era.locator("img");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { message: `the picture of ${title}`, timeout: 20_000 }).toBe(true);
      expect((await img.getAttribute("alt"))!.length, `the picture of ${title} is described`).toBeGreaterThan(30);
    }
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

  test("in French: the eras, with their dates", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.getByTestId("home-eras")).toContainText("L'humanité a toujours laissé une trace.");
    const eras = page.getByTestId("era");
    await expect(eras.nth(0).getByRole("heading", { level: 3 })).toHaveText("Les parois des cavernes");
    await expect(eras.nth(1)).toContainText("Il y a plus de 5 000 ans");
    await expect(eras.nth(3).getByRole("heading", { level: 3 })).toHaveText("La photographie");
    await expect(eras.nth(4)).toContainText("Aujourd'hui");
    await expect(page.getByTestId("eras-leave-trace")).toHaveText("Laisser ma trace");
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
    await expect(time).toContainText("100 days to join the archive.");
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
    await expect(page.getByTestId("home-title")).toContainText("Chaque époque laisse une trace. Voici la nôtre.");
    await expect(page.getByTestId("home-hook")).toHaveText("Dans 100 ans, que restera-t-il de nous ?");
    await expect(page.getByTestId("home-leave-trace")).toHaveText("Laisser ma trace");
    await expect(page.getByTestId("home-leave-trace")).toHaveAttribute("href", "/fr/map?buy=1");
    await expect(page.getByTestId("home-explore")).toHaveText("Explorer les archives");
    await expect(page.getByTestId("home-fine")).toHaveCount(0);
    expect(await page.locator("main").innerText()).not.toContain("Chaque cadre cyan");
    await expect(page.getByTestId("home-time")).toContainText("100 jours pour entrer dans l'archive.");
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
