import { ensureGuestBuyer, normalizeEmail, type Buyer } from "@/lib/auth/guest";
import { getViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { getPricing } from "@/lib/data/map";
import { HttpError, json } from "@/lib/http/errors";
import { intParam, assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { validateRect } from "@/lib/grid/geometry";
import { createCheckoutSession, type OrderForCheckout } from "@/lib/stripe/checkout";
import { stripeConfigured } from "@/lib/stripe/client";
import { landPixelsIn } from "@/lib/geo/landServer";
import { enoughLand } from "@/lib/grid/pricing";
import { parseCreationMeta, readCreationImage, storeCreation } from "@/lib/creations";

export const maxDuration = 30;

/**
 * Starts a purchase: validates the creation, atomically reserves the pixels and creates the order
 * (price computed by PostgreSQL), then opens a Stripe Checkout Session. The parcel only becomes
 * the buyer's when a verified Stripe webhook confirms the payment.
 *
 * No account is needed: a visitor who is not signed in gives an e-mail address (see lib/auth/guest.ts). A signed-in
 * visitor buys as themselves.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const viewer = await getViewer();
  if (viewer && viewer.profile.status !== "active") throw new HttpError(403, "px_account_suspended");
  await enforceRateLimit(req, viewer ? LIMITS.checkout : LIMITS.guestCheckout, viewer?.user.id);
  if (!stripeConfigured()) throw new HttpError(503, "payments_not_configured");

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 4 * 1024 * 1024) throw new HttpError(413, "too_large");
  const form = await req.formData();
  const rect = { x: intParam(String(form.get("x")), 0, 1e9), y: intParam(String(form.get("y")), 0, 1e9), w: intParam(String(form.get("w")), 1, 1e9), h: intParam(String(form.get("h")), 1, 1e9) };
  if (rect.x === null || rect.y === null || rect.w === null || rect.h === null) throw new HttpError(400, "px_invalid_rect");
  const r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  const pricing = await getPricing();
  if (!pricing.salesOpen) throw new HttpError(503, "px_sales_closed");
  if (validateRect(r, { minArea: pricing.minArea, maxArea: pricing.maxArea })) throw new HttpError(400, "px_invalid_rect");
  // coastal parcels are allowed, never mostly sea: the land count is made HERE, from the server's own map data
  const landPx = await landPixelsIn(r);
  if (!enoughLand(landPx, r.w * r.h, pricing.minLandPercent)) throw new HttpError(422, "px_not_on_land");
  const locale = form.get("locale") === "fr" ? "fr" : "en";

  const meta = parseCreationMeta(form);
  const img = await readCreationImage(form, r); // fail fast, before any pixel is held

  // Everything about the request is valid: only now does an address without an account get one (never for a bad request)
  let buyer: Buyer;
  if (viewer) buyer = { id: viewer.user.id, email: viewer.user.email ?? "" };
  else {
    const email = normalizeEmail(form.get("email"));
    if (!email) throw new HttpError(400, "invalid_email");
    buyer = await ensureGuestBuyer(req, email);
    await enforceRateLimit(req, LIMITS.checkout, buyer.id); // per address too: one e-mail cannot hoard pixels from many addresses of the network
  }

  const [order] = await query<OrderForCheckout & { reservation_id: string }>(
    "select order_id as id, parcel_id, $1::uuid as user_id, $2::int as x, $3::int as y, $4::int as w, $5::int as h, ($4 * $5)::int as area, amount_cents, currency, expires_at, reservation_id from public.px_start_order($1, $2, $3, $4, $5, $6)",
    [buyer.id, r.x, r.y, r.w, r.h, landPx],
  );
  if (!order) throw new HttpError(500, "order_not_created");

  try {
    await storeCreation(buyer.id, order.parcel_id, img, meta);
    const session = await createCheckoutSession(order, buyer.email || null, locale);
    return json({ orderId: order.id, url: session.url, expiresAt: order.expires_at }, { cache: "no-store" });
  } catch (e) {
    // Anything failed after the pixels were held: give them back immediately.
    await query("select public.px_cancel_order($1, $2)", [order.id, buyer.id]).catch(() => undefined);
    throw e;
  }
});
