import sharp from "sharp";
import { getViewer } from "@/lib/auth/session";
import { queryOne } from "@/lib/db/pool";
import { objectStore } from "@/lib/storage";
import { route } from "@/lib/http/route";
import { ASSET_SIZES } from "@/lib/images/sizes";

/**
 * The only way creations leave storage. Public requests get approved creations of visible parcels;
 * the owner and staff can also see pending/rejected versions (never cached).
 *
 * A creation can be large (up to 4 million dots), far more than any screen needs for a small thumbnail or a parcel seen
 * from afar: `?max=256` returns the image shrunk so that its longest side is at most 256 pixels (never enlarged).
 */
export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const maxParam = new URL(req.url).searchParams.get("max");
  const max = maxParam === null ? null : Number(maxParam);
  if (max !== null && !(ASSET_SIZES as readonly number[]).includes(max)) return new Response("Bad request", { status: 400 });
  const a = await queryOne<{ storage_path: string; status: string; uploader_id: string; parcel_active: boolean; hidden: boolean; width: number; height: number }>(
    `select a.storage_path, a.status, a.uploader_id, a.width, a.height, (p.status = 'active') as parcel_active, (p.hidden_at is not null) as hidden
       from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where a.id = $1`,
    [id],
  );
  if (!a) return new Response("Not found", { status: 404 });
  const isPublic = a.status === "approved" && a.parcel_active && !a.hidden;
  if (!isPublic) {
    const v = await getViewer();
    if (!v || (v.user.id !== a.uploader_id && !v.staffRole)) return new Response("Not found", { status: 404 });
  }
  let bytes = await objectStore().get(a.storage_path);
  if (!bytes) return new Response("Not found", { status: 404 });
  if (max !== null && Math.max(a.width, a.height) > max) {
    // area-averaged: a faithful smaller picture of the creation (nearest-neighbour would drop most of its dots)
    bytes = await sharp(bytes).resize({ width: max, height: max, fit: "inside", kernel: "lanczos3" }).png({ compressionLevel: 6 }).toBuffer();
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": isPublic ? "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" : "private, no-store",
    },
  });
});
