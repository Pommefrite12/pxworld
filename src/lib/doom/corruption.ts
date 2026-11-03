/**
 * "100 days to save the world": which part of the land is corrupted, and how a corrupted cell looks (art direction Glitch).
 * Pure functions (no DOM, no canvas) so that the map engine can paint it and the tests can check it.
 *
 * The land is cut into square cells. A large-scale noise field gives every place a *rank* among the land (0 = first to go,
 * 1 = last), uniformly: "30 % intensity" therefore means 30 % of the land, whatever the shape of the continents. A cell is
 * damaged when its rank is below the intensity (see `damage`), so the corrupted area only ever grows with the intensity.
 */
export const WORLD_W = 40_000;

export const GLITCH = {
  cyan: "#19d3ff", magenta: "#ff2e93", lav: "#e9e5ff", lav2: "#dcd6ff", violet: "#6a4cff", ink: "#1f2540", orange: "#f04316", white: "#ffffff",
} as const;

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A deterministic number in [0, 1) from two integers and a salt. */
export function hash2(a: number, b: number, salt = 0): number {
  let t = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(salt | 0, 1274126177)) | 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/** Value noise with one lattice point every `wave` grid px; wraps at the world's width (so `wave` divides 40 000). */
function valueNoise(x: number, y: number, wave: number, seed: number): number {
  const period = WORLD_W / wave, fx = x / wave, fy = y / wave;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
  const col = (i: number) => ((i % period) + period) % period;
  const a = hash2(col(x0), y0, seed), b = hash2(col(x0 + 1), y0, seed), c = hash2(col(x0), y0 + 1, seed), d = hash2(col(x0 + 1), y0 + 1, seed);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** The large-scale field (blobs of 800 to 4 000 px) at a point of the grid, in [0, 1]. */
export function field(x: number, y: number): number {
  return 0.55 * valueNoise(x, y, 4000, 11) + 0.3 * valueNoise(x, y, 2000, 23) + 0.15 * valueNoise(x, y, 800, 37);
}

/** From samples of the field taken over the land, a function giving any value's rank among them, uniform in [0, 1]. */
export function makeRanker(samples: ArrayLike<number>): (v: number) => number {
  const sorted = Float64Array.from(samples as ArrayLike<number>).sort();
  const n = sorted.length;
  return (v) => {
    if (n === 0) return 0.5;
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid]! < v) lo = mid + 1; else hi = mid; }
    return lo / n;
  };
}

/**
 * How damaged a place is, 0 (untouched) to 1 (destroyed), from its rank and the intensity. The slope (a tenth of the ranks)
 * makes a ragged edge of "unstable" cells around the destroyed area. At intensity 1 every place is destroyed.
 */
export function damage(rank: number, intensity: number): number {
  return clamp((intensity * 1.12 - rank) / 0.1, 0, 1);
}

export interface CellLook {
  /** Colour to paint the cell, or `null` to leave the land as it is. */
  fill: string | null;
  /** Fringe the cell with cyan on one side and magenta on the other (a colour channel slipping). */
  split: boolean;
}

const SPARKS = [GLITCH.magenta, GLITCH.cyan, GLITCH.orange, GLITCH.ink, GLITCH.white, GLITCH.violet] as const;

/** What one cell looks like. `h` is the cell's own random number in [0, 1), `row` its row (scanlines alternate). */
export function cellLook(damaged: number, h: number, row: number): CellLook {
  if (damaged >= 0.6) {
    if (h < 0.016) return { fill: SPARKS[Math.min(5, Math.floor((h / 0.016) * 6))]!, split: false }; // a stray block of error colour
    return { fill: row & 1 ? GLITCH.lav2 : GLITCH.lav, split: false }; // the scanlined lavender field
  }
  if (damaged > 0.12) return { fill: null, split: true }; // not gone yet: the colours slip
  if (damaged > 0) return { fill: h < (0.35 * damaged) / 0.12 ? (h < (0.175 * damaged) / 0.12 ? GLITCH.magenta : GLITCH.cyan) : null, split: false }; // the first sparks
  return { fill: null, split: false };
}

/** A band of two rows that has slid sideways: how many cells (0 for most bands), the same wherever it is asked. */
export function tearOffset(band: number, salt: number): number {
  return hash2(band, salt, 5) < 0.3 ? Math.round((hash2(band, salt, 6) - 0.5) * 8) : 0;
}

/** The cell size, in device pixels, that keeps the glitch looking like big pixels on a screen of that density. */
export function cellDevicePx(dpr: number): number { return dpr >= 3 ? 16 : dpr >= 1.5 ? 8 : 4; }

/** The cell is a bit transparent when zoomed right in, so that the land a visitor wants to read and buy stays legible. */
export function levelAlpha(k: number): number { return k <= 2 ? 1 : k === 3 ? 0.9 : k === 4 ? 0.75 : 0.6; }

/**
 * Where the land is destroyed, as horizontal runs of cells of a coarse lattice (`R` × `R` cells over a tile, `(R + 1)²` ranks at
 * their corners): a cell counts as destroyed when its average rank is already half gone (`damage` ≥ 0.5). `i0` inclusive, `i1`
 * exclusive. The coasts only show their chromatic fringe inside these runs.
 */
export function destroyedRuns(lattice: ArrayLike<number>, R: number, intensity: number): { j: number; i0: number; i1: number }[] {
  const runs: { j: number; i0: number; i1: number }[] = [];
  for (let j = 0; j < R; j++) {
    let start = -1;
    for (let i = 0; i <= R; i++) {
      let on = false;
      if (i < R) {
        const b = j * (R + 1) + i, avg = (lattice[b]! + lattice[b + 1]! + lattice[b + R + 1]! + lattice[b + R + 2]!) / 4;
        on = damage(avg, intensity) >= 0.5;
      }
      if (on && start < 0) start = i;
      else if (!on && start >= 0) { runs.push({ j, i0: start, i1: i }); start = -1; }
    }
  }
  return runs;
}

/** How far (device px, to the right if positive) a band of a coast's chromatic fringe has slid: nothing for most bands, a lot for the torn ones. */
export function fringeShift(band: number, k: number, cell: number): number {
  return tearOffset(band, 77 + k) * cell * 0.5;
}

/**
 * How the chromatic fringe of the coasts looks at render level `k`, for big pixels of `cell` device px. Zoomed out (the whole
 * world on screen, `k` ≤ -3) the coasts are close together and a wide fringe turns into a tangle of parallel lines: there it is a
 * thin, tight edge and its bands do not slide. Zoomed in (`k` ≥ 0) it has its full spread and its torn bands.
 */
export function fringeLook(k: number, cell: number): { offset: number; width: number; alpha: number; slide: number } {
  const near = clamp((k + 3) / 3, 0, 1);
  return {
    offset: Math.max(1, Math.round(Math.max(1, cell / 4) + (Math.max(2, cell / 2) - Math.max(1, cell / 4)) * near)),
    width: Math.max(1, Math.max(1.1, cell / 4) + (Math.max(1.6, cell / 3) - Math.max(1.1, cell / 4)) * near),
    alpha: 0.75 + 0.25 * near,
    slide: near,
  };
}
