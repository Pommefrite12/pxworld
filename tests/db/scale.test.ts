import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createUser, databaseUrl, expectPgError, pool, startOrder } from "./helpers";

/**
 * "The map must not slow down after thousands of purchases." 200 000 parcels (20 million pixels) are inserted
 * directly, then every hot read/write path is checked for index use and latency.
 */
const N = 200_000;
let owner: string;
let getTile: typeof import("@/lib/data/map").getTile;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  delete (globalThis as { __pxPool?: unknown }).__pxPool;
  ({ getTile } = await import("@/lib/data/map"));
  owner = await createUser("whale");
  await pool.query(
    `insert into public.parcels (code, owner_id, x, y, w, h, status, activated_at)
     select lpad(to_hex(i), 10, '0'), $1, (i % 3300) * 12, (i / 3300) * 12, 10, 10, 'active', now() from generate_series(0, $2::int - 1) i`,
    [owner, N],
  );
  await pool.query("analyze public.parcels");
}, 180_000);

afterAll(async () => {
  await (globalThis as unknown as { __pxPool?: { end(): Promise<void> } }).__pxPool?.end();
  await closeDb();
});

const time = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = performance.now();
  const r = await fn();
  return [r, performance.now() - t];
};

describe(`with ${N.toLocaleString("en")} parcels`, () => {
  it("the exclusion constraint still rejects overlaps instantly", async () => {
    const u = await createUser();
    const [, ms] = await time(() => expectPgError(startOrder(u, { x: 5, y: 5, w: 10, h: 10 }), "px_parcel_unavailable"));
    expect(ms).toBeLessThan(500);
    const [ok, ms2] = await time(() => startOrder(u, { x: 11, y: 1, w: 1, h: 100 })); // the 2px gutter between columns
    expect(ok.parcel_id).toBeTruthy();
    expect(ms2).toBeLessThan(500);
  });

  it("a viewport tile uses the GiST index and returns in well under a second", async () => {
    const { rows } = await pool.query(
      `explain (format json) select p.code from public.parcels p where p.status = 'active' and p.bbox && box(point(0, 0), point(999, 999))`,
    );
    expect(JSON.stringify(rows[0])).toContain("parcels_active_bbox_idx");
    const [tile, ms] = await time(() => getTile(0, 0));
    expect(tile.length).toBe(84 * 61); // 84 columns × 61 rows of parcels fall in the first 1000×1000 tile
    expect(ms).toBeLessThan(1000);
    const [far, ms3] = await time(() => getTile(39, 24));
    expect(far).toEqual([]); // outside the populated block
    expect(ms3).toBeLessThan(200);
  });

  it("public statistics are exact", async () => {
    const [{ rows }, ms] = await time(() => pool.query("select * from public.px_public_stats()"));
    expect(rows[0]).toMatchObject({ sold_pixels: N * 100, parcels: N, owners: 1 });
    expect(ms).toBeLessThan(2000);
  });

  it("expiring reservations and availability probes stay on indexes", async () => {
    const plan = JSON.stringify((await pool.query(`explain (format json) select * from public.parcel_reservations where status = 'held' and expires_at <= now() limit 500`)).rows[0]);
    expect(plan).toMatch(/parcel_reservations_expiry_idx|Index/);
    const [free, ms] = await time(async () => (await pool.query("select public.px_is_area_free(30000, 15000, 20, 20) as f")).rows[0].f);
    expect(free).toBe(true);
    expect(ms).toBeLessThan(200);
  });
});
