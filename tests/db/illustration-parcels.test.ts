import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CREATIONS_RANKING_SQL } from "@/lib/ranking";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(async () => {
  await resetData();
  for (const [k, v] of [["free_parcels_open", true], ["free_parcels_days", 60], ["free_parcels_cap", 5000], ["free_max_area", 24], ["free_lifetime_max", 3]] as const) {
    await pool.query(`update public.app_settings set value = $2::jsonb where key = $1`, [k, JSON.stringify(v)]);
  }
});

/** An illustration parcel, as the demonstration tool makes it: straight in the table, owned by the technical account. */
const illustration = async (owner: string, x: number, y: number, w = 30, h = 30, kind = "land") =>
  (await pool.query(`insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at) values ($1, $2, $3, $4, $5, 'active', 'illustration', $6, $7, now()) returning id`,
    [owner, x, y, w, h, kind, kind === "land" ? w * h : 0])).rows[0].id as string;
const row = async (id: string) => (await pool.query(`select * from public.parcels where id = $1`, [id])).rows[0];
const stats = async () => (await pool.query(`select * from public.px_public_stats()`)).rows[0];
const place = (user: string, x: number, y: number, w: number, h: number) =>
  pool.query(`select * from public.px_place_free_parcel($1, $2, $3, $4, $5, null)`, [user, x, y, w, h]).then((r) => r.rows[0]);
async function buy(user: string, x: number, y: number, w = 5, h = 5) {
  const o = await startOrder(user, { x, y, w, h });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  return o.parcel_id as string;
}

describe("illustration parcels", () => {
  it("are 25 to 2 500 pixels (up to 50 × 50) and on land: the table says so", async () => {
    const owner = await createUser("system");
    expect(await illustration(owner, 1000, 1000, 50, 50)).toBeTruthy(); // the biggest
    expect(await illustration(owner, 1100, 1000, 5, 5)).toBeTruthy(); // the smallest
    await expectPgError(illustration(owner, 1200, 1000, 51, 50), "parcels_min_area");
    await expectPgError(illustration(owner, 1300, 1000, 4, 4), "parcels_min_area");
    await expectPgError(illustration(owner, 1400, 1000, 30, 30, "water"), "parcels_free_is_land");
    // the free ones keep their own limit
    await expectPgError(pool.query(`insert into public.parcels (owner_id, x, y, w, h, status, tier) values ($1, 900, 900, 30, 30, 'active', 'free')`, [owner]), "parcels_min_area");
  });

  it("are counted nowhere: not as sold pixels, not as parcels, not as owners, not as free imprints, and they use no free-period turn", async () => {
    const owner = await createUser("system");
    const ill = await illustration(owner, 1000, 1000, 40, 40);
    const { rows: [asset] } = await pool.query(`insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, status, published_at)
      values ($1, $2, 1, 'creations/x.png', 'abcdef', 40, 40, 10, '#112233', 'Illustration', 'approved', now()) returning id`, [ill, owner]);
    await pool.query(`update public.parcels set published_asset_id = $1 where id = $2`, [asset.id, ill]);
    expect(await stats()).toMatchObject({ sold_pixels: "0", parcels: "0", owners: "0", free_parcels: "0", free_pixels: "0", published_creations: "0" });
    const st = (await pool.query(`select public.px_free_status($1) as s`, [owner])).rows[0].s;
    expect(st).toMatchObject({ used: 0, userReason: null });
  });

  it("never overlap a free parcel or another illustration, and nobody can place a free parcel over one", async () => {
    const owner = await createUser("system"), visitor = await createUser("visitor");
    await illustration(owner, 1000, 1000, 30, 30);
    await expectPgError(illustration(owner, 1010, 1010, 30, 30), "parcels_no_overlap_free");
    await expectPgError(place(visitor, 1005, 1005, 3, 3), "px_parcel_unavailable");
    expect((await place(visitor, 1100, 1100, 3, 3)).parcel_id).toBeTruthy(); // elsewhere: fine
  });

  it("never block a purchase: a paid parcel that touches one covers it, whole and for good, and the sold counters are the purchase's alone", async () => {
    const owner = await createUser("system"), buyer = await createUser("buyer");
    const ill = await illustration(owner, 1000, 1000, 30, 30);
    const paid = await buy(buyer, 1025, 1025); // 5 × 5, over its lower-right corner
    expect(await row(ill)).toMatchObject({ status: "covered", covered_by: paid });
    expect((await row(ill)).covered_at).toBeTruthy();
    expect(await stats()).toMatchObject({ sold_pixels: "25", parcels: "1", owners: "1", free_parcels: "0" });
    // a covered illustration is gone from the map: its place can be bought again, and nothing of it is "taken"
    expect(await buy(await createUser("again"), 1000, 1000)).toBeTruthy();
  });

  it("are covered by the same purchase as a free parcel next to it, each by its own rule", async () => {
    const owner = await createUser("system"), gift = await createUser("gift"), buyer = await createUser("buyer");
    const ill = await illustration(owner, 1000, 1000, 20, 20);
    const free = (await place(gift, 1020, 1000, 3, 3)).parcel_id as string; // just to the right
    const paid = await buy(buyer, 1018, 1001, 5, 5); // covers the right edge of the illustration and the free parcel
    expect(await row(ill)).toMatchObject({ status: "covered", covered_by: paid });
    expect(await row(free)).toMatchObject({ status: "covered", covered_by: paid });
  });

  it("do not count in the ranking: a creation that is an illustration is never ranked, whoever liked it", async () => {
    const owner = await createUser("system"), fan = await createUser("fan");
    const ill = await illustration(owner, 1000, 1000, 30, 30);
    await pool.query(`insert into public.parcel_likes (user_id, parcel_id) values ($1, $2)`, [fan, ill]);
    expect((await pool.query(CREATIONS_RANKING_SQL, [null])).rows).toHaveLength(0);
  });

  it("are flagged \"not paid\" on the map's tiles, like the free ones (a purchase may go over them)", async () => {
    const owner = await createUser("system");
    await illustration(owner, 1000, 1000, 30, 30);
    const { rows } = await pool.query(`select (p.tier <> 'paid') as free from public.parcels p where p.status = 'active'`);
    expect(rows).toEqual([{ free: true }]);
  });
});
