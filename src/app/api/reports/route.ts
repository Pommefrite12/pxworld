import { requireViewer } from "@/lib/auth/session";
import { query, queryOne } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { LIMITS, enforceRateLimit, ipHash } from "@/lib/rate-limit";
import { cleanText } from "@/lib/security/text";

const REASONS = ["copyright", "hate", "sexual", "scam", "illegal_ad", "violence", "other"] as const;

/**
 * Report a creation. The evidence — exactly what was displayed (asset version, content hash, texts, link, owner) —
 * is snapshotted at report time so it can be handled even if the owner later edits or removes the content.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const viewer = await requireViewer();
  await enforceRateLimit(req, LIMITS.report, viewer.user.id);
  const body = (await req.json().catch(() => null)) as { code?: string; reason?: string; details?: string } | null;
  if (!body || typeof body.code !== "string" || !REASONS.includes(body.reason as (typeof REASONS)[number])) throw new HttpError(400, "invalid_report");
  const target = await queryOne<{ id: string; owner_id: string; asset_id: string | null; hash: string | null; title: string | null; description: string | null; link_url: string | null; x: number; y: number; w: number; h: number }>(
    `select p.id, p.owner_id, a.id as asset_id, a.content_hash as hash, a.title, a.description, a.link_url, p.x, p.y, p.w, p.h
       from public.parcels p left join public.parcel_assets a on a.id = p.published_asset_id
      where p.code = $1 and p.status = 'active'`,
    [body.code],
  );
  if (!target) throw new HttpError(404, "not_found");
  const dup = await queryOne("select 1 from public.moderation_reports where reporter_id = $1 and parcel_id = $2 and status in ('open','reviewing')", [viewer.user.id, target.id]);
  if (dup) return json({ ok: true, duplicate: true }, { cache: "no-store" });
  const evidence = {
    captured_at: new Date().toISOString(), parcel: { x: target.x, y: target.y, w: target.w, h: target.h }, owner_id: target.owner_id,
    asset_id: target.asset_id, content_hash: target.hash, title: target.title, description: target.description, link_url: target.link_url,
  };
  await query(
    `insert into public.moderation_reports (reporter_id, parcel_id, asset_id, reason, details, evidence, reporter_ip_hash) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [viewer.user.id, target.id, target.asset_id, body.reason, cleanText(body.details, 1000), JSON.stringify(evidence), ipHash(req)],
  );
  return json({ ok: true }, { status: 201, cache: "no-store" });
});
