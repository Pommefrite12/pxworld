import { describe, expect, it } from "vitest";
import { GLITCH, WORLD_W, cellDevicePx, cellLook, damage, destroyedRuns, field, fringeLook, fringeShift, hash2, levelAlpha, makeRanker, tearOffset } from "@/lib/doom/corruption";

describe("the large-scale field", () => {
  it("is deterministic, stays in [0, 1] and wraps around the world", () => {
    for (let i = 0; i < 400; i++) {
      const x = hash2(i, 1) * WORLD_W, y = hash2(i, 2) * 25_000, v = field(x, y);
      expect(v).toBe(field(x, y));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const y of [0, 5000, 12_345, 24_999]) expect(field(0, y)).toBeCloseTo(field(WORLD_W, y), 9); // no seam at the antimeridian
    expect(field(-1000, 3000)).toBeCloseTo(field(WORLD_W - 1000, 3000), 9);
  });
  it("is smooth: neighbouring places have neighbouring values", () => {
    for (let i = 0; i < 200; i++) { const x = hash2(i, 3) * WORLD_W, y = hash2(i, 4) * 25_000; expect(Math.abs(field(x + 20, y) - field(x, y))).toBeLessThan(0.02); }
  });
});

describe("rank among the land", () => {
  it("is uniform: the median is 0.5, the extremes 0 and 1, and it only goes up", () => {
    const samples = Array.from({ length: 5000 }, (_, i) => field(hash2(i, 7) * WORLD_W, hash2(i, 8) * 25_000));
    const rank = makeRanker(samples);
    const sorted = [...samples].sort((a, b) => a - b);
    expect(rank(sorted[2500]!)).toBeCloseTo(0.5, 2);
    expect(rank(-1)).toBe(0);
    expect(rank(2)).toBe(1);
    let last = -1;
    for (let v = 0; v <= 1; v += 0.01) { const r = rank(v); expect(r).toBeGreaterThanOrEqual(last); last = r; }
    expect(makeRanker([])(0.3)).toBe(0.5);
  });
  it("makes 'intensity 30 %' mean 30 % of the land", () => {
    const samples = Array.from({ length: 8000 }, (_, i) => field(hash2(i, 9) * WORLD_W, hash2(i, 10) * 25_000));
    const rank = makeRanker(samples);
    for (const I of [0.036, 0.1, 0.3, 0.476, 0.58]) {
      const destroyed = samples.filter((v) => damage(rank(v), I) >= 0.6).length / samples.length;
      expect(destroyed, `intensity ${I}`).toBeGreaterThan(I * 1.12 - 0.1 - 0.02);
      expect(destroyed, `intensity ${I}`).toBeLessThan(I * 1.12 - 0.06 + 0.02);
    }
  });
});

describe("damage and the look of a cell", () => {
  it("only grows with the intensity, and is total at the end and nil at the start", () => {
    for (let r = 0; r < 1; r += 0.05) {
      let last = 0;
      for (let I = 0; I <= 1; I += 0.05) { const d = damage(r, I); expect(d).toBeGreaterThanOrEqual(last); last = d; }
      expect(damage(r, 1)).toBe(1);
      expect(damage(r, 0)).toBe(0);
    }
  });
  it("paints a destroyed cell as scanlined lavender and nothing else: no stray blocks of colour", () => {
    for (let i = 0; i < 20_000; i++) {
      const look = cellLook(1, hash2(i, 1), i);
      expect(look.split).toBe(false);
      expect(look.fill).toBe(i & 1 ? GLITCH.lav2 : GLITCH.lav); // the rows alternate, whatever the cell's own random number
    }
  });
  it("leaves intact land alone, slips the colours of a cell about to go, and sparks at the very start", () => {
    for (let i = 0; i < 500; i++) expect(cellLook(0, hash2(i, 2), i)).toEqual({ fill: null, split: false });
    expect(cellLook(0.4, 0.5, 3)).toEqual({ fill: null, split: true });
    let sparks = 0;
    for (let i = 0; i < 20_000; i++) { const f = cellLook(0.1, hash2(i, 3), i).fill; if (f) { sparks++; expect([GLITCH.magenta, GLITCH.cyan]).toContain(f); } }
    expect(sparks / 20_000).toBeGreaterThan(0.2);
    expect(sparks / 20_000).toBeLessThan(0.4);
  });
  it("tears some bands sideways, always the same way for the same band", () => {
    const offsets = Array.from({ length: 2000 }, (_, b) => tearOffset(b, 3));
    expect(offsets).toEqual(Array.from({ length: 2000 }, (_, b) => tearOffset(b, 3)));
    const moved = offsets.filter((o) => o !== 0).length / offsets.length;
    expect(moved).toBeGreaterThan(0.15);
    expect(moved).toBeLessThan(0.3);
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(4);
  });
  it("keeps big pixels on any screen, and fades a little when zoomed right in", () => {
    expect([1, 1.25, 1.5, 2, 2.5, 3].map(cellDevicePx)).toEqual([4, 4, 8, 8, 8, 16]);
    for (const dpr of [1, 1.5, 2, 3]) expect(512 % cellDevicePx(dpr)).toBe(0); // a tile holds a whole number of cells
    expect([0, 2, 3, 4, 5, 8].map(levelAlpha)).toEqual([1, 1, 0.9, 0.75, 0.6, 0.6]);
  });
  describe("the chromatic fringe of the coasts", () => {
    const R = 8;
    /** A lattice whose rank grows from left to right: the left of the tile goes first. */
    const gradient = Array.from({ length: (R + 1) * (R + 1) }, (_, n) => (n % (R + 1)) / R);
    it("only marks the stretches of the tile where the land is destroyed, as runs of cells that grow with the intensity", () => {
      expect(destroyedRuns(gradient, R, 0)).toEqual([]); // nothing destroyed: clean coasts
      const some = destroyedRuns(gradient, R, 0.5), more = destroyedRuns(gradient, R, 0.8);
      expect(some).toHaveLength(R); // one run per row
      for (const run of some) { expect(run.i0).toBe(0); expect(run.i1).toBeGreaterThan(0); expect(run.i1).toBeLessThan(R); }
      for (let j = 0; j < R; j++) expect(more[j]!.i1).toBeGreaterThan(some[j]!.i1);
      for (const run of destroyedRuns(gradient, R, 1)) expect(run).toEqual({ j: run.j, i0: 0, i1: R }); // everything is destroyed at the end
    });
    it("merges neighbouring cells into one run and keeps separate stretches apart", () => {
      const ranks = new Array((R + 1) * (R + 1)).fill(1);
      for (let j = 0; j <= 1; j++) for (const i of [0, 1, 2, 5, 6]) ranks[j * (R + 1) + i] = 0; // row 0: cells 0–1 and 5 are destroyed
      expect(destroyedRuns(ranks, R, 0.2).filter((r) => r.j === 0)).toEqual([{ j: 0, i0: 0, i1: 2 }, { j: 0, i0: 5, i1: 6 }]);
    });
    it("slides some rows of the fringe sideways, the same way every time, never by more than half a torn band", () => {
      const shifts = Array.from({ length: 2000 }, (_, row) => fringeShift(row, 3, 4));
      expect(shifts).toEqual(Array.from({ length: 2000 }, (_, row) => fringeShift(row, 3, 4)));
      const moved = shifts.filter((x) => x !== 0).length / shifts.length;
      expect(moved).toBeGreaterThan(0.15);
      expect(moved).toBeLessThan(0.3);
      expect(Math.max(...shifts.map(Math.abs))).toBeLessThanOrEqual(8);
      expect(fringeShift(40, 3, 8)).toBe(fringeShift(40, 3, 4) * 2); // proportional to the size of the big pixels
    });
    it("is a thin, tight edge when zoomed out, whatever the screen, and only spreads and slides as one zooms in", () => {
      for (const cell of [4, 8, 16]) {
        let last = fringeLook(-5, cell);
        expect(last.slide, "no sliding bands with the whole world on screen").toBe(0);
        expect(last.offset, "the two echoes hug the coast").toBeLessThanOrEqual(Math.max(1, cell / 4));
        for (let k = -4; k <= 6; k++) {
          const f = fringeLook(k, cell);
          expect(f.offset).toBeGreaterThanOrEqual(last.offset);
          expect(f.width).toBeGreaterThanOrEqual(last.width);
          expect(f.alpha).toBeGreaterThanOrEqual(last.alpha);
          expect(f.slide).toBeGreaterThanOrEqual(last.slide);
          last = f;
        }
        expect(fringeLook(-3, cell).slide).toBe(0);
        expect(fringeLook(0, cell)).toMatchObject({ offset: Math.max(2, cell / 2), alpha: 1, slide: 1 });
        expect(fringeLook(3, cell)).toEqual(fringeLook(0, cell));
      }
      expect(fringeLook(-5, 4).offset).toBe(1); // at the usual density: one pixel each side
    });
  });
});
