import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { creationScale } from "@/lib/grid/constants";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

async function activeParcel(owner: string, w = 10, h = 10) {
  const o = await startOrder(owner, { x: 100, y: 100, w, h });
  await fulfill(o.order_id);
  return o.parcel_id;
}
const addAsset = (user: string, parcel: string, width: number, height: number) =>
  pool.query(`select * from public.px_add_asset($1, $2, $3, $4, $5, $6, 1000, '#112233', 'Title', null, null, false)`, [user, parcel, `creations/${parcel}/${width}x${height}.png`, "h".repeat(8), width, height]);

describe("drawing finer than a pixel: the sold pixels do not change, the drawing gets finer (up to 0.1 px)", () => {
  it("the SQL precision rule is the same as the application's, for every kind of parcel", async () => {
    for (const [w, h] of [[10, 10], [20, 20], [37, 91], [200, 200], [201, 200], [300, 300], [500, 500], [1000, 250], [1000, 1000]] as const) {
      const { rows } = await pool.query(`select public.px_dot_scale($1, $2) as k`, [w, h]);
      expect(rows[0].k, `${w}x${h}`).toBe(creationScale(w, h));
    }
  });

  it("a creation image is the parcel's size times a whole scale, up to the parcel's maximum, nothing else", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner, 10, 10); // 10 dots per pixel
    for (const k of [1, 2, 3, 5, 10]) expect((await addAsset(owner, parcel, 10 * k, 10 * k)).rows, `k=${k}`).toHaveLength(1);
    for (const [w, h] of [[110, 110], [20, 10], [100, 90], [95, 95], [5, 5], [0, 0], [-10, -10]] as const) await expectPgError(addAsset(owner, parcel, w, h), "px_bad_dimensions");
  });

  it("a very large parcel is less fine: the image may not exceed 4 million dots", async () => {
    const owner = await createUser("owner");
    const o = await startOrder(owner, { x: 2000, y: 2000, w: 500, h: 500 }); // 250 000 px → at most 4 dots per pixel
    await fulfill(o.order_id);
    expect((await addAsset(owner, o.parcel_id, 2000, 2000)).rows).toHaveLength(1); // exactly 4 M dots
    await expectPgError(addAsset(owner, o.parcel_id, 2500, 2500), "px_bad_dimensions"); // 5 × 5 would be 6.25 M
  });

  it("the price, the area and the counters only know pixels: a 10 × 10 parcel is 100 pixels however finely it is drawn", async () => {
    const owner = await createUser("owner");
    const o = await startOrder(owner, { x: 100, y: 100, w: 10, h: 10 });
    expect(Number(o.amount_cents)).toBe(10 * 10 * 50);
    await fulfill(o.order_id);
    await addAsset(owner, o.parcel_id, 100, 100); // the finest drawing
    const { rows } = await pool.query(`select sold_pixels from public.px_public_stats()`);
    expect(Number(rows[0].sold_pixels)).toBe(100);
    expect((await pool.query(`select area from public.parcels where id = $1`, [o.parcel_id])).rows[0].area).toBe(100);
  });

  it("drawings shared before this change (2 dots per pixel) are re-expressed at the parcel's precision, and pages reload", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner); // 10 × 10 px → 10 dots per pixel: every old dot covers 5 × 5 new ones
    await pool.query(`select public.px_collab_enable($1, $2)`, [owner, parcel]);
    await pool.query(`insert into public.parcel_collab_pixels (parcel_id, x, y, rgb, version) values ($1, 3, 2, 255, 1), ($1, 19, 19, 65280, 2)`, [parcel]);
    await pool.query(`update public.parcel_collab set version = 2 where parcel_id = $1`, [parcel]);
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261029000011_tenth_pixel_drawing.sql"), "utf8");
    await pool.query(sql.slice(sql.indexOf("with old as")));
    const { rows } = await pool.query(`select x, y, rgb, version::int from public.parcel_collab_pixels where parcel_id = $1 order by rgb, y, x`, [parcel]);
    expect(rows).toHaveLength(50); // 2 old dots × 25
    const red = rows.filter((r) => r.rgb === 255), green = rows.filter((r) => r.rgb === 65280);
    expect([Math.min(...red.map((r) => r.x)), Math.max(...red.map((r) => r.x)), Math.min(...red.map((r) => r.y)), Math.max(...red.map((r) => r.y))]).toEqual([15, 19, 10, 14]); // dot (3,2) → x 15..19, y 10..14
    expect([Math.min(...green.map((r) => r.x)), Math.max(...green.map((r) => r.x))]).toEqual([95, 99]); // the last old dot → the last 5 new ones
    expect(new Set(red.map((r) => r.version))).toEqual(new Set([1]));
    expect((await pool.query(`select version::int v, reset_version::int r from public.parcel_collab where parcel_id = $1`, [parcel])).rows[0]).toEqual({ v: 3, r: 3 });
  });
});
