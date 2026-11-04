import { requireActiveViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { assertStoryAllowsSales } from "@/lib/doom/sales";
import { stripeConfigured } from "@/lib/stripe/client";
import { createContributionSession, type ContributionForCheckout } from "@/lib/stripe/contributions";

export const maxDuration = 30;

/**
 * Starts a contribution to an open group project: PostgreSQL checks the amount against what is still missing and holds that share
 * (`px_start_contribution`), then a Stripe Checkout Session is opened for it. The share only counts when the verified webhook says the
 * payment succeeded. The amount comes from the browser as a request, never as a price: it is validated, and refused, in the database.
 */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  assertStoryAllowsSales();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "px_not_found");
  const viewer = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.contribute, viewer.user.id);
  if (!stripeConfigured()) throw new HttpError(503, "payments_not_configured");
  const body = (await req.json().catch(() => null)) as { amountCents?: unknown; locale?: unknown } | null;
  const amount = typeof body?.amountCents === "number" && Number.isSafeInteger(body.amountCents) ? body.amountCents : null;
  if (amount === null) throw new HttpError(400, "px_invalid_amount");
  const locale = body?.locale === "fr" ? "fr" : "en";

  // the function FIRST, alone: joined with another table, the planner may decide it need not run it at all
  const [s] = await query<{ contribution_id: string; amount_cents: string; currency: string; expires_at: Date }>(
    "select contribution_id, amount_cents, currency, expires_at from public.px_start_contribution($1, $2, $3)",
    [viewer.user.id, id, amount],
  );
  if (!s) throw new HttpError(500, "contribution_not_created");
  const [camp] = await query<{ title: string; code: string }>("select title, code from public.campaigns where id = $1", [id]);
  const k: ContributionForCheckout = { id: s.contribution_id, campaign_id: id, user_id: viewer.user.id, amount_cents: Number(s.amount_cents), currency: s.currency, expires_at: s.expires_at, title: camp?.title ?? "", code: camp?.code ?? "" };
  try {
    const session = await createContributionSession(k, viewer.user.email, locale);
    return json({ contributionId: k.id, url: session.url, expiresAt: k.expires_at }, { cache: "no-store" });
  } catch (e) {
    // Anything failed after the share was held: give it back at once.
    await query("select public.px_cancel_contribution($1, $2)", [k.id, viewer.user.id]).catch(() => undefined);
    throw e;
  }
});
