import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import { query, queryOne } from "@/lib/db/pool";
import { DEFAULT_UNIT_PRICE_CENTS, GRID_HEIGHT, GRID_WIDTH, MIN_AREA, TOTAL_PIXELS } from "@/lib/grid/constants";
import type { ParcelKind, Pricing } from "@/lib/grid/pricing";
import type { SaleCurrency } from "@/lib/currency";
import type { EditionState } from "@/lib/edition";
import { tintColor } from "@/lib/images/waterTint";

export const TILE_SIZE = 1000; // virtual pixels per JSON metadata tile (40 × 25 tiles)
export const TILES_X = GRID_WIDTH / TILE_SIZE;
export const TILES_Y = GRID_HEIGHT / TILE_SIZE;

/**
 * [code, x, y, w, h, assetId | null, avgColor | null, water, free] — compact on purpose, a tile can hold thousands. `water` is 1 for a water
 * parcel (then `avgColor` is already one of its three blues, and is the medium blue while the creation is not published). `free` is 1 for a
 * free parcel (1 to 24 pixels, covered by any paid parcel that touches it): a purchase is never blocked by it.
 */
export type TileParcel = [string, number, number, number, number, string | null, string | null, 0 | 1, 0 | 1];

export async function getTile(tx: number, ty: number): Promise<TileParcel[]> {
  const x0 = tx * TILE_SIZE, y0 = ty * TILE_SIZE;
  const rows = await query<{ code: string; x: number; y: number; w: number; h: number; kind: string; free: boolean; asset_id: string | null; color: string | null }>(
    `select p.code, p.x, p.y, p.w, p.h, p.kind, (p.tier <> 'paid') as free,
            case when p.hidden_at is null then p.published_asset_id end as asset_id,
            case when p.hidden_at is null then a.avg_color end as color
       from public.parcels p
       left join public.parcel_assets a on a.id = p.published_asset_id
      where p.status = 'active' and p.bbox && box(point($1::float8, $2::float8), point($3::float8, $4::float8))
      order by p.x, p.y
      limit 20000`,
    [x0, y0, x0 + TILE_SIZE - 1, y0 + TILE_SIZE - 1],
  );
  return rows.map((r) => (r.kind === "water"
    ? [r.code, r.x, r.y, r.w, r.h, r.asset_id, tintColor(r.color), 1, 0]
    : [r.code, r.x, r.y, r.w, r.h, r.asset_id, r.color, 0, r.free ? 1 : 0]));
}

/**
 * Where the WATER parcels are, as 512-px cells (flat `[cx, cy, …]`): the map only asks the server for the water layer of the tiles that
 * can hold one. Without it every world view would fetch a second, almost empty, layer of raster tiles. At most 78 × 49 cells.
 */
export const WATER_CELL = 512;
async function computeWaterCells(): Promise<number[]> {
  const rows = await query<{ cx: number; cy: number }>(
    `select distinct cx, cy
       from public.parcels p,
            generate_series(floor(p.x / ${WATER_CELL}.0)::int, floor((p.x + p.w - 1) / ${WATER_CELL}.0)::int) as cx,
            generate_series(floor(p.y / ${WATER_CELL}.0)::int, floor((p.y + p.h - 1) / ${WATER_CELL}.0)::int) as cy
      where p.status = 'active' and p.kind = 'water'
      order by 1, 2
      limit 5000`,
  );
  return rows.flatMap((r) => [r.cx, r.cy]);
}
export const getWaterCells = unstable_cache(computeWaterCells, ["map-water-cells"], { revalidate: 30, tags: ["stats"] });

export interface PublicStats {
  totalPixels: number;
  soldPixels: number;
  availablePixels: number;
  fillPercent: number;
  owners: number;
  parcels: number;
  publishedCreations: number;
  mapVersion: number;
  /** Of the pixels sold, how many are water (the sea is bought too), and in how many parcels. */
  waterPixels: number;
  waterParcels: number;
  /** Free parcels standing on the map (not counted in the sold pixels above) and their pixels. */
  freeParcels: number;
  freePixels: number;
}

async function computeStats(): Promise<PublicStats> {
  const r = await queryOne<{ sold_pixels: number; parcels: number; owners: number; published_creations: number; map_version: number; water_pixels: number; water_parcels: number; free_parcels: number; free_pixels: number }>(
    "select * from public.px_public_stats()",
  );
  const sold = r?.sold_pixels ?? 0;
  return {
    // the whole planet is for sale, land and water: every pixel of the grid
    totalPixels: TOTAL_PIXELS,
    soldPixels: sold,
    availablePixels: Math.max(0, TOTAL_PIXELS - sold),
    fillPercent: (sold / TOTAL_PIXELS) * 100,
    owners: r?.owners ?? 0,
    parcels: r?.parcels ?? 0,
    publishedCreations: r?.published_creations ?? 0,
    mapVersion: r?.map_version ?? 1,
    waterPixels: Number(r?.water_pixels ?? 0),
    waterParcels: Number(r?.water_parcels ?? 0),
    freeParcels: Number(r?.free_parcels ?? 0),
    freePixels: Number(r?.free_pixels ?? 0),
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

/**
 * What a buyer pays: the unit price in `currency` (the shop's own, euros, or dollars — see `lib/currency`), and the shop's rules.
 * Without a currency, the shop's own.
 */
export async function getPricing(currency?: SaleCurrency): Promise<Pricing> {
  const keys = "('price_unit_cents','price_unit_cents_usd','currency','min_area','max_area','sales_open','sea_price_percent','min_land_percent','water_price_percent','min_water_percent','land_cut_price_percent','campaign_min_area','campaign_min_contribution_cents')";
  let rows: { key: string; value: unknown }[];
  try {
    // one round trip: the settings and the state of the edition (computed by the database from its own clock)
    rows = await query<{ key: string; value: unknown }>(`select key, value from public.app_settings where key in ${keys} union all select 'edition_state', to_jsonb(public.px_edition_state())`);
  } catch (e) {
    // a database without migration 19: the pages still work, but nothing is for sale until the migrations are applied
    if ((e as { code?: string }).code !== "42883") throw e;
    console.error("[alert] The database is out of date (no editions): run `node scripts/migrate.mjs`. Nothing is for sale until then.");
    rows = await query<{ key: string; value: unknown }>(`select key, value from public.app_settings where key in ${keys}`);
  }
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const base = String(m.currency ?? "eur").toLowerCase();
  const cur = currency ?? base;
  const unit = cur === "usd" && base !== "usd" ? Number(m.price_unit_cents_usd ?? DEFAULT_UNIT_PRICE_CENTS) : Number(m.price_unit_cents ?? DEFAULT_UNIT_PRICE_CENTS);
  const editionState: EditionState = m.edition_state === "open" || m.edition_state === "closed" ? m.edition_state : "prelaunch";
  return {
    unitPriceCents: unit,
    currency: cur,
    minArea: Number(m.min_area ?? MIN_AREA),
    maxArea: Number(m.max_area ?? 250_000),
    salesOpen: m.sales_open !== false && editionState === "open", // the manual switch AND the edition: nothing is sold in pre-launch nor after the closing
    editionState,
    minLandPercent: Number(m.min_land_percent ?? 50),
    seaPercent: Number(m.sea_price_percent ?? 0),
    minWaterPercent: Number(m.min_water_percent ?? 50),
    waterPercent: Number(m.water_price_percent ?? 100),
    landCutPercent: Number(m.land_cut_price_percent ?? 0),
    campaignMinArea: Number(m.campaign_min_area ?? 10_000),
    campaignMinContributionCents: Number(m.campaign_min_contribution_cents ?? 200),
  };
}

/** Is the area free for a FREE parcel? Nothing may be there, free or paid, active or held (an order being paid, a collecting project). */
export async function isAreaFreeOfAll(x: number, y: number, w: number, h: number): Promise<boolean> {
  const r = await queryOne<{ f: boolean }>("select public.px_is_area_free_of_all($1, $2, $3, $4) as f", [x, y, w, h]);
  return r?.f === true;
}

/** Is the area free for a PURCHASE? Free parcels do not count: a paid parcel covers them. */
export async function isAreaFree(x: number, y: number, w: number, h: number, kind: ParcelKind = "land"): Promise<boolean> {
  const r = await queryOne<{ f: boolean }>("select public.px_is_area_free($1, $2, $3, $4, $5) as f", [x, y, w, h, kind]);
  return r?.f === true;
}
