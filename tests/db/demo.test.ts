import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, pool, resetData } from "./helpers";
import { lonLatToPixel } from "@/lib/grid/geometry";
import { ANCHORS } from "@/lib/demo/plan";
import { clearDemo, demoStatus, seedDemo, type DemoPorts, type Rect } from "@/lib/demo/seed";

afterAll(closeDb);

const DOMAIN = "demo.invalid";
let files = new Map<string, Buffer>();
let logged: string[] = [];

/** The ports of the real script, on the scratch database: accounts straight in `auth.users`, files in memory, every rectangle is land. */
const ports = (land: (r: Rect) => number = (r) => r.w * r.h): DemoPorts => ({
  query: async (sql, params) => (await pool.query(sql, params)).rows,
  async createUser(email, username) {
    const { rows } = await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('username', $2::text)) returning id", [email, username]);
    return rows[0].id as string;
  },
  deleteUser: async (id) => { await pool.query("delete from auth.users where id = $1", [id]); },
  putObject: async (key, bytes) => { files.set(key, bytes); },
  removeObject: async (key) => { if (!files.delete(key)) throw new Error("no such file"); },
  landPixels: async (r) => land(r),
  log: (m) => logged.push(m),
});

beforeEach(async () => {
  await resetData();
  await pool.query("delete from auth.users where email like '%@demo.invalid' or email = 'real@example.test'");
  files = new Map();
  logged = [];
});

describe("demonstration data for a test site", () => {
  it("makes accounts, parcels and published creations, and nothing that looks like money", async () => {
    const r = await seedDemo(ports(), { count: 20, seed: 3, emailDomain: DOMAIN });
    expect(r.failed).toEqual([]);
    expect([r.usersCreated, r.parcelsCreated]).toEqual([20, 20]);

    const { rows: parcels } = await pool.query(`select pc.*, a.status as asset_status, a.storage_path, a.published_at from public.parcels pc
      join public.parcel_assets a on a.id = pc.published_asset_id`);
    expect(parcels).toHaveLength(20);
    for (const p of parcels) {
      expect(p.status).toBe("active");
      expect(p.asset_status).toBe("approved");
      expect(p.w).toBeGreaterThanOrEqual(40);
      expect(p.land_px).toBe(p.w * p.h);
      expect(files.has(p.storage_path)).toBe(true);
      expect(files.get(p.storage_path)!.subarray(1, 4).toString()).toBe("PNG");
      expect(new Date(p.published_at).getTime()).toBeLessThanOrEqual(Date.now());
    }
    // no order, no payment, no moderation trail: no fake revenue
    for (const t of ["orders", "stripe_events", "audit_logs", "moderation_actions"]) {
      expect(Number((await pool.query(`select count(*) from public.${t}`)).rows[0].count), t).toBe(0);
    }
    // the accounts are marked and have a profile
    const { rows: profiles } = await pool.query("select p.username, p.bio from public.profiles p join auth.users u on u.id = p.id where u.email like '%@demo.invalid'");
    expect(profiles).toHaveLength(20);
    expect(profiles.every((p) => /^demo_/.test(p.username) && /démonstration/.test(p.bio))).toBe(true);
  });

  it("never overlaps another parcel, including a real one that is already there", async () => {
    const { rows: [u] } = await pool.query("insert into auth.users (email, raw_user_meta_data) values ('real@example.test', '{}'::jsonb) returning id");
    // real parcels right on the first anchor city, where the first demonstration parcels would like to go
    const c = lonLatToPixel({ lon: ANCHORS[0]!.lon, lat: ANCHORS[0]!.lat });
    await pool.query("insert into public.parcels (owner_id, x, y, w, h, status, land_px) values ($1, $2, $3, 400, 300, 'active', 120000)", [u.id, Math.round(c.x - 200), Math.round(c.y - 150)]);
    const r = await seedDemo(ports(), { count: 12, seed: 1, emailDomain: DOMAIN });
    expect(r.failed).toEqual([]);
    expect(r.parcelsCreated).toBe(12); // the database's exclusion constraint would have refused any overlap
    const { rows } = await pool.query("select count(*)::int as n from public.parcels");
    expect(rows[0].n).toBe(13);
  });

  it("only takes places that are on land", async () => {
    const calls: Rect[] = [];
    const r = await seedDemo(ports((rc) => { calls.push(rc); return Math.round(rc.w * rc.h * 0.5); }), { count: 3, seed: 1, emailDomain: DOMAIN });
    expect(r.parcelsCreated).toBe(0); // 50 % land is below the 85 % asked
    expect(r.failed).toHaveLength(3);
    expect(calls.length).toBeGreaterThan(3);
    expect(Number((await pool.query("select count(*) from public.parcels")).rows[0].count)).toBe(0);
  });

  it("is safe to run twice: nothing is doubled", async () => {
    await seedDemo(ports(), { count: 10, seed: 2, emailDomain: DOMAIN });
    const again = await seedDemo(ports(), { count: 10, seed: 2, emailDomain: DOMAIN });
    expect([again.usersCreated, again.usersFound, again.parcelsCreated, again.parcelsSkipped]).toEqual([0, 10, 0, 10]);
    expect(Number((await pool.query("select count(*) from public.parcels")).rows[0].count)).toBe(10);
  });

  it("shows up in the public counters, and the status says how many there are", async () => {
    await seedDemo(ports(), { count: 8, seed: 5, emailDomain: DOMAIN });
    const s = await demoStatus(ports(), { emailDomain: DOMAIN });
    expect([s.users, s.parcels]).toEqual([8, 8]);
    expect(s.publicCounters.parcels).toBe(8);
    expect(s.publicCounters.creations).toBe(8);
    expect(s.publicCounters.soldPixels).toBeGreaterThan(8 * 40 * 40);
  });

  it("is removed completely by one command, and leaves real accounts and parcels alone", async () => {
    const { rows: [u] } = await pool.query("insert into auth.users (email, raw_user_meta_data) values ('real@example.test', '{}'::jsonb) returning id");
    await pool.query("insert into public.parcels (owner_id, x, y, w, h, status, land_px) values ($1, 100, 100, 50, 50, 'active', 2500)", [u.id]);
    await seedDemo(ports(), { count: 15, seed: 4, emailDomain: DOMAIN });
    const before = Number((await pool.query("select version from public.map_state where id = 1")).rows[0].version);

    const gone = await clearDemo(ports(), { emailDomain: DOMAIN });
    expect(gone).toEqual({ users: 15, parcels: 15, files: 15 });
    expect(files.size).toBe(0);
    expect(Number((await pool.query("select count(*) from auth.users where email like '%@demo.invalid'")).rows[0].count)).toBe(0);
    expect(Number((await pool.query("select count(*) from public.parcel_assets")).rows[0].count)).toBe(0);
    const { rows } = await pool.query("select owner_id from public.parcels");
    expect(rows).toEqual([{ owner_id: u.id }]); // the real parcel is still there
    expect(Number((await pool.query("select count(*) from auth.users where email = 'real@example.test'")).rows[0].count)).toBe(1);
    expect(Number((await pool.query("select version from public.map_state where id = 1")).rows[0].version)).toBeGreaterThan(before); // the map's tiles are refreshed

    expect(await clearDemo(ports(), { emailDomain: DOMAIN })).toEqual({ users: 0, parcels: 0, files: 0 }); // and again: nothing to do
  });
});
