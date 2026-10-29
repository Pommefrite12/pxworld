import "server-only";
import type Stripe from "stripe";
import { query, queryOne } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { stripe } from "./client";

export type EventOutcome = "processed" | "duplicate" | "ignored";

/**
 * Entry point for every Stripe event (after signature verification, or from reconciliation).
 *
 * Idempotency: the event id is the primary key of public.stripe_events. A replay of an event that was
 * fully processed is a no-op; one that crashed halfway is retried. Each business effect is ALSO idempotent
 * in SQL (px_fulfill_order, px_record_refund…), so concurrent duplicate deliveries cannot double-attribute.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<EventOutcome> {
  const claimed = await queryOne<{ status: string; inserted: boolean }>(
    `insert into public.stripe_events (id, type, payload) values ($1, $2, $3::jsonb)
     on conflict (id) do update set attempts = public.stripe_events.attempts + 1
       where public.stripe_events.status in ('failed', 'processing')
     returning status, (xmax = 0) as inserted`,
    [event.id, event.type, JSON.stringify(event)],
  );
  if (!claimed) return "duplicate"; // already processed or ignored

  try {
    const outcome = await dispatch(event);
    await query("update public.stripe_events set status = $2, processed_at = now(), error = null where id = $1", [
      event.id,
      outcome === "ignored" ? "ignored" : "processed",
    ]);
    return outcome;
  } catch (e) {
    await query("update public.stripe_events set status = 'failed', error = $2 where id = $1", [event.id, String((e as Error).message).slice(0, 500)]);
    throw e; // non-2xx → Stripe retries with backoff
  }
}

async function dispatch(event: Stripe.Event): Promise<EventOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") {
        // Asynchronous method still processing: keep the pixels held until Stripe reports the final outcome.
        const orderId = session.metadata?.order_id ?? session.client_reference_id;
        if (orderId && session.payment_status === "unpaid") await query("select public.px_extend_reservation($1, 120)", [orderId]);
        return "ignored";
      }
      await fulfillSession(session);
      return "processed";
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id ?? session.client_reference_id;
      if (orderId) await query("select public.px_cancel_order($1, null, 'expired')", [orderId]);
      return "processed";
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const err = pi.last_payment_error;
      await query("select public.px_record_payment_failure($1, $2, $3, $4, $5, $6)", [
        pi.id, pi.metadata?.order_id ?? null, pi.amount, pi.currency, err?.code ?? err?.decline_code ?? null, err?.message ?? null,
      ]);
      return "processed";
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!pi) return "ignored";
      await query("select public.px_record_refund($1, $2)", [pi, charge.amount_refunded]);
      return "processed";
    }
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      const d = event.data.object as Stripe.Dispute;
      const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id;
      if (!pi) return "ignored";
      const outcome = event.type === "charge.dispute.created" ? "opened" : d.status === "won" ? "won" : d.status === "lost" ? "lost" : null;
      if (!outcome) return "ignored";
      await query("select public.px_record_dispute($1, $2)", [pi, outcome]);
      return "processed";
    }
    default:
      return "ignored";
  }
}

/** Attribute the parcel for a PAID checkout session. Safe to call repeatedly. */
export async function fulfillSession(session: Stripe.Checkout.Session): Promise<string> {
  const orderId = session.metadata?.order_id ?? session.client_reference_id;
  if (!orderId) throw new Error(`checkout session ${session.id} carries no order id`);
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const taxIds = session.customer_details?.tax_ids ?? [];
  const row = await queryOne<{ outcome: string }>(
    "select public.px_fulfill_order($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) as outcome",
    [
      orderId, session.id, pi,
      session.amount_subtotal ?? null, session.total_details?.amount_tax ?? 0, session.amount_total ?? session.amount_subtotal ?? null,
      session.currency ?? "eur",
      session.customer_details?.email ?? session.customer_email ?? null,
      session.customer_details?.address?.country ?? null,
      session.customer_details?.name ?? null,
      JSON.stringify(taxIds),
    ],
  );
  const outcome = row?.outcome ?? "unknown";
  if (outcome === "refund_required" && pi) await refundOrder(orderId, pi, "pixels_unavailable");
  return outcome;
}

/** Money received for pixels we could not attribute → give it back, automatically and idempotently. */
export async function refundOrder(orderId: string, paymentIntent: string, reason: string): Promise<void> {
  if (!env().STRIPE_SECRET_KEY || paymentIntent.startsWith("pi_mock_")) return;
  try {
    await stripe().refunds.create(
      { payment_intent: paymentIntent, reason: "requested_by_customer", metadata: { order_id: orderId, cause: reason } },
      { idempotencyKey: `auto_refund_${orderId}` },
    );
    await query(
      `insert into public.audit_logs (actor_role, action, target_type, target_id, metadata) values ('system', 'order.auto_refund_issued', 'order', $1, $2::jsonb)`,
      [orderId, JSON.stringify({ reason })],
    );
  } catch (e) {
    await query(
      `insert into public.audit_logs (actor_role, action, target_type, target_id, metadata) values ('system', 'order.auto_refund_failed', 'order', $1, $2::jsonb)`,
      [orderId, JSON.stringify({ reason, error: String((e as Error).message).slice(0, 300) })],
    );
    throw e;
  }
}

