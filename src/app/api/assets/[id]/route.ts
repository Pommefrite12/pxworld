import { getViewer } from "@/lib/auth/session";
import { queryOne } from "@/lib/db/pool";
import { objectStore } from "@/lib/storage";
import { route } from "@/lib/http/route";

/**
 * The only way creations leave storage. Public requests get approved creations of visible parcels;
 * the owner and staff can also see pending/rejected versions (never cached).
 */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const a = await queryOne<{ storage_path: string; status: string; uploader_id: string; parcel_active: boolean; hidden: boolean }>(
    `select a.storage_path, a.status, a.uploader_id, (p.status = 'active') as parcel_active, (p.hidden_at is not null) as hidden
       from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where a.id = $1`,
    [id],
  );
  if (!a) return new Response("Not found", { status: 404 });
  const isPublic = a.status === "approved" && a.parcel_active && !a.hidden;
  if (!isPublic) {
    const v = await getViewer();
    if (!v || (v.user.id !== a.uploader_id && !v.staffRole)) return new Response("Not found", { status: 404 });
  }
  const bytes = await objectStore().get(a.storage_path);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": isPublic ? "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" : "private, no-store",
    },
  });
});
