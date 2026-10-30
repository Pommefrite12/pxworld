import { clipPolygonToRect, clipPolylineToRect, outlineWithoutClipEdges, type Rect4 } from "@/lib/geo/clip";
import { SEAM_X } from "@/lib/grid/projection";

/**
 * Static geographic reference layer, pre-projected into grid pixel space by scripts/build-world-data.mts.
 *
 * Three levels of detail, picked by the renderer from the zoom:
 *   • "110" / "50" — whole-world files (Natural Earth 1:110m and 1:50m), downloaded once;
 *   • "10"         — Natural Earth 1:10m land, country borders and admin-1 borders (départements, states, provinces),
 *                    cut into 2 500-px cells that are fetched only where the camera looks.
 * Cities (GeoNames) follow the same on-demand principle, in two tiers.
 */

interface LandFile { q: number; polygons: number[][][] }
interface LinesFile { q: number; lines: number[][] }
interface IndexFile { cell: number; cellSmall: number; q: number; g: string[]; c1: string[]; c2: string[] }
interface ChunkFile { land?: number[][]; borders?: number[][]; admin?: number[][] }

export interface Country { k: "c"; code: string | null; en: string; fr: string; bbox: [number, number, number, number] }
export interface City { k: "p"; en: string; cc: string; pop: number; x: number; y: number }
export interface Places { countries: Country[]; cities: City[] }
/** A smaller city from the on-demand tiers. */
export interface Town { x: number; y: number; pop: number; name: string }
/** An admin-1 unit (département, state, province…): label anchor, size in grid px, names, country code. */
export interface AdminLabel { x: number; y: number; s: number; en: string; fr: string; cc: string; dep: boolean }
/** A city of 15 000+ inhabitants, for search. */
export interface SearchTown { x: number; y: number; pop: number; name: string; cc: string }

export type Lod = "110" | "50" | "10";
export interface TilePaths { fill: Path2D; coast: Path2D; borders: Path2D; admin: Path2D }

interface Ring { pts: Float64Array; x0: number; y0: number; x1: number; y1: number }

function ringOf(pts: Float64Array): Ring {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!, y = pts[i + 1]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { pts, x0, y0, x1, y1 };
}

function decodeRing(flat: number[], q: number): Ring {
  const n = flat.length >> 1;
  const pts = new Float64Array(n * 2);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) { x = flat[0]!; y = flat[1]!; } else { x += flat[2 * i]!; y += flat[2 * i + 1]!; }
    pts[2 * i] = x / q; pts[2 * i + 1] = y / q;
  }
  return ringOf(pts);
}

const intersects = (r: Ring, c: Rect4) => r.x0 <= c.x1 && r.x1 >= c.x0 && r.y0 <= c.y1 && r.y1 >= c.y0;
const inside = (r: Ring, c: Rect4) => r.x0 >= c.x0 && r.x1 <= c.x1 && r.y0 >= c.y0 && r.y1 <= c.y1;

function addPolygon(path: Path2D, pts: ArrayLike<number>) {
  const n = pts.length >> 1;
  if (n < 3) return;
  path.moveTo(pts[0]!, pts[1]!);
  for (let i = 1; i < n; i++) path.lineTo(pts[2 * i]!, pts[2 * i + 1]!);
  path.closePath();
}

function addPolylines(path: Path2D, lines: number[][]) {
  for (const l of lines) {
    path.moveTo(l[0]!, l[1]!);
    for (let i = 2; i + 1 < l.length; i += 2) path.lineTo(l[i]!, l[i + 1]!);
  }
}

/** Fills `fill` with the polygons of `rings` inside `wide` (clipped when they cross it) and `coast` with their outlines. */
function addLand(fill: Path2D, coast: Path2D, rings: Ring[], coastRings: Ring[], wide: Rect4) {
  for (const r of rings) {
    if (!intersects(r, wide)) continue;
    addPolygon(fill, inside(r, wide) ? r.pts : clipPolygonToRect(r.pts, wide));
  }
  for (const r of coastRings) {
    if (!intersects(r, wide)) continue;
    addPolylines(coast, inside(r, wide) ? [Array.from(r.pts)] : clipPolylineToRect(r.pts, wide, false));
  }
}

/** The real coastline of polygons: their outline minus the edges that only follow `clip` or the antimeridian seam. */
function coastOf(rings: Ring[], clip: Rect4, seamX: number): Ring[] {
  return rings.flatMap((r) => outlineWithoutClipEdges(r.pts, clip, seamX).map((p) => ringOf(Float64Array.from(p))));
}

const UNCLIPPED: Rect4 = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };

function addLines(path: Path2D, rings: Ring[], wide: Rect4) {
  for (const r of rings) if (intersects(r, wide)) addPolylines(path, inside(r, wide) ? [Array.from(r.pts)] : clipPolylineToRect(r.pts, wide, false));
}

type AdminRow = [number, number, number, string, string, string, 0 | 1];
const toAdmin = ([x, y, s, en, fr, cc, dep]: AdminRow): AdminLabel => ({ x, y, s, en, fr, cc, dep: dep === 1 });

interface Chunk { fill: Ring[]; coast: Ring[]; borders: Ring[]; admin: Ring[] }
interface Slot<T> { state: "loading" | "ready" | "error"; data: T | null; used: number }

const FETCH_MAX = 6;
const CHUNK_MAX = 72;
const CITY_MAX = 160;

export class Geo {
  /** Bumped whenever new geometry arrives: tiles rendered without it are drawn again. */
  version = 0;
  onUpdate: (() => void) | null = null;

  private frame = 0;
  private chunks = new Map<string, Slot<Chunk>>();
  private townCells = [new Map<string, Slot<Town[]>>(), new Map<string, Slot<Town[]>>()] as const;
  private adminLo: Ring[] | null = null;
  private adminLoState: "idle" | "loading" = "idle";
  private labels: AdminLabel[] | null = null;
  private labelsState: "idle" | "loading" = "idle";
  private queue: (() => void)[] = [];
  private active = 0;
  private cells: { g: Set<string>; c1: Set<string>; c2: Set<string> };

  private seamX: number;
  private lowCoast: Ring[];
  private midCoast: Ring[];

  constructor(private low: Ring[], private mid: Ring[], private borders50: Ring[], private index: IndexFile) {
    this.cells = { g: new Set(index.g), c1: new Set(index.c1), c2: new Set(index.c2) };
    this.seamX = Math.round(SEAM_X * index.q) / index.q; // as stored in the quantised data
    this.lowCoast = coastOf(low, UNCLIPPED, this.seamX);
    this.midCoast = coastOf(mid, UNCLIPPED, this.seamX);
  }

  /** Called once per drawn frame: marks which chunks are "in use" so the LRU never evicts what is on screen. */
  tick(frame: number) { this.frame = frame; }

  /* ------------------------------------------------------------------ fetching */

  private fetchJson<T>(url: string, done: (data: T | null) => void) {
    this.queue.push(() => {
      this.active++;
      fetch(url)
        .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
        .catch(() => null)
        .then((d) => { done(d); this.active--; this.pump(); });
    });
    this.pump();
  }

  // newest request first: while the camera moves, the cells it looks at now matter more than the ones it passed
  private pump() { while (this.active < FETCH_MAX && this.queue.length) this.queue.pop()!(); }

  private changed() { this.version++; this.onUpdate?.(); }

  private evict<T>(map: Map<string, Slot<T>>, max: number) {
    if (map.size <= max) return;
    const old = [...map.entries()].filter(([, s]) => s.state !== "loading" && s.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [key] of old.slice(0, map.size - max + 8)) map.delete(key);
  }

  private slot<T>(map: Map<string, Slot<T>>, key: string, url: string, decode: (raw: never) => T, max: number): Slot<T> {
    let s = map.get(key);
    if (!s) {
      const created: Slot<T> = (s = { state: "loading", data: null, used: this.frame });
      map.set(key, created);
      this.fetchJson<never>(url, (raw) => {
        if (raw === null) {
          created.state = "error";
          setTimeout(() => { if (map.get(key) === created) map.delete(key); }, 8000); // a later pan retries
        } else { created.data = decode(raw); created.state = "ready"; }
        this.evict(map, max);
        this.changed();
      });
    }
    s.used = this.frame;
    return s;
  }

  /* ------------------------------------------------------------------ geometry */

  private chunk(cx: number, cy: number): Slot<Chunk> {
    const q = this.index.q, size = this.index.cell;
    const rect: Rect4 = { x0: cx * size, y0: cy * size, x1: (cx + 1) * size, y1: (cy + 1) * size };
    return this.slot(this.chunks, `${cx}-${cy}`, `/data/geo/g-${cx}-${cy}.json`, (raw: ChunkFile): Chunk => {
      const fill = (raw.land ?? []).map((r) => decodeRing(r, q));
      const coast = coastOf(fill, rect, this.seamX);
      return { fill, coast, borders: (raw.borders ?? []).map((r) => decodeRing(r, q)), admin: (raw.admin ?? []).map((r) => decodeRing(r, q)) };
    }, CHUNK_MAX);
  }

  private loadAdminLo() {
    if (this.adminLo || this.adminLoState === "loading") return;
    this.adminLoState = "loading";
    this.fetchJson<LinesFile>("/data/admin-lo.json", (f) => {
      this.adminLo = f ? f.lines.map((l) => decodeRing(l, f.q)) : [];
      this.changed();
    });
  }

  /**
   * Vector paths for ONE rectangle of the world, clipped to it. Rendering a map tile therefore only ever touches the
   * geometry that is actually inside that tile, whatever the complexity of the whole planet.
   *
   * `complete` is false while 1:10m chunks (or the coarse admin borders) the tile needs are still downloading:
   * the caller then draws a coarser level and asks again once `version` changes.
   */
  tilePaths(lod: Lod, c: Rect4, admin: boolean): TilePaths & { complete: boolean } {
    const fill = new Path2D(), coast = new Path2D(), borders = new Path2D(), adminPath = new Path2D();
    const m = 4; // grid pixels of margin so strokes continue past the tile edge
    const wide: Rect4 = { x0: c.x0 - m, y0: c.y0 - m, x1: c.x1 + m, y1: c.y1 + m };
    let complete = true;
    if (lod === "10") {
      const size = this.index.cell;
      const cx0 = Math.max(0, Math.floor(wide.x0 / size)), cx1 = Math.floor(wide.x1 / size);
      const cy0 = Math.max(0, Math.floor(wide.y0 / size)), cy1 = Math.floor(wide.y1 / size);
      const ready: Chunk[] = [];
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.cells.g.has(`${cx}-${cy}`)) continue; // open ocean: nothing to load
        const s = this.chunk(cx, cy);
        if (s.state === "loading") complete = false; else if (s.data) ready.push(s.data);
      }
      if (!complete) return { fill, coast, borders, admin: adminPath, complete };
      for (const ch of ready) {
        addLand(fill, coast, ch.fill, ch.coast, wide);
        addLines(borders, ch.borders, wide);
        if (admin) addLines(adminPath, ch.admin, wide);
      }
      return { fill, coast, borders, admin: adminPath, complete };
    }
    addLand(fill, coast, lod === "110" ? this.low : this.mid, lod === "110" ? this.lowCoast : this.midCoast, wide);
    addLines(borders, this.borders50, wide);
    if (admin) {
      this.loadAdminLo();
      if (!this.adminLo) complete = false; else addLines(adminPath, this.adminLo, wide);
    }
    return { fill, coast, borders, admin: adminPath, complete };
  }

  /* ------------------------------------------------------------------ cities and admin names */

  /** Cities of a tier (1: 15 000–400 000 inhabitants, 2: 1 000–15 000) inside `v`, biggest first. Missing cells start loading. */
  townsIn(tier: 1 | 2, v: Rect4): Town[] {
    const q = this.index.q, size = tier === 1 ? this.index.cell : this.index.cellSmall;
    const set = tier === 1 ? this.cells.c1 : this.cells.c2;
    const map = tier === 1 ? this.townCells[0] : this.townCells[1];
    const out: Town[] = [];
    const cx0 = Math.max(0, Math.floor(v.x0 / size)), cx1 = Math.floor(v.x1 / size);
    const cy0 = Math.max(0, Math.floor(v.y0 / size)), cy1 = Math.floor(v.y1 / size);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = `${cx}-${cy}`;
      if (!set.has(key)) continue;
      const s = this.slot(map, key, `/data/geo/c${tier}-${key}.json`, (rows: [number, number, number, string][]): Town[] =>
        rows.map(([x, y, pop, name]) => ({ x: x / q, y: y / q, pop, name })), CITY_MAX);
      if (s.data) for (const t of s.data) if (t.x >= v.x0 && t.x <= v.x1 && t.y >= v.y0 && t.y <= v.y1) out.push(t);
    }
    return out.sort((a, b) => b.pop - a.pop);
  }

  /** Names of the admin-1 units (loaded on first use), biggest first. */
  adminLabels(): AdminLabel[] | null {
    if (!this.labels && this.labelsState === "idle") {
      this.labelsState = "loading";
      this.fetchJson<AdminRow[]>("/data/admin-labels.json", (rows) => {
        this.labels = (rows ?? []).map(toAdmin);
        this.changed();
      });
    }
    return this.labels;
  }
}

let geoPromise: Promise<Geo> | undefined;
export function loadGeo(): Promise<Geo> {
  return (geoPromise ??= (async () => {
    const [low, mid, borders, index] = await Promise.all([
      fetch("/data/land-110.json").then((r) => r.json() as Promise<LandFile>),
      fetch("/data/land-50.json").then((r) => r.json() as Promise<LandFile>),
      fetch("/data/borders-50.json").then((r) => r.json() as Promise<LinesFile>),
      fetch("/data/geo/index.json").then((r) => r.json() as Promise<IndexFile>),
    ]);
    const rings = (f: LandFile) => f.polygons.flatMap((poly) => poly.map((ring) => decodeRing(ring, f.q)));
    return new Geo(rings(low), rings(mid), borders.lines.map((l) => decodeRing(l, borders.q)), index);
  })());
}

let placesPromise: Promise<Places> | undefined;
export function loadPlaces(): Promise<Places> {
  return (placesPromise ??= fetch("/data/places.json").then((r) => r.json() as Promise<Places>));
}

let searchPromise: Promise<{ admin: AdminLabel[]; towns: SearchTown[] }> | undefined;
/** Départements/states/provinces and cities of 15 000+ inhabitants: downloaded on first use of the search box. */
export function loadSearchIndex() {
  return (searchPromise ??= Promise.all([
    fetch("/data/admin-labels.json").then((r) => r.json() as Promise<AdminRow[]>),
    fetch("/data/search-cities.json").then((r) => r.json() as Promise<[number, number, number, string, string][]>),
  ]).then(([admin, towns]) => ({
    admin: admin.map(toAdmin),
    towns: towns.map(([x, y, pop, name, cc]) => ({ x, y, pop, name, cc })),
  })));
}
