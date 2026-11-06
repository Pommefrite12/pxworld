// Exports the archive of an edition: a folder (and, with --zip, a ZIP of it) that anybody can read AND check without our software.
//
//   npm run archive:export -- [--env <file>] [--out <folder>] [--revision N] [--preview] [--zip] [--keep-going]
//
//   --env <file>    the environment of the site to read (a file of NAME=value lines, e.g. .env.production.local); without it, the local database
//   --out <folder>  where to write (default: exports/<edition>-<revision>-<date>); it must not exist, or be empty
//   --revision N    a given snapshot of the closing (default: the latest one: a retraction after the closing makes a newer one)
//   --preview       a REHEARSAL: no snapshot is read, the archive is made from what the public can see right now (for a test site, before the
//                   closing). It says PREVIEW everywhere: it is never an archive.
//   --zip           also make <folder>.zip (a plain ZIP: at most 65 535 files and 4 GiB; the folder has no limit and is always made first)
//   --keep-going    go on when a picture is missing or does not match its recorded hash (the problems are written in PROBLEMS.txt and the README).
//                   Without it, the export refuses and writes nothing: an archive that quietly lacks a picture is worse than no archive.
//
// It only READS the database and the storage; it writes only inside the folder. The edition closes, and its snapshot is taken, from the back
// office (`/admin/edition`) or by the clock: this script never closes anything.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ExportRefused, exportArchive } from "../src/lib/preservation/export";
import { listFiles, loadEnvFile, openSource, readMessages } from "../src/lib/preservation/node";
import { ZipTooLargeError, ZipWriter } from "../src/lib/preservation/zip";

const args = process.argv.slice(2);
const KNOWN = new Set(["env", "out", "revision", "preview", "zip", "keep-going"]);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (message: string, code = 1): never => { console.error(message); process.exit(code); };
for (const a of args) if (a.startsWith("--") && !KNOWN.has(a.slice(2))) die(`Unknown option ${a}. See the top of scripts/export-archive.mts.`, 2);
if (flag("preview") && opt("revision")) die("--preview and --revision exclude each other.", 2);

if (opt("env")) loadEnvFile(opt("env")!);
const source = openSource();
console.log(`Reading: ${source.where}`);

let outDir = "";
let createdOut = false;
try {
  const [edition] = await source.query<{ slug: string; name: string; opens_at: Date | null; closes_at: Date | null; closed_at: Date | null; status: string }>(
    "select slug, name, opens_at, closes_at, closed_at, status from public.editions order by created_at limit 1");
  if (!edition) die("This database has no edition: is the latest migration applied? (node scripts/migrate.mjs)");
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const [{ now }] = await source.query<{ now: Date }>("select now() as now");

  const preview = flag("preview");
  let snapshot: { revision: number | null; takenAt: string; manifestText: string; recordedHash: string | null; parcelCount: number | null };
  let earlier: { revision: number; codes: string[] }[];
  if (preview) {
    const [m] = await source.query<{ t: string }>("select public.px_edition_manifest()::text as t");
    snapshot = { revision: null, takenAt: now.toISOString(), manifestText: m!.t, recordedHash: null, parcelCount: null };
    earlier = await source.query("select revision, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(manifest) x) as codes from public.edition_snapshots order by revision");
    console.log(`PREVIEW: made from what the public can see right now. Edition "${edition.name}" is ${edition.status}.`);
  } else {
    const wanted = opt("revision") ? Number(opt("revision")) : null;
    if (wanted !== null && !Number.isInteger(wanted)) die("--revision must be a whole number.", 2);
    const [s] = await source.query<{ revision: number; taken_at: Date; manifest_text: string; manifest_hash: string; parcel_count: number }>(
      `select revision, taken_at, manifest::text as manifest_text, manifest_hash, parcel_count from public.edition_snapshots
        where ($1::int is null or revision = $1) order by revision desc limit 1`, [wanted]);
    if (!s) die(wanted !== null
      ? `The edition has no snapshot number ${wanted}.`
      : `The edition "${edition.name}" has no snapshot yet (status: ${edition.status}). A snapshot is taken when the edition closes.\nTo rehearse before then, add --preview.`);
    snapshot = { revision: s!.revision, takenAt: s!.taken_at.toISOString(), manifestText: s!.manifest_text, recordedHash: s!.manifest_hash, parcelCount: s!.parcel_count };
    earlier = await source.query("select revision, (select coalesce(array_agg(x->>'code'), '{}') from jsonb_array_elements(manifest) x) as codes from public.edition_snapshots where revision < $1 order by revision", [s!.revision]);
    console.log(`Edition "${edition.name}", snapshot #${s!.revision} of ${snapshot.takenAt.slice(0, 10)}.`);
  }

  const stamp = now.toISOString().slice(0, 10);
  outDir = path.resolve(opt("out") ?? path.join("exports", `${edition.slug}-${preview ? "preview" : `rev${snapshot.revision}`}-${stamp}`));
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) die(`${outDir} already exists and is not empty. Choose another --out, or remove it.`);
  if (!fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); createdOut = true; }

  const { labels, terms } = readMessages();
  const report = await exportArchive(
    { edition: { slug: edition.slug, name: edition.name, opensAt: iso(edition.opens_at), closesAt: iso(edition.closes_at), closedAt: iso(edition.closed_at) }, snapshot, earlier, labels, terms, exportedAt: now.toISOString() },
    {
      readObject: (p) => source.readObject(p),
      async write(rel, data) { const f = path.join(outDir, ...rel.split("/")); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); },
    },
    { keepGoing: flag("keep-going") },
  );

  console.log(`\nDone: ${report.parcels} parcels, ${report.creations} creations, ${report.files} files.`);
  console.log(`Folder:  ${outDir}`);
  console.log(`Manifest hash: ${report.manifestHash}`);
  if (report.retractions) console.log(`${report.retractions} trace(s) retracted since an earlier snapshot (see retractions.json).`);
  if (report.problems.length) console.log(`\nWARNING: ${report.problems.length} problem(s), written in PROBLEMS.txt:\n${report.problems.slice(0, 15).map((p) => `  - ${p}`).join("\n")}${report.problems.length > 15 ? "\n  - …" : ""}`);

  if (flag("zip")) {
    const zipFile = `${outDir}.zip`;
    const fd = fs.openSync(zipFile, "w");
    try {
      const zip = new ZipWriter(async (chunk) => { fs.writeSync(fd, chunk); }, new Date(snapshot.takenAt));
      for (const rel of listFiles(outDir)) await zip.add(rel, fs.readFileSync(path.join(outDir, ...rel.split("/"))));
      await zip.finish();
      fs.closeSync(fd);
      const hash = createHash("sha256").update(fs.readFileSync(zipFile)).digest("hex");
      console.log(`ZIP:     ${zipFile}\nZIP sha256: ${hash}`);
    } catch (e) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      fs.rmSync(zipFile, { force: true });
      if (!(e instanceof ZipTooLargeError)) throw e;
      console.log(`\nNo ZIP made: ${e.message}\nThe folder above is complete.`);
    }
  }
  const shown = path.relative(process.cwd(), outDir);
  console.log(`\nNext: check it with   npm run archive:verify -- --dir ${!shown || shown.startsWith("..") ? outDir : shown}\nThen copy it to a SECOND place (another provider, another account), and keep that copy read-only if the provider allows it.`);
} catch (e) {
  if (createdOut && outDir) fs.rmSync(outDir, { recursive: true, force: true }); // never leave half an archive that looks like a whole one
  if (e instanceof ExportRefused) {
    console.error(`\nRefused: ${e.message}`);
    for (const p of e.problems.slice(0, 20)) console.error(`  - ${p}`);
    if (e.problems.length > 20) console.error(`  - … (${e.problems.length - 20} more)`);
    if (e.problems.length) console.error("\nIf you want the export anyway, with the gaps written down, add --keep-going.");
    process.exitCode = 1;
  } else { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
} finally {
  await source.close();
}
