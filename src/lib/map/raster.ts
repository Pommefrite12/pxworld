import "server-only";
import sharp from "sharp";
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
/** Between the two (levels 1 and 2) a parcel of at most 4 px is its colour too; at level 0 (one pixel of the grid is a pixel) only the smallest ones are. */
const flatLimit = (z: number) => (z >= FLAT_FROM_LEVEL ? FLAT_UP_TO_PX : z >= 1 ? 4 : 2);

/** Of the parcels on one tile only this many (the largest) are drawn: a world tile of a crowded map holds tens of thousands, a few hundred thousand would hold the server. */
const MAX_PARCELS_PER_TILE = 30_000;

/** `has_asset`: the parcel shows a published creation (else it is the neutral block); `path`: its file, only when the parcel is big enough on this tile to show the picture. */
interface Row { x: number; y: number; w: number; h: number; kind: string; has_asset: boolean; path: string | null; color: string | null; src_w: number | null }

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

  // The file of a creation is only asked for parcels big enough on this tile to show it (the others are their colour): on a crowded map that is the
  // difference between a few hundred long paths and tens of thousands. (A little lower than the exact test below, which has the last word.)
  const pictureFrom = Math.floor((flatLimit(z) + 0.5) * 2 ** z);
  const rows = await query<Row>(
    `select p.x, p.y, p.w, p.h, p.kind, (p.hidden_at is null and a.id is not null) as has_asset,
            case when p.hidden_at is null and greatest(p.w, p.h) >= $6 then a.storage_path end as path,
            case when p.hidden_at is null then a.avg_color end as color,
            case when p.hidden_at is null then a.width end as src_w
       from public.parcels p left join public.parcel_assets a on a.id = p.published_asset_id
      where p.status = 'active' and p.kind = $5 and p.bbox && box(point($1::float8, $2::float8), point($3::float8, $4::float8))
      order by p.area desc limit ${MAX_PARCELS_PER_TILE}`,
    [x0, y0, x0 + span - 1, y0 + span - 1, kind, pictureFrom],
  );
  if (rows.length === 0) return EMPTY;

  // The tile's own pixels (RGBA). A parcel that is only a colour here (too small to show its picture: most of them on a crowded map) is painted straight
  // into it, with no image made at all; only the parcels that show a picture are resized and copied in. (Parcels never overlap, so the order does not matter.)
  const canvas = Buffer.alloc(RASTER_TILE * RASTER_TILE * 4);
  const paint = (l: number, t: number, w: number, h: number, c: { r: number; g: number; b: number }) => {
    const x1 = Math.min(RASTER_TILE, l + w), y1 = Math.min(RASTER_TILE, t + h);
    for (let y = Math.max(0, t); y < y1; y++) for (let x = Math.max(0, l), o = (y * RASTER_TILE + Math.max(0, l)) * 4; x < x1; x++, o += 4) { canvas[o] = c.r; canvas[o + 1] = c.g; canvas[o + 2] = c.b; canvas[o + 3] = 255; }
  };
  // A picture is resized and copied into the tile's pixels as it is (raw), never encoded and decoded again as an image of its own: that round trip
  // was most of the cost of a tile. (Parcels never overlap, so a copy is what drawing them one over the other would give.)
  const blit = (px: Buffer, w: number, h: number, left: number, top: number) => {
    const x1 = Math.min(RASTER_TILE, left + w), y1 = Math.min(RASTER_TILE, top + h), xs = Math.max(0, left), ys = Math.max(0, top);
    if (x1 <= xs || y1 <= ys) return;
    for (let y = ys; y < y1; y++) px.copy(canvas, (y * RASTER_TILE + xs) * 4, ((y - top) * w + (xs - left)) * 4, ((y - top) * w + (x1 - left)) * 4);
  };
  const queue = [...rows];
  const work = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const left = Math.round((r.x - x0) * scale), top = Math.round((r.y - y0) * scale);
      const w = Math.max(1, Math.round(r.w * scale)), h = Math.max(1, Math.round(r.h * scale));
      if (left >= RASTER_TILE || top >= RASTER_TILE || left + w <= 0 || top + h <= 0) continue;
      if (r.path && (w > flatLimit(z) || h > flatLimit(z))) {
        const bytes = await fetchFile(r.path);
        if (bytes) {
          let img = sharp(bytes);
          if (r.kind === "water") { // the picture as it is shown on water: three blues
            const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            tintPixels(data, 4);
            img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
          }
          const px = await img
            // crisp pixels only when the creation is magnified or kept as is; a finer (half-pixel) creation shown smaller is averaged
            .resize(w, h, { fit: "fill", kernel: z === 0 && (r.src_w ?? 0) <= w ? "nearest" : "lanczos3" })
            .ensureAlpha()
            .raw()
            .toBuffer();
          blit(px, w, h, left, top);
          continue;
        }
      }
      const c = r.kind === "water" ? hexToRgb(tintColor(r.has_asset ? r.color : null)) : r.has_asset ? hexToRgb(r.color) : PLACEHOLDER;
      paint(left, top, w, h, c);
    }
  };
  await Promise.all(Array.from({ length: 12 }, work));

  return sharp(canvas, { raw: { width: RASTER_TILE, height: RASTER_TILE, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();
}
