import "server-only";
import { query } from "@/lib/db/pool";

/**
 * What happened lately on an account, shown on its page (no e-mail exists yet, so this is how a creator learns that moderators decided on
 * their project, or that somebody commented on their parcel). Time-based: nothing to mark as read, an item simply leaves after a while.
 * Never allowed to break the page: without the migrations of the group projects it returns what it can.
 */
export type NewsItem =
  | { kind: "project_open"; title: string; at: Date; until: Date | null }
  | { kind: "project_rejected"; title: string; at: Date; reason: string | null }
  | { kind: "project_funded"; title: string; at: Date; parcelCode: string | null }
  | { kind: "project_expired"; title: string; at: Date }
  | { kind: "comments"; title: string; at: Date; code: string; count: number }
  | { kind: "covered"; title: string; at: Date; code: string };

export const NEWS_PROJECT_DAYS = 14;
export const NEWS_COMMENT_DAYS = 7;
export const NEWS_COVERED_DAYS = 14;

export async function accountNews(userId: string): Promise<NewsItem[]> {
  const items: NewsItem[] = [];
  try {
    const rows = await query<{ status: string; title: string; reviewed_at: Date | null; funded_at: Date | null; closed_at: Date | null; deadline: Date | null; rejection_reason: string | null; parcel_code: string | null }>(
      `select c.status, c.title, c.reviewed_at, c.funded_at, c.closed_at, c.deadline, c.rejection_reason, p.code as parcel_code
         from public.campaigns c left join public.parcels p on p.id = c.parcel_id and c.status = 'funded'
        where c.creator_id = $1 and (
              (c.status in ('open', 'rejected') and c.reviewed_at > now() - make_interval(days => ${NEWS_PROJECT_DAYS}))
           or (c.status = 'funded' and c.funded_at > now() - make_interval(days => ${NEWS_PROJECT_DAYS}))
           or (c.status = 'expired' and c.closed_at > now() - make_interval(days => ${NEWS_PROJECT_DAYS})))`, [userId]);
    for (const r of rows) {
      if (r.status === "open") items.push({ kind: "project_open", title: r.title, at: r.reviewed_at!, until: r.deadline });
      else if (r.status === "rejected") items.push({ kind: "project_rejected", title: r.title, at: r.reviewed_at!, reason: r.rejection_reason });
      else if (r.status === "funded") items.push({ kind: "project_funded", title: r.title, at: r.funded_at!, parcelCode: r.parcel_code });
      else items.push({ kind: "project_expired", title: r.title, at: r.closed_at! });
    }
  } catch (e) {
    console.error("account news (projects) failed", (e as Error).message);
  }
  try {
    const rows = await query<{ code: string; title: string | null; n: number; last: Date }>(
      `select p.code, a.title, count(*)::int as n, max(c.created_at) as last
         from public.parcel_comments c join public.parcels p on p.id = c.parcel_id left join public.parcel_assets a on a.id = p.published_asset_id
        where p.owner_id = $1 and p.status = 'active' and c.status = 'visible' and c.author_id <> $1
          and c.created_at > now() - make_interval(days => ${NEWS_COMMENT_DAYS})
        group by p.code, a.title order by max(c.created_at) desc limit 5`, [userId]);
    for (const r of rows) items.push({ kind: "comments", title: r.title ?? r.code, at: r.last, code: r.code, count: r.n });
  } catch (e) {
    console.error("account news (comments) failed", (e as Error).message);
  }
  try {
    // a free imprint that a paid parcel has covered: the owner learns it here, and can place another one
    const rows = await query<{ code: string; title: string | null; covered_at: Date }>(
      `select p.code, coalesce((select title from public.parcel_assets where id = p.published_asset_id), (select title from public.parcel_assets where parcel_id = p.id order by version desc limit 1)) as title, p.covered_at
         from public.parcels p
        where p.owner_id = $1 and p.tier = 'free' and p.status = 'covered' and p.covered_at > now() - make_interval(days => ${NEWS_COVERED_DAYS})
        order by p.covered_at desc limit 5`, [userId]);
    for (const r of rows) items.push({ kind: "covered", title: r.title ?? r.code, at: r.covered_at, code: r.code });
  } catch (e) {
    console.error("account news (covered) failed", (e as Error).message);
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}
