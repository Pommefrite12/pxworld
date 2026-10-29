import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, overlappingPairs, pool, resetData } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const insertParcel = (owner: string, x: number, y: number, w: number, h: number, status = "active") =>
  pool.query(`insert into public.parcels (owner_id, x, y, w, h, status) values ($1, $2, $3, $4, $5, $6)`, [owner, x, y, w, h, status]);

describe("parcels table integrity (no application code involved)", () => {
  it("rejects any overlapping insert, whatever the geometry", async () => {
    const u = await createUser();
    await insertParcel(u, 100, 100, 20, 20);
    for (const [x, y, w, h] of [
      [100, 100, 20, 20], // identical
      [110, 110, 20, 20], // partial
      [105, 105, 10, 10], // contained
      [90, 90, 100, 100], // containing
      [119, 119, 10, 10], // single shared corner cell
      [100, 119, 20, 10], // shares one row
      [119, 100, 10, 20], // shares one column
    ] as const) {
      await expectPgError(insertParcel(u, x, y, w, h), "parcels_no_overlap");
    }
    expect(await overlappingPairs()).toBe(0);
  });

  it("allows parcels that merely touch", async () => {
    const u = await createUser();
    await insertParcel(u, 100, 100, 20, 20);
    await insertParcel(u, 120, 100, 20, 20); // right
    await insertParcel(u, 80, 100, 20, 20); // left
    await insertParcel(u, 100, 120, 20, 20); // below
    await insertParcel(u, 100, 80, 20, 20); // above
    await insertParcel(u, 120, 120, 20, 20); // diagonal
    expect(await overlappingPairs()).toBe(0);
  });

  it("frees the pixels once a parcel is released, revoked", async () => {
    const u = await createUser();
    await insertParcel(u, 0, 0, 10, 10, "released");
    await insertParcel(u, 0, 0, 10, 10, "revoked");
    await insertParcel(u, 0, 0, 10, 10, "active");
    await expectPgError(insertParcel(u, 5, 5, 10, 10, "reserved"), "parcels_no_overlap");
  });

  it("rejects out-of-grid, too small, and too large rectangles", async () => {
    const u = await createUser();
    await expectPgError(insertParcel(u, -1, 0, 10, 10), "parcels_integers_in_grid");
    await expectPgError(insertParcel(u, 49_995, 0, 10, 10), "parcels_integers_in_grid");
    await expectPgError(insertParcel(u, 0, 19_995, 10, 10), "parcels_integers_in_grid");
    await expectPgError(insertParcel(u, 0, 0, 9, 10), "parcels_min_area");
    await expectPgError(insertParcel(u, 0, 0, 0, 100), "parcels_integers_in_grid");
    await expectPgError(insertParcel(u, 0, 0, 1001, 1), "parcels_side_cap");
    await insertParcel(u, 49_990, 19_990, 10, 10); // last cells of the grid are valid
  });
});
