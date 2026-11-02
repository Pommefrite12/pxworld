import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

describe("half-pixel drawing: the sold pixels do not change, the drawing gets finer", () => {
  it("a creation image is the parcel's size or twice it, nothing else", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner, 10, 10);
    for (const [w, h] of [[10, 10], [20, 20]] as const) expect((await addAsset(owner, parcel, w, h)).rows).toHaveLength(1);
    for (const [w, h] of [[20, 10], [10, 20], [30, 30], [5, 5], [21, 20], [0, 0]] as const) await expectPgError(addAsset(owner, parcel, w, h), "px_bad_dimensions");
  });

  it("the price, the area and the counters only know pixels: a 10 × 10 parcel is 100 pixels however finely it is drawn", async () => {
    const owner = await createUser("owner");
    const o = await startOrder(owner, { x: 100, y: 100, w: 10, h: 10 });
    expect(Number(o.amount_cents)).toBe(10 * 10 * 50);
    await fulfill(o.order_id);
    await addAsset(owner, o.parcel_id, 20, 20);
    const { rows } = await pool.query(`select sold_pixels from public.px_public_stats()`);
    expect(Number(rows[0].sold_pixels)).toBe(100);
    expect((await pool.query(`select area from public.parcels where id = $1`, [o.parcel_id])).rows[0].area).toBe(100);
  });

  it("drawings shared before this change become their 2 × 2 dots, and connected pages are told to reload", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner);
    await pool.query(`select public.px_collab_enable($1, $2)`, [owner, parcel]);
    await pool.query(`insert into public.parcel_collab_pixels (parcel_id, x, y, rgb, version) values ($1, 3, 2, 255, 1), ($1, 9, 5, 65280, 2)`, [parcel]);
    await pool.query(`update public.parcel_collab set version = 2 where parcel_id = $1`, [parcel]);
    // the conversion step of the migration, exactly as shipped
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261029000010_half_pixel_drawing.sql"), "utf8");
    await pool.query(sql.slice(sql.indexOf("with old as")));
    const { rows } = await pool.query(`select x, y, rgb, version::int from public.parcel_collab_pixels where parcel_id = $1 order by rgb, y, x`, [parcel]);
    expect(rows).toEqual([
      ...([[6, 4], [7, 4], [6, 5], [7, 5]] as [number, number][]).map(([x, y]) => ({ x, y, rgb: 255, version: 1 })),
      ...([[18, 10], [19, 10], [18, 11], [19, 11]] as [number, number][]).map(([x, y]) => ({ x, y, rgb: 65280, version: 2 })),
    ].sort((a, b) => a.rgb - b.rgb || a.y - b.y || a.x - b.x));
    const c = (await pool.query(`select version::int v, reset_version::int r from public.parcel_collab where parcel_id = $1`, [parcel])).rows[0];
    expect(c).toEqual({ v: 3, r: 3 });
  });
});
