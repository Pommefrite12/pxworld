import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { LAND_PIXELS } from "@/lib/geo/landPixels";
import { cellWindows, decodeDelta, landPixelsInWindow } from "@/lib/geo/landmask";
import { lonLatToPixel } from "@/lib/grid/projection";

/** The land data behind the "only land is for sale" rule: the real files, not mocks. */
const dir = path.resolve(__dirname, "../../public/data/geo");
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as { cell: number; q: number; g: string[]; landPixels: number };
const cache = new Map<string, Float64Array[]>();
const rings = (cx: number, cy: number) => {
  const key = `${cx}-${cy}`;
  if (!cache.has(key)) cache.set(key, index.g.includes(key) ? (JSON.parse(fs.readFileSync(path.join(dir, `g-${key}.json`), "utf8")).land ?? []).map((r: number[]) => decodeDelta(r, index.q)) : []);
  return cache.get(key)!;
};
const landIn = (rect: { x: number; y: number; w: number; h: number }) => [...cellWindows(rect, index.cell)].reduce((s, w) => s + landPixelsInWindow(rings(w.cx, w.cy), w.x, w.y, w.w, w.h), 0);
/** A parcel of `size`×`size` pixels centred on a place. */
const around = (lon: number, lat: number, size = 10) => { const p = lonLatToPixel({ lon, lat }); return { x: Math.round(p.x - size / 2), y: Math.round(p.y - size / 2), w: size, h: size }; };

describe("only land is for sale", () => {
  it("the land total is consistent: the generated constant matches the data index, about a third of the grid", () => {
    expect(LAND_PIXELS).toBe(index.landPixels);
    expect(LAND_PIXELS).toBeGreaterThan(0.25 * GRID_WIDTH * GRID_HEIGHT);
    expect(LAND_PIXELS).toBeLessThan(0.4 * GRID_WIDTH * GRID_HEIGHT);
  });

  it("a parcel in the middle of a continent is entirely land", () => {
    for (const [name, lon, lat] of [["Kazakhstan", 67, 48], ["Sahara", 10, 25], ["Brazil", -55, -12], ["Siberia", 100, 62], ["Australia", 134, -25], ["Paris", 2.35, 48.85]] as const) {
      const r = around(lon, lat, 20);
      expect(landIn(r), name).toBe(r.w * r.h);
    }
  });

  it("a parcel in an ocean or a sea has no land at all", () => {
    for (const [name, lon, lat] of [["mid-Atlantic", -30, 30], ["Pacific", -140, 10], ["Indian Ocean", 75, -20], ["Mediterranean", 18, 35], ["Gulf of Guinea", 3, -1]] as const) {
      const r = around(lon, lat, 100);
      expect(landIn(r), name).toBe(0);
    }
  });

  it("a parcel straddling a coast is partly land: it is refused (not entirely on land) yet not empty", () => {
    // the coast of Brittany at the Pointe du Raz (4.73°W, 48.04°N): a 60-px square centred on it
    const r = around(-4.73, 48.04, 60);
    const land = landIn(r);
    expect(land).toBeGreaterThan(0);
    expect(land).toBeLessThan(r.w * r.h);
  });

  it("an inland sea counts as sea: the Caspian is water, while an ordinary lake (Victoria) is land in this data", () => {
    const caspian = around(51, 42, 10);
    expect(landIn(caspian)).toBe(0);
    const victoria = around(33, -1.1, 10);
    expect(landIn(victoria)).toBe(victoria.w * victoria.h);
  });

  it("the way an area is split into cells does not change the answer (a parcel on a corner of four cells)", () => {
    const corner = { x: 2 * index.cell - 15, y: 4 * index.cell - 15, w: 30, h: 30 };
    const whole = landIn(corner);
    const pieces = [{ ...corner, w: 15 }, { ...corner, x: corner.x + 15, w: 15 }].reduce((s, r) => s + landIn(r), 0);
    expect(whole).toBe(pieces);
  });
});
