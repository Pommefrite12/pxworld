import { hash2 } from "./corruption";

/**
 * The "computer bug" of the destroyed land. Every `GLITCH_EVERY_MS`, for about a second and a half, the destroyed land TEARS: bands
 * of every thickness slide sideways by up to 110 px (some also jump up or down), in jerks, to a rhythm — a warm-up, two hard hits,
 * a beat of calm, a collapse, a last flicker — and on a machine that can afford it the torn bands come apart in cyan and magenta
 * (an RGB split, on the land only) and the picture takes a few jolts. Then everything snaps back to where it was. It is drawn over the
 * tiles, never baked into them, and each burst tears other rows than the one before (its `seed`).
 */
export const GLITCH_EVERY_MS = 30_000;
/** The picture changes at about 11 images a second: a stutter, not a smooth movement. */
export const GLITCH_FRAME_MS = 90;
/**
 * How strong each picture of the burst is, 0 to 1: a warm-up, two hard hits with a beat of calm between (a picture where everything is
 * back in place, then it tears again), a collapse, and a last flicker.
 */
export const GLITCH_BEATS = [0.2, 0.5, 1, 1, 0.1, 1, 1, 0.85, 0, 1, 1, 0.75, 1, 0.5, 0.25, 0.1] as const;
export const GLITCH_FOR_MS = GLITCH_BEATS.length * GLITCH_FRAME_MS;
/** The most a band slides, in tile pixels (device pixels of the rendering level). */
export const GLITCH_MAX_PX = 110;
/** The pictures that give the whole map a jolt (on a machine that can afford it). */
export const GLITCH_JOLTS: readonly number[] = [2, 5, 9, 12];

export interface GlitchFrame {
  /** Which still picture of the burst this is. */
  n: number;
  /** How strong it is, 0 → 1 (`GLITCH_BEATS`). */
  power: number;
  /** Which burst this is: every burst tears other rows than the one before (0 when not given). */
  seed?: number;
}

/** The picture of the burst `elapsed` ms after it began, or `null` once it is over (or before it began). */
export function glitchFrame(elapsed: number, seed = 0): GlitchFrame | null {
  if (!(elapsed >= 0) || elapsed >= GLITCH_FOR_MS) return null;
  const n = Math.floor(elapsed / GLITCH_FRAME_MS);
  return { n, power: GLITCH_BEATS[Math.min(n, GLITCH_BEATS.length - 1)]!, seed };
}

/**
 * Which band a row of the tile's lattice belongs to: bands are 1, 2, 3 or 5 rows thick (a mix of fine lines and heavy slabs), the
 * thickness drawn from the row's group of eight, so that the same rows always make the same band.
 */
export function glitchBand(row: number): number {
  const group = row >> 3, thick = [1, 2, 3, 5][Math.floor(hash2(group, 0, 81) * 4)]!;
  return group * 16 + Math.floor((row & 7) / thick);
}

const salt = (frame: GlitchFrame) => Math.imul(frame.seed ?? 0, 7919);

/** How far (tile px, to the right when positive) a band slides in this picture: nothing for the bands the burst leaves alone. */
export function glitchShift(band: number, frame: GlitchFrame): number {
  if (frame.power <= 0 || hash2(band, frame.n, 71 + salt(frame)) >= 0.12 + 0.5 * frame.power) return 0;
  const sign = hash2(band, frame.n, 72 + salt(frame)) < 0.5 ? -1 : 1;
  return Math.round(sign * (8 + hash2(band, frame.n, 73 + salt(frame)) * (GLITCH_MAX_PX - 8)) * Math.max(0.3, frame.power));
}

/** How far (tile px, down when positive) a band that is torn sideways also jumps up or down: for about one in four of them. */
export function glitchLift(band: number, frame: GlitchFrame): number {
  if (frame.power < 0.7 || hash2(band, frame.n, 74 + salt(frame)) >= 0.25) return 0;
  return Math.round((hash2(band, frame.n, 75 + salt(frame)) - 0.5) * 36);
}

/** The cyan and the magenta come apart from a band that slides by `dx`: how far to the left and to the right of it, in tile px. */
export function glitchSplit(dx: number): number {
  return Math.max(6, Math.round(Math.abs(dx) * 0.45));
}

/** The jolt of the whole picture in this picture of the burst (px, a few at most), or `null` when there is none. */
export function glitchJolt(frame: GlitchFrame): { x: number; y: number } | null {
  if (!GLITCH_JOLTS.includes(frame.n)) return null;
  const s = salt(frame);
  return { x: Math.round((hash2(frame.n, 1, 91 + s) - 0.5) * 14), y: Math.round((hash2(frame.n, 2, 92 + s) - 0.5) * 8) };
}
