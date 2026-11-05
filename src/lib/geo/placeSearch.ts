import { FR_DEPARTEMENTS } from "./frDepartements";

/**
 * How place names are compared in the search box: no accents, no capitals, hyphens, apostrophes and dots read as spaces, one space between
 * words — so "Saint-Jean-de-Luz", "saint jean de luz" and "St. Jean" all meet the way people type them.
 */
export const normName = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[-'’.,]/g, " ").replace(/\s+/g, " ").trim();

/** A commune of France as the file `search-communes.json` has it: x, y (grid px), name, département code. */
export type CommuneRow = [number, number, string, string];
/** A smaller place of the world, as `search-places.json` has it: x, y, population, name, country. */
export type PlaceRow = [number, number, number, string, string];

export interface IndexedCommune { x: number; y: number; name: string; dep: string; n: string }
export interface IndexedPlace { x: number; y: number; pop: number; name: string; cc: string; n: string }

export const indexCommunes = (rows: readonly CommuneRow[]): IndexedCommune[] => rows.map(([x, y, name, dep]) => ({ x, y, name, dep, n: normName(name) }));
export const indexPlaces = (rows: readonly PlaceRow[]): IndexedPlace[] => rows.map(([x, y, pop, name, cc]) => ({ x, y, pop, name, cc, n: normName(name) }));

/** "Ain (01)", "Corse-du-Sud (2A)"; the overseas places have no département here. */
export const departmentLabel = (code: string): string => (FR_DEPARTEMENTS[code] ? `${FR_DEPARTEMENTS[code]} (${code})` : code);

export interface SmallMatches<T> { exact: T[]; starts: T[]; contains: T[] }

/**
 * The entries whose name contains the (already normalised) query, in three classes — the exact name, a name that starts with it, a name
 * that contains it — each capped, so that a query like "sai" (thousands of communes) stays cheap. Order inside a class is the file's.
 */
export function findSmall<T extends { n: string }>(list: readonly T[], q: string, caps = { exact: 40, starts: 120, contains: 120 }): SmallMatches<T> {
  const out: SmallMatches<T> = { exact: [], starts: [], contains: [] };
  if (q.length === 0) return out;
  for (const e of list) {
    const at = e.n.indexOf(q);
    if (at < 0) continue;
    if (e.n.length === q.length) { if (out.exact.length < caps.exact) out.exact.push(e); }
    else if (at === 0) { if (out.starts.length < caps.starts) out.starts.push(e); }
    else if (out.contains.length < caps.contains) out.contains.push(e);
  }
  return out;
}

/** A commune that is already shown as a city of the other index (same name, within `near` grid px): not listed twice. */
export function isShownAsCity(c: { n: string; x: number; y: number }, cities: ReadonlyMap<string, readonly { x: number; y: number }[]>, near = 30): boolean {
  return (cities.get(c.n) ?? []).some((k) => Math.hypot(k.x - c.x, k.y - c.y) <= near);
}
