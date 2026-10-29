import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, fulfill, overlappingPairs, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const orderRow = async (id: string) => (await pool.query(`select * from public.orders where id = $1`, [id])).rows[0];
const parcelStatus = async (id: string) => (await pool.query(`select status from public.parcels where id = $1`, [id])).rows[0].status;

describe("px_fulfill_order", () => {
  it("attributes the parcel exactly once (idempotent replays)", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    expect(await parcelStatus(o.parcel_id)).toBe("active");
    expect(await fulfill(o.order_id)).toBe("already_paid");
    expect(await fulfill(o.order_id)).toBe("already_paid");
    const row = await orderRow(o.order_id);
    expect(row.status).toBe("paid");
    expect(row.paid_at).not.toBeNull();
    expect((await pool.query(`select count(*)::int n from public.payments where order_id = $1`, [o.order_id])).rows[0].n).toBe(1);
    expect((await pool.query(`select count(*)::int n from public.audit_logs where action = 'order.paid'`)).rows[0].n).toBe(1);
  });

  it("concurrent duplicate webhook deliveries attribute once", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    const out = await Promise.all(Array.from({ length: 10 }, () => fulfill(o.order_id)));
    expect(out.filter((r) => r === "fulfilled")).toHaveLength(1);
    expect(out.filter((r) => r === "already_paid")).toHaveLength(9);
  });

  it("does not attribute when the charged amount differs from the server price", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    expect(await fulfill(o.order_id, { subtotal: 100 })).toBe("refund_required");
    expect((await orderRow(o.order_id)).status).toBe("refund_required");
    expect(await parcelStatus(o.parcel_id)).toBe("released");
  });

  it("does not attribute on a currency mismatch", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    expect(await fulfill(o.order_id, { currency: "usd" })).toBe("refund_required");
  });

  it("rejects a checkout session that does not belong to the order", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    await pool.query(`select public.px_attach_checkout_session($1, 'cs_real')`, [o.order_id]);
    await expectPgError(
      pool.query(`select public.px_fulfill_order($1, 'cs_other', 'pi_x', null, 40000, 0, 40000, 'eur', null, null, null, null)`, [o.order_id]),
      "px_session_mismatch",
    );
  });

  it("late payment on a lapsed hold: attributes when the pixels are still free", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 hour' where order_id = $1`, [o.order_id]);
    await pool.query(`select * from public.px_expire_reservations()`);
    expect(await parcelStatus(o.parcel_id)).toBe("released");
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    expect(await parcelStatus(o.parcel_id)).toBe("active");
  });

  it("late payment on a lapsed hold: refund is required when someone else took the pixels", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const o = await startOrder(a, { x: 10, y: 10, w: 20, h: 20 });
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 hour' where order_id = $1`, [o.order_id]);
    const other = await startOrder(b, { x: 15, y: 15, w: 20, h: 20 });
    expect(await fulfill(o.order_id)).toBe("refund_required");
    expect((await orderRow(o.order_id)).status).toBe("refund_required");
    expect(await parcelStatus(o.parcel_id)).toBe("released");
    expect(await parcelStatus(other.parcel_id)).toBe("reserved"); // untouched
    expect(await overlappingPairs()).toBe(0);
  });

  it("a paid area can never be bought again", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const o = await startOrder(a, { x: 10, y: 10, w: 20, h: 20 });
    await fulfill(o.order_id);
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 day'`);
    await expectPgError(startOrder(b, { x: 10, y: 10, w: 20, h: 20 }), "px_parcel_unavailable");
  });
});

describe("failures, refunds and disputes", () => {
  it("records a failed attempt without touching the order, and never downgrades a success", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    await pool.query(`select public.px_record_payment_failure('pi_1', $1, 40000, 'eur', 'card_declined', 'Your card was declined')`, [o.order_id]);
    expect((await orderRow(o.order_id)).status).toBe("pending");
    expect(await fulfill(o.order_id, { pi: "pi_1" })).toBe("fulfilled");
    await pool.query(`select public.px_record_payment_failure('pi_1', $1, 40000, 'eur', 'late_event', 'x')`, [o.order_id]);
    const p = await pool.query(`select status from public.payments where stripe_payment_intent_id = 'pi_1'`);
    expect(p.rows[0].status).toBe("succeeded");
  });

  it("a full refund revokes the parcel and returns the pixels to the market", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const o = await startOrder(a, { x: 10, y: 10, w: 20, h: 20 });
    await fulfill(o.order_id, { pi: "pi_r" });
    expect((await pool.query(`select public.px_record_refund('pi_r', 40000) as r`)).rows[0].r).toBe("refunded");
    expect((await orderRow(o.order_id)).status).toBe("refunded");
    expect(await parcelStatus(o.parcel_id)).toBe("revoked");
    await startOrder(b, { x: 10, y: 10, w: 20, h: 20 });
  });

  it("a partial refund keeps the parcel and is flagged", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    await fulfill(o.order_id, { pi: "pi_p" });
    expect((await pool.query(`select public.px_record_refund('pi_p', 1000) as r`)).rows[0].r).toBe("partially_refunded");
    expect(await parcelStatus(o.parcel_id)).toBe("active");
    const p = await pool.query(`select status, amount_refunded_cents from public.payments where stripe_payment_intent_id = 'pi_p'`);
    expect(p.rows[0]).toEqual({ status: "partially_refunded", amount_refunded_cents: "1000" });
  });

  it("refunding a refund_required order closes it as refunded (and never activates a parcel)", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    await fulfill(o.order_id, { subtotal: 5, pi: "pi_m" });
    expect((await orderRow(o.order_id)).status).toBe("refund_required");
    await pool.query(`select public.px_record_refund('pi_m', 5)`);
    expect((await orderRow(o.order_id)).status).toBe("refunded");
    expect(await parcelStatus(o.parcel_id)).toBe("released");
  });

  it("dispute opened hides the content but keeps ownership; won restores; lost revokes", async () => {
    const u = await createUser();
    const o = await startOrder(u, { x: 10, y: 10, w: 20, h: 20 });
    await fulfill(o.order_id, { pi: "pi_d" });
    await pool.query(`select public.px_record_dispute('pi_d', 'opened')`);
    let p = (await pool.query(`select status, hidden_at, hidden_reason from public.parcels where id = $1`, [o.parcel_id])).rows[0];
    expect(p.status).toBe("active");
    expect(p.hidden_reason).toBe("dispute");
    expect((await orderRow(o.order_id)).status).toBe("disputed");

    await pool.query(`select public.px_record_dispute('pi_d', 'won')`);
    p = (await pool.query(`select status, hidden_at from public.parcels where id = $1`, [o.parcel_id])).rows[0];
    expect(p.hidden_at).toBeNull();
    expect((await orderRow(o.order_id)).status).toBe("paid");

    await pool.query(`select public.px_record_dispute('pi_d', 'opened')`);
    await pool.query(`select public.px_record_dispute('pi_d', 'lost')`);
    expect(await parcelStatus(o.parcel_id)).toBe("revoked");
    expect((await orderRow(o.order_id)).status).toBe("dispute_lost");
  });

  it("unknown payment intents are ignored safely", async () => {
    expect((await pool.query(`select public.px_record_refund('pi_nope', 1) as r`)).rows[0].r).toBe("unknown_payment");
    expect((await pool.query(`select public.px_record_dispute('pi_nope', 'opened') as r`)).rows[0].r).toBe("unknown_payment");
  });
});

describe("public statistics", () => {
  it("count only real, active parcels", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const empty = (await pool.query(`select * from public.px_public_stats()`)).rows[0];
    expect(empty).toMatchObject({ sold_pixels: "0", parcels: "0", owners: "0", published_creations: "0" });

    const o1 = await startOrder(a, { x: 0, y: 0, w: 10, h: 10 });
    await startOrder(b, { x: 100, y: 0, w: 20, h: 20 }); // reserved only: not counted
    const mid = (await pool.query(`select * from public.px_public_stats()`)).rows[0];
    expect(mid.sold_pixels).toBe("0");

    await fulfill(o1.order_id);
    const after = (await pool.query(`select * from public.px_public_stats()`)).rows[0];
    expect(after).toMatchObject({ sold_pixels: "100", parcels: "1", owners: "1" });
  });
});
