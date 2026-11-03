import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, databaseUrl, fulfill, pool, resetData, startOrder } from "./helpers";

let renderRasterTile: typeof import("@/lib/map/raster").renderRasterTile;
let getTile: typeof import("@/lib/data/map").getTile;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-raster-"));

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.LOCAL_STORAGE_DIR = dir;
  delete (globalThis as { __pxPool?: unknown }).__pxPool;
  ({ renderRasterTile } = await import("@/lib/map/raster"));
  ({ getTile } = await import("@/lib/data/map"));
});
afterAll(async () => {
  await (globalThis as unknown as { __pxPool?: { end(): Promise<void> } }).__pxPool?.end();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(resetData);

/** A published parcel whose creation is a known pattern: left half red, right half blue. */
async function publishedParcel(rect: { x: number; y: number; w: number; h: number }, pattern = true, water = false) {
  const u = await createUser();
  const o = water ? await startOrder(u, rect, 0, "water") : await startOrder(u, rect);
  await fulfill(o.order_id);
  const half = Buffer.alloc(rect.w * rect.h * 4);
  for (let i = 0; i < rect.w * rect.h; i++) {
    const x = i % rect.w;
    half.set(x < rect.w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  }
  const png = await sharp(half, { raw: { width: rect.w, height: rect.h, channels: 4 } }).png().toBuffer();
  const key = `creations/${o.parcel_id}/test.png`;
  fs.mkdirSync(path.dirname(path.join(dir, key)), { recursive: true });
  if (pattern) fs.writeFileSync(path.join(dir, key), png);
  const { rows } = await pool.query(`select * from public.px_add_asset($1, $2, $3, repeat('a',64), $4, $5, $6, '#800080', 'T', null, null, false)`, [u, o.parcel_id, key, rect.w, rect.h, png.length]);
  const mod = await createUser("mod", { role: "moderator" });
  await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [mod, rows[0].id]);
  return { ...o, asset: rows[0].id as string };
}

const pixel = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [...data.subarray(i, i + 4)];
};

describe("metadata tiles", () => {
  it("returns only the parcels of that 1000×1000 region, with their published asset", async () => {
    const p = await publishedParcel({ x: 1100, y: 2200, w: 20, h: 20 });
    await publishedParcel({ x: 5000, y: 5000, w: 10, h: 10 });
    const tile = await getTile(1, 2);
    expect(tile).toHaveLength(1);
    expect(tile[0]!.slice(0, 5)).toEqual([expect.stringMatching(/^[0-9a-f]{10}$/), 1100, 2200, 20, 20]);
    expect(tile[0]![5]).toBe(p.asset);
    expect(await getTile(0, 0)).toEqual([]);
  });
  it("a parcel spanning two tiles appears in both; a hidden one exposes no asset", async () => {
    const p = await publishedParcel({ x: 990, y: 10, w: 20, h: 20 });
    expect(await getTile(0, 0)).toHaveLength(1);
    expect(await getTile(1, 0)).toHaveLength(1);
    const admin = await createUser("adm", { role: "admin" });
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'x')`, [admin, p.parcel_id]);
    expect((await getTile(0, 0))[0]![5]).toBeNull();
  });
});

describe("water parcels", () => {
  it("are a layer of their own in the raster tiles, in three blues whatever the creation is", async () => {
    const land = await publishedParcel({ x: 256 + 10, y: 20, w: 20, h: 20 });
    const water = await publishedParcel({ x: 256 + 100, y: 20, w: 20, h: 20 }, true, true);
    void land; void water;
    const onLand = await renderRasterTile(0, 1, 0), onWater = await renderRasterTile(0, 1, 0, "water");
    expect(await pixel(onLand, 10 + 2, 20 + 5)).toEqual([255, 0, 0, 255]); // the land parcel keeps its colours
    expect((await pixel(onLand, 100 + 2, 20 + 5))[3]).toBe(0); // the water parcel is not on the land layer
    expect((await pixel(onWater, 10 + 2, 20 + 5))[3]).toBe(0); // and the land parcel is not on the water layer
    expect(await pixel(onWater, 100 + 2, 20 + 5)).toEqual([27, 79, 156, 255]); // red is dark: deep blue
    expect(await pixel(onWater, 100 + 15, 20 + 5)).toEqual([27, 79, 156, 255]); // so is blue
  });
  it("far away, a water parcel is the tint of its average colour; without a published creation it is the medium blue", async () => {
    await publishedParcel({ x: 512, y: 512, w: 64, h: 64 }, true, true); // average colour #800080 is dark (lightness 0.21): deep blue
    const far = await renderRasterTile(3, 0, 0, "water");
    expect(await pixel(far, 512 / 8 + 3, 512 / 8 + 3)).toEqual([27, 79, 156, 255]);
    const u = await createUser();
    const o = await startOrder(u, { x: 2048, y: 512, w: 64, h: 64 }, 0, "water");
    await fulfill(o.order_id); // paid, creation not published yet
    expect(await pixel(await renderRasterTile(3, 1, 0, "water"), 3, 512 / 8 + 3)).toEqual([47, 143, 216, 255]);
  });
  it("the metadata tile says which parcels are water and gives them their blue", async () => {
    await publishedParcel({ x: 1100, y: 2200, w: 20, h: 20 });
    await publishedParcel({ x: 1300, y: 2200, w: 20, h: 20 }, true, true);
    const tile = await getTile(1, 2);
    expect(tile.map((p) => [p[1], p[7]])).toEqual([[1100, 0], [1300, 1]]);
    expect(tile[0]![6]).toBe("#800080"); // land: the real average colour
    expect(tile[1]![6]).toBe("#1b4f9c"); // water: its tint (#800080 is dark: deep blue)
  });
});

describe("raster tiles (zoomed-out view)", () => {
  it("level 0 reproduces the creation pixel for pixel", async () => {
    await publishedParcel({ x: 256 + 10, y: 20, w: 20, h: 20 });
    const png = await renderRasterTile(0, 1, 0);
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(await pixel(png, 10 + 2, 20 + 5)).toEqual([255, 0, 0, 255]); // left half red
    expect(await pixel(png, 10 + 15, 20 + 5)).toEqual([0, 0, 255, 255]); // right half blue
    expect((await pixel(png, 5, 5))[3]).toBe(0); // free space stays transparent
  });
  it("higher levels downscale and keep the colours", async () => {
    await publishedParcel({ x: 512, y: 512, w: 64, h: 64 });
    const png = await renderRasterTile(2, 0, 0); // 1 px = 4 virtual px
    const px = await pixel(png, 512 / 4 + 3, 512 / 4 + 8);
    expect(px[0]).toBeGreaterThan(200);
    expect(px[3]).toBe(255);
  });
  it("far out, a parcel of a few pixels is its average colour (its picture is not even fetched); closer, it keeps its picture", async () => {
    await publishedParcel({ x: 512, y: 512, w: 64, h: 64 });
    const near = await renderRasterTile(2, 0, 0); // 16 px wide on the tile: the picture
    expect(await pixel(near, 512 / 4 + 2, 512 / 4 + 8)).toEqual([255, 0, 0, 255]);
    expect(await pixel(near, 512 / 4 + 13, 512 / 4 + 8)).toEqual([0, 0, 255, 255]);
    const far = await renderRasterTile(3, 0, 0); // 8 px wide: its average colour, one flat block
    expect(await pixel(far, 512 / 8 + 1, 512 / 8 + 3)).toEqual([128, 0, 128, 255]);
    expect(await pixel(far, 512 / 8 + 6, 512 / 8 + 3)).toEqual([128, 0, 128, 255]);
  });
  it("a picture fetched for one tile is kept for the next ones (a stored file never changes)", async () => {
    const p = await publishedParcel({ x: 512, y: 512, w: 64, h: 64 });
    expect(await pixel(await renderRasterTile(2, 0, 0), 512 / 4 + 2, 512 / 4 + 8)).toEqual([255, 0, 0, 255]);
    fs.rmSync(path.join(dir, `creations/${p.parcel_id}/test.png`)); // gone from storage…
    expect(await pixel(await renderRasterTile(1, 1, 1), 2, 8)).toEqual([255, 0, 0, 255]); // …yet the next tile (another zoom level) still has it
  });
  it("tiny parcels are never invisible: they render as one coloured pixel", async () => {
    await publishedParcel({ x: 100, y: 100, w: 10, h: 10 });
    const png = await renderRasterTile(6, 0, 0); // 1 px = 64 virtual px
    const alpha = (await sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer()).reduce((a, b) => a + b, 0);
    expect(alpha).toBeGreaterThan(0);
  });
  it("sold parcels without a published creation are drawn as a neutral block, never as free space", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 30, h: 30 });
    await fulfill(o.order_id);
    const png = await renderRasterTile(0, 0, 0);
    expect(await pixel(png, 20, 20)).toEqual([190, 184, 170, 255]);
  });
  it("empty regions and out-of-grid tiles are valid transparent PNGs", async () => {
    for (const [z, x, y] of [[0, 50, 5], [3, 0, 0], [8, 0, 0], [0, 300, 300]] as const) {
      const png = await renderRasterTile(z, x, y);
      const m = await sharp(png).metadata();
      expect([m.width, m.height]).toEqual([256, 256]);
    }
  });
});
