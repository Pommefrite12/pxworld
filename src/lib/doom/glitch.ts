import { hash2 } from "./corruption";

/**
 * The "computer bug" of the destroyed land: every so often, for about a second, the destroyed zones tear sideways in bands (the
 * coasts' magenta and cyan fringes jump with them), then everything goes back to where it was. It is drawn over the tiles, never
 * baked into them. The envelope rises and falls so that it starts and ends softly.
 */
export const GLITCH_EVERY_MS = 45_000;
export const GLITCH_FOR_MS = 1_300;
/** The picture changes at about 11 images a second: a stutter, not a smooth movement. */
export const GLITCH_FRAME_MS = 90;
/** The most a band slides, in tile pixels (device pixels of the rendering level). */
export const GLITCH_MAX_PX = 44;

export interface GlitchFrame {
  /** Which still picture of the burst this is (its seed). */
  n: number;
  /** 0 → 1 → 0 over the burst. */
  power: number;
}

/** The picture of the burst `elapsed` ms after it began, or `null` once it is over (or before it began). */
export function glitchFrame(elapsed: number): GlitchFrame | null {
  if (!(elapsed >= 0) || elapsed >= GLITCH_FOR_MS) return null;
  return { n: Math.floor(elapsed / GLITCH_FRAME_MS), power: Math.sin((Math.PI * elapsed) / GLITCH_FOR_MS) };
}

/** How far (tile px, to the right when positive) a band of two lattice rows slides in this picture: nothing for most bands. */
export function glitchShift(band: number, frame: GlitchFrame): number {
  if (hash2(band, frame.n, 71) >= 0.1 + 0.4 * frame.power) return 0;
  const sign = hash2(band, frame.n, 72) < 0.5 ? -1 : 1;
  return Math.round(sign * (6 + hash2(band, frame.n, 73) * (GLITCH_MAX_PX - 6)) * Math.max(0.35, frame.power));
}
