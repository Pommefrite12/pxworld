import { GRID_HEIGHT as H, GRID_WIDTH as W } from "@/lib/grid/constants";
import { centeredRect, clampToGrid, intersects, pixelToLonLat, type Rect } from "@/lib/grid/geometry";
import { shouldReturnToGlobe } from "@/lib/globe/orthographic";
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
export interface MapParcel { code: string; x: number; y: number; w: number; h: number; assetId: string | null; color: string | null }
export type SelectionState = "ok" | "blocked" | "checking" | "out";
export type Mode = "explore" | "buy";

export interface EngineCallbacks {
  onCamera?: (c: Camera) => void;
  onHover?: (p: MapParcel | null) => void;
  onSelectParcel?: (p: MapParcel | null, screen: { x: number; y: number }) => void;
  onCursor?: (wx: number, wy: number) => void;
  onPlace?: (r: Rect) => void;
  onSelectionState?: (s: SelectionState) => void;
  /** The user zoomed out far enough that the planet is better shown as a globe (explore mode only). */
  onZoomOutToGlobe?: (c: Camera) => void;
}

type TileParcel = [string, number, number, number, number, string | null, string | null];
interface Tile { state: "loading" | "ready" | "error"; parcels: MapParcel[] }
interface Img { el: HTMLImageElement; state: "loading" | "ready" | "error"; used: number }

const TILE = 1000;
const GEO_TILE_PX = 512;
const GEO_CACHE_MAX = 48;
const RASTER_PX = 256;
const MAX_Z = 8;
const MAX_SCALE = 48;
const RASTER_BELOW = 1; // below this zoom the server-composited rasters are shown; above it, parcels are drawn individually
const JSON_ABOVE = 0.1; // below this zoom parcels are sub-2px: no metadata needed

const COLORS = {
  paper: "#fbf8f2",
  ocean: "#c9dfe8",
  land: "#fbf5e6",
  ink: "23,21,31",
  free: "18,184,134",
  accent: "232,64,31",
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
  private globeFired = false;
  private destroyed = false;

  private geo: Geo | null = null;
  private places: Places | null = null;
  private tiles = new Map<string, Tile>();
  private tileQueue: string[] = [];
  private inflight = 0;
  private rasters = new Map<string, Img>();
  private images = new Map<string, Img>();
  private hatch: CanvasPattern | null = null;

  private previewImage: CanvasImageSource | null = null;
  private selection: Rect | null = null;
  private selectionState: SelectionState | null = null;
  private brush: { w: number; h: number } | null = null;
  private ghost: Rect | null = null;
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
    void loadGeo().then((g) => { this.geo = g; g.onUpdate = () => this.invalidate(); this.invalidate(); });
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
  setPreviewImage(img: CanvasImageSource | null) { this.previewImage = img; this.invalidate(); }

  setSelection(r: Rect | null) {
    this.selection = r;
    this.updateSelectionState();
    this.invalidate();
  }

  /** The map changed (purchase, moderation): drop every cache that depends on it. */
  setVersion(v: number) {
    if (v === this.version) return;
    this.version = v;
    this.tiles.clear(); this.tileQueue = []; this.rasters.clear();
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

  /** A zoom-out gesture reached the point where the globe takes over: tell the page (once). */
  private checkGlobe(requestedScale: number, prevScale: number) {
    if (this.globeFired || this.mode !== "explore" || !this.cb.onZoomOutToGlobe) return;
    const latDeg = pixelToLonLat(this.cam.x, this.cam.y).lat;
    if (!shouldReturnToGlobe({ prevScale, requestedScale, minScale: this.minScale, latDeg, viewW: this.w, viewH: this.h })) return;
    this.globeFired = true;
    setTimeout(() => { this.globeFired = false; }, 2500); // if the page did not navigate, allow another try
    this.cb.onZoomOutToGlobe({ ...this.cam, scale: Math.max(requestedScale, this.minScale) });
  }

  zoomBy(factor: number, ax = this.w / 2, ay = this.h / 2, animate = true) {
    this.checkGlobe(this.cam.scale * factor, this.cam.scale);
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
  parcelsIn(r: Rect): MapParcel[] | null {
    const out: MapParcel[] = [];
    for (let ty = Math.floor(r.y / TILE); ty <= Math.floor((r.y + r.h - 1) / TILE); ty++) {
      for (let tx = Math.floor(r.x / TILE); tx <= Math.floor((r.x + r.w - 1) / TILE); tx++) {
        const tile = this.tiles.get(`${tx},${ty}`);
        if (!tile || tile.state !== "ready") { this.ensureTile(tx, ty); return null; }
        for (const p of tile.parcels) if (intersects(r, p)) out.push(p);
      }
    }
    return out;
  }

  destroy() {
    this.destroyed = true;
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
    if (this.tiles.has(key)) return;
    this.tiles.set(key, { state: "loading", parcels: [] });
    this.tileQueue.push(key);
    this.pumpTiles();
  }

  private pumpTiles() {
    while (this.inflight < 6 && this.tileQueue.length) {
      const key = this.tileQueue.shift()!;
      const [tx, ty] = key.split(",").map(Number) as [number, number];
      const version = this.version;
      this.inflight++;
      fetch(`/api/map/tiles/${tx}/${ty}?v=${version}`)
        .then((r) => (r.ok ? (r.json() as Promise<TileParcel[]>) : Promise.reject(new Error(String(r.status)))))
        .then((rows) => {
          if (version !== this.version) return;
          this.tiles.set(key, { state: "ready", parcels: rows.map(([code, x, y, w, h, assetId, color]) => ({ code, x, y, w, h, assetId, color })) });
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

  /* ------------------------------------------------------------------ selection */

  private updateSelectionState() {
    let s: SelectionState | null = null;
    const r = this.selection;
    if (r) {
      if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) s = "out";
      else {
        const hits = this.parcelsIn(r);
        s = hits === null ? "checking" : hits.length ? "blocked" : "ok";
      }
    }
    if (s !== this.selectionState) { this.selectionState = s; if (s) this.cb.onSelectionState?.(s); }
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
        this.checkGlobe(this.pinch.scale * (dist / this.pinch.dist), this.cam.scale);
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
      this.checkGlobe(this.cam.scale * factor, this.cam.scale);
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

  private parcelAt(wx: number, wy: number): MapParcel | null {
    const tile = this.tiles.get(`${Math.floor(wx / TILE)},${Math.floor(wy / TILE)}`);
    if (!tile || tile.state !== "ready") return null;
    for (const p of tile.parcels) if (wx >= p.x && wx < p.x + p.w && wy >= p.y && wy < p.y + p.h) return p;
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
    if (again) this.raf = requestAnimationFrame((n) => this.frame(n));
  }

  /* ------------------------------------------------------------------ drawing */

  private draw() {
    const { ctx, w, h, dpr, cam } = this;
    const s = cam.scale;
    this.geo?.tick(this.frameNo);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);

    // the world is a horizontal band: it never ends on the left or right, only at the top and bottom
    const y0 = (0 - cam.y) * s + h / 2, hh = H * s;
    ctx.fillStyle = `rgba(${COLORS.ink},0.07)`;
    ctx.fillRect(0, y0 + 6, w, hh);
    ctx.fillStyle = COLORS.ocean;
    ctx.fillRect(0, y0, w, hh);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y0, w, hh);
    ctx.clip();
    this.geoPending = false;
    const halfW = w / 2 / s;
    for (let c = Math.floor((cam.x - halfW) / W); c <= Math.floor((cam.x + halfW) / W); c++) {
      this.offX = c * W; // draw the world copy that covers this stretch of the screen
      const x0 = (this.offX - cam.x) * s + w / 2, ww = W * s;
      this.drawGeography(s);
      this.drawDots(s, x0, y0, ww, hh);
      if (this.mode === "buy") { ctx.fillStyle = `rgba(${COLORS.free},0.13)`; ctx.fillRect(x0, y0, ww, hh); }
      // zoomed in, place names sit UNDER the parcels (owners cover the map); zoomed out, parcels are specks and names stay readable on top
      if (s >= RASTER_BELOW) this.drawLabels(s);
      this.drawParcels(s);
      if (s < RASTER_BELOW) this.drawLabels(s);
      this.drawGrid(s);
      this.drawOverlays(s);
    }
    this.offX = 0;
    ctx.restore();

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
  private geoTiles = new Map<string, { c: HTMLCanvasElement; used: number; complete: boolean; ver: number }>();
  private geoPending = false;

  /** Level of detail for a render level k (2^k device pixels per grid pixel). */
  private lodFor(k: number): Lod { return k <= -2 ? "110" : k === -1 ? "50" : "10"; }

  private renderGeoTile(k: number, tx: number, ty: number): { c: HTMLCanvasElement; complete: boolean } | null {
    if (!this.geo) return null;
    const c = document.createElement("canvas");
    c.width = c.height = GEO_TILE_PX;
    const g = c.getContext("2d");
    if (!g) return null;
    const scale = 2 ** k, size = GEO_TILE_PX / scale;
    const rect = { x0: tx * size, y0: ty * size, x1: (tx + 1) * size, y1: (ty + 1) * size };
    const admin = k >= -3; // départements / states / provinces appear once a country spans a few hundred screen pixels
    const communes = k >= 2; // commune borders (France) appear once a commune is a few dozen screen pixels wide
    let lod = this.lodFor(k);
    let paths = this.geo.tilePaths(lod, rect, admin, communes);
    // the 1:10m cells this tile needs are still downloading: draw the 1:50m level meanwhile, redrawn when they arrive
    if (!paths.complete && lod === "10") { lod = "50"; paths = this.geo.tilePaths(lod, rect, admin, communes); }
    const complete = paths.complete && !paths.extraPending;
    const dprBoost = this.dpr > 1.5 ? 1.15 : 1;
    g.setTransform(scale, 0, 0, scale, -tx * GEO_TILE_PX, -ty * GEO_TILE_PX);
    g.lineJoin = "round";
    g.lineCap = "round"; // clipped outlines are separate pieces: round caps close the joints between them
    g.fillStyle = COLORS.land;
    g.fill(paths.fill, "evenodd");
    if (communes) {
      g.strokeStyle = `rgba(${COLORS.ink},${k >= 4 ? 0.42 : k >= 3 ? 0.34 : 0.24})`;
      g.lineWidth = (k >= 3 ? 1.05 : 0.85) * dprBoost / scale;
      g.setLineDash([1.6 / scale, 2.4 / scale]);
      g.stroke(paths.communes);
      g.setLineDash([]);
    }
    if (admin) {
      g.strokeStyle = `rgba(${COLORS.ink},${k >= 2 ? 0.34 : k >= 0 ? 0.28 : 0.18})`;
      g.lineWidth = (k >= 1 ? 1.1 : 0.9) * dprBoost / scale;
      g.setLineDash([2.2 / scale, 3.2 / scale]);
      g.stroke(paths.admin);
      g.setLineDash([]);
    }
    if (k >= -4) {
      const strong = k >= 0;
      g.strokeStyle = `rgba(${COLORS.ink},${strong ? 0.42 : clamp(0.1 + (k + 4) * 0.025, 0.1, 0.22)})`;
      g.lineWidth = (strong ? 1.5 : 1.8) * dprBoost / scale;
      g.setLineDash(strong ? [9 / scale, 3 / scale, 2 / scale, 3 / scale] : [6 / scale, 5 / scale]);
      g.stroke(paths.borders);
      g.setLineDash([]);
    }
    g.strokeStyle = `rgba(${COLORS.ink},0.62)`;
    g.lineWidth = (clamp(1.6 + k * 0.12, 1.4, 2.6) * dprBoost) / scale;
    g.stroke(paths.coast);
    return { c, complete };
  }

  private drawGeography(s: number) {
    if (!this.geo) return;
    const { ctx } = this;
    const k = Math.ceil(Math.log2(s * this.dpr));
    const size = GEO_TILE_PX / 2 ** k; // grid pixels covered by one tile edge
    const v = this.visibleWorld();
    const tx0 = Math.max(0, Math.floor(v.x0 / size)), tx1 = Math.min(Math.floor(W / size), Math.floor(v.x1 / size));
    const ty0 = Math.max(0, Math.floor(v.y0 / size)), ty1 = Math.min(Math.floor(H / size), Math.floor(v.y1 / size));
    let budget = 4;
    ctx.imageSmoothingEnabled = true;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = `${k}/${tx}/${ty}`;
      let tile = this.geoTiles.get(key);
      // a tile drawn from a coarser level while data was missing is redrawn once new data has arrived
      const stale = tile && !tile.complete && tile.ver !== this.geo.version;
      if ((!tile || stale) && budget > 0) {
        const r = this.renderGeoTile(k, tx, ty);
        if (r) { tile = { c: r.c, used: 0, complete: r.complete, ver: this.geo.version }; this.geoTiles.set(key, tile); budget--; }
      }
      const a = this.worldToScreen(tx * size, ty * size);
      const px = size * s;
      if (tile) { tile.used = this.frameNo; ctx.drawImage(tile.c, a.x, a.y, px + 0.6, px + 0.6); if (!tile.complete && tile.ver !== this.geo.version) this.geoPending = true; continue; }
      this.geoPending = true;
      // not rendered yet: reuse a coarser level we already have rather than showing a hole
      for (let kk = k - 1; kk >= k - 6; kk--) {
        const sz = GEO_TILE_PX / 2 ** kk, ax = Math.floor((tx * size) / sz), ay = Math.floor((ty * size) / sz);
        const anc = this.geoTiles.get(`${kk}/${ax}/${ay}`);
        if (!anc) continue;
        const f = size / sz * GEO_TILE_PX;
        ctx.drawImage(anc.c, ((tx * size) - ax * sz) / sz * GEO_TILE_PX, ((ty * size) - ay * sz) / sz * GEO_TILE_PX, f, f, a.x, a.y, px + 0.6, px + 0.6);
        break;
      }
    }
    // never evict what is on screen: the cache must at least hold the visible tiles
    const cacheMax = Math.max(GEO_CACHE_MAX, (tx1 - tx0 + 1) * (ty1 - ty0 + 1) + 16);
    if (this.geoTiles.size > cacheMax) {
      const old = [...this.geoTiles.entries()].sort((x, y) => x[1].used - y[1].used).slice(0, this.geoTiles.size - cacheMax + 8);
      for (const [key] of old) this.geoTiles.delete(key);
    }
  }

  /** The "pixel field": a dot matrix over the whole planet at far zoom, which melts into the pixel grid as you zoom in. */
  private drawDots(s: number, x0: number, y0: number, ww: number, hh: number) {
    const alpha = clamp((1.2 - s) / 1.0, 0, 1) * 0.5;
    if (alpha <= 0.01) return;
    const { ctx, w, h } = this;
    let step = 250;
    while (step * s < 13) step *= 2;
    const px = step * s;
    const ox = x0 % px, oy = y0 % px;
    ctx.fillStyle = `rgba(${COLORS.ink},${alpha * 0.2})`;
    const r = clamp(px * 0.07, 0.8, 2);
    for (let y = oy; y < h; y += px) for (let x = ox; x < w; x += px) ctx.fillRect(x - r / 2, y - r / 2, r, r);
    void ww; void hh;
  }

  /**
   * Place names, most important first so they win collisions: countries → big cities → départements/states →
   * mid-size cities → towns. Each layer has its own zoom range; the smaller layers load their data on demand.
   */
  private drawLabels(s: number) {
    if (!this.places || !this.geo || s < 0.025) return;
    const { ctx, w, h } = this;
    const v = this.visibleWorld();
    const lang = document.documentElement.lang === "fr" ? "fr" : "en";
    const FONT = `"Instrument Sans Variable", system-ui, sans-serif`;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const label = (text: string, x: number, y: number, a: number, align: CanvasTextAlign = "center", ink = 0.55) => {
      const tw = ctx.measureText(text).width, th = 13;
      const x0 = align === "left" ? x : x - tw / 2;
      const box = { x0: x0 - 3, y0: y - th / 2 - 2, x1: x0 + tw + 3, y1: y + th / 2 + 2 };
      if (placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) return false; // collision: skip
      placed.push(box);
      ctx.textAlign = align;
      ctx.strokeStyle = `rgba(251,245,230,${0.85 * a})`;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = `rgba(${COLORS.ink},${ink * a})`;
      ctx.fillText(text, x, y);
      return true;
    };
    const onScreen = (p: { x: number; y: number }, m: number) => p.x > -m && p.y > -m && p.x < w + m && p.y < h + m;
    const dot = (p: { x: number; y: number }, size: number, a: number) => {
      ctx.fillStyle = `rgba(${COLORS.ink},${0.7 * a})`;
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

  private drawParcels(s: number) {
    const v = this.visibleWorld();
    if (s < RASTER_BELOW) this.drawRasters(s, v);
    // metadata tiles (needed for hit-testing and, when zoomed in, for per-parcel rendering)
    if (s >= JSON_ABOVE) {
      const tx0 = Math.max(0, Math.floor(v.x0 / TILE)), tx1 = Math.min(W / TILE - 1, Math.floor(v.x1 / TILE));
      const ty0 = Math.max(0, Math.floor(v.y0 / TILE)), ty1 = Math.min(H / TILE - 1, Math.floor(v.y1 / TILE));
      const { ctx } = this;
      const seen = new Set<string>();
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        this.ensureTile(tx, ty);
        const tile = this.tiles.get(`${tx},${ty}`);
        if (!tile || tile.state !== "ready" || s < RASTER_BELOW) continue;
        for (const p of tile.parcels) {
          if (seen.has(p.code) || p.x > v.x1 || p.y > v.y1 || p.x + p.w < v.x0 || p.y + p.h < v.y0) continue;
          seen.add(p.code);
          const a = this.worldToScreen(p.x, p.y);
          const sw = p.w * s, sh = p.h * s;
          const rx = Math.round(a.x), ry = Math.round(a.y), rw = Math.round(a.x + sw) - rx, rh = Math.round(a.y + sh) - ry;
          let drawn = false;
          if (p.assetId && sw >= 2) {
            const img = this.loadImage(this.images, p.assetId, `/api/assets/${p.assetId}`, 400);
            if (img.state === "ready") {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img.el, rx, ry, rw, rh);
              drawn = true;
            }
          }
          if (!drawn) {
            ctx.fillStyle = p.assetId && p.color ? p.color : (this.hatchPattern() ?? "#ddd");
            ctx.fillRect(rx, ry, rw, rh);
          }
        }
      }
    }
  }

  private drawRasters(s: number, v: { x0: number; y0: number; x1: number; y1: number }) {
    const z = clamp(Math.floor(-Math.log2(s)), 0, MAX_Z);
    const span = rasterSpan(z);
    const { ctx } = this;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (let ty = Math.max(0, Math.floor(v.y0 / span)); ty <= Math.min(Math.floor(H / span), Math.floor(v.y1 / span)); ty++) {
      for (let tx = Math.max(0, Math.floor(v.x0 / span)); tx <= Math.min(Math.floor(W / span), Math.floor(v.x1 / span)); tx++) {
        const img = this.loadImage(this.rasters, `${z}/${tx}/${ty}`, `/api/map/raster/${z}/${tx}/${ty}?v=${this.version}`, 300);
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
          const anc = this.rasters.get(`${zz}/${ax}/${ay}`);
          if (anc?.state === "ready") {
            const k = span / sp * RASTER_PX;
            ctx.drawImage(anc.el, ((tx * span) - ax * sp) / sp * RASTER_PX, ((ty * span) - ay * sp) / sp * RASTER_PX, k, k, a.x, a.y, size + 0.5, size + 0.5);
            break;
          }
        }
      }
    }
  }

  private drawGrid(s: number) {
    const { ctx, w, h } = this;
    const v = this.visibleWorld();
    const line = (step: number, alpha: number) => {
      if (alpha <= 0.005) return;
      ctx.strokeStyle = `rgba(${COLORS.ink},${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const gx0 = Math.max(0, Math.floor(v.x0 / step) * step), gx1 = Math.min(W, Math.ceil(v.x1 / step) * step);
      const gy0 = Math.max(0, Math.floor(v.y0 / step) * step), gy1 = Math.min(H, Math.ceil(v.y1 / step) * step);
      const ya = this.worldToScreen(0, gy0).y, yb = this.worldToScreen(0, gy1).y;
      const xa = this.worldToScreen(gx0, 0).x, xb = this.worldToScreen(gx1, 0).x;
      for (let x = gx0; x <= gx1; x += step) { const sx = Math.round(this.worldToScreen(x, 0).x) + 0.5; ctx.moveTo(sx, Math.max(0, ya)); ctx.lineTo(sx, Math.min(h, yb)); }
      for (let y = gy0; y <= gy1; y += step) { const sy = Math.round(this.worldToScreen(0, y).y) + 0.5; ctx.moveTo(Math.max(0, xa), sy); ctx.lineTo(Math.min(w, xb), sy); }
      ctx.stroke();
    };
    // gradual: 1px grid fades in from 3× to 10×; 10 px grid from 0.8× ; 100 px grid from 0.12×
    line(1, clamp((s - 3) / 7, 0, 1) * 0.2);
    line(10, clamp((s - 0.8) / 2.2, 0, 1) * (s > 10 ? 0.28 : 0.14));
    line(100, clamp((s - 0.12) / 0.5, 0, 1) * 0.12);
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
      const bad = state === "blocked" || state === "out";
      const col = bad ? COLORS.danger : COLORS.free;
      if (!ghost && this.previewImage) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.previewImage, r.x, r.y, r.w, r.h);
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
    if (this.ghost && !this.selection) draw(this.ghost, null, true);
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
