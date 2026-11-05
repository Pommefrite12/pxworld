import "server-only";
import { query, queryOne } from "@/lib/db/pool";
import type { CampaignStatus } from "@/lib/campaign";

/** What the creator sees of a project of theirs, and what a moderator needs to decide. Nothing public yet: the list comes with the next step. */
export interface CampaignRow {
  id: string; code: string; title: string; description: string | null; link_url: string | null; is_commercial: boolean;
  status: CampaignStatus; rejection_reason: string | null; kind: "land" | "water";
  x: number; y: number; w: number; h: number; area: number; width: number; height: number;
  goal_cents: string; currency: string; duration_days: number;
  created_at: Date; opens_at: Date | null; deadline: Date | null; closed_at: Date | null;
  /** What has been paid so far (a disputed payment still counts until it is lost), how many people paid, and how many refunds are still due. */
  raised_cents: string; contributors: number; refunds_due: number;
}

const COLUMNS = `c.id, c.code, c.title, c.description, c.link_url, c.is_commercial, c.status, c.rejection_reason, c.kind,
  c.x, c.y, c.w, c.h, c.area, c.width, c.height, c.goal_cents, c.currency, c.duration_days, c.created_at, c.opens_at, c.deadline, c.closed_at,
  coalesce((select sum(k.amount_cents) from public.contributions k where k.campaign_id = c.id and k.status in ('paid', 'disputed')), 0)::text as raised_cents,
  (select count(distinct k.user_id) from public.contributions k where k.campaign_id = c.id and k.status in ('paid', 'disputed'))::int as contributors,
  (select count(*) from public.contributions k where k.campaign_id = c.id and k.status = 'refund_required')::int as refunds_due`;

/** The projects of one creator, newest first. */
export const campaignsOf = (userId: string) =>
  query<CampaignRow>(`select ${COLUMNS} from public.campaigns c where c.creator_id = $1 order by c.created_at desc limit 50`, [userId]);

/** The projects waiting for a moderator, oldest first. */
export const campaignQueue = () =>
  query<CampaignRow & { username: string; creator_id: string }>(
    `select ${COLUMNS}, u.username, u.id as creator_id
       from public.campaigns c join public.profiles u on u.id = c.creator_id where c.status = 'pending' order by c.created_at limit 50`);

/** The projects a moderator has already dealt with, or that are running: for the second part of the back-office page. */
export const campaignsReviewed = () =>
  query<CampaignRow & { username: string; creator_id: string }>(
    `select ${COLUMNS}, u.username, u.id as creator_id
       from public.campaigns c join public.profiles u on u.id = c.creator_id where c.status <> 'pending' order by c.updated_at desc limit 50`);

export const campaignAccess = (id: string) =>
  queryOne<{ storage_path: string; creator_id: string; kind: string; status: CampaignStatus; width: number; height: number }>(
    "select storage_path, creator_id, kind, status, width, height from public.campaigns where id = $1", [id]);

/* ------------------------------------------------------------------ the public side: the list and the page of a project */

/**
 * What anybody may see of a project that was opened by the moderators. Contributions are ANONYMOUS: only the total and the number of
 * people are public, never who they are or what each gave.
 */
export interface PublicCampaign {
  id: string; code: string; title: string; description: string | null; link_url: string | null; is_commercial: boolean;
  status: CampaignStatus; kind: "land" | "water";
  x: number; y: number; w: number; h: number; area: number; width: number; height: number;
  goal_cents: string; currency: string; duration_days: number;
  opens_at: Date | null; deadline: Date | null; funded_at: Date | null;
  raised_cents: string; held_cents: string; contributors: number; seconds_left: number;
  username: string; creator_id: string; parcel_code: string | null;
}

const PUBLIC_COLUMNS = `c.id, c.code, c.title, c.description, c.link_url, c.is_commercial, c.status, c.kind,
  c.x, c.y, c.w, c.h, c.area, c.width, c.height, c.goal_cents, c.currency, c.duration_days, c.opens_at, c.deadline, c.funded_at,
  coalesce(sum(k.amount_cents) filter (where k.status in ('paid', 'disputed')), 0)::text as raised_cents,
  coalesce(sum(k.amount_cents) filter (where k.status = 'pending' and k.expires_at > now()), 0)::text as held_cents,
  (count(distinct k.user_id) filter (where k.status in ('paid', 'disputed')))::int as contributors,
  greatest(0, extract(epoch from (c.deadline - now())))::float8 as seconds_left,
  u.username, c.creator_id, case when c.status = 'funded' then p.code end as parcel_code`;
const PUBLIC_FROM = `from public.campaigns c join public.profiles u on u.id = c.creator_id
  left join public.contributions k on k.campaign_id = c.id left join public.parcels p on p.id = c.parcel_id`;
const PUBLIC_GROUP = "group by c.id, u.username, p.code";

export type ProjectSort = "new" | "ending" | "funded";
export const isProjectSort = (v: unknown): v is ProjectSort => v === "new" || v === "ending" || v === "funded";

/** The projects that are collecting now. */
export const openCampaigns = (sort: ProjectSort = "ending", limit = 48) =>
  query<PublicCampaign>(
    `select ${PUBLIC_COLUMNS} ${PUBLIC_FROM} where c.status = 'open' and c.deadline > now() ${PUBLIC_GROUP}
     order by ${sort === "new" ? "c.opens_at desc" : sort === "funded" ? "coalesce(sum(k.amount_cents) filter (where k.status in ('paid', 'disputed')), 0)::float8 / c.goal_cents desc, c.deadline" : "c.deadline"}
     limit ${Math.min(Math.max(1, limit), 100)}`);

/** The projects whose parcel was bought, newest first. */
export const fundedCampaigns = (limit = 12) =>
  query<PublicCampaign>(`select ${PUBLIC_COLUMNS} ${PUBLIC_FROM} where c.status = 'funded' ${PUBLIC_GROUP} order by c.funded_at desc limit ${Math.min(Math.max(1, limit), 50)}`);

/** One project by its public code (anything that was opened, whatever became of it). */
export const publicCampaign = (code: string) =>
  queryOne<PublicCampaign>(
    `select ${PUBLIC_COLUMNS} ${PUBLIC_FROM} where c.code = $1 and c.opens_at is not null and c.status in ('open', 'funded', 'expired', 'cancelled') ${PUBLIC_GROUP}`,
    [code.toLowerCase()]);

/** The projects the map draws: collecting right now, with just what a pin, a hatched zone and a small card need. Anonymous like everything public. */
export const mapProjects = () =>
  query<{ id: string; code: string; title: string; x: number; y: number; w: number; h: number; kind: string; currency: string; goal_cents: string; raised_cents: string; contributors: number; seconds_left: number }>(
    `select c.id, c.code, c.title, c.x, c.y, c.w, c.h, c.kind, c.currency, c.goal_cents::text,
            coalesce(sum(k.amount_cents) filter (where k.status in ('paid', 'disputed')), 0)::text as raised_cents,
            (count(distinct k.user_id) filter (where k.status in ('paid', 'disputed')))::int as contributors,
            greatest(0, extract(epoch from (c.deadline - now())))::float8 as seconds_left
       from public.campaigns c left join public.contributions k on k.campaign_id = c.id
      where c.status = 'open' and c.deadline > now() group by c.id order by c.opens_at limit 300`);
