import { getPricing, isAreaFree, isAreaFreeOfAll } from "@/lib/data/map";
import { getFreeStatus } from "@/lib/data/free";
import { landPixelsIn } from "@/lib/geo/landServer";
import { json } from "@/lib/http/errors";
import { intParam, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { validateRect } from "@/lib/grid/geometry";
import { enoughForKind, isParcelKind, quote, type ParcelKind } from "@/lib/grid/pricing";
import { requestCurrency } from "@/lib/currency-server";

/** Non-binding availability probe used while the buyer positions and customises a parcel. */
export const GET = route(async (req) => {
  await enforceRateLimit(req, LIMITS.availability);
  const q = new URL(req.url).searchParams;
  const rect = { x: intParam(q.get("x"), -1e9, 1e9), y: intParam(q.get("y"), -1e9, 1e9), w: intParam(q.get("w"), 0, 1e9), h: intParam(q.get("h"), 0, 1e9) };
  if (rect.x === null || rect.y === null || rect.w === null || rect.h === null) return json({ error: "px_invalid_rect" }, { status: 400 });
  const kindParam = q.get("kind");
  if (kindParam !== null && !isParcelKind(kindParam)) return json({ error: "px_invalid_rect" }, { status: 400 });
  const kind: ParcelKind = kindParam === "water" ? "water" : "land";
  const pricing = await getPricing(requestCurrency(req.headers));
  if (q.get("free") === "1") {
    // a FREE parcel: land only, 1 pixel up to the biggest free parcel, and nothing at all may be there (a paid parcel can cover it later, never the other way round)
    const status = await getFreeStatus(null);
    const area = (rect.w ?? 0) * (rect.h ?? 0);
    if (!status || area < 1 || area > status.maxArea) return json({ error: "px_invalid_rect" }, { status: 400 });
    const fr = rect as { x: number; y: number; w: number; h: number };
    const landPx = await landPixelsIn(fr);
    const ok = enoughForKind("land", landPx, area, pricing);
    return json({ free: ok && (await isAreaFreeOfAll(fr.x, fr.y, fr.w, fr.h)), kind: "land", enough: ok, landPixels: landPx }, { cache: "no-store" });
  }
  const err = validateRect(rect as { x: number; y: number; w: number; h: number }, { minArea: pricing.minArea, maxArea: pricing.maxArea });
  if (err) return json({ error: "px_invalid_rect", reason: err }, { status: 400 });
  const landPixels = await landPixelsIn(rect as { x: number; y: number; w: number; h: number });
  // `enough`: the rectangle has enough of what a parcel of this kind owns (land, or water). `onLand` is kept for the land kind.
  const enough = enoughForKind(kind, landPixels, rect.w! * rect.h!, pricing);
  const free = enough && (await isAreaFree(rect.x, rect.y, rect.w, rect.h, kind));
  const price = quote(rect as { w: number; h: number }, pricing.unitPriceCents, { landPixels, kind, seaPercent: pricing.seaPercent, waterPercent: pricing.waterPercent, landCutPercent: pricing.landCutPercent, currency: pricing.currency });
  return json({ free, kind, enough, onLand: kind === "land" ? enough : undefined, landPixels, price }, { cache: "no-store" });
});
