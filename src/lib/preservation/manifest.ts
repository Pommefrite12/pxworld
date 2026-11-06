import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * The pure parts of the preservation of the archive (no database, no disk): the manifest of a snapshot, its CSV, the list of checksums, the page that
 * reads the archive without our software, the plain-text copy of the terms. The export (`export.ts`) and the scripts put them to work.
 *
 * Open formats only (PNG, JSON, CSV, HTML, text), so that the archive stays readable without Pixel World.
 */

export const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

const nullableText = z.string().nullable();
const CreationSchema = z.object({
  asset_id: z.string(), version: z.number(), content_hash: z.string().min(1), storage_path: z.string().min(1),
  width: z.number(), height: z.number(), title: nullableText, description: nullableText, published_at: nullableText,
  // snapshots taken before migration 21 do not have the archive fields: absent, not an error
  category: nullableText.optional(), place_label: nullableText.optional(), place_country: nullableText.optional(),
});
const ItemSchema = z.object({
  code: z.string().min(1), x: z.number(), y: z.number(), w: z.number(), h: z.number(), kind: z.string(),
  author: z.string(), activated_at: nullableText, creation: CreationSchema.nullable(),
});
export type ManifestItem = z.infer<typeof ItemSchema>;
export type ManifestCreation = z.infer<typeof CreationSchema>;

/** The items of a manifest, from its text (the very text the hash is taken of). Throws an Error saying what is wrong. */
export function parseManifest(text: string): ManifestItem[] {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("the manifest is not valid JSON"); }
  const r = z.array(ItemSchema).safeParse(json);
  if (!r.success) throw new Error(`the manifest does not have the expected shape: ${r.error.issues[0]?.path.join(".") ?? ""} ${r.error.issues[0]?.message ?? ""}`.trim());
  const seen = new Set<string>();
  for (const i of r.data) {
    if (!/^[A-Za-z0-9_-]+$/.test(i.code)) throw new Error(`the manifest holds a parcel code that is not a plain code: ${JSON.stringify(i.code)}`);
    if (seen.has(i.code)) throw new Error(`the manifest holds the parcel ${i.code} twice`);
    seen.add(i.code);
  }
  return r.data;
}

/** Where the file of a creation sits in the export. */
export const creationFile = (code: string) => `creations/${code}.png`;

/* ------------------------------------------------------------------------------------------------------------------------ CSV */

export const CSV_COLUMNS = ["code", "x", "y", "w", "h", "kind", "author", "archived_at", "title", "description", "category", "place_label", "place_country", "file", "sha256", "width", "height"] as const;

/**
 * One CSV field (RFC 4180). A text that starts with = + - @ (or a tab or a carriage return) is the way a spreadsheet is made to run a formula:
 * it gets a leading apostrophe, so that opening the file in Excel or LibreOffice can never execute anything. `manifest.json` keeps the exact text.
 */
export function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The CSV of the archive, one row per parcel. `present` tells which creation files are in the export (the others have an empty `file`). */
export function buildCsv(items: ManifestItem[], present: ReadonlySet<string>): string {
  const rows = items.map((i) => {
    const c = i.creation;
    return [i.code, i.x, i.y, i.w, i.h, i.kind, i.author, i.activated_at, c?.title, c?.description, c?.category, c?.place_label, c?.place_country,
      c && present.has(i.code) ? creationFile(i.code) : "", c?.content_hash, c?.width, c?.height].map(csvField).join(",");
  });
  return `${CSV_COLUMNS.join(",")}\r\n${rows.map((r) => `${r}\r\n`).join("")}`;
}

/* ------------------------------------------------------------------------------------------------------------------------ checksums */

/** The `SHA256SUMS` file, in the format `sha256sum -c` reads: `<hash>  <path>`, sorted by path. */
export function buildSums(files: ReadonlyMap<string, string>): string {
  return [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, hash]) => `${hash}  ${path}\n`).join("");
}

export function parseSums(text: string): { entries: Map<string, string>; bad: string[] } {
  const entries = new Map<string, string>(), bad: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (!m) bad.push(line.slice(0, 80)); else entries.set(m[2]!, m[1]!);
  }
  return { entries, bad };
}

/* ------------------------------------------------------------------------------------------------------------------------ retractions */

/**
 * What was in an earlier snapshot of the edition and is no longer in this one: the traces moderation retracted since (hidden, or the author's
 * account suspended or deleted). An old snapshot is never rewritten; a retraction makes a new revision, and this list says what it took away.
 */
export function findRetractions(currentCodes: Iterable<string>, earlier: readonly { revision: number; codes: readonly string[] }[]): { code: string; last_seen_revision: number }[] {
  const now = new Set(currentCodes), last = new Map<string, number>();
  for (const s of [...earlier].sort((a, b) => a.revision - b.revision)) for (const code of s.codes) last.set(code, s.revision);
  return [...last].filter(([code]) => !now.has(code)).map(([code, revision]) => ({ code, last_seen_revision: revision })).sort((a, b) => (a.code < b.code ? -1 : 1));
}

/* ------------------------------------------------------------------------------------------------------------------------ the terms as text */

export interface LegalPage { title: string; intro: string; sections: { h: string; p?: string[]; ul?: string[] }[] }

/** A plain-text copy of a legal page as it stood when the archive was exported (the placeholders `{operatorName}`… are left as they are). */
export function renderLegalText(page: LegalPage): string {
  const out = [page.title, "=".repeat(page.title.length), "", page.intro, ""];
  for (const s of page.sections) {
    out.push(s.h, "-".repeat(s.h.length));
    for (const p of s.p ?? []) out.push(p, "");
    if (s.ul) { for (const li of s.ul) out.push(`* ${li}`); out.push(""); }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/* ------------------------------------------------------------------------------------------------------------------------ the page that reads the archive */

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export interface IndexInput {
  editionName: string;
  revision: number | null;
  takenAt: string;
  items: ManifestItem[];
  present: ReadonlySet<string>;
  /** the words of the categories, by language */
  labels: { en: Readonly<Record<string, string>>; fr: Readonly<Record<string, string>> };
  preview: boolean;
}

/**
 * `index.html`: the whole archive on one static page — no script, no external file, no network: a picture, a title, an author, a date, a
 * category and a place for every trace, in English and in French. It opens in any browser, today and in fifty years.
 */
export function buildIndexHtml(i: IndexInput): string {
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  const cards = [...i.items].sort((a, b) => ((a.activated_at ?? "") < (b.activated_at ?? "") ? -1 : (a.activated_at ?? "") > (b.activated_at ?? "") ? 1 : a.code < b.code ? -1 : 1)).map((it) => {
    const c = it.creation;
    const cat = c?.category ? `${escapeHtml(i.labels.en[c.category] ?? c.category)} / ${escapeHtml(i.labels.fr[c.category] ?? c.category)}` : "";
    const place = c?.place_label ? escapeHtml(c.place_label) + (c.place_country ? ` (${escapeHtml(c.place_country)})` : "") : c?.place_country ? escapeHtml(c.place_country) : "";
    const pic = c && i.present.has(it.code) ? `<img src="${creationFile(it.code)}" width="${c.width}" height="${c.height}" alt="${escapeHtml(c.title ?? it.code)}" loading="lazy">` : `<span class="none">—</span>`;
    return `<li id="${escapeHtml(it.code)}"><div class="pic">${pic}</div><h2>${escapeHtml(c?.title ?? it.code)}</h2>`
      + `<p class="meta">${escapeHtml(it.author)} · ${escapeHtml(day(it.activated_at))}</p>`
      + (cat ? `<p class="meta">${cat}</p>` : "") + (place ? `<p class="meta">${place}</p>` : "")
      + (c?.description ? `<p class="desc">${escapeHtml(c.description)}</p>` : "")
      + `<p class="meta small">${it.w}×${it.h} px · x ${it.x}, y ${it.y} · ${escapeHtml(it.code)}</p></li>`;
  }).join("\n");
  const note = i.preview ? `<p class="preview">PREVIEW — this copy was made before the closing of the edition and is not an archive. / APERÇU — copie faite avant la clôture de l'édition, ce n'est pas une archive.</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(i.editionName)} — Pixel World</title>
<style>
body{margin:0;background:#190921;color:#f1e8df;font:16px/1.5 system-ui,sans-serif}
header,main{max-width:1180px;margin:0 auto;padding:1.5rem 1.25rem}
h1{font-size:2rem;margin:0 0 .25rem;color:#d6ab72}
.sub{color:#b9aebf;margin:0}
.preview{background:#d6ab72;color:#190921;padding:.5rem .75rem;font-weight:700}
ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem}
li{background:#2a1640;border:2px solid #382050;padding:.75rem}
.pic{background:#382050;display:flex;align-items:center;justify-content:center;min-height:160px;padding:.5rem}
.pic img{width:100%;height:auto;image-rendering:pixelated}
h2{font-size:1.05rem;margin:.6rem 0 .1rem}
.meta{margin:0;color:#d6ab72;font-size:.9rem}.small{color:#b9aebf;font-size:.8rem}
.desc{margin:.4rem 0 0;white-space:pre-wrap;word-break:break-word}
</style>
</head>
<body>
<header>
<h1>${escapeHtml(i.editionName)}</h1>
<p class="sub">Pixel World — collective archive / archive collective · ${i.items.length} · snapshot${i.revision ? ` #${i.revision}` : ""} ${escapeHtml(day(i.takenAt))}</p>
${note}
</header>
<main>
<ul>
${cards}
</ul>
</main>
</body>
</html>
`;
}

/* ------------------------------------------------------------------------------------------------------------------------ README */

export interface ReadmeInput {
  editionName: string;
  revision: number | null;
  takenAt: string;
  exportedAt: string;
  parcels: number;
  creations: number;
  manifestHash: string;
  preview: boolean;
  problems: number;
  retractions: number;
  hasTerms: boolean;
  /** `false` when the snapshot was taken before migration 21: no category and no place in it */
  hasArchiveFields: boolean;
}

export function buildReadme(r: ReadmeInput): string {
  const snap = r.revision ? `snapshot #${r.revision} taken ${r.takenAt}` : `PREVIEW taken ${r.takenAt} (before the closing: not an archive)`;
  const snapFr = r.revision ? `cliché n°${r.revision} pris le ${r.takenAt}` : `APERÇU pris le ${r.takenAt} (avant la clôture : ce n'est pas une archive)`;
  return `PIXEL WORLD — ${r.editionName}
${"=".repeat(`PIXEL WORLD — ${r.editionName}`.length)}

ENGLISH
-------
This folder is a readable copy of the "${r.editionName}" edition of Pixel World, a collective archive of our time: ${r.parcels} parcels, ${r.creations} creations
(${snap}; exported ${r.exportedAt}). It needs no software of ours: open index.html in any web browser.

  index.html        the whole archive on one page (picture, title, author, date, category, place)
  creations/        one PNG per creation, named after the code of its parcel
  manifest.json     the snapshot: every parcel and creation, with the sha256 of each picture (this file is byte for byte what the database recorded)
  manifest.sha256   the hash the database recorded for manifest.json
  manifest.csv      the same list for a spreadsheet (UTF-8, comma-separated; a text that starts with = + - or @ got a leading apostrophe so that
                    a spreadsheet never runs it: manifest.json holds the exact text)
  edition.json      the edition (name, opening, closing) and the snapshot (revision, date, count, hash)
  retractions.json  what an earlier snapshot held and this one no longer does (traces withdrawn by moderation since)${r.retractions ? ` — ${r.retractions} listed` : ""}
${r.hasTerms ? "  terms/            the terms of service as they stood on the day of the export (a provisional text)\n" : ""}  SHA256SUMS        the sha256 of every file above, to check that nothing was changed or lost

To check this copy: on Linux or macOS, in this folder, run   sha256sum -c SHA256SUMS   (macOS: shasum -a 256 -c SHA256SUMS).
On Windows (PowerShell):   Get-FileHash .\\manifest.json   and compare with manifest.sha256.
With the project's tools:  npm run archive:verify -- --dir <this folder>
The hash of the manifest is ${r.manifestHash}
${r.hasArchiveFields ? "" : "\nThis snapshot was taken before categories and places were recorded in snapshots: those columns are empty.\n"}${r.problems ? `\nWARNING: ${r.problems} creation file(s) could not be included or did not match their recorded hash: see PROBLEMS.txt.\n` : ""}${r.preview ? "\nThis is a PREVIEW made before the closing of the edition. Do not keep it as the archive.\n" : ""}
This copy is a readable snapshot; what the service promises, and what it does not (it does not promise to keep anything for ever), is in the terms.

FRANÇAIS
--------
Ce dossier est une copie lisible de l'édition « ${r.editionName} » de Pixel World, une archive collective de notre époque : ${r.parcels} parcelles, ${r.creations} créations
(${snapFr} ; exporté le ${r.exportedAt}). Il n'a besoin d'aucun logiciel de notre part : ouvrez index.html dans un navigateur.

  index.html        toute l'archive sur une page (image, titre, auteur, date, catégorie, lieu)
  creations/        un PNG par création, nommé d'après le code de sa parcelle
  manifest.json     le cliché : chaque parcelle et chaque création, avec le sha256 de chaque image (ce fichier est, octet pour octet, ce que la base a enregistré)
  manifest.sha256   l'empreinte que la base a enregistrée pour manifest.json
  manifest.csv      la même liste pour un tableur (UTF-8, séparée par des virgules ; un texte qui commence par = + - ou @ a reçu une apostrophe devant,
                    pour qu'un tableur ne l'exécute jamais : manifest.json garde le texte exact)
  edition.json      l'édition (nom, ouverture, clôture) et le cliché (révision, date, nombre, empreinte)
  retractions.json  ce qu'un cliché antérieur contenait et que celui-ci ne contient plus (traces retirées depuis par la modération)
${r.hasTerms ? "  terms/            les conditions d'utilisation telles qu'elles étaient le jour de l'export (texte provisoire)\n" : ""}  SHA256SUMS        le sha256 de chaque fichier ci-dessus, pour vérifier que rien n'a été modifié ni perdu

Pour vérifier cette copie : sous Linux ou macOS, dans ce dossier, lancez   sha256sum -c SHA256SUMS   (macOS : shasum -a 256 -c SHA256SUMS).
Sous Windows (PowerShell) :   Get-FileHash .\\manifest.json   et comparez avec manifest.sha256.
Avec les outils du projet :   npm run archive:verify -- --dir <ce dossier>
${r.hasArchiveFields ? "" : "\nCe cliché a été pris avant que les catégories et les lieux soient enregistrés dans les clichés : ces colonnes sont vides.\n"}${r.problems ? `\nATTENTION : ${r.problems} fichier(s) de création n'ont pas pu être inclus ou ne correspondent pas à leur empreinte : voir PROBLEMS.txt.\n` : ""}${r.preview ? "\nCeci est un APERÇU fait avant la clôture de l'édition. Ne le gardez pas comme archive.\n" : ""}
Cette copie est un cliché lisible ; ce que le service promet, et ce qu'il ne promet pas (il ne promet pas de tout conserver pour toujours), est dans les conditions.
`;
}
