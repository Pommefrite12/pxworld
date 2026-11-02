import { describe, expect, it } from "vitest";
import { GRID_ALPHA, GRID_FROM_SCALE, GRID_FULL_SCALE, gridAlpha } from "@/lib/map/pixelGrid";

describe("the 1-pixel grid", () => {
  it("is invisible at every zoom except the last stretch (the zoom goes up to ×48)", () => {
    for (const s of [0.03, 0.1, 0.5, 1, 3, 10, 12, 20, 23.9, GRID_FROM_SCALE]) expect(gridAlpha(s), `×${s}`).toBe(0);
  });
  it("fades in over a few steps, then stays", () => {
    expect(gridAlpha((GRID_FROM_SCALE + GRID_FULL_SCALE) / 2)).toBeCloseTo(GRID_ALPHA / 2, 12);
    expect(gridAlpha(GRID_FULL_SCALE)).toBe(GRID_ALPHA);
    expect(gridAlpha(48)).toBe(GRID_ALPHA);
    let last = 0;
    for (let s = 0; s <= 48; s += 0.5) { const a = gridAlpha(s); expect(a).toBeGreaterThanOrEqual(last); last = a; }
  });
  it("starts at the last doubling of the zoom", () => {
    expect(GRID_FROM_SCALE * 2).toBe(48); // MAX_SCALE of the engine
    expect(GRID_FULL_SCALE).toBeLessThan(48);
  });
});
