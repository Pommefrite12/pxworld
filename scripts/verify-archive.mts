// Checks the integrity of the archive.
//
//   npm run archive:verify -- --dir <export folder>        an export, with nothing but itself (no database, no storage)
//   npm run archive:verify -- --zip <file.zip>             the same, for the ZIP (read in memory: for archives that fit in it)
//   npm run archive:verify -- [--env <file>] [--revision N]   the LIVE site: the manifest of a snapshot against its recorded hash, and every
//                                                          picture in the storage against the hash the snapshot recorded (default: the latest)
//
// Exit code 0: everything is as recorded. 1: a problem (the list is printed). 2: wrong use. It only reads.
import fs from "node:fs";
import path from "node:path";
import { verifyExport, verifyStored, type VerifyReport } from "../src/lib/preservation/export";
import { listFiles, loadEnvFile, openSource } from "../src/lib/preservation/node";
import { readZip } from "../src/lib/preservation/zip";

const args = process.argv.slice(2);
const KNOWN = new Set(["dir", "zip", "env", "revision"]);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (message: string, code = 2): never => { console.error(message); process.exit(code); };
for (const a of args) if (a.startsWith("--") && !KNOWN.has(a.slice(2))) die(`Unknown option ${a}. See the top of scripts/verify-archive.mts.`);

const show = (title: string, r: VerifyReport) => {
  console.log(`${title}: ${r.checkedFiles} files checked, ${r.creations} pictures match their recorded hash.`);
  for (const w of r.warnings) console.log(`  note: ${w}`);
  if (r.ok) { console.log("OK — everything is as recorded."); return; }
  console.error(`\n${r.problems.length} PROBLEM(S):`);
  for (const p of r.problems.slice(0, 50)) console.error(`  - ${p}`);
  if (r.problems.length > 50) console.error(`  - … (${r.problems.length - 50} more)`);
  process.exitCode = 1;
};

if (opt("dir")) {
  const dir = path.resolve(opt("dir")!);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`${dir} is not a folder.`);
  show(`Export ${dir}`, await verifyExport({ list: async () => listFiles(dir), read: async (p) => { try { return new Uint8Array(fs.readFileSync(path.join(dir, ...p.split("/")))); } catch { return null; } } }));
} else if (opt("zip")) {
  const file = path.resolve(opt("zip")!);
  if (!fs.existsSync(file)) die(`${file} does not exist.`);
  let files: Map<string, Uint8Array>;
  try { files = readZip(new Uint8Array(fs.readFileSync(file))); } catch (e) { die(`${file} cannot be read as a ZIP made by archive:export: ${e instanceof Error ? e.message : e}`, 1); throw e; }
  show(`ZIP ${file}`, await verifyExport({ list: async () => [...files.keys()], read: async (p) => files.get(p) ?? null }));
} else {
  if (opt("env")) loadEnvFile(opt("env")!);
  const source = openSource();
  console.log(`Reading: ${source.where}`);
  try {
    const wanted = opt("revision") ? Number(opt("revision")) : null;
    const [s] = await source.query<{ revision: number; manifest_text: string; manifest_hash: string }>(
      `select revision, manifest::text as manifest_text, manifest_hash from public.edition_snapshots where ($1::int is null or revision = $1) order by revision desc limit 1`, [wanted]);
    if (!s) die("There is no snapshot to check against yet (one is taken when the edition closes).", 1);
    show(`Live site against snapshot #${s!.revision}`, await verifyStored({ manifestText: s!.manifest_text, recordedHash: s!.manifest_hash }, (p) => source.readObject(p)));
  } finally { await source.close(); }
}
