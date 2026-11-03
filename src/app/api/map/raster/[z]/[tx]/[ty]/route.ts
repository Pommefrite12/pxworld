import { intParam, route } from "@/lib/http/route";
import { MAX_RASTER_ZOOM, renderRasterTile } from "@/lib/map/raster";

export const GET = route(async (req, ctx: { params: Promise<{ z: string; tx: string; ty: string }> }) => {
  const p = await ctx.params;
  const z = intParam(p.z, 0, MAX_RASTER_ZOOM), tx = intParam(p.tx, 0, 400), ty = intParam(p.ty, 0, 400);
  if (z === null || tx === null || ty === null) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const kind = q.get("k") === "w" ? "water" : "land"; // two layers: the land parcels (default) and the water parcels (?k=w)
  const png = await renderRasterTile(z, tx, ty, kind);
  const versioned = q.has("v");
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": versioned ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, s-maxage=10, stale-while-revalidate=30",
    },
  });
});
