import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { cellWindows, decodeDelta, landPixelsInWindow, type CellRect } from "./landmask";

/**
 * The authority on "is this rectangle entirely on land?" for purchases. It reads the very same data files the map draws
 * (public/data/geo, Natural Earth 1:10m land cut into 2 500-px cells), so what the buyer sees and what the server
 * accepts can never disagree. Decoded cells are kept in memory (least recently used first out).
 */
const DIR = path.join(process.cwd(), "public/data/geo");
const MAX_CELLS = 24;

interface Index { cell: number; q: number; g: string[] }

let indexPromise: Promise<{ cell: number; q: number; cells: Set<string> }> | undefined;
const rings = new Map<string, Promise<Float64Array[]>>();

function loadIndex() {
  return (indexPromise ??= fs.readFile(path.join(DIR, "index.json"), "utf8").then((txt) => {
    const idx = JSON.parse(txt) as Index;
    return { cell: idx.cell, q: idx.q, cells: new Set(idx.g) };
  }));
}

function loadCell(cx: number, cy: number, q: number): Promise<Float64Array[]> {
  const key = `${cx}-${cy}`;
  let p = rings.get(key);
  if (p) { rings.delete(key); rings.set(key, p); return p; } // refresh recency
  p = fs.readFile(path.join(DIR, `g-${key}.json`), "utf8").then((txt) => ((JSON.parse(txt) as { land?: number[][] }).land ?? []).map((r) => decodeDelta(r, q)));
  p.catch(() => rings.delete(key)); // a failed read is retried next time
  rings.set(key, p);
  while (rings.size > MAX_CELLS) rings.delete(rings.keys().next().value as string);
  return p;
}

/** How many pixels of the rectangle are land. */
export async function landPixelsIn(rect: CellRect): Promise<number> {
  const { cell, q, cells } = await loadIndex();
  let land = 0;
  for (const w of cellWindows(rect, cell)) {
    if (!cells.has(`${w.cx}-${w.cy}`)) continue; // open sea: no data file for this cell
    land += landPixelsInWindow(await loadCell(w.cx, w.cy, q), w.x, w.y, w.w, w.h);
  }
  return land;
}

/** True when EVERY pixel of the rectangle is land. */
export async function isRectOnLand(rect: CellRect): Promise<boolean> {
  return (await landPixelsIn(rect)) === rect.w * rect.h;
}
