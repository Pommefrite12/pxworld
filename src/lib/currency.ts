/**
 * Which currency a buyer pays in: euros in the euro area, US dollars everywhere else (the owner's decision). Pure — the country
 * comes from the host (see `countryOfRequest`), and the server alone decides: nothing the browser says changes a price.
 */
export type SaleCurrency = "eur" | "usd";

/**
 * The countries and territories whose currency is the euro (ISO 3166-1 alpha-2): the 21 members of the euro area (Bulgaria joined
 * on 1 January 2026), their territories that use it, and the states that use it by agreement or on their own (Andorra, Monaco,
 * San Marino, the Vatican, Montenegro, Kosovo). One place to edit if the list ever needs to change.
 */
export const EURO_COUNTRIES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES", // members
  "AX", "GF", "GP", "MQ", "RE", "YT", "MF", "BL", "PM", // territories of members that use the euro
  "AD", "MC", "SM", "VA", "ME", "XK", // states that use the euro without being members
]);

/** Euros for a country of the euro area, dollars for any other country; euros when the country is not known (the shop's own currency). */
export function currencyForCountry(country: string | null | undefined): SaleCurrency {
  const c = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === "XX" || c === "T1") return "eur"; // unknown (a local machine, a masked address): the shop's own currency
  return EURO_COUNTRIES.has(c) ? "eur" : "usd";
}

/** The country the host says the request comes from (Vercel, or Cloudflare in front of anything else), or `null`. */
export function countryOfRequest(headers: { get(name: string): string | null }): string | null {
  const v = headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry");
  return v && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null;
}

export const currencyOfRequest = (headers: { get(name: string): string | null }): SaleCurrency => currencyForCountry(countryOfRequest(headers));

export const isSaleCurrency = (v: unknown): v is SaleCurrency => v === "eur" || v === "usd";
