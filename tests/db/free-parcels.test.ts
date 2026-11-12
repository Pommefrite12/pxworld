import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(async () => {
  await resetData();
  // the free period as the migration sets it (other tests of this file change it)
  for (const [k, v] of [["free_parcels_open", true], ["free_parcels_days", 60], ["free_parcels_cap", 5000], ["free_max_area", 24], ["free_lifetime_max", 3]] as const) {
    await pool.query(`update public.app_settings set value = $2::jsonb where key = $1`, [k, JSON.stringify(v)]);
  }
});

/** Places a free parcel through the database function (the route does the same after its own checks). */
const place = (user: string, x: number, y: number, w: number, h: number, land?: number) =>
  pool.query(`select * from public.px_place_free_parcel($1, $2, $3, $4, $5, $6)`, [user, x, y, w, h, land ?? null]).then((r) => r.rows[0] as { parcel_id: string; code: string });
const row = async (id: string) => (await pool.query(`select * from public.parcels where id = $1`, [id])).rows[0];
const stats = async () => (await pool.query(`select * from public.px_public_stats()`)).rows[0];
const status = async (user: string | null = null) => (await pool.query(`select public.px_free_status($1) as s`, [user])).rows[0].s as Record<string, any>;
const boss = () => createUser("boss", { role: "admin" });
/** A paid 5 × 5 parcel (the smallest), bought and paid. */
async function buy(user: string, x: number, y: number, w = 5, h = 5) {
  const o = await startOrder(user, { x, y, w, h });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  return o.parcel_id as string;
}

describe("placing a free parcel", () => {
  it("is for nothing: active at once, land, with no order; the counters of SOLD pixels do not move, the free ones are counted apart", async () => {
    const u = await createUser("gift");
    const p = await place(u, 200, 200, 4, 6); // 24 pixels: the biggest
    expect(p.code).toMatch(/^[0-9a-f]{10}$/);
    expect(await row(p.parcel_id)).toMatchObject({ tier: "free", status: "active", kind: "land", w: 4, h: 6, area: 24, owner_id: u, covered_at: null });
    expect((await pool.query(`select count(*)::int as n from public.orders`)).rows[0].n).toBe(0);
    expect(await stats()).toMatchObject({ sold_pixels: "0", parcels: "0", owners: "0", free_parcels: "1", free_pixels: "24" });
    expect((await pool.query(`select count(*)::int as n from public.audit_logs where action = 'free_parcel.place'`)).rows[0].n).toBe(1);
  });

  it("is always smaller than the smallest paid parcel: 1 to 24 pixels (25 is a paid one), whatever the way in", async () => {
    const u = await createUser("size");
    await expectPgError(place(u, 200, 200, 5, 5), "px_invalid_rect"); // 25
    await expectPgError(place(u, 200, 200, 0, 4), "px_invalid_rect");
    await expectPgError(place(u, 200, 200, 25, 1), "px_invalid_rect");
    await expectPgError(place(u, -1, 200, 2, 2), "px_invalid_rect");
    expect((await place(u, 200, 200, 1, 1)).parcel_id).toBeTruthy(); // one pixel
    // the table itself says it too (no application code involved)
    await expectPgError(pool.query(`insert into public.parcels (owner_id, x, y, w, h, status, tier) values ($1, 900, 900, 5, 5, 'active', 'free')`, [u]), "parcels_min_area");
    await expectPgError(pool.query(`insert into public.parcels (owner_id, x, y, w, h, status, tier) values ($1, 900, 900, 4, 4, 'active', 'paid')`, [u]), "parcels_min_area");
    await expectPgError(pool.query(`insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px) values ($1, 900, 900, 3, 3, 'active', 'free', 'water', 0)`, [u]), "parcels_free_is_land");
  });

  it("is on land: at least the same share of land as a paid land parcel (half, by default)", async () => {
    const u = await createUser("land");
    await expectPgError(place(u, 200, 200, 4, 6, 5), "px_not_on_land"); // 5 land pixels of 24
    await expectPgError(place(u, 200, 200, 4, 6, 0), "px_not_on_land");
    expect((await place(u, 200, 200, 4, 6, 12)).parcel_id).toBeTruthy(); // half
  });

  it("is limited per account: one standing at a time, three placements in all, and a parcel given back does not count", async () => {
    const u = await createUser("quota");
    const first = await place(u, 200, 200, 2, 2);
    await expectPgError(place(u, 300, 300, 2, 2), "px_free_quota"); // one standing
    expect(await status(u)).toMatchObject({ userReason: "standing", used: 1, lifetimeMax: 3 });
    // given back (the upload failed): the slot is free and the try is not counted
    await pool.query(`select public.px_cancel_free_parcel($1, $2)`, [u, first.parcel_id]);
    expect(await row(first.parcel_id)).toMatchObject({ status: "released" });
    expect(await status(u)).toMatchObject({ userReason: null, used: 0 });
    // covered each time by a purchase: three placements, then no more
    for (let i = 0; i < 3; i++) {
      const p = await place(u, 400 + i * 50, 400, 2, 2);
      await buy(await createUser(`buyer${i}`), 400 + i * 50, 400);
      expect(await row(p.parcel_id)).toMatchObject({ status: "covered" });
    }
    await expectPgError(place(u, 700, 700, 2, 2), "px_free_quota");
    expect(await status(u)).toMatchObject({ userReason: "lifetime", used: 3 });
    // somebody else is not affected
    expect((await place(await createUser("other"), 700, 700, 2, 2)).parcel_id).toBeTruthy();
  });

  it("is where nothing is: not over a paid parcel, not over one that is being paid, not over another free one; touching is fine", async () => {
    const [a, b, c] = [await createUser("a"), await createUser("b"), await createUser("c")];
    await buy(a, 300, 300, 5, 5);
    await expectPgError(place(b, 302, 302, 2, 2), "px_parcel_unavailable"); // over an active paid parcel
    await startOrder(c, { x: 400, y: 400, w: 5, h: 5 }); // reserved, waiting for the payment
    await expectPgError(place(b, 401, 401, 2, 2), "px_parcel_unavailable");
    await place(b, 500, 500, 3, 3);
    await expectPgError(place(await createUser("d"), 502, 502, 3, 3), "px_parcel_unavailable"); // over a free one
    expect((await place(await createUser("e"), 503, 500, 3, 3)).parcel_id).toBeTruthy(); // touching only
    // two free parcels can never overlap, even with no application code
    await expectPgError(pool.query(`insert into public.parcels (owner_id, x, y, w, h, status, tier) values ($1, 501, 501, 2, 2, 'active', 'free')`, [a]), "parcels_no_overlap_free");
  });
});

describe("a free parcel never blocks a purchase, and a paid parcel that becomes active covers it", () => {
  it("a purchase over a free parcel is accepted (the reservation does not touch it yet); the payment covers it, whole, even if only a corner is touched", async () => {
    const owner = await createUser("owner");
    const p = await place(owner, 200, 200, 4, 4);
    await pool.query(`select * from public.px_add_asset($1, $2, 'creations/f.png', 'abcdef', 4, 4, 10, '#112233', 'Tiny', null, null, false)`, [owner, p.parcel_id]);
    const buyer = await createUser("buyer");
    const o = await startOrder(buyer, { x: 203, y: 203, w: 5, h: 5 }); // shares one corner pixel with the free parcel
    expect(await row(p.parcel_id)).toMatchObject({ status: "active", covered_at: null }); // still there while it is being paid
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    const covered = await row(p.parcel_id);
    expect(covered).toMatchObject({ status: "covered", covered_by: o.parcel_id });
    expect(covered.covered_at).toBeTruthy();
    // its creation was still waiting for moderation: it leaves the queue
    expect((await pool.query(`select status from public.parcel_assets where parcel_id = $1`, [p.parcel_id])).rows[0].status).toBe("superseded");
    // the pixels are the buyer's alone, and the quota of the first owner is free again for a new try
    expect((await status(owner)).userReason).toBeNull();
    expect((await place(owner, 600, 600, 2, 2)).parcel_id).toBeTruthy();
  });

  it("a parcel that only touches a free one leaves it alone; a reservation that expires leaves it alone too", async () => {
    const owner = await createUser("owner");
    const p = await place(owner, 200, 200, 4, 4);
    await buy(await createUser("next"), 204, 200); // right next to it
    expect(await row(p.parcel_id)).toMatchObject({ status: "active" });
    const o = await startOrder(await createUser("late"), { x: 199, y: 201, w: 5, h: 5 }); // over the free one, clear of the paid one next to it
    await pool.query(`select public.px_cancel_order($1, $2)`, [o.order_id, (await pool.query(`select user_id from public.orders where id = $1`, [o.order_id])).rows[0].user_id]);
    expect(await row(p.parcel_id)).toMatchObject({ status: "active" });
  });

  it("covers every free parcel the rectangle touches, in one go; a paid WATER parcel covers none (it owns other pixels)", async () => {
    const [a, b, c] = [await createUser("a"), await createUser("b"), await createUser("c")];
    const f1 = await place(a, 100, 100, 2, 2), f2 = await place(b, 106, 100, 2, 2), f3 = await place(c, 112, 100, 2, 2);
    const water = await startOrder(await createUser("sea"), { x: 99, y: 99, w: 20, h: 5 }, 0, "water"); // no land pixel: all water
    expect(await fulfill(water.order_id)).toBe("fulfilled");
    for (const f of [f1, f2, f3]) expect(await row(f.parcel_id)).toMatchObject({ status: "active" });
    await buy(await createUser("big"), 101, 100, 7, 5); // reaches the first two, not the third
    expect((await row(f1.parcel_id)).status).toBe("covered");
    expect((await row(f2.parcel_id)).status).toBe("covered");
    expect((await row(f3.parcel_id)).status).toBe("active");
  });

  it("whatever the path that makes a paid parcel active (here a plain insert: a group project funded does the same), the free ones under it are covered", async () => {
    const owner = await createUser("owner");
    const p = await place(owner, 200, 200, 3, 3);
    await pool.query(`insert into public.parcels (owner_id, x, y, w, h, status) values ($1, 190, 190, 20, 20, 'active')`, [await createUser("whale")]);
    expect(await row(p.parcel_id)).toMatchObject({ status: "covered" });
  });

  it("covering is final: when the covering parcel is revoked the free one does not come back; the sold counters never counted it", async () => {
    const owner = await createUser("owner");
    const p = await place(owner, 200, 200, 3, 3);
    const paid = await buy(await createUser("buyer"), 201, 201);
    expect(await stats()).toMatchObject({ sold_pixels: "25", parcels: "1", free_parcels: "0", free_pixels: "0" }); // the free one is covered: not on the map any more
    await pool.query(`select public.px_revoke_parcel($1, $2, 'refunded')`, [await boss(), paid]);
    expect(await row(p.parcel_id)).toMatchObject({ status: "covered" });
    expect(await stats()).toMatchObject({ sold_pixels: "0", free_parcels: "0" });
  });
});

describe("the free period: a switch, a window, a cap, the edition", () => {
  it("can be switched off by an administrator, and nothing else can switch it", async () => {
    const u = await createUser("u"), admin = await boss();
    await pool.query(`select public.px_set_setting($1, 'free_parcels_open', 'false'::jsonb)`, [admin]);
    await expectPgError(place(u, 200, 200, 2, 2), "px_free_closed");
    expect(await status(u)).toMatchObject({ open: false, reason: "off" });
    await pool.query(`select public.px_set_setting($1, 'free_parcels_open', 'true'::jsonb)`, [admin]);
    expect((await place(u, 200, 200, 2, 2)).parcel_id).toBeTruthy();
    await expectPgError(pool.query(`select public.px_set_setting($1, 'free_parcels_open', 'false'::jsonb)`, [await createUser("mod", { role: "moderator" })]), "px_forbidden");
  });

  it("ends 60 days after the opening of the edition (the window is a setting), and the parcels already there stay", async () => {
    const [u, v] = [await createUser("u"), await createUser("v")];
    const p = await place(u, 200, 200, 2, 2);
    const s = await status();
    expect(s).toMatchObject({ open: true, reason: null, maxArea: 24, cap: 5000 });
    const opens = (await pool.query(`select opens_at from public.editions`)).rows[0].opens_at as Date;
    expect(Math.abs(Date.parse(s.endsAt) - (opens.getTime() + 60 * 86_400_000))).toBeLessThan(1000);
    await pool.query(`update public.editions set opens_at = now() - interval '61 days'`);
    await expectPgError(place(v, 300, 300, 2, 2), "px_free_closed");
    expect(await status(v)).toMatchObject({ open: false, reason: "ended" });
    expect(await row(p.parcel_id)).toMatchObject({ status: "active" });
    await pool.query(`select public.px_set_setting($1, 'free_parcels_days', '90'::jsonb)`, [await boss()]); // an administrator can extend the window
    expect((await place(v, 300, 300, 2, 2)).parcel_id).toBeTruthy();
  });

  it("stops at the cap (placements ever made, covered ones included)", async () => {
    await pool.query(`select public.px_set_setting($1, 'free_parcels_cap', '2'::jsonb)`, [await boss()]);
    const [a, b, c] = [await createUser("a"), await createUser("b"), await createUser("c")];
    await place(a, 200, 200, 2, 2);
    await place(b, 300, 300, 2, 2);
    await expectPgError(place(c, 400, 400, 2, 2), "px_free_full");
    expect(await status(c)).toMatchObject({ open: false, reason: "full", placed: 2 });
    await buy(await createUser("buyer"), 200, 200); // covering one does not make room
    await expectPgError(place(c, 400, 400, 2, 2), "px_free_full");
  });

  it("only while the edition is open: not before the opening, not after the closing", async () => {
    const u = await createUser("u");
    await pool.query(`update public.editions set status = 'prelaunch', opens_at = null, closes_at = null, closed_at = null`);
    await expectPgError(place(u, 200, 200, 2, 2), "px_edition_not_open");
    expect(await status(u)).toMatchObject({ open: false, reason: "edition", endsAt: null });
    await pool.query(`update public.editions set status = 'open', opens_at = now() - interval '2 days', closes_at = now() - interval '1 minute'`);
    await expectPgError(place(u, 200, 200, 2, 2), "px_edition_closed");
  });

  it("not for a suspended account", async () => {
    const u = await createUser("u");
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [u]);
    await expectPgError(place(u, 200, 200, 2, 2), "px_account_suspended");
  });

  it("its settings are checked: a free parcel is never as big as a paid one, a handful of tries, a window of a year at most", async () => {
    const admin = await boss();
    const set = (k: string, v: unknown) => pool.query(`select public.px_set_setting($1, $2, $3::jsonb)`, [admin, k, JSON.stringify(v)]);
    await expectPgError(set("free_max_area", 25), "px_bad_setting");
    await expectPgError(set("free_max_area", 0), "px_bad_setting");
    await expectPgError(set("free_lifetime_max", 11), "px_bad_setting");
    await expectPgError(set("free_parcels_days", 367), "px_bad_setting");
    await expectPgError(set("free_parcels_open", "yes"), "px_bad_setting");
    await set("free_max_area", 9);
    await expectPgError(place(await createUser("u"), 200, 200, 4, 3), "px_invalid_rect"); // 12 > 9
    expect((await place(await createUser("v"), 200, 200, 3, 3)).parcel_id).toBeTruthy();
  });
});
