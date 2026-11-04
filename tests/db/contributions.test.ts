import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, closeDb, createUser, expectPgError, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(async () => {
  await resetData();
  await pool.query(`truncate public.campaigns cascade`);
  await pool.query(`update public.app_settings set value = '10000'::jsonb where key = 'campaign_min_area'`);
  await pool.query(`update public.app_settings set value = '200'::jsonb where key = 'campaign_min_contribution_cents'`);
});

const GOAL = 100 * 100 * 50; // a 100 × 100 parcel at 50 cents a pixel: 5 000 €

/** A creator, a moderator, and an OPEN project on a 100 × 100 parcel (goal 500 000 cents). */
async function openCampaign(x = 1000) {
  const creator = await createUser("creator");
  const mod = await createUser("moderator", { role: "moderator" });
  const { rows: [c] } = await pool.query(
    `select * from public.px_create_campaign($1, $2, 1000, 100, 100, null, 'eur', 'land', 14, 'campaigns/x.png', 'abc', 100, 100, 1234, '#112233', 'Big wall', null, null, false)`,
    [creator, x],
  );
  await pool.query(`select public.px_review_campaign($1, $2, 'approve')`, [mod, c.id]);
  return { id: c.id as string, creator, mod, x };
}
const start = async (user: string, campaign: string, amount: number) => {
  const { rows } = await pool.query(`select * from public.px_start_contribution($1, $2, $3)`, [user, campaign, amount]);
  return rows[0] as { contribution_id: string; amount_cents: string; currency: string; expires_at: Date };
};
/** What the verified webhook tells the database: the payment of this contribution succeeded. */
const pay = async (id: string, over: Partial<{ subtotal: number; currency: string; pi: string }> = {}) => {
  const { rows: [k] } = await pool.query(`select amount_cents from public.contributions where id = $1`, [id]);
  const subtotal = over.subtotal ?? Number(k.amount_cents);
  const { rows } = await pool.query(
    `select public.px_fulfill_contribution($1, null, $2, $3, 0, $3, $4, 'buyer@example.test', 'FR') as outcome`,
    [id, over.pi ?? `pi_${id}`, subtotal, over.currency ?? "eur"],
  );
  return rows[0].outcome as string;
};
const campaign = async (id: string) => (await pool.query(`select * from public.campaigns where id = $1`, [id])).rows[0];
const status = async (id: string) => (await pool.query(`select status from public.contributions where id = $1`, [id])).rows[0].status as string;
const sum = async (id: string, ...statuses: string[]) => Number((await pool.query(`select coalesce(sum(amount_cents), 0) s from public.contributions where campaign_id = $1 and status = any($2)`, [id, statuses])).rows[0].s);
const free = async () => (await pool.query(`select public.px_is_area_free(1000, 1000, 100, 100, 'land') as f`)).rows[0].f as boolean;

describe("starting a contribution: what the amount must be", () => {
  it("is held for its payer, in the project's currency, with the same delay as an unpaid purchase", async () => {
    const c = await openCampaign();
    const k = await start(await createUser("friend"), c.id, 25_000);
    expect(Number(k.amount_cents)).toBe(25_000);
    expect(k.currency).toBe("eur");
    const minutes = (new Date(k.expires_at).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(30);
    expect(minutes).toBeLessThan(40);
    expect(await status(k.contribution_id)).toBe("pending");
  });

  it("refuses an amount below the minimum, above what is missing, nonsense, and one that would leave dust", async () => {
    const c = await openCampaign();
    const u = await createUser("amounts");
    await expectPgError(start(u, c.id, 199), "px_amount_too_low");
    await expectPgError(start(u, c.id, 0), "px_invalid_amount");
    await expectPgError(start(u, c.id, -5), "px_invalid_amount");
    await expectPgError(start(u, c.id, GOAL + 1), "px_amount_too_high");
    await expectPgError(start(u, c.id, GOAL - 10), "px_amount_leaves_dust"); // 10 cents would remain: no card can pay that
    await expectPgError(start(u, c.id, GOAL - 49), "px_amount_leaves_dust");
    await start(u, c.id, GOAL - 50); // 50 cents remain: the smallest payment a card accepts
  });

  it("lets the very last bit of the goal be smaller than the minimum, but nothing else", async () => {
    const c = await openCampaign();
    const a = await createUser("big"), b = await createUser("little"), z = await createUser("other");
    const k = await start(a, c.id, GOAL - 150);
    expect(await pay(k.contribution_id)).toBe("fulfilled");
    await expectPgError(start(b, c.id, 100), "px_amount_too_low"); // 100 < 200, and it is not the whole of what remains
    await expectPgError(start(b, c.id, 149), "px_amount_too_low"); // …and a 1-cent leftover would be refused too
    const last = await start(b, c.id, 150); // exactly what remains
    expect(await pay(last.contribution_id)).toBe("funded");
    await expectPgError(start(z, c.id, 200), "px_campaign_closed");
  });

  it("follows the setting of the minimum", async () => {
    const c = await openCampaign();
    const u = await createUser("setting");
    await pool.query(`update public.app_settings set value = '500'::jsonb where key = 'campaign_min_contribution_cents'`);
    await expectPgError(start(u, c.id, 499), "px_amount_too_low");
    await start(u, c.id, 500);
  });

  it("is only possible on an open project, in an open shop, for an active account", async () => {
    const mod = await createUser("mod2", { role: "moderator" });
    const creator = await createUser("c2");
    const { rows: [pending] } = await pool.query(
      `select * from public.px_create_campaign($1, 5000, 5000, 100, 100, null, 'eur', 'land', 7, 'campaigns/y.png', 'h', 100, 100, 10, '#112233', 'Pending one', null, null, false)`, [creator]);
    const u = await createUser("early");
    await expectPgError(start(u, pending.id, 500), "px_campaign_closed"); // not approved yet
    await expectPgError(start(u, "00000000-0000-0000-0000-000000000000", 500), "px_not_found");
    await pool.query(`select public.px_review_campaign($1, $2, 'approve')`, [mod, pending.id]);
    await pool.query(`update public.app_settings set value = 'false'::jsonb where key = 'sales_open'`);
    await expectPgError(start(u, pending.id, 500), "px_sales_closed");
    await pool.query(`update public.app_settings set value = 'true'::jsonb where key = 'sales_open'`);
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [u]);
    await expectPgError(start(u, pending.id, 500), "px_account_suspended");
    await pool.query(`update public.profiles set status = 'active' where id = $1`, [u]);
    await pool.query(`update public.campaigns set deadline = now() - interval '1 second' where id = $1`, [pending.id]);
    await expectPgError(start(u, pending.id, 500), "px_campaign_closed"); // the time is over
  });

  it("allows one payment in progress per person; an old one that ran out does not block", async () => {
    const c = await openCampaign();
    const u = await createUser("one");
    const first = await start(u, c.id, 1000);
    await expectPgError(start(u, c.id, 2000), "px_contribution_in_progress");
    await start(await createUser("two"), c.id, 2000); // somebody else may
    await pool.query(`update public.contributions set expires_at = now() - interval '1 minute' where id = $1`, [first.contribution_id]);
    await start(u, c.id, 2000); // the first one ran out
    expect(await status(first.contribution_id)).toBe("expired");
    // or the person gives up
    const second = await pool.query(`select id from public.contributions where user_id = $1 and status = 'pending'`, [u]);
    expect((await pool.query(`select public.px_cancel_contribution($1, $2) as r`, [second.rows[0].id, u])).rows[0].r).toBe("canceled");
    expect((await pool.query(`select public.px_cancel_contribution($1, $2) as r`, [second.rows[0].id, await createUser("thief")])).rows[0].r).toBe("not_found");
  });
});

describe("the goal is never exceeded", () => {
  it("counts the payments in progress: what is held cannot be promised twice", async () => {
    const c = await openCampaign();
    const [a, b, d] = [await createUser("a"), await createUser("b"), await createUser("d")];
    await start(a, c.id, 300_000);
    await expectPgError(start(b, c.id, 300_000), "px_amount_too_high"); // only 200 000 remain
    const kb = await start(b, c.id, 200_000);
    await expectPgError(start(d, c.id, 200), "px_campaign_full"); // all of it is paid or being paid
    // a payment that is abandoned gives its share back
    await pool.query(`select public.px_cancel_contribution($1, $2)`, [kb.contribution_id, b]);
    await start(d, c.id, 200_000);
  });

  it("holds under pressure: many people asking at once never hold more than the goal", async () => {
    const c = await openCampaign();
    const users = await Promise.all(Array.from({ length: 24 }, (_, i) => createUser(`rush${i}`)));
    const results = await Promise.allSettled(users.map((u) => start(u, c.id, 100_000)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(5); // 5 × 100 000 = the goal: no more, no less
    for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/px_campaign_full|px_amount_too_high/);
    expect(await sum(c.id, "pending")).toBe(GOAL);
  });

  it("holds when they all pay at once: exactly one payment completes the goal, the parcel is attributed once", async () => {
    const c = await openCampaign();
    const users = await Promise.all(Array.from({ length: 5 }, (_, i) => createUser(`payer${i}`)));
    const ks = await Promise.all(users.map((u) => start(u, c.id, 100_000)));
    const outcomes = await Promise.all(ks.map((k) => pay(k.contribution_id)));
    expect(outcomes.filter((o) => o === "funded")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "fulfilled")).toHaveLength(4);
    expect(await sum(c.id, "paid")).toBe(GOAL);
    expect((await campaign(c.id)).status).toBe("funded");
    expect((await pool.query(`select count(*)::int n from public.parcels where status = 'active'`)).rows[0].n).toBe(1);
  });

  it("refuses a late payment that no longer has its place, and takes one that still does", async () => {
    const c = await openCampaign();
    const [a, b, d] = [await createUser("slow"), await createUser("quick"), await createUser("third")];
    const slow = await start(a, c.id, 300_000);
    // the hold of the slow one ran out; somebody else took the room
    await pool.query(`update public.contributions set expires_at = now() - interval '1 minute' where id = $1`, [slow.contribution_id]);
    const quick = await start(b, c.id, 300_000);
    expect(await status(slow.contribution_id)).toBe("expired");
    expect(await pay(quick.contribution_id)).toBe("fulfilled");
    // 200 000 remain: the slow payment (300 000) cannot be placed any more
    expect(await pay(slow.contribution_id)).toBe("refund_required");
    expect(await status(slow.contribution_id)).toBe("refund_required");
    // …whereas a late payment that still fits is accepted
    const small = await start(d, c.id, 10_000);
    await pool.query(`update public.contributions set expires_at = now() - interval '1 minute' where id = $1`, [small.contribution_id]);
    await start(await createUser("fourth"), c.id, 5_000); // marks the stale one as expired
    expect(await status(small.contribution_id)).toBe("expired");
    expect(await pay(small.contribution_id)).toBe("fulfilled");
    expect(await sum(c.id, "paid")).toBe(310_000);
  });
});

describe("a payment is checked against what the server decided", () => {
  it("a wrong amount or currency is not attributed: it is to be refunded, and counts for nothing", async () => {
    const c = await openCampaign();
    const u = await createUser("cheat");
    const k = await start(u, c.id, 50_000);
    expect(await pay(k.contribution_id, { subtotal: 100 })).toBe("refund_required");
    expect(await sum(c.id, "paid")).toBe(0);
    const k2 = await start(await createUser("usd"), c.id, 50_000);
    expect(await pay(k2.contribution_id, { currency: "usd" })).toBe("refund_required");
    expect((await pool.query(`select action from public.audit_logs where target_id = $1`, [k2.contribution_id])).rows.map((r) => r.action)).toContain("contribution.refund_required");
  });

  it("is idempotent: a replayed event changes nothing", async () => {
    const c = await openCampaign();
    const k = await start(await createUser("replay"), c.id, 50_000);
    expect(await pay(k.contribution_id)).toBe("fulfilled");
    expect(await pay(k.contribution_id)).toBe("already_paid");
    expect(await sum(c.id, "paid")).toBe(50_000);
    await expectPgError(pool.query(`select public.px_fulfill_contribution('00000000-0000-0000-0000-000000000000', null, 'pi_x', 1, 0, 1, 'eur', null, null)`), "px_contribution_not_found");
  });

  it("refuses a payment whose session is not the one that was attached", async () => {
    const c = await openCampaign();
    const k = await start(await createUser("sess"), c.id, 50_000);
    await pool.query(`select public.px_attach_contribution_session($1, 'cs_real')`, [k.contribution_id]);
    await expectPgError(pool.query(`select public.px_fulfill_contribution($1, 'cs_other', 'pi_x', 50000, 0, 50000, 'eur', null, null)`, [k.contribution_id]), "px_session_mismatch");
  });
});

describe("the goal is reached: the parcel is bought", () => {
  it("the parcel becomes the creator's, with the creation moderators approved, published; the hold is converted; the counters see it", async () => {
    const c = await openCampaign();
    const ks = [];
    for (const amount of [200_000, 200_000, 100_000]) ks.push(await start(await createUser("p"), c.id, amount));
    expect(await pay(ks[0]!.contribution_id)).toBe("fulfilled");
    expect(await pay(ks[1]!.contribution_id)).toBe("fulfilled");
    expect((await campaign(c.id)).status).toBe("open");
    expect(await pay(ks[2]!.contribution_id)).toBe("funded");

    const camp = await campaign(c.id);
    expect(camp.status).toBe("funded");
    expect(camp.funded_at).toBeTruthy();
    const { rows: [p] } = await pool.query(`select status, owner_id, published_asset_id, activated_at, w, h from public.parcels where id = $1`, [camp.parcel_id]);
    expect(p).toMatchObject({ status: "active", owner_id: c.creator, w: 100, h: 100 });
    expect(p.activated_at).toBeTruthy();
    const { rows: [a] } = await pool.query(`select id, status, published_at from public.parcel_assets where parcel_id = $1`, [camp.parcel_id]);
    expect(a.status).toBe("approved");
    expect(a.published_at).toBeTruthy();
    expect(p.published_asset_id).toBe(a.id); // published at once: the moderators saw it when they opened the project
    expect((await pool.query(`select status from public.parcel_reservations where parcel_id = $1`, [camp.parcel_id])).rows[0].status).toBe("converted");
    expect((await pool.query(`select sold_pixels from public.px_public_stats()`)).rows[0].sold_pixels).toBe("10000");
    expect(await free()).toBe(false); // sold: nobody else can have it
    // nothing more can be contributed, nothing left over: paid is exactly the goal
    await expectPgError(start(await createUser("late"), c.id, 500), "px_campaign_closed");
    expect(await sum(c.id, "paid")).toBe(GOAL);
    // and the project is not closed unfunded afterwards by the maintenance job
    await pool.query(`update public.campaigns set deadline = now() - interval '1 day' where id = $1`, [c.id]);
    expect((await pool.query(`select public.px_expire_campaigns(10) as n`)).rows[0].n).toBe(0);
    expect((await campaign(c.id)).status).toBe("funded");
  });
});

describe("a project that ends unfunded: everybody is refunded", () => {
  async function withPayments() {
    const c = await openCampaign();
    const paid = [await start(await createUser("p1"), c.id, 50_000), await start(await createUser("p2"), c.id, 30_000)];
    for (const k of paid) await pay(k.contribution_id);
    const waiting = await start(await createUser("p3"), c.id, 20_000); // still being paid
    return { c, paid, waiting };
  }

  it("the deadline: paid contributions are due back, the payment in progress is over, the zone is free", async () => {
    const { c, paid, waiting } = await withPayments();
    await pool.query(`update public.campaigns set deadline = now() - interval '1 minute' where id = $1`, [c.id]);
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 minute' where parcel_id = (select parcel_id from public.campaigns where id = $1)`, [c.id]);
    expect((await pool.query(`select public.px_expire_campaigns(10) as n`)).rows[0].n).toBe(1);
    expect((await campaign(c.id)).status).toBe("expired");
    for (const k of paid) expect(await status(k.contribution_id)).toBe("refund_required");
    expect(await status(waiting.contribution_id)).toBe("expired");
    expect(await free()).toBe(true);
    // the payer who was still paying and finishes after the end is refunded too
    expect(await pay(waiting.contribution_id)).toBe("refund_required");
    expect(await sum(c.id, "paid")).toBe(0);
    expect((await pool.query(`select action from public.audit_logs where target_type = 'campaign' and target_id = $1`, [c.id])).rows.map((r) => r.action)).toContain("campaign.expired");
  });

  it("the creator withdraws an open project that has money: same thing, at once", async () => {
    const { c, paid } = await withPayments();
    await pool.query(`select public.px_cancel_campaign($1, $2)`, [c.creator, c.id]);
    expect((await campaign(c.id)).status).toBe("cancelled");
    for (const k of paid) expect(await status(k.contribution_id)).toBe("refund_required");
    expect(await free()).toBe(true);
    expect((await pool.query(`select count(*)::int n from public.contributions where status = 'refund_required'`)).rows[0].n).toBe(2);
  });

  it("the refund confirmed by Stripe closes the contribution: a full refund is refunded, a partial one is only recorded", async () => {
    const { c, paid } = await withPayments();
    await pool.query(`select public.px_cancel_campaign($1, $2)`, [c.creator, c.id]);
    const refund = async (pi: string, amount: number) => (await pool.query(`select public.px_record_contribution_refund($1, $2) as r`, [pi, amount])).rows[0].r;
    expect(await refund(`pi_${paid[0]!.contribution_id}`, 10_000)).toBe("partially_refunded");
    expect(await status(paid[0]!.contribution_id)).toBe("refund_required");
    expect(await refund(`pi_${paid[0]!.contribution_id}`, 50_000)).toBe("refunded");
    expect(await status(paid[0]!.contribution_id)).toBe("refunded");
    expect(await refund(`pi_${paid[1]!.contribution_id}`, 30_000)).toBe("refunded");
    expect(await refund("pi_nobody", 1)).toBe("unknown_payment"); // the order's own refunds go elsewhere
  });

  it("a refund after the parcel was bought does not take the parcel away (a human decides), and is journalled as such", async () => {
    const c = await openCampaign();
    const ks = [await start(await createUser("q1"), c.id, 250_000), await start(await createUser("q2"), c.id, 250_000)];
    for (const k of ks) await pay(k.contribution_id);
    expect((await campaign(c.id)).status).toBe("funded");
    await pool.query(`select public.px_record_contribution_refund($1, 250000)`, [`pi_${ks[0]!.contribution_id}`]);
    expect((await pool.query(`select status from public.parcels where id = $1`, [(await campaign(c.id)).parcel_id])).rows[0].status).toBe("active");
    const { rows } = await pool.query(`select metadata from public.audit_logs where action = 'contribution.refunded' and target_id = $1`, [ks[0]!.contribution_id]);
    expect(rows[0].metadata.after_funding).toBe(true);
  });

  it("a dispute keeps the money counted until it is lost; a lost one frees its share", async () => {
    const c = await openCampaign();
    const k = await start(await createUser("d1"), c.id, 100_000);
    await pay(k.contribution_id);
    const dispute = async (o: string) => (await pool.query(`select public.px_record_contribution_dispute($1, $2) as r`, [`pi_${k.contribution_id}`, o])).rows[0].r;
    await dispute("opened");
    expect(await status(k.contribution_id)).toBe("disputed");
    expect(await sum(c.id, "paid", "disputed")).toBe(100_000);
    await dispute("won");
    expect(await status(k.contribution_id)).toBe("paid");
    await dispute("opened");
    await dispute("lost");
    expect(await status(k.contribution_id)).toBe("dispute_lost");
    const next = await start(await createUser("d2"), c.id, GOAL); // the share is missing again
    expect(Number(next.amount_cents)).toBe(GOAL);
    await expectPgError(pool.query(`select public.px_record_contribution_dispute($1, 'weird')`, [`pi_${k.contribution_id}`]), "px_bad_dispute_outcome");
  });
});

describe("privacy and permissions", () => {
  it("contributions are invisible to the browser's keys, for reading and writing", async () => {
    const c = await openCampaign();
    const u = await createUser("shy2");
    await start(u, c.id, 500);
    for (const role of ["anon", "authenticated"] as const) {
      await expectPgError(asRole(role, u, (cl) => cl.query(`select * from public.contributions`)), /permission denied/);
      await expectPgError(asRole(role, u, (cl) => cl.query(`update public.contributions set amount_cents = 1`)), /permission denied/);
      await expectPgError(asRole(role, u, (cl) => cl.query(`select public.px_start_contribution($1, $2, 500)`, [u, c.id])), /permission denied/);
    }
  });

  it("a held zone is still taken: a purchase on it fails while the project is open", async () => {
    const c = await openCampaign();
    await expectPgError(startOrder(await createUser("buyer"), { x: c.x + 10, y: 1010, w: 30, h: 30 }), "px_parcel_unavailable");
  });
});
