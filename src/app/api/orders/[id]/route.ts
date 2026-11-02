import { guestEmailOfOrder, maskEmail } from "@/lib/auth/guest";
import { getViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { devAuthEnabled } from "@/lib/env";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { accessibleOrder, expireCheckoutSession } from "@/lib/stripe/checkout";
import { reconcileOrder } from "@/lib/stripe/reconcile";

const ID = /^[0-9a-f-]{36}$/;

/**
 * Order status for the buyer: the signed-in buyer, or a buyer without an account holding the signed link (`?t=`) Stripe
 * sent them back to. NOTE: this is informative — the return from Stripe is never proof of payment.
 * With ?reconcile=1 the server asks Stripe's API directly (recovery when the webhook is late).
 */
export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!ID.test(id)) throw new HttpError(404, "not_found");
  const url = new URL(req.url);
  const viewer = await getViewer();
  const token = url.searchParams.get("t");
  let order = await accessibleOrder(id, viewer?.user.id ?? null, token);
  if (!order) throw new HttpError(404, "not_found");
  if (order.status === "pending" && url.searchParams.get("reconcile") === "1") {
    await reconcileOrder(id).catch((e) => console.error("reconcile failed", (e as Error).message));
    order = (await accessibleOrder(id, viewer?.user.id ?? null, token)) ?? order;
  }
  const [parcel] = await query<{ code: string }>("select code from public.parcels where id = $1", [order.parcel_id]);
  // a buyer without an account is told where the sign-in link went (masked); development, with no mailbox, also gets the address
  const guest = viewer?.user.id === order.user_id ? null : await guestEmailOfOrder(id);
  return json({
    id: order.id, status: order.status, parcelCode: order.status === "paid" ? parcel?.code : null,
    guestEmail: guest ? maskEmail(guest) : null, devEmail: guest && devAuthEnabled() ? guest : null,
  }, { cache: "no-store" });
});

/** The buyer abandons the checkout: free the pixels at once. */
export const DELETE = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  if (!ID.test(id)) throw new HttpError(404, "not_found");
  const viewer = await getViewer();
  const order = await accessibleOrder(id, viewer?.user.id ?? null, new URL(req.url).searchParams.get("t"));
  if (!order) throw new HttpError(404, "not_found");
  const [r] = await query<{ r: string }>("select public.px_cancel_order($1, $2) as r", [id, order.user_id]);
  if (r?.r === "canceled") await expireCheckoutSession(order.stripe_checkout_session_id);
  return json({ status: r?.r }, { cache: "no-store" });
});
