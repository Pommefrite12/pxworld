import { describe, expect, it } from "vitest";
import { GLITCH_EVERY_MS, GLITCH_FOR_MS, GLITCH_FRAME_MS, GLITCH_MAX_PX, glitchFrame, glitchShift } from "@/lib/doom/glitch";

describe("the bug of the destroyed land", () => {
  it("happens every 30 seconds and lasts about a second", () => {
    expect(GLITCH_EVERY_MS).toBe(30_000);
    expect(GLITCH_FOR_MS).toBeGreaterThanOrEqual(800);
    expect(GLITCH_FOR_MS).toBeLessThanOrEqual(2000);
  });

  it("has no picture before it begins nor once it is over", () => {
    expect(glitchFrame(-1)).toBeNull();
    expect(glitchFrame(Number.NaN)).toBeNull();
    expect(glitchFrame(GLITCH_FOR_MS)).toBeNull();
    expect(glitchFrame(GLITCH_FOR_MS + 5000)).toBeNull();
    expect(glitchFrame(0)).not.toBeNull();
    expect(glitchFrame(GLITCH_FOR_MS - 1)).not.toBeNull();
  });

  it("rises and falls: soft at both ends, strongest in the middle", () => {
    expect(glitchFrame(0)!.power).toBeCloseTo(0, 5);
    expect(glitchFrame(GLITCH_FOR_MS / 2)!.power).toBeCloseTo(1, 5);
    expect(glitchFrame(GLITCH_FOR_MS - 1)!.power).toBeLessThan(0.01);
    for (let t = 0; t < GLITCH_FOR_MS; t += 25) { const p = glitchFrame(t)!.power; expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
  });

  it("changes picture about every 90 ms (a stutter), and keeps the same picture in between", () => {
    expect(glitchFrame(0)!.n).toBe(0);
    expect(glitchFrame(GLITCH_FRAME_MS - 1)!.n).toBe(0);
    expect(glitchFrame(GLITCH_FRAME_MS)!.n).toBe(1);
    expect(glitchFrame(GLITCH_FRAME_MS * 3 + 5)!.n).toBe(3);
  });

  it("slides only some bands, by a bounded amount, the same way each time it is asked", () => {
    const peak = glitchFrame(GLITCH_FOR_MS / 2)!;
    let moved = 0;
    for (let band = 0; band < 2000; band++) {
      const dx = glitchShift(band, peak);
      expect(dx).toBe(glitchShift(band, peak)); // deterministic: a picture is the same every time it is drawn
      expect(Math.abs(dx)).toBeLessThanOrEqual(GLITCH_MAX_PX);
      if (dx) { moved++; expect(Math.abs(dx)).toBeGreaterThanOrEqual(5); }
    }
    expect(moved / 2000).toBeGreaterThan(0.3); // at the peak, a good part of the bands slide…
    expect(moved / 2000).toBeLessThan(0.6); // …but never all of them
  });

  it("slides fewer bands at the beginning and at the end than in the middle, and each picture is different", () => {
    const share = (t: number) => { const f = glitchFrame(t)!; let n = 0; for (let b = 0; b < 3000; b++) if (glitchShift(b, f)) n++; return n / 3000; };
    expect(share(1)).toBeLessThan(share(GLITCH_FOR_MS / 2));
    expect(share(GLITCH_FOR_MS - 1)).toBeLessThan(share(GLITCH_FOR_MS / 2));
    const a = glitchFrame(GLITCH_FOR_MS / 2)!, b = glitchFrame(GLITCH_FOR_MS / 2 + GLITCH_FRAME_MS)!;
    let differ = 0;
    for (let band = 0; band < 500; band++) if (glitchShift(band, a) !== glitchShift(band, b)) differ++;
    expect(differ).toBeGreaterThan(100);
  });
});
