import { GRID_HEIGHT as H, GRID_WIDTH as W } from "@/lib/grid/constants";
import { gridAlpha } from "@/lib/map/pixelGrid";
import { cellDevicePx, cellLook, damage, destroyedRuns, field, fringeLook, fringeShift, hash2, levelAlpha, makeRanker, tearOffset, GLITCH } from "@/lib/doom/corruption";
import { finaleAt, frontX, labelPlan, shakeOffset, shakeZoom, type FinaleFrame } from "@/lib/doom/finale";
import { centeredRect, clampToGrid, intersects, pixelToLonLat, type Rect } from "@/lib/grid/geometry";
import { enoughLand, enoughWater } from "@/lib/grid/pricing";
import { ASSET_SIZES, assetSizeFor, assetUrl } from "@/lib/images/sizes";
import { tintPixels } from "@/lib/images/waterTint";
import { loadGeo, loadPlaces, type Geo, type Lod, type Places } from "./geo";

/**
 * Pixel World map engine — a purpose-built Canvas 2D renderer.
 *
 * Why not MapLibre/Leaflet/OpenSeadragon: the map is a flat 40 000 × 25 000 pixel plane (Web-Mercator, square
 * pixels), not a geodesic surface. A custom renderer gives us nearest-neighbour pixel-exact zoom of user images,
 * one coordinate system for geography + parcels + overlays, zero tile-server infrastructure, and a few hundred lines
 * of code we fully control.
 *
 * Data strategy (nothing ever scales with one billion):
 *   • geography      — static vector layer (Natural Earth 1:110m → 1:10m land, borders, départements/states; GeoNames cities),
 *                      detail chosen by zoom and fetched per 2 500-px cell only where the camera looks
 *   • zoomed out     — 256 px raster tiles composited server-side from parcel images (z = 0…8, CDN-cached per map version)
 *   • zoomed in      — JSON metadata tiles of 1000×1000 px (parcels in view only) + each parcel's own PNG, lazily loaded
 *   • interaction    — hit-testing uses the metadata tiles; the server remains the only authority for purchases
 */

export interface Camera { x: number; y: number; scale: number }
export interface MapParcel { code: string; x: number; y: number; w: number; h: number; assetId: string | null; color: string | null; /** A water parcel: drawn under the land, in three blues. */ water: boolean }
/** `water`: a land parcel that is mostly sea; `land`: a water parcel that is mostly land (the other kind's pixels are cut away, but never most of the parcel). */
export type SelectionState = "ok" | "blocked" | "checking" | "out" | "water" | "land";
export type Mode = "explore" | "buy";

export interface EngineCallbacks {
  onCamera?: (c: Camera) => void;
  onHover?: (p: MapParcel | null) => void;
  onSelectParcel?: (p: MapParcel | null, screen: { x: number; y: number }) => void;
  onCursor?: (wx: number, wy: number) => void;
  onPlace?: (r: Rect) => void;
  onSelectionState?: (s: SelectionState) => void;
  /** Land pixels inside the selection (null while unknown or when nothing is selected). */
  onSelectionLand?: (landPixels: number | null) => void;
  /** The final sequence of the story has finished playing. */
  onFinaleEnd?: () => void;
}

type TileParcel = [string, number, number, number, number, string | null, string | null, 0 | 1];
interface Tile { state: "loading" | "ready" | "error"; parcels: MapParcel[] }
interface Img { el: HTMLImageElement; state: "loading" | "ready" | "error"; used: number }

const TILE = 1000;
const GEO_TILE_PX = 512;
const GEO_CACHE_MAX = 64;
/**
 * The coarsest geography level. Its handful of tiles covers the whole world, is drawn with the land fill ONLY (no lines: a line
 * stretched a thousand times would be a band) and is never evicted: whatever the zoom, a tile that is not drawn yet can at least
 * be shown as a stretched, soft piece of it (land and sea) instead of a hole of ocean colour.
 */
const GEO_BASE_K = -5;
/** A tile with its lines is only stretched from this many levels away at most (each level doubles the width of its lines). */
const GEO_STAND_IN_LEVELS = 3;
/** Commune borders (France) are only drawn from this render level on (≈ ×8 on a normal screen): a commune is then ~70+ px wide. */
const COMMUNES_FROM_K = 4;
const RASTER_PX = 256;
const MAX_Z = 8;
/** What a water parcel shows while nothing better is known: the medium blue. */
const WATER_FILL = "#2f8fd8";
const MAX_IMAGES_IN_FLIGHT = 20; // over HTTP/2 (every host that matters) requests share one connection: more at once is faster, not slower
const MAX_SCALE = 48;
const RASTER_BELOW = 1; // below this zoom the server-composited rasters are shown; above it, parcels are drawn individually
const JSON_ABOVE = 0.1; // below this zoom parcels are sub-2px: no metadata needed

const COLORS = {
  paper: "#fcf9f2",
  ocean: "#c9dfe8",
  land: "#fbf5e6",
  ink: "31,37,64",
  free: "18,184,134",
  accent: "240,67,22",
  danger: "217,45,32",
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rasterSpan = (z: number) => RASTER_PX * 2 ** z;
/** The map wraps around horizontally (like every web map): x is taken modulo the world width. */
const wrapX = (x: number) => ((x % W) + W) % W;
/** Shortest signed horizontal distance between two positions on the wrapped world. */
const wrapDelta = (d: number) => ((((d + W / 2) % W) + W) % W) - W / 2;

export class MapEngine {
  cam: Camera = { x: W / 2, y: H / 2, scale: 0.03 };
  mode: Mode = "explore";
  version = 1;

  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private minScale = 0.02;
  private raf = 0;
  private dirty = true;
  /** World copy being drawn: copy c shows the world shifted by c·W, so the map is continuous across the Bering Strait. */
  private offX = 0;
  private destroyed = false;

  private geo: Geo | null = null;
  private places: Places | null = null;
  private tiles = new Map<string, Tile>();
  private tileQueue: string[] = [];
  /** The frame at which each metadata tile was last wanted (in view, or asked for by a hit-test): see `pumpTiles`. */
  private tileWantedAt = new Map<string, number>();
  private inflight = 0;
  private rasters = new Map<string, Img>();
  private images = new Map<string, Img>();
  private hatch: CanvasPattern | null = null;

  private previewImage: CanvasImageSource | null = null;
  private selection: Rect | null = null;
  private selectionState: SelectionState | null = null;
  private brush: { w: number; h: number } | null = null;
  private ghost: Rect | null = null;
  private ghostWater: { key: string; ver: number; water: boolean } | null = null;
  private minLandPercent = 50;
  private minWaterPercent = 50;
  /** What the buyer is choosing: land or water. A selection only collides with parcels of its own kind. */
  private buyKind: "land" | "water" = "land";
  private selectionLand: number | null = null;
  private highlight: string | null = null;
  private hovered: MapParcel | null = null;
  private pulse = 0;

  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; type: string; moved: boolean }>();
  private drag: "none" | "pan" | "selection" | "pinch" = "none";
  private dragOffset = { x: 0, y: 0 };
  private pinch = { dist: 0, scale: 1, cx: 0, cy: 0 };
  private trail: { t: number; x: number; y: number }[] = [];
  private velocity = { x: 0, y: 0 };
  private anim: { from: Camera; to: Camera; t0: number; dur: number } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };
  private cleanup: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private cb: EngineCallbacks = {}) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    this.bindEvents();
    void loadGeo().then((g) => { this.geo = g; this.buildGeoBase(); g.onUpdate = () => { if (this.selection) this.updateSelectionState(); this.invalidate(); }; this.updateSelectionState(); this.invalidate(); });
    void loadPlaces().then((p) => { this.places = p; this.invalidate(); });
    void document.fonts?.ready.then(() => this.invalidate());
  }

  /* ------------------------------------------------------------------ public API */

  resize(cssW: number, cssH: number, dpr: number) {
    const first = this.w === 1 && this.h === 1;
    this.w = Math.max(1, cssW); this.h = Math.max(1, cssH); this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    // the whole planet fits (height or width): on a window wider than the world, the continuation of the map shows at the sides
    this.minScale = Math.min(this.w / W, this.h / H);
    if (first) this.cam.scale = this.minScale;
    this.constrain();
    this.cb.onCamera?.({ ...this.cam });
    this.invalidate();
  }

  setMode(mode: Mode) { this.mode = mode; if (mode === "explore") { this.ghost = null; this.brush = null; } this.invalidate(); }
  setBrush(b: { w: number; h: number } | null) { this.brush = b; this.ghost = null; this.invalidate(); }
  setHighlight(code: string | null) { this.highlight = code; this.invalidate(); }
  /** Shows the buyer's creation, pixel-exact, inside the selection rectangle ("preview on the map"). */
  setPreviewImage(img: CanvasImageSource | null) { this.previewImage = img; this.previewShown = this.shownPreview(img); this.invalidate(); }
  /** What the preview shows: the creation as it is, or — on water — in the three blues it will have (made once, not at every frame). */
  private previewShown: CanvasImageSource | null = null;
  private shownPreview(img: CanvasImageSource | null): CanvasImageSource | null {
    if (!img || this.buyKind !== "water") return img;
    const w = (img as { width?: number }).width ?? 0, h = (img as { height?: number }).height ?? 0;
    if (!w || !h) return img;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    if (!g) return img;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h);
    tintPixels(d.data, 4);
    g.putImageData(d, 0, 0);
    return c;
  }

  setSelection(r: Rect | null) {
    this.selection = r;
    this.updateSelectionState();
    this.invalidate();
  }

  /** The map changed (purchase, moderation): drop every cache that depends on it. */
  setVersion(v: number) {
    if (v === this.version) return;
    this.version = v;
    this.tiles.clear(); this.tileQueue = []; this.tileWantedAt.clear(); this.rasters.clear();
    this.invalidate();
  }

  fitWorld(animate = true) { this.flyTo({ x: W / 2, y: H / 2, scale: this.minScale }, animate ? 900 : 0); }

  flyTo(target: Camera, duration = 900) {
    const wrapped = this.constrained({ ...target, scale: clamp(target.scale, this.minScale, MAX_SCALE) });
    this.velocity = { x: 0, y: 0 };
    if (duration <= 0) { this.cam = wrapped; this.anim = null; this.afterCameraChange(); return; }
    const to = { ...wrapped, x: this.cam.x + wrapDelta(wrapped.x - this.cam.x) }; // fly the short way round the world
    this.anim = { from: { ...this.cam }, to, t0: performance.now(), dur: duration };
    this.invalidate();
  }

  /** Fit a rectangle (grid px) inside the viewport, optionally leaving room for a side panel. */
  fitRect(r: Rect, opts: { padding?: number; maxScale?: number; duration?: number; offsetX?: number } = {}) {
    const pad = opts.padding ?? 80;
    const scale = Math.min((this.w - pad * 2) / r.w, (this.h - pad * 2) / r.h, opts.maxScale ?? 24);
    this.flyTo({ x: r.x + r.w / 2 + (opts.offsetX ?? 0) / scale, y: r.y + r.h / 2, scale }, opts.duration ?? 900);
  }

  zoomBy(factor: number, ax = this.w / 2, ay = this.h / 2, animate = true) {
    const scale = clamp(this.cam.scale * factor, this.minScale, MAX_SCALE);
    const wx = this.cam.x + (ax - this.w / 2) / this.cam.scale, wy = this.cam.y + (ay - this.h / 2) / this.cam.scale;
    this.flyTo({ scale, x: wx - (ax - this.w / 2) / scale, y: wy - (ay - this.h / 2) / scale }, animate ? 280 : 0);
  }

  /** Screen → grid position; a point over the wrapped copy of the world maps back to the real position. */
  screenToWorld(sx: number, sy: number) {
    return { x: wrapX(this.cam.x + (sx - this.w / 2) / this.cam.scale), y: this.cam.y + (sy - this.h / 2) / this.cam.scale };
  }
  worldToScreen(wx: number, wy: number) {
    return { x: (wx + this.offX - this.cam.x) * this.cam.scale + this.w / 2, y: (wy - this.cam.y) * this.cam.scale + this.h / 2 };
  }

  get fitScale() { return this.minScale; }
  get maxScale() { return MAX_SCALE; }
  get viewport() { return { w: this.w, h: this.h }; }

  /** Parcels currently known (loaded tiles) that intersect the rectangle. */
  parcelsIn(r: Rect, water?: boolean): MapParcel[] | null {
    const out: MapParcel[] = [];
    for (let ty = Math.floor(r.y / TILE); ty <= Math.floor((r.y + r.h - 1) / TILE); ty++) {
      for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) {
        const tile = this.tiles.get(`${tx},${ty}`);
        if (!tile || tile.state !== "ready") { this.ensureTile(tx, ty); return null; }
        for (const p of tile.parcels) if ((water === undefined || p.water === water) && intersects(r, p) && !out.includes(p)) out.push(p);
      }
    }
    return out;
  }

  destroy() {
    this.destroyed = true;
    this.canvas.style.transform = "";
    this.cancelWarm();
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
  }

  /* ------------------------------------------------------------------ camera helpers */

  private constrained(c: Camera): Camera {
    const halfH = this.h / 2 / c.scale;
    // horizontally the world wraps around; vertically keep it on screen: centre when it is smaller than the viewport,
    // otherwise keep a margin of one half-view inside
    const x = wrapX(c.x);
    const y = H <= halfH * 2 ? H / 2 : clamp(c.y, halfH * 0.15, H - halfH * 0.15);
    return { x, y, scale: c.scale };
  }
  private constrain() { this.cam = this.constrained({ ...this.cam, scale: clamp(this.cam.scale, this.minScale, MAX_SCALE) }); }
  private afterCameraChange() { this.cb.onCamera?.({ ...this.cam }); this.invalidate(); }

  /* ------------------------------------------------------------------ data */

  private ensureTile(tx: number, ty: number) {
    if (tx < 0 || ty < 0 || tx >= W / TILE || ty >= H / TILE) return;
    const key = `${tx},${ty}`;
    this.tileWantedAt.set(key, this.frameNo);
    if (this.tiles.has(key)) return;
    this.tiles.set(key, { state: "loading", parcels: [] });
    this.tileQueue.push(key);
    this.pumpTiles();
  }

  /**
   * The camera moves faster than the network. Zooming from the world down to a city passes over a hundred tiles that nobody will
   * ever look at, and in a first-come first-served queue the few the screen really shows would wait behind all of them (seconds,
   * with nothing drawn). So a tile that has not been wanted for a couple of frames is forgotten (and asked for again if the camera
   * comes back), and of the others the nearest to the centre of the screen goes first.
   */
  private pumpTiles() {
    if (this.tileQueue.length) {
      const keep: string[] = [];
      for (const key of this.tileQueue) {
        if (this.frameNo - (this.tileWantedAt.get(key) ?? -99) <= 2) keep.push(key);
        else { this.tiles.delete(key); this.tileWantedAt.delete(key); }
      }
      const cx = this.cam.x / TILE - 0.5, cy = this.cam.y / TILE - 0.5, across = W / TILE;
      const away = (key: string) => {
        const [tx, ty] = key.split(",").map(Number) as [number, number];
        const dx = Math.abs(tx - cx);
        return Math.min(dx, across - dx) ** 2 + (ty - cy) ** 2;
      };
      this.tileQueue = keep.sort((a, b) => away(a) - away(b));
    }
    while (this.inflight < 8 && this.tileQueue.length) {
      const key = this.tileQueue.shift()!;
      const [tx, ty] = key.split(",").map(Number) as [number, number];
      const version = this.version;
      this.inflight++;
      fetch(`/api/map/tiles/${tx}/${ty}?v=${version}`)
        .then((r) => (r.ok ? (r.json() as Promise<TileParcel[]>) : Promise.reject(new Error(String(r.status)))))
        .then((rows) => {
          if (version !== this.version) return;
          this.tiles.set(key, { state: "ready", parcels: rows.map(([code, x, y, w, h, assetId, color, water]) => ({ code, x, y, w, h, assetId, color, water: water === 1 })) });
          this.updateSelectionState();
          this.invalidate();
        })
        .catch(() => {
          if (version !== this.version) return;
          this.tiles.set(key, { state: "error", parcels: [] });
          setTimeout(() => { if (this.tiles.get(key)?.state === "error") this.tiles.delete(key); this.invalidate(); }, 5000);
        })
        .finally(() => { this.inflight--; this.pumpTiles(); });
    }
  }

  private loadImage(map: Map<string, Img>, key: string, url: string, limit: number): Img {
    let e = map.get(key);
    if (e) { e.used = performance.now(); return e; }
    // at most a dozen images in flight per layer: the tiles still wanted next frame are asked for then, the ones the
    // camera has already left are never requested at all
    if (this.loadingCount(map) >= MAX_IMAGES_IN_FLIGHT) return { el: new Image(), state: "loading", used: performance.now() };
    const el = new Image();
    el.decoding = "async";
    e = { el, state: "loading", used: performance.now() };
    map.set(key, e);
    el.onload = () => { e!.state = "ready"; this.invalidate(); };
    el.onerror = () => { e!.state = "error"; };
    el.src = url;
    if (map.size > limit) {
      const oldest = [...map.entries()].filter(([, v]) => v.state !== "loading").sort((a, b) => a[1].used - b[1].used).slice(0, map.size - limit);
      for (const [k] of oldest) map.delete(k);
    }
    return e;
  }

  private loadingCount(map: Map<string, Img>) {
    let n = 0;
    for (const e of map.values()) if (e.state === "loading") n++;
    return n;
  }

  /* ------------------------------------------------------------------ selection */

  /** At least this share of a parcel's pixels must be land (the rest may be sea, at a reduced price): the admin's setting. */
  setLandRule(minLandPercent: number) { this.minLandPercent = minLandPercent; this.updateSelectionState(); this.invalidate(); }
  /** At least this share of a water parcel's pixels must be water (the land cut away is free or discounted): the admin's setting. */
  setWaterRule(minWaterPercent: number) { this.minWaterPercent = minWaterPercent; this.updateSelectionState(); this.invalidate(); }
  /** Land or water: what the selection is for. The land is hatched while buying water (as the sea is while buying land). */
  setBuyKind(kind: "land" | "water") {
    if (kind === this.buyKind) return;
    this.buyKind = kind;
    this.previewShown = this.shownPreview(this.previewImage);
    this.ghostWater = null;
    this.updateSelectionState();
    this.invalidate();
  }
  private enoughOfKind(landPx: number, areaPx: number) {
    return this.buyKind === "water" ? enoughWater(landPx, areaPx, this.minWaterPercent) : enoughLand(landPx, areaPx, this.minLandPercent);
  }

  private updateSelectionState() {
    let s: SelectionState | null = null;
    let landPx: number | null = null;
    const r = this.selection;
    if (r) {
      if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) s = "out";
      else {
        const land = this.geo?.landIn(r);
        if (land && !land.pending) landPx = land.land;
        const hits = this.parcelsIn(r, this.buyKind === "water");
        s = hits === null ? "checking" : hits.length ? "blocked" : "ok";
        // coastal parcels are fine (what is cut away is discounted) but never mostly of the other kind
        if (s === "ok") s = landPx === null ? "checking" : this.enoughOfKind(landPx, r.w * r.h) ? "ok" : this.buyKind === "water" ? "land" : "water";
      }
    }
    if (s !== this.selectionState) { this.selectionState = s; if (s) this.cb.onSelectionState?.(s); }
    if (landPx !== this.selectionLand) { this.selectionLand = landPx; this.cb.onSelectionLand?.(landPx); }
  }

  private place(r: Rect) {
    this.selection = clampToGrid(r);
    this.updateSelectionState();
    this.cb.onPlace?.({ ...this.selection });
    this.invalidate();
  }

  private selectionScreenRect() {
    if (!this.selection) return null;
    const a = this.worldToScreen(this.selection.x, this.selection.y);
    return { x: a.x, y: a.y, w: this.selection.w * this.cam.scale, h: this.selection.h * this.cam.scale };
  }

  /* ------------------------------------------------------------------ input */

  private bindEvents() {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    const local = (e: MouseEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    on(c, "pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, { ...p, sx: p.x, sy: p.y, type: e.pointerType, moved: false });
      this.anim = null; this.velocity = { x: 0, y: 0 }; this.trail = [{ t: e.timeStamp, ...p }];
      if (this.pointers.size === 1) {
        const sr = this.selectionScreenRect();
        const pad = e.pointerType === "touch" ? 18 : 6;
        if (this.mode === "buy" && sr && p.x >= sr.x - pad && p.x <= sr.x + sr.w + pad && p.y >= sr.y - pad && p.y <= sr.y + sr.h + pad) {
          const w = this.screenToWorld(p.x, p.y);
          this.drag = "selection"; this.dragOffset = { x: w.x - this.selection!.x, y: w.y - this.selection!.y };
        } else this.drag = "pan";
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        if (!a || !b) return;
        this.drag = "pinch";
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: this.cam.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      }
      c.dataset.pointerFocus = "1"; // no focus ring for mouse/touch; keyboard users still get one
      c.focus({ preventScroll: true });
    });

    on(c, "pointermove", (e) => {
      const p = local(e);
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) { this.hover(p.x, p.y, e.pointerType); return; }
      const dx = p.x - ptr.x, dy = p.y - ptr.y;
      if (!ptr.moved && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > (e.pointerType === "touch" ? 8 : 4)) ptr.moved = true;
      ptr.x = p.x; ptr.y = p.y;
      if (this.drag === "pinch" && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const scale = clamp(this.pinch.scale * (dist / this.pinch.dist), this.minScale, MAX_SCALE);
        const anchor = this.screenToWorldAt(this.pinch.cx, this.pinch.cy, this.pinch.scale, this.cam);
        this.cam = this.constrained({ scale, x: anchor.x - (cx - this.w / 2) / scale, y: anchor.y - (cy - this.h / 2) / scale });
        this.afterCameraChange();
      } else if (this.drag === "selection" && ptr.moved) {
        const w = this.screenToWorld(p.x, p.y);
        this.place({ ...this.selection!, x: Math.round(w.x - this.dragOffset.x), y: Math.round(w.y - this.dragOffset.y) });
      } else if (this.drag === "pan" && ptr.moved) {
        this.cam = this.constrained({ ...this.cam, x: this.cam.x - dx / this.cam.scale, y: this.cam.y - dy / this.cam.scale });
        this.trail.push({ t: e.timeStamp, ...p });
        if (this.trail.length > 8) this.trail.shift();
        this.afterCameraChange();
        this.setCursor("grabbing");
      }
    });

    const up = (e: PointerEvent) => {
      const ptr = this.pointers.get(e.pointerId);
      if (!ptr) return;
      this.pointers.delete(e.pointerId);
      const p = local(e);
      if (this.drag === "pinch") { if (this.pointers.size < 2) this.drag = this.pointers.size === 1 ? "pan" : "none"; return; }
      const wasDrag = this.drag;
      this.drag = "none";
      this.setCursor();
      if (e.type === "pointercancel") return;
      if (!ptr.moved) { this.click(p.x, p.y, e); return; }
      if (wasDrag === "pan") this.startInertia(e.timeStamp);
    };
    on(c, "pointerup", up);
    on(c, "pointercancel", up);
    on(c, "pointerleave", (e) => { if (e.pointerType === "mouse" && !this.pointers.size) { this.ghost = null; this.setHovered(null); this.invalidate(); } });

    on(c, "wheel", (e) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.012 : 0.0016; // trackpad pinch reports ctrlKey
      const factor = Math.exp(-e.deltaY * unit * k);
        const scale = clamp(this.cam.scale * factor, this.minScale, MAX_SCALE);
      const a = this.screenToWorld(p.x, p.y);
      this.anim = null;
      this.cam = this.constrained({ scale, x: a.x - (p.x - this.w / 2) / scale, y: a.y - (p.y - this.h / 2) / scale });
      this.afterCameraChange();
    }, { passive: false });

    on(c, "keydown", (e) => {
      delete c.dataset.pointerFocus;
      const step = 90 / this.cam.scale;
      const k = e.key;
      if (k === "ArrowLeft") this.flyTo({ ...this.cam, x: this.cam.x - step }, 120);
      else if (k === "ArrowRight") this.flyTo({ ...this.cam, x: this.cam.x + step }, 120);
      else if (k === "ArrowUp") this.flyTo({ ...this.cam, y: this.cam.y - step }, 120);
      else if (k === "ArrowDown") this.flyTo({ ...this.cam, y: this.cam.y + step }, 120);
      else if (k === "+" || k === "=") this.zoomBy(1.6);
      else if (k === "-" || k === "_") this.zoomBy(1 / 1.6);
      else if (k === "0" || k === "Home") this.fitWorld();
      else return;
      e.preventDefault();
    });
  }

  private screenToWorldAt(sx: number, sy: number, scale: number, cam: Camera) {
    return { x: cam.x + (sx - this.w / 2) / scale, y: cam.y + (sy - this.h / 2) / scale };
  }

  private setCursor(v?: string) { this.canvas.style.cursor = v ?? (this.mode === "buy" ? "crosshair" : this.hovered ? "pointer" : "grab"); }

  private startInertia(t: number) {
    const recent = this.trail.filter((s) => t - s.t < 90);
    if (recent.length < 2) return;
    const a = recent[0]!, b = recent[recent.length - 1]!;
    const dt = Math.max(1, b.t - a.t);
    this.velocity = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }; // screen px per ms
    if (Math.hypot(this.velocity.x, this.velocity.y) > 0.15) this.invalidate();
    else this.velocity = { x: 0, y: 0 };
  }

  private hover(sx: number, sy: number, type: string) {
    const w = this.screenToWorld(sx, sy);
    this.cb.onCursor?.(w.x, w.y);
    if (type !== "mouse") return;
    if (this.mode === "buy" && this.brush && !this.selection) {
      this.ghost = centeredRect(w.x, w.y, this.brush.w, this.brush.h);
      this.setCursor();
      this.invalidate();
      return;
    }
    this.setHovered(this.cam.scale >= JSON_ABOVE ? this.parcelAt(w.x, w.y) : null);
    this.setCursor();
  }

  private setHovered(p: MapParcel | null) {
    if (p?.code === this.hovered?.code) return;
    this.hovered = p;
    this.cb.onHover?.(p);
    this.invalidate();
  }

  /** Is this pixel land? `null` while the coast around it is still downloading. (A parcel only owns the pixels of its own kind.) */
  private landAt(wx: number, wy: number): boolean | null {
    const g = this.geo;
    if (!g) return null;
    const x = Math.floor(wx), y = Math.floor(wy), key = `${x},${y}`;
    if (this.lastLandAt?.key === key && this.lastLandAt.ver === g.version) return this.lastLandAt.land;
    const l = g.landIn({ x, y, w: 1, h: 1 });
    if (l.pending) return null;
    this.lastLandAt = { key, ver: g.version, land: l.land > 0 };
    return l.land > 0;
  }
  private lastLandAt: { key: string; ver: number; land: boolean } | null = null;

  /** The parcel that owns the pixel under a point: a land parcel on land, a water parcel on water (the two may share a rectangle). */
  private parcelAt(wx: number, wy: number): MapParcel | null {
    const tile = this.tiles.get(`${Math.floor(wx / TILE)},${Math.floor(wy / TILE)}`);
    if (!tile || tile.state !== "ready") return null;
    let land: boolean | null | undefined;
    for (const p of tile.parcels) {
      if (!(wx >= p.x && wx < p.x + p.w && wy >= p.y && wy < p.y + p.h)) continue;
      if (land === undefined) land = this.landAt(wx, wy);
      if (land === null || land === !p.water) return p;
    }
    return null;
  }

  private click(sx: number, sy: number, e: PointerEvent) {
    const w = this.screenToWorld(sx, sy);
    if (this.mode === "buy" && this.brush) {
      this.ghost = null;
      this.place(centeredRect(w.x, w.y, this.brush.w, this.brush.h));
      return;
    }
    const now = e.timeStamp;
    if (now - this.lastTap.t < 320 && Math.hypot(sx - this.lastTap.x, sy - this.lastTap.y) < 24) {
      this.lastTap.t = 0;
      this.zoomBy(2.2, sx, sy);
      return;
    }
    this.lastTap = { t: now, x: sx, y: sy };
    const parcel = this.cam.scale >= JSON_ABOVE ? this.parcelAt(w.x, w.y) : null;
    if (!parcel && this.cam.scale < 0.4 && !this.parcelAt(w.x, w.y)) {
      // Zoomed far out: a tap zooms towards that spot instead of selecting nothing.
      if (this.cam.scale < JSON_ABOVE) { this.flyTo({ x: w.x, y: w.y, scale: Math.max(this.cam.scale * 4, 0.3) }, 700); return; }
    }
    this.cb.onSelectParcel?.(parcel, { x: sx, y: sy });
  }

  /* ------------------------------------------------------------------ frame loop */

  invalidate() {
    this.dirty = true;
    this.cancelWarm(); // something is changing on screen: tile preparation waits for the next quiet moment
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private lastFrame = 0;
  private frameNo = 0;
  private frame(t: number) {
    this.raf = 0;
    this.frameNo++;
    if (this.destroyed) return;
    const dt = this.lastFrame ? Math.min(48, t - this.lastFrame) : 16;
    this.lastFrame = t;
    let again = false;

    if (this.anim) {
      const k = clamp((performance.now() - this.anim.t0) / this.anim.dur, 0, 1);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      const { from, to } = this.anim;
      const scale = from.scale * (to.scale / from.scale) ** e;
      // interpolate the *screen-space* focus so the zoom feels anchored rather than swooping
      this.cam = { scale, x: wrapX(from.x + (to.x - from.x) * e), y: from.y + (to.y - from.y) * e };
      this.cb.onCamera?.({ ...this.cam });
      if (k >= 1) this.anim = null; else again = true;
    } else if (this.velocity.x || this.velocity.y) {
      this.cam = this.constrained({ ...this.cam, x: this.cam.x - (this.velocity.x * dt) / this.cam.scale, y: this.cam.y - (this.velocity.y * dt) / this.cam.scale });
      const decay = Math.exp(-dt / 325);
      this.velocity = { x: this.velocity.x * decay, y: this.velocity.y * decay };
      if (Math.hypot(this.velocity.x, this.velocity.y) < 0.02) this.velocity = { x: 0, y: 0 }; else again = true;
      this.cb.onCamera?.({ ...this.cam });
    }

    const sr = this.selectionScreenRect();
    if (sr && (sr.w < 28 || sr.h < 28)) { this.pulse = (t % 1400) / 1400; again = true; }

    if (this.dirty || again) { this.dirty = false; this.draw(); }
    if (this.geoPending) { this.dirty = true; again = true; } // geography tiles are still being rasterised: draw the next batch next frame
    if (this.finale) { this.dirty = true; again = true; } // the final sequence is playing
    if (again) this.raf = requestAnimationFrame((n) => this.frame(n));
    else this.scheduleWarm();
  }

  /* ------------------------------------------------------------------ drawing */

  private draw() {
    const { ctx, w, h, dpr, cam } = this;
    const s = cam.scale;
    this.updateFinale();
    this.geo?.tick(this.frameNo);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);

    // the world is a horizontal band: it never ends on the left or right, only at the top and bottom
    const y0 = (0 - cam.y) * s + h / 2, hh = H * s;
    ctx.fillStyle = `rgba(${COLORS.ink},0.07)`;
    ctx.fillRect(0, y0 + 6, w, hh);
    const swapped = this.mode === "buy" && this.buyKind === "water"; // buying water: the colours are swapped, so that nobody mistakes land for water
    ctx.fillStyle = swapped ? COLORS.land : COLORS.ocean;
    ctx.fillRect(0, y0, w, hh);
    if (this.mode === "buy" && this.buyKind === "land") {
      // while buying land, the sea is hatched: land tiles are drawn over it, so only water shows the stripes — "not for sale" (as land)
      ctx.fillStyle = this.seaHatch() ?? COLORS.ocean;
      ctx.fillRect(0, y0, w, hh);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, w, hh);
    ctx.clip();
    this.geoPending = false;
    const halfW = w / 2 / s;
    for (let c = Math.floor((cam.x - halfW) / W); c <= Math.floor((cam.x + halfW) / W); c++) {
      this.offX = c * W; // draw the world copy that covers this stretch of the screen
      const x0 = (this.offX - cam.x) * s + w / 2, ww = W * s;
      this.drawSea(s); // the story: the destroyed seas
      this.drawParcels(s, true); // the water parcels: over the sea, under the land (the coast cuts them)
      this.drawGeography(s);
      if (swapped) { // while buying water, the land takes the colour of the sea and is hatched (the water, cream, is what is for sale)
        const hatch = this.seaHatch();
        this.onLand(s, () => {
          ctx.globalAlpha = 0.82; ctx.fillStyle = COLORS.ocean; ctx.fillRect(x0, y0, ww, hh); ctx.globalAlpha = 1;
          if (hatch) { ctx.fillStyle = hatch; ctx.fillRect(x0, y0, ww, hh); }
        });
      }
      if (this.mode === "buy") { ctx.fillStyle = `rgba(${COLORS.free},0.13)`; ctx.fillRect(x0, y0, ww, hh); }
      // zoomed in, place names sit UNDER the parcels (owners cover the map); zoomed out, parcels are specks and names stay readable on top
      if (s >= RASTER_BELOW) this.drawLabels(s);
      // the pixel grid is a guide to FREE land: it is drawn before the parcels, so a parcel that has been taken shows its
      // creation clean, with no grid line across it
      this.onLand(s, () => this.drawGrid(s)); // the 1 px grid only exists on land: the sea is not for sale
      // A parcel is a rectangle (what is bought, and where it may be placed), but its drawing is cut along the coast: only
      // the part on land is shown, the sea stays sea. (The parcel's own page shows the whole drawing.)
      this.onLand(s, () => this.drawParcels(s), true);
      if (s < RASTER_BELOW) this.drawLabels(s);
      this.drawOverlays(s);
    }
    this.offX = 0;
    ctx.restore();
    this.drawFinaleFront();

    // top and bottom edge of the planet
    ctx.strokeStyle = `rgba(${COLORS.ink},0.55)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y0 - 0.75); ctx.lineTo(w, y0 - 0.75);
    ctx.moveTo(0, y0 + hh + 0.75); ctx.lineTo(w, y0 + hh + 0.75);
    ctx.stroke();
  }

  private visibleWorld() {
    const { cam, w, h } = this;
    // expressed in the grid coordinates of the world copy being drawn (offX)
    return { x0: cam.x - w / 2 / cam.scale - this.offX, y0: cam.y - h / 2 / cam.scale, x1: cam.x + w / 2 / cam.scale - this.offX, y1: cam.y + h / 2 / cam.scale };
  }

  /**
   * Geography is static, so it is rasterised ONCE per (zoom level, tile) into small offscreen canvases and then only
   * blitted: a pan/zoom frame costs a handful of drawImage calls instead of re-filling ~100 000 path segments.
   * Level k renders 512-px tiles at 2^k device pixels per grid pixel, so edges stay vector-sharp at every zoom.
   */
  private geoTiles = new Map<string, { c: HTMLCanvasElement; used: number; complete: boolean; ver: number; step: number }>();

  /* ------------------------------------------------------------------ the "100 days" story: corrupted land */
  /** How corrupted the unacquired land is, as `step / 200` (0.5 % steps), or `null` while the story is off. */
  private story: { step: number } | null = null;
  private ranker: ((v: number) => number) | null = null;
  private seaRanker: ((v: number) => number) | null = null;

  /** Sets how much of the land is corrupted (0 to 1), or `null` for the ordinary map. Tiles of another step are redrawn lazily. */
  setStory(intensity: number | null) {
    const step = intensity === null ? -1 : Math.round(clamp(intensity, 0, 1) * 200);
    if (step === (this.story ? this.story.step : -1)) return;
    this.story = step < 0 ? null : { step };
    this.invalidate();
  }

  /* ------------------------------------------------------------------ the final sequence of the story */
  /** The sequence in progress (null: none). `waiting`: a replay that first needs the screen redrawn in the world before the end. */
  private finale: { start: number; reduced: boolean; waiting: boolean; waitedSince: number } | null = null;
  /** The land in its end state (intensity 1), drawn ahead of the sequence so that nothing has to be made while it plays. */
  private finTiles = new Map<string, { c: HTMLCanvasElement; used: number; complete: boolean; ver: number; step: number }>();
  private finArmed = false;
  private geoMissing = 0;
  private fin: { frame: FinaleFrame; front: number; reduced: boolean; t: number } | null = null;
  /** The clock of the sequence, in ms. Replaceable, so that a test can step through the sequence instead of waiting for it. */
  private finaleNow = () => performance.now();

  /** The countdown is about to reach zero: draw the end state of the visible land now, a few tiles per frame. */
  armFinale() {
    if (this.finArmed) return;
    this.finArmed = true;
    this.invalidate();
  }

  /**
   * Plays the sequence: a sweep crosses the screen from west to east and the land behind it becomes the end state; with `reduced`
   * (the visitor asked for fewer animations) the end state simply fades in. A `replay` starts from the world as it was just
   * before the end, so those tiles are redrawn first.
   */
  startFinale(start: number, reduced: boolean, replay: boolean) {
    if (!this.story) return;
    if (replay) { this.finTiles = new Map([...this.geoTiles].filter(([, t]) => t.step === 200)); this.finSeaTiles = new Map([...this.seaTiles].filter(([, t]) => t.step === 200)); }
    this.finale = { start, reduced, waiting: replay, waitedSince: this.finaleNow() };
    this.finArmed = true;
    this.invalidate();
  }

  private updateFinale() {
    const f = this.finale;
    this.fin = null;
    if (!f || !this.story) return;
    if (f.waiting) {
      if ((this.geoMissing === 0 && this.finTiles.size > 0) || this.finaleNow() - f.waitedSince > 2000) { f.start = this.finaleNow(); f.waiting = false; } else return;
    }
    const t = (this.finaleNow() - f.start) / 1000, frame = finaleAt(t, f.reduced);
    if (frame.done) { this.completeFinale(); return; }
    this.fin = { frame, front: frontX(frame.sweep, this.w), reduced: f.reduced, t };
    if (frame.shake > 0 && !f.reduced) { // the whole picture is thrown about (scaled up a little so that its edges never show)
      const o = shakeOffset(t, frame.shake, Math.min(this.w, this.h));
      this.canvas.style.transform = `translate(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px) rotate(${o.rot.toFixed(3)}deg) scale(${shakeZoom(o, this.w, this.h).toFixed(4)})`;
    } else this.canvas.style.transform = "";
  }

  /** The sweep is over: the end-state tiles become the map's tiles for good (nothing is redrawn), and the story is at its end. */
  private completeFinale() {
    for (const [k, t] of this.finTiles) this.geoTiles.set(k, t);
    this.finTiles.clear();
    for (const [k, t] of this.finSeaTiles) this.seaTiles.set(k, t);
    this.finSeaTiles.clear();
    this.finale = null;
    this.finArmed = false;
    this.story = { step: 200 };
    this.canvas.style.transform = "";
    this.invalidate();
    this.cb.onFinaleEnd?.();
  }

  /**
   * What the sweep leaves on the screen: a dim shadow ahead of the front (the wave is coming), the front itself (a wide band of
   * cyan, magenta and white blocks, a storm of pixels), debris falling behind it, and the flash.
   */
  private drawFinaleFront() {
    const fin = this.fin;
    if (!fin) return;
    const { ctx, w, h } = this;
    if (!fin.reduced && fin.frame.sweep > 0 && fin.frame.sweep < 1) {
      const x = Math.round(fin.front), bucket = Math.floor(fin.t * 14), power = 1 + 2 * fin.frame.shake;
      // ahead: the light goes out, and thin scanlines creep over what is about to go
      const ahead = ctx.createLinearGradient(x, 0, x + 260, 0);
      ahead.addColorStop(0, "rgba(31,37,64,0.30)"); ahead.addColorStop(1, "rgba(31,37,64,0)");
      ctx.fillStyle = ahead; ctx.fillRect(x, 0, Math.min(260, w - x), h);
      ctx.fillStyle = "rgba(106,76,255,0.16)";
      for (let y = bucket & 1; y < h; y += 4) ctx.fillRect(x, y, Math.min(70, w - x), 1);
      // the front: a band of blocks of three sizes, thick at its centre and thinning out behind it
      for (let row = 0; row * 4 < h; row++) {
        const dx = Math.round((hash2(row, bucket) - 0.5) * 18 * power);
        ctx.fillStyle = hash2(row, bucket + 7) < 0.5 ? GLITCH.cyan : GLITCH.magenta;
        ctx.fillRect(x + dx, row * 4, 4 + Math.round(hash2(row, bucket + 9) * 8), 4);
        if (hash2(row, bucket + 3) < 0.35) { ctx.fillStyle = GLITCH.white; ctx.fillRect(x + dx + 6, row * 4, 4, 4); }
      }
      const storm = Math.min(260, Math.round(h / 3));
      for (let i = 0; i < storm; i++) {
        const behind = Math.pow(hash2(i, bucket, 11), 2) * 150, size = [4, 8, 12][Math.floor(hash2(i, bucket, 12) * 3)]!;
        ctx.fillStyle = [GLITCH.cyan, GLITCH.magenta, GLITCH.white, GLITCH.lav, GLITCH.orange][Math.floor(hash2(i, bucket, 13) * 5)]!;
        ctx.fillRect(x - behind - size / 2, Math.round(hash2(i, bucket, 14) * h), size, size);
      }
      ctx.fillStyle = GLITCH.cyan; ctx.fillRect(x - 3, 0, 2, h);
      ctx.fillStyle = GLITCH.magenta; ctx.fillRect(x + 2, 0, 2, h);
      // debris: bits of the world falling away behind the front, drifting down as they go
      for (let i = 0; i < 220; i++) {
        const px = hash2(i, 1, 21) * (w + 160) - 80, age = x - px; // how far behind the front it came apart
        if (age < 0 || age > 300) continue;
        const k = age / 300, size = 3 + Math.floor(hash2(i, 2, 21) * 4) * 2;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = [GLITCH.cyan, GLITCH.magenta, GLITCH.white, GLITCH.lav2][i & 3]!;
        ctx.fillRect(Math.round(px + age * 0.15), Math.round(hash2(i, 3, 21) * h + age * (0.4 + hash2(i, 4, 21) * 0.9)), size, size);
        ctx.globalAlpha = 1;
      }
    }
    if (!fin.reduced && fin.frame.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${0.9 * fin.frame.flash})`; ctx.fillRect(0, 0, w, h); }
  }

  /** Bands of the land just behind the front slide sideways, a few at a time: the world tearing as it goes (harder at each impact). */
  private tearBehindFront() {
    const fin = this.fin;
    if (!fin || fin.reduced || fin.frame.sweep <= 0 || fin.frame.sweep >= 1) return;
    const { ctx, canvas, dpr, h } = this, bucket = Math.floor(fin.t * 6), x1 = Math.round(fin.front) - 8, x0 = Math.max(0, x1 - 240), power = 1 + 3 * fin.frame.shake;
    if (x1 <= 0) return;
    for (let q = 0; q < 18; q++) {
      const y = Math.round(hash2(bucket, q + 20) * h), bh = Math.round(6 + hash2(bucket, q + 40) * 26), dx = Math.round((hash2(bucket, q + 60) - 0.5) * 60 * power);
      ctx.drawImage(canvas, x0 * dpr, y * dpr, (x1 - x0) * dpr, bh * dpr, x0 + dx, y, x1 - x0, bh);
      // the colours slip apart at the edge of a torn band
      ctx.fillStyle = GLITCH.cyan; ctx.fillRect(x0 + dx, y, 2, bh);
      ctx.fillStyle = GLITCH.magenta; ctx.fillRect(x1 + dx - 2, y, 2, bh);
    }
  }

  /**
   * The rank of a place among the land (or, with `sea`, among the water), calibrated once on the coarse coast: "intensity 30 %" then
   * means 30 % of the land AND 30 % of the seas, whatever the shape of the continents: the destruction touches the whole planet.
   */
  private rankOf(sea = false): (v: number) => number {
    const have = sea ? this.seaRanker : this.ranker;
    if (have) return have;
    const pts = sea ? this.geo!.waterLattice(160, 100) : this.geo!.landLattice(160, 100), vals = new Float64Array(pts.length >> 1);
    for (let i = 0; i < vals.length; i++) vals[i] = field(pts[2 * i]!, pts[2 * i + 1]!);
    const r = makeRanker(vals);
    if (sea) this.seaRanker = r; else this.ranker = r;
    return r;
  }

  /**
   * Paints the corruption into a geography tile, inside the land only (`fill` is the tile's land; for the SEA, `sea`, it is the whole tile
   * and the look is the plain lavender field — the error colours stay on the land): big square cells (a few screen
   * pixels whatever the zoom) of scanlined lavender with stray blocks of error colour, colours slipping at the edge of the
   * destroyed area, and bands that have slid sideways. The cells of a level have a fixed size in device pixels, so a tile
   * holds a whole number of them and they never leave seams. Returns where the land is destroyed (for the fringe of the coasts), or
   * `null` when nothing of the tile is touched.
   */
  private paintCorruption(g: CanvasRenderingContext2D, fill: Path2D, k: number, tx: number, ty: number, scale: number, step: number, sea = false): { runs: { j: number; i0: number; i1: number }[]; R: number } | null {
    const I = step / 200;
    if (I <= 0) return null;
    const rank = this.rankOf(sea), R = 64, size = GEO_TILE_PX / scale, lattice = new Float32Array((R + 1) * (R + 1));
    let min = 1;
    for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) { const r = rank(field(tx * size + (i * size) / R, ty * size + (j * size) / R)); lattice[j * (R + 1) + i] = r; if (r < min) min = r; }
    if (I * 1.12 - min <= 0) return null; // nothing of this tile is touched yet
    const cs = cellDevicePx(this.dpr), n = GEO_TILE_PX / cs, alpha = levelAlpha(k), fringe = Math.max(1, cs / 4);
    const B = Math.max(2, n / 16), blocks = n / B; // the tile in 16 × 16 blocks of cells: whole blocks are skipped or filled at once
    g.save();
    g.clip(fill, "evenodd");
    g.setTransform(1, 0, 0, 1, 0, 0); // from here, tile pixels (the clip stays where the land is)
    g.globalAlpha = alpha;
    const lim = I * 1.12;
    for (let by = 0; by < blocks; by++) for (let bx = 0; bx < blocks; bx++) {
      // the ranks at the corners of the block tell whether it is untouched, destroyed from corner to corner, or mixed
      const i0 = Math.floor((bx * B * R) / n), i1 = Math.min(R, Math.ceil(((bx + 1) * B * R) / n)), j0 = Math.floor((by * B * R) / n), j1 = Math.min(R, Math.ceil(((by + 1) * B * R) / n));
      let lo = 1, hi = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const r = lattice[j * (R + 1) + i]!; if (r < lo) lo = r; if (r > hi) hi = r; }
      if (lim - lo <= 0) continue; // untouched
      if ((lim - hi) / 0.1 >= 0.62) { // destroyed everywhere in the block: its scanlines in one go, then the stray blocks of error colour
        for (let r = 0; r < B; r++) {
          const cy = by * B + r, iy = ty * n + cy;
          g.fillStyle = iy & 1 ? GLITCH.lav2 : GLITCH.lav;
          g.fillRect(bx * B * cs + (sea ? 0 : tearOffset(iy >> 1, k) * cs), cy * cs, B * cs, cs);
        }
        if (sea) continue; // the destroyed sea is the lavender field alone: the error colours (magenta, cyan…) belong to the land
        const bseed = (ty * blocks + by) * 7919 + tx * blocks + bx, count = Math.floor(B * B * 0.016 + hash2(bseed, 300 + k));
        for (let q = 0; q < count; q++) {
          g.fillStyle = [GLITCH.magenta, GLITCH.cyan, GLITCH.orange, GLITCH.ink, GLITCH.white, GLITCH.violet][Math.floor(hash2(bseed, 340 + q) * 6)]!;
          g.fillRect((bx * B + Math.floor(hash2(bseed, 310 + q) * B)) * cs, (by * B + Math.floor(hash2(bseed, 320 + q) * B)) * cs, cs, cs);
        }
        continue;
      }
      for (let cy = by * B; cy < (by + 1) * B; cy++) { // mixed: cell by cell
        const v = ((cy + 0.5) / n) * R, j = Math.min(R - 1, Math.floor(v)), fy = v - j, iy = ty * n + cy, off = tearOffset(iy >> 1, k);
        for (let cx = bx * B; cx < (bx + 1) * B; cx++) {
          const u = ((cx + 0.5) / n) * R, i = Math.min(R - 1, Math.floor(u)), fx = u - i, b = j * (R + 1) + i;
          const r = (lattice[b]! * (1 - fx) + lattice[b + 1]! * fx) * (1 - fy) + (lattice[b + R + 1]! * (1 - fx) + lattice[b + R + 2]! * fx) * fy;
          const d = damage(r, I);
          if (d <= 0) continue;
          if (sea) { // the same field, with a clean edge: no colours slipping, no sparks, no sliding band
            if (d >= 0.5) { g.fillStyle = iy & 1 ? GLITCH.lav2 : GLITCH.lav; g.fillRect(cx * cs, cy * cs, cs, cs); }
            continue;
          }
          const look = cellLook(d, hash2(tx * n + cx, iy, 100 + k), iy);
          const px = cx * cs + (d >= 0.6 ? off * cs : 0), py = cy * cs;
          if (look.fill) { g.fillStyle = look.fill; g.fillRect(px, py, cs, cs); }
          if (look.split) { g.fillStyle = GLITCH.cyan; g.fillRect(px - fringe, py, fringe, cs); g.fillStyle = GLITCH.magenta; g.fillRect(px + cs, py, fringe, cs); }
        }
      }
    }
    g.restore();
    return { runs: destroyedRuns(lattice, R, I), R };
  }

  /* ------------------------------------------------------------------ the story: the destroyed seas */
  /**
   * The destruction touches the water as well as the land. Its tiles are a layer of their own, drawn over the ocean colour and UNDER
   * the water parcels (an acquired piece of sea stays intact in a destroyed ocean) and under the land (which is opaque, so the layer
   * needs no clipping at all). `c` is null when nothing of the tile is touched yet.
   */
  private seaTiles = new Map<string, { c: HTMLCanvasElement | null; used: number; step: number }>();
  /** The sea in its end state, drawn ahead of the final sequence (see `finTiles`). */
  private finSeaTiles = new Map<string, { c: HTMLCanvasElement | null; used: number; step: number }>();

  private renderSeaTile(k: number, tx: number, ty: number, step: number): HTMLCanvasElement | null {
    const scale = 2 ** k, size = GEO_TILE_PX / scale;
    const c = document.createElement("canvas");
    c.width = c.height = GEO_TILE_PX;
    const g = c.getContext("2d");
    if (!g) return null;
    g.setTransform(scale, 0, 0, scale, -tx * GEO_TILE_PX, -ty * GEO_TILE_PX);
    const all = new Path2D();
    all.rect(tx * size, ty * size, size, size);
    return this.paintCorruption(g, all, k, tx, ty, scale, step, true) ? c : null;
  }

  private drawSea(s: number) {
    if (!this.story || !this.geo) return;
    const { ctx } = this;
    const k = Math.ceil(Math.log2(s * this.dpr)), size = GEO_TILE_PX / 2 ** k, v = this.visibleWorld(), step = this.story.step;
    const tx0 = Math.max(0, Math.floor(v.x0 / size)), tx1 = Math.min(Math.floor(W / size), Math.floor(v.x1 / size));
    const ty0 = Math.max(0, Math.floor(v.y0 / size)), ty1 = Math.min(Math.floor(H / size), Math.floor(v.y1 / size));
    const missing: { tx: number; ty: number; d: number }[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = this.seaTiles.get(`${k}/${tx}/${ty}`);
      if (!t || t.step !== step) missing.push({ tx, ty, d: Math.hypot((tx + 0.5) * size - this.cam.x, (ty + 0.5) * size - this.cam.y) });
    }
    if (missing.length) { // a few per frame, the nearest to the middle of the view first (as for the land)
      missing.sort((a, b) => a.d - b.d);
      for (const m of missing.slice(0, 3)) this.seaTiles.set(`${k}/${m.tx}/${m.ty}`, { c: this.renderSeaTile(k, m.tx, m.ty, step), used: this.frameNo, step });
      if (missing.length > 3) this.geoPending = true; // keep drawing until the whole view is done
    }
    // the end state of the sea, made ahead of the final sequence
    if (this.finArmed && !(this.finale?.waiting)) {
      let baked = 0;
      for (let ty = ty0; ty <= ty1 && baked < 2; ty++) for (let tx = tx0; tx <= tx1 && baked < 2; tx++) {
        const key = `${k}/${tx}/${ty}`;
        if (this.finSeaTiles.has(key)) continue;
        this.finSeaTiles.set(key, { c: this.renderSeaTile(k, tx, ty, 200), used: this.frameNo, step: 200 });
        baked++;
      }
      if (baked) this.geoPending = true;
    }
    const placed: { key: string; x: number; y: number; px: number }[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = `${k}/${tx}/${ty}`, t = this.seaTiles.get(key), a = this.worldToScreen(tx * size, ty * size), px = size * s;
      placed.push({ key, x: a.x, y: a.y, px });
      if (t) { t.used = this.frameNo; if (t.c) ctx.drawImage(t.c, a.x, a.y, px + 0.6, px + 0.6); continue; }
      // not made yet: the nearest coarser tile we have, stretched (never the bare ocean colour in the middle of a destroyed sea)
      for (let kk = k - 1; kk >= k - GEO_STAND_IN_LEVELS; kk--) {
        const sz = GEO_TILE_PX / 2 ** kk, bx = Math.floor((tx * size) / sz), by = Math.floor((ty * size) / sz), anc = this.seaTiles.get(`${kk}/${bx}/${by}`);
        if (!anc) continue;
        if (anc.c) { const f = (size / sz) * GEO_TILE_PX; ctx.drawImage(anc.c, ((tx * size) - bx * sz) / sz * GEO_TILE_PX, ((ty * size) - by * sz) / sz * GEO_TILE_PX, f, f, a.x, a.y, px + 0.6, px + 0.6); }
        break;
      }
    }
    const fin = this.fin;
    if (fin && this.finSeaTiles.size) { // the final sequence: the end state of the sea, behind the front of the sweep (or fading in)
      ctx.save();
      if (fin.reduced) ctx.globalAlpha = fin.frame.sweep; else { ctx.beginPath(); ctx.rect(0, 0, Math.max(0, fin.front), this.h); ctx.clip(); }
      for (const p of placed) { const ft = this.finSeaTiles.get(p.key); if (ft?.c) ctx.drawImage(ft.c, p.x, p.y, p.px + 0.6, p.px + 0.6); }
      ctx.restore();
    }
    if (this.seaTiles.size > 120) { // never evict what is on screen: 120 tiles are far more than a view needs
      const old = [...this.seaTiles.entries()].sort((x, y) => x[1].used - y[1].used).slice(0, this.seaTiles.size - 100);
      for (const [key] of old) this.seaTiles.delete(key);
    }
  }

  /** Where the cyan and magenta echoes of the coasts are made (one tile's worth, reused: tiles are drawn one after the other). */
  private fringeLayer: HTMLCanvasElement | null = null;

  /**
   * The coasts of the destroyed land come apart into colours: a cyan echo of the coastline slipped to one side and a magenta one
   * to the other (white where they overlap), a few bands of them slid sideways. Drawn over the coast line, and only where the land
   * is destroyed (`runs`: the destroyed stretches of the tile, in rows of 8 px), so the intact land keeps its clean coast.
   */
  private paintCoastFringe(g: CanvasRenderingContext2D, coast: Path2D, corrupted: { runs: { j: number; i0: number; i1: number }[]; R: number } | null, k: number, tx: number, ty: number, scale: number) {
    if (!corrupted || corrupted.runs.length === 0) return;
    const T = GEO_TILE_PX, cs = cellDevicePx(this.dpr), look = fringeLook(k, cs), o = look.offset, w = look.width; // thinner and tighter when zoomed out
    const layer = this.fringeLayer ?? (this.fringeLayer = Object.assign(document.createElement("canvas"), { width: T, height: T }));
    const f = layer.getContext("2d");
    if (!f) return;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.globalCompositeOperation = "source-over";
    f.clearRect(0, 0, T, T);
    f.globalCompositeOperation = "lighter"; // where the two echoes meet, cyan + magenta make white
    f.lineJoin = "round"; f.lineCap = "round"; f.lineWidth = w / scale;
    f.setTransform(scale, 0, 0, scale, -tx * T - o, -ty * T); f.strokeStyle = GLITCH.cyan; f.stroke(coast);
    f.setTransform(scale, 0, 0, scale, -tx * T + o, -ty * T); f.strokeStyle = GLITCH.magenta; f.stroke(coast);
    const { runs, R } = corrupted, cell = T / R;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = levelAlpha(k) * look.alpha;
    // the layer is copied into the tile in bands of two rows, each slid by its own amount; neighbouring bands that are alike are copied in one go
    let cur: { i0: number; i1: number; dx: number; j0: number; j1: number } | null = null;
    const flush = () => {
      if (!cur) return;
      const x0 = cur.i0 * cell, wd = (cur.i1 - cur.i0) * cell, y = cur.j0 * cell, hh = (cur.j1 - cur.j0 + 1) * cell;
      g.drawImage(layer, x0 - cur.dx, y, wd, hh, x0, y, wd, hh);
      cur = null;
    };
    for (const r of runs) {
      const dx = Math.round(fringeShift((ty * R + r.j) >> 1, k, cs) * look.slide);
      if (cur && cur.i0 === r.i0 && cur.i1 === r.i1 && cur.dx === dx && cur.j1 === r.j - 1) cur.j1 = r.j; else { flush(); cur = { i0: r.i0, i1: r.i1, dx, j0: r.j, j1: r.j }; }
    }
    flush();
    g.restore();
  }
  private geoPending = false;

  /** Level of detail for a render level k (2^k device pixels per grid pixel). */
  private lodFor(k: number): Lod { return k <= -2 ? "110" : k === -1 ? "50" : "10"; }

  /**
   * Rasterises one geography tile. With `strict` it refuses (returns null) to draw anything while data the tile needs is
   * still downloading — pre-rendering must never spend time on a stand-in that will be redrawn anyway.
   */
  private renderGeoTile(k: number, tx: number, ty: number, strict = false, fillOnly = false, stepOverride?: number): { c: HTMLCanvasElement; complete: boolean } | null {
    if (!this.geo) return null;
    const scale = 2 ** k, size = GEO_TILE_PX / scale;
    const rect = { x0: tx * size, y0: ty * size, x1: (tx + 1) * size, y1: (ty + 1) * size };
    const admin = k >= -3; // départements / states / provinces appear once a country spans a few hundred screen pixels
    const communes = k >= COMMUNES_FROM_K; // commune borders: only once a commune is wide enough to read, and its data is worth loading
    let lod = this.lodFor(k);
    let paths = this.geo.tilePaths(lod, rect, admin, communes);
    if (strict && !(paths.complete && !paths.extraPending)) return null;
    // the 1:10m cells this tile needs are still downloading: draw the 1:50m level meanwhile, redrawn when they arrive
    if (!paths.complete && lod === "10") { lod = "50"; paths = this.geo.tilePaths(lod, rect, admin, communes); }
    const complete = paths.complete && !paths.extraPending;
    const c = document.createElement("canvas");
    c.width = c.height = GEO_TILE_PX;
    const g = c.getContext("2d");
    if (!g) return null;
    const dprBoost = this.dpr > 1.5 ? 1.15 : 1;
    g.setTransform(scale, 0, 0, scale, -tx * GEO_TILE_PX, -ty * GEO_TILE_PX);
    g.lineJoin = "round";
    g.lineCap = "round"; // clipped outlines are separate pieces: round caps close the joints between them
    g.fillStyle = COLORS.land;
    g.fill(paths.fill, "evenodd");
    if (fillOnly) return { c, complete };
    const corrupted = this.story ? this.paintCorruption(g, paths.fill, k, tx, ty, scale, stepOverride ?? this.story.step) : null; // the story: corrupted land, under the borders and the coast
    // Borders are SOLID thin lines (dashes cost a lot to rasterise and read as noise), kept discreet by their opacity.
    if (communes) {
      g.strokeStyle = `rgba(${COLORS.ink},${k >= 5 ? 0.3 : 0.22})`;
      g.lineWidth = (k >= 5 ? 0.9 : 0.75) * dprBoost / scale;
      g.stroke(paths.communes);
    }
    if (admin) {
      g.strokeStyle = `rgba(${COLORS.ink},${k >= 2 ? 0.3 : k >= 0 ? 0.24 : 0.15})`;
      g.lineWidth = (k >= 1 ? 1 : 0.85) * dprBoost / scale;
      g.stroke(paths.admin);
    }
    if (k >= -4) {
      const strong = k >= 0;
      g.strokeStyle = `rgba(${COLORS.ink},${strong ? 0.36 : clamp(0.09 + (k + 4) * 0.022, 0.09, 0.2)})`;
      g.lineWidth = (strong ? 1.3 : 1.4) * dprBoost / scale;
      g.stroke(paths.borders);
    }
    g.strokeStyle = `rgba(${COLORS.ink},0.62)`;
    g.lineWidth = (clamp(1.6 + k * 0.12, 1.4, 2.6) * dprBoost) / scale;
    g.stroke(paths.coast);
    this.paintCoastFringe(g, paths.coast, corrupted, k, tx, ty, scale); // the story: the coasts of the destroyed land come apart into colours
    return { c, complete };
  }

  /* ------------------------------------------------------------------ pre-rendering */

  private warmTimer = 0;
  private warmIdle = 0;
  private warmScratch: CanvasRenderingContext2D | null = null;

  private cancelWarm() {
    if (this.warmTimer) clearTimeout(this.warmTimer);
    if (this.warmIdle) (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(this.warmIdle);
    this.warmTimer = this.warmIdle = 0;
  }

  /**
   * Once the camera has been still for a moment, rasterise — one tile per idle slot — the tiles the next gesture will need:
   * the ring around the view, the level one step closer (centre of the view) and the level one step further. A pan or a zoom
   * step then only blits tiles that already exist instead of rasterising them while the finger moves. The geometry of those
   * tiles is requested too, so it is downloaded before it is needed.
   */
  private scheduleWarm() {
    if (this.warmTimer || this.warmIdle || this.destroyed || !this.geo) return;
    this.warmTimer = window.setTimeout(() => {
      this.warmTimer = 0;
      const ric = (window as { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number }).requestIdleCallback;
      const step = (d?: IdleDeadline) => {
        this.warmIdle = 0;
        if (this.destroyed || this.dirty || this.anim || this.drag !== "none" || this.geoPending || document.visibilityState === "hidden") return; // the next frame reschedules
        let left = true;
        do { left = this.warmNow(1) > 0; } while (left && d && d.timeRemaining() > 14);
        if (left) this.scheduleWarm();
      };
      this.warmIdle = ric ? ric(step, { timeout: 1500 }) : window.setTimeout(() => step(), 40);
    }, 220);
  }

  /** Tiles likely to be needed next and not prepared yet, most likely first (the level of the view, then closer, then further). */
  private warmCandidates(): { k: number; tx: number; ty: number }[] {
    const s = this.cam.scale, k = Math.ceil(Math.log2(s * this.dpr));
    const lean = ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) < 4 || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const out: { k: number; tx: number; ty: number }[] = [];
    const level = (kk: number, share: number, margin: number, max: number) => {
      const size = GEO_TILE_PX / 2 ** kk, hw = (this.w / 2 / s) * share, hh = (this.h / 2 / s) * share;
      const tx0 = Math.max(0, Math.floor((this.cam.x - hw) / size) - margin), tx1 = Math.min(Math.floor(W / size), Math.floor((this.cam.x + hw) / size) + margin);
      const ty0 = Math.max(0, Math.floor((this.cam.y - hh) / size) - margin), ty1 = Math.min(Math.floor(H / size), Math.floor((this.cam.y + hh) / size) + margin);
      const list: { k: number; tx: number; ty: number; d: number }[] = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        if (this.geoTiles.has(`${kk}/${tx}/${ty}`)) continue; // already prepared (the visible ones, mostly): it must not take a slot
        list.push({ k: kk, tx, ty, d: Math.hypot((tx + 0.5) * size - this.cam.x, (ty + 0.5) * size - this.cam.y) });
      }
      out.push(...list.sort((a, b) => a.d - b.d).slice(0, max));
    };
    level(k, 1, 1, 14); // the view and the ring around it (what a pan reveals)
    if (!lean) {
      level(k + 1, 0.5, 0, 8); // one zoom step closer: the middle of the view
      if (k - 1 >= -5) level(k - 1, 1, 0, 6); // one zoom step further
    }
    return out;
  }

  /**
   * Rasterises up to `max` of the tiles `warmCandidates` lists that do not exist yet and whose data is here; returns how many it
   * made (0: nothing left to prepare). Also what the idle scheduler calls, one tile at a time.
   */
  warmNow(max = Infinity): number {
    if (!this.geo) return 0;
    const cap = GEO_CACHE_MAX - 4;
    let made = 0;
    for (const c of this.warmCandidates()) {
      if (made >= max || this.geoTiles.size >= cap) break;
      const key = `${c.k}/${c.tx}/${c.ty}`;
      const r = this.renderGeoTile(c.k, c.tx, c.ty, true); // null while its data is still downloading (that download is now under way)
      if (!r) continue;
      // canvas drawing is lazy: touching the tile once makes the browser rasterise it now rather than at the first blit
      if (!this.warmScratch) { const sc = document.createElement("canvas"); sc.width = sc.height = 1; this.warmScratch = sc.getContext("2d"); }
      this.warmScratch?.drawImage(r.c, 0, 0, 1, 1);
      this.geoTiles.set(key, { c: r.c, used: this.frameNo, complete: true, ver: this.geo.version, step: this.story ? this.story.step : -1 });
      made++;
    }
    return made;
  }

  /** The pinned world-wide base (a few fill-only tiles, see `GEO_BASE_K`): built once the geography is there. */
  private geoBase = new Map<string, HTMLCanvasElement>();
  private buildGeoBase() {
    if (!this.geo) return;
    const size = GEO_TILE_PX / 2 ** GEO_BASE_K;
    for (let ty = 0; ty <= Math.floor(H / size); ty++) for (let tx = 0; tx <= Math.floor(W / size); tx++) {
      const r = this.renderGeoTile(GEO_BASE_K, tx, ty, false, true);
      if (r) this.geoBase.set(`${tx}/${ty}`, r.c);
    }
  }

  /**
   * What to show for a tile that is not drawn yet, so that the ocean colour never shows through over land: the nearest coarser
   * tile we have (a few levels at most), else the soft world base, stretched — and over it any finer tiles we already have, shrunk.
   */
  private drawGeoStandIn(k: number, tx: number, ty: number, ax: number, ay: number, px: number) {
    const { ctx } = this;
    const size = GEO_TILE_PX / 2 ** k;
    const stretch = (c: HTMLCanvasElement, kk: number) => {
      const sz = GEO_TILE_PX / 2 ** kk, bx = Math.floor((tx * size) / sz), by = Math.floor((ty * size) / sz);
      const f = (size / sz) * GEO_TILE_PX;
      return { bx, by, draw: () => ctx.drawImage(c, ((tx * size) - bx * sz) / sz * GEO_TILE_PX, ((ty * size) - by * sz) / sz * GEO_TILE_PX, f, f, ax, ay, px + 0.6, px + 0.6) };
    };
    let done = false;
    for (let kk = k - 1; kk >= Math.max(k - GEO_STAND_IN_LEVELS, GEO_BASE_K) && !done; kk--) {
      const sz = GEO_TILE_PX / 2 ** kk;
      const anc = this.geoTiles.get(`${kk}/${Math.floor((tx * size) / sz)}/${Math.floor((ty * size) / sz)}`);
      if (anc) { stretch(anc.c, kk).draw(); done = true; }
    }
    if (!done) {
      const sz = GEO_TILE_PX / 2 ** GEO_BASE_K;
      const base = this.geoBase.get(`${Math.floor((tx * size) / sz)}/${Math.floor((ty * size) / sz)}`);
      if (base) stretch(base, GEO_BASE_K).draw();
    }
    for (let d = 2; d >= 1; d--) { // the finer level first, the closer one over it
      const n = 2 ** d;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const child = this.geoTiles.get(`${k + d}/${tx * n + i}/${ty * n + j}`);
        if (child) ctx.drawImage(child.c, ax + (i * px) / n, ay + (j * px) / n, px / n + 0.6, px / n + 0.6);
      }
    }
  }

  private drawGeography(s: number) {
    if (!this.geo) return;
    const { ctx } = this;
    const k = Math.ceil(Math.log2(s * this.dpr));
    const size = GEO_TILE_PX / 2 ** k; // grid pixels covered by one tile edge
    const v = this.visibleWorld();
    const tx0 = Math.max(0, Math.floor(v.x0 / size)), tx1 = Math.min(Math.floor(W / size), Math.floor(v.x1 / size));
    const ty0 = Math.max(0, Math.floor(v.y0 / size)), ty1 = Math.min(Math.floor(H / size), Math.floor(v.y1 / size));
    ctx.imageSmoothingEnabled = true;
    // a few tiles are rasterised per frame (the cost is bounded), the ones nearest to the middle of the view first
    const missing: { tx: number; ty: number; d: number }[] = [];
    const step = this.story ? this.story.step : -1;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const tile = this.geoTiles.get(`${k}/${tx}/${ty}`);
      // a tile drawn from a coarser level while data was missing is redrawn once new data has arrived; so is one of another step of the story
      if (!tile || (!tile.complete && tile.ver !== this.geo.version) || tile.step !== step) missing.push({ tx, ty, d: Math.hypot((tx + 0.5) * size - this.cam.x, (ty + 0.5) * size - this.cam.y) });
    }
    this.geoMissing = missing.length;
    if (missing.length) {
      missing.sort((a, b) => a.d - b.d);
      for (const m of missing.slice(0, 4)) {
        const r = this.renderGeoTile(k, m.tx, m.ty);
        if (r) this.geoTiles.set(`${k}/${m.tx}/${m.ty}`, { c: r.c, used: 0, complete: r.complete, ver: this.geo.version, step });
      }
    }
    // the end state of the visible land, made ahead of the final sequence (or while it plays, if the camera moved)
    if (this.story && this.finArmed && !(this.finale?.waiting)) {
      let baked = 0;
      for (let ty = ty0; ty <= ty1 && baked < 2; ty++) for (let tx = tx0; tx <= tx1 && baked < 2; tx++) {
        const key = `${k}/${tx}/${ty}`, have = this.finTiles.get(key);
        if (have && have.ver === this.geo.version) continue;
        const r = this.renderGeoTile(k, tx, ty, false, false, 200);
        if (r) { this.finTiles.set(key, { c: r.c, used: this.frameNo, complete: r.complete, ver: this.geo.version, step: 200 }); baked++; }
      }
      if (baked) this.geoPending = true; // keep drawing until the whole visible land is ready
    }
    const placed: { key: string; x: number; y: number; px: number }[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const tile = this.geoTiles.get(`${k}/${tx}/${ty}`);
      const a = this.worldToScreen(tx * size, ty * size);
      const px = size * s;
      placed.push({ key: `${k}/${tx}/${ty}`, x: a.x, y: a.y, px });
      if (tile) { tile.used = this.frameNo; ctx.drawImage(tile.c, a.x, a.y, px + 0.6, px + 0.6); if (!tile.complete && tile.ver !== this.geo.version) this.geoPending = true; continue; }
      this.geoPending = true;
      this.drawGeoStandIn(k, tx, ty, a.x, a.y, px);
    }
    const fin = this.fin;
    if (fin && this.finTiles.size) { // the final sequence: the end state of the land, behind the front of the sweep (or fading in)
      ctx.save();
      if (fin.reduced) ctx.globalAlpha = fin.frame.sweep; else { ctx.beginPath(); ctx.rect(0, 0, Math.max(0, fin.front), this.h); ctx.clip(); }
      for (const p of placed) { const ft = this.finTiles.get(p.key); if (ft) ctx.drawImage(ft.c, p.x, p.y, p.px + 0.6, p.px + 0.6); }
      ctx.restore();
      this.tearBehindFront();
    }
    // never evict what is on screen: the cache must at least hold the visible tiles
    const cacheMax = Math.max(GEO_CACHE_MAX, (tx1 - tx0 + 1) * (ty1 - ty0 + 1) + 16);
    if (this.geoTiles.size > cacheMax) {
      const old = [...this.geoTiles.entries()].sort((x, y) => x[1].used - y[1].used).slice(0, this.geoTiles.size - cacheMax + 8);
      for (const [key] of old) this.geoTiles.delete(key);
    }
  }

  /** Land (grid px) around the view at the current level of detail, kept while the camera stays inside it. */
  private landCache: { lod: Lod; ver: number; complete: boolean; rect: { x0: number; y0: number; x1: number; y1: number }; path: Path2D } | null = null;

  private landPath(s: number): Path2D | null {
    const geo = this.geo;
    if (!geo) return null;
    const v = this.visibleWorld();
    let lod = this.lodFor(Math.ceil(Math.log2(s * this.dpr)));
    const c = this.landCache;
    if (c && c.lod === lod && c.ver === geo.version && c.rect.x0 <= v.x0 && c.rect.y0 <= v.y0 && c.rect.x1 >= v.x1 && c.rect.y1 >= v.y1) return c.path;
    // a region twice the size of the view, snapped to a power-of-two grid so panning rarely rebuilds it
    const span = Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(v.x1 - v.x0, v.y1 - v.y0))));
    const rect = {
      x0: Math.max(0, Math.floor((v.x0 - span / 2) / span) * span), y0: Math.max(0, Math.floor((v.y0 - span / 2) / span) * span),
      x1: Math.min(W, Math.ceil((v.x1 + span / 2) / span) * span), y1: Math.min(H, Math.ceil((v.y1 + span / 2) / span) * span),
    };
    const want = lod;
    let t = geo.tilePaths(lod, rect, false);
    if (!t.complete && lod === "10") { lod = "50"; t = geo.tilePaths(lod, rect, false); } // cells still downloading: the coarser coast meanwhile
    this.landCache = { lod: want, ver: geo.version, complete: t.complete, rect, path: t.fill };
    return t.fill;
  }

  /**
   * Runs `draw` clipped to the land: grid lines stop at the coast instead of covering oceans and seas.
   * Without geography yet, nothing is drawn — unless `whenUnknown` (a creation must never disappear because the coast has not loaded).
   */
  private onLand(s: number, draw: () => void, whenUnknown = false) {
    const path = this.landPath(s);
    if (!path) { if (whenUnknown) draw(); return; }
    const { ctx, dpr, cam, w, h } = this;
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ((this.offX - cam.x) * s + w / 2), dpr * (h / 2 - cam.y * s)); // grid → device px
    ctx.clip(path, "evenodd");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
    ctx.restore();
  }

  /** The water, as a clip: a rectangle much bigger than the world with the land cut out of it (even-odd), rebuilt when the land is. */
  private waterPathCache: { land: Path2D; path: Path2D } | null = null;

  /** Runs `draw` clipped to the water (the sea, the oceans): the counterpart of `onLand`, for what a water parcel shows. */
  private onWater(s: number, draw: () => void, whenUnknown = false) {
    const land = this.landPath(s);
    if (!land) { if (whenUnknown) draw(); return; }
    let wp = this.waterPathCache;
    if (!wp || wp.land !== land) {
      const path = new Path2D();
      path.rect(-W, -H, 3 * W, 3 * H);
      path.addPath(land);
      wp = this.waterPathCache = { land, path };
    }
    const { ctx, dpr, cam, w, h } = this;
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ((this.offX - cam.x) * s + w / 2), dpr * (h / 2 - cam.y * s));
    ctx.clip(wp.path, "evenodd");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
    ctx.restore();
  }

  /**
   * Place names, most important first so they win collisions: countries → big cities → départements/states →
   * mid-size cities → towns. Each layer has its own zoom range; the smaller layers load their data on demand.
   */
  private drawLabels(s: number) {
    if (!this.places || !this.geo || s < 0.025) return;
    if (this.story && this.story.step >= 200 && !this.finale) return; // the end state: every name has been erased, for good
    const { ctx, w, h } = this;
    // during the final sequence the sweep erases the names as it passes: whole ahead of its front, tearing away just behind it
    const fin = this.fin, plan = fin ? labelPlan(fin.frame.sweep, fin.front, w, fin.reduced) : null, front = plan?.whole ? plan.whole[0] : 0, tearFrom = plan?.tearing ? plan.tearing[0] : 0;
    const v = this.visibleWorld();
    const lang = document.documentElement.lang === "fr" ? "fr" : "en";
    const FONT = `"Instrument Sans Variable", system-ui, sans-serif`;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const put = (text: string, x: number, y: number, a: number, ink: number) => {
      ctx.strokeStyle = `rgba(251,245,230,${0.85 * a})`;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = `rgba(${COLORS.ink},${ink * a})`;
      ctx.fillText(text, x, y);
    };
    const clipped = (x0: number, x1: number, draw: () => void) => { ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, h); ctx.clip(); draw(); ctx.restore(); };
    const label = (text: string, x: number, y: number, a: number, align: CanvasTextAlign = "center", ink = 0.55) => {
      const tw = ctx.measureText(text).width, th = 13;
      const x0 = align === "left" ? x : x - tw / 2;
      const box = { x0: x0 - 3, y0: y - th / 2 - 2, x1: x0 + tw + 3, y1: y + th / 2 + 2 };
      if (placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) return false; // collision: skip
      placed.push(box);
      ctx.textAlign = align;
      if (!plan) { put(text, x, y, a, ink); return true; }
      if (!plan.tearing) { put(text, x, y, a * plan.alpha, ink); return true; } // before the front arrives (or fading, for reduced motion)
      if (box.x0 >= front) { put(text, x, y, a, ink); return true; } // ahead of the front: untouched
      if (box.x1 > front) clipped(front, w, () => put(text, x, y, a, ink)); // the front is crossing this name: the part ahead stays
      if (box.x1 > tearFrom) { // what is left of it tears away: cyan and magenta ghosts, thrown sideways, fading with the distance
        const f = clamp((box.x1 - tearFrom) / (front - tearFrom), 0, 1), jitter = Math.round((hash2(Math.floor((fin?.t ?? 0) * 14) + Math.round(y), Math.round(x)) - 0.5) * 70 * (1 - f)) + 3;
        clipped(0, front, () => {
          ctx.globalAlpha = 0.7 * f * a;
          ctx.fillStyle = GLITCH.cyan; ctx.fillText(text, x + jitter - 2, y);
          ctx.fillStyle = GLITCH.magenta; ctx.fillText(text, x + jitter + 2, y);
          ctx.globalAlpha = 1;
        });
      }
      return true;
    };
    const onScreen = (p: { x: number; y: number }, m: number) => p.x > -m && p.y > -m && p.x < w + m && p.y < h + m;
    const dot = (p: { x: number; y: number }, size: number, a: number) => {
      if (plan?.tearing && p.x < front) return; // the sweep has taken this one
      ctx.fillStyle = `rgba(${COLORS.ink},${0.7 * a * (plan && !plan.tearing ? plan.alpha : 1)})`;
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    };

    // 1. countries
    if (s <= 1.2) {
      const fade = clamp((1.2 - s) / 0.6, 0, 1);
      ctx.font = `600 ${s > 0.12 ? 13 : 11}px ${FONT}`;
      // big countries first so they win collisions
      const byArea = [...this.places.countries].sort((a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]) - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]));
      for (const c of byArea) {
        const [bx0, by0, bx1, by1] = c.bbox;
        const name = (lang === "fr" ? c.fr : c.en).toUpperCase();
        if ((bx1 - bx0) * s < ctx.measureText(name).width * 0.9 || (by1 - by0) * s < 14) continue;
        const p = this.worldToScreen((bx0 + bx1) / 2, (by0 + by1) / 2);
        if (onScreen(p, 60)) label(name, p.x, p.y, fade);
      }
    }

    // 2. big cities (≥ 400 000), always known
    if (s >= 0.16) {
      ctx.font = `600 ${s > 0.8 ? 13 : 12}px ${FONT}`;
      const minPop = s > 0.8 ? 400_000 : s > 0.4 ? 1_000_000 : s > 0.25 ? 2_500_000 : 5_000_000;
      for (const c of this.places.cities) {
        if (c.pop < minPop) break; // sorted by population
        const p = this.worldToScreen(c.x, c.y);
        if (!onScreen(p, 40)) continue;
        if (label(c.en, p.x + 7, p.y, 1, "left", 0.7)) dot(p, 5, 1);
      }
    }

    // 3. admin-1 units: départements, states, provinces
    if (s >= 0.12) {
      const labels = this.geo.adminLabels();
      if (labels) {
        const a = clamp((s - 0.12) / 0.2, 0, 1);
        ctx.font = `italic 500 ${s > 3 ? 13 : 11.5}px ${FONT}`;
        const pad = 80 / s;
        for (const l of labels) {
          if (l.x < v.x0 - pad || l.x > v.x1 + pad || l.y < v.y0 - pad || l.y > v.y1 + pad) continue;
          const name = lang === "fr" && l.fr ? l.fr : l.en;
          // a unit gets its name once it is wide enough on screen to hold it
          if (l.s * s * 1.25 < name.length * 6.2) continue;
          const p = this.worldToScreen(l.x, l.y);
          label(name, p.x, p.y, a, "center", 0.5);
        }
      }
    }

    // 4. cities of 15 000+ and towns of 1 000+, fetched per cell as the zoom reaches them
    const pad = 60 / s, view = { x0: v.x0 - pad, y0: v.y0 - pad, x1: v.x1 + pad, y1: v.y1 + pad };
    const drawTowns = (rows: { x: number; y: number; pop: number; name: string }[], minPop: number, size: number, dotSize: number) => {
      ctx.font = `500 ${size}px ${FONT}`;
      let n = 0;
      for (const t of rows) {
        if (t.pop < minPop) break;
        const p = this.worldToScreen(t.x, t.y);
        if (!onScreen(p, 40)) continue;
        if (label(t.name, p.x + 6, p.y, 1, "left", 0.66)) dot(p, dotSize, 1);
        if (++n > 400) break;
      }
    };
    if (s >= 1.1) drawTowns(this.geo.townsIn(1, view), s < 2.2 ? 100_000 : s < 4 ? 40_000 : 15_000, 12, 4);
    if (s >= 6) drawTowns(this.geo.townsIn(2, view), s < 10 ? 5_000 : 1_000, 11, 3);
    ctx.restore();
  }

  private seaPattern: CanvasPattern | null = null;
  private seaHatch() {
    if (this.seaPattern) return this.seaPattern;
    const c = document.createElement("canvas");
    c.width = c.height = 10;
    const g = c.getContext("2d")!;
    g.strokeStyle = `rgba(${COLORS.ink},0.13)`; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(-1, 11); g.lineTo(11, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(9, 11); g.lineTo(11, 9); g.stroke();
    return (this.seaPattern = this.ctx.createPattern(c, "repeat"));
  }

  private hatchPattern() {
    if (this.hatch) return this.hatch;
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e3ddcf"; g.fillRect(0, 0, 8, 8);
    g.strokeStyle = "#c9c1ae"; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-1, 9); g.lineTo(9, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(7, 9); g.lineTo(9, 7); g.stroke();
    return (this.hatch = this.ctx.createPattern(c, "repeat"));
  }

  /**
   * The parcels of one kind: land (clipped to the land by the caller, drawn over the land) or WATER (drawn before the land, over the
   * sea, so that the land — opaque — cuts them along the coast at every zoom, for free). Water is shown in three blues: the server
   * already serves the blue pictures and the blue average colours.
   */
  private drawParcels(s: number, water = false) {
    const v = this.visibleWorld(), layer = water ? "w" : "l";
    if (s < RASTER_BELOW) this.drawRasters(s, v, true, layer);
    // metadata tiles (needed for hit-testing and, when zoomed in, for per-parcel rendering)
    if (s >= JSON_ABOVE) {
      const tx0 = Math.max(0, Math.floor(v.x0 / TILE)), tx1 = Math.min(W / TILE - 1, Math.floor(v.x1 / TILE));
      const ty0 = Math.max(0, Math.floor(v.y0 / TILE)), ty1 = Math.min(H / TILE - 1, Math.floor(v.y1 / TILE));
      const { ctx } = this;
      // The parcels of a tile can only be drawn one by one once the tile has arrived. Until then (a few hundred ms after a long
      // zoom) the pictures of the coarser rasters already in memory stand in for them, there only: parcels never blink out.
      const missing: [number, number][] = [];
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        this.ensureTile(tx, ty);
        if (s >= RASTER_BELOW && this.tiles.get(`${tx},${ty}`)?.state !== "ready") missing.push([tx, ty]);
      }
      if (missing.length) {
        ctx.save();
        ctx.beginPath();
        for (const [tx, ty] of missing) { const a = this.worldToScreen(tx * TILE, ty * TILE); ctx.rect(a.x, a.y, TILE * s + 0.5, TILE * s + 0.5); }
        ctx.clip();
        this.drawRasters(s, v, false, layer);
        ctx.restore();
      }
      const seen = new Set<string>();
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const tile = this.tiles.get(`${tx},${ty}`);
        if (!tile || tile.state !== "ready" || s < RASTER_BELOW) continue;
        for (const p of tile.parcels) {
          if (p.water !== water || seen.has(p.code) || p.x > v.x1 || p.y > v.y1 || p.x + p.w < v.x0 || p.y + p.h < v.y0) continue;
          seen.add(p.code);
          const a = this.worldToScreen(p.x, p.y);
          const sw = p.w * s, sh = p.h * s;
          const rx = Math.round(a.x), ry = Math.round(a.y), rw = Math.round(a.x + sw) - rx, rh = Math.round(a.y + sh) - ry;
          let drawn = false;
          if (p.assetId && sw >= 2) {
            // a creation can carry up to 10 × 10 dots per pixel: ask for the size this screen can show, not for all of it
            const size = assetSizeFor(Math.max(rw, rh) * this.dpr);
            let img = this.loadImage(this.images, `${p.assetId}@${size}`, assetUrl(p.assetId, Math.max(rw, rh) * this.dpr), 400);
            if (img.state !== "ready") { // meanwhile show a smaller variant already in memory, if any
              for (let i = ASSET_SIZES.indexOf(size) - 1; i >= 0; i--) {
                const e = this.images.get(`${p.assetId}@${ASSET_SIZES[i]}`);
                if (e?.state === "ready") { img = e; break; }
              }
            }
            if (img.state === "ready") {
              // crisp dots when the creation is shown at its own size or larger; a finer one drawn smaller is averaged
              ctx.imageSmoothingEnabled = img.el.naturalWidth > rw * this.dpr * 1.001;
              ctx.imageSmoothingQuality = "high";
              ctx.drawImage(img.el, rx, ry, rw, rh);
              drawn = true;
            }
          }
          if (!drawn) {
            ctx.fillStyle = water ? (p.color ?? WATER_FILL) : p.assetId && p.color ? p.color : (this.hatchPattern() ?? "#ddd");
            ctx.fillRect(rx, ry, rw, rh);
          }
        }
      }
    }
  }

  /** `request: false` draws only what is already in memory (the finer tile, else the coarsest picture standing in for it), asks for nothing. */
  private drawRasters(s: number, v: { x0: number; y0: number; x1: number; y1: number }, request = true, layer: "l" | "w" = "l") {
    const z = clamp(Math.floor(-Math.log2(s)), 0, MAX_Z);
    const span = rasterSpan(z);
    const { ctx } = this;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (let ty = Math.max(0, Math.floor(v.y0 / span)); ty <= Math.min(Math.floor(H / span), Math.floor(v.y1 / span)); ty++) {
      for (let tx = Math.max(0, Math.floor(v.x0 / span)); tx <= Math.min(Math.floor(W / span), Math.floor(v.x1 / span)); tx++) {
        const key = `${layer === "w" ? "w" : ""}${z}/${tx}/${ty}`;
        const img = request ? this.loadImage(this.rasters, key, `/api/map/raster/${z}/${tx}/${ty}?v=${this.version}${layer === "w" ? "&k=w" : ""}`, 300) : (this.rasters.get(key) ?? { el: new Image(), state: "loading" as const, used: 0 });
        const a = this.worldToScreen(tx * span, ty * span);
        const size = span * s;
        if (img.state === "ready") {
          ctx.drawImage(img.el, a.x, a.y, size + 0.5, size + 0.5);
          continue;
        }
        // not loaded yet: show the coarsest ancestor we already have
        for (let zz = z + 1; zz <= MAX_Z; zz++) {
          const sp = rasterSpan(zz);
          const ax = Math.floor((tx * span) / sp), ay = Math.floor((ty * span) / sp);
          const anc = this.rasters.get(`${layer === "w" ? "w" : ""}${zz}/${ax}/${ay}`);
          if (anc?.state === "ready") {
            const k = span / sp * RASTER_PX;
            ctx.drawImage(anc.el, ((tx * span) - ax * sp) / sp * RASTER_PX, ((ty * span) - ay * sp) / sp * RASTER_PX, k, k, a.x, a.y, size + 0.5, size + 0.5);
            break;
          }
        }
      }
    }
  }

  /** The 1-pixel grid, in the last stretch of the zoom only (see `gridAlpha`). */
  private drawGrid(s: number) {
    const alpha = gridAlpha(s);
    if (alpha <= 0.005) return;
    const { ctx, w, h } = this;
    const v = this.visibleWorld();
    ctx.strokeStyle = `rgba(${COLORS.ink},${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gx0 = Math.max(0, Math.floor(v.x0)), gx1 = Math.min(W, Math.ceil(v.x1));
    const gy0 = Math.max(0, Math.floor(v.y0)), gy1 = Math.min(H, Math.ceil(v.y1));
    const ya = this.worldToScreen(0, gy0).y, yb = this.worldToScreen(0, gy1).y;
    const xa = this.worldToScreen(gx0, 0).x, xb = this.worldToScreen(gx1, 0).x;
    for (let x = gx0; x <= gx1; x++) { const sx = Math.round(this.worldToScreen(x, 0).x) + 0.5; ctx.moveTo(sx, Math.max(0, ya)); ctx.lineTo(sx, Math.min(h, yb)); }
    for (let y = gy0; y <= gy1; y++) { const sy = Math.round(this.worldToScreen(0, y).y) + 0.5; ctx.moveTo(Math.max(0, xa), sy); ctx.lineTo(Math.min(w, xb), sy); }
    ctx.stroke();
  }

  private drawOverlays(s: number) {
    const { ctx } = this;
    const rectPath = (r: Rect) => {
      const a = this.worldToScreen(r.x, r.y);
      return { x: Math.round(a.x), y: Math.round(a.y), w: Math.max(1, Math.round(r.w * s)), h: Math.max(1, Math.round(r.h * s)) };
    };
    const hl = this.highlight ? this.findParcelByCode(this.highlight) : null;
    for (const [p, color, width] of [[hl, COLORS.accent, 3], [this.hovered, COLORS.ink, 2]] as const) {
      if (!p) continue;
      const r = rectPath(p);
      ctx.strokeStyle = `rgb(${color})`; ctx.lineWidth = width;
      ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      if (r.w < 22 && p === hl) this.marker(r.x + r.w / 2, r.y + r.h / 2, COLORS.accent);
    }
    const draw = (rect: Rect, state: SelectionState | null, ghost: boolean) => {
      const r = rectPath(rect);
      const bad = state === "blocked" || state === "out" || state === "water" || state === "land";
      const col = bad ? COLORS.danger : COLORS.free;
      if (!ghost && this.previewShown) {
        // the preview is cut along the coast too, so what you see is what will be shown: the land for land, the water for water
        const img = this.previewShown, cut = this.buyKind === "water" ? this.onWater : this.onLand;
        cut.call(this, s, () => {
          ctx.imageSmoothingEnabled = ((img as ImageBitmap).width ?? 0) > r.w * 1.001;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, r.x, r.y, r.w, r.h);
        }, true);
      } else {
        ctx.fillStyle = `rgba(${col},${ghost ? 0.22 : 0.35})`;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      ctx.strokeStyle = `rgb(${col})`;
      ctx.lineWidth = ghost ? 1.5 : 2.5;
      ctx.setLineDash(ghost ? [5, 4] : []);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.setLineDash([]);
      if (r.w < 28 || r.h < 28) this.marker(r.x + r.w / 2, r.y + r.h / 2, col, !ghost);
    };
    if (this.ghost && !this.selection) {
      // the dashed ghost already turns red over the sea (cached per position and per data version)
      const g = this.ghost, key = `${g.x},${g.y},${g.w},${g.h}`, ver = this.geo?.version ?? -1;
      if (this.ghostWater?.key !== key || this.ghostWater.ver !== ver) {
        const l = this.geo?.landIn(g);
        this.ghostWater = { key, ver, water: Boolean(l && !l.pending && !this.enoughOfKind(l.land, g.w * g.h)) };
      }
      draw(g, this.ghostWater.water ? (this.buyKind === "water" ? "land" : "water") : null, true);
    }
    if (this.selection) draw(this.selection, this.selectionState, false);
  }

  private marker(cx: number, cy: number, rgb: string, animated = true) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 24, cy); ctx.lineTo(cx - 9, cy); ctx.moveTo(cx + 9, cy); ctx.lineTo(cx + 24, cy); ctx.moveTo(cx, cy - 24); ctx.lineTo(cx, cy - 9); ctx.moveTo(cx, cy + 9); ctx.lineTo(cx, cy + 24); ctx.stroke();
    if (animated) {
      ctx.strokeStyle = `rgba(${rgb},${1 - this.pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 15 + this.pulse * 26, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private findParcelByCode(code: string): MapParcel | null {
    for (const t of this.tiles.values()) for (const p of t.parcels) if (p.code === code) return p;
    return null;
  }
}
