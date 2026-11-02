import "server-only";
import sharp from "sharp";
import { query, queryOne } from "@/lib/db/pool";
import { HttpError } from "@/lib/http/errors";
import { objectStore } from "@/lib/storage";
import { processCreation } from "@/lib/images/validate";
import { storeCreation } from "@/lib/creations";
import { creationScale } from "@/lib/grid/constants";
import { TITLE_MAX, isValidTitle } from "@/lib/security/text";

/**
 * Drawing together (see supabase/migrations/…_collab_drawing.sql).
 *
 * The owner of a parcel shares a secret link. Anyone who holds it paints pixels on an OVERLAY above the parcel's approved
 * creation. The overlay is never shown on the map: it only becomes the parcel's creation when the owner publishes a
 * snapshot, which then goes through moderation like any other new version.
 */
export const TOKEN_RE = /^[0-9a-f]{40}$/;
/** Pixels per paint request (the database refuses more). */
export const MAX_BATCH = 2000;
/** Pixels per state response: a big drawing is fetched in pages. */
const PAGE = 50_000;

export interface OpenCollab {
  parcelId: string;
  w: number;
  h: number;
  version: number;
  resetVersion: number;
  /** The approved creation the overlay sits on (null: a white background). */
  baseAssetId: string | null;
  title: string | null;
  owner: string;
}

/** The shared parcel behind a link, or null when the link is unknown, switched off or the parcel can no longer be drawn on. */
export async function openCollab(token: string): Promise<OpenCollab | null> {
  if (!TOKEN_RE.test(token)) return null;
  const r = await queryOne<{ parcel_id: string; w: number; h: number; version: number; reset_version: number; base: string | null; title: string | null; owner: string }>(
    `select c.parcel_id, p.w, p.h, c.version, c.reset_version, p.published_asset_id as base, a.title, u.username as owner
       from public.parcel_collab c
       join public.parcels p on p.id = c.parcel_id
       join public.profiles u on u.id = p.owner_id
       left join public.parcel_assets a on a.id = p.published_asset_id
      where c.token = $1 and c.enabled and p.status = 'active' and p.hidden_at is null and u.status = 'active' and u.deleted_at is null`,
    [token],
  );
  return r && { parcelId: r.parcel_id, w: r.w, h: r.h, version: Number(r.version), resetVersion: Number(r.reset_version), baseAssetId: r.base, title: r.title, owner: r.owner };
}

export interface CollabDelta {
  /** Flat `[x, y, rgb, x, y, rgb, …]`; x and y count DOTS (`creationScale(w, h)` per pixel side), from the parcel's top-left corner. */
  p: number[];
  /** Ask next time for changes after this version. */
  version: number;
  /** More pages are waiting: ask again right away from `version`. */
  more: boolean;
  /** The overlay was wiped since the client last looked: clear it, then apply `p` (which holds everything). */
  reset: boolean;
}

/** Changes after version `since`. Versions are assigned in commit order, so nothing at or below `info.version` can still appear. */
export async function collabDelta(info: OpenCollab, since: number): Promise<CollabDelta> {
  const reset = since < info.resetVersion;
  const from = reset ? 0 : since;
  if (from >= info.version) return { p: [], version: info.version, more: false, reset };
  const rows = await query<{ x: number; y: number; rgb: number; version: number }>(
    `select x, y, rgb, version from public.parcel_collab_pixels where parcel_id = $1 and version > $2 and version <= $3 order by version, y, x limit $4`,
    [info.parcelId, from, info.version, PAGE],
  );
  let more = false;
  let cursor = info.version;
  if (rows.length === PAGE) {
    // a page may end in the middle of one batch: drop that batch, it comes whole with the next page (a batch is far smaller than a page)
    const last = Number(rows[rows.length - 1]!.version);
    let cut = rows.length;
    while (cut > 0 && Number(rows[cut - 1]!.version) === last) cut--;
    rows.length = cut;
    cursor = cut > 0 ? Number(rows[cut - 1]!.version) : from;
    more = true;
  }
  const p: number[] = [];
  for (const r of rows) p.push(r.x, r.y, r.rgb);
  return { p, version: cursor, more, reset };
}

/** Parses a paint request body (`{ p: [x, y, rgb, …] }`): only integers, whole pixels, a bounded batch. */
export function parsePaintBody(body: unknown): { xs: number[]; ys: number[]; rgb: number[] } {
  const p = (body as { p?: unknown } | null)?.p;
  if (!Array.isArray(p) || p.length === 0 || p.length % 3 !== 0 || p.length > MAX_BATCH * 3) throw new HttpError(400, "px_collab_bad_batch");
  const xs: number[] = [], ys: number[] = [], rgb: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, c] = [p[i], p[i + 1], p[i + 2]];
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(c)) throw new HttpError(400, "px_collab_bad_batch");
    xs.push(x as number); ys.push(y as number); rgb.push(c as number);
  }
  return { xs, ys, rgb };
}

export async function paint(token: string, batch: { xs: number[]; ys: number[]; rgb: number[] }): Promise<number> {
  const [r] = await query<{ v: string }>("select public.px_collab_paint($1, $2, $3, $4) as v", [token, batch.xs, batch.ys, batch.rgb]);
  return Number(r!.v);
}

export interface OwnerCollab { enabled: boolean; token: string; version: number; pixels: number; updatedAt: Date }

/** What the owner sees about the sharing of their parcel (null: never shared). */
export async function ownerCollab(parcelId: string): Promise<OwnerCollab | null> {
  const r = await queryOne<{ enabled: boolean; token: string; version: string; pixels: number; updated_at: Date }>(
    `select c.enabled, c.token, c.version, c.updated_at, (select count(*)::int from public.parcel_collab_pixels where parcel_id = c.parcel_id) as pixels
       from public.parcel_collab c where c.parcel_id = $1`, [parcelId]);
  return r && { enabled: r.enabled, token: r.token, version: Number(r.version), pixels: Number(r.pixels), updatedAt: r.updated_at };
}

/**
 * The owner publishes what the community drew: the approved creation (or white) with the overlay on top, submitted as a
 * NEW VERSION of the creation, at the parcel's full dot resolution. It replaces the pending version if there is one and waits for a moderator like any edit.
 */
export async function publishSnapshot(userId: string, parcel: { id: string; w: number; h: number }) {
  const k = creationScale(parcel.w, parcel.h);
  const w = parcel.w * k, h = parcel.h * k; // in dots, like the overlay
  const overlay = await query<{ x: number; y: number; rgb: number }>("select x, y, rgb from public.parcel_collab_pixels where parcel_id = $1", [parcel.id]);
  if (overlay.length === 0) throw new HttpError(409, "collab_empty");

  const base = await queryOne<{ storage_path: string; title: string | null; description: string | null; link_url: string | null; is_commercial: boolean }>(
    `select a.storage_path, a.title, a.description, a.link_url, a.is_commercial
       from public.parcels p join public.parcel_assets a on a.id = p.published_asset_id where p.id = $1`, [parcel.id]);
  let raw = Buffer.alloc(w * h * 3, 255); // white
  const bytes = base ? await objectStore().get(base.storage_path) : null;
  if (bytes) {
    // an older (coarser) creation: each of its dots becomes several (nearest-neighbour, nothing invented)
    const decoded = await sharp(bytes).flatten({ background: "#ffffff" }).resize(w, h, { fit: "fill", kernel: "nearest" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    raw = decoded.data;
  }
  for (const { x, y, rgb } of overlay) {
    const o = (y * w + x) * 3;
    raw[o] = (rgb >> 16) & 255; raw[o + 1] = (rgb >> 8) & 255; raw[o + 2] = rgb & 255;
  }
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  const img = await processCreation(png, { w: parcel.w, h: parcel.h }); // the same checks and canonical encoding as any upload

  // keep the title the parcel already has (the latest version's, if nothing is approved yet)
  const latest = base ?? (await queryOne<{ title: string | null; description: string | null; link_url: string | null; is_commercial: boolean }>(
    "select title, description, link_url, is_commercial from public.parcel_assets where parcel_id = $1 order by version desc limit 1", [parcel.id]));
  const title = latest?.title && isValidTitle(latest.title) ? latest.title : "Community drawing";
  return storeCreation(userId, parcel.id, img, {
    title: title.slice(0, TITLE_MAX), description: latest?.description ?? null, link: latest?.link_url ?? null, commercial: latest?.is_commercial ?? false,
  });
}
