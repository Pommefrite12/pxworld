import "server-only";
import { stripeLocale } from "@/lib/stripe/locale";
import type Stripe from "stripe";
import { env, siteUrl, stripeMockEnabled } from "@/lib/env";
import { query, queryOne } from "@/lib/db/pool";
import { raiseAlert } from "@/lib/alerts";
import { invalidatePublicStats } from "@/lib/data/map";
import { stripe } from "./client";

/**
 * Contributions to a group project ("Fund it together"). Each one is a payment of its own, in the project's currency; the amount was
 * checked and held in PostgreSQL (`px_start_contribution`) before anything reaches Stripe. Like for an order, nothing counts until the
 * VERIFIED webhook (or the reconciliation, which asks Stripe) tells `px_fulfill_contribution` that the payment succeeded.
 */
export interface ContributionForCheckout {
  id: string;
  campaign_id: string;
  user_id: string;
  amount_cents: number;
  currency: string;
  expires_at: Date;
  title: string;
  code: string;
}

export async function createContributionSession(k: ContributionForCheckout, email: string | null, locale: string): Promise<{ id: string; url: string }> {
  if (stripeMockEnabled()) {
    const id = `cs_mock_${k.id}`;
    await query("select public.px_attach_contribution_session($1, $2)", [k.id, id]);
    return { id, url: `/dev/checkout/${k.id}` }; // relative on purpose: works behind any host
  }
  const nowS = Math.floor(Date.now() / 1000);
  const expiresAt = Math.max(nowS + 30 * 60 + 15, Math.floor(k.expires_at.getTime() / 1000) - 90);
  const desc = `Pixel World — group project “${k.title}”`;
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: k.id,
      customer_email: email ?? undefined,
      locale: stripeLocale(locale),
      line_items: [{ quantity: 1, price_data: { currency: k.currency, unit_amount: k.amount_cents, product_data: { name: desc } } }],
      metadata: { contribution_id: k.id, campaign_id: k.campaign_id, user_id: k.user_id },
      payment_intent_data: { description: desc, metadata: { contribution_id: k.id, campaign_id: k.campaign_id } },
      billing_address_collection: "required",
      automatic_tax: { enabled: env().STRIPE_AUTOMATIC_TAX === "true" },
      expires_at: expiresAt,
      success_url: `${siteUrl()}/${locale}/checkout/success?contribution=${k.id}`,
      cancel_url: `${siteUrl()}/${locale}/checkout/cancel?contribution=${k.id}`,
    },
    { idempotencyKey: `contribution_${k.id}` },
  );
  if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
  await query("select public.px_attach_contribution_session($1, $2)", [k.id, session.id]);
  return { id: session.id, url: session.url };
}

/** A PAID checkout session of a contribution: give the share its place (and the parcel to the creator if it completes the goal). */
export async function fulfillContributionSession(session: Stripe.Checkout.Session): Promise<string> {
  const id = session.metadata?.contribution_id ?? session.client_reference_id;
  if (!id) throw new Error(`checkout session ${session.id} carries no contribution id`);
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const row = await queryOne<{ outcome: string }>(
    "select public.px_fulfill_contribution($1, $2, $3, $4, $5, $6, $7, $8, $9) as outcome",
    [
      id, session.id, pi, session.amount_subtotal ?? null, session.total_details?.amount_tax ?? 0, session.amount_total ?? session.amount_subtotal ?? null,
      session.currency ?? "eur", session.customer_details?.email ?? session.customer_email ?? null, session.customer_details?.address?.country ?? null,
    ],
  );
  const outcome = row?.outcome ?? "unknown";
  if (outcome === "refund_required") {
    await raiseAlert("contribution-refund-required", { contribution: id, refund: pi ? "automatic" : "none (no payment intent)" });
    if (pi) await refundContribution(id, pi, "not_placed");
  }
  if (outcome === "funded") invalidatePublicStats(); // the map shows a new parcel
  return outcome;
}

/**
 * Money received that must go back (the project ended unfunded, a payment that came too late, a wrong amount): refund it, automatically
 * and idempotently. In the simulated mode the refund is confirmed on the spot, as Stripe's webhook would do.
 */
export async function refundContribution(id: string, paymentIntent: string, reason: string): Promise<void> {
  if (stripeMockEnabled() || paymentIntent.startsWith("pi_mock_")) {
    const k = await queryOne<{ total: string }>("select coalesce(amount_total_cents, amount_cents) as total from public.contributions where id = $1", [id]);
    if (k) await query("select public.px_record_contribution_refund($1, $2)", [paymentIntent, Number(k.total)]);
    return;
  }
  if (!env().STRIPE_SECRET_KEY) return;
  try {
    await stripe().refunds.create(
      { payment_intent: paymentIntent, reason: "requested_by_customer", metadata: { contribution_id: id, cause: reason } },
      { idempotencyKey: `auto_refund_contribution_${id}` },
    );
    await query(
      `insert into public.audit_logs (actor_role, action, target_type, target_id, metadata) values ('system', 'contribution.auto_refund_issued', 'contribution', $1, $2::jsonb)`,
      [id, JSON.stringify({ reason })],
    );
  } catch (e) {
    await raiseAlert("contribution-refund-failed", { contribution: id, reason, error: (e as Error).message }); // money to give back, and the refund failed
    await query(
      `insert into public.audit_logs (actor_role, action, target_type, target_id, metadata) values ('system', 'contribution.auto_refund_failed', 'contribution', $1, $2::jsonb)`,
      [id, JSON.stringify({ reason, error: String((e as Error).message).slice(0, 300) })],
    );
    throw e;
  }
}

/** Every contribution waiting for its refund (a project ended, a late payment…). Retried by the maintenance job until Stripe confirms. */
export async function refundDueContributions(limit = 40): Promise<number> {
  if (!stripeMockEnabled() && !env().STRIPE_SECRET_KEY) return 0;
  const due = await query<{ id: string; stripe_payment_intent_id: string }>(
    `select id, stripe_payment_intent_id from public.contributions where status = 'refund_required' and stripe_payment_intent_id is not null order by created_at limit ${limit}`,
  );
  let done = 0;
  for (const k of due) {
    try { await refundContribution(k.id, k.stripe_payment_intent_id, "project_ended"); done++; } catch { /* alert and audit line written; retried on the next run */ }
  }
  return done;
}

/** A delayed or lost webhook: ask Stripe (the source of truth) about a contribution that is still pending here. */
export async function reconcileContribution(id: string): Promise<"paid" | "expired" | "pending" | "skipped"> {
  if (!env().STRIPE_SECRET_KEY) return "skipped";
  const k = await queryOne<{ stripe_checkout_session_id: string | null; status: string }>("select stripe_checkout_session_id, status from public.contributions where id = $1", [id]);
  if (!k?.stripe_checkout_session_id || k.status !== "pending") return k?.status === "paid" ? "paid" : "skipped";
  const session = await stripe().checkout.sessions.retrieve(k.stripe_checkout_session_id);
  if (session.status === "complete" && session.payment_status === "paid") {
    await fulfillContributionSession(session);
    invalidatePublicStats();
    return "paid";
  }
  if (session.status === "expired") {
    await query("select public.px_cancel_contribution($1, null, 'expired')", [id]);
    return "expired";
  }
  return "pending";
}
