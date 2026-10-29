import "server-only";
import sharp, { type OverlayOptions } from "sharp";
import { query } from "@/lib/db/pool";
import { objectStore } from "@/lib/storage";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";

export const RASTER_TILE = 256;
export const MAX_RASTER_ZOOM = 8; // 256 · 2^8 = 65 536 ≥ grid width: one tile covers the world

/** Virtual pixels covered by one raster tile edge at level z. */
export const rasterSpan = (z: number) => RASTER_TILE * 2 ** z;

const EMPTY = sharp({ create: { width: RASTER_TILE, height: RASTER_TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .png({ compressionLevel: 9 })
  .toBuffer();

const PLACEHOLDER = { r: 190, g: 184, b: 170 };

function hexToRgb(hex: string | null) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return PLACEHOLDER;
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

interface Row { x: number; y: number; w: number; h: number; path: string | null; color: string | null }

/**
 * Renders the 256×256 PNG for tile (z, tx, ty): the parcels of that region, downscaled by 2^z.
 * Level 0 is 1 virtual pixel = 1 image pixel. Parcels without a published creation (pending / hidden)
 * are drawn as a neutral block so sold space is never shown as free.
 * Results are immutable per map version and cached by the CDN (see the route's Cache-Control).
 */
export async function renderRasterTile(z: number, tx: number, ty: number): Promise<Buffer> {
  const span = rasterSpan(z);
  const x0 = tx * span, y0 = ty * span;
  if (x0 >= GRID_WIDTH || y0 >= GRID_HEIGHT) return EMPTY;
  const scale = 2 ** -z;

  const rows = await query<Row>(
    `select p.x, p.y, p.w, p.h,
            case when p.hidden_at is null then a.storage_path end as path,
            case when p.hidden_at is null then a.avg_color end as color
       from public.parcels p left join public.parcel_assets a on a.id = p.published_asset_id
      where p.status = 'active' and p.bbox && box(point($1::float8, $2::float8), point($3::float8, $4::float8))
      order by p.area desc limit 4000`,
    [x0, y0, x0 + span - 1, y0 + span - 1],
  );
  if (rows.length === 0) return EMPTY;

  const layers: OverlayOptions[] = [];
  const queue = [...rows];
  const work = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const left = Math.round((r.x - x0) * scale), top = Math.round((r.y - y0) * scale);
      const w = Math.max(1, Math.round(r.w * scale)), h = Math.max(1, Math.round(r.h * scale));
      if (left >= RASTER_TILE || top >= RASTER_TILE || left + w <= 0 || top + h <= 0) continue;
      let input: Buffer | null = null;
      if (r.path && (w > 2 || h > 2)) {
        const bytes = await objectStore().get(r.path);
        if (bytes) {
          input = await sharp(bytes)
            .resize(w, h, { fit: "fill", kernel: z === 0 ? "nearest" : "lanczos3" })
            .png({ compressionLevel: 1 })
            .toBuffer();
        }
      }
      if (!input) {
        const c = r.path ? hexToRgb(r.color) : PLACEHOLDER;
        input = await sharp({ create: { width: w, height: h, channels: 4, background: { ...c, alpha: 1 } } }).png({ compressionLevel: 1 }).toBuffer();
      }
      // sharp refuses overlays that exceed the canvas: crop to the tile
      const cropL = Math.max(0, -left), cropT = Math.max(0, -top);
      const visW = Math.min(w - cropL, RASTER_TILE - Math.max(0, left)), visH = Math.min(h - cropT, RASTER_TILE - Math.max(0, top));
      if (visW <= 0 || visH <= 0) continue;
      if (cropL || cropT || visW !== w || visH !== h) {
        input = await sharp(input).extract({ left: cropL, top: cropT, width: visW, height: visH }).png({ compressionLevel: 1 }).toBuffer();
      }
      layers.push({ input, left: Math.max(0, left), top: Math.max(0, top) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));

  return sharp({ create: { width: RASTER_TILE, height: RASTER_TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png({ compressionLevel: 6 })
    .toBuffer();
}
