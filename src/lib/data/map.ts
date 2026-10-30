import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { query, queryOne } from "@/lib/db/pool";
import { GRID_HEIGHT, GRID_WIDTH, TOTAL_PIXELS } from "@/lib/grid/constants";

export const TILE_SIZE = 1000; // virtual pixels per JSON metadata tile (40 × 25 tiles)
export const TILES_X = GRID_WIDTH / TILE_SIZE;
export const TILES_Y = GRID_HEIGHT / TILE_SIZE;

/** [code, x, y, w, h, assetId | null, avgColor | null] — compact on purpose, a tile can hold thousands. */
export type TileParcel = [string, number, number, number, number, string | null, string | null];

export async function getTile(tx: number, ty: number): Promise<TileParcel[]> {
  const x0 = tx * TILE_SIZE, y0 = ty * TILE_SIZE;
  const rows = await query<{ code: string; x: number; y: number; w: number; h: number; asset_id: string | null; color: string | null }>(
    `select p.code, p.x, p.y, p.w, p.h,
            case when p.hidden_at is null then p.published_asset_id end as asset_id,
            case when p.hidden_at is null then a.avg_color end as color
       from public.parcels p
       left join public.parcel_assets a on a.id = p.published_asset_id
      where p.status = 'active' and p.bbox && box(point($1::float8, $2::float8), point($3::float8, $4::float8))
      order by p.x, p.y
      limit 20000`,
    [x0, y0, x0 + TILE_SIZE - 1, y0 + TILE_SIZE - 1],
  );
  return rows.map((r) => [r.code, r.x, r.y, r.w, r.h, r.asset_id, r.color]);
}

export interface PublicStats {
  totalPixels: number;
  soldPixels: number;
  availablePixels: number;
  fillPercent: number;
  owners: number;
  parcels: number;
  publishedCreations: number;
  mapVersion: number;
}

async function computeStats(): Promise<PublicStats> {
  const r = await queryOne<{ sold_pixels: number; parcels: number; owners: number; published_creations: number; map_version: number }>(
    "select * from public.px_public_stats()",
  );
  const sold = r?.sold_pixels ?? 0;
  return {
    totalPixels: TOTAL_PIXELS,
    soldPixels: sold,
    availablePixels: TOTAL_PIXELS - sold,
    fillPercent: (sold / TOTAL_PIXELS) * 100,
    owners: r?.owners ?? 0,
    parcels: r?.parcels ?? 0,
    publishedCreations: r?.published_creations ?? 0,
    mapVersion: r?.map_version ?? 1,
  };
}

/** Real figures from the database, cached for a few seconds so traffic never turns into aggregate queries. */
export const getPublicStats = unstable_cache(computeStats, ["public-stats"], { revalidate: 15, tags: ["stats"] });

/** Called after anything that changes sold pixels or published creations, so the counters are never stale for long. */
export function invalidatePublicStats(): void {
  try {
    revalidateTag("stats", { expire: 0 });
  } catch {
    /* not inside a Next.js request (tests, scripts): nothing to invalidate */
  }
}

export async function getPricing(): Promise<{ unitPriceCents: number; currency: string; minArea: number; maxArea: number; salesOpen: boolean }> {
  const rows = await query<{ key: string; value: unknown }>(
    "select key, value from public.app_settings where key in ('price_unit_cents','currency','min_area','max_area','sales_open')",
  );
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    unitPriceCents: Number(m.price_unit_cents ?? 100),
    currency: String(m.currency ?? "eur"),
    minArea: Number(m.min_area ?? 100),
    maxArea: Number(m.max_area ?? 250_000),
    salesOpen: m.sales_open !== false,
  };
}

export async function isAreaFree(x: number, y: number, w: number, h: number): Promise<boolean> {
  const r = await queryOne<{ f: boolean }>("select public.px_is_area_free($1, $2, $3, $4) as f", [x, y, w, h]);
  return r?.f === true;
}
