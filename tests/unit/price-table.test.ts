import { describe, expect, it } from "vitest";
import { DEFAULT_UNIT_PRICE_CENTS, MIN_AREA } from "@/lib/grid/constants";
import { DEFAULT_PRICING, formatMoney, quote } from "@/lib/grid/pricing";

/**
 * The price list of the shop (owner's brief): ONE price, €0.25 a pixel, everywhere — a parcel of 25 pixels is €6.25, of 400 pixels €100.
 * This is the single table every layer is checked against (the quote here, the order in the database, the buy panel in the browser).
 */
const PRICE_TABLE = [
  { w: 5, h: 5, area: 25, cents: 625, eur: "6,25 €", eurEn: "€6.25" },
  { w: 5, h: 10, area: 50, cents: 1_250, eur: "12,50 €", eurEn: "€12.50" },
  { w: 10, h: 10, area: 100, cents: 2_500, eur: "25 €", eurEn: "€25" },
  { w: 10, h: 20, area: 200, cents: 5_000, eur: "50 €", eurEn: "€50" },
  { w: 20, h: 20, area: 400, cents: 10_000, eur: "100 €", eurEn: "€100" },
] as const;

const plain = (s: string) => s.replace(/\s/g, " "); // Intl writes a non-breaking space before "€" in French

describe("the price list: €0.25 per pixel", () => {
  it("the default unit price is 25 cents, and the smallest parcel (25 pixels) is the one the brief starts from", () => {
    expect(DEFAULT_UNIT_PRICE_CENTS).toBe(25);
    expect(DEFAULT_PRICING.unitPriceCents).toBe(25);
    expect(MIN_AREA).toBe(25);
  });

  it.each(PRICE_TABLE)("$area px ($w × $h) costs $eurEn", ({ w, h, area, cents, eur, eurEn }) => {
    const q = quote({ w, h });
    expect(q.area).toBe(area);
    expect(q.unitPriceCents).toBe(25);
    expect(q.totalCents).toBe(cents);
    expect(q.totalCents).toBe(area * 25); // never anything but pixels × 25 cents
    expect(plain(formatMoney(q.totalCents, "fr", "eur"))).toBe(eur);
    expect(formatMoney(q.totalCents, "en", "eur")).toBe(eurEn);
  });

  it("is the same figure in dollars (0.25 $ a pixel): the brief's table in the other currency", () => {
    for (const { w, h, cents } of PRICE_TABLE) expect(quote({ w, h }, 25, { currency: "usd" }).totalCents).toBe(cents);
    expect(formatMoney(625, "en", "usd")).toBe("$6.25");
    expect(plain(formatMoney(10_000, "fr", "usd"))).toBe("100 $US");
  });

  it("a water parcel costs the same as a land parcel of the same size at the default rate (100 %)", () => {
    for (const { w, h, cents } of PRICE_TABLE) expect(quote({ w, h }, 25, { kind: "water", landPixels: 0, waterPercent: DEFAULT_PRICING.waterPercent }).totalCents).toBe(cents);
  });

  it("the buy panel's own fallback (when the database cannot be read) is the same price", () => {
    for (const { w, h, cents } of PRICE_TABLE) expect(quote({ w, h }, DEFAULT_PRICING.unitPriceCents).totalCents).toBe(cents);
  });
});
