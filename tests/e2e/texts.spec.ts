import { expect, test } from "@playwright/test";

/**
 * The words of the site are the archive's: a trace, an edition, an author (never "claim a piece of the planet", "owners", "one planet, one billion
 * pixels"). The legal texts are provisional and say so; they now say what the archive promises and what it does not. Nothing is bought here.
 */
const OLD_EN = ["One planet", "Your mark", "Claim your pixels", "Claim a piece", "piece of the planet", "Find your spot", "collaborative world map"];
const OLD_FR = ["Une planète", "Votre empreinte", "Réservez vos pixels", "morceau de la planète", "Trouvez votre place", "planisphère collaboratif"];

test.describe("vocabulary", () => {
  test("no page of the public side still sells a piece of the planet", async ({ page }) => {
    for (const [path, old] of [["/", OLD_EN], ["/map", OLD_EN], ["/discover", OLD_EN], ["/terms", OLD_EN], ["/about", OLD_EN], ["/fr", OLD_FR], ["/fr/map", OLD_FR], ["/fr/discover", OLD_FR], ["/fr/terms", OLD_FR]] as const) {
      await page.goto(path);
      const text = await page.locator("body").innerText();
      for (const w of old) expect(text, `${path}: ${w}`).not.toContain(w);
      const meta = (await page.locator('meta[name="description"]').getAttribute("content")) ?? "";
      for (const w of old) expect(meta, `${path} meta: ${w}`).not.toContain(w);
    }
  });

  test("the map: the call to action, the counters and the tile speak of traces, in both languages", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByTestId("find-your-spot")).toHaveText("Leave my trace");
    await expect(page.getByText("Pixels archived")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Share of the map archived" })).toBeVisible();
    await expect(page.getByTestId("latest-tile").getByRole("heading")).toHaveText("Recently archived");
    await expect(page.locator("h1")).toHaveText("Every era leaves a trace. Here is ours. Leave yours.");
    await page.goto("/fr/map");
    await expect(page.getByTestId("find-your-spot")).toHaveText("Laisser mon empreinte");
    await expect(page.getByText("Pixels archivés")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Part de la carte archivée" })).toBeVisible();
    await expect(page.getByTestId("latest-tile").getByRole("heading")).toHaveText("Récemment archivées");
  });

  test("the tagline and the description of the site, in the title and the previews", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain("Every era leaves a trace. Here is ours.");
    expect(html).toMatch(/<meta name="description" content="Pixel World is a worldwide collective archive of our time/);
    const fr = await (await request.get("/fr")).text();
    expect(fr).toContain("Chaque époque laisse une empreinte. Voici la nôtre.");
    expect(fr).toMatch(/<meta name="description" content="Pixel World est une archive collective mondiale de notre époque/);
  });
});

test.describe("the legal texts (provisional)", () => {
  test("the terms: what is paid for, the editions and their closing, how long a trace lasts, and the gaps for a lawyer", async ({ page }) => {
    await page.goto("/terms");
    const text = await page.locator("main").innerText();
    for (const part of ["What you pay for", "digital right to use", "contribution to this collaborative work", "Editions and the closing", "frozen", "How long a trace lasts", "we do not promise that it will be kept for ever", "€0.25 per pixel", "not real estate"]) expect(text, part).toContain(part);
    expect(text, "still a draft: the gaps for a lawyer are marked").toContain("To be reviewed by a lawyer");
    expect(text, "and the page says it is provisional").toMatch(/provisional text/i);
    expect(text, "nothing says a parcel is owned").not.toMatch(/\bowns\b|exclusive right/i);
    await page.goto("/fr/terms");
    const fr = await page.locator("main").innerText();
    for (const part of ["Ce que vous payez", "droit d'usage numérique", "Éditions et clôture", "Durée de conservation d'une empreinte", "À faire relire par un juriste", "0,25"]) expect(fr, part).toContain(part);
  });

  test("the privacy page speaks of the public archive and of erasure", async ({ page }) => {
    await page.goto("/privacy");
    const text = await page.locator("main").innerText();
    expect(text).toContain("they are public, with your username and the date of archiving");
    expect(text).toContain("Erasure and a public archive");
  });

  test("the footer says what is sold, without promising the impossible", async ({ page }) => {
    await page.goto("/");
    const footer = await page.locator("footer").innerText();
    expect(footer).toContain("digital right to use a virtual placement");
    expect(footer).toContain("nor a promise that the archive will be kept for ever");
  });
});
