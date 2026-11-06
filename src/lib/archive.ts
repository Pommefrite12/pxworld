/**
 * The archive fields of a creation (migration 20): a category from a closed list, and the place the creation is about.
 * Pure (no database): shared by the forms, the API validation and the pages. The database repeats the same rules.
 *
 * The place is a free text and an optional country, NEVER coordinates: a precise position is personal data and the archive does not need it.
 * It is distinct from where the parcel sits on the map.
 */
export const CATEGORIES = ["arts", "daily", "family", "nature", "science", "sport", "food", "tribute", "humor", "future", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const isCategory = (v: unknown): v is Category => typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

export const PLACE_MAX = 80;
export const COUNTRY_RE = /^[A-Z]{2}$/;

/** The country code as the database keeps it (upper case), or null when it is empty or not two letters. */
export function normalizeCountry(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return COUNTRY_RE.test(c) ? c : null;
}

export interface ArchiveFields { category: Category | null; placeLabel: string | null; placeCountry: string | null }
