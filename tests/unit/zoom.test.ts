import { describe, expect, it } from "vitest";
import { MAX_DOT_PX, ZOOM_LEVELS, clampLevel, fitScale, formatLevel, levelsFor } from "@/lib/editor/zoom";

describe("editor zoom: 1× always shows the whole parcel", () => {
  it("fits width AND height: the whole canvas, never a part of it, whatever its shape", () => {
    for (const [w, h] of [[50, 50], [200, 200], [2000, 2000], [4000, 1000], [300, 3000], [1, 1]] as const) {
      const fit = fitScale(w, h, 640, 560);
      expect(w * fit, `${w}x${h} wide`).toBeLessThanOrEqual(640 + 1e-9);
      expect(h * fit, `${w}x${h} tall`).toBeLessThanOrEqual(560 + 1e-9);
      expect(Math.abs(w * fit - 640) < 1e-6 || Math.abs(h * fit - 560) < 1e-6, `${w}x${h} uses the space`).toBe(true); // as large as the space allows
    }
  });

  it("a big parcel is shown smaller than one dot per screen pixel, a tiny one much larger", () => {
    expect(fitScale(2000, 2000, 640, 560)).toBeCloseTo(0.28, 6);
    expect(fitScale(50, 50, 640, 560)).toBeCloseTo(11.2, 6);
  });

  it("offers 1× first, then magnifications up to a dot of MAX_DOT_PX, whatever the fit", () => {
    for (const fit of [0.14, 0.28, 3, 11.2]) {
      const levels = levelsFor(fit);
      expect(levels[0]).toBe(1);
      expect(levels.slice(1).every((l) => l * fit <= MAX_DOT_PX)).toBe(true);
      expect(levels[levels.length - 1]! * fit, `fit ${fit}`).toBeGreaterThan(MAX_DOT_PX / 2.1); // the next level would be too big: nothing is cut short
    }
    expect(levelsFor(0.14).length).toBeGreaterThan(levelsFor(11.2).length); // a huge canvas needs much more zoom to reach a dot
    expect(levelsFor(1000)).toEqual([1]); // never an empty list
  });

  it("is increasing, and the finest dot of the biggest canvas stays reachable", () => {
    expect([...ZOOM_LEVELS].sort((a, b) => a - b)).toEqual(ZOOM_LEVELS);
    expect(levelsFor(fitScale(4000, 1000, 640, 560)).at(-1)! * fitScale(4000, 1000, 640, 560)).toBeGreaterThan(20); // dots of 20+ screen px at the top
  });

  it("keeps the user's zoom when the space changes, never beyond what is offered", () => {
    expect(clampLevel(8, [1, 1.5, 2, 3, 4, 6, 8, 12])).toBe(8);
    expect(clampLevel(8, [1, 1.5, 2, 3, 4, 6])).toBe(6);
    expect(clampLevel(1, [1, 2])).toBe(1);
    expect(clampLevel(0.5, [1, 2])).toBe(1);
  });

  it("labels the level", () => { expect(formatLevel(1)).toBe("1×"); expect(formatLevel(1.5)).toBe("1.5×"); });
});
