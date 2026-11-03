import { WATER_CELL, getWaterCells } from "@/lib/data/map";
import { json } from "@/lib/http/errors";
import { route } from "@/lib/http/route";

// Where the water parcels are (see getWaterCells). `?v=<mapVersion>` makes the URL immutable like the tiles': the version bumps whenever the
// visible map changes.
export const GET = route(async (req) => {
  const c = await getWaterCells();
  const versioned = new URL(req.url).searchParams.has("v");
  return json({ cell: WATER_CELL, c }, { cache: versioned ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, s-maxage=10, stale-while-revalidate=30" });
});
