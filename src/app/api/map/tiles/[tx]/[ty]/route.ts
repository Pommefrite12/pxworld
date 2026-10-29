import { getTile } from "@/lib/data/map";
import { json } from "@/lib/http/errors";
import { intParam, route } from "@/lib/http/route";

// 50 × 20 metadata tiles of 1000 × 1000 virtual pixels. `?v=<mapVersion>` makes each URL immutable:
// the version bumps whenever the visible map changes, so CDN/browser caches never serve stale content.
export const GET = route(async (req, ctx: { params: Promise<{ tx: string; ty: string }> }) => {
  const { tx: a, ty: b } = await ctx.params;
  const tx = intParam(a, 0, 49), ty = intParam(b, 0, 19);
  if (tx === null || ty === null) return json({ error: "bad_tile" }, { status: 404 });
  const versioned = new URL(req.url).searchParams.has("v");
  return json(await getTile(tx, ty), {
    cache: versioned ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, s-maxage=10, stale-while-revalidate=30",
  });
});
