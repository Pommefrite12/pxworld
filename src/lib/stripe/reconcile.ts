import "server-only";
import { query } from "@/lib/db/pool";
import { env } from "@/lib/env";
import { stripe } from "./client";
import { expireCheckoutSession } from "./checkout";
import { fulfillSession, refundOrder } from "./events";

export interface MaintenanceReport {
  expiredReservations: number;
  recoveredPayments: number;
  closedSessions: number;
  refundsRetried: number;
}

/**
 * Recovery path for a delayed or lost webhook: ask Stripe (the source of truth) about checkout sessions that
 * are still pending locally. Never trusts the browser; only the session retrieved from Stripe's API.
 */
export async function reconcileOrder(orderId: string): Promise<"paid" | "expired" | "pending" | "skipped"> {
  if (!env().STRIPE_SECRET_KEY) return "skipped";
  const [o] = await query<{ stripe_checkout_session_id: string | null; status: string }>(
    "select stripe_checkout_session_id, status from public.orders where id = $1", [orderId],
  );
  if (!o?.stripe_checkout_session_id || o.status !== "pending") return o?.status === "paid" ? "paid" : "skipped";
  const session = await stripe().checkout.sessions.retrieve(o.stripe_checkout_session_id);
  if (session.status === "complete" && session.payment_status === "paid") {
    await fulfillSession(session);
    return "paid";
  }
  if (session.status === "expired") {
    await query("select public.px_cancel_order($1, null, 'expired')", [orderId]);
    return "expired";
  }
  return "pending";
}

/** Periodic job (Vercel Cron → /api/cron/maintenance). */
export async function runMaintenance(): Promise<MaintenanceReport> {
  const report: MaintenanceReport = { expiredReservations: 0, recoveredPayments: 0, closedSessions: 0, refundsRetried: 0 };

  // 1. Release lapsed reservations and close their checkout sessions.
  const expired = await query<{ order_id: string; stripe_checkout_session_id: string | null }>("select * from public.px_expire_reservations(500)");
  report.expiredReservations = expired.length;
  for (const e of expired) {
    await expireCheckoutSession(e.stripe_checkout_session_id);
    report.closedSessions++;
  }

  if (env().STRIPE_SECRET_KEY) {
    // 2. Pending orders whose webhook never arrived (older than 5 minutes, still within a day).
    const pending = await query<{ id: string }>(
      `select id from public.orders where status = 'pending' and stripe_checkout_session_id is not null
         and created_at < now() - interval '5 minutes' and created_at > now() - interval '1 day' order by created_at limit 50`,
    );
    for (const p of pending) {
      try {
        if ((await reconcileOrder(p.id)) === "paid") report.recoveredPayments++;
      } catch (e) {
        console.error("reconcile failed", p.id, (e as Error).message);
      }
    }
    // 3. Paid-but-unattributable orders whose automatic refund failed earlier.
    const toRefund = await query<{ id: string; stripe_payment_intent_id: string }>(
      `select o.id, o.stripe_payment_intent_id from public.orders o
        where o.status = 'refund_required' and o.stripe_payment_intent_id is not null limit 20`,
    );
    for (const o of toRefund) {
      try {
        await refundOrder(o.id, o.stripe_payment_intent_id, "retry");
        report.refundsRetried++;
      } catch { /* logged in audit_logs; retried on next run */ }
    }
  }
  return report;
}
