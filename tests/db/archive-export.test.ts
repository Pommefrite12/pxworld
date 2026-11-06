import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { exportArchive, verifyExport, verifyStored } from "@/lib/preservation/export";
import { parseManifest, sha256Hex } from "@/lib/preservation/manifest";
import { listFiles } from "@/lib/preservation/node";
import { asRole, closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

/**
 * The snapshot of the closing, and what is made of it: the manifest carries the archive fields (migration 21), is the text the hash is the hash of,
 * and an export built from it — pictures from a storage, written to a real folder — checks out, and betrays a change.
 */
const closedAgo = (minutes: number) => pool.query(`update public.editions set status = 'open', opens_at = now() - interval '101 days', closes_at = now() - make_interval(mins => $1), closed_at = null`, [minutes]);
const sweep = async () => (await pool.query(`select public.px_edition_sweep() as r`)).rows[0].r as string;
const picture = (n: number) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n, n * 3 % 251, n * 7 % 251]);

/** A paid parcel with a creation that exists as a file, approved, with its category and place. */
async function published(owner: string, moderator: string, x: number, title: string, n: number, archive: [string | null, string | null, string | null] = ["food", "Naples", "IT"]) {
  const bytes = picture(n);
  const o = await startOrder(owner, { x, y: 100, w: 5, h: 5 });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  const storagePath = `creations/${o.parcel_id}-${x}.png`;
  const { rows: [a] } = await pool.query(`select * from public.px_add_asset($1, $2, $3, $4, 5, 5, $5, '#112233', $6, 'A description, with "quotes"', null, false)`, [owner, o.parcel_id, storagePath, sha256Hex(bytes), bytes.length, title]);
  await pool.query(`select public.px_set_asset_archive($1, $2, $3, $4, $5)`, [owner, a.id, ...archive]);
  await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [moderator, a.id]);
  const { rows: [p] } = await pool.query(`select code from public.parcels where id = $1`, [o.parcel_id]);
  return { id: o.parcel_id as string, code: p.code as string, storagePath, bytes };
}

/** Closes the edition (the way the clock does) and returns the snapshots as the export script reads them. */
async function close() {
  await closedAgo(40);
  expect(await sweep()).toBe("finalized");
}
const readSnapshot = async (revision: number) => {
  const { rows: [s] } = await pool.query(`select revision, taken_at, manifest::text as manifest_text, manifest_hash, parcel_count from public.edition_snapshots where revision = $1`, [revision]);
  return { revision: s.revision as number, takenAt: (s.taken_at as Date).toISOString(), manifestText: s.manifest_text as string, recordedHash: s.manifest_hash as string, parcelCount: s.parcel_count as number };
};

describe("the manifest function (migration 21)", () => {
  it("answers what the public can see, with the archive fields, and changes nothing", async () => {
    const mod = await createUser("mod", { role: "moderator" }), a = await createUser("a");
    const one = await published(a, mod, 100, "Pizza", 1);
    const hiddenOwner = await createUser("h");
    const hidden = await published(hiddenOwner, mod, 300, "Hidden", 2);
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'x')`, [mod, hidden.id]);
    const before = (await pool.query(`select count(*)::int as n from public.edition_snapshots`)).rows[0].n;
    const { rows: [m1] } = await pool.query(`select public.px_edition_manifest()::text as t`);
    const { rows: [m2] } = await pool.query(`select public.px_edition_manifest()::text as t`);
    expect(m1.t).toBe(m2.t); // a read: the same twice
    expect((await pool.query(`select count(*)::int as n from public.edition_snapshots`)).rows[0].n).toBe(before); // nothing stored
    const items = parseManifest(m1.t);
    expect(items.map((i) => i.code)).toEqual([one.code]); // the hidden one is not in it
    expect(items[0]!.creation).toMatchObject({ title: "Pizza", category: "food", place_label: "Naples", place_country: "IT", content_hash: sha256Hex(one.bytes), storage_path: one.storagePath });
  });

  it("is not for the browser: only the server's own role may ask", async () => {
    await expectPgError(asRole("anon", null, (c) => c.query(`select public.px_edition_manifest()`)), "42501");
    const u = await createUser("u");
    await expectPgError(asRole("authenticated", u, (c) => c.query(`select public.px_edition_manifest()`)), "42501");
  });

  it("gives null archive fields for a creation made without them, not a failure", async () => {
    const mod = await createUser("mod", { role: "moderator" }), a = await createUser("a");
    await published(a, mod, 100, "Plain", 4, [null, null, null]);
    const { rows: [m] } = await pool.query(`select public.px_edition_manifest()::text as t`);
    expect(parseManifest(m.t)[0]!.creation).toMatchObject({ category: null, place_label: null, place_country: null });
  });
});

describe("the closing snapshot", () => {
  it("holds the same manifest (the hash is the hash of its text), archive fields included", async () => {
    const mod = await createUser("mod", { role: "moderator" }), a = await createUser("a"), b = await createUser("b");
    const one = await published(a, mod, 100, "Pizza", 1), two = await published(b, mod, 300, "Garden", 2, ["nature", "Montréal", "CA"]);
    const { rows: [live] } = await pool.query(`select public.px_edition_manifest()::text as t`);
    await close();
    const snap = await readSnapshot(1);
    expect(snap.manifestText).toBe(live.t); // what the snapshot stored is what the function said
    expect(sha256Hex(snap.manifestText)).toBe(snap.recordedHash);
    const items = parseManifest(snap.manifestText);
    expect(items.map((i) => i.code).sort()).toEqual([one.code, two.code].sort());
    expect(items.find((i) => i.code === two.code)!.creation).toMatchObject({ category: "nature", place_label: "Montréal", place_country: "CA" });
  });
});

describe("the export of a closed edition, read from a real database and written to a real folder", () => {
  /** A storage folder with the pictures, an export folder, and the ports of the export. */
  function folders() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pw-export-"));
    const storage = path.join(root, "storage"), out = path.join(root, "out");
    fs.mkdirSync(storage); fs.mkdirSync(out);
    const put = (p: string, b: Uint8Array) => { const f = path.join(storage, ...p.split("/")); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); };
    const readObject = async (p: string) => { try { return new Uint8Array(fs.readFileSync(path.join(storage, ...p.split("/")))); } catch { return null; } };
    const ports = { readObject, write: async (rel: string, d: Uint8Array) => { const f = path.join(out, ...rel.split("/")); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); } };
    const reader = { list: async () => listFiles(out), read: async (p: string) => { try { return new Uint8Array(fs.readFileSync(path.join(out, ...p.split("/")))); } catch { return null; } } };
    return { root, out, put, readObject, ports, reader };
  }
  const input = async (revision: number, earlier: { revision: number; codes: string[] }[] = []) => ({
    edition: { slug: "fondatrice", name: "Édition fondatrice", opensAt: null, closesAt: null, closedAt: null },
    snapshot: await readSnapshot(revision), earlier,
    labels: { en: { food: "Food and traditions", nature: "Nature and climate" }, fr: { food: "Cuisine et traditions", nature: "Nature et climat" } }, terms: null, exportedAt: new Date().toISOString(),
  });

  it("checks out, in the folder and against the live storage, and betrays a change in either", async () => {
    const mod = await createUser("mod", { role: "moderator" }), a = await createUser("a"), b = await createUser("b");
    const one = await published(a, mod, 100, "Pizza, with a comma", 1), two = await published(b, mod, 300, "=EVIL()", 2, ["nature", "Montréal", "CA"]);
    await close();
    const f = folders();
    try {
      f.put(one.storagePath, one.bytes); f.put(two.storagePath, two.bytes);
      const report = await exportArchive(await input(1), f.ports);
      expect(report).toMatchObject({ parcels: 2, creations: 2, problems: [] });
      expect(listFiles(f.out)).toEqual(expect.arrayContaining(["README.txt", "SHA256SUMS", "index.html", "manifest.json", "manifest.csv", `creations/${one.code}.png`, `creations/${two.code}.png`]));
      expect(fs.readFileSync(path.join(f.out, "manifest.json"), "utf8")).toBe((await readSnapshot(1)).manifestText);
      const csv = fs.readFileSync(path.join(f.out, "manifest.csv"), "utf8");
      expect(csv).toContain('"Pizza, with a comma"');
      expect(csv).toContain("'=EVIL()"); // a spreadsheet will not run it
      expect(fs.readFileSync(path.join(f.out, "index.html"), "utf8")).toContain("Nature and climate / Nature et climat");
      expect(await verifyExport(f.reader)).toMatchObject({ ok: true, creations: 2, problems: [] });
      const snap = await readSnapshot(1);
      expect(await verifyStored(snap, f.readObject)).toMatchObject({ ok: true, creations: 2 });

      // somebody swaps a picture in the storage: the live check names it; the export, made before, still holds the original
      f.put(one.storagePath, picture(99));
      const live = await verifyStored(snap, f.readObject);
      expect(live.ok).toBe(false);
      expect(live.problems.join("\n")).toContain(`${one.code}: the file does not match the hash recorded in the snapshot`);
      expect((await verifyExport(f.reader)).ok).toBe(true);
      // …and a picture of the export is swapped: the export check names it
      fs.writeFileSync(path.join(f.out, "creations", `${two.code}.png`), picture(98));
      const broken = await verifyExport(f.reader);
      expect(broken.ok).toBe(false);
      expect(broken.problems.join("\n")).toContain(`creations/${two.code}.png: the file was changed`);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });

  it("refuses to export when the storage lost a picture, and says which", async () => {
    const mod = await createUser("mod", { role: "moderator" }), a = await createUser("a");
    const one = await published(a, mod, 100, "Pizza", 1);
    await close();
    const f = folders();
    try {
      await expect(exportArchive(await input(1), f.ports)).rejects.toThrow(/Nothing was exported/);
      expect(listFiles(f.out)).toEqual([]);
      const report = await exportArchive(await input(1), f.ports, { keepGoing: true });
      expect(report.problems.join("\n")).toContain(`${one.code}: the file is missing`);
      expect(fs.readFileSync(path.join(f.out, "PROBLEMS.txt"), "utf8")).toContain(one.code);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });

  it("a retraction after the closing makes a new snapshot; the old one is untouched and the export lists what was taken away", async () => {
    const mod = await createUser("mod", { role: "moderator" }), boss = await createUser("boss", { role: "admin" }), a = await createUser("a"), b = await createUser("b");
    const keep = await published(a, mod, 100, "Keep", 1), gone = await published(b, mod, 300, "Gone", 2);
    await close();
    const first = await readSnapshot(1);
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'withdrawn')`, [mod, gone.id]);
    await pool.query(`select public.px_edition_take_snapshot($1)`, [boss]);
    expect(await readSnapshot(1)).toEqual(first); // the first is as it was
    const second = await readSnapshot(2);
    expect(parseManifest(second.manifestText).map((i) => i.code)).toEqual([keep.code]);
    const f = folders();
    try {
      f.put(keep.storagePath, keep.bytes); f.put(gone.storagePath, gone.bytes);
      await exportArchive(await input(2, [{ revision: 1, codes: parseManifest(first.manifestText).map((i) => i.code) }]), f.ports);
      expect(JSON.parse(fs.readFileSync(path.join(f.out, "retractions.json"), "utf8")).retractions).toEqual([{ code: gone.code, last_seen_revision: 1 }]);
      expect(listFiles(f.out)).not.toContain(`creations/${gone.code}.png`); // what was retracted is not in the new archive
      expect((await verifyExport(f.reader)).ok).toBe(true);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });

  it("a rehearsal before the closing, from the live tables, says PREVIEW and is never an archive", async () => {
    const mod = await createUser("mod", { role: "moderator" }), a = await createUser("a");
    const one = await published(a, mod, 100, "Pizza", 1);
    const { rows: [m] } = await pool.query(`select public.px_edition_manifest()::text as t`);
    const f = folders();
    try {
      f.put(one.storagePath, one.bytes);
      await exportArchive({
        edition: { slug: "fondatrice", name: "Édition fondatrice", opensAt: null, closesAt: null, closedAt: null },
        snapshot: { revision: null, takenAt: new Date().toISOString(), manifestText: m.t, recordedHash: null, parcelCount: null },
        earlier: [], labels: { en: {}, fr: {} }, terms: null, exportedAt: new Date().toISOString(),
      }, f.ports);
      expect(fs.readFileSync(path.join(f.out, "README.txt"), "utf8")).toContain("PREVIEW");
      expect(fs.readFileSync(path.join(f.out, "index.html"), "utf8")).toContain("PREVIEW");
      expect((await verifyExport(f.reader)).ok).toBe(true);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });
});
