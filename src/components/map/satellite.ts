/**
 * Satellite imagery for the background of the map: NASA "Blue Marble" (shaded relief + bathymetry), served as standard
 * Web-Mercator tiles by NASA's Global Imagery Browse Services (GIBS). NASA imagery is public domain; GIBS needs no key.
 * The browser fetches the tiles straight from NASA, only where the camera looks, and only while the layer is switched on.
 */
export const SATELLITE_MAX_Z = 8; // the Blue Marble layer is published down to level 8 (≈ 500 m per pixel)
export const SATELLITE_ALPHA = 0.2;
const MAX_CACHED = 220;
const MAX_PARALLEL = 8;
const RETRY_AFTER_MS = 30_000;

export const satelliteUrl = (z: number, x: number, y: number) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`;

interface Entry { img: HTMLImageElement; state: "loading" | "ready" | "error"; used: number; failedAt: number }

export class SatelliteTiles {
  onLoad: (() => void) | null = null;
  private cache = new Map<string, Entry>();
  private queue: string[] = [];
  private active = 0;
  private urlOf: (z: number, x: number, y: number) => string;

  constructor(urlOf: (z: number, x: number, y: number) => string = satelliteUrl) { this.urlOf = urlOf; }

  /** The decoded tile if it is there, otherwise null (and it starts loading). */
  get(z: number, x: number, y: number, frame: number): HTMLImageElement | null {
    const key = `${z}/${x}/${y}`;
    let e = this.cache.get(key);
    if (e && e.state === "error" && Date.now() - e.failedAt > RETRY_AFTER_MS) { this.cache.delete(key); e = undefined; }
    if (!e) {
      e = { img: new Image(), state: "loading", used: frame, failedAt: 0 };
      this.cache.set(key, e);
      this.queue.push(key); // newest first (see pump): the tiles the camera needs now matter most
      this.pump();
    }
    e.used = frame;
    return e.state === "ready" ? e.img : null;
  }

  /** A tile that is already loaded, without triggering any request (used to stand in for a missing finer tile). */
  peek(z: number, x: number, y: number, frame: number): HTMLImageElement | null {
    const e = this.cache.get(`${z}/${x}/${y}`);
    if (!e || e.state !== "ready") return null;
    e.used = frame;
    return e.img;
  }

  private pump() {
    while (this.active < MAX_PARALLEL && this.queue.length) {
      const key = this.queue.pop()!;
      const e = this.cache.get(key);
      if (!e || e.state !== "loading") continue;
      const [z, x, y] = key.split("/").map(Number) as [number, number, number];
      this.active++;
      const done = (ok: boolean) => {
        this.active--;
        e.state = ok ? "ready" : "error";
        if (!ok) e.failedAt = Date.now();
        else this.onLoad?.();
        this.pump();
      };
      e.img.onload = () => done(true);
      e.img.onerror = () => done(false);
      e.img.decoding = "async";
      e.img.src = this.urlOf(z, x, y);
    }
  }

  /** Drops the least recently used tiles (never the ones used in the current frame). */
  evict(frame: number) {
    if (this.cache.size <= MAX_CACHED) return;
    const old = [...this.cache.entries()].filter(([, e]) => e.state !== "loading" && e.used < frame).sort((a, b) => a[1].used - b[1].used);
    for (const [key] of old.slice(0, this.cache.size - MAX_CACHED + 20)) this.cache.delete(key);
  }
}
