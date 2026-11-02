import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261029000012_min_area_25.sql"), "utf8");
const minArea = async () => Number((await pool.query(`select value from public.app_settings where key = 'min_area'`)).rows[0].value);
const setMin = (v: number) => pool.query(`update public.app_settings set value = $1::jsonb where key = 'min_area'`, [JSON.stringify(v)]);

describe("the smallest parcel is 25 pixels", () => {
  it("a 5 × 5 parcel can be bought, priced and paid; one pixel less cannot", async () => {
    const u = await createUser("small");
    const o = await startOrder(u, { x: 100, y: 100, w: 5, h: 5 });
    expect(Number(o.amount_cents)).toBe(25 * 50); // €12.50
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    await expectPgError(startOrder(u, { x: 300, y: 100, w: 4, h: 6 }), "px_invalid_rect"); // 24 pixels
    await expectPgError(startOrder(u, { x: 300, y: 100, w: 1, h: 1 }), "px_invalid_rect");
    expect((await pool.query(`select count(*)::int n from public.parcels where status = 'active'`)).rows[0].n).toBe(1);
  });

  it("the database itself refuses anything under 25 pixels, even written directly", async () => {
    const u = await createUser("direct");
    const insert = (w: number, h: number) => pool.query(`insert into public.parcels (owner_id, x, y, w, h, status) values ($1, 500, 500, $2, $3, 'reserved')`, [u, w, h]);
    await expectPgError(insert(4, 6), "parcels_min_area");
    await insert(5, 5);
  });

  it("an admin may lower the minimum down to 25, never below, and the new floor is enforced", async () => {
    const admin = await createUser("boss", { role: "admin" });
    const set = (v: number) => pool.query(`select public.px_set_setting($1, 'min_area', $2::jsonb)`, [admin, JSON.stringify(v)]);
    await expectPgError(set(24), "px_bad_setting");
    await expectPgError(set(0), "px_bad_setting");
    await set(25);
    await set(400);
    const u = await createUser("buyer");
    await expectPgError(startOrder(u, { x: 100, y: 100, w: 10, h: 10 }), "px_invalid_rect"); // 100 < 400 now
    await startOrder(u, { x: 100, y: 100, w: 20, h: 20 });
  });

  it("the migration moves the old factory default (100) to 25 and leaves a chosen value alone", async () => {
    await setMin(100);
    await pool.query(migration.slice(migration.indexOf("update public.app_settings")));
    expect(await minArea()).toBe(25);
    await setMin(64);
    await pool.query(migration.slice(migration.indexOf("update public.app_settings")));
    expect(await minArea()).toBe(64);
  });
});
