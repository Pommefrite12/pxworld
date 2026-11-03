import { BEACON_CELL, getBeacons } from "@/lib/data/map";
import { json } from "@/lib/http/errors";
import { route } from "@/lib/http/route";

// Where the parcels are, for the "100 days" story's survivor beacons (see getBeacons). `?v=<mapVersion>` makes the URL immutable
// like the tiles': the version bumps whenever the visible map changes.
export const GET = route(async (req) => {
  const c = await getBeacons();
  const versioned = new URL(req.url).searchParams.has("v");
  return json({ cell: BEACON_CELL, c }, { cache: versioned ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, s-maxage=10, stale-while-revalidate=30" });
});
