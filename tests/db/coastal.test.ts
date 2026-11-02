import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const setting = (key: string, value: number) => pool.query(`update public.app_settings set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)]);
const parcelRow = async (id: string) => (await pool.query(`select land_px, area from public.parcels where id = $1`, [id])).rows[0];
const orderRow = async (id: string) => (await pool.query(`select land_px, area, amount_cents from public.orders where id = $1`, [id])).rows[0];
const sold = async () => Number((await pool.query(`select sold_pixels from public.px_public_stats()`)).rows[0].sold_pixels);

describe("coastal parcels: land at the unit price, sea at a percentage (default: offered)", () => {
  it("a parcel without a land count is all land, exactly as before", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 100, y: 100, w: 20, h: 20 });
    expect(Number(o.amount_cents)).toBe(400 * 100);
    expect((await orderRow(o.order_id)).land_px).toBe(400);
    expect((await parcelRow(o.parcel_id)).land_px).toBe(400);
  });

  it("the buyer pays for the land only; the land count is stored with the order and the parcel", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 100, y: 100, w: 20, h: 20 }, 300);
    expect(Number(o.amount_cents)).toBe(300 * 100);
    expect(await orderRow(o.order_id)).toMatchObject({ land_px: 300, area: 400, amount_cents: "30000" });
    expect(await parcelRow(o.parcel_id)).toMatchObject({ land_px: 300, area: 400 });
  });

  it("sea pixels can be charged at a percentage of a land pixel (integer, rounded down)", async () => {
    await setting("sea_price_percent", 50);
    const u = await createUser();
    const o = await startOrder(u, { x: 100, y: 100, w: 20, h: 20 }, 300);
    expect(Number(o.amount_cents)).toBe(300 * 100 + (100 * 100 * 50) / 100);
    await setting("sea_price_percent", 33);
    const o2 = await startOrder(u, { x: 200, y: 100, w: 10, h: 10 }, 93);
    expect(Number(o2.amount_cents)).toBe(93 * 100 + Math.floor((7 * 100 * 33) / 100));
  });

  it("a parcel must be at least min_land_percent land, never all sea, and the count cannot exceed the area", async () => {
    const u = await createUser();
    await expectPgError(startOrder(u, { x: 100, y: 100, w: 20, h: 20 }, 199), "px_not_on_land"); // 49.75 % < 50 %
    await expectPgError(startOrder(u, { x: 100, y: 100, w: 20, h: 20 }, 0), "px_not_on_land");
    await expectPgError(startOrder(u, { x: 100, y: 100, w: 20, h: 20 }, 401), "px_not_on_land");
    expect(Number((await startOrder(u, { x: 100, y: 100, w: 20, h: 20 }, 200)).amount_cents)).toBe(200 * 100); // exactly 50 %
    // nothing was held by the refused attempts: the same area is bookable by someone else once released
    expect((await pool.query(`select count(*)::int n from public.parcels where status = 'reserved'`)).rows[0].n).toBe(1);
    await setting("min_land_percent", 100);
    await expectPgError(startOrder(u, { x: 300, y: 100, w: 20, h: 20 }, 399), "px_not_on_land");
    expect(Number((await startOrder(u, { x: 300, y: 100, w: 20, h: 20 }, 400)).amount_cents)).toBe(400 * 100);
  });

  it("the payment must match the land-based price, and the public counters count land pixels sold", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 100, y: 100, w: 20, h: 20 }, 300);
    expect(await fulfill(o.order_id, { subtotal: 400 * 100 })).toBe("refund_required"); // paid for the whole area: not the server price
    const o2 = await startOrder(u, { x: 200, y: 100, w: 20, h: 20 }, 300);
    expect(await sold()).toBe(0);
    expect(await fulfill(o2.order_id)).toBe("fulfilled");
    expect(await sold()).toBe(300); // not 400: the sea part is not "sold land"
  });

  it("only admins can change the two settings, within bounds", async () => {
    const admin = await createUser("boss", { role: "admin" });
    const set = (key: string, v: number) => pool.query(`select public.px_set_setting($1, $2, $3::jsonb)`, [admin, key, JSON.stringify(v)]);
    await set("sea_price_percent", 0);
    await set("sea_price_percent", 100);
    await set("min_land_percent", 1);
    await expectPgError(set("sea_price_percent", 101), "px_bad_setting");
    await expectPgError(set("min_land_percent", 0), "px_bad_setting");
    await expectPgError(set("min_land_percent", 101), "px_bad_setting");
    const regular = await createUser();
    await expectPgError(pool.query(`select public.px_set_setting($1, 'sea_price_percent', '10'::jsonb)`, [regular]), /px_forbidden|forbidden/);
  });
});
