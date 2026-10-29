import { z } from "zod";
import { requireStaff } from "@/lib/auth/session";
import { query, queryOne } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { cleanText } from "@/lib/security/text";
import { stripe } from "@/lib/stripe/client";
import { env } from "@/lib/env";
import { invalidatePublicStats } from "@/lib/data/map";

const uuid = z.string().uuid();
const reason = z.string().max(500).optional();

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review_asset"), assetId: uuid, decision: z.enum(["approve", "reject"]), reason }),
  z.object({ action: z.literal("hide_parcel"), parcelId: uuid, hidden: z.boolean(), reason }),
  z.object({ action: z.literal("revoke_parcel"), parcelId: uuid, reason: z.string().min(3).max(500) }),
  z.object({ action: z.literal("suspend_user"), userId: uuid, suspended: z.boolean(), reason }),
  z.object({ action: z.literal("resolve_report"), reportId: uuid, resolution: z.enum(["actioned", "dismissed", "reviewing"]), note: reason }),
  z.object({ action: z.literal("feature_parcel"), parcelId: uuid, featured: z.boolean(), note: z.string().max(140).optional() }),
  z.object({ action: z.literal("set_setting"), key: z.string().max(60), value: z.union([z.number(), z.boolean()]) }),
  z.object({ action: z.literal("refund_order"), orderId: uuid, reason: z.string().min(3).max(300) }),
]);

/**
 * Every back-office mutation goes through here: same-origin, authenticated, role checked against admin_roles in the
 * database (twice: here and inside the SQL function), validated, and journalised by the SQL function in the same transaction.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "invalid_request");
  const a = parsed.data;
  const adminOnly = ["revoke_parcel", "suspend_user", "set_setting", "refund_order"].includes(a.action);
  const staff = await requireStaff(adminOnly ? "admin" : "moderator");
  const actor = staff.user.id;
  const clean = (s?: string) => (s ? cleanText(s, 500) : null);

  switch (a.action) {
    case "review_asset":
      await query("select public.px_review_asset($1, $2, $3, $4)", [actor, a.assetId, a.decision, clean(a.reason)]);
      break;
    case "hide_parcel":
      await query("select public.px_set_parcel_hidden($1, $2, $3, $4)", [actor, a.parcelId, a.hidden, clean(a.reason)]);
      break;
    case "revoke_parcel":
      await query("select public.px_revoke_parcel($1, $2, $3)", [actor, a.parcelId, clean(a.reason)]);
      break;
    case "suspend_user":
      await query("select public.px_set_user_suspended($1, $2, $3, $4)", [actor, a.userId, a.suspended, clean(a.reason)]);
      break;
    case "resolve_report":
      await query("select public.px_resolve_report($1, $2, $3, $4)", [actor, a.reportId, a.resolution, clean(a.note)]);
      break;
    case "feature_parcel":
      await query("select public.px_set_parcel_featured($1, $2, $3, $4)", [actor, a.parcelId, a.featured, clean(a.note)]);
      break;
    case "set_setting":
      await query("select public.px_set_setting($1, $2, $3::jsonb)", [actor, a.key, JSON.stringify(a.value)]);
      break;
    case "refund_order": {
      const o = await queryOne<{ stripe_payment_intent_id: string | null; status: string }>("select stripe_payment_intent_id, status from public.orders where id = $1", [a.orderId]);
      if (!o?.stripe_payment_intent_id || !["paid", "refund_required", "disputed"].includes(o.status)) throw new HttpError(409, "not_refundable");
      if (!env().STRIPE_SECRET_KEY) throw new HttpError(503, "payments_not_configured");
      await query("select public.px_audit_staff_refund($1, $2, $3)", [actor, a.orderId, clean(a.reason)]);
      // The refund is executed at Stripe; the verified `charge.refunded` webhook then closes the order and frees the pixels.
      await stripe().refunds.create({ payment_intent: o.stripe_payment_intent_id, reason: "requested_by_customer", metadata: { order_id: a.orderId, actor } }, { idempotencyKey: `staff_refund_${a.orderId}` });
      break;
    }
  }
  invalidatePublicStats();
  return json({ ok: true }, { cache: "no-store" });
});
