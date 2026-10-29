import type { MetadataRoute } from "next";
import { locales } from "@/i18n/routing";
import { query } from "@/lib/db/pool";
import { siteUrl } from "@/lib/env";

export const revalidate = 3600;

const STATIC = ["", "/discover", "/rules", "/terms", "/privacy", "/credits", "/contact"];
const url = (locale: string, p: string) => `${siteUrl()}${locale === "en" ? "" : `/${locale}`}${p}` || siteUrl();

/**
 * Static pages + every published parcel (one URL per language, with hreflang alternates).
 * Capped at 45 000 parcels per file (the protocol limit is 50 000); switch to generateSitemaps() beyond that.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const alt = (p: string) => ({ languages: Object.fromEntries(locales.map((l) => [l, url(l, p)])) });
  const entries: MetadataRoute.Sitemap = STATIC.flatMap((p) => locales.map((l) => ({ url: url(l, p) || siteUrl(), changeFrequency: p === "" ? ("hourly" as const) : ("weekly" as const), priority: p === "" ? 1 : 0.5, alternates: alt(p) })));
  try {
    const rows = await query<{ code: string; published_at: Date | null }>(
      `select p.code, a.published_at from public.parcels p join public.parcel_assets a on a.id = p.published_asset_id
        where p.status = 'active' and p.hidden_at is null order by a.published_at desc nulls last limit 45000`,
    );
    for (const r of rows) for (const l of locales) entries.push({ url: url(l, `/p/${r.code}`), lastModified: r.published_at ?? undefined, changeFrequency: "weekly", priority: 0.6, alternates: alt(`/p/${r.code}`) });
  } catch (e) {
    console.error("sitemap: parcels unavailable", (e as Error).message);
  }
  return entries;
}
