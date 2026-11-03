import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

/** The default price the tests start from (helpers.resetData): €0.50 per pixel. */
const UNIT = 50;
const setting = (key: string, value: number) => pool.query(`update public.app_settings set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)]);
const order = async (id: string) => (await pool.query(`select kind, land_px, area, amount_cents, sea_percent, water_percent from public.orders where id = $1`, [id])).rows[0];
const parcel = async (id: string) => (await pool.query(`select kind, land_px, area, owned_px from public.parcels where id = $1`, [id])).rows[0];
const stats = async () => (await pool.query(`select * from public.px_public_stats()`)).rows[0];
const free = async (r: { x: number; y: number; w: number; h: number }, kind?: string) =>
  (await pool.query(`select public.px_is_area_free($1, $2, $3, $4${kind ? ", $5" : ""}) as f`, [r.x, r.y, r.w, r.h, ...(kind ? [kind] : [])])).rows[0].f as boolean;

const RECT = { x: 100, y: 100, w: 20, h: 20 }; // 400 px

describe("water parcels: the sea is bought for its water pixels, the land inside is cut away", () => {
  it("a water parcel owns its water pixels and pays for them; the land cut away is free by default", async () => {
    const u = await createUser();
    const o = await startOrder(u, RECT, 100, "water"); // 100 land, 300 water
    expect(Number(o.amount_cents)).toBe(300 * UNIT);
    expect(await order(o.order_id)).toMatchObject({ kind: "water", land_px: 100, area: 400, amount_cents: String(300 * UNIT), sea_percent: 0, water_percent: 100 });
    expect(await parcel(o.parcel_id)).toMatchObject({ kind: "water", land_px: 100, owned_px: 300 });
  });

  it("the water price is a percentage of the land price, and the land cut away can be charged too (integers, rounded down)", async () => {
    await setting("water_price_percent", 150);
    await setting("land_cut_price_percent", 10);
    const u = await createUser();
    const o = await startOrder(u, { ...RECT }, 93, "water"); // 93 land, 307 water
    expect(Number(o.amount_cents)).toBe(Math.floor((307 * UNIT * 150) / 100) + Math.floor((93 * UNIT * 10) / 100));
    expect(await order(o.order_id)).toMatchObject({ sea_percent: 10, water_percent: 150 });
    await setting("water_price_percent", 33);
    const o2 = await startOrder(u, { x: 300, y: 100, w: 20, h: 20 }, 0, "water");
    expect(Number(o2.amount_cents)).toBe(Math.floor((400 * UNIT * 33) / 100));
  });

  it("a water parcel must be at least min_water_percent water, never all land; a land parcel is unchanged", async () => {
    const u = await createUser();
    await expectPgError(startOrder(u, RECT, 201, "water"), "px_not_on_water"); // 49.75 % water
    await expectPgError(startOrder(u, RECT, 400, "water"), "px_not_on_water"); // all land
    await expectPgError(startOrder(u, RECT, undefined, "water"), "px_not_on_water"); // no land count = all land
    expect(Number((await startOrder(u, RECT, 200, "water")).amount_cents)).toBe(200 * UNIT); // exactly 50 %
    await expectPgError(startOrder(u, { x: 300, y: 100, w: 20, h: 20 }, 100, "land"), "px_not_on_land"); // 100 land of 400: a land parcel needs 50 %
    await setting("min_water_percent", 90);
    await expectPgError(startOrder(u, { x: 500, y: 100, w: 20, h: 20 }, 100, "water"), "px_not_on_water"); // 75 % water
    expect(Number((await startOrder(u, { x: 500, y: 100, w: 20, h: 20 }, 40, "water")).amount_cents)).toBe(360 * UNIT); // 90 %
  });

  it("an unknown kind is refused", async () => {
    const u = await createUser();
    await expectPgError(pool.query(`select * from public.px_start_order($1, 100, 100, 20, 20, 100, null, 'lava')`, [u]), "px_invalid_rect");
  });
});

describe("land and water share a rectangle without sharing a pixel", () => {
  it("a land parcel and a water parcel may sit on the very same rectangle (half land, half water): each owns its own pixels", async () => {
    const a = await createUser(), b = await createUser(), c = await createUser();
    const land = await startOrder(a, RECT, 200); // owns the 200 land pixels
    const water = await startOrder(b, RECT, 200, "water"); // owns the 200 water pixels of the same rectangle
    expect(water.parcel_id).not.toBe(land.parcel_id);
    expect(await fulfill(land.order_id)).toBe("fulfilled");
    expect(await fulfill(water.order_id)).toBe("fulfilled");
    await expectPgError(startOrder(c, RECT, 200, "water"), "px_parcel_unavailable"); // a second water parcel there: no
    await expectPgError(startOrder(c, RECT, 200, "land"), "px_parcel_unavailable"); // a second land parcel there: no
    expect(Number((await pool.query(`select count(*) from public.parcels where status = 'active'`)).rows[0].count)).toBe(2);
  });

  it("the guarantee holds per kind in the database itself", async () => {
    const a = await createUser(), b = await createUser();
    const o1 = await startOrder(a, RECT, 100, "water");
    await expectPgError(startOrder(b, { x: 110, y: 110, w: 20, h: 20 }, 100, "water"), "px_parcel_unavailable"); // overlaps the first water parcel
    const o2 = await startOrder(b, { x: 110, y: 110, w: 20, h: 20 }, 300, "land"); // a land parcel on top: other pixels, no conflict
    expect(o2.parcel_id).not.toBe(o1.parcel_id);
    await expectPgError(startOrder(a, { x: 115, y: 115, w: 20, h: 20 }, 300, "land"), "px_parcel_unavailable"); // but not over the land parcel
  });

  it("availability is asked per kind", async () => {
    const a = await createUser();
    const o = await startOrder(a, RECT, 100, "water");
    await fulfill(o.order_id);
    expect(await free(RECT, "water")).toBe(false);
    expect(await free(RECT, "land")).toBe(true);
    expect(await free(RECT)).toBe(true); // the default is land
    expect(await free({ x: 500, y: 500, w: 10, h: 10 }, "water")).toBe(true);
  });

  it("once the reservation of a water parcel ends, the rectangle is free again for water", async () => {
    const a = await createUser(), b = await createUser();
    const o = await startOrder(a, RECT, 100, "water");
    await expectPgError(startOrder(b, RECT, 100, "water"), "px_parcel_unavailable");
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 minute' where order_id = $1`, [o.order_id]);
    expect((await startOrder(b, RECT, 100, "water")).order_id).toBeTruthy();
  });
});

describe("the public counters count the whole planet, land and water", () => {
  it("land and water pixels owned add up; the water share is reported on its own; the cut-away pixels are not counted", async () => {
    const a = await createUser(), b = await createUser();
    const land = await startOrder(a, RECT, 300); // owns 300
    const water = await startOrder(b, { x: 300, y: 100, w: 20, h: 20 }, 100, "water"); // owns 300
    expect(await fulfill(land.order_id)).toBe("fulfilled");
    expect(await fulfill(water.order_id)).toBe("fulfilled");
    expect(await stats()).toMatchObject({ sold_pixels: "600", parcels: "2", owners: "2", water_pixels: "300", water_parcels: "1" });
  });

  it("a water order is paid at its own price, not at the price of the whole rectangle", async () => {
    const a = await createUser();
    const wrong = await startOrder(a, RECT, 150, "water"); // 250 water
    expect(await fulfill(wrong.order_id, { subtotal: 400 * UNIT })).toBe("refund_required");
    const right = await startOrder(a, { x: 300, y: 100, w: 20, h: 20 }, 150, "water");
    expect(Number(right.amount_cents)).toBe(250 * UNIT);
    expect(await fulfill(right.order_id)).toBe("fulfilled");
    expect(Number((await stats()).sold_pixels)).toBe(250);
  });
});

describe("the settings", () => {
  it("an admin can change the water settings, within range; others cannot", async () => {
    const admin = await createUser("adm", { role: "admin" }), mod = await createUser("mod", { role: "moderator" });
    const set = (actor: string, key: string, value: unknown) => pool.query(`select public.px_set_setting($1, $2, $3::jsonb)`, [actor, key, JSON.stringify(value)]);
    await set(admin, "water_price_percent", 200);
    await set(admin, "min_water_percent", 60);
    await set(admin, "land_cut_price_percent", 25);
    expect((await pool.query(`select value from public.app_settings where key = 'water_price_percent'`)).rows[0].value).toBe(200);
    await expectPgError(set(admin, "water_price_percent", 0), "px_bad_setting");
    await expectPgError(set(admin, "water_price_percent", 1001), "px_bad_setting");
    await expectPgError(set(admin, "min_water_percent", 101), "px_bad_setting");
    await expectPgError(set(admin, "land_cut_price_percent", 101), "px_bad_setting");
    await expectPgError(set(admin, "land_cut_price_percent", -1), "px_bad_setting");
    await set(admin, "land_cut_price_percent", 0);
    await expectPgError(set(mod, "water_price_percent", 100), "px_forbidden");
  });
});
