import { requireActiveViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { invalidatePublicStats } from "@/lib/data/map";
import { refundDueContributions } from "@/lib/stripe/contributions";
import { expireCheckoutSession } from "@/lib/stripe/checkout";

/** The creator withdraws their project (waiting for moderation, or open): an open one releases its zone at once. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "px_not_found");
  const viewer = await requireActiveViewer();
  // the payments in progress are over too: close their payment pages so nobody pays for a project that no longer exists
  const sessions = await query<{ s: string | null }>("select stripe_checkout_session_id as s from public.contributions where campaign_id = $1 and status = 'pending'", [id]);
  await query("select public.px_cancel_campaign($1, $2)", [viewer.user.id, id]);
  for (const x of sessions) await expireCheckoutSession(x.s);
  // everybody who had paid is refunded now; whatever fails is retried by the maintenance job
  await refundDueContributions().catch((e) => console.error("refunds after cancellation failed", (e as Error).message));
  invalidatePublicStats();
  return json({ ok: true }, { cache: "no-store" });
});
