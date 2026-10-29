import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

async function setupWorld() {
  const [alice, bob, mod, admin] = await Promise.all([
    createUser("alice"), createUser("bob"), createUser("mod", { role: "moderator" }), createUser("adm", { role: "admin" }),
  ]);
  const paid = await startOrder(alice, { x: 100, y: 100, w: 20, h: 20 });
  await fulfill(paid.order_id);
  const held = await startOrder(bob, { x: 300, y: 300, w: 20, h: 20 }); // reserved, unpaid
  return { alice, bob, mod, admin, paid, held };
}

describe("Row Level Security — what the browser (anon key / user JWT) can reach", () => {
  it("anonymous visitors see active parcels but never reservations", async () => {
    const w = await setupWorld();
    const rows = await asRole("anon", null, async (c) => (await c.query(`select id, status from public.parcels`)).rows);
    expect(rows.map((r) => r.id)).toEqual([w.paid.parcel_id]);
  });

  it("owners also see their own unpaid reservations, nobody else's", async () => {
    const w = await setupWorld();
    const bobRows = await asRole("authenticated", w.bob, async (c) => (await c.query(`select id from public.parcels order by id`)).rows);
    expect(bobRows.map((r) => r.id).sort()).toEqual([w.paid.parcel_id, w.held.parcel_id].sort());
    const aliceRows = await asRole("authenticated", w.alice, async (c) => (await c.query(`select id from public.parcels`)).rows);
    expect(aliceRows.map((r) => r.id)).toEqual([w.paid.parcel_id]);
  });

  it("orders and payments are private to their buyer", async () => {
    const w = await setupWorld();
    expect((await asRole("anon", null, (c) => c.query(`select 1 from public.orders`).catch((e) => e))).code).toBe("42501");
    const bobOrders = await asRole("authenticated", w.bob, async (c) => (await c.query(`select id from public.orders`)).rows);
    expect(bobOrders.map((r) => r.id)).toEqual([w.held.order_id]);
    const bobPayments = await asRole("authenticated", w.bob, async (c) => (await c.query(`select id from public.payments`)).rows);
    expect(bobPayments).toHaveLength(0);
    const alicePayments = await asRole("authenticated", w.alice, async (c) => (await c.query(`select id from public.payments`)).rows);
    expect(alicePayments).toHaveLength(1);
    // Stripe identifiers are not even selectable by the buyer through the API.
    await expectPgError(asRole("authenticated", w.alice, (c) => c.query(`select stripe_payment_intent_id from public.payments`)), "42501");
  });

  it("clients cannot write parcels, orders, payments or settings", async () => {
    const w = await setupWorld();
    const attempts = [
      `insert into public.parcels (owner_id, x, y, w, h, status) values ('${w.bob}', 5000, 5000, 10, 10, 'active')`,
      `update public.parcels set status = 'active' where id = '${w.held.parcel_id}'`,
      `update public.parcels set owner_id = '${w.bob}' where id = '${w.paid.parcel_id}'`,
      `delete from public.parcels where id = '${w.paid.parcel_id}'`,
      `update public.orders set status = 'paid' where id = '${w.held.order_id}'`,
      `insert into public.payments (order_id, stripe_payment_intent_id, status, amount_cents, currency) values ('${w.held.order_id}', 'pi_fake', 'succeeded', 1, 'eur')`,
      `update public.app_settings set value = '1'::jsonb where key = 'price_unit_cents'`,
    ];
    for (const sql of attempts) {
      await expectPgError(asRole("authenticated", w.bob, (c) => c.query(sql)), "42501");
    }
    // Rows survive.
    const { rows } = await pool.query(`select status from public.parcels where id = $1`, [w.paid.parcel_id]);
    expect(rows[0].status).toBe("active");
  });

  it("users cannot grant themselves staff rights or reactivate a suspended account", async () => {
    const w = await setupWorld();
    await expectPgError(asRole("authenticated", w.bob, (c) => c.query(`insert into public.admin_roles (user_id, role) values ('${w.bob}', 'admin')`)), "42501");
    await expectPgError(asRole("authenticated", w.bob, (c) => c.query(`select * from public.admin_roles`)), "42501");
    await expectPgError(asRole("authenticated", w.bob, (c) => c.query(`update public.profiles set status = 'active', suspended_reason = null where id = '${w.bob}'`)), "42501");
    await expectPgError(asRole("authenticated", w.bob, (c) => c.query(`select public.px_set_user_suspended('${w.bob}', '${w.alice}', true)`)), "42501");
    await expectPgError(asRole("authenticated", w.bob, (c) => c.query(`select public.px_start_order('${w.bob}', 9000, 9000, 10, 10)`)), "42501");
  });

  it("users can edit only their own safe profile fields", async () => {
    const w = await setupWorld();
    const res = await asRole("authenticated", w.bob, (c) => c.query(`update public.profiles set bio = 'hello', country = 'FR' where id = '${w.bob}'`));
    expect(res.rowCount).toBe(1);
    const other = await asRole("authenticated", w.bob, (c) => c.query(`update public.profiles set bio = 'pwned' where id = '${w.alice}'`));
    expect(other.rowCount).toBe(0);
  });

  it("only approved creations of visible parcels are public; others only to their owner and staff", async () => {
    const w = await setupWorld();
    const add = async (user: string, parcel: string, w_: number, h: number, title: string) =>
      (await pool.query(`select * from public.px_add_asset($1, $2, 'path/x.png', repeat('a', 64), $3, $4, 100, '#ff0000', $5, null, null, false)`, [user, parcel, w_, h, title])).rows[0];
    const pendingAsset = await add(w.alice, w.paid.parcel_id, 20, 20, "mine");
    expect((await asRole("anon", null, async (c) => (await c.query(`select id from public.parcel_assets`)).rows))).toHaveLength(0);
    expect((await asRole("authenticated", w.alice, async (c) => (await c.query(`select id from public.parcel_assets`)).rows))).toHaveLength(1);
    expect((await asRole("authenticated", w.bob, async (c) => (await c.query(`select id from public.parcel_assets`)).rows))).toHaveLength(0);

    await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [w.mod, pendingAsset.id]);
    expect((await asRole("anon", null, async (c) => (await c.query(`select id from public.parcel_assets`)).rows))).toHaveLength(1);
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'test')`, [w.mod, w.paid.parcel_id]);
    expect((await asRole("anon", null, async (c) => (await c.query(`select id from public.parcel_assets`)).rows))).toHaveLength(0);
  });

  it("the audit log is readable by staff only and cannot be altered, even by the service role", async () => {
    const w = await setupWorld();
    await pool.query(`select public.px_set_user_suspended($1, $2, true, 'spam')`, [w.admin, w.bob]);
    expect(await asRole("authenticated", w.bob, async (c) => (await c.query(`select id from public.audit_logs`)).rows)).toHaveLength(0);
    expect((await asRole("authenticated", w.admin, async (c) => (await c.query(`select id from public.audit_logs`)).rows)).length).toBeGreaterThan(0);
    await expectPgError(pool.query(`update public.audit_logs set action = 'x'`), "append-only");
    await expectPgError(pool.query(`delete from public.audit_logs`), "append-only");
    await expectPgError(pool.query(`delete from public.moderation_actions`), "append-only");
  });

  it("likes: a user manages only their own, only on active parcels", async () => {
    const w = await setupWorld();
    await asRole("authenticated", w.bob, async (c) => { await c.query(`insert into public.parcel_likes (user_id, parcel_id) values ('${w.bob}', '${w.paid.parcel_id}')`); });
    await expectPgError(asRole("authenticated", w.bob, (c) => c.query(`insert into public.parcel_likes (user_id, parcel_id) values ('${w.alice}', '${w.paid.parcel_id}')`)), /42501|row-level/);
    await expectPgError(asRole("authenticated", w.bob, (c) => c.query(`insert into public.parcel_likes (user_id, parcel_id) values ('${w.bob}', '${w.held.parcel_id}')`)), /42501|row-level/);
  });
});

describe("staff functions", () => {
  it("require a staff role stored in admin_roles; moderators cannot do admin-only actions", async () => {
    const w = await setupWorld();
    await expectPgError(pool.query(`select public.px_set_parcel_hidden($1, $2, true)`, [w.bob, w.paid.parcel_id]), "px_forbidden");
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'rule 3')`, [w.mod, w.paid.parcel_id]); // moderator ok
    await expectPgError(pool.query(`select public.px_set_user_suspended($1, $2, true)`, [w.mod, w.bob]), "px_forbidden");
    await expectPgError(pool.query(`select public.px_revoke_parcel($1, $2, 'x')`, [w.mod, w.paid.parcel_id]), "px_forbidden");
    await expectPgError(pool.query(`select public.px_set_setting($1, 'price_unit_cents', '5')`, [w.mod]), "px_forbidden");
    await pool.query(`select public.px_set_user_suspended($1, $2, true, 'abuse')`, [w.admin, w.bob]);
    await expectPgError(pool.query(`select public.px_set_user_suspended($1, $1, true)`, [w.admin]), "px_forbidden"); // not yourself
  });

  it("every administrative action is journalised with actor and target", async () => {
    const w = await setupWorld();
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'rule 3')`, [w.mod, w.paid.parcel_id]);
    await pool.query(`select public.px_set_setting($1, 'price_unit_cents', '150')`, [w.admin]);
    const { rows } = await pool.query(`select actor_id, actor_role, action, target_type, target_id from public.audit_logs where actor_id is not null order by id`);
    expect(rows).toEqual([
      { actor_id: w.mod, actor_role: "moderator", action: "parcel.hide", target_type: "parcel", target_id: w.paid.parcel_id },
      { actor_id: w.admin, actor_role: "admin", action: "setting.update", target_type: "setting", target_id: "price_unit_cents" },
    ]);
    const acts = await pool.query(`select action from public.moderation_actions`);
    expect(acts.rows).toEqual([{ action: "hide_parcel" }]);
  });

  it("asset moderation: approve publishes, a new version stays pending until approved, reject keeps the old one", async () => {
    const w = await setupWorld();
    const add = async (title: string) =>
      (await pool.query(`select * from public.px_add_asset($1, $2, 'p/x.png', repeat('b', 64), 20, 20, 100, '#00ff00', $3, null, null, false)`, [w.alice, w.paid.parcel_id, title])).rows[0];
    const v1 = await add("v1");
    await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [w.mod, v1.id]);
    const published = async () => (await pool.query(`select a.title from public.parcels p join public.parcel_assets a on a.id = p.published_asset_id where p.id = $1`, [w.paid.parcel_id])).rows[0]?.title;
    expect(await published()).toBe("v1");

    const v2 = await add("v2");
    expect(await published()).toBe("v1"); // edit pending: previous version still shown
    const v3 = await add("v3"); // replaces the pending one
    expect((await pool.query(`select status from public.parcel_assets where id = $1`, [v2.id])).rows[0].status).toBe("superseded");
    await pool.query(`select public.px_review_asset($1, $2, 'reject', 'copyright')`, [w.mod, v3.id]);
    expect(await published()).toBe("v1");
    await expectPgError(pool.query(`select public.px_review_asset($1, $2, 'approve')`, [w.mod, v3.id]), "px_not_pending");
  });

  it("assets must match the parcel dimensions and belong to the owner", async () => {
    const w = await setupWorld();
    await expectPgError(pool.query(`select public.px_add_asset($1, $2, 'p', repeat('c', 64), 10, 10, 1, '#000000', null, null, null, false)`, [w.alice, w.paid.parcel_id]), "px_bad_dimensions");
    await expectPgError(pool.query(`select public.px_add_asset($1, $2, 'p', repeat('c', 64), 20, 20, 1, '#000000', null, null, null, false)`, [w.bob, w.paid.parcel_id]), "px_forbidden");
  });

  it("suspended users cannot upload creations", async () => {
    const w = await setupWorld();
    await pool.query(`select public.px_set_user_suspended($1, $2, true, 'abuse')`, [w.admin, w.alice]);
    await expectPgError(pool.query(`select public.px_add_asset($1, $2, 'p', repeat('c', 64), 20, 20, 1, '#000000', null, null, null, false)`, [w.alice, w.paid.parcel_id]), "px_account_suspended");
  });
});

describe("rate limit helper", () => {
  it("allows up to the maximum per window and then refuses", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push((await pool.query(`select public.px_rate_limit('t:1', 3600, 3) as ok`)).rows[0].ok);
    expect(results).toEqual([true, true, true, false, false]);
    expect((await pool.query(`select public.px_rate_limit('t:2', 3600, 3) as ok`)).rows[0].ok).toBe(true);
  });
});
