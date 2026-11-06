import {
  buildCsv, buildIndexHtml, buildReadme, buildSums, creationFile, findRetractions, parseManifest, parseSums, renderLegalText, sha256Hex,
  type LegalPage, type ManifestItem,
} from "./manifest";

/**
 * The export of the archive and its verification, with the outside world (the database, the storage, the disk) behind small ports, so that the
 * rules can be tested without any of them. The scripts `scripts/export-archive.mts` and `scripts/verify-archive.mts` are thin shells around this.
 *
 * What an export is: a folder (or a ZIP of it) that anybody can read without our software and check without our software (see the README it holds).
 * What it refuses: a creation whose file is missing or does not match the hash the snapshot recorded — an archive that quietly lacks a picture is
 * worse than no archive — unless it is asked to go on (`keepGoing`), in which case the problems are written down in `PROBLEMS.txt` and in the README.
 */

export interface ExportInput {
  edition: { slug: string; name: string; opensAt: string | null; closesAt: string | null; closedAt: string | null };
  snapshot: {
    /** `null`: a rehearsal made from the live tables before the closing */
    revision: number | null;
    takenAt: string;
    /** the manifest exactly as the database holds it (`manifest::text`): the hash is the hash of THIS text */
    manifestText: string;
    /** the hash the database recorded for it (`null` for a rehearsal) */
    recordedHash: string | null;
    parcelCount: number | null;
  };
  /** the earlier snapshots of the edition (to list what was retracted since) */
  earlier: { revision: number; codes: string[] }[];
  labels: { en: Record<string, string>; fr: Record<string, string> };
  terms: { en: LegalPage; fr: LegalPage } | null;
  exportedAt: string;
}

export interface ExportPorts {
  /** the bytes of a stored creation, or null when it is not there */
  readObject(storagePath: string): Promise<Uint8Array | null>;
  /** writes a file of the export (a relative path with `/`) */
  write(path: string, data: Uint8Array): Promise<void>;
}

export interface ExportReport {
  manifestHash: string;
  parcels: number;
  creations: number;
  files: number;
  problems: string[];
  retractions: number;
}

export class ExportRefused extends Error {
  constructor(message: string, readonly problems: string[] = []) { super(message); }
}

/** Runs `fn` over `items` with at most `n` at a time, keeping the order of the results. */
export async function mapLimit<T, R>(items: readonly T[], n: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!, i);
  }));
  return out;
}

const enc = (s: string) => new TextEncoder().encode(s);
const CONCURRENCY = 8;

/** Reads every creation of the manifest through `read`, and says which are missing or differ from the recorded hash. */
async function checkCreations(items: readonly ManifestItem[], read: (path: string) => Promise<Uint8Array | null>, onBytes?: (item: ManifestItem, bytes: Uint8Array) => Promise<void>): Promise<{ problems: string[]; good: Set<string> }> {
  const problems: string[] = [], good = new Set<string>();
  await mapLimit(items.filter((i) => i.creation), CONCURRENCY, async (item) => {
    const c = item.creation!;
    const bytes = await read(c.storage_path).catch((e: unknown) => { problems.push(`${item.code}: could not read the file (${e instanceof Error ? e.message : String(e)})`); return undefined; });
    if (bytes === undefined) return;
    if (bytes === null) { problems.push(`${item.code}: the file is missing (${c.storage_path})`); return; }
    if (sha256Hex(bytes) !== c.content_hash) { problems.push(`${item.code}: the file does not match the hash recorded in the snapshot (${c.storage_path})`); return; }
    good.add(item.code);
    await onBytes?.(item, bytes);
  });
  return { problems: problems.sort(), good };
}

export async function exportArchive(input: ExportInput, ports: ExportPorts, opts: { keepGoing?: boolean } = {}): Promise<ExportReport> {
  const { snapshot, edition } = input;
  const manifestHash = sha256Hex(snapshot.manifestText);
  if (snapshot.recordedHash !== null && snapshot.recordedHash !== manifestHash) {
    throw new ExportRefused("the manifest stored in the database does not match the hash recorded with it: the snapshot was altered or damaged. Nothing was exported.");
  }
  const items = parseManifest(snapshot.manifestText);
  const problems: string[] = [];
  if (snapshot.parcelCount !== null && snapshot.parcelCount !== items.length) problems.push(`the snapshot says ${snapshot.parcelCount} parcels, its manifest holds ${items.length}`);

  const sums = new Map<string, string>();
  const write = async (path: string, data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc(data) : data;
    sums.set(path, sha256Hex(bytes));
    await ports.write(path, bytes);
  };

  // 1. the pictures, each checked against the hash the snapshot recorded, written as they are read
  const checked = await checkCreations(items, ports.readObject, async (item, bytes) => { await write(creationFile(item.code), bytes); });
  problems.push(...checked.problems);
  if (problems.length && !opts.keepGoing) throw new ExportRefused(`${problems.length} problem(s): the archive would be incomplete. Nothing was exported.`, problems);

  // 2. the manifest, byte for byte; the list; the edition; what was retracted
  await write("manifest.json", snapshot.manifestText);
  await write("manifest.sha256", `${snapshot.recordedHash ?? manifestHash}  manifest.json\n`);
  await write("manifest.csv", buildCsv(items, checked.good));
  const retractions = findRetractions(items.map((i) => i.code), input.earlier);
  await write("retractions.json", `${JSON.stringify({ note: "Traces that an earlier snapshot of this edition held and this one no longer holds (withdrawn by moderation since).", retractions }, null, 2)}\n`);
  await write("edition.json", `${JSON.stringify({
    format: "pixel-world-archive/1",
    edition: { slug: edition.slug, name: edition.name, opens_at: edition.opensAt, closes_at: edition.closesAt, closed_at: edition.closedAt },
    snapshot: { revision: snapshot.revision, preview: snapshot.revision === null, taken_at: snapshot.takenAt, parcel_count: items.length, manifest_hash: manifestHash },
    exported_at: input.exportedAt,
  }, null, 2)}\n`);
  if (input.terms) { await write("terms/terms.en.txt", renderLegalText(input.terms.en)); await write("terms/terms.fr.txt", renderLegalText(input.terms.fr)); }
  if (problems.length) await write("PROBLEMS.txt", `${problems.join("\n")}\n`);

  // 3. the page that reads it, the README, and last the checksums of everything
  const preview = snapshot.revision === null;
  await write("index.html", buildIndexHtml({ editionName: edition.name, revision: snapshot.revision, takenAt: snapshot.takenAt, items, present: checked.good, labels: input.labels, preview }));
  await write("README.txt", buildReadme({
    editionName: edition.name, revision: snapshot.revision, takenAt: snapshot.takenAt, exportedAt: input.exportedAt, parcels: items.length, creations: checked.good.size,
    manifestHash, preview, problems: problems.length, retractions: retractions.length, hasTerms: Boolean(input.terms),
    hasArchiveFields: items.every((i) => !i.creation || i.creation.category !== undefined),
  }));
  const sumsText = buildSums(sums);
  await ports.write("SHA256SUMS", enc(sumsText));
  return { manifestHash, parcels: items.length, creations: checked.good.size, files: sums.size + 1, problems, retractions: retractions.length };
}

/* ------------------------------------------------------------------------------------------------------------------------ verification */

export interface VerifyReport { ok: boolean; checkedFiles: number; creations: number; problems: string[]; warnings: string[] }

export interface ExportReader {
  /** every file of the export, as relative paths with `/` */
  list(): Promise<string[]>;
  read(path: string): Promise<Uint8Array | null>;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * Checks an export folder (or the content of a ZIP) with nothing but itself: every file against SHA256SUMS, the manifest against the hash that
 * was recorded with it, every picture against the hash in the manifest, and the count against edition.json. It says what is missing, what was
 * changed, and what is there that nobody listed.
 */
export async function verifyExport(reader: ExportReader): Promise<VerifyReport> {
  const problems: string[] = [], warnings: string[] = [];
  const files = new Set(await reader.list());

  // 1. every file against SHA256SUMS
  const sumsBytes = await reader.read("SHA256SUMS");
  if (!sumsBytes) return { ok: false, checkedFiles: 0, creations: 0, problems: ["SHA256SUMS is missing: nothing can be checked"], warnings };
  const { entries, bad } = parseSums(text(sumsBytes));
  for (const b of bad) problems.push(`SHA256SUMS has a line that is not a checksum: ${JSON.stringify(b)}`);
  const ordered = [...entries];
  await mapLimit(ordered, CONCURRENCY, async ([path, hash]) => {
    const bytes = await reader.read(path);
    if (!bytes) problems.push(`${path}: the file is missing`);
    else if (sha256Hex(bytes) !== hash) problems.push(`${path}: the file was changed (its sha256 is not the one in SHA256SUMS)`);
  });
  for (const f of files) if (f !== "SHA256SUMS" && !entries.has(f)) warnings.push(`${f}: this file is not listed in SHA256SUMS`);

  // 2. the manifest against the hash that was recorded with it
  const manifest = await reader.read("manifest.json");
  const recorded = await reader.read("manifest.sha256");
  let items: ManifestItem[] = [];
  if (!manifest) problems.push("manifest.json is missing");
  else {
    const hash = sha256Hex(manifest), m = recorded ? /^([0-9a-f]{64})\s/.exec(text(recorded)) : null;
    if (!recorded || !m) problems.push("manifest.sha256 is missing or unreadable: the manifest cannot be checked against the hash recorded by the database");
    else if (m[1] !== hash) problems.push("manifest.json does not match manifest.sha256 (the hash recorded by the database)");
    try { items = parseManifest(text(manifest)); } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); }
  }

  // 3. every picture against the hash in the manifest
  let creations = 0;
  const withCreation = items.filter((i) => i.creation);
  await mapLimit(withCreation, CONCURRENCY, async (item) => {
    const path = creationFile(item.code), bytes = await reader.read(path);
    if (!bytes) problems.push(`${item.code}: the picture ${path} is missing`);
    else if (sha256Hex(bytes) !== item.creation!.content_hash) problems.push(`${item.code}: the picture ${path} does not match the hash in the manifest`);
    else creations++;
  });

  // 4. the count
  const edition = await reader.read("edition.json");
  if (edition) {
    try {
      const count = (JSON.parse(text(edition)) as { snapshot?: { parcel_count?: number } }).snapshot?.parcel_count;
      if (typeof count === "number" && manifest && count !== items.length) problems.push(`edition.json says ${count} parcels, the manifest holds ${items.length}`);
    } catch { problems.push("edition.json is not valid JSON"); }
  } else problems.push("edition.json is missing");
  if (files.has("PROBLEMS.txt")) warnings.push("PROBLEMS.txt is present: this export was made with known gaps");

  return { ok: problems.length === 0, checkedFiles: entries.size, creations, problems: problems.sort(), warnings: warnings.sort() };
}

/**
 * Checks the LIVE site against a snapshot: the manifest against the hash recorded with it, and every stored picture against the hash in the
 * manifest. This is what proves, after a restore or a copy of the bucket, that the files are the ones the archive promised.
 */
export async function verifyStored(snapshot: { manifestText: string; recordedHash: string }, readObject: (storagePath: string) => Promise<Uint8Array | null>): Promise<VerifyReport> {
  const problems: string[] = [];
  if (sha256Hex(snapshot.manifestText) !== snapshot.recordedHash) problems.push("the manifest stored in the database does not match the hash recorded with it");
  let items: ManifestItem[] = [];
  try { items = parseManifest(snapshot.manifestText); } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); }
  const r = await checkCreations(items, readObject);
  problems.push(...r.problems);
  return { ok: problems.length === 0, checkedFiles: items.filter((i) => i.creation).length, creations: r.good.size, problems, warnings: [] };
}
