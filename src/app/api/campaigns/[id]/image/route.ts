import sharp from "sharp";
import { getViewer } from "@/lib/auth/session";
import { campaignAccess } from "@/lib/data/campaigns";
import { route } from "@/lib/http/route";
import { objectStore } from "@/lib/storage";
import { ASSET_SIZES } from "@/lib/images/sizes";
import { tintPixels } from "@/lib/images/waterTint";

/**
 * The creation of a project. A project that is open (collecting) or funded is public, shrunk on request like the creations of parcels
 * (`?max=`), and in three blues for the water. A project that is still waiting for moderation, refused or withdrawn is shown to its
 * creator and to the staff only, as they sent it (never cached). The creator and the staff get the original of a public project with `?raw=1`.
 */
export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const maxParam = url.searchParams.get("max");
  const max = maxParam === null ? null : Number(maxParam);
  if (max !== null && !(ASSET_SIZES as readonly number[]).includes(max)) return new Response("Bad request", { status: 400 });
  const c = await campaignAccess(id);
  if (!c) return new Response("Not found", { status: 404 });
  const isPublic = c.status === "open" || c.status === "funded";
  let privileged = false;
  if (!isPublic || url.searchParams.get("raw") === "1") {
    const v = await getViewer();
    privileged = Boolean(v && (v.user.id === c.creator_id || v.staffRole));
    if (!isPublic && !privileged) return new Response("Not found", { status: 404 });
  }
  const original = privileged && (url.searchParams.get("raw") === "1" || !isPublic);
  let bytes = await objectStore().get(c.storage_path);
  if (!bytes) return new Response("Not found", { status: 404 });
  const tint = c.kind === "water" && !original;
  const shrink = max !== null && Math.max(c.width, c.height) > max;
  if (tint || shrink) {
    let img = sharp(bytes);
    if (tint) {
      const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      tintPixels(data, 4);
      img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
    }
    if (shrink) img = img.resize({ width: max!, height: max!, fit: "inside", kernel: "lanczos3" });
    bytes = await img.png({ compressionLevel: 6 }).toBuffer();
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": isPublic && !original ? "public, max-age=300, s-maxage=600, stale-while-revalidate=3600" : "private, no-store",
    },
  });
});
