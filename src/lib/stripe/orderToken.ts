import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env, isProduction } from "@/lib/env";

/**
 * A buyer without an account has no session, yet must be able to follow (and, if they walk away, cancel) THEIR order
 * when Stripe sends them back. The return URLs we give Stripe carry this token: an HMAC of the order id, so it cannot be
 * guessed or reused for another order. It only grants the order's status and cancellation, nothing else — managing the
 * parcel afterwards requires signing in through the e-mail link.
 */
function secret(): string {
  const e = env();
  const s = e.ORDER_TOKEN_SECRET ?? e.SUPABASE_SERVICE_ROLE_KEY ?? e.STRIPE_SECRET_KEY;
  if (s) return s;
  if (isProduction()) throw new Error("ORDER_TOKEN_SECRET (or a Supabase service-role / Stripe secret key) is required in production");
  return e.DEV_AUTH_SECRET;
}

export function orderToken(orderId: string): string {
  return createHmac("sha256", secret()).update(`order:${orderId}`).digest("hex").slice(0, 32);
}

export function verifyOrderToken(orderId: string, token: string | null | undefined): boolean {
  if (!token || !/^[0-9a-f]{32}$/.test(token)) return false;
  const a = Buffer.from(token), b = Buffer.from(orderToken(orderId));
  return a.length === b.length && timingSafeEqual(a, b);
}
