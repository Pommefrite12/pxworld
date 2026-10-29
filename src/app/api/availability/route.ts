import { getPricing, isAreaFree } from "@/lib/data/map";
import { json } from "@/lib/http/errors";
import { intParam, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { validateRect } from "@/lib/grid/geometry";
import { quote } from "@/lib/grid/pricing";

/** Non-binding availability probe used while the buyer positions and customises a parcel. */
export const GET = route(async (req) => {
  await enforceRateLimit(req, LIMITS.availability);
  const q = new URL(req.url).searchParams;
  const rect = { x: intParam(q.get("x"), -1e9, 1e9), y: intParam(q.get("y"), -1e9, 1e9), w: intParam(q.get("w"), 0, 1e9), h: intParam(q.get("h"), 0, 1e9) };
  if (rect.x === null || rect.y === null || rect.w === null || rect.h === null) return json({ error: "px_invalid_rect" }, { status: 400 });
  const pricing = await getPricing();
  const err = validateRect(rect as { x: number; y: number; w: number; h: number }, { minArea: pricing.minArea, maxArea: pricing.maxArea });
  if (err) return json({ error: "px_invalid_rect", reason: err }, { status: 400 });
  const free = await isAreaFree(rect.x, rect.y, rect.w, rect.h);
  return json({ free, price: quote(rect as { w: number; h: number }, pricing.unitPriceCents) }, { cache: "no-store" });
});
