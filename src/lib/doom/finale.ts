/**
 * The final sequence of the "100 days" story: what happens in the seconds after the countdown reaches zero. Pure timeline (no
 * canvas, no React): given the seconds elapsed since the start, how far the sweep has gone, how bright the flash is, how hard the
 * screen shakes. The map engine draws it; the interface follows its stages.
 *
 *   0 → 0.45 s     one white flash, held for an instant then fading (a single one: never flashing)
 *   0 → 2.2 s      the screen shakes hard, fading; a low rumble then goes on under the sweep, and three heavy impacts punctuate it
 *   1 → 13.5 s     a sweep crosses the screen from west to east, slowly: behind its front the land is corrupted and every name
 *                  (countries, regions, cities) is erased
 *   13.5 s         the end state is permanent; the interface then says what happened ("The world has been deleted. N plots survived.")
 *
 * For someone who asked for fewer animations the end state simply fades in (0.2 → 3.5 s): no flash, no shake, no sweep.
 */
export const SWEEP_START = 1;
export const SWEEP_END = 13.5;
/** Where the sequence is over for the interface if the map never says so (a page without a map): a safety net. */
export const FINALE_SECONDS = SWEEP_END + 0.5;
const REDUCED_START = 0.2;
const REDUCED_END = 3.5;
const FLASH_HOLD = 0.08; // fully white for this long…
const FLASH_SECONDS = 0.45; // …then it fades, and is gone at this time
const SHAKE_SECONDS = 2.2;
const RUMBLE = 0.1; // the strength of the low shake that goes on under the sweep
const HIT_SECONDS = 0.45;
const HIT_STRENGTH = 0.55;
const HITS = [0.2, 0.5, 0.8]; // the impacts, as fractions of the sweep

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Slow at the start, fastest in the middle, slow at the end: a weight that arrives, passes, and settles. */
const easeInOut = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);

export interface FinaleFrame {
  /** How far the sweep has gone, 0 (not started) to 1 (the whole screen). */
  sweep: number;
  /** Brightness of the white flash, 1 to 0. */
  flash: number;
  /** Strength of the shake, 1 to 0. */
  shake: number;
  /** The sequence is over: the map is in its end state for good. */
  done: boolean;
}

export function finaleAt(t: number, reduced = false): FinaleFrame {
  if (reduced) return { sweep: easeInOut(clamp((t - REDUCED_START) / (REDUCED_END - REDUCED_START - 0.3), 0, 1)), flash: 0, shake: 0, done: t >= REDUCED_END };
  // the first shake: hard, then dying away (a little faster than linear at first, then a long tail)
  let shake = t < 0 || t >= SHAKE_SECONDS ? 0 : Math.pow(1 - t / SHAKE_SECONDS, 1.4);
  const sweepT = (t - SWEEP_START) / (SWEEP_END - SWEEP_START);
  if (sweepT > 0 && sweepT < 1) shake = Math.max(shake, RUMBLE * Math.sin(Math.PI * sweepT)); // a rumble under the whole sweep
  for (const h of HITS) {
    const since = t - (SWEEP_START + h * (SWEEP_END - SWEEP_START));
    if (since >= 0 && since < HIT_SECONDS) shake = Math.max(shake, HIT_STRENGTH * Math.pow(1 - since / HIT_SECONDS, 1.3));
  }
  return {
    sweep: easeInOut(clamp(sweepT, 0, 1)),
    flash: t < 0 || t >= FLASH_SECONDS ? 0 : t < FLASH_HOLD ? 1 : Math.pow(1 - (t - FLASH_HOLD) / (FLASH_SECONDS - FLASH_HOLD), 1.6),
    shake,
    done: t >= SWEEP_END,
  };
}

/**
 * How far the picture is thrown, in pixels and degrees, for a shake of strength `shake` (0 to 1) at time `t`: smooth and heavy,
 * never a random jitter. `side` is the shorter side of the screen: on a phone the throw is smaller (up to half).
 */
export function shakeOffset(t: number, shake: number, side = 1000): { x: number; y: number; rot: number } {
  if (shake <= 0) return { x: 0, y: 0, rot: 0 };
  const k = clamp(side / 900, 0.5, 1);
  const a = Math.sin(t * 24) * 0.6 + Math.sin(t * 53 + 1.3) * 0.4, b = Math.sin(t * 27 + 2.1) * 0.6 + Math.sin(t * 47 + 0.4) * 0.4, c = Math.sin(t * 19 + 0.9);
  return { x: a * 18 * shake * k, y: b * 13 * shake * k, rot: c * 0.45 * shake * k };
}

/** The picture is thrown, so it is scaled up about its centre by just enough to keep its edges out of sight (1 when it is still). */
export function shakeZoom(o: { x: number; y: number; rot: number }, w: number, h: number): number {
  if (o.x === 0 && o.y === 0 && o.rot === 0) return 1;
  const r = Math.sin((Math.abs(o.rot) * Math.PI) / 180);
  return 1 + 2 * Math.max((Math.abs(o.x) + (h / 2) * r) / w, (Math.abs(o.y) + (w / 2) * r) / h) + 0.004;
}

/** Where the front of the sweep is on a screen `width` pixels wide: just off the left edge at 0, just off the right edge at 1. */
export const frontX = (sweep: number, width: number): number => -80 + sweep * (width + 160);

export interface LabelPlan {
  /** The names are drawn whole between these two x (screen px), or not at all (`null`). */
  whole: [number, number] | null;
  /** Names tearing away: drawn faint and jittering between these two x, just behind the front. */
  tearing: [number, number] | null;
  /** Opacity of the names drawn whole (below 1 only while they fade out for someone who asked for fewer animations). */
  alpha: number;
}

/** Which names are still on the screen: those ahead of the front; a few just behind it are tearing away; the rest are gone. */
export function labelPlan(sweep: number, front: number, width: number, reduced: boolean): LabelPlan {
  if (reduced) return { whole: [0, width], tearing: null, alpha: 1 - sweep };
  const x = clamp(front, 0, width);
  return { whole: [x, width], tearing: x > 0 ? [Math.max(0, x - 110), x] : null, alpha: 1 };
}
