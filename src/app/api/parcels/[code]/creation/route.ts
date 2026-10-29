import { requireActiveViewer } from "@/lib/auth/session";
import { getOwnedParcelByCode } from "@/lib/data/parcels";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { parseCreationMeta, readCreationImage, storeCreation } from "@/lib/creations";

/** The owner submits a new version of their creation. It stays pending until a moderator approves it;
 *  the previously approved version remains displayed in the meantime. */
export const POST = route(async (req, ctx: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const viewer = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.upload, viewer.user.id);
  const { code } = await ctx.params;
  const parcel = await getOwnedParcelByCode(viewer.user.id, code);
  if (!parcel) throw new HttpError(404, "not_found");
  if (Number(req.headers.get("content-length") ?? 0) > 3 * 1024 * 1024) throw new HttpError(413, "too_large");
  const form = await req.formData();
  const meta = parseCreationMeta(form);
  const img = await readCreationImage(form, { w: parcel.w, h: parcel.h });
  const asset = await storeCreation(viewer.user.id, parcel.id, img, meta);
  return json({ assetId: asset.id, version: asset.version, status: "pending" }, { status: 201, cache: "no-store" });
});
