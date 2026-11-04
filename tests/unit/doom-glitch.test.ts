import { describe, expect, it } from "vitest";
import { GLITCH_EVERY_MS, GLITCH_FOR_MS, GLITCH_FRAME_MS, GLITCH_JERKS, GLITCH_MAX_PX, GLITCH_TRAVEL, GLITCH_ZONES, GLITCH_SCROLL, bugBands, glitchFrame, glitchShift, jerk, pickZones, zoneNow } from "@/lib/doom/glitch";

const W = 40_000, H = 25_000;
const view = { x0: 18_000, y0: 11_000, x1: 24_800, y1: 15_300 }; // a desktop screen at 0.2×
const frameAt = (progress: number, seed = 0) => glitchFrame(progress * GLITCH_FOR_MS - 0.001, seed) ?? glitchFrame(0, seed)!;

describe("the bug of the destroyed land", () => {
  it("happens every 30 seconds and lasts a second or two", () => {
    expect(GLITCH_EVERY_MS).toBe(30_000);
    expect(GLITCH_FOR_MS).toBeGreaterThanOrEqual(1000);
    expect(GLITCH_FOR_MS).toBeLessThanOrEqual(2000);
  });

  it("has no picture before it begins nor once it is over, and goes from 0 to 1", () => {
    expect(glitchFrame(-1)).toBeNull();
    expect(glitchFrame(Number.NaN)).toBeNull();
    expect(glitchFrame(GLITCH_FOR_MS)).toBeNull();
    expect(glitchFrame(GLITCH_FOR_MS + 5000)).toBeNull();
    expect(glitchFrame(0)!.progress).toBe(0);
    expect(glitchFrame(GLITCH_FOR_MS - 1)!.progress).toBeGreaterThan(0.99);
    expect(glitchFrame(GLITCH_FRAME_MS - 1)!.n).toBe(0);
    expect(glitchFrame(GLITCH_FRAME_MS)!.n).toBe(1);
  });

  describe("jerks", () => {
    it("never go back, start at nothing and end far on", () => {
      for (let seed = 0; seed < 20; seed++) for (let salt = 0; salt < 10; salt++) {
        let last = -1;
        for (let p = 0; p <= 1; p += 0.01) { const j = jerk(p, salt, seed); expect(j).toBeGreaterThanOrEqual(last); last = j; }
        expect(jerk(0, salt, seed)).toBe(0);
        expect(last).toBeGreaterThanOrEqual((GLITCH_JERKS - 1) / GLITCH_JERKS);
        expect(last).toBeLessThanOrEqual(1);
      }
    });
    it("stay on a value, then jump: a stutter, not a smooth movement", () => {
      const values = new Set(Array.from({ length: 101 }, (_, i) => jerk(i / 100, 3, 5)));
      expect(values.size).toBeLessThanOrEqual(GLITCH_JERKS + 1);
      expect(values.size).toBeGreaterThanOrEqual(4);
    });
  });

  describe("the land inside a bugged zone slides from right to left", () => {
    it("only ever to the LEFT, never past the limit, nothing outside the zones", () => {
      for (let seed = 0; seed < 5; seed++) for (let n = 0; n < 16; n++) for (let band = 0; band < 150; band++) {
        const f = { n, progress: n / 15.5, seed };
        const dx = glitchShift(band, f);
        expect(dx).toBeLessThanOrEqual(0);
        expect(dx).toBeGreaterThanOrEqual(-GLITCH_MAX_PX);
        expect(glitchShift(band, f, 0), "outside the zones").toBe(0);
      }
    });
    it("goes further to the left as the burst goes on (a band that blinks back is the only exception)", () => {
      let checked = 0;
      for (let band = 0; band < 600; band++) {
        let last = 0;
        for (let n = 0; n < 16; n++) {
          const dx = glitchShift(band, { n, progress: n / 15.5, seed: 4 });
          if (dx === 0) continue; // at its place for this picture
          expect(dx, `band ${band}`).toBeLessThanOrEqual(last);
          last = Math.min(last, dx);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(500);
    });
    it("moves most of the bands, not all, each at its own speed", () => {
      const f = frameAt(0.95, 3);
      const moved = Array.from({ length: 2000 }, (_, band) => glitchShift(band, f)).filter((v) => v !== 0);
      expect(moved.length / 2000).toBeGreaterThan(0.4);
      expect(moved.length / 2000).toBeLessThan(0.75);
      expect(new Set(moved).size, "many different speeds").toBeGreaterThan(10);
    });
    it("is the same every time a picture is drawn, and not the same from one burst to the next", () => {
      const f = frameAt(0.8, 7), g = frameAt(0.8, 8);
      let differ = 0;
      for (let band = 0; band < 600; band++) { expect(glitchShift(band, f)).toBe(glitchShift(band, f)); if (glitchShift(band, f) !== glitchShift(band, g)) differ++; }
      expect(differ).toBeGreaterThan(200);
    });
  });

  describe("the bugged zones are anywhere on the planisphere", () => {
    it("are a few rectangles of a good size, inside the world, the same for the same burst", () => {
      for (let seed = 1; seed <= 60; seed++) {
        const zones = pickZones(seed, view);
        expect(zones).toHaveLength(GLITCH_ZONES);
        for (const z of zones) {
          expect(z.w / W).toBeGreaterThanOrEqual(0.16); expect(z.w / W).toBeLessThanOrEqual(0.32);
          expect(z.h / H).toBeGreaterThanOrEqual(0.14); expect(z.h / H).toBeLessThanOrEqual(0.26);
          expect(z.x).toBeGreaterThanOrEqual(0); expect(z.x).toBeLessThan(W);
          expect(z.y).toBeGreaterThanOrEqual(0); expect(z.y + z.h).toBeLessThanOrEqual(H + 1e-6);
        }
      }
      expect(pickZones(9, view)).toEqual(pickZones(9, view));
    });

    it("land everywhere over the planisphere from one burst to the next, not only where one is looking", () => {
      const centres = Array.from({ length: 80 }, (_, seed) => pickZones(seed + 1, { x0: 0, y0: 0, x1: W, y1: H }).map((z) => ({ x: (z.x + z.w / 2) % W, y: z.y + z.h / 2 }))).flat();
      expect(Math.min(...centres.map((c) => c.x))).toBeLessThan(5_000);
      expect(Math.max(...centres.map((c) => c.x))).toBeGreaterThan(35_000);
      expect(Math.min(...centres.map((c) => c.y))).toBeLessThan(5_000);
      expect(Math.max(...centres.map((c) => c.y))).toBeGreaterThan(20_000);
      // all nine blocks of a 3 × 3 grid of the world get zones
      const blocks = new Set(centres.map((c) => `${Math.floor((c.x / W) * 3)},${Math.floor((c.y / H) * 3)}`));
      expect(blocks.size).toBe(9);
      // another place every time
      const first = new Set(Array.from({ length: 30 }, (_, seed) => { const z = pickZones(seed + 1, { x0: 0, y0: 0, x1: W, y1: H })[0]!; return `${Math.round(z.x / 1000)},${Math.round(z.y / 1000)}`; }));
      expect(first.size).toBeGreaterThan(25);
    });

    it("cover a part of the world, not all of it and not nothing", () => {
      const shares = Array.from({ length: 20 }, (_, seed) => {
        const zones = pickZones(seed + 1, { x0: 0, y0: 0, x1: W, y1: H });
        let hit = 0, n = 0;
        for (let x = 0; x < W; x += 500) for (let y = 0; y < H; y += 500) {
          n++;
          if (zones.some((z) => y >= z.y && y < z.y + z.h && ((x - z.x) % W + W) % W < z.w)) hit++;
        }
        return hit / n;
      });
      const mean = shares.reduce((p, c) => p + c, 0) / shares.length;
      expect(mean).toBeGreaterThan(0.1);
      expect(mean).toBeLessThan(0.4);
    });

    it("puts the first zone where the visitor is looking when the map is zoomed in, so that a burst is never lost off screen", () => {
      const inView = (z: { x: number; y: number; w: number; h: number }, v: typeof view) => {
        const mid = z.x + z.w / 2 - (GLITCH_TRAVEL * z.w) / 2; // where the zone is halfway through its journey
        const dx = ((mid - v.x0) % W + W) % W;
        return dx <= v.x1 - v.x0 && z.y < v.y1 && z.y + z.h > v.y0;
      };
      for (let seed = 1; seed <= 80; seed++) {
        const v = { x0: 3_000 + seed * 300, y0: 2_000 + seed * 120, x1: 3_000 + seed * 300 + 4_000, y1: 2_000 + seed * 120 + 2_500 };
        expect(inView(pickZones(seed, v)[0]!, v), `seed ${seed}`).toBe(true);
        expect(inView(pickZones(seed, view)[0]!, view), `seed ${seed}`).toBe(true);
      }
    });

    it("jump to the LEFT in jerks, by up to 90 % of their width, and wrap round the world", () => {
      const z = { x: 20_000, y: 5_000, w: 8_000, h: 4_000 };
      let last = z.x;
      for (let p = 0; p <= 1; p += 0.02) { const now = zoneNow(z, 0, frameAt(p, 2)); expect(now.x).toBeLessThanOrEqual(last + 1e-6); last = now.x; }
      expect(zoneNow(z, 0, frameAt(0, 2)).x).toBe(z.x);
      expect(z.x - last).toBeGreaterThan(0.5 * z.w);
      expect(z.x - last).toBeLessThanOrEqual(GLITCH_TRAVEL * z.w + 1e-6);
      const edge = zoneNow({ x: 2_000, y: 0, w: 8_000, h: 4_000 }, 0, frameAt(0.99, 2));
      expect(edge.x, "across the antimeridian").toBeGreaterThan(30_000);
    });
  });

  describe("what a bugged zone looks like", () => {
    const rect = { w: 300, h: 160 };
    it("is cut into horizontal bands that cover it exactly, every other one lighter", () => {
      const bands = bugBands(0, rect, frameAt(0.5, 3));
      expect(bands.length).toBeGreaterThan(8);
      expect(bands.reduce((p, b) => p + b.h, 0)).toBe(rect.h);
      expect(bands[0]!.y).toBe(0);
      for (let i = 1; i < bands.length; i++) expect(bands[i]!.y).toBe(bands[i - 1]!.y + bands[i - 1]!.h);
      expect(bands.map((b) => b.light).slice(0, 4)).toEqual([true, false, true, false]);
      for (const b of bands) { expect(b.h).toBeGreaterThanOrEqual(1); expect(b.h).toBeLessThanOrEqual(28); }
    });
    it("scrolls to the LEFT only, by up to 40 % of the zone's width", () => {
      for (let seed = 0; seed < 10; seed++) for (let zone = 0; zone < 4; zone++) for (let p = 0; p <= 1; p += 0.1) for (const b of bugBands(zone, rect, frameAt(p, seed))) {
        expect(b.shift).toBeGreaterThanOrEqual(0);
        expect(b.shift).toBeLessThanOrEqual(Math.ceil(GLITCH_SCROLL * rect.w));
      }
    });
    it("has scrolled further by the end than at the start, most bands moving, each its own way", () => {
      const early = bugBands(1, rect, frameAt(0.05, 6)), late = bugBands(1, rect, frameAt(0.97, 6));
      const sum = (bs: typeof early) => bs.reduce((p, b) => p + b.shift, 0);
      expect(sum(early)).toBeLessThan(sum(late));
      expect(late.filter((b) => b.shift > 10).length / late.length).toBeGreaterThan(0.3);
      expect(new Set(late.map((b) => b.shift)).size).toBeGreaterThan(4);
    });
    it("is the same every time it is drawn, and another picture for another burst", () => {
      expect(bugBands(2, rect, frameAt(0.7, 9))).toEqual(bugBands(2, rect, frameAt(0.7, 9)));
      expect(bugBands(2, rect, frameAt(0.7, 9))).not.toEqual(bugBands(2, rect, frameAt(0.7, 10)));
    });
  });
});
