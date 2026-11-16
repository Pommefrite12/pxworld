import "server-only";
import { after } from "next/server";
import { query } from "@/lib/db/pool";
import { autoTranslateEnabled } from "@/lib/env";
import { ensureAutoTranslation, needsAutoTranslation } from "@/lib/i18n/autotranslate";

/**
 * The titles of the LISTS (home, Discover, the latest creations on the map, the rankings, a profile) in the language of the page.
 *
 * A list never waits for Claude and never makes a visitor pay for a translation twice: it shows the translation of a title WHEN THERE IS ONE
 * (made on the first view of the parcel, or already for another list), and for the first titles of the list that have none yet it starts the
 * translation AFTER the response is sent (`after`), so that the next visit has them. The parcel's own card and pages (`getPublicParcel`) are
 * where a first view waits for its translation, and say it is an automatic one; a list is only a list of titles.
 */

/** At most this many untranslated titles of one list are sent for translation after one view (the daily ceiling still applies). */
const PREFETCH_MAX = 8;

/** The title of an asset in `lang`, from its `i18n` (curated or automatic), or null. */
export function translatedTitle(i18n: unknown, lang: string): string | null {
  if (!i18n || typeof i18n !== "object") return null;
  const t = (i18n as Record<string, { title?: unknown } | undefined>)[lang]?.title;
  return typeof t === "string" && t ? t : null;
}

interface AssetText { id: string; title: string | null; description: string | null; i18n: unknown; tier: string }

/** Starts the translation of titles that have none, once the response has gone (or at once when there is no response to wait for: a script, a test). */
function prefetch(items: AssetText[]) {
  if (!items.length || !autoTranslateEnabled() || process.env.NEXT_PHASE === "phase-production-build") return;
  const run = async () => { await Promise.allSettled(items.map((a) => ensureAutoTranslation({ id: a.id, title: a.title, description: a.description, i18n: a.i18n }))); };
  try { after(run); } catch { void run(); }
}

/** The titles to show in `lang` for these published assets (only those that have a translation), and the first untranslated ones are sent for translation. */
export async function listTitles(assetIds: (string | null | undefined)[], lang: string | undefined): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(assetIds.filter((x): x is string => Boolean(x)))];
  if (!lang || !ids.length) return out;
  let rows: AssetText[];
  try {
    rows = await query<AssetText>("select a.id, a.title, a.description, a.i18n, p.tier from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where a.id = any($1::uuid[])", [ids]);
  } catch { return out; } // without the column (a database not yet migrated) a list simply shows the titles as they are
  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing: AssetText[] = [];
  for (const id of ids) { // in the order of the list: the first titles are the ones that are seen
    const r = byId.get(id);
    if (!r) continue;
    const t = translatedTitle(r.i18n, lang);
    if (t) out.set(id, t);
    else if (r.tier !== "illustration" && needsAutoTranslation(r.i18n, { title: r.title, description: r.description }) && missing.length < PREFETCH_MAX) missing.push(r);
  }
  prefetch(missing);
  return out;
}

/** The rows of a list with their titles in `lang`. */
export async function localizeCards<T extends { asset_id: string | null; title: string | null }>(rows: T[], lang: string | undefined): Promise<T[]> {
  const titles = await listTitles(rows.map((r) => r.asset_id), lang);
  if (!titles.size) return rows;
  return rows.map((r) => { const t = r.asset_id ? titles.get(r.asset_id) : undefined; return t ? { ...r, title: t } : r; });
}
