import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe/client";
import { handleStripeEvent } from "@/lib/stripe/events";

export const maxDuration = 30;

/**
 * Stripe → Pixel World. The ONLY place where payments become parcels (together with the reconciliation job,
 * which fetches sessions from Stripe's API). The signature is verified against the RAW body.
 */
export async function POST(req: Request) {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret) return new Response("webhook not configured", { status: 503 });
  if (!signature) return new Response("missing signature", { status: 400 });
  const body = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }
  try {
    const outcome = await handleStripeEvent(event);
    return Response.json({ received: true, outcome });
  } catch (e) {
    console.error("stripe webhook processing failed", event.id, event.type, (e as Error).message);
    return new Response("processing failed", { status: 500 }); // Stripe will retry
  }
}
