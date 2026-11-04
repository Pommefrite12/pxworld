import { requireViewer } from "@/lib/auth/session";
import { query, queryOne } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { expireCheckoutSession } from "@/lib/stripe/checkout";
import { reconcileContribution } from "@/lib/stripe/contributions";

const mine = (id: string, userId: string) =>
  queryOne<{ id: string; status: string; stripe_checkout_session_id: string | null; code: string; campaign_status: string }>(
    `select k.id, k.status, k.stripe_checkout_session_id, c.code, c.status as campaign_status
       from public.contributions k join public.campaigns c on c.id = k.campaign_id where k.id = $1 and k.user_id = $2`, [id, userId]);

/** Status of a contribution, for the contributor. Informative only: the return from the payment page is never proof of payment. */
export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const viewer = await requireViewer();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "not_found");
  let k = await mine(id, viewer.user.id);
  if (!k) throw new HttpError(404, "not_found");
  if (k.status === "pending" && new URL(req.url).searchParams.get("reconcile") === "1") {
    await reconcileContribution(id).catch((e) => console.error("reconcile failed", (e as Error).message));
    k = (await mine(id, viewer.user.id)) ?? k;
  }
  return json({ id: k.id, status: k.status, projectCode: k.code, projectStatus: k.campaign_status }, { cache: "no-store" });
});

/** The contributor abandons the payment: the share they held is given back at once. */
export const DELETE = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireViewer();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "not_found");
  const k = await mine(id, viewer.user.id);
  if (!k) throw new HttpError(404, "not_found");
  const [r] = await query<{ r: string }>("select public.px_cancel_contribution($1, $2) as r", [id, viewer.user.id]);
  if (r?.r === "canceled") await expireCheckoutSession(k.stripe_checkout_session_id);
  return json({ status: r?.r }, { cache: "no-store" });
});
