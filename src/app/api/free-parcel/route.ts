import { requireActiveViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { getPricing, invalidatePublicStats } from "@/lib/data/map";
import { getFreeStatus } from "@/lib/data/free";
import { HttpError, json } from "@/lib/http/errors";
import { intParam, assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { landPixelsIn } from "@/lib/geo/landServer";
import { enoughForKind } from "@/lib/grid/pricing";
import { parseCreationMeta, readCreationImage, storeCreation } from "@/lib/creations";
import { requestCurrency } from "@/lib/currency-server";

export const maxDuration = 30;

/**
 * Places a FREE parcel (1 to 24 pixels, land, no payment): the pixels are the account's at once and their creation waits for moderation like
 * any other. A paid parcel that touches it covers it, whole (migration 23). Everything is decided by PostgreSQL (`px_place_free_parcel`: the
 * window, the cap, the quota, the overlaps, the land share); this route checks the account, the image and the land count, and gives the pixels
 * back if the creation cannot be stored.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const viewer = await requireActiveViewer();
  if (!viewer.user.emailConfirmed) throw new HttpError(403, "email_not_verified"); // a verified address is what stands between this and a script
  await enforceRateLimit(req, LIMITS.freeParcel, viewer.user.id);

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 4 * 1024 * 1024) throw new HttpError(413, "too_large");
  const form = await req.formData();
  const rect = { x: intParam(String(form.get("x")), 0, 1e9), y: intParam(String(form.get("y")), 0, 1e9), w: intParam(String(form.get("w")), 1, 1e9), h: intParam(String(form.get("h")), 1, 1e9) };
  if (rect.x === null || rect.y === null || rect.w === null || rect.h === null) throw new HttpError(400, "px_invalid_rect");
  const r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };

  // the same answers as the database, given before anything is read or stored (the database decides again, atomically)
  const free = await getFreeStatus(viewer.user.id);
  if (!free) throw new HttpError(503, "px_free_closed");
  if (free.reason === "full") throw new HttpError(403, "px_free_full");
  if (free.reason) throw new HttpError(403, "px_free_closed");
  if (free.userReason) throw new HttpError(403, "px_free_quota");
  if (r.w * r.h > free.maxArea) throw new HttpError(400, "px_invalid_rect");
  const pricing = await getPricing(requestCurrency(req.headers));
  const landPx = await landPixelsIn(r); // counted HERE, from the server's own map data, as for a purchase
  if (!enoughForKind("land", landPx, r.w * r.h, pricing)) throw new HttpError(422, "px_not_on_land");

  const meta = parseCreationMeta(form);
  const img = await readCreationImage(form, r); // fail fast, before any pixel is taken

  const [placed] = await query<{ parcel_id: string; code: string }>("select parcel_id, code from public.px_place_free_parcel($1, $2, $3, $4, $5, $6)", [viewer.user.id, r.x, r.y, r.w, r.h, landPx]);
  if (!placed) throw new HttpError(500, "free_parcel_not_created");
  try {
    await storeCreation(viewer.user.id, placed.parcel_id, img, meta);
  } catch (e) {
    // the creation could not be stored: give the pixels (and the try) back at once
    await query("select public.px_cancel_free_parcel($1, $2)", [viewer.user.id, placed.parcel_id]).catch(() => undefined);
    throw e;
  }
  invalidatePublicStats(); // the counters (the free ones apart) and the map are fresh at once
  return json({ code: placed.code }, { cache: "no-store", status: 201 });
});
