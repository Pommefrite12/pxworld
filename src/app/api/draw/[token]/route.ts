import { collabDelta, openCollab } from "@/lib/collab";
import { CREATION_SCALE } from "@/lib/grid/constants";
import { HttpError, json } from "@/lib/http/errors";
import { intParam, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";

/**
 * State of a shared parcel for the people drawing on it: its size, the approved creation underneath, and the pixels
 * painted since version `?since=` (0 = everything). The link is the capability; an unknown, switched-off or hidden
 * parcel is a plain 404, so the response never says which of those it was.
 */
export const GET = route(async (req, ctx: { params: Promise<{ token: string }> }) => {
  await enforceRateLimit(req, LIMITS.drawRead);
  const { token } = await ctx.params;
  const info = await openCollab(token);
  if (!info) throw new HttpError(404, "collab_closed");
  const since = intParam(new URL(req.url).searchParams.get("since") ?? "0", 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const delta = await collabDelta(info, since);
  return json(
    { w: info.w, h: info.h, scale: CREATION_SCALE, baseAssetId: info.baseAssetId, title: info.title, owner: info.owner, ...delta },
    { cache: "no-store" },
  );
});
