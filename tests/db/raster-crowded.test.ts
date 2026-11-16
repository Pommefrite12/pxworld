import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, databaseUrl, pool, resetData } from "./helpers";
import type { DemoPorts, Rect } from "@/lib/demo/seed";
import { landPixelsIn } from "@/lib/geo/landServer";

/**
 * A crowded world: thousands of parcels, a few of them on every tile. The tiles of the zoomed-out levels used to make one small image per parcel
 * (seconds for a crowded tile); a parcel that is only a colour is now painted straight into the tile's pixels.
 */
let renderRasterTile: typeof import("@/lib/map/raster").renderRasterTile;
let rasterSpan: typeof import("@/lib/map/raster").rasterSpan;
let seedVolume: typeof import("@/lib/demo/volume").seedVolume;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-crowded-"));

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.LOCAL_STORAGE_DIR = dir;
  delete (globalThis as { __pxPool?: unknown }).__pxPool;
  ({ renderRasterTile, rasterSpan } = await import("@/lib/map/raster"));
  ({ seedVolume } = await import("@/lib/demo/volume"));
});
afterAll(async () => {
  await (globalThis as unknown as { __pxPool?: { end(): Promise<void> } }).__pxPool?.end();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => { await resetData(); await pool.query("delete from auth.users where email like '%@demo.invalid'"); });

const ports = (): DemoPorts => ({
  query: async (sql, params) => (await pool.query(sql, params)).rows,
  async createUser(email, username) { return (await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('username', $2::text)) returning id", [email, username])).rows[0].id as string; },
  deleteUser: async (id) => { await pool.query("delete from auth.users where id = $1", [id]); },
  putObject: async (key, bytes) => { const f = path.join(dir, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); },
  removeObject: async (key) => { fs.rmSync(path.join(dir, key), { force: true }); },
  landPixels: async (r: Rect) => landPixelsIn(r),
  log: () => undefined,
});

describe("the raster tiles of a crowded world", () => {
  it("a crowded zoomed-out tile draws every parcel and comes quickly", async () => {
    await seedVolume(ports(), { count: 3000, owners: 4, emailDomain: "demo.invalid", seed: 11 });
    const rows = (await pool.query("select x, y, w, h, kind from public.parcels where status = 'active'")).rows as { x: number; y: number; w: number; h: number }[];
    const z = 5, span = rasterSpan(z);
    // the densest tile of that level
    const per = new Map<string, number>();
    for (const r of rows) { const k = `${Math.floor(r.x / span)},${Math.floor(r.y / span)}`; per.set(k, (per.get(k) ?? 0) + 1); }
    const [key, n] = [...per.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const [tx, ty] = key.split(",").map(Number) as [number, number];
    expect(n, "a crowded tile").toBeGreaterThan(300);

    const t0 = Date.now();
    const png = await renderRasterTile(z, tx, ty);
    expect(Date.now() - t0, `${n} parcels on one tile`).toBeLessThan(2500); // it took 4 to 7 seconds when every parcel was an image
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([256, 256]);
    // every parcel of the tile is on it: its first pixel is opaque
    let drawn = 0, total = 0;
    for (const r of rows) {
      if (Math.floor(r.x / span) !== tx || Math.floor(r.y / span) !== ty) continue;
      total++;
      const left = Math.round((r.x - tx * span) / 2 ** z), top = Math.round((r.y - ty * span) / 2 ** z);
      if (data[(Math.min(255, top) * 256 + Math.min(255, left)) * 4 + 3] === 255) drawn++;
    }
    expect(total).toBe(n);
    expect(drawn / total, "every parcel is painted").toBeGreaterThanOrEqual(0.99);
  });
});
