import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

/** An active parcel (paid) of `w × h` pixels owned by `owner`. */
async function activeParcel(owner: string, w = 10, h = 10, x = 100) {
  const o = await startOrder(owner, { x, y: 100, w, h });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  return o.parcel_id;
}
const enable = async (user: string, parcel: string, rotate = false) =>
  (await pool.query(`select public.px_collab_enable($1, $2, $3) as t`, [user, parcel, rotate])).rows[0].t as string;
const paint = async (token: string, px: [number, number, number][]) =>
  Number((await pool.query(`select public.px_collab_paint($1, $2, $3, $4) as v`, [token, px.map((p) => p[0]), px.map((p) => p[1]), px.map((p) => p[2])])).rows[0].v);
const pixels = async (parcel: string) =>
  (await pool.query(`select x, y, rgb, version::int from public.parcel_collab_pixels where parcel_id = $1 order by y, x`, [parcel])).rows;
const row = async (parcel: string) => (await pool.query(`select * from public.parcel_collab where parcel_id = $1`, [parcel])).rows[0];

describe("sharing a parcel for drawing together", () => {
  it("only the owner of an active parcel can switch sharing on, and gets an unguessable link", async () => {
    const [owner, stranger] = [await createUser("owner"), await createUser("stranger")];
    const parcel = await activeParcel(owner);
    const token = await enable(owner, parcel);
    expect(token).toMatch(/^[0-9a-f]{40}$/);
    expect(await enable(owner, parcel)).toBe(token); // asking again returns the same link
    await expectPgError(enable(stranger, parcel), "px_forbidden");
    // a parcel that is only reserved (not paid) cannot be shared
    const reserved = (await startOrder(owner, { x: 300, y: 100, w: 10, h: 10 })).parcel_id;
    await expectPgError(enable(owner, reserved), "px_parcel_not_active");
    const tokens = new Set([token]);
    for (let i = 0; i < 9; i++) { const u = await createUser("other"); tokens.add(await enable(u, await activeParcel(u, 10, 10, 1000 + i * 50))); }
    expect(tokens.size).toBe(10); // every parcel gets its own link
  });

  it("renewing the link kills the old one but keeps the drawing; cutting it closes it", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner);
    const old = await enable(owner, parcel);
    await paint(old, [[1, 1, 0xff0000]]);
    const fresh = await enable(owner, parcel, true);
    expect(fresh).not.toBe(old);
    await expectPgError(paint(old, [[2, 2, 0x00ff00]]), "px_collab_closed");
    await paint(fresh, [[2, 2, 0x00ff00]]);
    expect((await pixels(parcel)).map((p) => [p.x, p.y, p.rgb])).toEqual([[1, 1, 0xff0000], [2, 2, 0x00ff00]]);

    await pool.query(`select public.px_collab_disable($1, $2)`, [owner, parcel]);
    await expectPgError(paint(fresh, [[3, 3, 1]]), "px_collab_closed");
    expect(await enable(owner, parcel)).toBe(fresh); // switching on again brings the same link and the drawing back
    await paint(fresh, [[3, 3, 1]]);
    expect(await pixels(parcel)).toHaveLength(3);
  });

  it("owner actions are journalised", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner);
    await enable(owner, parcel);
    await enable(owner, parcel, true);
    await pool.query(`select public.px_collab_reset($1, $2)`, [owner, parcel]);
    await pool.query(`select public.px_collab_disable($1, $2)`, [owner, parcel]);
    const { rows } = await pool.query(`select action, actor_role from public.audit_logs where target_id = $1 and action like 'collab.%' order by id`, [parcel]);
    expect(rows).toEqual(["collab.enable", "collab.rotate", "collab.reset", "collab.disable"].map((action) => ({ action, actor_role: "owner" })));
  });
});

describe("painting", () => {
  it("anyone holding the token paints; versions go up, the last write of a pixel wins", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner);
    const token = await enable(owner, parcel);
    expect(await paint(token, [[0, 0, 0xff0000], [9, 9, 0x0000ff]])).toBe(1);
    expect(await paint(token, [[0, 0, 0x00ff00]])).toBe(2);
    expect(await pixels(parcel)).toEqual([{ x: 0, y: 0, rgb: 0x00ff00, version: 2 }, { x: 9, y: 9, rgb: 0x0000ff, version: 1 }]);
    expect((await row(parcel)).version).toBe("2");
    // inside one batch the last value wins, and a repeated pixel is not an error
    await paint(token, [[5, 5, 1], [5, 5, 2], [5, 5, 3]]);
    expect((await pixels(parcel)).find((p) => p.x === 5)!.rgb).toBe(3);
  });

  it("a bad batch changes nothing: out of bounds, wrong colour, nulls, empty, mismatched or oversized", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner, 10, 10);
    const token = await enable(owner, parcel);
    const bad = (xs: unknown, ys: unknown, rgb: unknown, code: string) =>
      expectPgError(pool.query(`select public.px_collab_paint($1, $2::int[], $3::int[], $4::int[])`, [token, xs, ys, rgb]), code);
    await bad([20], [0], [1], "px_collab_out_of_bounds"); // x = 2w: the overlay is made of dots, two per pixel
    await bad([0], [20], [1], "px_collab_out_of_bounds"); // y = 2h
    await bad([-1], [0], [1], "px_collab_out_of_bounds");
    await bad([0], [0], [16777216], "px_collab_out_of_bounds");
    await bad([0], [0], [-1], "px_collab_out_of_bounds");
    await bad([0, 1], [0, 1], [1, null], "px_collab_out_of_bounds");
    await bad([], [], [], "px_collab_bad_batch");
    await bad([0, 1], [0], [1], "px_collab_bad_batch");
    await bad(Array(2001).fill(0), Array(2001).fill(0), Array(2001).fill(1), "px_collab_bad_batch");
    // a good pixel next to a bad one is not applied either
    await bad([0, 99], [0, 0], [1, 1], "px_collab_out_of_bounds");
    await paint(token, [[19, 19, 1]]); // the last dot of a 10 × 10 pixel parcel is inside
    await pool.query(`delete from public.parcel_collab_pixels`);
    await pool.query(`update public.parcel_collab set version = 0`);
    expect(await pixels(parcel)).toHaveLength(0);
    expect((await row(parcel)).version).toBe("0");
    // the largest allowed batch is accepted
    const big = await activeParcel(owner, 50, 50, 400);
    const bt = await enable(owner, big);
    const pts = Array.from({ length: 2000 }, (_, i) => [i % 50, Math.floor(i / 50), i] as [number, number, number]);
    await paint(bt, pts);
    expect(await pixels(big)).toHaveLength(2000);
  });

  it("an unknown token is simply closed, and tokens are not matched loosely", async () => {
    await expectPgError(paint("0".repeat(40), [[0, 0, 1]]), "px_collab_closed");
    await expectPgError(paint("", [[0, 0, 1]]), "px_collab_closed");
    await expectPgError(paint("' or true --", [[0, 0, 1]]), "px_collab_closed");
  });

  it("a parcel hidden by moderation, revoked, or whose owner is suspended stops accepting strokes", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner);
    const token = await enable(owner, parcel);
    await paint(token, [[0, 0, 1]]);
    await pool.query(`update public.parcels set hidden_at = now() where id = $1`, [parcel]);
    await expectPgError(paint(token, [[1, 1, 1]]), "px_collab_closed");
    await pool.query(`update public.parcels set hidden_at = null where id = $1`, [parcel]);
    await paint(token, [[1, 1, 1]]);
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [owner]);
    await expectPgError(paint(token, [[2, 2, 1]]), "px_collab_closed");
    await expectPgError(enable(owner, parcel), "px_account_suspended");
    await pool.query(`update public.profiles set status = 'active' where id = $1`, [owner]);
    await pool.query(`update public.parcels set status = 'revoked' where id = $1`, [parcel]);
    await expectPgError(paint(token, [[3, 3, 1]]), "px_collab_closed");
  });

  it("resetting wipes the overlay and tells clients to reload", async () => {
    const owner = await createUser("owner"), stranger = await createUser("stranger");
    const parcel = await activeParcel(owner);
    const token = await enable(owner, parcel);
    await paint(token, [[0, 0, 1], [1, 1, 2]]);
    await expectPgError(pool.query(`select public.px_collab_reset($1, $2)`, [stranger, parcel]), "px_forbidden");
    const v = Number((await pool.query(`select public.px_collab_reset($1, $2) as v`, [owner, parcel])).rows[0].v);
    expect(await pixels(parcel)).toHaveLength(0);
    expect(await row(parcel)).toMatchObject({ version: String(v), reset_version: String(v) });
    expect(await paint(token, [[2, 2, 3]])).toBe(v + 1); // strokes after the reset carry on from the new version
  });
});

describe("many people painting at once", () => {
  it("40 simultaneous batches are all kept; versions are unique and follow commit order", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner, 40, 40, 500);
    const token = await enable(owner, parcel);
    const versions = await Promise.all(Array.from({ length: 40 }, (_, i) => paint(token, Array.from({ length: 40 }, (_, j) => [j, i, i * 40 + j] as [number, number, number]))));
    expect(new Set(versions).size).toBe(40);
    expect(Math.max(...versions)).toBe(40);
    const all = await pixels(parcel);
    expect(all).toHaveLength(1600);
    for (const p of all) expect(p.rgb).toBe(p.y * 40 + p.x);
    // "everything after version N" never misses a change: reading in versions order gives each batch exactly once
    const byVersion = new Map<number, number>();
    for (const p of all) byVersion.set(p.version, (byVersion.get(p.version) ?? 0) + 1);
    expect([...byVersion.values()].every((n) => n === 40)).toBe(true);
  });

  it("two people fighting over the same pixel end up with one coherent value", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner);
    const token = await enable(owner, parcel);
    const vs = await Promise.all(Array.from({ length: 30 }, (_, i) => paint(token, [[4, 4, i + 1]])));
    const [p] = await pixels(parcel);
    // the surviving colour is the one written by the highest version
    expect(p!.rgb).toBe(vs.indexOf(Math.max(...vs)) + 1);
    expect(p!.version).toBe(30);
  });
});

describe("permissions", () => {
  it("the browser roles cannot read the tokens or the overlay, nor call the functions", async () => {
    const owner = await createUser("owner");
    const parcel = await activeParcel(owner);
    const token = await enable(owner, parcel);
    await paint(token, [[0, 0, 1]]);
    for (const role of ["anon", "authenticated"]) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`set local role ${role}`);
        await expect(c.query(`select token from public.parcel_collab`)).rejects.toThrow(/permission denied/);
        await c.query("rollback");
        await c.query("begin");
        await c.query(`set local role ${role}`);
        await expect(c.query(`select * from public.parcel_collab_pixels`)).rejects.toThrow(/permission denied/);
        await c.query("rollback");
        await c.query("begin");
        await c.query(`set local role ${role}`);
        await expect(c.query(`select public.px_collab_paint($1, '{0}', '{0}', '{1}')`, [token])).rejects.toThrow(/permission denied/);
        await c.query("rollback");
      } finally { c.release(); }
    }
  });
});
