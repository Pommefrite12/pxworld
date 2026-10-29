import { requireActiveViewer } from "@/lib/auth/session";
import { queryOne } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";

async function parcelId(code: unknown) {
  if (typeof code !== "string") throw new HttpError(400, "invalid_request");
  const p = await queryOne<{ id: string }>("select id from public.parcels where code = $1 and status = 'active' and hidden_at is null", [code]);
  if (!p) throw new HttpError(404, "not_found");
  return p.id;
}

const count = async (id: string) => (await queryOne<{ n: number }>("select count(*)::int as n from public.parcel_likes where parcel_id = $1", [id]))?.n ?? 0;

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const v = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.like, v.user.id);
  const id = await parcelId(((await req.json().catch(() => ({}))) as { code?: string }).code);
  await queryOne("insert into public.parcel_likes (user_id, parcel_id) values ($1, $2) on conflict do nothing", [v.user.id, id]);
  return json({ liked: true, likes: await count(id) }, { cache: "no-store" });
});

export const DELETE = route(async (req) => {
  assertSameOrigin(req);
  const v = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.like, v.user.id);
  const id = await parcelId(((await req.json().catch(() => ({}))) as { code?: string }).code);
  await queryOne("delete from public.parcel_likes where user_id = $1 and parcel_id = $2", [v.user.id, id]);
  return json({ liked: false, likes: await count(id) }, { cache: "no-store" });
});
