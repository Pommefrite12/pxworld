/**
 * The final sequence of the "100 days" story: what happens in the seconds after the countdown reaches zero. Pure timeline (no
 * canvas, no React): given the seconds elapsed since the start, how far the sweep has gone, how bright the flash is, how hard the
 * screen shakes. The map engine draws it; the interface follows its stages.
 *
 *   0 → 0.15 s  one white flash (a single one: never flashing)
 *   0 → 0.5 s   the screen shakes, fading
 *   0.2 → 7 s   a sweep crosses the screen from west to east; behind it the land is corrupted
 *   7 s         the end state is permanent; at 8 s the interface says so ("The world has been deleted. N plots survived.")
 */
export const FINALE_SECONDS = 8;
export const SWEEP_START = 0.2;
export const SWEEP_END = 7;
const FLASH_SECONDS = 0.15;
const SHAKE_SECONDS = 0.5;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export interface FinaleFrame {
  /** How far the sweep has gone, 0 (not started) to 1 (the whole screen). */
  sweep: number;
  /** Brightness of the white flash, 1 to 0. */
  flash: number;
  /** Strength of the shake, 1 to 0. */
  shake: number;
  /** The sweep is over: the map is in its end state for good. */
  done: boolean;
}

export function finaleAt(t: number): FinaleFrame {
  return {
    sweep: easeInOut(clamp((t - SWEEP_START) / (SWEEP_END - SWEEP_START), 0, 1)),
    flash: t < 0 || t >= FLASH_SECONDS ? 0 : 1 - t / FLASH_SECONDS,
    shake: t < 0 || t >= SHAKE_SECONDS ? 0 : 1 - t / SHAKE_SECONDS,
    done: t >= SWEEP_END,
  };
}

/** Where the front of the sweep is on a screen `width` pixels wide: just off the left edge at 0, just off the right edge at 1. */
export const frontX = (sweep: number, width: number): number => -80 + sweep * (width + 160);
