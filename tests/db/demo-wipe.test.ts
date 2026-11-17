import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, fulfill, pool, resetData, startOrder } from "./helpers";
import { demoStatus, seedDemo, wipeEverything, wipePreview, type DemoPorts, type Rect } from "@/lib/demo/seed";
import { heritagePlan } from "@/lib/demo/heritage";
import { seedVolume } from "@/lib/demo/volume";
import { landPixelsIn } from "@/lib/geo/landServer";

afterAll(closeDb);
const DOMAIN = "demo.invalid";
let files = new Map<string, Buffer>();

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
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);

/** A site with a bit of everything: demonstration parcels (volume mode and a few illustrations), a real person's PAID parcel (order, payment, picture, comment, like), and a purchase still waiting. */
async function aSiteWithEverything() {
  await seedVolume(ports(), { count: 80, owners: 4, emailDomain: DOMAIN, seed: 5 });
  await seedDemo(ports(), { count: 2, emailDomain: DOMAIN, plan: heritagePlan().slice(0, 2) });
  const buyer = await createUser("buyer"), fan = await createUser("fan");
  const paid = await startOrder(buyer, { x: 10, y: 10, w: 20, h: 20 });
  expect(await fulfill(paid.order_id)).toBe("fulfilled");
  const [asset] = (await pool.query(
    `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at)
     values ($1, $2, 1, 'creations/real/mine.png', 'realhash01', 20, 20, 100, '#aa5533', 'Ma trace', 'Une vraie.', 'approved', now(), now(), now()) returning id`, [paid.parcel_id, buyer])).rows;
  await pool.query("update public.parcels set published_asset_id = $1 where id = $2", [asset.id, paid.parcel_id]);
  files.set("creations/real/mine.png", Buffer.from("png"));
  await pool.query("insert into public.parcel_comments (parcel_id, author_id, body) values ($1, $2, 'Bravo')", [paid.parcel_id, fan]);
  await pool.query("insert into public.parcel_likes (user_id, parcel_id) values ($1, $2)", [fan, paid.parcel_id]);
  const waiting = await startOrder(buyer, { x: 100, y: 10, w: 20, h: 20 }); // an order that is not paid yet: its parcel is held
  // a fundraising project that holds a zone (open), with a contribution: the database wants an open project to have its parcel
  const staff = await createUser("staff", { role: "admin" });
  await pool.query("update public.app_settings set value = '10000'::jsonb where key = 'campaign_min_area'");
  const { rows: [camp] } = await pool.query(
    `select * from public.px_create_campaign($1, 2000, 2000, 100, 100, null, 'eur', 'land', 14, 'campaigns/c.png', 'abc123', 100, 100, 1234, '#112233', 'Our big wall', 'A wall for everybody', null, false)`, [buyer]);
  await pool.query("select public.px_review_campaign($1, $2, 'approve', null)", [staff, camp.id]);
  files.set("campaigns/c.png", Buffer.from("png")); // the picture of the project became the creation of its parcel
  await pool.query("select * from public.px_start_contribution($1, $2, 500)", [fan, camp.id]);
  return { buyer, fan, paid, waiting, camp };
}

describe("the tool that removes everything from a test site", () => {
  it("removes every parcel, whoever owns it, with its purchases, payments, creations, comments, likes and files", async () => {
    const { buyer, fan, paid } = await aSiteWithEverything();
    expect(await count("select count(*)::int n from public.parcels")).toBeGreaterThan(80);
    const auditBefore = await count("select count(*)::int n from public.audit_logs");
    expect(auditBefore, "the paid purchase was logged").toBeGreaterThan(0);
    const versionBefore = await count("select version::int n from public.map_state where id = 1");

    const before = await wipePreview(ports(), { emailDomain: DOMAIN });
    expect(before).toMatchObject({ orders: 2, paidOrders: 1, payments: 1, projects: 1, contributions: 1 });
    expect(before.parcels).toBe(await count("select count(*)::int n from public.parcels"));
    expect(before.files, "the shared pictures count once").toBe(files.size);
    expect(before.accounts, "4 volume accounts, 1 illustration account").toBeGreaterThanOrEqual(5);

    const r = await wipeEverything(ports(), { emailDomain: DOMAIN });
    expect(r).toMatchObject({ orders: 2, payments: 1, projects: 1, contributions: 1 });
    expect(r.parcels).toBe(before.parcels);
    expect(r.files).toBe(before.files);

    for (const t of ["parcels", "parcel_assets", "parcel_comments", "parcel_likes", "parcel_reservations", "parcel_collab", "moderation_reports"]) {
      expect(await count(`select count(*)::int n from public.${t}`), t).toBe(0);
    }
    expect(await count("select count(*)::int n from public.orders where parcel_id is not null"), "purchases").toBe(0);
    expect(await count("select count(*)::int n from public.payments"), "payments").toBe(0);
    expect(files.size, "every picture file is gone").toBe(0);
    expect(Number((await pool.query("select (public.px_public_stats()).parcels as n")).rows[0].n), "the public counter").toBe(0);
    expect(await count("select count(*)::int n from public.campaigns where status in ('open', 'funded')"), "no project is left holding a zone").toBe(0);
    expect(await count("select count(*)::int n from public.contributions"), "contributions of those projects").toBe(0);
    expect(await count("select version::int n from public.map_state where id = 1"), "browsers drop their tiles").toBeGreaterThan(versionBefore);

    // what stays: the people, and the history the database refuses to change
    expect(await count(`select count(*)::int n from auth.users where id in ('${buyer}', '${fan}')`), "real accounts stay").toBe(2);
    expect(await count("select count(*)::int n from auth.users where email like '%@demo.invalid'"), "demonstration accounts go").toBe(0);
    expect(await count("select count(*)::int n from public.audit_logs"), "the audit log is untouched").toBe(auditBefore);
    expect((await demoStatus(ports(), { emailDomain: DOMAIN })).allParcels).toBe(0);

    // the place is free again: the same rectangle can be bought anew
    const again = await startOrder(buyer, { x: 10, y: 10, w: 20, h: 20 });
    expect(await fulfill(again.order_id)).toBe("fulfilled");
    expect(again.parcel_id).not.toBe(paid.parcel_id);
  });

  it("does nothing, and says so, on a site that is already empty (and can be run twice)", async () => {
    const empty = await wipeEverything(ports(), { emailDomain: DOMAIN });
    expect(empty).toEqual({ demoAccounts: 0, illustrations: 0, parcels: 0, orders: 0, payments: 0, projects: 0, contributions: 0, files: 0, failed: [] });
    await aSiteWithEverything();
    await wipeEverything(ports(), { emailDomain: DOMAIN });
    expect(await wipeEverything(ports(), { emailDomain: DOMAIN })).toEqual({ demoAccounts: 0, illustrations: 0, parcels: 0, orders: 0, payments: 0, projects: 0, contributions: 0, files: 0, failed: [] });
  });

  it("when the database will not let an account go, it goes on, says which account and what still holds it, and the parcels are gone all the same", async () => {
    await aSiteWithEverything();
    const stuck = (await pool.query("select id from auth.users where email = 'demo-vol-001@demo.invalid'")).rows[0].id as string;
    const other = (await pool.query("select id from auth.users where email = 'demo-vol-002@demo.invalid'")).rows[0].id as string;
    // a project created by that account, still pending: it holds no zone (so the wipe leaves it) but it ties the account (campaigns.creator_id is RESTRICT)
    await pool.query(
      `select * from public.px_create_campaign($1, 3000, 3000, 100, 100, null, 'eur', 'land', 14, 'campaigns/s.png', 'def456', 100, 100, 1234, '#112233', 'Stuck', 'A project', null, false)`, [stuck]);

    const r = await wipeEverything(ports(), { emailDomain: DOMAIN });
    expect(await count("select count(*)::int n from public.parcels"), "every parcel is gone").toBe(0);
    expect(r.failed, "one account is left").toHaveLength(1);
    expect(r.failed[0]).toContain(stuck);
    expect(r.failed[0], "and the tool says what holds it").toMatch(/campaigns\.creator_id \(1 row\)/);
    expect(await count(`select count(*)::int n from auth.users where id = '${stuck}'`)).toBe(1);
    expect(await count(`select count(*)::int n from auth.users where id = '${other}'`), "the others went").toBe(0);
    expect(r.demoAccounts, "the ones that went are counted").toBeGreaterThanOrEqual(4);

    // running it again retries: still held, still said
    const again = await wipeEverything(ports(), { emailDomain: DOMAIN });
    expect(again.failed).toHaveLength(1);
  });

  it("leaves the projects that are over, the editions and the settings alone", async () => {
    const { buyer, camp } = await aSiteWithEverything();
    await pool.query("select public.px_cancel_campaign($1, $2)", [buyer, camp.id]); // over: it holds no zone any more, nothing depends on a parcel
    const settings = await count("select count(*)::int n from public.app_settings");
    const editions = await count("select count(*)::int n from public.editions");
    await wipeEverything(ports(), { emailDomain: DOMAIN });
    expect(await count("select count(*)::int n from public.app_settings")).toBe(settings);
    expect(await count("select count(*)::int n from public.editions")).toBe(editions);
    expect(await count("select count(*)::int n from public.editions where status = 'open'"), "the edition is still open").toBe(1);
    expect(await count("select count(*)::int n from public.campaigns where status = 'cancelled'"), "a project that is over stays").toBe(1);
  });
});
