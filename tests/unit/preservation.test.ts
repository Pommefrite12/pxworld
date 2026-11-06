import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExportRefused, exportArchive, mapLimit, verifyExport, verifyStored, type ExportInput } from "@/lib/preservation/export";
import { buildCsv, buildIndexHtml, buildSums, csvField, escapeHtml, findRetractions, parseManifest, parseSums, renderLegalText, sha256Hex, type ManifestItem } from "@/lib/preservation/manifest";
import { ZIP_MAX_ENTRIES, ZipTooLargeError, ZipWriter, readZip } from "@/lib/preservation/zip";

const png = (n: number) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, n, n + 1, n + 2]);
const item = (code: string, bytes: Uint8Array | null, over: Partial<NonNullable<ManifestItem["creation"]>> = {}): ManifestItem => ({
  code, x: 100, y: 200, w: 5, h: 5, kind: "land", author: "alice", activated_at: "2026-11-02T10:00:00+00:00",
  creation: bytes ? { asset_id: `a-${code}`, version: 1, content_hash: sha256Hex(bytes), storage_path: `creations/${code}.png`, width: 5, height: 5, title: `Title ${code}`, description: null, published_at: "2026-11-02T11:00:00+00:00", category: "food", place_label: "Naples", place_country: "IT", ...over } : null,
});

/** A little world: three creations, one parcel without any, and the storage that holds the pictures. */
function world() {
  const files = new Map<string, Uint8Array>([["creations/aaa.png", png(1)], ["creations/bbb.png", png(2)], ["creations/ccc.png", png(3)]]);
  const items = [item("aaa", png(1)), item("bbb", png(2)), item("ccc", png(3)), item("ddd", null)];
  const manifestText = JSON.stringify(items);
  const input: ExportInput = {
    edition: { slug: "fondatrice", name: "Édition fondatrice", opensAt: "2026-11-01T00:00:00Z", closesAt: "2027-02-09T00:00:00Z", closedAt: "2027-02-09T00:00:00Z" },
    snapshot: { revision: 1, takenAt: "2027-02-09T00:40:00Z", manifestText, recordedHash: sha256Hex(manifestText), parcelCount: 4 },
    earlier: [], labels: { en: { food: "Food and traditions" }, fr: { food: "Cuisine et traditions" } }, terms: null, exportedAt: "2027-03-01T00:00:00Z",
  };
  const written = new Map<string, Uint8Array>();
  const ports = { readObject: async (p: string) => files.get(p) ?? null, write: async (p: string, d: Uint8Array) => { written.set(p, d); } };
  return { files, items, input, ports, written };
}
const readerOf = (m: Map<string, Uint8Array>) => ({ list: async () => [...m.keys()], read: async (p: string) => m.get(p) ?? null });
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("the manifest", () => {
  it("reads the items, and refuses what is not a manifest", () => {
    expect(parseManifest(JSON.stringify([item("aaa", png(1)), item("ddd", null)]))).toHaveLength(2);
    expect(() => parseManifest("{")).toThrow(/not valid JSON/);
    expect(() => parseManifest("{}")).toThrow(/expected shape/);
    expect(() => parseManifest(JSON.stringify([{ code: "x" }]))).toThrow(/expected shape/);
    expect(() => parseManifest(JSON.stringify([item("a/../b", null)]))).toThrow(/plain code/); // a code is a file name: never a path
    expect(() => parseManifest(JSON.stringify([item("aaa", null), item("aaa", null)]))).toThrow(/twice/);
  });

  it("accepts a snapshot taken before the archive fields existed (no category, no place)", () => {
    const old = item("aaa", png(1));
    delete old.creation!.category; delete old.creation!.place_label; delete old.creation!.place_country;
    expect(parseManifest(JSON.stringify([old]))[0]!.creation!.category).toBeUndefined();
  });
});

describe("the CSV", () => {
  it("quotes what must be quoted", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField(null)).toBe("");
    expect(csvField(42)).toBe("42");
  });

  it("never lets a spreadsheet run a formula: a text that starts with = + - @ gets an apostrophe (numbers are untouched)", () => {
    for (const evil of ['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) expect(csvField(evil).replace(/^"/, "")).toMatch(/^'/);
    expect(csvField(-5)).toBe("-5");
  });

  it("has one row per parcel under the header, and an empty file for a creation that is not in the export", () => {
    const items = [item("aaa", png(1)), item("ddd", null), item("zzz", png(9))];
    const csv = buildCsv(items, new Set(["aaa"]));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("code,x,y,w,h,kind,author,archived_at,title,description,category,place_label,place_country,file,sha256,width,height");
    expect(lines).toHaveLength(5); // header + 3 rows + the empty piece after the last CRLF
    expect(lines[1]).toContain("creations/aaa.png");
    expect(lines[2]).toBe("ddd,100,200,5,5,land,alice,2026-11-02T10:00:00+00:00,,,,,,,,,");
    expect(lines[3]).toContain(",,"); // zzz: the picture is not there, so no file
    expect(lines[3]).not.toContain("creations/zzz.png");
  });
});

describe("the checksums", () => {
  it("are in the format sha256sum reads, sorted by path, and read back", () => {
    const text = buildSums(new Map([["b.txt", "b".repeat(64)], ["a/z.png", "a".repeat(64)]]));
    expect(text).toBe(`${"a".repeat(64)}  a/z.png\n${"b".repeat(64)}  b.txt\n`);
    const { entries, bad } = parseSums(text);
    expect(bad).toEqual([]);
    expect(entries.get("a/z.png")).toBe("a".repeat(64));
    expect(parseSums("not a checksum\n").bad).toHaveLength(1);
  });

  it("agree with the real sha256sum of the machine, when it has one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-sums-"));
    try {
      fs.writeFileSync(path.join(dir, "one.txt"), "hello");
      fs.writeFileSync(path.join(dir, "SHA256SUMS"), buildSums(new Map([["one.txt", sha256Hex("hello")]])));
      const r = spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: dir });
      if (r.error) return; // no sha256sum here (macOS): nothing to compare with
      expect(r.status, String(r.stdout) + String(r.stderr)).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("what was retracted since", () => {
  it("lists what an earlier snapshot held and this one does not, with the last revision it was seen in", () => {
    const r = findRetractions(["a", "c"], [{ revision: 1, codes: ["a", "b", "c", "d"] }, { revision: 2, codes: ["a", "c", "d"] }]);
    expect(r).toEqual([{ code: "d", last_seen_revision: 2 }, { code: "b", last_seen_revision: 1 }].sort((x, y) => (x.code < y.code ? -1 : 1)));
    expect(findRetractions(["a"], [])).toEqual([]);
  });
});

describe("the page that reads the archive", () => {
  it("escapes everything a person typed, and uses no script and no outside file", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">'&`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;");
    const evil = item("aaa", png(1), { title: `<script>alert(1)</script>`, description: `"><b>x</b>`, place_label: `<i>`, category: "food" });
    evil.author = "<u>bob</u>";
    const html = buildIndexHtml({ editionName: "Édition <x>", revision: 1, takenAt: "2027-02-09T00:40:00Z", items: [evil], present: new Set(["aaa"]), labels: { en: { food: "Food" }, fr: { food: "Cuisine" } }, preview: false });
    expect(html).not.toMatch(/<script|<i>|<u>|<b>|onerror=/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Food / Cuisine");
    expect(html).toContain('src="creations/aaa.png"');
    expect(html).not.toMatch(/https?:\/\//); // nothing is fetched from anywhere
    expect(html).not.toContain("PREVIEW");
  });

  it("says PREVIEW, in both languages, on a rehearsal", () => {
    const html = buildIndexHtml({ editionName: "E", revision: null, takenAt: "2027-02-09T00:40:00Z", items: [], present: new Set(), labels: { en: {}, fr: {} }, preview: true });
    expect(html).toContain("PREVIEW");
    expect(html).toContain("APERÇU");
  });

  it("shows a dash for a parcel without a creation, and an unknown category as its code", () => {
    const html = buildIndexHtml({ editionName: "E", revision: 1, takenAt: "2027-02-09", items: [item("ddd", null), item("aaa", png(1), { category: "zzz" })], present: new Set(["aaa"]), labels: { en: {}, fr: {} }, preview: false });
    expect(html).toContain('<span class="none">—</span>');
    expect(html).toContain("zzz / zzz");
  });
});

describe("the terms as text", () => {
  it("keeps headings, paragraphs and lists, in order", () => {
    const t = renderLegalText({ title: "Terms", intro: "Intro.", sections: [{ h: "One", p: ["P1", "P2"] }, { h: "Two", ul: ["a", "b"] }] });
    expect(t).toBe("Terms\n=====\n\nIntro.\n\nOne\n---\nP1\n\nP2\n\nTwo\n---\n* a\n* b\n");
  });
});

describe("the ZIP", () => {
  const build = async (files: [string, Uint8Array][]) => {
    const chunks: Buffer[] = [];
    const z = new ZipWriter(async (c) => { chunks.push(c); }, new Date(Date.UTC(2027, 1, 9, 0, 40, 0)));
    for (const [n, d] of files) await z.add(n, d);
    await z.finish();
    return Buffer.concat(chunks);
  };

  it("holds the files it was given, with their CRC, and reads back", async () => {
    const zip = await build([["a.txt", new TextEncoder().encode("hello")], ["creations/é.png", png(7)], ["empty", new Uint8Array(0)]]);
    const back = readZip(zip);
    expect([...back.keys()]).toEqual(["a.txt", "creations/é.png", "empty"]);
    expect(dec(back.get("a.txt")!)).toBe("hello");
    expect([...back.get("creations/é.png")!]).toEqual([...png(7)]);
    expect(back.get("empty")!.length).toBe(0);
  });

  it("is the same bytes for the same input (the date is the snapshot's, not the clock's)", async () => {
    const a = await build([["x", png(1)]]), b = await build([["x", png(1)]]);
    expect(a.equals(b)).toBe(true);
  });

  it("is a ZIP that another program opens, when python is here to try", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-zip-"));
    try {
      const file = path.join(dir, "t.zip");
      fs.writeFileSync(file, await build([["a.txt", new TextEncoder().encode("hello")], ["creations/b.png", png(5)]]));
      const r = spawnSync("python3", ["-I", "-c", "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(sorted(z.namelist()), z.read('a.txt'))", file]);
      if (r.error) return;
      expect(r.status, String(r.stderr)).toBe(0);
      expect(String(r.stdout)).toContain("['a.txt', 'creations/b.png'] b'hello'");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses bad names, and says plainly when a plain ZIP is too small for the archive", async () => {
    const z = new ZipWriter(async () => undefined, new Date());
    for (const bad of ["", "/abs", "a\\b", "../up", "a/../b"]) await expect(z.add(bad, png(1)), bad).rejects.toThrow(/bad name/);
    const many = new ZipWriter(async () => undefined, new Date());
    for (let i = 0; i < ZIP_MAX_ENTRIES; i++) await many.add(`f${i}`, new Uint8Array(0));
    await expect(many.add("one-too-many", new Uint8Array(0))).rejects.toBeInstanceOf(ZipTooLargeError);
    await expect(many.add("one-too-many", new Uint8Array(0))).rejects.toThrow(/Use the folder/);
  }, 30_000);

  it("detects damage when read back", async () => {
    const zip = await build([["a.txt", new TextEncoder().encode("hello world")]]);
    const at = zip.indexOf(Buffer.from("hello world"));
    zip[at] = zip[at]! ^ 1; // one flipped bit in the stored data
    expect(() => readZip(zip)).toThrow(/CRC mismatch/);
    expect(() => readZip(new Uint8Array(10))).toThrow(/not a ZIP/);
  });
});

describe("mapLimit", () => {
  it("keeps the order, and never runs more than n at once", async () => {
    let running = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return n * 2; });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(await mapLimit([], 3, async (x) => x)).toEqual([]);
  });
});

describe("exporting", () => {
  it("writes the whole archive, and what it writes verifies", async () => {
    const { input, ports, written } = world();
    const report = await exportArchive(input, ports);
    expect(report).toMatchObject({ parcels: 4, creations: 3, problems: [], retractions: 0, manifestHash: input.snapshot.recordedHash });
    expect([...written.keys()].sort()).toEqual(["README.txt", "SHA256SUMS", "creations/aaa.png", "creations/bbb.png", "creations/ccc.png", "edition.json", "index.html", "manifest.csv", "manifest.json", "manifest.sha256", "retractions.json"]);
    expect(dec(written.get("manifest.json")!)).toBe(input.snapshot.manifestText); // byte for byte what the database holds
    expect(sha256Hex(written.get("manifest.json")!)).toBe(input.snapshot.recordedHash);
    expect(dec(written.get("manifest.sha256")!)).toBe(`${input.snapshot.recordedHash}  manifest.json\n`);
    expect(JSON.parse(dec(written.get("edition.json")!))).toMatchObject({ format: "pixel-world-archive/1", snapshot: { revision: 1, preview: false, parcel_count: 4 } });
    expect(dec(written.get("README.txt")!)).toContain("sha256sum -c SHA256SUMS");
    expect(dec(written.get("README.txt")!)).not.toContain("PREVIEW");
    expect(report.files).toBe(written.size);
    const verdict = await verifyExport(readerOf(written));
    expect(verdict).toMatchObject({ ok: true, problems: [], warnings: [], creations: 3 });
  });

  it("includes the terms when it has them", async () => {
    const { input, ports, written } = world();
    const page = { title: "Terms", intro: "i", sections: [] };
    await exportArchive({ ...input, terms: { en: page, fr: { ...page, title: "Conditions" } } }, ports);
    expect([...written.keys()]).toEqual(expect.arrayContaining(["terms/terms.en.txt", "terms/terms.fr.txt"]));
    expect(dec(written.get("terms/terms.fr.txt")!)).toContain("Conditions");
    expect((await verifyExport(readerOf(written))).ok).toBe(true);
  });

  it("refuses a manifest that no longer matches the hash recorded with it, whatever else is asked", async () => {
    const { input, ports, written } = world();
    const tampered = { ...input, snapshot: { ...input.snapshot, manifestText: input.snapshot.manifestText.replace("alice", "mallory") } };
    await expect(exportArchive(tampered, ports, { keepGoing: true })).rejects.toThrow(/altered or damaged/);
    expect(written.size).toBe(0); // not a byte was written
  });

  it("refuses an archive that would lack a picture, naming it, and writes no manifest; with keepGoing it writes the gap down instead", async () => {
    const { input, ports, written, files } = world();
    files.delete("creations/bbb.png");
    files.set("creations/ccc.png", png(99)); // there, but not the file the snapshot recorded
    const refused = await exportArchive(input, ports).catch((e) => e);
    expect(refused).toBeInstanceOf(ExportRefused);
    expect(refused.problems.join("\n")).toMatch(/bbb: the file is missing/);
    expect(refused.problems.join("\n")).toMatch(/ccc: the file does not match the hash/);
    expect(written.has("manifest.json")).toBe(false);

    written.clear();
    const report = await exportArchive(input, ports, { keepGoing: true });
    expect(report.problems).toHaveLength(2);
    expect(report.creations).toBe(1);
    expect(dec(written.get("PROBLEMS.txt")!)).toContain("bbb");
    expect(dec(written.get("README.txt")!)).toContain("WARNING: 2 creation file(s)");
    expect(dec(written.get("manifest.csv")!)).not.toContain("creations/bbb.png");
    const verdict = await verifyExport(readerOf(written));
    expect(verdict.ok).toBe(false); // the manifest still promises those pictures: the gap is real, and said
    expect(verdict.warnings.join(" ")).toContain("PROBLEMS.txt");
  });

  it("reports a count that disagrees with the manifest", async () => {
    const { input, ports } = world();
    await expect(exportArchive({ ...input, snapshot: { ...input.snapshot, parcelCount: 5 } }, ports)).rejects.toThrow(/problem/);
  });

  it("lists what moderation retracted since an earlier snapshot", async () => {
    const { input, ports, written } = world();
    await exportArchive({ ...input, snapshot: { ...input.snapshot, revision: 2 }, earlier: [{ revision: 1, codes: ["aaa", "bbb", "gone"] }] }, ports);
    expect(JSON.parse(dec(written.get("retractions.json")!)).retractions).toEqual([{ code: "gone", last_seen_revision: 1 }]);
  });

  it("is a PREVIEW when it has no revision: said in the README, the page and edition.json", async () => {
    const { input, ports, written } = world();
    const text = input.snapshot.manifestText;
    await exportArchive({ ...input, snapshot: { revision: null, takenAt: "2026-12-01T00:00:00Z", manifestText: text, recordedHash: null, parcelCount: null } }, ports);
    expect(dec(written.get("README.txt")!)).toContain("PREVIEW");
    expect(dec(written.get("index.html")!)).toContain("PREVIEW");
    expect(JSON.parse(dec(written.get("edition.json")!)).snapshot).toMatchObject({ revision: null, preview: true });
    expect((await verifyExport(readerOf(written))).ok).toBe(true);
  });

  it("tells when the snapshot is older than the archive fields", async () => {
    const { ports, written, input } = world();
    const items = [item("aaa", png(1))];
    delete items[0]!.creation!.category; delete items[0]!.creation!.place_label; delete items[0]!.creation!.place_country;
    const manifestText = JSON.stringify(items);
    await exportArchive({ ...input, snapshot: { ...input.snapshot, manifestText, recordedHash: sha256Hex(manifestText), parcelCount: 1 } }, ports);
    expect(dec(written.get("README.txt")!)).toContain("before categories and places");
  });
});

describe("verifying an export, with nothing but itself", () => {
  const exported = async () => { const w = world(); await exportArchive(w.input, w.ports); return w.written; };

  it("finds a picture that was changed", async () => {
    const m = await exported();
    m.set("creations/aaa.png", png(50));
    const r = await verifyExport(readerOf(m));
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/creations\/aaa\.png: the file was changed/);
    expect(r.problems.join("\n")).toMatch(/aaa: the picture creations\/aaa\.png does not match the hash in the manifest/);
  });

  it("finds a file that is gone", async () => {
    const m = await exported();
    m.delete("creations/bbb.png");
    const r = await verifyExport(readerOf(m));
    expect(r.problems.join("\n")).toMatch(/creations\/bbb\.png: the file is missing/);
    expect(r.problems.join("\n")).toMatch(/bbb: the picture creations\/bbb\.png is missing/);
  });

  it("finds a manifest that was rewritten together with its checksums (the hash recorded by the database betrays it)", async () => {
    const m = await exported();
    const forged = dec(m.get("manifest.json")!).replace("alice", "mallory");
    m.set("manifest.json", new TextEncoder().encode(forged));
    const sums = parseSums(dec(m.get("SHA256SUMS")!)).entries;
    sums.set("manifest.json", sha256Hex(forged)); // the forger fixes SHA256SUMS too…
    m.set("SHA256SUMS", new TextEncoder().encode(buildSums(sums)));
    const r = await verifyExport(readerOf(m));
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toContain("does not match manifest.sha256");
  });

  it("notes a file nobody listed, and fails a missing or damaged SHA256SUMS", async () => {
    const m = await exported();
    m.set("extra.txt", new TextEncoder().encode("hi"));
    expect((await verifyExport(readerOf(m))).warnings.join(" ")).toContain("extra.txt");
    m.set("SHA256SUMS", new TextEncoder().encode("garbage\n"));
    expect((await verifyExport(readerOf(m))).problems.join(" ")).toContain("not a checksum");
    m.delete("SHA256SUMS");
    expect((await verifyExport(readerOf(m)))).toMatchObject({ ok: false, problems: ["SHA256SUMS is missing: nothing can be checked"] });
  });

  it("finds a count in edition.json that is not the manifest's", async () => {
    const m = await exported();
    const e = JSON.parse(dec(m.get("edition.json")!)); e.snapshot.parcel_count = 99;
    const text = JSON.stringify(e);
    m.set("edition.json", new TextEncoder().encode(text));
    const sums = parseSums(dec(m.get("SHA256SUMS")!)).entries; sums.set("edition.json", sha256Hex(text));
    m.set("SHA256SUMS", new TextEncoder().encode(buildSums(sums)));
    expect((await verifyExport(readerOf(m))).problems.join(" ")).toContain("edition.json says 99 parcels");
  });
});

describe("verifying the live site against a snapshot", () => {
  it("is fine when the storage holds what the snapshot recorded", async () => {
    const { input, files } = world();
    const r = await verifyStored({ manifestText: input.snapshot.manifestText, recordedHash: input.snapshot.recordedHash! }, async (p) => files.get(p) ?? null);
    expect(r).toMatchObject({ ok: true, creations: 3, checkedFiles: 3 });
  });

  it("names the pictures that are missing, those that differ, those that cannot be read, and a manifest that no longer matches its hash", async () => {
    const { input, files } = world();
    files.delete("creations/aaa.png"); files.set("creations/bbb.png", png(77));
    const r = await verifyStored({ manifestText: input.snapshot.manifestText, recordedHash: input.snapshot.recordedHash! }, async (p) => { if (p.endsWith("ccc.png")) throw new Error("storage is down"); return files.get(p) ?? null; });
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/aaa: the file is missing/);
    expect(r.problems.join("\n")).toMatch(/bbb: the file does not match/);
    expect(r.problems.join("\n")).toMatch(/ccc: could not read the file \(storage is down\)/);
    const bad = await verifyStored({ manifestText: input.snapshot.manifestText, recordedHash: "0".repeat(64) }, async (p) => files.get(p) ?? null);
    expect(bad.problems.join("\n")).toContain("does not match the hash recorded");
  });
});
