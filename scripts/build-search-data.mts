// Builds the two files that make the search box find SMALL places (a village, a hamlet-sized commune), next to `search-cities.json`
// (cities of 15 000+ inhabitants, built by build-world-data.mts) which stays as it is. They are downloaded only when somebody types
// three letters or more.
//
//   public/data/search-communes.json   every commune of metropolitan France (~35 000), [x, y, name, département code], by name
//                                      from the open Etalab "contours des communes" file already used for the commune borders
//                                      (.data/communes/communes-version-simplifiee.geojson, see build-world-data.mts)
//   public/data/search-places.json     the rest of the world: places of 5 000–15 000 inhabitants (and the French overseas places of
//                                      1 000+, which the communes file does not have), [x, y, population, name, country], GeoNames
//                                      (CC BY 4.0) via the `all-the-cities` package
//
//   npx tsx scripts/build-search-data.mts
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { GRID_HEIGHT as H, GRID_WIDTH as W } from "../src/lib/grid/constants";
import { lonLatToPixel } from "../src/lib/grid/projection";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public/data");

type Ring = number[][];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };

/** Area and centroid of a ring (shoelace), in degrees: good enough to point at the middle of a commune. */
function ringCentroid(r: Ring): { area: number; lon: number; lat: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [x0, y0] = r[j]!, [x1, y1] = r[i]!, f = x0! * y1! - x1! * y0!;
    a += f; cx += (x0! + x1!) * f; cy += (y0! + y1!) * f;
  }
  if (Math.abs(a) < 1e-12) { const m = r[0]!; return { area: 0, lon: m[0]!, lat: m[1]! }; }
  return { area: Math.abs(a / 2), lon: cx / (3 * a), lat: cy / (3 * a) };
}
/** The middle of the biggest piece of a commune (a commune can have islands). */
function center(g: Geometry): { lon: number; lat: number } {
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let best = { area: -1, lon: 0, lat: 0 };
  for (const p of polygons) { const c = ringCentroid(p[0]!); if (c.area > best.area) best = c; }
  return best;
}

const communes: [number, number, string, string][] = [];
const geo = JSON.parse(fs.readFileSync(path.join(root, ".data/communes/communes-version-simplifiee.geojson"), "utf8")) as { features: { properties: { code: string; nom: string }; geometry: Geometry }[] };
let noShape = 0;
for (const f of geo.features) {
  if (!f.geometry) { noShape++; continue; } // a few communes of the file have no outline: they cannot be placed
  const { lon, lat } = center(f.geometry), p = lonLatToPixel({ lon, lat });
  if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) continue;
  communes.push([Math.round(p.x), Math.round(p.y), f.properties.nom, f.properties.code.slice(0, 2)]);
}
if (noShape) console.log(`${noShape} communes without an outline were left out`);
communes.sort((a, b) => a[2].localeCompare(b[2], "fr") || a[3].localeCompare(b[3]));

const metro = (lon: number, lat: number) => lon > -6 && lon < 10 && lat > 41 && lat < 51.5; // metropolitan France: the communes file has it all
// the French overseas territories (GeoNames gives them codes of their own): the communes file has none of them, so their small places come from here
const OVERSEAS = new Set(["RE", "GP", "MQ", "GF", "YT", "NC", "PF", "PM", "WF", "BL", "MF"]);
const places: [number, number, number, string, string][] = [];
for (const c of require("all-the-cities") as { name: string; country: string; population: number; loc: { coordinates: [number, number] } }[]) {
  const [lon, lat] = c.loc.coordinates;
  if (c.country === "FR" && metro(lon, lat)) continue;
  const min = OVERSEAS.has(c.country) ? 1_000 : 5_000;
  if (c.population < min || c.population >= 15_000) continue; // 15 000 and more are in search-cities.json
  const p = lonLatToPixel({ lon, lat });
  if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) continue;
  places.push([Math.round(p.x), Math.round(p.y), c.population, c.name, c.country]);
}
places.sort((a, b) => b[2] - a[2]);

for (const [file, rows] of [["search-communes.json", communes], ["search-places.json", places]] as const) {
  const json = JSON.stringify(rows);
  fs.writeFileSync(path.join(out, file), json);
  console.log(file.padEnd(24), String(rows.length).padStart(7), "entries", (json.length / 1024).toFixed(0).padStart(6), "KB");
}
