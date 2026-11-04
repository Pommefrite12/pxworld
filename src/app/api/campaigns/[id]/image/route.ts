import { getViewer } from "@/lib/auth/session";
import { campaignAccess } from "@/lib/data/campaigns";
import { route } from "@/lib/http/route";
import { objectStore } from "@/lib/storage";

/**
 * The creation of a project, as its creator sent it. For now only the creator and the staff may see it (the moderators decide on it);
 * the public gets pictures of open projects with the list, in the next step. Never cached.
 */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const c = await campaignAccess(id);
  const v = await getViewer();
  if (!c || !v || (v.user.id !== c.creator_id && !v.staffRole)) return new Response("Not found", { status: 404 });
  const bytes = await objectStore().get(c.storage_path);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-store" },
  });
});
