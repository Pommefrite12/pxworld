import type Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, createUser, databaseUrl, fulfill, pool, resetData, startOrder } from "./helpers";

const SECRET = "whsec_test_unit_only";
let webhook: (req: Request) => Promise<Response>;
let stripeClient: Stripe;
let reconcileOrder: typeof import("@/lib/stripe/reconcile").reconcileOrder;
let runMaintenance: typeof import("@/lib/stripe/reconcile").runMaintenance;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_placeholder"; // never used on the network: every API call is mocked below
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  delete (globalThis as { __pxPool?: unknown }).__pxPool;
  webhook = (await import("@/app/api/stripe/webhook/route")).POST;
  stripeClient = (await import("@/lib/stripe/client")).stripe();
  ({ reconcileOrder, runMaintenance } = await import("@/lib/stripe/reconcile"));
});
afterAll(async () => {
  const g = globalThis as unknown as { __pxPool?: { end(): Promise<void> } };
  await g.__pxPool?.end();
  await closeDb();
});
beforeEach(async () => {
  await resetData();
  vi.restoreAllMocks();
});

let n = 0;
function signed(type: string, object: Record<string, unknown>, id = `evt_test_${++n}_${Math.random().toString(36).slice(2, 8)}`, secret = SECRET) {
  const payload = JSON.stringify({ id, object: "event", type, api_version: "2026-09-30.endive", created: Math.floor(Date.now() / 1000), data: { object }, livemode: false });
  const header = stripeClient.webhooks.generateTestHeaderString({ payload, secret });
  return { id, req: () => new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } }) };
}

async function newOrder(rect = { x: 100, y: 100, w: 20, h: 20 }) {
  const u = await createUser();
  const o = await startOrder(u, rect);
  await pool.query("select public.px_attach_checkout_session($1, $2)", [o.order_id, `cs_test_${o.order_id}`]);
  return { u, o, sessionId: `cs_test_${o.order_id}` };
}

const completed = (o: { order_id: string; amount_cents: string }, sessionId: string, over: Record<string, unknown> = {}) => ({
  id: sessionId, object: "checkout.session", status: "complete", payment_status: "paid", client_reference_id: o.order_id,
  metadata: { order_id: o.order_id }, payment_intent: `pi_${o.order_id}`, amount_subtotal: Number(o.amount_cents), amount_total: Number(o.amount_cents) + 0,
  total_details: { amount_tax: 0 }, currency: "eur", customer_details: { email: "buyer@example.test", name: "Buyer", address: { country: "FR" }, tax_ids: [] }, ...over,
});

const orderStatus = async (id: string) => (await pool.query("select status from public.orders where id = $1", [id])).rows[0].status;
const parcelStatus = async (id: string) => (await pool.query("select status from public.parcels where id = $1", [id])).rows[0].status;

describe("webhook endpoint: authenticity", () => {
  it("rejects missing and forged signatures, and changes nothing", async () => {
    const { o, sessionId } = await newOrder();
    const body = JSON.stringify({ id: "evt_x", type: "checkout.session.completed", data: { object: completed(o, sessionId) } });
    expect((await webhook(new Request("http://x/api", { method: "POST", body }))).status).toBe(400);
    expect((await webhook(new Request("http://x/api", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=deadbeef" } }))).status).toBe(400);
    const forged = signed("checkout.session.completed", completed(o, sessionId), undefined, "whsec_attacker");
    expect((await webhook(forged.req())).status).toBe(400);
    expect(await parcelStatus(o.parcel_id)).toBe("reserved");
    expect((await pool.query("select count(*)::int n from public.stripe_events")).rows[0].n).toBe(0);
  });
});

describe("webhook endpoint: payments", () => {
  it("a verified checkout.session.completed attributes the parcel and records billing data", async () => {
    const { o, sessionId } = await newOrder();
    const ev = signed("checkout.session.completed", completed(o, sessionId, { total_details: { amount_tax: 8000 }, amount_total: 48000 }));
    const res = await webhook(ev.req());
    expect(res.status).toBe(200);
    expect(await orderStatus(o.order_id)).toBe("paid");
    expect(await parcelStatus(o.parcel_id)).toBe("active");
    const row = (await pool.query("select amount_subtotal_cents, amount_tax_cents, amount_total_cents, customer_email, billing_country from public.orders where id = $1", [o.order_id])).rows[0];
    expect(row).toEqual({ amount_subtotal_cents: 40000, amount_tax_cents: 8000, amount_total_cents: 48000, customer_email: "buyer@example.test", billing_country: "FR" });
    expect((await pool.query("select status from public.stripe_events where id = $1", [ev.id])).rows[0].status).toBe("processed");
  });

  it("is idempotent: replays of the same event are no-ops", async () => {
    const { o, sessionId } = await newOrder();
    const ev = signed("checkout.session.completed", completed(o, sessionId));
    expect((await (await webhook(ev.req())).json()).outcome).toBe("processed");
    expect((await (await webhook(ev.req())).json()).outcome).toBe("duplicate");
    expect((await pool.query("select count(*)::int n from public.payments")).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int n from public.audit_logs where action = 'order.paid'")).rows[0].n).toBe(1);
  });

  it("is idempotent under concurrent duplicate deliveries", async () => {
    const { o, sessionId } = await newOrder();
    const ev = signed("checkout.session.completed", completed(o, sessionId));
    const results = await Promise.all(Array.from({ length: 8 }, () => webhook(ev.req())));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await pool.query("select count(*)::int n from public.audit_logs where action = 'order.paid'")).rows[0].n).toBe(1);
    expect(await parcelStatus(o.parcel_id)).toBe("active");
  });

  it("a second, different event for the same session does not double-attribute", async () => {
    const { o, sessionId } = await newOrder();
    await webhook(signed("checkout.session.completed", completed(o, sessionId)).req());
    await webhook(signed("checkout.session.async_payment_succeeded", completed(o, sessionId)).req());
    expect((await pool.query("select count(*)::int n from public.payments")).rows[0].n).toBe(1);
    expect(await orderStatus(o.order_id)).toBe("paid");
  });

  it("the browser return is not proof: an unpaid session never attributes, and an async payment keeps the pixels held", async () => {
    const { o, sessionId } = await newOrder();
    await pool.query("update public.parcel_reservations set expires_at = now() + interval '1 minute' where order_id = $1", [o.order_id]);
    await webhook(signed("checkout.session.completed", completed(o, sessionId, { payment_status: "unpaid" })).req());
    expect(await orderStatus(o.order_id)).toBe("pending");
    expect(await parcelStatus(o.parcel_id)).toBe("reserved");
    const r = (await pool.query("select expires_at > now() + interval '1 day' as extended from public.parcel_reservations where order_id = $1", [o.order_id])).rows[0];
    expect(r.extended).toBe(true);
    await webhook(signed("checkout.session.async_payment_succeeded", completed(o, sessionId)).req());
    expect(await orderStatus(o.order_id)).toBe("paid");
  });

  it("charges that do not match the server price are not attributed and are refunded automatically", async () => {
    const refund = vi.spyOn(stripeClient.refunds, "create").mockResolvedValue({ id: "re_test" } as never);
    const { o, sessionId } = await newOrder();
    await webhook(signed("checkout.session.completed", completed(o, sessionId, { amount_subtotal: 100, amount_total: 100 })).req());
    expect(await orderStatus(o.order_id)).toBe("refund_required");
    expect(await parcelStatus(o.parcel_id)).toBe("released");
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund.mock.calls[0]![0]).toMatchObject({ payment_intent: `pi_${o.order_id}` });
    expect(refund.mock.calls[0]![1]).toMatchObject({ idempotencyKey: `auto_refund_${o.order_id}` });
  });

  it("late payment on pixels sold to someone else is refunded, never double-booked", async () => {
    const refund = vi.spyOn(stripeClient.refunds, "create").mockResolvedValue({ id: "re_test" } as never);
    const { o, sessionId } = await newOrder();
    await pool.query("update public.parcel_reservations set expires_at = now() - interval '1 hour' where order_id = $1", [o.order_id]);
    const other = await startOrder(await createUser(), { x: 105, y: 105, w: 20, h: 20 });
    await fulfill(other.order_id);
    await webhook(signed("checkout.session.completed", completed(o, sessionId)).req());
    expect(await orderStatus(o.order_id)).toBe("refund_required");
    expect(await parcelStatus(other.parcel_id)).toBe("active");
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("failed processing answers 5xx (Stripe retries) and is retried successfully", async () => {
    const { o, sessionId } = await newOrder();
    const bad = signed("checkout.session.completed", completed(o, sessionId, { metadata: { order_id: "00000000-0000-0000-0000-000000000000" }, client_reference_id: "00000000-0000-0000-0000-000000000000" }), "evt_retry");
    expect((await webhook(bad.req())).status).toBe(500);
    expect((await pool.query("select status, attempts from public.stripe_events where id = 'evt_retry'")).rows[0]).toEqual({ status: "failed", attempts: 1 });
    const good = signed("checkout.session.completed", completed(o, sessionId), "evt_retry"); // Stripe resends the same event id
    expect((await webhook(good.req())).status).toBe(200);
    expect((await pool.query("select status, attempts from public.stripe_events where id = 'evt_retry'")).rows[0]).toEqual({ status: "processed", attempts: 2 });
    expect(await orderStatus(o.order_id)).toBe("paid");
  });
});

describe("webhook endpoint: abandoned, failed, refunded, disputed", () => {
  it("checkout.session.expired releases the pixels", async () => {
    const { o, sessionId } = await newOrder();
    await webhook(signed("checkout.session.expired", { id: sessionId, metadata: { order_id: o.order_id }, client_reference_id: o.order_id }).req());
    expect(await orderStatus(o.order_id)).toBe("expired");
    expect(await parcelStatus(o.parcel_id)).toBe("released");
  });

  it("payment_intent.payment_failed is recorded and the order stays payable", async () => {
    const { o } = await newOrder();
    await webhook(signed("payment_intent.payment_failed", {
      id: "pi_failed_1", amount: 40000, currency: "eur", metadata: { order_id: o.order_id },
      last_payment_error: { code: "card_declined", message: "Your card was declined." },
    }).req());
    expect((await pool.query("select status, failure_code from public.payments where stripe_payment_intent_id = 'pi_failed_1'")).rows[0]).toEqual({ status: "failed", failure_code: "card_declined" });
    expect(await orderStatus(o.order_id)).toBe("pending");
  });

  it("charge.refunded returns the pixels to the market", async () => {
    const { o, sessionId } = await newOrder();
    await webhook(signed("checkout.session.completed", completed(o, sessionId)).req());
    await webhook(signed("charge.refunded", { id: "ch_1", payment_intent: `pi_${o.order_id}`, amount_refunded: 40000 }).req());
    expect(await orderStatus(o.order_id)).toBe("refunded");
    expect(await parcelStatus(o.parcel_id)).toBe("revoked");
  });

  it("disputes: opened hides the content, lost revokes the parcel", async () => {
    const { o, sessionId } = await newOrder();
    await webhook(signed("checkout.session.completed", completed(o, sessionId)).req());
    await webhook(signed("charge.dispute.created", { id: "dp_1", payment_intent: `pi_${o.order_id}`, status: "needs_response" }).req());
    expect(await orderStatus(o.order_id)).toBe("disputed");
    expect((await pool.query("select hidden_at is not null as hidden from public.parcels where id = $1", [o.parcel_id])).rows[0].hidden).toBe(true);
    await webhook(signed("charge.dispute.closed", { id: "dp_1", payment_intent: `pi_${o.order_id}`, status: "lost" }).req());
    expect(await parcelStatus(o.parcel_id)).toBe("revoked");
  });

  it("unrelated event types are acknowledged and ignored", async () => {
    const res = await webhook(signed("customer.created", { id: "cus_1" }).req());
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("ignored");
  });
});

describe("recovery when the webhook is delayed or lost", () => {
  it("reconcileOrder asks Stripe's API and attributes a paid session", async () => {
    const { o, sessionId } = await newOrder();
    vi.spyOn(stripeClient.checkout.sessions, "retrieve").mockResolvedValue(completed(o, sessionId) as never);
    expect(await reconcileOrder(o.order_id)).toBe("paid");
    expect(await orderStatus(o.order_id)).toBe("paid");
    expect(await parcelStatus(o.parcel_id)).toBe("active");
  });

  it("reconcileOrder leaves an open session alone and expires a dead one", async () => {
    const { o, sessionId } = await newOrder();
    const retrieve = vi.spyOn(stripeClient.checkout.sessions, "retrieve");
    retrieve.mockResolvedValueOnce({ id: sessionId, status: "open", payment_status: "unpaid" } as never);
    expect(await reconcileOrder(o.order_id)).toBe("pending");
    retrieve.mockResolvedValueOnce({ id: sessionId, status: "expired", payment_status: "unpaid" } as never);
    expect(await reconcileOrder(o.order_id)).toBe("expired");
    expect(await parcelStatus(o.parcel_id)).toBe("released");
  });

  it("the maintenance job expires holds, closes their sessions and recovers unseen payments", async () => {
    const lapsed = await newOrder({ x: 0, y: 0, w: 10, h: 10 });
    const paidUnseen = await newOrder({ x: 500, y: 0, w: 10, h: 10 });
    await pool.query("update public.parcel_reservations set expires_at = now() - interval '1 minute' where order_id = $1", [lapsed.o.order_id]);
    await pool.query("update public.orders set created_at = now() - interval '20 minutes' where id = $1", [paidUnseen.o.order_id]);
    const expire = vi.spyOn(stripeClient.checkout.sessions, "expire").mockResolvedValue({} as never);
    vi.spyOn(stripeClient.checkout.sessions, "retrieve").mockResolvedValue(completed(paidUnseen.o, paidUnseen.sessionId) as never);
    const report = await runMaintenance();
    expect(report).toMatchObject({ expiredReservations: 1, recoveredPayments: 1 });
    expect(expire).toHaveBeenCalledWith(lapsed.sessionId);
    expect(await orderStatus(paidUnseen.o.order_id)).toBe("paid");
  });
});
