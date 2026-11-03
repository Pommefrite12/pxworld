import { describe, expect, it } from "vitest";
import { EURO_COUNTRIES, countryOfRequest, currencyForCountry, currencyOfRequest, isSaleCurrency } from "@/lib/currency";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe("euros in the euro area, dollars elsewhere", () => {
  it("charges the members of the euro area in euros, Bulgaria included (it joined in 2026)", () => {
    for (const c of ["FR", "DE", "ES", "IT", "NL", "BE", "AT", "PT", "IE", "FI", "GR", "LU", "SK", "SI", "EE", "LV", "LT", "MT", "CY", "HR", "BG"]) expect(currencyForCountry(c), c).toBe("eur");
  });
  it("charges the places that use the euro without being members in euros too, and the overseas territories that use it", () => {
    for (const c of ["MC", "AD", "SM", "VA", "ME", "XK", "RE", "GP", "MQ", "GF", "YT", "AX"]) expect(currencyForCountry(c), c).toBe("eur");
  });
  it("charges everybody else in dollars, the neighbours of the euro area included", () => {
    for (const c of ["US", "CA", "GB", "CH", "NO", "SE", "DK", "PL", "CZ", "HU", "RO", "JP", "AU", "BR", "IN", "CN", "NC", "PF", "RS", "UA", "TR"]) expect(currencyForCountry(c), c).toBe("usd");
  });
  it("has 21 members and no duplicates", () => {
    expect(EURO_COUNTRIES.size).toBe(21 + 9 + 6);
  });
  it("falls back on the shop's own currency, euros, when the country is not known or makes no sense", () => {
    for (const c of [null, undefined, "", " ", "XX", "T1", "FRA", "1", "F", "fr1"]) expect(currencyForCountry(c as string | null | undefined), String(c)).toBe("eur");
  });
  it("reads the country however it is written", () => {
    expect(currencyForCountry("fr")).toBe("eur");
    expect(currencyForCountry(" us ")).toBe("usd");
  });
  it("takes the country from the host's header (Vercel, or Cloudflare), and nothing else", () => {
    expect(countryOfRequest(h({ "x-vercel-ip-country": "US" }))).toBe("US");
    expect(countryOfRequest(h({ "cf-ipcountry": "fr" }))).toBe("FR");
    expect(countryOfRequest(h({ "x-vercel-ip-country": "DE", "cf-ipcountry": "US" }))).toBe("DE");
    expect(countryOfRequest(h({ "accept-language": "en-US" }))).toBeNull(); // a browser language says nothing about where the buyer is
    expect(countryOfRequest(h({ "x-vercel-ip-country": "<script>" }))).toBeNull();
    expect(currencyOfRequest(h({ "x-vercel-ip-country": "US" }))).toBe("usd");
    expect(currencyOfRequest(h({ "x-vercel-ip-country": "FR" }))).toBe("eur");
    expect(currencyOfRequest(h({}))).toBe("eur");
  });
  it("knows which currencies the shop sells in", () => {
    expect(isSaleCurrency("eur") && isSaleCurrency("usd")).toBe(true);
    for (const c of ["gbp", "EUR", "", null, 3]) expect(isSaleCurrency(c)).toBe(false);
  });
});
