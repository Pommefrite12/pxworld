import { requireActiveViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { getPricing } from "@/lib/data/map";
import { HttpError, json } from "@/lib/http/errors";
import { intParam, assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { validateRect } from "@/lib/grid/geometry";
import { createCheckoutSession, type OrderForCheckout } from "@/lib/stripe/checkout";
import { stripeConfigured } from "@/lib/stripe/client";
import { landPixelsIn } from "@/lib/geo/landServer";
import { enoughForKind, isParcelKind, type ParcelKind } from "@/lib/grid/pricing";
import { parseCreationMeta, readCreationImage, storeCreation } from "@/lib/creations";
import { assertSalesOpen } from "@/lib/data/edition";
import { requestCurrency } from "@/lib/currency-server";

export const maxDuration = 30;

/**
 * Starts a purchase: validates the creation, atomically reserves the pixels and creates the order
 * (price computed by PostgreSQL), then opens a Stripe Checkout Session. The parcel only becomes
 * the buyer's when a verified Stripe webhook confirms the payment.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const viewer = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.checkout, viewer.user.id);
  if (!stripeConfigured()) throw new HttpError(503, "payments_not_configured");

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 4 * 1024 * 1024) throw new HttpError(413, "too_large");
  const form = await req.formData();
  const rect = { x: intParam(String(form.get("x")), 0, 1e9), y: intParam(String(form.get("y")), 0, 1e9), w: intParam(String(form.get("w")), 1, 1e9), h: intParam(String(form.get("h")), 1, 1e9) };
  if (rect.x === null || rect.y === null || rect.w === null || rect.h === null) throw new HttpError(400, "px_invalid_rect");
  const r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  // what is bought: land (the default) or water. A parcel owns only the pixels of its kind inside its rectangle.
  const kindField = form.get("kind");
  if (kindField !== null && kindField !== "" && !isParcelKind(kindField)) throw new HttpError(400, "px_invalid_rect");
  const kind: ParcelKind = kindField === "water" ? "water" : "land";
  // The currency is decided here, from the buyer's country (euros in the euro area, dollars elsewhere). The browser sends the
  // one it displayed: if the two differ (the buyer's connection moved to another country in between), nothing is charged.
  const currency = requestCurrency(req.headers);
  const shown = form.get("currency");
  if (typeof shown === "string" && shown.toLowerCase() !== currency) throw new HttpError(409, "px_currency_changed");
  const pricing = await getPricing(currency);
  assertSalesOpen(pricing); // pre-launch, after the closing, or the shop switched off: refused here with the right reason (the database refuses too)
  if (validateRect(r, { minArea: pricing.minArea, maxArea: pricing.maxArea })) throw new HttpError(400, "px_invalid_rect");
  // coastal parcels are allowed, never mostly of the other kind: the land count is made HERE, from the server's own map data
  const landPx = await landPixelsIn(r);
  if (!enoughForKind(kind, landPx, r.w * r.h, pricing)) throw new HttpError(422, kind === "water" ? "px_not_on_water" : "px_not_on_land");
  const locale = form.get("locale") === "fr" ? "fr" : "en";

  const meta = parseCreationMeta(form);
  const img = await readCreationImage(form, r); // fail fast, before any pixel is held

  const [order] = await query<OrderForCheckout & { reservation_id: string }>(
    "select order_id as id, parcel_id, $1::uuid as user_id, $2::int as x, $3::int as y, $4::int as w, $5::int as h, ($4 * $5)::int as area, amount_cents, currency, expires_at, reservation_id from public.px_start_order($1, $2, $3, $4, $5, $6, $7, $8)",
    [viewer.user.id, r.x, r.y, r.w, r.h, landPx, currency, kind],
  );
  if (!order) throw new HttpError(500, "order_not_created");

  try {
    await storeCreation(viewer.user.id, order.parcel_id, img, meta);
    const session = await createCheckoutSession(order, viewer.user.email, locale);
    return json({ orderId: order.id, url: session.url, expiresAt: order.expires_at }, { cache: "no-store" });
  } catch (e) {
    // Anything failed after the pixels were held: give them back immediately.
    await query("select public.px_cancel_order($1, $2)", [order.id, viewer.user.id]).catch(() => undefined);
    throw e;
  }
});
