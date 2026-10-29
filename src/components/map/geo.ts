/** Static geographic reference layer, pre-projected into grid pixel space by scripts/build-world-data.mjs. */

interface LandFile { q: number; polygons: number[][][] }
interface LinesFile { q: number; lines: number[][] }

export interface Country { k: "c"; code: string | null; en: string; fr: string; bbox: [number, number, number, number] }
export interface City { k: "p"; en: string; cc: string; pop: number; x: number; y: number }
export interface Places { countries: Country[]; cities: City[] }

export interface Geo {
  landLow: Path2D;
  landHigh: Path2D;
  borders: Path2D;
}

/** Delta-encoded quarter-pixel integers → Path2D in world (grid pixel) coordinates. */
function ringToPath(path: Path2D, flat: number[], q: number, close: boolean) {
  let x = 0, y = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (i === 0) { x = flat[0]!; y = flat[1]!; path.moveTo(x / q, y / q); continue; }
    x += flat[i]!; y += flat[i + 1]!;
    path.lineTo(x / q, y / q);
  }
  if (close) path.closePath();
}

const landPath = (f: LandFile) => {
  const p = new Path2D();
  for (const poly of f.polygons) for (const ring of poly) ringToPath(p, ring, f.q, true);
  return p;
};

let geoPromise: Promise<Geo> | undefined;
export function loadGeo(): Promise<Geo> {
  return (geoPromise ??= (async () => {
    const [low, high, borders] = await Promise.all([
      fetch("/data/land-110.json").then((r) => r.json() as Promise<LandFile>),
      fetch("/data/land-50.json").then((r) => r.json() as Promise<LandFile>),
      fetch("/data/borders-50.json").then((r) => r.json() as Promise<LinesFile>),
    ]);
    const b = new Path2D();
    for (const line of borders.lines) ringToPath(b, line, borders.q, false);
    return { landLow: landPath(low), landHigh: landPath(high), borders: b };
  })());
}

let placesPromise: Promise<Places> | undefined;
export function loadPlaces(): Promise<Places> {
  return (placesPromise ??= fetch("/data/places.json").then((r) => r.json() as Promise<Places>));
}
