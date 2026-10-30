// Builds the static geographic reference layer from open data, projected into grid pixel space
// (Web-Mercator, 40 000 × 25 000 px, see src/lib/grid/projection.ts).
//
// Sources (all licences allow commercial use; attribution is shown on the site, see /credits):
//   • Natural Earth land & countries 1:110m, 1:50m and 1:10m (public domain) via the `world-atlas` package (ISC)
//   • Natural Earth admin-1 "states & provinces" 1:10m (public domain), downloaded once into .data/natural-earth
//   • GeoNames populated places (CC BY 4.0) via the `all-the-cities` package (MIT)
//   • Country names (en/fr) from `i18n-iso-countries` (MIT)
//
// Output (public/data):
//   land-110.json, land-50.json, borders-50.json   whole-world files for the zoomed-out levels
//   admin-lo.json                                  simplified admin-1 borders for the middle zoom levels
//   geo/index.json + geo/g-{cx}-{cy}.json          1:10m land, country borders and admin-1 borders, cut into
//                                                  2 500-px cells and loaded on demand
//   geo/c1-…, geo/c2-…                             cities 15 000–400 000 and 1 000–15 000 inhabitants, same cells
//   places.json                                    countries (label anchors) + cities ≥ 400 000
//   admin-labels.json, search-cities.json          admin-1 unit names / smaller cities, for labels and search
//
//   npm run data:world
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { feature, mesh } from "topojson-client";
import { topology } from "topojson-server";
import { GRID_HEIGHT as H, GRID_WIDTH as W } from "../src/lib/grid/constants";
import { latToY, lonLatToPixel, lonToX, LON_MAX, LON_MIN } from "../src/lib/grid/projection";
import { clipPolygonToRect, clipPolylineToRect, type Rect4 } from "../src/lib/geo/clip";
import { simplify } from "../src/lib/geo/simplify";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public/data");
const geoOut = path.join(out, "geo");
fs.rmSync(geoOut, { recursive: true, force: true });
fs.mkdirSync(geoOut, { recursive: true });

const Q = 4; // quarter-pixel precision
const CELL = 2500; // grid pixels per chunk edge (16 × 10 cells)
const CELL_SMALL = 625; // the 1 000–15 000 inhabitants layer is dense (≈ 90 000 places): finer cells keep every file small
const CX = W / CELL, CY = H / CELL;
const TOL_HI = 0.3; // simplification tolerance (grid px) of the 1:10m layers: below the quarter-pixel precision anyway
const TOL_ADMIN_LO = 1.2;

type LL = [number, number];
type Flat = number[];

const readTopo = (n: string) => JSON.parse(fs.readFileSync(require.resolve(`world-atlas/${n}.json`), "utf8"));

/* ------------------------------------------------------------------ projection helpers */

/**
 * A straight edge of the source data is straight in lon/lat. In Mercator it becomes a curve, so long north–south
 * edges get intermediate vertices (every 0.5° of latitude) to follow it.
 */
function densify(coords: LL[]): LL[] {
  const res: LL[] = [];
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i]!;
    if (i > 0) {
      const [pl, pa] = coords[i - 1]!;
      const n = Math.ceil(Math.abs(lat - pa) / 0.5);
      for (let k = 1; k < n; k++) res.push([pl + ((lon - pl) * k) / n, pa + ((lat - pa) * k) / n]);
    }
    res.push([lon, lat]);
  }
  return res;
}

/**
 * Planar maps must not draw the 360° jump of a ring that crosses the antimeridian (Russia/Chukotka, Fiji…). The
 * longitudes are made continuous, then the ring is emitted shifted by whole turns for every position where it falls
 * inside the map's longitude range [LON_MIN, LON_MAX] (usually one; two for the few rings that straddle the map's
 * own edge). Clipping to the world rectangle happens later.
 */
function unwrap(coords: LL[]): LL[][] {
  const cont: LL[] = [];
  let prev: number | null = null;
  for (const [lon, lat] of coords) {
    let l = lon;
    if (prev !== null) {
      while (l - prev > 180) l -= 360;
      while (l - prev < -180) l += 360;
    }
    cont.push([l, lat]);
    prev = l;
  }
  let lo = Infinity, hi = -Infinity;
  for (const [l] of cont) { if (l < lo) lo = l; if (l > hi) hi = l; }
  const copies: LL[][] = [];
  for (let turn = -2; turn <= 2; turn++) {
    const shift = turn * 360;
    if (hi + shift >= LON_MIN && lo + shift <= LON_MAX) copies.push(turn === 0 ? cont : cont.map(([l, la]) => [l + shift, la] as LL));
  }
  return copies;
}

/** lon/lat polyline → flat grid-pixel polyline (all copies that fall on the map). */
function projectLine(coords: LL[]): Flat[] {
  // unwrap first: densifying an edge that jumps across the antimeridian would sweep through the whole world
  return unwrap(coords).map((c) => {
    const f: Flat = [];
    for (const [lon, lat] of densify(c)) f.push(lonToX(lon), latToY(lat));
    return f;
  });
}

const bboxOf = (f: Flat) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < f.length; i += 2) {
    const x = f[i]!, y = f[i + 1]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
};
const touchesWorld = (b: Rect4) => b.x1 >= 0 && b.x0 <= W && b.y1 >= 0 && b.y0 <= H;

/** flat px → delta-encoded integers [x0*Q, y0*Q, dx, dy, …]; drops points that collapse onto each other. */
function encode(f: Flat): number[] {
  const res: number[] = [];
  let px = 0, py = 0, first = true;
  for (let i = 0; i < f.length; i += 2) {
    const qx = Math.round(f[i]! * Q), qy = Math.round(f[i + 1]! * Q);
    if (first) { res.push(qx, qy); first = false; }
    else if (qx === px && qy === py) continue;
    else res.push(qx - px, qy - py);
    px = qx; py = qy;
  }
  return res;
}

/* ------------------------------------------------------------------ whole-world files (110m, 50m) */

function polygonsOf(topo: any, object: string): LL[][][] {
  const fc: any = feature(topo, topo.objects[object]);
  const polys: LL[][][] = [];
  for (const f of fc.features ?? [fc]) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") polys.push(g.coordinates);
    else for (const p of g.coordinates) polys.push(p);
  }
  return polys;
}

/** All rings of a polygon (outer + holes) are unwrapped consistently, copy by copy → list of flat-px polygons. */
function projectPolygon(poly: LL[][]): Flat[][] {
  const ringCopies = poly.map(projectLine);
  const copies = Math.max(...ringCopies.map((c) => c.length));
  const res: Flat[][] = [];
  for (let k = 0; k < copies; k++) {
    const rings = ringCopies.map((c) => c[k] ?? null).filter((r): r is Flat => r !== null);
    // keep only copies that actually reach the map
    if (rings.some((r) => touchesWorld(bboxOf(r)))) res.push(rings);
  }
  return res;
}

function landFile(name: string, tol: number) {
  const topo = readTopo(name);
  const polygons: number[][][] = [];
  for (const poly of polygonsOf(topo, "land")) {
    for (const rings of projectPolygon(poly)) {
      const enc = rings.map((r) => encode(tol > 0 ? simplify(r, tol) : r)).filter((r) => r.length >= 8);
      if (enc.length) polygons.push(enc);
    }
  }
  return { q: Q, polygons };
}

function bordersOf(topo: any, object: string) {
  const m: any = mesh(topo, topo.objects[object], (a: unknown, b: unknown) => a !== b); // shared arcs only = interior borders
  return m.coordinates as LL[][];
}

function linesFile(lines: LL[][], tol: number) {
  const res: number[][] = [];
  for (const l of lines) for (const f of projectLine(l)) {
    if (!touchesWorld(bboxOf(f))) continue;
    const e = encode(tol > 0 ? simplify(f, tol) : f);
    if (e.length >= 4) res.push(e);
  }
  return { q: Q, lines: res };
}

/* ------------------------------------------------------------------ 1:10m chunks */

interface Cell { land: number[][]; borders: number[][]; admin: number[][]; c1: unknown[][] }
const cells = new Map<string, Cell>();
const cellOf = (cx: number, cy: number): Cell => {
  const k = `${cx}-${cy}`;
  let c = cells.get(k);
  if (!c) cells.set(k, (c = { land: [], borders: [], admin: [], c1: [] }));
  return c;
};
const cellRange = (b: Rect4) => ({
  cx0: Math.max(0, Math.floor(b.x0 / CELL)), cx1: Math.min(CX - 1, Math.floor(b.x1 / CELL)),
  cy0: Math.max(0, Math.floor(b.y0 / CELL)), cy1: Math.min(CY - 1, Math.floor(b.y1 / CELL)),
});

function chunkRing(f: Flat, into: "land") {
  const b = bboxOf(f);
  const { cx0, cx1, cy0, cy1 } = cellRange(b);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const rect: Rect4 = { x0: cx * CELL, y0: cy * CELL, x1: (cx + 1) * CELL, y1: (cy + 1) * CELL };
    const inside = b.x0 >= rect.x0 && b.x1 <= rect.x1 && b.y0 >= rect.y0 && b.y1 <= rect.y1;
    const clipped = inside ? f : clipPolygonToRect(f, rect);
    if (clipped.length < 6) continue;
    const e = encode(clipped);
    if (e.length >= 6) cellOf(cx, cy)[into].push(e);
  }
}

function chunkLine(f: Flat, into: "borders" | "admin") {
  const b = bboxOf(f);
  const { cx0, cx1, cy0, cy1 } = cellRange(b);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const rect: Rect4 = { x0: cx * CELL, y0: cy * CELL, x1: (cx + 1) * CELL, y1: (cy + 1) * CELL };
    for (const piece of clipPolylineToRect(f, rect, false)) {
      const e = encode(piece);
      if (e.length >= 4) cellOf(cx, cy)[into].push(e);
    }
  }
}

function buildLand10() {
  const topo = readTopo("land-10m");
  let rings = 0;
  for (const poly of polygonsOf(topo, "land")) for (const polyRings of projectPolygon(poly)) {
    for (const r of polyRings) {
      const s = simplify(r, TOL_HI);
      if (s.length < 8) continue;
      chunkRing(s, "land");
      rings++;
    }
  }
  console.log("  land-10m rings".padEnd(24), rings);
}

function buildLines(lines: LL[][], into: "borders" | "admin") {
  let n = 0;
  for (const l of lines) for (const f of projectLine(l)) {
    if (!touchesWorld(bboxOf(f))) continue;
    const s = simplify(f, TOL_HI);
    if (s.length < 4) continue;
    chunkLine(s, into);
    n++;
  }
  console.log(`  ${into} lines`.padEnd(24), n);
}

/* ------------------------------------------------------------------ admin-1 (départements, states, provinces…) */

const ADMIN1_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson";

async function loadAdmin1(): Promise<any> {
  const file = process.env.NE_ADMIN1 ?? path.join(root, ".data/natural-earth/ne_10m_admin_1_states_provinces.geojson");
  if (!fs.existsSync(file)) {
    console.log("downloading Natural Earth admin-1 (≈ 40 MB, once) …");
    const res = await fetch(ADMIN1_URL);
    if (!res.ok) throw new Error(`admin-1 download failed: HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

interface AdminLabel { x: number; y: number; s: number; en: string; fr: string; cc: string; dep: 0 | 1 }

/** Area of a (Multi)Polygon in grid px²: outer rings minus holes, after unwrapping the antimeridian. */
function areaPx(g: { type: string; coordinates: LL[][][] | LL[][] } | null): number {
  if (!g) return 0;
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as LL[][][];
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, i) => {
      const f = projectLine(ring)[0]!;
      let a = 0;
      for (let k = 0, n = f.length / 2; k < n; k++) {
        const j = (k + 1) % n;
        a += f[2 * k]! * f[2 * j + 1]! - f[2 * j]! * f[2 * k + 1]!;
      }
      total += (i === 0 ? 1 : -1) * Math.abs(a / 2);
    });
  }
  return Math.max(total, 0);
}

function adminLabels(fc: any): AdminLabel[] {
  const labels: AdminLabel[] = [];
  for (const f of fc.features) {
    const p = f.properties;
    const name: string = p.name_en || p.name;
    if (!name) continue;
    let lon: number = p.longitude, lat: number = p.latitude;
    if (typeof lon !== "number" || typeof lat !== "number") continue;
    lon = Math.max(-180, Math.min(180, lon));
    const pt = lonLatToPixel({ lon, lat });
    if (pt.x < 0 || pt.x > W || pt.y < 0 || pt.y > H) continue;
    // "size" of the unit in grid pixels (√ of its area on the map), used to decide from which zoom a label fits
    const s = Math.sqrt(areaPx(f.geometry));
    const fr: string = p.name_fr && p.name_fr !== name ? p.name_fr : "";
    const dep = /d[ée]partement/i.test(`${p.type_en ?? ""} ${p.type ?? ""}`) ? 1 : 0;
    labels.push({ x: Math.round(pt.x), y: Math.round(pt.y), s: Math.round(s * 10) / 10, en: name, fr, cc: p.iso_a2 && p.iso_a2 !== "-99" ? p.iso_a2 : p.adm0_a3, dep });
  }
  return labels.sort((a, b) => b.s - a.s);
}

/* ------------------------------------------------------------------ places */

const ringArea = (ring: LL[]) => {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = lonLatToPixel({ lon: ring[i]![0], lat: ring[i]![1] }), q = lonLatToPixel({ lon: ring[(i + 1) % n]![0], lat: ring[(i + 1) % n]![1] });
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};

function countries() {
  const iso = require("i18n-iso-countries");
  iso.registerLocale(require("i18n-iso-countries/langs/en.json"));
  iso.registerLocale(require("i18n-iso-countries/langs/fr.json"));
  const topo = readTopo("countries-50m");
  const fc: any = feature(topo, topo.objects.countries);
  const list: { k: "c"; code: string | null; en: string; fr: string; bbox: [number, number, number, number] }[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys: LL[][][] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let best: LL[] | null = null, bestArea = -1;
    for (const p of polys) {
      const a = ringArea(p[0]!);
      if (a > bestArea) { bestArea = a; best = p[0]!; }
    }
    if (!best) continue;
    const pts = best.map(([lon, lat]) => lonLatToPixel({ lon, lat }));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H, Math.max(...ys));
    if (x1 <= x0 || y1 <= y0) continue; // outside the grid (Antarctica)
    const num = f.id != null ? String(f.id).padStart(3, "0") : null;
    const a2: string | undefined = num ? iso.numericToAlpha2(num) : undefined;
    const name: string = f.properties.name;
    list.push({
      k: "c", code: a2 ?? null,
      en: (a2 && iso.getName(a2, "en")) || name,
      fr: (a2 && iso.getName(a2, "fr")) || name,
      bbox: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
    });
  }
  return list;
}

interface CityRow { name: string; cc: string; pop: number; x: number; y: number }

function allCities(): CityRow[] {
  const rows: CityRow[] = [];
  for (const c of require("all-the-cities") as { name: string; country: string; population: number; loc: { coordinates: [number, number] } }[]) {
    if (c.population < 1_000) continue;
    const [lon, lat] = c.loc.coordinates;
    const p = lonLatToPixel({ lon, lat });
    if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) continue;
    rows.push({ name: c.name, cc: c.country, pop: c.population, x: p.x, y: p.y });
  }
  return rows.sort((a, b) => b.pop - a.pop);
}

/* ------------------------------------------------------------------ output */

const sizes: [string, number][] = [];
const write = (rel: string, data: unknown) => {
  const file = path.join(out, rel);
  const json = JSON.stringify(data);
  fs.writeFileSync(file, json);
  sizes.push([rel, json.length]);
};
const show = (rel: string) => console.log(rel.padEnd(24), (fs.statSync(path.join(out, rel)).size / 1024).toFixed(0).padStart(7), "KB");

async function main() {
  console.log("whole-world levels");
  write("land-110.json", landFile("land-110m", 0));
  write("land-50.json", landFile("land-50m", 0));
  write("borders-50.json", linesFile(bordersOf(readTopo("countries-50m"), "countries"), 0));
  for (const f of ["land-110.json", "land-50.json", "borders-50.json"]) show(f);

  console.log("1:10m land and country borders");
  buildLand10();
  buildLines(bordersOf(readTopo("countries-10m"), "countries"), "borders");

  console.log("admin-1");
  const admin = await loadAdmin1();
  // internal borders only: arcs shared by two units of the SAME country (the country outline is drawn from the countries layer)
  const topo: any = topology({ admin });
  const adminLines = (mesh(topo, topo.objects.admin, (a: any, b: any) => a !== b && a.properties?.adm0_a3 === b.properties?.adm0_a3) as any).coordinates as LL[][];
  console.log("  admin-1 internal lines".padEnd(24), adminLines.length);
  buildLines(adminLines, "admin");
  write("admin-lo.json", linesFile(adminLines, TOL_ADMIN_LO));
  show("admin-lo.json");
  const labels = adminLabels(admin);
  write("admin-labels.json", labels.map((l) => [l.x, l.y, l.s, l.en, l.fr, l.cc, l.dep]));
  show("admin-labels.json");

  console.log("cities");
  const cities = allCities();
  const big = cities.filter((c) => c.pop >= 400_000);
  const mid = cities.filter((c) => c.pop >= 15_000 && c.pop < 400_000);
  const small = cities.filter((c) => c.pop < 15_000);
  const smallCells = new Map<string, unknown[][]>();
  for (const c of mid) cellOf(Math.floor(c.x / CELL), Math.floor(c.y / CELL)).c1.push([Math.round(c.x * Q), Math.round(c.y * Q), c.pop, c.name]);
  for (const c of small) {
    const k = `${Math.floor(c.x / CELL_SMALL)}-${Math.floor(c.y / CELL_SMALL)}`;
    if (!smallCells.has(k)) smallCells.set(k, []);
    smallCells.get(k)!.push([Math.round(c.x * Q), Math.round(c.y * Q), c.pop, c.name]);
  }
  console.log("  ≥400k / 15k–400k / 1k–15k".padEnd(24), big.length, mid.length, small.length);
  write("places.json", {
    countries: countries(),
    cities: big.map((c) => ({ k: "p", en: c.name, cc: c.cc, pop: c.pop, x: Math.round(c.x), y: Math.round(c.y) })),
  });
  show("places.json");
  write("search-cities.json", mid.map((c) => [Math.round(c.x), Math.round(c.y), c.pop, c.name, c.cc]));
  show("search-cities.json");

  const index: Record<string, unknown> = { cell: CELL, cellSmall: CELL_SMALL, q: Q, g: [] as string[], c1: [] as string[], c2: [] as string[] };
  let chunkBytes = 0, files = 0;
  for (const [key, cell] of [...cells.entries()].sort()) {
    const g: Record<string, number[][]> = {};
    if (cell.land.length) g.land = cell.land;
    if (cell.borders.length) g.borders = cell.borders;
    if (cell.admin.length) g.admin = cell.admin;
    if (Object.keys(g).length) { writeChunk(`g-${key}.json`, g); (index.g as string[]).push(key); }
    if (cell.c1.length) { writeChunk(`c1-${key}.json`, cell.c1); (index.c1 as string[]).push(key); }
  }
  for (const [key, rows] of [...smallCells.entries()].sort()) { writeChunk(`c2-${key}.json`, rows); (index.c2 as string[]).push(key); }
  function writeChunk(name: string, data: unknown) {
    const json = JSON.stringify(data);
    fs.writeFileSync(path.join(geoOut, name), json);
    chunkBytes += json.length; files++;
  }
  write("geo/index.json", index);
  console.log(`geo chunks: ${files} files, ${(chunkBytes / 1048576).toFixed(1)} MB (largest ${(Math.max(...fs.readdirSync(geoOut).map((f) => fs.statSync(path.join(geoOut, f)).size)) / 1024).toFixed(0)} KB)`);
}

await main();
