import "server-only";
import Stripe from "stripe";
import { env, stripeMockEnabled } from "@/lib/env";

let client: Stripe | undefined;

/**
 * Stripe client. Live keys are refused unless the operator has explicitly opted in with
 * PAYMENTS_LIVE_ENABLED=yes-i-have-approval — real payments must never start by accident.
 */
export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set (use a test key: sk_test_…)");
  if (key.startsWith("sk_live_") && process.env.PAYMENTS_LIVE_ENABLED !== "yes-i-have-approval") {
    throw new Error("Refusing to use a LIVE Stripe key: set PAYMENTS_LIVE_ENABLED=yes-i-have-approval once live payments are explicitly approved.");
  }
  return (client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "Pixel World" } }));
}

export const stripeConfigured = () => Boolean(env().STRIPE_SECRET_KEY) || stripeMockEnabled();
