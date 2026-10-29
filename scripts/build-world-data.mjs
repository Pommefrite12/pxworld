#!/usr/bin/env node
// Builds the static geographic reference layer from open data, projected into grid pixel space
// (equirectangular, 84°N → 60°S, 50 000 × 20 000 px).
//
// Sources (all licences allow commercial use; attribution is shown on the site, see /credits):
//   • Natural Earth land & countries (public domain) via the `world-atlas` package (ISC)
//   • GeoNames populated places (CC BY 4.0) via the `all-the-cities` package (MIT)
//   • Country names (en/fr) from `i18n-iso-countries` (MIT)
//
//   npm run data:world
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { feature, mesh } from "topojson-client";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "public/data");
fs.mkdirSync(out, { recursive: true });

const W = 50_000, H = 20_000;
const LON_MIN = -180, LON_MAX = 180, LAT_MAX = 84, LAT_MIN = -60;
const px = ([lon, lat]) => [((lon - LON_MIN) / (LON_MAX - LON_MIN)) * W, ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H];
const Q = 4; // quarter-pixel precision

const readTopo = (n) => JSON.parse(fs.readFileSync(require.resolve(`world-atlas/${n}.json`), "utf8"));

/**
 * Planar maps must not draw the 360° jump of a ring that crosses the antimeridian (Russia/Chukotka, Fiji, Antarctica…).
 * We "unwrap" the longitudes so the ring is continuous, then emit a copy shifted by ±360° so the part that spilled past
 * the map edge also appears on the opposite side. The renderer clips to the world rectangle.
 */
function unwrap(coords) {
  const out = [];
  let prev = null;
  for (const [lon, lat] of coords) {
    let l = lon;
    if (prev !== null) {
      while (l - prev > 180) l -= 360;
      while (l - prev < -180) l += 360;
    }
    out.push([l, lat]);
    prev = l;
  }
  const lons = out.map((c) => c[0]);
  const copies = [out];
  if (Math.max(...lons) > LON_MAX) copies.push(out.map(([l, la]) => [l - 360, la]));
  if (Math.min(...lons) < LON_MIN) copies.push(out.map(([l, la]) => [l + 360, la]));
  return copies;
}

/** ring → delta-encoded integers [x0*Q, y0*Q, dx, dy, …]; drops points that collapse onto each other. */
function encodeRing(coords) {
  const flat = [];
  let px_ = 0, py_ = 0, first = true;
  for (const c of coords) {
    const [x, y] = px(c);
    const qx = Math.round(x * Q), qy = Math.round(y * Q);
    if (first) { flat.push(qx, qy); first = false; }
    else if (qx === px_ && qy === py_) continue;
    else flat.push(qx - px_, qy - py_);
    px_ = qx; py_ = qy;
  }
  return flat;
}

function landFile(name) {
  const topo = readTopo(name);
  const fc = feature(topo, topo.objects.land);
  const polys = [];
  for (const f of fc.features ?? [fc]) {
    const g = f.geometry;
    const list = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of list) {
      // all rings of a polygon (outer + holes) are unwrapped consistently, copy by copy
      const ringCopies = poly.map(unwrap);
      const copies = Math.max(...ringCopies.map((c) => c.length));
      for (let k = 0; k < copies; k++) {
        const rings = ringCopies.map((c) => c[k] ?? null).filter(Boolean);
        const enc = rings.map(encodeRing).filter((r) => r.length >= 8);
        if (enc.length) polys.push(enc);
      }
    }
  }
  return { q: Q, polygons: polys };
}

function linesFile(name) {
  const topo = readTopo(name);
  const m = mesh(topo, topo.objects.countries, (a, b) => a !== b); // interior borders only
  return { q: Q, lines: m.coordinates.flatMap((l) => unwrap(l).map(encodeRing)).filter((r) => r.length >= 4) };
}

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = px(ring[i]), [x2, y2] = px(ring[(i + 1) % n]);
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
};

function places() {
  const iso = require("i18n-iso-countries");
  iso.registerLocale(require("i18n-iso-countries/langs/en.json"));
  iso.registerLocale(require("i18n-iso-countries/langs/fr.json"));
  const topo = readTopo("countries-50m");
  const fc = feature(topo, topo.objects.countries);
  const countries = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let best = null, bestArea = -1;
    for (const p of polys) {
      const a = ringArea(p[0]);
      if (a > bestArea) { bestArea = a; best = p[0]; }
    }
    if (!best) continue;
    const pts = best.map(px);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(W, Math.max(...xs));
    const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(H, Math.max(...ys));
    if (x1 <= x0 || y1 <= y0) continue; // outside the grid (Antarctica)
    const num = f.id != null ? String(f.id).padStart(3, "0") : null;
    const a2 = num ? iso.numericToAlpha2(num) : undefined;
    const name = f.properties.name;
    countries.push({
      k: "c",
      code: a2 ?? null,
      en: (a2 && iso.getName(a2, "en")) || name,
      fr: (a2 && iso.getName(a2, "fr")) || name,
      bbox: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
    });
  }
  const cities = require("all-the-cities")
    .filter((c) => c.population >= 400_000)
    .map((c) => {
      const [lon, lat] = c.loc.coordinates;
      const [x, y] = px([lon, lat]);
      return { k: "p", en: c.name, cc: c.country, pop: c.population, x: Math.round(x), y: Math.round(y), lat, lon };
    })
    .filter((c) => c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H)
    .sort((a, b) => b.pop - a.pop)
    .map(({ lat, lon, ...c }) => c);
  return { countries, cities };
}

const write = (name, data) => {
  const file = path.join(out, name);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(name.padEnd(18), (fs.statSync(file).size / 1024).toFixed(0).padStart(6), "KB");
};

write("land-110.json", landFile("land-110m"));
write("land-50.json", landFile("land-50m"));
write("borders-50.json", linesFile("countries-50m"));
write("places.json", places());
