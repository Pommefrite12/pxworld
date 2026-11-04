import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(async () => {
  await resetData();
  await pool.query(`truncate public.campaigns cascade`);
  await pool.query(`update public.app_settings set value = '10000'::jsonb where key = 'campaign_min_area'`);
});

type Over = Partial<{ x: number; y: number; w: number; h: number; land: number | null; currency: string | null; kind: string; days: number; k: number; title: string; sales: boolean }>;

/** px_create_campaign with sensible defaults: a 100 × 100 land parcel, 14 days, an image at 1 dot per pixel. */
async function create(user: string, o: Over = {}) {
  const { x = 1000, y = 1000, w = 100, h = 100, land = null, currency = "eur", kind = "land", days = 14, k = 1, title = "Our big wall" } = o;
  const { rows } = await pool.query(
    `select * from public.px_create_campaign($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [user, x, y, w, h, land, currency, kind, days, `campaigns/${user}.png`, "abc123", w * k, h * k, 1234, "#112233", title, "A wall for everybody", null, false],
  );
  return rows[0] as { id: string; code: string; goal_cents: string; currency: string };
}
const review = (actor: string, id: string, decision: "approve" | "reject", reason: string | null = null) => pool.query(`select public.px_review_campaign($1, $2, $3, $4)`, [actor, id, decision, reason]);
const row = async (id: string) => (await pool.query(`select * from public.campaigns where id = $1`, [id])).rows[0];
const free = async (r = { x: 1000, y: 1000, w: 100, h: 100 }, kind = "land") => (await pool.query(`select public.px_is_area_free($1, $2, $3, $4, $5) as f`, [r.x, r.y, r.w, r.h, kind])).rows[0].f as boolean;

describe("creating a campaign: a parcel several people will pay for", () => {
  it("is priced by the database (the same price as a purchase), recorded as pending, and holds nothing", async () => {
    const u = await createUser("maker");
    const c = await create(u);
    expect(Number(c.goal_cents)).toBe(100 * 100 * 50); // 10 000 px at 50 cents
    expect(c.currency).toBe("eur");
    expect(c.code).toMatch(/^[0-9a-f]{10}$/);
    const r = await row(c.id);
    expect(r).toMatchObject({ status: "pending", creator_id: u, parcel_id: null, duration_days: 14, area: 10000 });
    expect(await free()).toBe(true); // nothing is held while moderators have not looked
    expect((await pool.query(`select count(*)::int n from public.parcels`)).rows[0].n).toBe(0);
  });

  it("is priced in dollars for a dollar project, and by the water rules for water", async () => {
    const u = await createUser("usd");
    await pool.query(`update public.app_settings set value = '30'::jsonb where key = 'price_unit_cents_usd'`);
    const usd = await create(u, { currency: "usd" });
    expect(usd.currency).toBe("usd");
    expect(Number(usd.goal_cents)).toBe(10000 * 30);
    await pool.query(`update public.campaigns set status = 'cancelled' where id = $1`, [usd.id]);
    await pool.query(`update public.app_settings set value = '40'::jsonb where key = 'water_price_percent'`);
    const water = await create(u, { kind: "water", land: 2000, x: 5000, y: 5000 }); // 8 000 water pixels, 2 000 land cut away (free)
    expect(Number(water.goal_cents)).toBe(Math.floor((8000 * 50 * 40) / 100));
    await pool.query(`update public.campaigns set status = 'cancelled' where id = $1`, [water.id]);
    await expectPgError(create(u, { kind: "water", land: 9000, x: 5000, y: 5000 }), "px_not_on_water"); // mostly land
    await expectPgError(create(u, { land: 1000 }), "px_not_on_land"); // a land parcel that is mostly sea
  });

  it("refuses a parcel that is too small for a campaign, a wrong duration, a wrong image size, a closed shop", async () => {
    const u = await createUser("rules");
    await expectPgError(create(u, { w: 99, h: 100 }), "px_campaign_too_small");
    await expectPgError(create(u, { days: 10 }), "px_invalid_campaign");
    await expectPgError(create(u, { days: 0 }), "px_invalid_campaign");
    await expectPgError(create(u, { w: 1001, h: 20 }), "px_invalid_rect");
    await expectPgError(create(u, { x: 39990 }), "px_invalid_rect"); // out of the grid
    await expectPgError(create(u, { k: 11 }), "px_bad_dimensions");
    await expectPgError(create(u, { currency: "gbp" }), "px_bad_currency");
    await pool.query(`update public.app_settings set value = 'false'::jsonb where key = 'sales_open'`);
    await expectPgError(create(u), "px_sales_closed");
    await pool.query(`update public.app_settings set value = 'true'::jsonb where key = 'sales_open'`);
    const c = await create(u, { days: 7, k: 2 }); // 7, 14 and 30 are the durations; a finer drawing is fine
    expect((await row(c.id)).duration_days).toBe(7);
  });

  it("is refused to a suspended account", async () => {
    const u = await createUser("banned");
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [u]);
    await expectPgError(create(u), "px_account_suspended");
  });

  it("is refused on a zone that is already taken (a courtesy: the real guarantee comes at approval)", async () => {
    const owner = await createUser("owner");
    await fulfill((await startOrder(owner, { x: 1050, y: 1050, w: 30, h: 30 })).order_id);
    await expectPgError(create(await createUser("late")), "px_parcel_unavailable");
  });

  it("allows a single active project per creator: pending or open counts, finished or withdrawn does not", async () => {
    const mod = await createUser("mod", { role: "moderator" });
    const u = await createUser("single");
    const first = await create(u);
    await expectPgError(create(u, { x: 5000 }), "px_campaign_already_active"); // pending
    await review(mod, first.id, "approve");
    await expectPgError(create(u, { x: 5000 }), "px_campaign_already_active"); // open
    await pool.query(`select public.px_cancel_campaign($1, $2)`, [u, first.id]);
    const second = await create(u, { x: 5000 });
    await review(mod, second.id, "reject", "not today");
    await create(u, { x: 7000 }); // rejected: free to try again
    await create(await createUser("other"), { x: 9000 }); // somebody else is not concerned
  });

  it("holds even when the same creator submits twice at the same time: exactly one wins", async () => {
    const u = await createUser("racer");
    const results = await Promise.allSettled([create(u, { x: 1000 }), create(u, { x: 3000 }), create(u, { x: 5000 }), create(u, { x: 7000 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toContain("px_campaign_already_active");
    expect((await pool.query(`select count(*)::int n from public.campaigns where creator_id = $1`, [u])).rows[0].n).toBe(1);
  });

  it("is invisible to the browser's keys: no read, no write for the anonymous and signed-in roles", async () => {
    const u = await createUser("shy");
    await create(u);
    const { asRole } = await import("./helpers");
    for (const role of ["anon", "authenticated"] as const) {
      await expectPgError(asRole(role, u, (c) => c.query(`select * from public.campaigns`)), /permission denied/);
      await expectPgError(asRole(role, u, (c) => c.query(`update public.campaigns set title = 'x'`)), /permission denied/);
    }
  });
});

describe("moderation of a campaign", () => {
  it("only staff can review", async () => {
    const u = await createUser("plain");
    const c = await create(u);
    await expectPgError(review(u, c.id, "approve"), "px_forbidden");
    await expectPgError(review(await createUser("stranger"), c.id, "reject", "no"), "px_forbidden");
    expect((await row(c.id)).status).toBe("pending");
  });

  it("approval holds the zone until the deadline and keeps the creation as the first APPROVED version, not yet published", async () => {
    const mod = await createUser("mod2", { role: "moderator" });
    const u = await createUser("maker2");
    const c = await create(u, { days: 30 });
    expect(await review(mod, c.id, "approve").then((r) => r.rows[0].px_review_campaign)).toBe("approve");
    const r = await row(c.id);
    expect(r.status).toBe("open");
    expect(r.parcel_id).toBeTruthy();
    expect(r.reviewed_by).toBe(mod);
    const days = (new Date(r.deadline).getTime() - new Date(r.opens_at).getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 1);

    const { rows: [p] } = await pool.query(`select status, owner_id, x, y, w, h, published_asset_id from public.parcels where id = $1`, [r.parcel_id]);
    expect(p).toMatchObject({ status: "reserved", owner_id: u, x: 1000, y: 1000, w: 100, h: 100, published_asset_id: null });
    const { rows: [res] } = await pool.query(`select status, order_id, expires_at from public.parcel_reservations where parcel_id = $1`, [r.parcel_id]);
    expect(res.status).toBe("held");
    expect(res.order_id).toBeNull();
    expect(new Date(res.expires_at).getTime()).toBe(new Date(r.deadline).getTime());
    const { rows: [a] } = await pool.query(`select status, version, title, reviewed_by, published_at from public.parcel_assets where parcel_id = $1`, [r.parcel_id]);
    expect(a).toMatchObject({ status: "approved", version: 1, title: "Our big wall", reviewed_by: mod, published_at: null });

    // nobody can buy or fund another project there while it is held
    expect(await free()).toBe(false);
    await expectPgError(startOrder(await createUser("buyer"), { x: 1020, y: 1020, w: 30, h: 30 }), "px_parcel_unavailable");
    await expectPgError(create(await createUser("rival"), { x: 1050, y: 1050 }), "px_parcel_unavailable");
    // …and it does not count as a sold pixel
    expect((await pool.query(`select sold_pixels from public.px_public_stats()`)).rows[0].sold_pixels).toBe("0");
  });

  it("approval fails cleanly if the zone was taken while the project waited, and the project stays pending (to reject)", async () => {
    const mod = await createUser("mod3", { role: "moderator" });
    const c = await create(await createUser("early"));
    await fulfill((await startOrder(await createUser("faster"), { x: 1090, y: 1090, w: 20, h: 20 })).order_id);
    await expectPgError(review(mod, c.id, "approve"), "px_parcel_unavailable");
    expect(await row(c.id)).toMatchObject({ status: "pending", parcel_id: null });
    expect((await pool.query(`select count(*)::int n from public.parcels where status = 'reserved'`)).rows[0].n).toBe(0);
    await review(mod, c.id, "reject", "The zone is no longer free");
    expect(await row(c.id)).toMatchObject({ status: "rejected", rejection_reason: "The zone is no longer free" });
  });

  it("an expired hold of somebody else does not block the approval", async () => {
    const mod = await createUser("mod4", { role: "moderator" });
    const c = await create(await createUser("patient"));
    const o = await startOrder(await createUser("abandoned"), { x: 1010, y: 1010, w: 30, h: 30 });
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 minute' where id = $1`, [o.reservation_id]);
    await review(mod, c.id, "approve");
    expect((await row(c.id)).status).toBe("open");
  });

  it("rejection records the reason, holds nothing, and frees the creator to try again", async () => {
    const mod = await createUser("mod5", { role: "moderator" });
    const u = await createUser("refused");
    const c = await create(u);
    await review(mod, c.id, "reject", "Not allowed here");
    expect(await row(c.id)).toMatchObject({ status: "rejected", rejection_reason: "Not allowed here", parcel_id: null, reviewed_by: mod });
    expect(await free()).toBe(true);
  });

  it("a project can be reviewed once; a bad decision is refused; the journal remembers who did what", async () => {
    const mod = await createUser("mod6", { role: "moderator" });
    const c = await create(await createUser("once"));
    await expectPgError(review(mod, c.id, "maybe" as "approve"), "px_bad_decision");
    await review(mod, c.id, "approve");
    await expectPgError(review(mod, c.id, "reject", "changed my mind"), "px_not_pending");
    await expectPgError(review(mod, "00000000-0000-0000-0000-000000000000", "approve"), "px_not_found");
    const { rows } = await pool.query(`select action, actor_id from public.audit_logs where target_type = 'campaign' and target_id = $1 order by id`, [c.id]);
    expect(rows.map((r) => r.action)).toEqual(["campaign.create", "campaign.approve"]);
    expect(rows[1].actor_id).toBe(mod);
  });

  it("is refused when the shop is closed or the creator got suspended meanwhile", async () => {
    const mod = await createUser("mod7", { role: "moderator" });
    const u = await createUser("changed");
    const c = await create(u);
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [u]);
    await expectPgError(review(mod, c.id, "approve"), "px_account_suspended");
    await pool.query(`update public.profiles set status = 'active' where id = $1`, [u]);
    await pool.query(`update public.app_settings set value = 'false'::jsonb where key = 'sales_open'`);
    await expectPgError(review(mod, c.id, "approve"), "px_sales_closed");
  });
});

describe("withdrawing a campaign", () => {
  it("a creator withdraws a pending project; nobody else can", async () => {
    const u = await createUser("quit");
    const c = await create(u);
    await expectPgError(pool.query(`select public.px_cancel_campaign($1, $2)`, [await createUser("intruder"), c.id]), "px_not_found");
    await pool.query(`select public.px_cancel_campaign($1, $2)`, [u, c.id]);
    expect(await row(c.id)).toMatchObject({ status: "cancelled" });
    await expectPgError(pool.query(`select public.px_cancel_campaign($1, $2)`, [u, c.id]), "px_not_cancellable");
  });

  it("withdrawing an open project releases the zone at once", async () => {
    const mod = await createUser("mod8", { role: "moderator" });
    const u = await createUser("changes");
    const c = await create(u);
    await review(mod, c.id, "approve");
    expect(await free()).toBe(false);
    await pool.query(`select public.px_cancel_campaign($1, $2)`, [u, c.id]);
    expect(await free()).toBe(true);
    const r = await row(c.id);
    expect(r.status).toBe("cancelled");
    expect((await pool.query(`select status from public.parcels where id = $1`, [r.parcel_id])).rows[0].status).toBe("released");
    expect((await pool.query(`select status from public.parcel_reservations where parcel_id = $1`, [r.parcel_id])).rows[0].status).toBe("canceled");
    await fulfill((await startOrder(await createUser("next"), { x: 1020, y: 1020, w: 30, h: 30 })).order_id); // somebody can buy there now
  });
});

describe("the end of the time", () => {
  it("the maintenance job closes an open project whose deadline passed and gives its zone back; the others are left alone", async () => {
    const mod = await createUser("mod9", { role: "moderator" });
    const late = await create(await createUser("late1"), { x: 1000 });
    const fine = await create(await createUser("fine1"), { x: 3000 });
    await review(mod, late.id, "approve");
    await review(mod, fine.id, "approve");
    expect(await free({ x: 1000, y: 1000, w: 100, h: 100 })).toBe(false);
    // (the hold ends with the deadline, as it does in real life: both carry the same date)
    await pool.query(`update public.campaigns set deadline = now() - interval '1 minute' where id = $1`, [late.id]);
    await pool.query(`update public.parcel_reservations set expires_at = now() - interval '1 minute' where parcel_id = (select parcel_id from public.campaigns where id = $1)`, [late.id]);
    // between the deadline and the job, the zone is already free for others (the hold itself has lapsed)
    expect(await free({ x: 1000, y: 1000, w: 100, h: 100 })).toBe(true);
    expect((await pool.query(`select public.px_expire_campaigns(100) as n`)).rows[0].n).toBe(1);
    expect(await row(late.id)).toMatchObject({ status: "expired" });
    expect((await row(late.id)).closed_at).toBeTruthy();
    expect((await pool.query(`select status from public.parcels where id = $1`, [(await row(late.id)).parcel_id])).rows[0].status).toBe("released");
    expect(await row(fine.id)).toMatchObject({ status: "open" });
    expect(await free({ x: 3000, y: 1000, w: 100, h: 100 })).toBe(false);
    expect((await pool.query(`select public.px_expire_campaigns(100) as n`)).rows[0].n).toBe(0); // nothing more to do, and it can be run again
    // the creator may start another project now
    await create((await row(late.id)).creator_id, { x: 5000 });
  });
});

describe("the settings of the feature", () => {
  it("an admin sets the smallest project and the smallest contribution; the floors are enforced", async () => {
    const admin = await createUser("boss2", { role: "admin" });
    const set = (k: string, v: number) => pool.query(`select public.px_set_setting($1, $2, $3::jsonb)`, [admin, k, JSON.stringify(v)]);
    expect((await pool.query(`select value from public.app_settings where key = 'campaign_min_contribution_cents'`)).rows[0].value).toBe(200);
    await set("campaign_min_contribution_cents", 500);
    await expectPgError(set("campaign_min_contribution_cents", 49), "px_bad_setting");
    await expectPgError(set("campaign_min_area", 24), "px_bad_setting");
    await set("campaign_min_area", 2500);
    const u = await createUser("smaller");
    await create(u, { w: 50, h: 50 }); // 2 500 px is now enough
    await expectPgError(set("no_such_setting", 1), "px_bad_setting");
    await expectPgError(pool.query(`select public.px_set_setting($1, 'campaign_min_area', '5000'::jsonb)`, [await createUser("nobody")]), "px_forbidden");
  });
});
