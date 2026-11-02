import { z } from "zod";
import { getViewer, requireActiveViewer, requireViewer } from "@/lib/auth/session";
import { query, queryOne } from "@/lib/db/pool";
import { HttpError, json } from "@/lib/http/errors";
import { assertSameOrigin, route } from "@/lib/http/route";
import { COMMENT_MAX } from "@/lib/comments";
import { isParcelCode } from "@/lib/grid/code";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { cleanText } from "@/lib/security/text";

/**
 * Comments under a parcel. Reading is public; writing needs an account. A comment is plain text (never HTML), 1–500
 * characters, never edited, only removed — by its author, the owner of the parcel, or a moderator.
 */
const PAGE = 20;

const uuid = z.string().uuid();
// keyset cursor "<timestamp>|<id>": comments are listed newest first, and new ones arriving never shift a page
const cursorRe = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}(?::?\d{2})?)?)\|([0-9a-f-]{36})$/;

interface Row { id: string; body: string; created_at: Date; ts: string; author_id: string; username: string; avatar: boolean }

/** The parcel a comment area belongs to: active and visible, like the public card. */
async function commentable(code: unknown) {
  if (!isParcelCode(code)) throw new HttpError(400, "invalid_request");
  const p = await queryOne<{ id: string; owner_id: string }>("select id, owner_id from public.parcels where code = $1 and status = 'active' and hidden_at is null", [code]);
  if (!p) throw new HttpError(404, "not_found");
  return p;
}

const present = (r: Row, canRemove: boolean) => ({
  id: r.id, body: r.body, createdAt: r.created_at.toISOString(),
  author: { username: r.username, avatarId: r.avatar ? r.author_id : null }, canRemove,
});

const SELECT = `select c.id, c.body, c.created_at, c.created_at::text as ts, c.author_id, u.username, u.avatar_path is not null as avatar
                  from public.parcel_comments c join public.profiles u on u.id = c.author_id`;
const VISIBLE = `c.status = 'visible' and u.status = 'active' and u.deleted_at is null`;

export const GET = route(async (req) => {
  await enforceRateLimit(req, LIMITS.commentRead);
  const url = new URL(req.url);
  const parcel = await commentable(url.searchParams.get("code"));
  const raw = url.searchParams.get("before");
  const m = raw ? cursorRe.exec(raw) : null;
  if (raw && !m) throw new HttpError(400, "invalid_request");
  const viewer = await getViewer().catch(() => null);
  const rows = await query<Row>(
    `${SELECT} where c.parcel_id = $1 and ${VISIBLE}
        and ($2::timestamptz is null or (c.created_at, c.id) < ($2::timestamptz, $3::uuid))
      order by c.created_at desc, c.id desc limit ${PAGE + 1}`,
    [parcel.id, m?.[1] ?? null, m?.[2] ?? null],
  );
  const total = (await queryOne<{ n: number }>(`select count(*)::int as n from public.parcel_comments c join public.profiles u on u.id = c.author_id where c.parcel_id = $1 and ${VISIBLE}`, [parcel.id]))?.n ?? 0;
  const page = rows.slice(0, PAGE);
  const canRemove = (r: Row) => Boolean(viewer && (viewer.user.id === r.author_id || viewer.user.id === parcel.owner_id || viewer.staffRole));
  return json(
    { total, comments: page.map((r) => present(r, canRemove(r))), next: rows.length > PAGE ? `${page[page.length - 1]!.ts}|${page[page.length - 1]!.id}` : null },
    { cache: "no-store" },
  );
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const viewer = await requireActiveViewer();
  await enforceRateLimit(req, LIMITS.comment, viewer.user.id);
  const body = (await req.json().catch(() => null)) as { code?: unknown; body?: unknown } | null;
  if (!body || typeof body.body !== "string" || body.body.length > 4 * COMMENT_MAX) throw new HttpError(400, "px_comment_invalid");
  await commentable(body.code); // 404 for an unknown or hidden parcel, before anything is written
  const text = cleanText(body.body, 4 * COMMENT_MAX);
  if (!text || [...text].length > COMMENT_MAX) throw new HttpError(400, "px_comment_invalid");
  const added = await queryOne<{ id: string }>("select public.px_comment_add($1, $2, $3) as id", [viewer.user.id, body.code as string, text]);
  const row = (await query<Row>(`${SELECT} where c.id = $1`, [added!.id]))[0]!;
  return json({ comment: present(row, true) }, { status: 201, cache: "no-store" });
});

export const DELETE = route(async (req) => {
  assertSameOrigin(req);
  const viewer = await requireViewer(); // even a suspended author may take their own words back
  await enforceRateLimit(req, LIMITS.like, viewer.user.id);
  const parsed = z.object({ id: uuid }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "invalid_request");
  const role = await queryOne<{ role: string }>("select public.px_comment_remove($1, $2, null) as role", [viewer.user.id, parsed.data.id]);
  return json({ removed: true, role: role?.role }, { cache: "no-store" });
});
