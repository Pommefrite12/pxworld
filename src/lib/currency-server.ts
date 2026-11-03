import "server-only";
import { countryOfRequest, currencyForCountry, effectiveCountry, type SaleCurrency } from "@/lib/currency";

/** The currency a request pays in: from the host's country header (see `lib/currency`), or `TEST_COUNTRY` while payments are in test mode. */
export function requestCurrency(headers: { get(name: string): string | null }): SaleCurrency {
  return currencyForCountry(effectiveCountry(countryOfRequest(headers), process.env.TEST_COUNTRY, process.env.STRIPE_SECRET_KEY));
}
