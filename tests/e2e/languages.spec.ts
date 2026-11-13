import { expect, test } from "@playwright/test";

/** Spanish and Simplified Chinese beside English and French: the switcher, the pages, the map, the legal pages (English, with a mention). */
test("the language menu offers four languages, and choosing one moves to its address", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("locale-switch").click();
  for (const l of ["en", "fr", "es", "zh"]) await expect(page.getByTestId(`locale-option-${l}`)).toBeVisible();
  await expect(page.getByTestId("locale-option-es")).toContainText("Español"); // its name, then its code
  await expect(page.getByTestId("locale-option-zh")).toContainText("简体中文");
  await page.getByTestId("locale-option-es").click();
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
});

test("the home page in Spanish and in Chinese", async ({ page }) => {
  await page.goto("/es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByTestId("home-title")).toContainText("Cada época deja su huella.");
  await expect(page.getByTestId("home-leave-trace")).toHaveText("Dejar mi huella");
  await expect(page.getByTestId("home-explore")).toHaveText("Explorar los archivos");
  expect(await page.title()).toContain("Pixel World");

  await page.goto("/zh");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh");
  await expect(page.getByTestId("home-title")).toContainText("每个时代都会留下印记。");
  await expect(page.getByTestId("home-leave-trace")).toHaveText("留下我的印记");
  // nothing breaks the page: no horizontal scrolling, and the title is not cut
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the legal pages are in English for Spanish and Chinese, with a mention in their own language; French and English have no mention", async ({ page }) => {
  for (const [path, notice] of [["/es/terms", "Los textos legales se muestran en inglés"], ["/zh/privacy", "法律文本以英文显示"], ["/es/rules", "Los textos legales"], ["/zh/credits", "法律文本"]] as const) {
    await page.goto(path);
    await expect(page.getByTestId("legal-english-only"), path).toContainText(notice);
    await expect(page.locator("h1"), path).toHaveAttribute("lang", "en"); // the text itself is English
  }
  await page.goto("/es/terms");
  await expect(page.locator("h1")).toHaveText(/Terms/i);
  await page.context().clearCookies(); // the language of the last visit is remembered: start again from English
  for (const path of ["/terms", "/fr/terms", "/es/contact", "/zh/contact"]) {
    await page.goto(path);
    await expect(page.getByTestId("legal-english-only"), path).toHaveCount(0);
  }
  await page.goto("/es/contact");
  await expect(page.locator("h1")).toHaveText("Contacto"); // the contact page is translated
});

test("the map and the buy panel speak Spanish and Chinese; the search knows the countries by their name in the language of the page", async ({ page }) => {
  await page.goto("/es/map");
  await expect(page.getByTestId("find-your-spot")).toHaveText("Dejar mi huella");
  await page.getByRole("combobox").fill("Alemania");
  await expect(page.getByRole("option").first()).toContainText("Alemania");
  await page.getByTestId("find-your-spot").click();
  await expect(page.getByTestId("buy-panel")).toContainText("Deja tu huella");

  await page.goto("/zh/map");
  await expect(page.getByTestId("find-your-spot")).toHaveText("留下我的印记");
  await page.getByRole("combobox").fill("德国");
  await expect(page.getByRole("option").first()).toContainText("德国");
  await page.getByTestId("find-your-spot").click();
  await expect(page.getByTestId("buy-panel")).toContainText("留下你的印记");
  await expect(page.getByTestId("buy-panel")).toContainText("自定义尺寸");
});

test("the share image and the sitemap know the new languages", async ({ request }) => {
  for (const lang of ["es", "zh", "fr"]) expect((await request.get(`/api/og/home?lang=${lang}`)).status(), lang).toBe(200);
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const l of ["fr", "es", "zh"]) expect(xml, l).toContain(`hreflang="${l}"`);
});
