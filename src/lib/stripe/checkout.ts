import "server-only";
import { env, siteUrl, stripeMockEnabled } from "@/lib/env";
import { query, queryOne } from "@/lib/db/pool";
import { stripe } from "./client";

export interface OrderForCheckout {
  id: string;
  parcel_id: string;
  user_id: string;
  x: number; y: number; w: number; h: number; area: number;
  amount_cents: number;
  currency: string;
  expires_at: Date;
}

/**
 * Creates the Stripe Checkout Session for an order whose price was computed in PostgreSQL.
 * Payment methods are managed in the Stripe Dashboard (enable cards and wallets). If an asynchronous method is
 * ever enabled, completion events keep the reservation alive (see px_extend_reservation).
 */
export async function createCheckoutSession(order: OrderForCheckout, email: string | null, locale: string): Promise<{ id: string; url: string }> {
  if (stripeMockEnabled()) {
    const id = `cs_mock_${order.id}`;
    await query("select public.px_attach_checkout_session($1, $2)", [order.id, id]);
    // relative on purpose: works behind any host (localhost, Codespaces, a tunnel)
    return { id, url: `/dev/checkout/${order.id}` };
  }
  const desc = `${order.w}×${order.h} px parcel at (${order.x}, ${order.y})`;
  const nowS = Math.floor(Date.now() / 1000);
  const expiresAt = Math.max(nowS + 30 * 60 + 15, Math.floor(order.expires_at.getTime() / 1000) - 90);
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: order.id,
      customer_email: email ?? undefined,
      locale: locale === "fr" ? "fr" : "en",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: order.currency,
            unit_amount: order.amount_cents,
            product_data: { name: `Pixel World — ${order.area.toLocaleString("en")} pixels`, description: desc },
          },
        },
      ],
      metadata: { order_id: order.id, parcel_id: order.parcel_id, user_id: order.user_id },
      payment_intent_data: { description: `Pixel World — ${desc}`, metadata: { order_id: order.id, parcel_id: order.parcel_id } },
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      automatic_tax: { enabled: env().STRIPE_AUTOMATIC_TAX === "true" },
      ...(env().STRIPE_INVOICE_CREATION === "true"
        ? { invoice_creation: { enabled: true, invoice_data: { description: `Pixel World — ${desc}`, metadata: { order_id: order.id } } } }
        : {}),
      expires_at: expiresAt,
      success_url: `${siteUrl()}/${locale}/checkout/success?order=${order.id}`,
      cancel_url: `${siteUrl()}/${locale}/checkout/cancel?order=${order.id}`,
    },
    { idempotencyKey: `checkout_${order.id}` },
  );
  if (!session.url) throw new Error("Stripe returned a Checkout Session without a URL");
  await query("select public.px_attach_checkout_session($1, $2)", [order.id, session.id]);
  return { id: session.id, url: session.url };
}

/** Best-effort: close a Checkout Session so a buyer can't pay for pixels we have already released. */
export async function expireCheckoutSession(sessionId: string | null): Promise<void> {
  if (!sessionId || sessionId.startsWith("cs_mock_") || !env().STRIPE_SECRET_KEY) return;
  try {
    await stripe().checkout.sessions.expire(sessionId);
  } catch (e) {
    // already expired / completed: nothing to do
    console.warn("could not expire checkout session", sessionId, (e as Error).message);
  }
}

export async function orderForUser(orderId: string, userId: string) {
  return queryOne<{ id: string; status: string; parcel_id: string; amount_cents: number; stripe_checkout_session_id: string | null; expires_at: Date }>(
    "select id, status, parcel_id, amount_cents, stripe_checkout_session_id, expires_at from public.orders where id = $1 and user_id = $2",
    [orderId, userId],
  );
}
