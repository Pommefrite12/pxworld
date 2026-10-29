import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

describe("profiles are created automatically with a valid, unique username", () => {
  const signUp = async (email: string, username?: string) => {
    const { rows } = await pool.query(
      `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
      [email, JSON.stringify(username ? { username } : {})],
    );
    return (await pool.query("select username from public.profiles where id = $1", [rows[0].id])).rows[0].username as string;
  };
  it("uses the chosen username, sanitised", async () => {
    expect(await signUp("a@x.test", "Cool_Name")).toBe("Cool_Name");
    expect(await signUp("b@x.test", "we ird<script>")).toBe("weirdscript");
  });
  it("falls back to the email local part and pads names that are too short", async () => {
    expect(await signUp("marie.curie@x.test")).toBe("marie.curie");
    expect(await signUp("jo@x.test")).toMatch(/^jopix/);
  });
  it("never produces duplicates (case-insensitive)", async () => {
    const names = new Set<string>();
    for (let i = 0; i < 8; i++) names.add((await signUp(`dup${i}@x.test`, "Twin")).toLowerCase());
    expect(names.size).toBe(8);
  });
});

describe("public parcel codes", () => {
  it("are 10 lowercase hex characters", async () => {
    const o = await startOrder(await createUser(), { x: 0, y: 0, w: 10, h: 10 });
    const { rows } = await pool.query("select code from public.parcels where id = $1", [o.parcel_id]);
    expect(rows[0].code).toMatch(/^[0-9a-f]{10}$/);
  });
  it("a code collision never fails a purchase: another code is drawn", async () => {
    const first = await startOrder(await createUser(), { x: 0, y: 0, w: 10, h: 10 });
    const { rows: [{ code }] } = await pool.query("select code from public.parcels where id = $1", [first.parcel_id]);
    // Force the next draw to collide once, then behave normally.
    await pool.query(`create sequence public.px_test_seq`);
    await pool.query(`create or replace function public.px_short_code() returns text language sql volatile as
      $$ select case when nextval('public.px_test_seq') = 1 then '${code}' else substr(md5(random()::text), 1, 10) end $$`);
    const second = await startOrder(await createUser(), { x: 100, y: 0, w: 10, h: 10 });
    const { rows: r2 } = await pool.query("select code from public.parcels where id = $1", [second.parcel_id]);
    expect(r2[0].code).not.toBe(code);
    expect(r2[0].code).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe("asynchronous payments keep the pixels held", () => {
  it("px_extend_reservation pushes both the reservation and the order expiry, and the hold survives the cron", async () => {
    const o = await startOrder(await createUser(), { x: 0, y: 0, w: 10, h: 10 });
    await pool.query("update public.parcel_reservations set expires_at = now() + interval '1 minute' where order_id = $1", [o.order_id]);
    await pool.query("select public.px_extend_reservation($1, 120)", [o.order_id]);
    await pool.query("select * from public.px_expire_reservations()");
    const { rows } = await pool.query("select p.status from public.parcels p where p.id = $1", [o.parcel_id]);
    expect(rows[0].status).toBe("reserved");
    const r = await pool.query("select expires_at > now() + interval '4 days' as long from public.parcel_reservations where order_id = $1", [o.order_id]);
    expect(r.rows[0].long).toBe(true);
  });
});

describe("map version", () => {
  const version = async () => Number((await pool.query("select version from public.map_state")).rows[0].version);
  it("bumps when the visible map changes — once per statement — and not for plain reservations", async () => {
    const u = await createUser();
    const v0 = await version();
    const o = await startOrder(u, { x: 0, y: 0, w: 10, h: 10 });
    expect(await version()).toBe(v0); // a reservation is invisible: no cache churn
    await pool.query(`select public.px_fulfill_order($1, null, 'pi_v', null, 10000, 0, 10000, 'eur', null, null, null, null)`, [o.order_id]);
    expect(await version()).toBe(v0 + 1);
    await pool.query(
      `insert into public.parcels (owner_id, x, y, w, h, status) select $1, 100 + i * 20, 100, 10, 10, 'active' from generate_series(0, 999) i`, [u]);
    expect(await version()).toBe(v0 + 2); // 1 000 rows, one bump
  });
});
