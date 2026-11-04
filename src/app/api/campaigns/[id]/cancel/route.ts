import { requireActiveViewer } from "@/lib/auth/session";
import { query } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { invalidatePublicStats } from "@/lib/data/map";

/** The creator withdraws their project (waiting for moderation, or open): an open one releases its zone at once. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "px_not_found");
  const viewer = await requireActiveViewer();
  await query("select public.px_cancel_campaign($1, $2)", [viewer.user.id, id]);
  invalidatePublicStats();
  return json({ ok: true }, { cache: "no-store" });
});
