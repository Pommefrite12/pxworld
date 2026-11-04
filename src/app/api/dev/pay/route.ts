import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { requireViewer } from "@/lib/auth/session";
import { stripeMockEnabled } from "@/lib/env";
import { queryOne } from "@/lib/db/pool";
import { handleStripeEvent } from "@/lib/stripe/events";
import { route } from "@/lib/http/route";

/**
 * DEVELOPMENT ONLY (STRIPE_MOCK=true, never in production, never next to a real key).
 * Simulates the Stripe webhook for the buyer's own pending order by feeding a synthetic
 * `checkout.session.completed` event to the SAME handler the real webhook uses.
 */
export const POST = route(async (req) => {
  if (!stripeMockEnabled()) return new Response("Not found", { status: 404 });
  const viewer = await requireViewer();
  const { orderId, outcome } = (await req.json().catch(() => ({}))) as { orderId?: string; outcome?: "paid" | "expired" };
  const o = await queryOne<{ id: string; amount_cents: number; currency: string; stripe_checkout_session_id: string }>(
    "select id, amount_cents, currency, stripe_checkout_session_id from public.orders where id = $1 and user_id = $2 and status = 'pending'",
    [orderId, viewer.user.id],
  );
  // …or the share of a group project
  const k = o ? null : await queryOne<{ id: string; amount_cents: number; currency: string; stripe_checkout_session_id: string }>(
    "select id, amount_cents, currency, stripe_checkout_session_id from public.contributions where id = $1 and user_id = $2 and status = 'pending'",
    [orderId, viewer.user.id],
  );
  const target = o ?? k;
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const base = { id: target.stripe_checkout_session_id, metadata: k ? { contribution_id: k.id } : { order_id: target.id }, client_reference_id: target.id };
  const event = {
    id: `evt_mock_${target.id}_${outcome ?? "paid"}`,
    type: outcome === "expired" ? "checkout.session.expired" : "checkout.session.completed",
    data: {
      object: outcome === "expired" ? base : {
        ...base, payment_status: "paid", payment_intent: `pi_mock_${target.id}`, amount_subtotal: target.amount_cents, amount_total: target.amount_cents,
        total_details: { amount_tax: 0 }, currency: target.currency, customer_details: { email: viewer.user.email, name: viewer.profile.username, address: { country: "FR" }, tax_ids: [] },
      },
    },
  } as unknown as Stripe.Event;
  return NextResponse.json({ outcome: await handleStripeEvent(event) });
});
