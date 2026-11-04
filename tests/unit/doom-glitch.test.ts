import { describe, expect, it } from "vitest";
import { GLITCH_EVERY_MS, GLITCH_FOR_MS, GLITCH_FRAME_MS, GLITCH_MAX_PX, GLITCH_ORBIT_PLACES, GLITCH_ORBIT_PX, GLITCH_SPOTS, glitchFrame, glitchReach, glitchShift, isMagenta, magentaOrbit, pickSpots, splitMagenta } from "@/lib/doom/glitch";

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
      // a magenta pixel seen through transparency (a coast over the sea) covered nothing: nothing is left in the tile, whatever its neighbour
      expect([...splitMagenta(px(cream, [253, 126, 180, 153]), 2, 1).calm]).toEqual([...px(cream, [0, 0, 0, 0])]);
      // transparent pixels (the sea) are never magenta, and a row of nothing but magenta leaves nothing
      expect(splitMagenta(px([255, 46, 147, 0]), 1, 1).count).toBe(0);
      expect([...splitMagenta(px(mag, mag), 2, 1).calm.filter((_, i) => i % 4 === 3)]).toEqual([0, 0]);
      // no magenta: nothing changes
      const plain = px(cream, lav);
      expect(splitMagenta(plain, 2, 1).count).toBe(0);
      expect([...splitMagenta(plain, 2, 1).calm]).toEqual([...plain]);
    });
  });

  describe("every burst touches other places", () => {
    const peak = (seed: number) => glitchFrame(GLITCH_FOR_MS / 2, seed)!;
    const view = { x0: 18_000, y0: 11_000, x1: 24_800, y1: 15_300 }; // a desktop screen at 0.2×

    it("tears other rows from one burst to the next, though each burst is the same every time it is drawn", () => {
      const moved = (seed: number) => new Set(Array.from({ length: 2000 }, (_, b) => b).filter((b) => glitchShift(b, peak(seed)) !== 0));
      const a = moved(1), b = moved(2), a2 = moved(1);
      expect([...a].filter((x) => a2.has(x)).length).toBe(a.size); // same burst, same rows
      const same = [...a].filter((x) => b.has(x)).length;
      expect(same / a.size, "two bursts do not tear the same rows").toBeLessThan(0.6);
    });

    it("touches nothing where the burst does not reach", () => {
      for (let band = 0; band < 500; band++) expect(glitchShift(band, peak(5), 0)).toBe(0);
      let moved = 0;
      for (let band = 0; band < 2000; band++) if (glitchShift(band, peak(5), 1)) moved++;
      let half = 0;
      for (let band = 0; band < 2000; band++) if (glitchShift(band, peak(5), 0.5)) half++;
      expect(half).toBeLessThan(moved); // less is touched at the edge of a zone
    });

    it("draws a few zones that do not overlap, inside the view, and other ones for another burst", () => {
      for (let seed = 1; seed <= 40; seed++) {
        const spots = pickSpots(seed, view);
        expect(spots, `seed ${seed}`).toHaveLength(GLITCH_SPOTS);
        for (const s of spots) { expect(s.x).toBeGreaterThanOrEqual(view.x0); expect(s.x).toBeLessThanOrEqual(view.x1); expect(s.y).toBeGreaterThanOrEqual(view.y0); expect(s.y).toBeLessThanOrEqual(view.y1); }
        for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.y - spots[j]!.y), `seed ${seed}: zones apart`).toBeGreaterThanOrEqual(1.9 * spots[0]!.r - 1e-6);
      }
      expect(pickSpots(7, view)).toEqual(pickSpots(7, view)); // the same burst, the same zones
      const first = new Set(Array.from({ length: 30 }, (_, seed) => `${Math.round(pickSpots(seed, view)[0]!.x / 100)},${Math.round(pickSpots(seed, view)[0]!.y / 100)}`));
      expect(first.size, "other zones from one burst to the next").toBeGreaterThan(20);
      expect(pickSpots(1, { x0: 0, y0: 0, x1: 10, y1: 10 }).length, "even a tiny view gets one").toBeGreaterThanOrEqual(1);
    });

    it("reaches a share of the view, not all of it and not nothing", () => {
      const shares = Array.from({ length: 30 }, (_, seed) => {
        const spots = pickSpots(seed + 1, view);
        let touched = 0, n = 0;
        for (let x = view.x0; x < view.x1; x += 100) for (let y = view.y0; y < view.y1; y += 100) { n++; if (glitchReach(x, y, spots) > 0.5) touched++; }
        return touched / n;
      });
      const mean = shares.reduce((p, c) => p + c, 0) / shares.length;
      expect(mean).toBeGreaterThan(0.1);
      expect(mean).toBeLessThan(0.4);
      expect(Math.max(...shares)).toBeLessThan(0.7);
    });

    it("is full inside a zone, nothing far from it, smooth between, and the world wraps round", () => {
      const spot = [{ x: 1000, y: 1000, r: 500 }];
      expect(glitchReach(1000, 1000, spot)).toBe(1);
      expect(glitchReach(1000 + 0.6 * 500, 1000, spot)).toBe(1);
      expect(glitchReach(1000 + 2 * 500, 1000, spot)).toBe(0);
      const edge = glitchReach(1000 + 0.9 * 500, 1000, spot);
      expect(edge).toBeGreaterThan(0); expect(edge).toBeLessThan(1);
      expect(glitchReach(39_900, 1000, [{ x: 100, y: 1000, r: 500 }]), "200 px away across the antimeridian").toBe(1);
    });

    it("starts the magenta from another of the six places, turning one way or the other, but always through six places", () => {
      const places = (seed: number) => Array.from({ length: 6 }, (_, n) => { const o = magentaOrbit({ n, power: 1, seed }); return `${o.dx},${o.dy}`; });
      for (let seed = 0; seed < 8; seed++) expect(new Set(places(seed)).size, `seed ${seed}`).toBe(6);
      expect(places(1)[0], "another start").not.toBe(places(0)[0]);
      expect(places(2)[0], "another start").not.toBe(places(0)[0]);
      expect(places(1).join("|"), "the other way round").not.toBe(places(0).join("|"));
      const seq = (seed: number) => Array.from({ length: 6 }, (_, n) => magentaOrbit({ n, power: 1, seed }).dy);
      expect(seq(1)).not.toEqual(seq(0));
    });
  });
});
