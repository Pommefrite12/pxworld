import { CURRENCY, DEFAULT_UNIT_PRICE_CENTS } from "./constants";
import { area, type Rect } from "./geometry";

export interface PriceQuote {
  area: number;
  unitPriceCents: number;
  totalCents: number;
  currency: string;
}

/**
 * Price of a parcel in minor currency units. Always an integer; computed from the
 * surface and the unit price in force. The server recomputes it for every order —
 * a client-side quote is a display convenience only.
 */
export function quote(size: Pick<Rect, "w" | "h">, unitPriceCents: number = DEFAULT_UNIT_PRICE_CENTS): PriceQuote {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) throw new RangeError("invalid unit price");
  const a = area(size);
  const totalCents = a * unitPriceCents;
  if (!Number.isSafeInteger(totalCents)) throw new RangeError("price overflow");
  return { area: a, unitPriceCents, totalCents, currency: CURRENCY };
}

export function formatMoney(cents: number, locale: string, currency: string = CURRENCY): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export const formatInt = (n: number, locale: string): string => new Intl.NumberFormat(locale).format(n);
