import { describe, expect, it } from "vitest";
import { GLITCH_EVERY_MS, GLITCH_FOR_MS, GLITCH_FRAME_MS, GLITCH_MAX_PX, GLITCH_ORBIT_PLACES, GLITCH_ORBIT_PX, glitchFrame, glitchShift, isMagenta, magentaOrbit, splitMagenta } from "@/lib/doom/glitch";

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

  describe("the magenta zones that change place", () => {
    it("takes six different places, one after the other, round a circle, and starts again", () => {
      expect(GLITCH_ORBIT_PLACES).toBe(6);
      const at = (n: number) => magentaOrbit({ n, power: 1 });
      const places = new Set(Array.from({ length: GLITCH_ORBIT_PLACES }, (_, n) => `${at(n).dx},${at(n).dy}`));
      expect(places.size, "six distinct places").toBe(6);
      for (let n = 0; n < 12; n++) expect(at(n)).toEqual(at(n + GLITCH_ORBIT_PLACES)); // it turns: after the sixth, the first again
      for (let n = 0; n < 12; n++) expect(Math.hypot(at(n).dx, at(n).dy)).toBeLessThanOrEqual(GLITCH_ORBIT_PX + 1); // and never far
    });
    it("is nearer its place at the start and at the end of the burst", () => {
      const far = Math.hypot(magentaOrbit({ n: 1, power: 1 }).dx, magentaOrbit({ n: 1, power: 1 }).dy);
      const near = Math.hypot(magentaOrbit({ n: 1, power: 0 }).dx, magentaOrbit({ n: 1, power: 0 }).dy);
      expect(near).toBeLessThan(far);
    });
    it("recognises the error magenta, whole or seen through a little transparency, and nothing else", () => {
      expect(isMagenta(255, 46, 147)).toBe(true);
      expect(isMagenta(253, 126, 180)).toBe(true); // magenta over the cream land at 60 %
      for (const [r, g, b] of [[251, 245, 230], [233, 229, 255], [220, 214, 255], [25, 211, 255], [201, 223, 232], [31, 37, 64], [255, 255, 255], [240, 67, 22]] as const) expect(isMagenta(r, g, b), `${r},${g},${b}`).toBe(false);
    });
    it("takes the magenta out of a picture: the rest keeps the colour next to it, the magenta stays alone", () => {
      const px = (...c: number[][]) => new Uint8ClampedArray(c.flatMap(([r, g, b, a]) => [r!, g!, b!, a ?? 255]));
      const cream = [251, 245, 230], lav = [233, 229, 255], mag = [255, 46, 147];
      const { calm, mag: layer, count } = splitMagenta(px(cream, mag, mag, lav), 4, 1);
      expect(count).toBe(2);
      expect([...calm]).toEqual([...px(cream, cream, cream, lav)]); // the two magenta pixels took the cream on their left
      expect([...layer]).toEqual([0, 0, 0, 0, 255, 46, 147, 255, 255, 46, 147, 255, 0, 0, 0, 0]); // the magenta alone, the rest transparent
      // at the start of a row there is nothing on the left: the neighbour on the right is taken
      expect([...splitMagenta(px(mag, mag, lav), 3, 1).calm]).toEqual([...px(lav, lav, lav)]);
      // transparent pixels (the sea) are never magenta, and a row of nothing but magenta leaves nothing
      expect(splitMagenta(px([255, 46, 147, 0]), 1, 1).count).toBe(0);
      expect([...splitMagenta(px(mag, mag), 2, 1).calm.filter((_, i) => i % 4 === 3)]).toEqual([0, 0]);
      // no magenta: nothing changes
      const plain = px(cream, lav);
      expect(splitMagenta(plain, 2, 1).count).toBe(0);
      expect([...splitMagenta(plain, 2, 1).calm]).toEqual([...plain]);
    });
  });
});
