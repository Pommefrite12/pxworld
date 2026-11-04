import { describe, expect, it } from "vitest";
import { GLITCH_BEATS, GLITCH_EVERY_MS, GLITCH_FOR_MS, GLITCH_FRAME_MS, GLITCH_JOLTS, GLITCH_MAX_PX, glitchBand, glitchFrame, glitchJolt, glitchLift, glitchShift, glitchSplit } from "@/lib/doom/glitch";

const frame = (n: number, seed = 0) => glitchFrame(n * GLITCH_FRAME_MS + 1, seed)!;

describe("the bug of the destroyed land", () => {
  it("happens every 30 seconds and lasts a second and a half", () => {
    expect(GLITCH_EVERY_MS).toBe(30_000);
    expect(GLITCH_FOR_MS).toBeGreaterThanOrEqual(1300);
    expect(GLITCH_FOR_MS).toBeLessThanOrEqual(1800);
    expect(GLITCH_FOR_MS).toBe(GLITCH_BEATS.length * GLITCH_FRAME_MS);
  });

  it("has no picture before it begins nor once it is over; the picture changes about every 90 ms", () => {
    expect(glitchFrame(-1)).toBeNull();
    expect(glitchFrame(Number.NaN)).toBeNull();
    expect(glitchFrame(GLITCH_FOR_MS)).toBeNull();
    expect(glitchFrame(GLITCH_FOR_MS + 5000)).toBeNull();
    expect(glitchFrame(0)!.n).toBe(0);
    expect(glitchFrame(GLITCH_FRAME_MS - 1)!.n).toBe(0);
    expect(glitchFrame(GLITCH_FRAME_MS)!.n).toBe(1);
    expect(glitchFrame(GLITCH_FOR_MS - 1)!.n).toBe(GLITCH_BEATS.length - 1);
  });

  describe("a rhythm, not a smooth movement", () => {
    it("starts and ends softly, hits hard twice, and has a beat of calm between", () => {
      expect(GLITCH_BEATS[0]).toBeLessThan(0.4);
      expect(GLITCH_BEATS[GLITCH_BEATS.length - 1]).toBeLessThan(0.2);
      expect(GLITCH_BEATS.filter((b) => b === 1).length, "hard hits").toBeGreaterThanOrEqual(6);
      expect(GLITCH_BEATS.filter((b) => b <= 0.1).length, "pictures where nearly everything is back in place").toBeGreaterThanOrEqual(2);
      expect(Math.max(...GLITCH_BEATS)).toBe(1);
      for (const b of GLITCH_BEATS) { expect(b).toBeGreaterThanOrEqual(0); expect(b).toBeLessThanOrEqual(1); }
      const calm = GLITCH_BEATS.indexOf(0);
      expect(calm, "a picture where nothing moves at all, in the middle").toBeGreaterThan(4);
      for (let band = 0; band < 400; band++) expect(glitchShift(band, frame(calm))).toBe(0);
    });
  });

  describe("bands", () => {
    it("are of every thickness, the same rows always making the same band", () => {
      const thick = new Map<number, number>();
      for (let row = 0; row < 64 * 8; row++) thick.set(glitchBand(row), (thick.get(glitchBand(row)) ?? 0) + 1);
      expect(new Set(thick.values()), "fine lines and heavy slabs").toEqual(new Set([1, 2, 3, 5]));
      for (let row = 0; row < 500; row++) expect(glitchBand(row)).toBe(glitchBand(row));
      // rows of one band are next to each other
      for (let row = 1; row < 500; row++) if (glitchBand(row) === glitchBand(row - 1)) expect(row >> 3).toBe((row - 1) >> 3);
    });
  });

  describe("tearing", () => {
    it("slides bands sideways by up to 110 px, to the left and to the right, more at the hard hits than at the soft ones", () => {
      const hard = frame(GLITCH_BEATS.indexOf(1)), soft = frame(1);
      let lefts = 0, rights = 0, big = 0, moved = 0, movedSoft = 0;
      for (let band = 0; band < 3000; band++) {
        const dx = glitchShift(band, hard);
        expect(Math.abs(dx)).toBeLessThanOrEqual(GLITCH_MAX_PX);
        if (dx < 0) lefts++; if (dx > 0) rights++; if (Math.abs(dx) > 60) big++; if (dx) moved++;
        if (glitchShift(band, soft)) movedSoft++;
      }
      expect(GLITCH_MAX_PX).toBeGreaterThanOrEqual(100);
      expect(lefts).toBeGreaterThan(300); expect(rights).toBeGreaterThan(300);
      expect(big, "some of them far").toBeGreaterThan(200);
      expect(moved / 3000, "a good part of the bands, not all").toBeGreaterThan(0.4);
      expect(moved / 3000).toBeLessThan(0.75);
      expect(movedSoft).toBeLessThan(moved);
    });

    it("is the same every time a picture is drawn, and tears other rows for another burst", () => {
      const a = frame(6, 11), b = frame(6, 12);
      let differ = 0;
      for (let band = 0; band < 800; band++) { expect(glitchShift(band, a)).toBe(glitchShift(band, a)); if (glitchShift(band, a) !== glitchShift(band, b)) differ++; }
      expect(differ).toBeGreaterThan(300);
    });

    it("makes about one band in four jump up or down as well, at the hard hits only", () => {
      const hard = frame(GLITCH_BEATS.indexOf(1));
      const lifts = Array.from({ length: 2000 }, (_, band) => glitchLift(band, hard)).filter((v) => v !== 0);
      expect(lifts.length / 2000).toBeGreaterThan(0.15);
      expect(lifts.length / 2000).toBeLessThan(0.35);
      expect(Math.max(...lifts.map(Math.abs))).toBeLessThanOrEqual(18);
      expect(lifts.some((v) => v < 0) && lifts.some((v) => v > 0), "up and down").toBe(true);
      const soft = frame(1);
      for (let band = 0; band < 500; band++) expect(glitchLift(band, soft)).toBe(0);
    });
  });

  describe("the extras", () => {
    it("come apart in cyan on one side and magenta on the other, wider for a band that goes further", () => {
      expect(glitchSplit(0)).toBeGreaterThanOrEqual(6);
      expect(glitchSplit(20)).toBeLessThan(glitchSplit(100));
      expect(glitchSplit(-100)).toBe(glitchSplit(100));
      expect(glitchSplit(110)).toBeLessThanOrEqual(60);
    });

    it("jolt the whole picture on a few pictures of the burst, by a few px only, the same every time", () => {
      const jolts = Array.from({ length: GLITCH_BEATS.length }, (_, n) => ({ n, j: glitchJolt(frame(n, 3)) })).filter((x) => x.j);
      expect(jolts.map((x) => x.n)).toEqual([...GLITCH_JOLTS]);
      expect(jolts.length).toBeGreaterThanOrEqual(3);
      for (const { j } of jolts) { expect(Math.abs(j!.x)).toBeLessThanOrEqual(7); expect(Math.abs(j!.y)).toBeLessThanOrEqual(4); }
      expect(glitchJolt(frame(2, 3))).toEqual(glitchJolt(frame(2, 3)));
      expect(glitchJolt(frame(0, 3)), "none at the start").toBeNull();
    });
  });
});
