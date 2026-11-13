import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, fulfill, pool, resetData, startOrder } from "./helpers";
import { lonLatToPixel } from "@/lib/grid/geometry";
import { CATEGORIES } from "@/lib/archive";
import { clearDemo, clearIllustrations, seedDemo, type DemoPorts, type Rect } from "@/lib/demo/seed";
import { HERITAGE, heritagePlan } from "@/lib/demo/heritage";
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

describe("the heritage set on a database (illustration parcels)", () => {
  it("puts the 100 parcels on land, on their real places, none over another, each with its drawing, its sentence and its category, all owned by ONE technical account", async () => {
    const r = await seedDemo(ports(), { count: 100, emailDomain: DOMAIN, plan: heritagePlan() });
    expect(r.failed).toEqual([]);
    expect([r.usersCreated, r.parcelsCreated]).toEqual([1, 100]); // one account for all of them

    const { rows } = await pool.query(`select pc.owner_id, pc.x, pc.y, pc.w, pc.h, pc.status, pc.kind, pc.tier, a.title, a.description, a.category, a.status as asset_status, a.storage_path, pr.bio
      from public.parcels pc join public.parcel_assets a on a.id = pc.published_asset_id join public.profiles pr on pr.id = pc.owner_id order by a.title`);
    expect(rows).toHaveLength(100);
    expect(new Set(rows.map((p) => p.owner_id)).size).toBe(1); // one technical account, nobody to sign in to it
    expect(rows.every((p) => p.tier === "illustration")).toBe(true);
    const byTitle = new Map(HERITAGE.map((e) => [e.title, e]));
    const away: number[] = [];
    for (const p of rows) {
      const e = byTitle.get(p.title)!;
      expect(e, p.title).toBeTruthy();
      expect([p.status, p.kind, p.asset_status]).toEqual(["active", "land", "approved"]);
      expect([p.w, p.h], p.title).toEqual([e.w, e.h]);
      expect(p.w).toBeLessThanOrEqual(50); expect(p.h).toBeLessThanOrEqual(50);
      expect(p.description).toBe(e.text);
      expect(p.category).toBe(e.category);
      expect(CATEGORIES as readonly string[]).toContain(p.category);
      expect(files.get(p.storage_path)!.subarray(1, 4).toString()).toBe("PNG");
      expect(p.bio).toMatch(/technique/i);
      const c = lonLatToPixel({ lon: e.lon, lat: e.lat });
      away.push(Math.hypot(p.x + p.w / 2 - c.x, p.y + p.h / 2 - c.y));
    }
    // on its place: most are exactly there, none is further than the spiral reaches (about 130 pixels, 95 km)
    away.sort((a, b) => a - b);
    expect(away[Math.floor(away.length * 0.6)]!, "60 % are within a few pixels of the real place").toBeLessThanOrEqual(12);
    expect(away[away.length - 1]!, "none is far from it").toBeLessThanOrEqual(140);
    // none over another (the database refuses it anyway; this reads it back)
    const rects = rows.map((p) => ({ x: Number(p.x), y: Number(p.y), w: Number(p.w), h: Number(p.h) }));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${i} and ${j} overlap`).toBe(false);
    }
    // they are counted nowhere: the public counters stay at zero (a real launch starts from zero with them in place)
    expect((await pool.query(`select * from public.px_public_stats()`)).rows[0]).toMatchObject({ sold_pixels: "0", parcels: "0", owners: "0", free_parcels: "0" });
    // no order, no payment: no fake revenue
    for (const t of ["orders", "stripe_events", "audit_logs", "moderation_actions"]) expect(Number((await pool.query(`select count(*) from public.${t}`)).rows[0].count), t).toBe(0);
  });

  it("completes instead of doubling when it is run again; `clear` leaves the illustrations (they stay when the site opens); only an explicit request takes them away", async () => {
    await seedDemo(ports(), { count: 100, emailDomain: DOMAIN, plan: heritagePlan() });
    const again = await seedDemo(ports(), { count: 100, emailDomain: DOMAIN, plan: heritagePlan() });
    expect([again.usersCreated, again.parcelsCreated, again.parcelsSkipped, again.failed]).toEqual([0, 0, 100, []]);
    // the demonstration accounts go, the illustrations do not
    await seedDemo(ports(), { count: 5, seed: 3, emailDomain: DOMAIN }); // a few ordinary demonstration accounts beside them
    const gone = await clearDemo(ports(), { emailDomain: DOMAIN });
    expect(gone.users).toBe(5);
    expect(Number((await pool.query("select count(*) from public.parcels where tier = 'illustration'")).rows[0].count)).toBe(100);
    expect(files.size).toBe(100);
    // asked for: parcels, files and the technical account are removed
    const all = await clearIllustrations(ports(), { emailDomain: DOMAIN });
    expect([all.parcels, all.files, all.accounts]).toEqual([100, 100, 1]);
    expect(Number((await pool.query("select count(*) from public.parcels")).rows[0].count)).toBe(0);
    expect(files.size).toBe(0);
  });

  it("is covered by a purchase like a free parcel: the illustration under a bought parcel is gone from the map, whole", async () => {
    await seedDemo(ports(), { count: 100, emailDomain: DOMAIN, plan: heritagePlan() });
    const { rows: [target] } = await pool.query(`select p.id, p.x, p.y from public.parcels p join public.parcel_assets a on a.id = p.published_asset_id where a.title = 'La tour Eiffel'`);
    const buyer = await createUser("buyer");
    const o = await startOrder(buyer, { x: target.x + 2, y: target.y + 2, w: 5, h: 5 });
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    expect((await pool.query(`select status, covered_by from public.parcels where id = $1`, [target.id])).rows[0]).toMatchObject({ status: "covered", covered_by: o.parcel_id });
    expect(Number((await pool.query("select count(*) from public.parcels where tier = 'illustration' and status = 'active'")).rows[0].count)).toBe(99);
    expect((await pool.query(`select * from public.px_public_stats()`)).rows[0]).toMatchObject({ sold_pixels: "25", parcels: "1", owners: "1" });
  });
});
