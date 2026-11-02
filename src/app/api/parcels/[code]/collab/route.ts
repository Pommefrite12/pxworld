import { requireActiveViewer } from "@/lib/auth/session";
import { ownerCollab, publishSnapshot } from "@/lib/collab";
import { getOwnedParcelByCode } from "@/lib/data/parcels";
import { query } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";

/**
 * The owner manages the drawing link of their parcel:
 *   enable   create the link (or switch it back on)       rotate   a NEW link; the old one stops working
 *   disable  switch it off; the drawing is kept           reset    wipe what the community drew
 *   publish  submit the community's drawing as a new version of the creation (moderated like any edit)
 */
export const POST = route(async (req, ctx: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.upload, viewer.user.id);
  const { code } = await ctx.params;
  const parcel = await getOwnedParcelByCode(viewer.user.id, code);
  if (!parcel) throw new HttpError(404, "not_found");
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const me = viewer.user.id;

  switch (action) {
    case "enable":
    case "rotate": {
      await query("select public.px_collab_enable($1, $2, $3)", [me, parcel.id, action === "rotate"]);
      break;
    }
    case "disable": await query("select public.px_collab_disable($1, $2)", [me, parcel.id]); break;
    case "reset": await query("select public.px_collab_reset($1, $2)", [me, parcel.id]); break;
    case "publish": {
      const asset = await publishSnapshot(me, parcel);
      return json({ assetId: asset.id, version: asset.version, status: "pending" }, { status: 201, cache: "no-store" });
    }
    default: throw new HttpError(400, "bad_action");
  }
  const state = await ownerCollab(parcel.id);
  return json({ enabled: state?.enabled ?? false, token: state?.token ?? null, pixels: state?.pixels ?? 0 }, { cache: "no-store" });
});
