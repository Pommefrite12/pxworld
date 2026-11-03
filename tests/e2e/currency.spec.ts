import { expect, request as pwRequest, test } from "@playwright/test";

/**
 * Euros in the euro area, dollars elsewhere. The country comes from the host's header (here set by hand: `x-vercel-ip-country`);
 * the server decides the currency, and the browser only confirms what it showed. Nothing is bought here (the counters of the
 * journey spec, which runs after this one, stay exact).
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const as = (country?: string): Record<string, string> => (country ? { "x-vercel-ip-country": country } : {});

test("the price a buyer sees is in euros in the euro area, in dollars elsewhere, in euros when nobody knows where they are", async ({ browser }) => {
  const priceLine = async (country: string | undefined, path: string) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: as(country), baseURL: BASE });
    const page = await ctx.newPage();
    await page.goto(path);
    await page.getByTestId("find-your-spot").click();
    const text = await page.getByTestId("buy-panel").innerText();
    await ctx.close();
    return text;
  };
  expect(await priceLine("US", "/")).toContain("$0.50");
  expect(await priceLine("FR", "/")).toContain("€0.50");
  expect(await priceLine("DE", "/")).toContain("€0.50");
  expect(await priceLine("GB", "/")).toContain("$0.50"); // outside the euro area, next door or not
  expect(await priceLine(undefined, "/")).toContain("€0.50");
  const fr = await priceLine("US", "/fr");
  expect(fr).toMatch(/0,50\s*(\$US|\$)/); // written the French way
  expect(fr).not.toContain("€");
});

test("the availability probe quotes in the same currency", async ({ browser }) => {
  for (const [country, currency] of [["US", "usd"], ["FR", "eur"], ["JP", "usd"], [undefined, "eur"]] as const) {
    const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: as(country) });
    const r = await ctx.get("/api/availability?x=19000&y=11700&w=10&h=10");
    expect(r.ok(), String(country)).toBeTruthy();
    const j = await r.json();
    expect(j.price.currency, String(country)).toBe(currency);
    expect(j.price.unitPriceCents).toBe(50);
    expect(j.price.totalCents).toBe(j.price.landPixels * 50 + 0);
    await ctx.dispose();
  }
  void browser;
});

test("a buyer whose connection changed country between the price and the payment is told, and nothing is charged", async () => {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { ...as("US"), origin: BASE } });
  expect((await ctx.post("/api/dev/login", { data: { email: "currency@example.test" } })).ok()).toBeTruthy();
  const send = (currency?: string) => ctx.post("/api/checkout", { multipart: { x: "36000", y: "2000", w: "5", h: "5", locale: "en", ...(currency ? { currency } : {}) } });
  const stale = await send("eur"); // the page showed euros, the connection now says the United States
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toBe("px_currency_changed");
  // the dollar price is what a US buyer would be asked for: it goes on to the next check (here, an image is missing — not a currency problem)
  const ok = await send("usd");
  expect((await ok.json()).error).not.toBe("px_currency_changed");
  await ctx.dispose();
});
