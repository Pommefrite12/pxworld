import { describe, expect, it } from "vitest";
import { FINALE_SECONDS, SWEEP_END, SWEEP_START, finaleAt, frontX } from "@/lib/doom/finale";

describe("the final sequence timeline", () => {
  it("does nothing before it starts and ends with the sweep complete", () => {
    expect(finaleAt(-1)).toEqual({ sweep: 0, flash: 0, shake: 0, done: false });
    expect(finaleAt(0).sweep).toBe(0);
    expect(finaleAt(SWEEP_START).sweep).toBe(0);
    expect(finaleAt(SWEEP_END)).toMatchObject({ sweep: 1, done: true });
    expect(finaleAt(60)).toMatchObject({ sweep: 1, done: true });
    expect(FINALE_SECONDS).toBeGreaterThan(SWEEP_END);
  });
  it("sweeps from west to east, only ever forward, slowly at the start and at the end", () => {
    let last = -1;
    for (let t = 0; t <= 8; t += 0.05) { const s = finaleAt(t).sweep; expect(s).toBeGreaterThanOrEqual(last); last = s; }
    expect(finaleAt(SWEEP_START + 0.3).sweep).toBeLessThan(0.02);
    expect(finaleAt((SWEEP_START + SWEEP_END) / 2).sweep).toBeCloseTo(0.5, 6);
    expect(finaleAt(SWEEP_END - 0.3).sweep).toBeGreaterThan(0.98);
  });
  it("flashes once, for a fraction of a second at the very start — never a strobe", () => {
    let flashing = 0;
    for (let t = 0; t <= 8; t += 0.01) if (finaleAt(t).flash > 0) flashing++;
    expect(flashing * 0.01).toBeLessThan(0.2);
    expect(finaleAt(0).flash).toBe(1);
    expect(finaleAt(0.15).flash).toBe(0);
    for (let t = 0.15; t <= 8; t += 0.05) expect(finaleAt(t).flash).toBe(0); // it never comes back
  });
  it("shakes for half a second, fading", () => {
    expect(finaleAt(0).shake).toBe(1);
    expect(finaleAt(0.25).shake).toBeCloseTo(0.5, 6);
    expect(finaleAt(0.5).shake).toBe(0);
    expect(finaleAt(3).shake).toBe(0);
  });
  it("puts the front of the sweep just off the left edge at the start and just off the right edge at the end", () => {
    expect(frontX(0, 1360)).toBeLessThan(0);
    expect(frontX(1, 1360)).toBeGreaterThan(1360);
    expect(frontX(0.5, 1360)).toBeCloseTo(680, 6);
    let last = -Infinity;
    for (let s = 0; s <= 1; s += 0.1) { const x = frontX(s, 800); expect(x).toBeGreaterThan(last); last = x; }
  });
});
