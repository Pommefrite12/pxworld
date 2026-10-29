import { isParcelCode } from "@/lib/grid/code";
import "server-only";
import { query, queryOne } from "@/lib/db/pool";

export interface ParcelView {
  id: string;
  code: string;
  x: number; y: number; w: number; h: number; area: number;
  status: string;
  hidden: boolean;
  activated_at: Date | null;
  owner: { id: string; username: string; country: string | null; avatar: boolean };
  creation: null | {
    asset_id: string;
    title: string | null;
    description: string | null;
    link_url: string | null;
    is_commercial: boolean;
    published_at: Date | null;
    avg_color: string;
  };
  likes: number;
}

const SELECT = `
  select p.id, p.code, p.x, p.y, p.w, p.h, p.area, p.status, (p.hidden_at is not null) as hidden, p.activated_at,
         u.id as owner_id, u.username, u.country, (u.avatar_path is not null) as has_avatar,
         a.id as asset_id, a.title, a.description, a.link_url, a.is_commercial, a.published_at, a.avg_color,
         (select count(*) from public.parcel_likes l where l.parcel_id = p.id)::int as likes
    from public.parcels p
    join public.profiles u on u.id = p.owner_id
    left join public.parcel_assets a on a.id = p.published_asset_id`;

type Row = {
  id: string; code: string; x: number; y: number; w: number; h: number; area: number; status: string; hidden: boolean; activated_at: Date | null;
  owner_id: string; username: string; country: string | null; has_avatar: boolean;
  asset_id: string | null; title: string | null; description: string | null; link_url: string | null; is_commercial: boolean | null;
  published_at: Date | null; avg_color: string | null; likes: number;
};

function toView(r: Row): ParcelView {
  return {
    id: r.id, code: r.code, x: r.x, y: r.y, w: r.w, h: r.h, area: r.area, status: r.status, hidden: r.hidden, activated_at: r.activated_at,
    owner: { id: r.owner_id, username: r.username, country: r.country, avatar: r.has_avatar },
    creation: r.asset_id && !r.hidden
      ? { asset_id: r.asset_id, title: r.title, description: r.description, link_url: r.link_url, is_commercial: r.is_commercial ?? false, published_at: r.published_at, avg_color: r.avg_color ?? "#cccccc" }
      : null,
    likes: r.likes,
  };
}

/** Public view of an ACTIVE parcel. Hidden parcels keep their place but expose no content. */
export async function getPublicParcel(code: string): Promise<ParcelView | null> {
  if (!isParcelCode(code)) return null;
  const r = await queryOne<Row>(`${SELECT} where p.code = $1 and p.status = 'active'`, [code]);
  return r ? toView(r) : null;
}

export async function getParcelsOf(userId: string) {
  return query<{
    id: string; code: string; x: number; y: number; w: number; h: number; area: number; status: string; hidden: boolean;
    published_asset_id: string | null; pending_asset_id: string | null; pending_title: string | null; last_rejection: string | null; title: string | null;
    activated_at: Date | null;
  }>(
    `select p.id, p.code, p.x, p.y, p.w, p.h, p.area, p.status, (p.hidden_at is not null) as hidden, p.published_asset_id, p.activated_at,
            (select id from public.parcel_assets where parcel_id = p.id and status = 'pending') as pending_asset_id,
            (select title from public.parcel_assets where parcel_id = p.id and status = 'pending') as pending_title,
            (select rejection_reason from public.parcel_assets where parcel_id = p.id and status = 'rejected' order by version desc limit 1) as last_rejection,
            (select title from public.parcel_assets where id = p.published_asset_id) as title
       from public.parcels p
      where p.owner_id = $1 and p.status = 'active'
      order by p.activated_at desc`,
    [userId],
  );
}

export async function getOwnedParcelByCode(userId: string, code: string) {
  return queryOne<{ id: string; code: string; x: number; y: number; w: number; h: number; area: number; status: string }>(
    "select id, code, x, y, w, h, area, status from public.parcels where code = $1 and owner_id = $2 and status in ('active','reserved')",
    [code, userId],
  );
}

export async function getLatestAssetsOf(parcelId: string) {
  return query<{ id: string; version: number; status: string; title: string | null; description: string | null; link_url: string | null; rejection_reason: string | null; created_at: Date }>(
    "select id, version, status, title, description, link_url, rejection_reason, created_at from public.parcel_assets where parcel_id = $1 order by version desc limit 10",
    [parcelId],
  );
}

export async function getOrdersOf(userId: string) {
  return query<{
    id: string; status: string; x: number; y: number; w: number; h: number; area: number; amount_cents: number; amount_total_cents: number | null;
    amount_tax_cents: number | null; currency: string; created_at: Date; paid_at: Date | null; parcel_code: string; invoice_url: string | null;
  }>(
    `select o.id, o.status, o.x, o.y, o.w, o.h, o.area, o.amount_cents, o.amount_total_cents, o.amount_tax_cents, o.currency, o.created_at, o.paid_at,
            p.code as parcel_code, o.invoice_url
       from public.orders o join public.parcels p on p.id = o.parcel_id
      where o.user_id = $1 order by o.created_at desc limit 100`,
    [userId],
  );
}

export async function getUserStats(userId: string) {
  return (await queryOne<{ parcels: number; pixels: number }>(
    "select count(*)::int as parcels, coalesce(sum(area), 0)::int as pixels from public.parcels where owner_id = $1 and status = 'active'",
    [userId],
  )) ?? { parcels: 0, pixels: 0 };
}

export async function getPublicProfile(username: string) {
  const p = await queryOne<{ id: string; username: string; country: string | null; bio: string | null; created_at: Date; has_avatar: boolean }>(
    "select id, username, country, bio, created_at, (avatar_path is not null) as has_avatar from public.profiles where lower(username) = lower($1) and deleted_at is null and status = 'active'",
    [username],
  );
  if (!p) return null;
  const stats = await getUserStats(p.id);
  const creations = await query<{ code: string; x: number; y: number; w: number; h: number; asset_id: string | null; title: string | null }>(
    `select p.code, p.x, p.y, p.w, p.h, a.id as asset_id, a.title from public.parcels p
       left join public.parcel_assets a on a.id = p.published_asset_id
      where p.owner_id = $1 and p.status = 'active' and p.hidden_at is null and p.published_asset_id is not null
      order by p.activated_at desc limit 60`,
    [p.id],
  );
  return { ...p, ...stats, creations };
}

/* ------------------------------------------------------------------ discovery */

export interface Card { code: string; w: number; h: number; x: number; y: number; area: number; asset_id: string; title: string | null; username: string; country: string | null; published_at: Date | null; score?: number; note?: string | null }

const CARD = `select p.code, p.w, p.h, p.x, p.y, p.area, a.id as asset_id, a.title, u.username, u.country, a.published_at
                from public.parcels p join public.parcel_assets a on a.id = p.published_asset_id join public.profiles u on u.id = p.owner_id
               where p.status = 'active' and p.hidden_at is null and u.status = 'active'`;

export const latestCreations = (limit = 12) => query<Card>(`${CARD} order by a.published_at desc nulls last limit $1`, [limit]);
export const largestParcels = (limit = 12) => query<Card>(`${CARD} order by p.area desc, a.published_at desc limit $1`, [limit]);

/** Popularity is MEASURABLE: number of likes received over the last 30 days (ties: all-time likes, then recency). */
export const popularCreations = (limit = 12) =>
  query<Card>(
    `select c.*, s.score from (${CARD}) c
       join (select parcel_id, count(*) filter (where created_at > now() - interval '30 days')::int as score, count(*)::int as total
               from public.parcel_likes group by parcel_id having count(*) filter (where created_at > now() - interval '30 days') > 0) s
         on s.parcel_id = (select id from public.parcels where code = c.code)
      order by s.score desc, s.total desc, c.published_at desc limit $1`,
    [limit],
  );

export const editorialPicks = (limit = 12) =>
  query<Card>(
    `select c.*, f.note from (${CARD}) c join public.parcel_features f on f.parcel_id = (select id from public.parcels where code = c.code)
      order by f.featured_at desc limit $1`,
    [limit],
  );

export const topContributors = (limit = 10) =>
  query<{ username: string; country: string | null; parcels: number; pixels: number }>(
    `select u.username, u.country, count(*)::int as parcels, sum(p.area)::int as pixels
       from public.parcels p join public.profiles u on u.id = p.owner_id
      where p.status = 'active' and u.status = 'active' group by u.id order by pixels desc, parcels desc limit $1`,
    [limit],
  );

export async function hasLiked(userId: string, parcelId: string): Promise<boolean> {
  return (await queryOne("select 1 from public.parcel_likes where user_id = $1 and parcel_id = $2", [userId, parcelId])) !== null;
}
