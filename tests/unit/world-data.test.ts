import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { lonLatToPixel } from "@/lib/grid/projection";

/**
 * The generated map data in public/data (scripts/build-world-data.mts) must stay consistent with the projection:
 * these tests catch a stale build, a wrong projection and broken chunking.
 */
const dir = path.resolve(__dirname, "../../public/data");
const read = <T>(rel: string): T => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8")) as T;

interface Index { cell: number; cellSmall: number; q: number; g: string[]; c1: string[]; c2: string[] }
const index = read<Index>("geo/index.json");

const decode = (flat: number[], q: number) => {
  const pts: [number, number][] = [];
  let x = 0, y = 0;
  for (let i = 0; i < flat.length / 2; i++) {
    if (i === 0) { x = flat[0]!; y = flat[1]!; } else { x += flat[2 * i]!; y += flat[2 * i + 1]!; }
    pts.push([x / q, y / q]);
  }
  return pts;
};

/** Even-odd ray casting over every ring: is the point on land? */
const onLand = (rings: [number, number][][], px: number, py: number) => {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
};

const landChunk = (x: number, y: number): [number, number][][] => {
  const cx = Math.floor(x / index.cell), cy = Math.floor(y / index.cell);
  const f = `geo/g-${cx}-${cy}.json`;
  if (!fs.existsSync(path.join(dir, f))) return [];
  return (read<{ land?: number[][] }>(f).land ?? []).map((r) => decode(r, index.q));
};

describe("generated world data", () => {
  it("whole-world levels contain no edge that sweeps across the map (antimeridian handling)", () => {
    for (const file of ["land-110.json", "land-50.json"]) {
      const f = read<{ q: number; polygons: number[][][] }>(file);
      for (const poly of f.polygons) for (const ring of poly) {
        const pts = decode(ring, f.q);
        for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i]![0] - pts[i - 1]![0]), `${file} edge`).toBeLessThan(5000);
      }
    }
  });

  it("every cell of the index exists and its geometry stays inside the cell", { timeout: 60_000 }, () => {
    expect(index.g.length).toBeGreaterThan(100);
    for (const key of index.g) {
      const [cx, cy] = key.split("-").map(Number) as [number, number];
      const raw = read<{ land?: number[][]; borders?: number[][]; admin?: number[][] }>(`geo/g-${key}.json`);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const ring of [...(raw.land ?? []), ...(raw.borders ?? []), ...(raw.admin ?? [])]) {
        for (const [x, y] of decode(ring, index.q)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      expect([key, x0 >= cx * index.cell, x1 <= (cx + 1) * index.cell, y0 >= cy * index.cell, y1 <= (cy + 1) * index.cell]).toEqual([key, true, true, true, true]);
    }
    for (const t of ["c1", "c2"] as const) for (const key of index[t]) expect(fs.existsSync(path.join(dir, `geo/${t}-${key}.json`))).toBe(true);
  });

  it("known places sit where the projection says: land under Paris, Sydney and the Sahara, sea in the mid-Atlantic", () => {
    const at = (lon: number, lat: number) => lonLatToPixel({ lon, lat });
    for (const [name, lon, lat] of [["Paris", 2.35, 48.85], ["Sydney", 151.2, -33.9], ["Tamanrasset", 5.5, 22.8], ["Brasília", -47.9, -15.8]] as const) {
      const p = at(lon, lat);
      expect(onLand(landChunk(p.x, p.y), p.x, p.y), name).toBe(true);
    }
    for (const [name, lon, lat] of [["mid-Atlantic", -35, 30], ["Gulf of Guinea", 3, -1], ["Bay of Biscay", -5, 45.5]] as const) {
      const p = at(lon, lat);
      expect(onLand(landChunk(p.x, p.y), p.x, p.y), name).toBe(false);
    }
  });

  it("big cities, départements and small cities are all projected consistently", () => {
    const paris = lonLatToPixel({ lon: 2.3522, lat: 48.8566 });
    const places = read<{ cities: { en: string; x: number; y: number }[]; countries: { en: string; bbox: number[] }[] }>("places.json");
    const p = places.cities.find((c) => c.en === "Paris")!;
    expect(Math.hypot(p.x - paris.x, p.y - paris.y)).toBeLessThan(6);
    const france = places.countries.find((c) => c.en === "France")!;
    expect(france.bbox[0]).toBeGreaterThanOrEqual(0);
    expect(france.bbox[3]).toBeLessThan(GRID_HEIGHT);

    const admin = read<[number, number, number, string, string, string, number][]>("admin-labels.json");
    const seine = admin.find((a) => a[3] === "Seine-Maritime")!;
    const rouen = lonLatToPixel({ lon: 1.0993, lat: 49.4432 });
    expect(Math.hypot(seine[0] - rouen.x, seine[1] - rouen.y)).toBeLessThan(120);
    expect(seine[6]).toBe(1); // flagged as a département
    expect(seine[2]).toBeGreaterThan(60); // about 80 km across ≈ 120 px
    expect(admin.filter((a) => a[5] === "FR" && a[6] === 1).length).toBeGreaterThanOrEqual(95);

    const search = read<[number, number, number, string, string][]>("search-cities.json");
    const rouenRow = search.find((c) => c[3] === "Rouen" && c[4] === "FR")!;
    expect(Math.hypot(rouenRow[0] - rouen.x, rouenRow[1] - rouen.y)).toBeLessThan(6);
    expect(search.every(([x, y]) => x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT)).toBe(true);
  });
});
