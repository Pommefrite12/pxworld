import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { loadGeo, type Geo } from "@/components/map/geo";

const OCEAN = "#c9dfe8";
const LAND = "#fbf5e6";
const INK = "23,21,31";
export const TEXTURE_WIDTH = 4096;

/** Draws the flat world (same data as the flat map, 1:50m level) into a canvas, one pixel of texture per 10 grid pixels. */
function draw(geo: Geo, width: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round((width * GRID_HEIGHT) / GRID_WIDTH);
  const g = c.getContext("2d")!;
  const k = width / GRID_WIDTH;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = OCEAN;
  g.fillRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
  const paths = geo.tilePaths("50", { x0: 0, y0: 0, x1: GRID_WIDTH, y1: GRID_HEIGHT }, false);
  g.fillStyle = LAND;
  g.fill(paths.fill, "evenodd");
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = `rgba(${INK},0.28)`;
  g.lineWidth = 1.1 / k;
  g.stroke(paths.borders);
  g.strokeStyle = `rgba(${INK},0.6)`;
  g.lineWidth = 1.5 / k;
  g.stroke(paths.coast);
  return c;
}

const cache = new Map<number, Promise<HTMLCanvasElement>>();

/**
 * The world texture of the globe, built once per page session and kept: the flat map builds it while idle, so the
 * globe has its land on the very first frame instead of showing a blank sea for a few hundred milliseconds.
 */
export function worldTexture(width: number): Promise<HTMLCanvasElement> {
  let p = cache.get(width);
  if (!p) {
    p = loadGeo().then((geo) => draw(geo, width));
    cache.set(width, p);
  }
  return p;
}

/** Called from the flat map once it is idle: only on screens big enough to have the memory to spare (≈ 45 MB). */
export function prebuildWorldTexture() {
  if (typeof window === "undefined" || Math.min(window.innerWidth, window.innerHeight) < 600) return;
  const run = () => void worldTexture(TEXTURE_WIDTH);
  if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
