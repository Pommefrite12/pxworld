import type { Raster } from "./art";
import { quantize } from "./photo";

/**
 * Pixel art out of a picture that is only "pixel-like": the supplied pictures of the capitals are soft (their art pixels are blurred at the edges and
 * their grid is not quite regular). Made coarser the usual way (average the dots of a block) they turn to mush, because an average of two colours is a
 * third colour that was never drawn. So:
 *   1. the colours are brought down to a palette (no dithering): a few dozen colours, the way pixel art is made;
 *   2. the picture is cut into `cols × cols` blocks, and each block takes the colour MOST of its dots have, never a mix.
 * Pure and deterministic, like the rest of the demonstration kit.
 */

/** The picture with its colours brought down to exactly the `colours` best ones (median cut), no dithering. (The image library only offers 16 or 256.) */
export async function toPalette(r: Raster, colours = 64): Promise<Raster> {
  return quantize(r, colours, 0);
}

/** The colour of every block of a `cols × rows` cutting of `r` (`rows` keeps the proportions): the colour most of the block's dots have; the first met wins a tie. */
export function blockColours(r: Raster, cols: number, rows = Math.max(1, Math.round((cols * r.h) / r.w))): Raster {
  const out = new Uint8Array(cols * rows * 3);
  for (let by = 0; by < rows; by++) {
    const y0 = Math.floor((by * r.h) / rows), y1 = Math.max(y0 + 1, Math.floor(((by + 1) * r.h) / rows));
    for (let bx = 0; bx < cols; bx++) {
      const x0 = Math.floor((bx * r.w) / cols), x1 = Math.max(x0 + 1, Math.floor(((bx + 1) * r.w) / cols));
      const seen = new Map<number, number>();
      let best = 0, bestN = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * r.w + x) * 3, key = (r.data[o]! << 16) | (r.data[o + 1]! << 8) | r.data[o + 2]!;
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        if (n > bestN) { bestN = n; best = key; }
      }
      const o = (by * cols + bx) * 3;
      out[o] = best >> 16; out[o + 1] = (best >> 8) & 255; out[o + 2] = best & 255;
    }
  }
  return { w: cols, h: rows, data: out };
}

/** The blocks enlarged to `w × h` dots, each block a flat square (a whole number of dots when `w` is a multiple of the number of blocks; else, as even as it can be). */
export function enlarge(blocks: Raster, w: number, h: number): Raster {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const by = Math.min(blocks.h - 1, Math.floor((y * blocks.h) / h));
    for (let x = 0; x < w; x++) {
      const bx = Math.min(blocks.w - 1, Math.floor((x * blocks.w) / w)), s = (by * blocks.w + bx) * 3, o = (y * w + x) * 3;
      out[o] = blocks.data[s]!; out[o + 1] = blocks.data[s + 1]!; out[o + 2] = blocks.data[s + 2]!;
    }
  }
  return { w, h, data: out };
}

/** The whole treatment: palette, blocks, then back up to `w × h` dots. */
export async function pixelateRaster(r: Raster, cols: number, w: number, h: number, colours = 64): Promise<Raster> {
  return enlarge(blockColours(await toPalette(r, colours), cols), w, h);
}

/**
 * How many blocks across for a picture made `factor` times coarser than its own pixels, never finer than `max` blocks across: a picture whose pixels are
 * already fine (more than `max × factor` of them across) would otherwise hardly change, and would stay a painting next to the pixel art of the site.
 */
export const blocksAcross = (native: number, factor: number, max = 140, min = 24): number => Math.max(min, Math.min(max, Math.round(native / factor)));

/**
 * `size × k` (a picture is stored at a whole number `k` of dots per grid pixel) cut into blocks of a WHOLE number of dots: the smallest `k` (up to `kMax`),
 * and the number of blocks within `tolerance` of `target`, for which `size × k` is a multiple of it. Null when there is none (then blocks are uneven by a dot).
 */
export function alignedBlocks(size: number, target: number, kMax = 10, tolerance = 0.1): { k: number; cols: number; dots: number } | null {
  const lo = Math.max(1, Math.floor(target * (1 - tolerance))), hi = Math.ceil(target * (1 + tolerance));
  const order = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
  for (let k = 1; k <= kMax; k++) {
    const w = size * k;
    const cols = order.find((c) => w % c === 0);
    if (cols !== undefined) return { k, cols, dots: w / cols };
  }
  return null;
}
