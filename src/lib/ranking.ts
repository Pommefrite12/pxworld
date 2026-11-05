/**
 * The ranking of the creations and of the creators by the number of likes they received. The SQL lives here (no server-only import) so
 * that the database tests run EXACTLY what the page runs.
 *
 * What counts as a like, to keep the ranking honest:
 *  - not the owner's own like on their own parcel (the easiest way to cheat),
 *  - not a like from an account that is suspended or deleted,
 *  - only creations that the public can see (active parcel, not hidden, a published creation, an active owner).
 * Ties share a rank (1, 2, 2, 4…); inside a rank, the earlier published comes first.
 */
export const RANKING_PERIODS = ["all", "month", "week"] as const;
export type RankingPeriod = (typeof RANKING_PERIODS)[number];
export const RANKING_BOARDS = ["creations", "creators"] as const;
export type RankingBoard = (typeof RANKING_BOARDS)[number];
export const RANKING_SIZE = 50;

export const isRankingPeriod = (v: unknown): v is RankingPeriod => (RANKING_PERIODS as readonly unknown[]).includes(v);
export const isRankingBoard = (v: unknown): v is RankingBoard => (RANKING_BOARDS as readonly unknown[]).includes(v);
/** How many days back the likes count; `null` = all of them. */
export const periodDays = (p: RankingPeriod): number | null => (p === "week" ? 7 : p === "month" ? 30 : null);

const VOTES = `votes as (
  select l.parcel_id, count(*)::int as likes
    from public.parcel_likes l
    join public.profiles v on v.id = l.user_id and v.status = 'active' and v.deleted_at is null
    join public.parcels p on p.id = l.parcel_id
   where l.user_id <> p.owner_id and ($1::int is null or l.created_at > now() - make_interval(days => $1::int))
   group by l.parcel_id
)`;

export interface RankedCreation { rank: number; code: string; asset_id: string; title: string | null; username: string; country: string | null; w: number; h: number; area: number; likes: number }
export interface RankedCreator { rank: number; username: string; country: string | null; likes: number; parcels: number; top_code: string; top_asset_id: string; top_title: string | null }

/** $1 = days back (null = all time). */
export const CREATIONS_RANKING_SQL = `with ${VOTES}
  select rank() over (order by v.likes desc)::int as rank, p.code, a.id as asset_id, a.title, u.username, u.country, p.w, p.h, p.area, v.likes
    from votes v
    join public.parcels p on p.id = v.parcel_id and p.status = 'active' and p.hidden_at is null
    join public.parcel_assets a on a.id = p.published_asset_id
    join public.profiles u on u.id = p.owner_id and u.status = 'active' and u.deleted_at is null
   order by v.likes desc, a.published_at asc nulls last, p.code
   limit ${RANKING_SIZE}`;

/** $1 = days back (null = all time). A creator's score is the sum of the likes of all their visible creations; their best one is shown. */
export const CREATORS_RANKING_SQL = `with ${VOTES},
  mine as (
    select u.id as user_id, u.username, u.country, v.likes, p.code, a.id as asset_id, a.title, a.published_at
      from votes v
      join public.parcels p on p.id = v.parcel_id and p.status = 'active' and p.hidden_at is null
      join public.parcel_assets a on a.id = p.published_asset_id
      join public.profiles u on u.id = p.owner_id and u.status = 'active' and u.deleted_at is null
  ), best as (
    select distinct on (user_id) user_id, code, asset_id, title from mine order by user_id, likes desc, published_at asc nulls last, code
  ), totals as (
    select user_id, username, country, sum(likes)::int as likes, count(*)::int as parcels from mine group by user_id, username, country
  )
  select rank() over (order by t.likes desc)::int as rank, t.username, t.country, t.likes, t.parcels, b.code as top_code, b.asset_id as top_asset_id, b.title as top_title
    from totals t join best b on b.user_id = t.user_id
   order by t.likes desc, t.parcels desc, t.username
   limit ${RANKING_SIZE}`;
