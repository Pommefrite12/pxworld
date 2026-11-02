import { CURRENCY, DEFAULT_UNIT_PRICE_CENTS } from "./constants";
import { area, type Rect } from "./geometry";

export interface PriceQuote {
  area: number;
  /** Pixels of the parcel that are land / sea. A parcel entirely on land has no sea pixel. */
  landPixels: number;
  seaPixels: number;
  unitPriceCents: number;
  /** What one sea pixel costs, as a percentage of a land pixel (0 = free). */
  seaPercent: number;
  totalCents: number;
  currency: string;
}

/** The business parameters a buyer sees (from app_settings). */
export interface Pricing {
  unitPriceCents: number;
  currency: string;
  minArea: number;
  maxArea: number;
  salesOpen: boolean;
  /** A parcel may include some sea, but at least this share of its pixels must be land. */
  minLandPercent: number;
  /** One sea pixel costs this percentage of a land pixel (0 = free). */
  seaPercent: number;
}

export const DEFAULT_PRICING: Pricing = { unitPriceCents: 100, currency: "eur", minArea: 100, maxArea: 250_000, salesOpen: false, minLandPercent: 50, seaPercent: 0 };

/** Same arithmetic as `px_start_order`: at least `minLandPercent` % of the pixels (and at least one) must be land. */
export function enoughLand(landPixels: number, areaPixels: number, minLandPercent: number): boolean {
  return landPixels >= 1 && landPixels <= areaPixels && landPixels * 100 >= areaPixels * minLandPercent;
}

/**
 * Price of a parcel in minor currency units: land pixels at the unit price, sea pixels at `seaPercent` % of it (rounded
 * down, like the database). Always an integer. The server recomputes it for every order — a client-side quote is a
 * display convenience only. Without `landPixels` the whole parcel is priced as land.
 */
export function quote(
  size: Pick<Rect, "w" | "h">,
  unitPriceCents: number = DEFAULT_UNIT_PRICE_CENTS,
  opts: { landPixels?: number | null; seaPercent?: number } = {},
): PriceQuote {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) throw new RangeError("invalid unit price");
  const a = area(size);
  const land = Math.max(0, Math.min(a, opts.landPixels ?? a));
  const sea = a - land;
  const seaPercent = opts.seaPercent ?? 0;
  const totalCents = land * unitPriceCents + Math.floor((sea * unitPriceCents * seaPercent) / 100);
  if (!Number.isSafeInteger(totalCents)) throw new RangeError("price overflow");
  return { area: a, landPixels: land, seaPixels: sea, unitPriceCents, seaPercent, totalCents, currency: CURRENCY };
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
