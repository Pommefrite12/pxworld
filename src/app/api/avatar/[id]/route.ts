import { queryOne } from "@/lib/db/pool";
import { route } from "@/lib/http/route";
import { objectStore } from "@/lib/storage";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const p = await queryOne<{ avatar_path: string | null }>("select avatar_path from public.profiles where id = $1 and status = 'active' and deleted_at is null", [id]);
  if (!p?.avatar_path) return new Response("Not found", { status: 404 });
  const bytes = await objectStore().get(p.avatar_path);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300, s-maxage=3600" },
  });
});
