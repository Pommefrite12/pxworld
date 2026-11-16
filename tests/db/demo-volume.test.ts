import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, pool, resetData } from "./helpers";
import { clearDemo, demoStatus, type DemoPorts, type Rect } from "@/lib/demo/seed";
import { VOLUME_PICTURES_PER_SIZE, VOLUME_SIZES, seedVolume } from "@/lib/demo/volume";
import { landPixelsIn } from "@/lib/geo/landServer";

afterAll(closeDb);
const DOMAIN = "demo.invalid";
let files = new Map<string, Buffer>();

/** The ports of the real script, on the scratch database: accounts straight in `auth.users`, files in memory, the real map of the land. */
const ports = (): DemoPorts => ({
  query: async (sql, params) => (await pool.query(sql, params)).rows,
  async createUser(email, username) {
    const { rows } = await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('username', $2::text)) returning id", [email, username]);
    return rows[0].id as string;
  },
  deleteUser: async (id) => { await pool.query("delete from auth.users where id = $1", [id]); },
  putObject: async (key, bytes) => { files.set(key, bytes); },
  removeObject: async (key) => { if (!files.delete(key)) throw new Error("no such file"); },
  landPixels: async (r: Rect) => landPixelsIn(r),
  log: () => undefined,
});

beforeEach(async () => {
  await resetData();
  await pool.query("delete from auth.users where email like '%@demo.invalid'");
  files = new Map();
});

describe("the volume mode of the demonstration tool", () => {
  it("fills the world with parcels fast: a few accounts, a small stock of pictures, every parcel active, on land, published, none over another", async () => {
    const t0 = Date.now();
    const r = await seedVolume(ports(), { count: 600, owners: 6, emailDomain: DOMAIN, seed: 3 });
    expect(Date.now() - t0, "600 parcels in a few seconds").toBeLessThan(25_000);
    expect(r).toMatchObject({ owners: 6, ownersCreated: 6, existing: 0, created: 600, short: 0 });
    expect(r.pictures, "only the pictures that are used are stored").toBe(files.size);
    expect(r.pictures).toBeLessThanOrEqual(VOLUME_SIZES.length * VOLUME_PICTURES_PER_SIZE);

    const { rows } = await pool.query(`select pc.x, pc.y, pc.w, pc.h, pc.area, pc.land_px, pc.status, pc.kind, pc.tier, pc.owner_id, pc.published_asset_id, a.status as asset_status,
        a.storage_path, a.width, a.height, a.i18n, a.title, a.category from public.parcels pc join public.parcel_assets a on a.id = pc.published_asset_id`);
    expect(rows).toHaveLength(600);
    expect(new Set(rows.map((x) => x.owner_id)).size).toBeLessThanOrEqual(6);
    for (const x of rows) {
      expect([x.status, x.kind, x.tier, x.asset_status]).toEqual(["active", "land", "paid", "approved"]);
      expect(x.area).toBeGreaterThanOrEqual(25); // a paid parcel's minimum
      expect(x.land_px * 100, "nearly all land").toBeGreaterThanOrEqual(x.area * 85);
      expect([x.width, x.height]).toEqual([x.w, x.h]);
      expect(x.i18n?._auto?.demo, "the automatic translation never spends on a demo parcel").toBe(true);
      expect(x.title).toMatch(/\d{3}$/);
    }
    // the same few pictures serve every parcel; each one is a real file
    const paths = new Set(rows.map((x) => x.storage_path));
    expect(paths.size).toBeLessThanOrEqual(VOLUME_SIZES.length * VOLUME_PICTURES_PER_SIZE);
    for (const k of paths) expect(files.get(k)!.subarray(1, 4).toString()).toBe("PNG");
    // mostly small, like a map: 5 × 5 is the most common size
    const by = new Map<string, number>(); for (const x of rows) by.set(`${x.w}x${x.h}`, (by.get(`${x.w}x${x.h}`) ?? 0) + 1);
    expect([...by.entries()].sort((a, b) => b[1] - a[1])[0]![0]).toMatch(/^(5x5|6x6|8x8)$/);
    // none over another (the database refuses it; this reads it back, with an index instead of 180 000 pair checks)
    const sorted = rows.map((x) => ({ x: Number(x.x), y: Number(x.y), w: Number(x.w), h: Number(x.h) })).sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length && sorted[j]!.x < sorted[i]!.x + sorted[i]!.w; j++) {
      const a = sorted[i]!, b = sorted[j]!;
      expect(a.y < b.y + b.h && b.y < a.y + a.h, `${i} and ${j} overlap`).toBe(false);
    }
    // the public counters see them (this is what the tool is for), and not one order or payment was made
    expect((await pool.query(`select * from public.px_public_stats()`)).rows[0]).toMatchObject({ parcels: "600" });
    for (const t of ["orders", "audit_logs", "moderation_actions"]) expect(Number((await pool.query(`select count(*) from public.${t}`)).rows[0].count), t).toBe(0);
    expect((await demoStatus(ports(), { emailDomain: DOMAIN })).parcels).toBe(600);
  });

  it("completes instead of doubling: the same number adds nothing, a bigger one adds only the difference", async () => {
    await seedVolume(ports(), { count: 120, owners: 3, emailDomain: DOMAIN });
    const again = await seedVolume(ports(), { count: 120, owners: 3, emailDomain: DOMAIN });
    expect([again.created, again.existing, again.ownersCreated, again.pictures]).toEqual([0, 120, 0, 0]);
    const more = await seedVolume(ports(), { count: 150, owners: 3, emailDomain: DOMAIN, seed: 2 });
    expect([more.created, more.existing]).toEqual([30, 120]);
    expect(Number((await pool.query("select count(*) from public.parcels")).rows[0].count)).toBe(150);
  });

  it("`clear` removes all of it, each shared file once, and the accounts", async () => {
    await seedVolume(ports(), { count: 200, owners: 4, emailDomain: DOMAIN });
    const stored = files.size;
    expect(stored).toBeGreaterThan(8); expect(stored).toBeLessThanOrEqual(VOLUME_SIZES.length * VOLUME_PICTURES_PER_SIZE);
    const gone = await clearDemo(ports(), { emailDomain: DOMAIN });
    expect(gone).toMatchObject({ users: 4, parcels: 200 });
    expect(gone.files, "every file once, none left, none missing").toBe(stored);
    expect(files.size).toBe(0);
    expect(Number((await pool.query("select count(*) from public.parcels")).rows[0].count)).toBe(0);
    expect(Number((await pool.query("select count(*) from auth.users where email like '%@demo.invalid'")).rows[0].count)).toBe(0);
  });

  it("leaves what is already on the map alone: a parcel that is there is never covered", async () => {
    const o = (await pool.query("insert into auth.users (email, raw_user_meta_data) values ('real@example.test', jsonb_build_object('username', 'real')) returning id")).rows[0].id;
    // a real paid parcel in the middle of Paris
    await pool.query(`insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at) values ($1, 20000, 8300, 40, 40, 'active', 'paid', 'land', 1600, now())`, [o]);
    await seedVolume(ports(), { count: 400, owners: 3, emailDomain: DOMAIN, seed: 5 });
    expect((await pool.query("select status from public.parcels where owner_id = $1", [o])).rows[0].status).toBe("active");
    expect(Number((await pool.query("select count(*) from public.parcels where status = 'active'")).rows[0].count)).toBe(401);
  });
});
