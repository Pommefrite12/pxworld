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
  test("the sentence, the two ways in, and the real price in the fine print", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-title")).toContainText("In 100 years, what will remain of us?");
    await expect(page.getByTestId("home-leave-trace")).toHaveText("Leave my trace");
    await expect(page.getByTestId("home-leave-trace")).toHaveAttribute("href", "/map?buy=1");
    await expect(page.getByTestId("home-explore")).toHaveText("Explore the archives");
    await expect(page.getByTestId("home-explore")).toHaveAttribute("href", "/map");
    // the price printed is the server's: €0.25 a pixel, from €6.25 for the smallest parcel (25 pixels)
    await expect(page.getByTestId("home-fine")).toContainText("€0.25 per pixel");
    await expect(page.getByTestId("home-fine")).toContainText("from €6.25 (25 pixels)");
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
    await expect(time).toContainText("An era. 100 days to tell it.");
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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("In 100 years, what will remain of us?");
    const body = await page.locator("main").innerText();
    expect(body).toContain("€0.25 per pixel");
    expect(body).toContain("€6.25");
    expect(body).toContain("not real estate");
    await page.getByRole("link", { name: "Leave my trace" }).first().click();
    await expect(page).toHaveURL(/\/map\?buy=1$/);
  });

  test("in French: the sentence, the buttons, the price with its comma", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.getByTestId("home-title")).toContainText("Dans 100 ans, que restera-t-il de nous ?");
    await expect(page.getByTestId("home-leave-trace")).toHaveText("Laisser ma trace");
    await expect(page.getByTestId("home-leave-trace")).toHaveAttribute("href", "/fr/map?buy=1");
    await expect(page.getByTestId("home-explore")).toHaveText("Explorer les archives");
    await expect(page.getByTestId("home-fine")).toContainText(/0,25\s€ le pixel/);
    await expect(page.getByTestId("home-time")).toContainText("Une époque. 100 jours pour la raconter.");
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
