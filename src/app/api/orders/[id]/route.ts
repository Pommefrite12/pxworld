import { requireViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { orderForUser, expireCheckoutSession } from "@/lib/stripe/checkout";
import { reconcileOrder } from "@/lib/stripe/reconcile";

/**
 * Order status for the buyer. NOTE: this is informative — the return from Stripe is never proof of payment.
 * With ?reconcile=1 the server asks Stripe's API directly (recovery when the webhook is late).
 */
export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const viewer = await requireViewer();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "not_found");
  let order = await orderForUser(id, viewer.user.id);
  if (!order) throw new HttpError(404, "not_found");
  if (order.status === "pending" && new URL(req.url).searchParams.get("reconcile") === "1") {
    await reconcileOrder(id).catch((e) => console.error("reconcile failed", (e as Error).message));
    order = (await orderForUser(id, viewer.user.id)) ?? order;
  }
  const [parcel] = await query<{ code: string }>("select code from public.parcels where id = $1", [order.parcel_id]);
  return json({ id: order.id, status: order.status, parcelCode: order.status === "paid" ? parcel?.code : null }, { cache: "no-store" });
});

/** The buyer abandons the checkout: free the pixels at once. */
export const DELETE = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireViewer();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "not_found");
  const order = await orderForUser(id, viewer.user.id);
  if (!order) throw new HttpError(404, "not_found");
  const [r] = await query<{ r: string }>("select public.px_cancel_order($1, $2) as r", [id, viewer.user.id]);
  if (r?.r === "canceled") await expireCheckoutSession(order.stripe_checkout_session_id);
  return json({ status: r?.r }, { cache: "no-store" });
});
