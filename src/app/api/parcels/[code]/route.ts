import { getPublicParcel } from "@/lib/data/parcels";
import { locales } from "@/i18n/routing";
import { json } from "@/lib/http/errors";
import { route } from "@/lib/http/route";

/**
 * Public JSON card of a parcel (used by the map popover). Hidden parcels expose no creation. `?lang=fr|en|es|zh`: the language of the visitor, for the
 * title and the sentence of an illustration parcel (the address is the cache key, so each language is cached on its own); without it, the stored text.
 */
export const GET = route(async (req, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const lang = new URL(req.url).searchParams.get("lang");
  const p = await getPublicParcel(code, (locales as readonly string[]).includes(lang ?? "") ? lang! : undefined);
  if (!p) return json({ error: "not_found" }, { status: 404 });
  return json(
    {
      code: p.code, x: p.x, y: p.y, w: p.w, h: p.h, area: p.area, kind: p.kind, tier: p.tier, coveredAt: p.covered_at, hidden: p.hidden, likes: p.likes, activatedAt: p.activated_at, edition: p.edition,
      owner: { username: p.owner.username, country: p.owner.country, avatarId: p.owner.avatar ? p.owner.id : null },
      creation: p.creation && {
        assetId: p.creation.asset_id, title: p.creation.title, description: p.creation.description, link: p.creation.link_url,
        commercial: p.creation.is_commercial, publishedAt: p.creation.published_at, color: p.creation.avg_color,
        category: p.creation.category, placeLabel: p.creation.place_label, placeCountry: p.creation.place_country,
        translation: p.creation.translation, // set when title and description are an automatic translation (with the original)
      },
    },
    { cache: "public, s-maxage=30, stale-while-revalidate=300" },
  );
});
