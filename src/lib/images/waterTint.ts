/**
 * What is shown of a creation on WATER: whatever the buyer drew, wrote or uploaded, a water parcel is displayed in three tints of
 * blue, by lightness: the lightest parts are light blue, the middle ones medium blue, the darkest ones deep blue. The original
 * file is never changed (the owner and the moderators see it; the public sees the blue one). Pure and shared by the server (the
 * pictures it serves, the map's raster tiles) and the browser (the buyer's preview).
 */
export type Rgb = readonly [number, number, number];

/** Light, medium, deep: the only colours a water parcel ever shows. Each stays clearly apart from the pale blue of free ocean. */
export const WATER_TINTS: readonly [Rgb, Rgb, Rgb] = [[127, 200, 240], [47, 143, 216], [27, 79, 156]];
/** Perceived lightness (0–255) above which a pixel is light blue / medium blue (below: deep blue). */
export const LIGHT_FROM = 170, MID_FROM = 87;

/** 0 = light, 1 = medium, 2 = deep. */
export function tintIndex(r: number, g: number, b: number): 0 | 1 | 2 {
  const y = (299 * r + 587 * g + 114 * b) / 1000;
  return y >= LIGHT_FROM ? 0 : y >= MID_FROM ? 1 : 2;
}

/** Replaces every pixel of an RGB(A) buffer by its tint, in place (the alpha channel, if any, is kept). */
export function tintPixels(data: Uint8Array | Uint8ClampedArray, channels: 3 | 4): void {
  for (let i = 0; i + 2 < data.length; i += channels) {
    const t = WATER_TINTS[tintIndex(data[i]!, data[i + 1]!, data[i + 2]!)];
    data[i] = t[0]; data[i + 1] = t[1]; data[i + 2] = t[2];
  }
}

const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
export const TINT_HEX = WATER_TINTS.map(hex) as [string, string, string];

/** The tint of a `#rrggbb` average colour (what the map shows while a picture loads, or far away). Anything else: the medium blue. */
export function tintColor(color: string | null | undefined): string {
  const m = color && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? TINT_HEX[tintIndex(parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16))] : TINT_HEX[1];
}
