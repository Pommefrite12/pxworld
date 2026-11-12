import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/archive";
import { closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(async () => {
  await resetData();
  await pool.query(`truncate public.campaigns cascade`);
  await pool.query(`update public.app_settings set value = '10000'::jsonb where key = 'campaign_min_area'`);
});

const mod = () => createUser("mod", { role: "moderator" });
async function parcelOf(owner: string, x = 100) {
  const o = await startOrder(owner, { x, y: 100, w: 5, h: 5 });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  return o.parcel_id as string;
}
const newVersion = async (owner: string, parcel: string, tag = "v") =>
  (await pool.query(`select * from public.px_add_asset($1, $2, $3, 'abcdef', 5, 5, 10, '#112233', 'A trace', null, null, false)`, [owner, parcel, `creations/${parcel}-${tag}.png`])).rows[0] as { id: string };
const annotate = (user: string, asset: string, cat: string | null, label: string | null, country: string | null) =>
  pool.query(`select public.px_set_asset_archive($1, $2, $3, $4, $5)`, [user, asset, cat, label, country]);
const asset = async (id: string) => (await pool.query(`select category, place_label, place_country from public.parcel_assets where id = $1`, [id])).rows[0];

describe("the archive fields of a creation: a category, and the place it is about", () => {
  it("are kept on the version the owner has just sent, cleaned (spaces, upper-case country, empty = nothing)", async () => {
    const owner = await createUser("owner");
    const p = await parcelOf(owner);
    const a = await newVersion(owner, p);
    expect(await asset(a.id)).toEqual({ category: null, place_label: null, place_country: null }); // before: nothing, as for every older creation
    await annotate(owner, a.id, "  food ", "  Naples  ", " it ");
    expect(await asset(a.id)).toEqual({ category: "food", place_label: "Naples", place_country: "IT" });
    await annotate(owner, a.id, "other", "", "");
    expect(await asset(a.id)).toEqual({ category: "other", place_label: null, place_country: null });
    await annotate(owner, a.id, null, null, null);
    expect(await asset(a.id)).toEqual({ category: null, place_label: null, place_country: null });
  });

  it("accept exactly the categories of the interface, and refuse anything else", async () => {
    const owner = await createUser("owner");
    const a = await newVersion(owner, await parcelOf(owner));
    const def = (await pool.query(`select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.parcel_assets'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%category%'`)).rows[0].d as string;
    const inDb = [...def.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    expect(inDb).toEqual([...CATEGORIES].sort()); // the list of the code and the list of the database are the same one
    for (const c of CATEGORIES) await annotate(owner, a.id, c, null, null);
    for (const bad of ["Food", "pizza", "arts; drop table parcels", "x".repeat(40)]) await expectPgError(annotate(owner, a.id, bad, null, null), "px_invalid_archive");
  });

  it("refuse a place that is too long and a country that is not two letters; and no coordinates exist at all", async () => {
    const owner = await createUser("owner");
    const a = await newVersion(owner, await parcelOf(owner));
    await annotate(owner, a.id, "arts", "x".repeat(80), "FR"); // 80 is the limit
    await expectPgError(annotate(owner, a.id, "arts", "x".repeat(81), null), "px_invalid_archive");
    for (const bad of ["FRA", "F", "1A", "é"]) await expectPgError(annotate(owner, a.id, "arts", "Paris", bad), "px_invalid_archive");
    const cols = (await pool.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name in ('parcel_assets', 'campaigns') and (column_name like '%lat%' or column_name like '%lng%' or column_name like '%lon%' or column_name like '%coord%')`)).rows;
    expect(cols).toEqual([]); // a precise position would be personal data: it is never stored
  });

  it("can only be set by the author, on a version still waiting for moderation", async () => {
    const [owner, other, moderator] = [await createUser("owner"), await createUser("other"), await mod()];
    const p = await parcelOf(owner);
    const a = await newVersion(owner, p);
    await expectPgError(annotate(other, a.id, "arts", null, null), "px_forbidden");
    await expectPgError(annotate(owner, "00000000-0000-0000-0000-000000000000", "arts", null, null), "px_forbidden");
    await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [moderator, a.id]);
    await expectPgError(annotate(owner, a.id, "arts", null, null), "px_not_pending"); // an approved version is not rewritten
  });

  it("are frozen with the creations once the edition is frozen", async () => {
    const owner = await createUser("owner");
    const a = await newVersion(owner, await parcelOf(owner));
    await pool.query(`update public.editions set opens_at = now() - interval '366 days', closes_at = now() - interval '40 minutes'`);
    await expectPgError(annotate(owner, a.id, "arts", null, null), "px_edition_frozen");
  });

  it("are never reachable by the browser roles", async () => {
    const { asRole } = await import("./helpers");
    const owner = await createUser("owner");
    const a = await newVersion(owner, await parcelOf(owner));
    await expectPgError(asRole("authenticated", owner, (c) => c.query(`select public.px_set_asset_archive($1, $2, 'arts', null, null)`, [owner, a.id])), "42501");
    await expectPgError(asRole("authenticated", owner, (c) => c.query(`update public.parcel_assets set category = 'arts' where id = $1`, [a.id])), /42501|permission/);
  });
});

describe("a group project carries them to the creation it becomes", () => {
  const create = async (user: string) =>
    (await pool.query(`select * from public.px_create_campaign($1, 1000, 1000, 100, 100, null, 'eur', 'land', 14, $2, 'abc123', 100, 100, 1234, '#112233', 'Our wall', 'for all', null, false)`, [user, `campaigns/${user}.png`])).rows[0] as { id: string };
  const setArchive = (user: string, id: string, cat: string | null, label: string | null, country: string | null) =>
    pool.query(`select public.px_set_campaign_archive($1, $2, $3, $4, $5)`, [user, id, cat, label, country]);

  it("is set by its creator while it is pending, and copied onto the creation when a moderator approves it", async () => {
    const [moderator, maker, stranger] = [await mod(), await createUser("maker"), await createUser("stranger")];
    const c = await create(maker);
    await expectPgError(setArchive(stranger, c.id, "arts", null, null), "px_forbidden");
    await expectPgError(setArchive(maker, c.id, "nope", null, null), "px_invalid_archive");
    await setArchive(maker, c.id, "arts", " Lagrasse ", "fr");
    expect((await pool.query(`select category, place_label, place_country from public.campaigns where id = $1`, [c.id])).rows[0]).toEqual({ category: "arts", place_label: "Lagrasse", place_country: "FR" });
    await pool.query(`select public.px_review_campaign($1, $2, 'approve', null)`, [moderator, c.id]);
    const { rows: [a] } = await pool.query(`select a.category, a.place_label, a.place_country from public.campaigns c join public.parcel_assets a on a.parcel_id = c.parcel_id where c.id = $1`, [c.id]);
    expect(a).toEqual({ category: "arts", place_label: "Lagrasse", place_country: "FR" });
    await expectPgError(setArchive(maker, c.id, "sport", null, null), "px_not_pending"); // once reviewed it is not annotated any more
  });

  it("works for a project that has no archive fields at all (the API does not require them)", async () => {
    const [moderator, maker] = [await mod(), await createUser("maker")];
    const c = await create(maker);
    await pool.query(`select public.px_review_campaign($1, $2, 'approve', null)`, [moderator, c.id]);
    const { rows: [a] } = await pool.query(`select a.category, a.place_label from public.campaigns c join public.parcel_assets a on a.parcel_id = c.parcel_id where c.id = $1`, [c.id]);
    expect(a).toEqual({ category: null, place_label: null });
  });
});
