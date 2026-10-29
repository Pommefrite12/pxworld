import { getPublicParcel } from "@/lib/data/parcels";
import { json } from "@/lib/http/errors";
import { route } from "@/lib/http/route";

/** Public JSON card of a parcel (used by the map popover). Hidden parcels expose no creation. */
export const GET = route(async (_req, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const p = await getPublicParcel(code);
  if (!p) return json({ error: "not_found" }, { status: 404 });
  return json(
    {
      code: p.code, x: p.x, y: p.y, w: p.w, h: p.h, area: p.area, hidden: p.hidden, likes: p.likes, activatedAt: p.activated_at,
      owner: { username: p.owner.username, country: p.owner.country, avatarId: p.owner.avatar ? p.owner.id : null },
      creation: p.creation && {
        assetId: p.creation.asset_id, title: p.creation.title, description: p.creation.description, link: p.creation.link_url,
        commercial: p.creation.is_commercial, publishedAt: p.creation.published_at, color: p.creation.avg_color,
      },
    },
    { cache: "public, s-maxage=30, stale-while-revalidate=300" },
  );
});
