import { describe, expect, it } from "vitest";
import { DOOM_DAYS, infection, parseEnd, pad2, phaseOf, previewEnd, remaining } from "@/lib/doom/clock";

const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000, SEC = 1000;
const NOW = Date.UTC(2026, 10, 3, 9, 0, 0);

describe("the countdown clock", () => {
  it("splits what is left into days, hours, minutes and seconds", () => {
    const r = remaining(NOW + 87 * DAY + 14 * HOUR + 32 * MIN + 9 * SEC + 500, NOW);
    expect(r).toMatchObject({ days: 87, hours: 14, minutes: 32, seconds: 9, over: false });
    expect(remaining(NOW + 59 * SEC, NOW)).toMatchObject({ days: 0, hours: 0, minutes: 0, seconds: 59, over: false });
  });
  it("reaches zero exactly at the end and never goes negative", () => {
    expect(remaining(NOW, NOW)).toMatchObject({ ms: 0, days: 0, hours: 0, minutes: 0, seconds: 0, over: true });
    expect(remaining(NOW - 5 * DAY, NOW)).toMatchObject({ ms: 0, over: true });
    expect(remaining(NOW + 1, NOW).over).toBe(false); // one millisecond before the end is still the last second
  });
  it("tells the chapters of the story apart at their boundaries", () => {
    const at = (days: number) => phaseOf(remaining(NOW + days * DAY + HOUR, NOW));
    expect([100, 87, 76].map(at)).toEqual([1, 1, 1]);
    expect([75, 50, 31].map(at)).toEqual([2, 2, 2]);
    expect([30, 20, 8].map(at)).toEqual([3, 3, 3]);
    expect([7, 3, 1, 0].map(at)).toEqual([4, 4, 4, 4]); // the last week, up to the very last hour
    expect(phaseOf(remaining(NOW, NOW))).toBe(5);
  });
  it("reads a date from the configuration, and only a date", () => {
    expect(parseEnd("2027-02-11T12:00:00Z")).toBe(Date.UTC(2027, 1, 11, 12));
    expect(parseEnd("2027-02-11T12:00:00+01:00")).toBe(Date.UTC(2027, 1, 11, 11));
    for (const bad of [undefined, null, "", "soon", "31/12/2027x"]) expect(parseEnd(bad), String(bad)).toBeNull();
  });
  it("previews a chapter: J-9, 9, 0, fin; anything else means nothing", () => {
    for (const v of ["J-9", "j-9", "9", " J9 "]) expect(remaining(previewEnd(v, NOW)!, NOW), v).toMatchObject({ days: 9, hours: 6, minutes: 41, seconds: 27 });
    for (const v of ["0", "J0", "fin", "OVER"]) {
      expect(remaining(previewEnd(v, NOW)!, NOW).over, v).toBe(true);
      expect(remaining(previewEnd(v, NOW)!, NOW - 999).over, `${v}: even with a clock a second behind`).toBe(true);
    }
    expect(remaining(previewEnd("J-250", NOW)!, NOW).days).toBe(DOOM_DAYS); // never more than the story lasts
    for (const v of [undefined, "", "bientôt", "J-x", "-5"]) expect(previewEnd(v, NOW), String(v)).toBeNull();
  });
  it("corrupts the land slowly at first, then faster, and all of it at the end", () => {
    const at = (days: number) => infection(remaining(NOW + days * DAY, NOW));
    expect(at(87)).toBeGreaterThan(0.03);
    expect(at(87)).toBeLessThan(0.06);
    expect(at(9)).toBeGreaterThan(0.44);
    expect(at(9)).toBeLessThan(0.52);
    expect(at(0.5)).toBeLessThan(0.6);
    let last = 0;
    for (let d = 100; d >= 1; d--) { const v = at(d); expect(v).toBeGreaterThanOrEqual(last); last = v; }
    expect(infection(remaining(NOW, NOW))).toBe(1);
  });
  it("pads to two digits", () => {
    expect([0, 7, 10, 99, 100].map(pad2)).toEqual(["00", "07", "10", "99", "100"]);
  });
});
