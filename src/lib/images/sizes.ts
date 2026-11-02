/**
 * Sizes (longest side, in pixels) of the shrunk variants of a creation that clients may ask for with `?max=` on
 * /api/assets/:id. A small fixed set, so that variants are cacheable by the CDN.
 */
export const ASSET_SIZES = [64, 128, 256, 512, 1024, 2048] as const;

/** The smallest size that still covers `need` device pixels (the largest one when nothing does). */
export function assetSizeFor(need: number): (typeof ASSET_SIZES)[number] {
  return ASSET_SIZES.find((s) => s >= need) ?? ASSET_SIZES[ASSET_SIZES.length - 1]!;
}

/** URL of a creation, optionally shrunk so that it never carries more pixels than `need` device pixels (thumbnails, parcels seen from afar). */
export const assetUrl = (id: string, need?: number): string => (need === undefined ? `/api/assets/${id}` : `/api/assets/${id}?max=${assetSizeFor(need)}`);
