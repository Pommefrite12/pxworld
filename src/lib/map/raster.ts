import "server-only";
import sharp, { type OverlayOptions } from "sharp";
import { query } from "@/lib/db/pool";
import { objectStore } from "@/lib/storage";
import { tintColor, tintPixels } from "@/lib/images/waterTint";
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

/**
 * Pictures already fetched from storage, kept for the next tiles this server instance renders (the same parcel is on a tile of
 * every zoom level). A stored file never changes (its name carries a hash), so there is nothing to invalidate; the bytes in memory
 * are capped so that a busy instance cannot grow without bound.
 */
const FILE_CACHE_BYTES = 48 * 1024 * 1024;
const files = new Map<string, Buffer>();
let fileBytes = 0;
async function fetchFile(path: string): Promise<Buffer | null> {
  const hit = files.get(path);
  if (hit) { files.delete(path); files.set(path, hit); return hit; } // most recently used last
  const bytes = await objectStore().get(path);
  if (bytes && bytes.length < FILE_CACHE_BYTES / 4) {
    files.set(path, bytes);
    fileBytes += bytes.length;
    for (const [k, v] of files) { if (fileBytes <= FILE_CACHE_BYTES) break; files.delete(k); fileBytes -= v.length; }
  }
  return bytes;
}

/**
 * From this level on (a pixel of the grid is 1/8 of a pixel or less), a parcel of at most 8 px on the tile is its average colour:
 * nobody can tell the picture apart at that size, and not fetching it is what makes the world view appear at once.
 */
const FLAT_FROM_LEVEL = 3;
const FLAT_UP_TO_PX = 8;

interface Row { x: number; y: number; w: number; h: number; kind: string; path: string | null; color: string | null; src_w: number | null }

/**
 * Renders the 256×256 PNG for tile (z, tx, ty): the parcels of that region, downscaled by 2^z.
 * Level 0 is 1 virtual pixel = 1 image pixel. Parcels without a published creation (pending / hidden)
 * are drawn as a neutral block so sold space is never shown as free. WATER parcels are drawn in three tints of blue
 * (`lib/images/waterTint`), whatever their creation is. The tile holds the parcels of ONE kind (`kind`): land and water are two
 * layers, because the browser draws water under the land (the coast cuts both) and clips nothing on the server.
 * Results are immutable per map version and cached by the CDN (see the route's Cache-Control).
 */
export async function renderRasterTile(z: number, tx: number, ty: number, kind: "land" | "water" = "land"): Promise<Buffer> {
  const span = rasterSpan(z);
  const x0 = tx * span, y0 = ty * span;
  if (x0 >= GRID_WIDTH || y0 >= GRID_HEIGHT) return EMPTY;
  const scale = 2 ** -z;

  const rows = await query<Row>(
    `select p.x, p.y, p.w, p.h, p.kind,
            case when p.hidden_at is null then a.storage_path end as path,
            case when p.hidden_at is null then a.avg_color end as color,
            case when p.hidden_at is null then a.width end as src_w
       from public.parcels p left join public.parcel_assets a on a.id = p.published_asset_id
      where p.status = 'active' and p.kind = $5 and p.bbox && box(point($1::float8, $2::float8), point($3::float8, $4::float8))
      order by p.area desc limit 4000`,
    [x0, y0, x0 + span - 1, y0 + span - 1, kind],
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
      if (r.path && (z >= FLAT_FROM_LEVEL ? w > FLAT_UP_TO_PX || h > FLAT_UP_TO_PX : w > 2 || h > 2)) {
        const bytes = await fetchFile(r.path);
        if (bytes) {
          let img = sharp(bytes);
          if (r.kind === "water") { // the picture as it is shown on water: three blues
            const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            tintPixels(data, 4);
            img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
          }
          input = await img
            // crisp pixels only when the creation is magnified or kept as is; a finer (half-pixel) creation shown smaller is averaged
            .resize(w, h, { fit: "fill", kernel: z === 0 && (r.src_w ?? 0) <= w ? "nearest" : "lanczos3" })
            .png({ compressionLevel: 1 })
            .toBuffer();
        }
      }
      if (!input) {
        const c = r.kind === "water" ? hexToRgb(tintColor(r.path ? r.color : null)) : r.path ? hexToRgb(r.color) : PLACEHOLDER;
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
  await Promise.all(Array.from({ length: 12 }, work));

  return sharp({ create: { width: RASTER_TILE, height: RASTER_TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png({ compressionLevel: 6 })
    .toBuffer();
}
