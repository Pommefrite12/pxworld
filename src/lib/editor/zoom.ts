/**
 * Zoom of an editing canvas, relative to the parcel: 1× is the zoom at which the WHOLE parcel is visible in the space
 * available, whatever its size (a 5 × 5 pixel parcel and a 1 000 × 250 one both fit at 1×); the next levels magnify from
 * there, up to the point where a single dot is large enough to paint comfortably.
 */
export const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];

/** Largest on-screen size (screen pixels) of one dot that is worth offering. */
export const MAX_DOT_PX = 48;

/** Screen pixels per dot when the whole canvas of `dotsW × dotsH` dots fits in `roomW × roomH` (never zero). */
export function fitScale(dotsW: number, dotsH: number, roomW: number, roomH: number): number {
  return Math.max(0.01, Math.min(roomW / Math.max(1, dotsW), roomH / Math.max(1, dotsH)));
}

/** The levels on offer for a given fit: 1× always, then up to the one that makes a dot MAX_DOT_PX wide. */
export function levelsFor(fit: number): number[] {
  return ZOOM_LEVELS.filter((l, i) => i === 0 || l * fit <= MAX_DOT_PX);
}

/** The offered level closest below (or equal to) `level`: keeps the user's zoom when the available space changes. */
export function clampLevel(level: number, levels: number[]): number {
  let best = levels[0] ?? 1;
  for (const l of levels) if (l <= level) best = l;
  return best;
}

export const formatLevel = (l: number): string => `${l}×`;
