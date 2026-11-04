import { CURRENCY, DEFAULT_UNIT_PRICE_CENTS, MIN_AREA } from "./constants";
import { area, type Rect } from "./geometry";

/** A parcel owns the land pixels of its rectangle (kind `land`) or its water pixels (kind `water`); the other pixels are cut away. */
export type ParcelKind = "land" | "water";
export const PARCEL_KINDS: readonly ParcelKind[] = ["land", "water"];
export const isParcelKind = (v: unknown): v is ParcelKind => v === "land" || v === "water";

export interface PriceQuote {
  kind: ParcelKind;
  area: number;
  /** Pixels of the rectangle that are land / sea (water). A rectangle entirely on land has no sea pixel. */
  landPixels: number;
  seaPixels: number;
  /** Pixels the parcel really owns (and pays for at the full rate): land for a land parcel, water for a water parcel. */
  ownedPixels: number;
  /** Pixels of the rectangle that are cut away (sea for a land parcel, land for a water parcel). */
  cutPixels: number;
  unitPriceCents: number;
  /** What one cut-away pixel costs, as a percentage of a land pixel (0 = free). */
  seaPercent: number;
  /** What one owned water pixel costs, as a percentage of a land pixel (100 for a land parcel). */
  waterPercent: number;
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
  /** A land parcel may include some sea, but at least this share of its pixels must be land. */
  minLandPercent: number;
  /** One sea pixel cut away from a land parcel costs this percentage of a land pixel (0 = free). */
  seaPercent: number;
  /** A water parcel may include some land, but at least this share of its pixels must be water. */
  minWaterPercent: number;
  /** One owned water pixel costs this percentage of a land pixel. */
  waterPercent: number;
  /** One land pixel cut away from a water parcel costs this percentage of a land pixel (0 = free). */
  landCutPercent: number;
  /** The smallest parcel that can be funded by several people (a campaign is for big parcels). */
  campaignMinArea: number;
  /** The smallest contribution to a campaign, in minor units (cents). */
  campaignMinContributionCents: number;
}

export const DEFAULT_PRICING: Pricing = {
  unitPriceCents: DEFAULT_UNIT_PRICE_CENTS, currency: "eur", minArea: MIN_AREA, maxArea: 250_000, salesOpen: false,
  minLandPercent: 50, seaPercent: 0, minWaterPercent: 50, waterPercent: 100, landCutPercent: 0, campaignMinArea: 10_000, campaignMinContributionCents: 200,
};

/** Same arithmetic as `px_start_order`: at least `minLandPercent` % of the pixels (and at least one) must be land. */
export function enoughLand(landPixels: number, areaPixels: number, minLandPercent: number): boolean {
  return landPixels >= 1 && landPixels <= areaPixels && landPixels * 100 >= areaPixels * minLandPercent;
}

/** At least `minWaterPercent` % of the pixels (and at least one) must be water, i.e. not land. */
export function enoughWater(landPixels: number, areaPixels: number, minWaterPercent: number): boolean {
  const water = areaPixels - landPixels;
  return landPixels >= 0 && landPixels <= areaPixels && water >= 1 && water * 100 >= areaPixels * minWaterPercent;
}

/** Does a rectangle with this many land pixels have enough of what its kind owns? */
export function enoughForKind(kind: ParcelKind, landPixels: number, areaPixels: number, p: Pick<Pricing, "minLandPercent" | "minWaterPercent">): boolean {
  return kind === "water" ? enoughWater(landPixels, areaPixels, p.minWaterPercent) : enoughLand(landPixels, areaPixels, p.minLandPercent);
}

/**
 * Price of a parcel in minor currency units. A land parcel: land pixels at the unit price, the sea pixels cut away at `seaPercent` % of it.
 * A water parcel: water pixels at `waterPercent` % of the unit price, the land pixels cut away at `landCutPercent` % of it. Rounded down,
 * like the database. Always an integer. The server recomputes it for every order — a client-side quote is a display convenience only.
 * Without `landPixels` the whole parcel is priced as land (and a water parcel as having no water: not valid).
 */
export function quote(
  size: Pick<Rect, "w" | "h">,
  unitPriceCents: number = DEFAULT_UNIT_PRICE_CENTS,
  opts: { landPixels?: number | null; seaPercent?: number; currency?: string; kind?: ParcelKind; waterPercent?: number; landCutPercent?: number } = {},
): PriceQuote {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) throw new RangeError("invalid unit price");
  const kind = opts.kind ?? "land";
  const a = area(size);
  const land = Math.max(0, Math.min(a, opts.landPixels ?? a));
  const sea = a - land;
  let totalCents: number, owned: number, cut: number, cutPercent: number, waterPercent = 100;
  if (kind === "water") {
    waterPercent = opts.waterPercent ?? 100;
    cutPercent = opts.landCutPercent ?? 0;
    owned = sea; cut = land;
    totalCents = Math.floor((owned * unitPriceCents * waterPercent) / 100) + Math.floor((cut * unitPriceCents * cutPercent) / 100);
  } else {
    cutPercent = opts.seaPercent ?? 0;
    owned = land; cut = sea;
    totalCents = owned * unitPriceCents + Math.floor((cut * unitPriceCents * cutPercent) / 100);
  }
  if (!Number.isSafeInteger(totalCents)) throw new RangeError("price overflow");
  return { kind, area: a, landPixels: land, seaPixels: sea, ownedPixels: owned, cutPixels: cut, unitPriceCents, seaPercent: cutPercent, waterPercent, totalCents, currency: opts.currency ?? CURRENCY };
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
