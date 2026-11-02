import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/session";
import { stripeMockEnabled } from "@/lib/env";
import { queryOne } from "@/lib/db/pool";
import { handleStripeEvent } from "@/lib/stripe/events";
import { route } from "@/lib/http/route";
import { verifyOrderToken } from "@/lib/stripe/orderToken";

/**
 * DEVELOPMENT ONLY (STRIPE_MOCK=true, never in production, never next to a real key).
 * Simulates the Stripe webhook for the buyer's own pending order by feeding a synthetic
 * `checkout.session.completed` event to the SAME handler the real webhook uses.
 */
export const POST = route(async (req) => {
  if (!stripeMockEnabled()) return new Response("Not found", { status: 404 });
  const viewer = await getViewer();
  const { orderId, outcome, token } = (await req.json().catch(() => ({}))) as { orderId?: string; outcome?: "paid" | "expired"; token?: string };
  // the buyer's own order: signed in, or (no account) holding the order's signed link — as on the real return from Stripe
  const o = await queryOne<{ id: string; amount_cents: number; currency: string; stripe_checkout_session_id: string; email: string | null; username: string | null }>(
    `select o.id, o.amount_cents, o.currency, o.stripe_checkout_session_id, u.email, p.username
       from public.orders o join auth.users u on u.id = o.user_id join public.profiles p on p.id = o.user_id
      where o.id = $1 and o.status = 'pending' and ($2::uuid = o.user_id or $3::boolean)`,
    [orderId, viewer?.user.id ?? null, Boolean(orderId && verifyOrderToken(orderId, token))],
  );
  if (!o) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const base = { id: o.stripe_checkout_session_id, metadata: { order_id: o.id }, client_reference_id: o.id };
  const event = {
    id: `evt_mock_${o.id}_${outcome ?? "paid"}`,
    type: outcome === "expired" ? "checkout.session.expired" : "checkout.session.completed",
    data: {
      object: outcome === "expired" ? base : {
        ...base, payment_status: "paid", payment_intent: `pi_mock_${o.id}`, amount_subtotal: o.amount_cents, amount_total: o.amount_cents,
        total_details: { amount_tax: 0 }, currency: o.currency, customer_details: { email: o.email, name: o.username, address: { country: "FR" }, tax_ids: [] },
      },
    },
  } as unknown as Stripe.Event;
  return NextResponse.json({ outcome: await handleStripeEvent(event) });
});
