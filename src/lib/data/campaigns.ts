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
}

const COLUMNS = `c.id, c.code, c.title, c.description, c.link_url, c.is_commercial, c.status, c.rejection_reason, c.kind,
  c.x, c.y, c.w, c.h, c.area, c.width, c.height, c.goal_cents, c.currency, c.duration_days, c.created_at, c.opens_at, c.deadline, c.closed_at`;

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
  queryOne<{ storage_path: string; creator_id: string; kind: string; status: CampaignStatus }>(
    "select storage_path, creator_id, kind, status from public.campaigns where id = $1", [id]);
