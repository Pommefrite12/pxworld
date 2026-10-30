import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, overlappingPairs, pool, resetData, startOrder, fulfill } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

describe("px_start_order", () => {
  it("prices on the server: area × unit price, 1 € per pixel by default", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 1000, y: 1000, w: 20, h: 20 });
    expect(Number(o.amount_cents)).toBe(40_000);
    expect(o.unit_price_cents).toBe(100);
    expect(o.currency).toBe("eur");
    const { rows } = await pool.query(`select status from public.parcels where id = $1`, [o.parcel_id]);
    expect(rows[0].status).toBe("reserved");
  });

  it("follows the admin-configured unit price for future orders only", async () => {
    const [u, admin] = [await createUser(), await createUser("adm", { role: "admin" })];
    const first = await startOrder(u, { x: 0, y: 0, w: 10, h: 10 });
    await pool.query(`select public.px_set_setting($1, 'price_unit_cents', '250')`, [admin]);
    const second = await startOrder(u, { x: 100, y: 0, w: 10, h: 10 });
    expect(Number(first.amount_cents)).toBe(10_000);
    expect(Number(second.amount_cents)).toBe(25_000);
  });

  it("refuses overlapping reservations", async () => {
    const [a, b] = [await createUser(), await createUser()];
    await startOrder(a, { x: 500, y: 500, w: 50, h: 50 });
    await expectPgError(startOrder(b, { x: 540, y: 540, w: 50, h: 50 }), "px_parcel_unavailable");
    await startOrder(b, { x: 550, y: 500, w: 50, h: 50 }); // adjacent is fine
  });

  it("validates the rectangle against grid and business limits", async () => {
    const u = await createUser();
    await expectPgError(startOrder(u, { x: 0, y: 0, w: 9, h: 10 }), "px_invalid_rect");
    await expectPgError(startOrder(u, { x: 39_995, y: 0, w: 10, h: 10 }), "px_invalid_rect");
    await expectPgError(startOrder(u, { x: 0, y: 0, w: 600, h: 600 }), "px_invalid_rect"); // above max_area
    await expectPgError(startOrder(u, { x: -5, y: 0, w: 10, h: 10 }), "px_invalid_rect");
  });

  it("blocks suspended accounts and closed sales", async () => {
    const [u, admin] = [await createUser(), await createUser("adm", { role: "admin" })];
    await pool.query(`select public.px_set_user_suspended($1, $2, true, 'test')`, [admin, u]);
    await expectPgError(startOrder(u, { x: 0, y: 0, w: 10, h: 10 }), "px_account_suspended");
    await pool.query(`select public.px_set_user_suspended($1, $2, false)`, [admin, u]);
    await pool.query(`select public.px_set_setting($1, 'sales_open', 'false')`, [admin]);
    await expectPgError(startOrder(u, { x: 0, y: 0, w: 10, h: 10 }), "px_sales_closed");
  });

  it("limits unpaid holds per user (anti-hoarding)", async () => {
    const u = await createUser();
    for (let i = 0; i < 3; i++) await startOrder(u, { x: i * 20, y: 0, w: 10, h: 10 });
    await expectPgError(startOrder(u, { x: 200, y: 0, w: 10, h: 10 }), "px_too_many_reservations");
  });
});

describe("concurrency", () => {
  it("40 simultaneous buyers of the very same area: exactly one wins", async () => {
    const users = await Promise.all(Array.from({ length: 40 }, () => createUser()));
    const results = await Promise.allSettled(users.map((u) => startOrder(u, { x: 2000, y: 2000, w: 100, h: 100 })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(39);
    for (const r of rejected) expect(String(r.reason)).toContain("px_parcel_unavailable");
    expect(await overlappingPairs()).toBe(0);
  });

  it("300 overlapping random rectangles raced against each other never produce an overlap", async () => {
    const users = await Promise.all(Array.from({ length: 300 }, () => createUser()));
    // Dense cluster so that many rectangles genuinely collide.
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const results = await Promise.allSettled(
      users.map((u) => startOrder(u, { x: 3000 + rnd(150), y: 3000 + rnd(150), w: 10 + rnd(40), h: 10 + rnd(40) })),
    );
    const won = results.filter((r) => r.status === "fulfilled").length;
    expect(won).toBeGreaterThan(1);
    expect(won).toBeLessThan(300);
    expect(await overlappingPairs()).toBe(0);
    for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/px_parcel_unavailable/);
  });

  it("racing a payment against a new reservation never double-sells", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const o = await startOrder(a, { x: 7000, y: 7000, w: 20, h: 20 });
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 minute' where order_id = $1`, [o.order_id]);
    // Hold lapsed; buyer B takes the area while A's payment webhook arrives at the same time.
    const [rb, fa] = await Promise.allSettled([startOrder(b, { x: 7005, y: 7005, w: 20, h: 20 }), fulfill(o.order_id)]);
    expect(await overlappingPairs()).toBe(0);
    const { rows } = await pool.query(`select status from public.orders where id = $1`, [o.order_id]);
    if (rb.status === "fulfilled") {
      // B got there first → A is told to be refunded, never silently double-booked.
      expect(fa.status === "fulfilled" ? fa.value : "").toBe("refund_required");
      expect(rows[0].status).toBe("refund_required");
    } else {
      expect(fa.status === "fulfilled" ? fa.value : "").toBe("fulfilled");
      expect(rows[0].status).toBe("paid");
    }
  });
});

describe("reservation expiry", () => {
  it("a lapsed hold never blocks a new buyer, even before the cron runs", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const o = await startOrder(a, { x: 900, y: 900, w: 30, h: 30 });
    await expectPgError(startOrder(b, { x: 900, y: 900, w: 30, h: 30 }), "px_parcel_unavailable");
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 second' where order_id = $1`, [o.order_id]);
    await startOrder(b, { x: 900, y: 900, w: 30, h: 30 });
    const { rows } = await pool.query(`select status from public.orders where id = $1`, [o.order_id]);
    expect(rows[0].status).toBe("expired");
    expect(await overlappingPairs()).toBe(0);
  });

  it("px_expire_reservations releases lapsed holds and returns the Stripe sessions to expire", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 0, y: 0, w: 10, h: 10 });
    await pool.query(`select public.px_attach_checkout_session($1, 'cs_test_abc')`, [o.order_id]);
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 second' where order_id = $1`, [o.order_id]);
    const { rows } = await pool.query(`select * from public.px_expire_reservations()`);
    expect(rows).toEqual([{ order_id: o.order_id, stripe_checkout_session_id: "cs_test_abc" }]);
    const p = await pool.query(`select status from public.parcels where id = $1`, [o.parcel_id]);
    expect(p.rows[0].status).toBe("released");
    expect((await pool.query(`select * from public.px_expire_reservations()`)).rowCount).toBe(0); // idempotent
  });

  it("never releases a paid parcel", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 0, y: 0, w: 10, h: 10 });
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 day' where order_id = $1`, [o.order_id]);
    await pool.query(`select * from public.px_expire_reservations()`);
    const p = await pool.query(`select status from public.parcels where id = $1`, [o.parcel_id]);
    expect(p.rows[0].status).toBe("active");
  });

  it("px_cancel_order frees the pixels immediately and is owner-scoped", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const o = await startOrder(a, { x: 0, y: 0, w: 10, h: 10 });
    const other = await pool.query(`select public.px_cancel_order($1, $2) as r`, [o.order_id, b]);
    expect(other.rows[0].r).toBe("not_found");
    expect((await pool.query(`select public.px_cancel_order($1, $2) as r`, [o.order_id, a])).rows[0].r).toBe("canceled");
    await startOrder(b, { x: 0, y: 0, w: 10, h: 10 });
  });

  it("px_is_area_free ignores lapsed holds but not live ones", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 0, y: 0, w: 10, h: 10 });
    const free = async () => (await pool.query(`select public.px_is_area_free(5, 5, 10, 10) as f`)).rows[0].f;
    expect(await free()).toBe(false);
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 second' where order_id = $1`, [o.order_id]);
    expect(await free()).toBe(true);
  });
});
