import { describe, expect, it } from "vitest";
import { GLITCH, WORLD_W, cellDevicePx, cellLook, damage, field, hash2, levelAlpha, makeRanker, tearOffset } from "@/lib/doom/corruption";

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
  it("paints a destroyed cell as scanlined lavender with rare blocks of error colour", () => {
    let sparks = 0;
    for (let i = 0; i < 20_000; i++) {
      const look = cellLook(1, hash2(i, 1), i);
      expect(look.split).toBe(false);
      if (look.fill === GLITCH.lav || look.fill === GLITCH.lav2) expect(look.fill).toBe(i & 1 ? GLITCH.lav2 : GLITCH.lav); // the rows alternate
      else sparks++;
    }
    expect(sparks / 20_000).toBeGreaterThan(0.012);
    expect(sparks / 20_000).toBeLessThan(0.02);
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
});
