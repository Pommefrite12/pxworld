import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { shouldUseSsl } from "../db/ssl";

/**
 * What the two preservation scripts need from the machine they run on: the environment of the site (a file of NAME=value lines, never printed),
 * the database, and the storage where the pictures are. Read-only: nothing here writes to the database or to the storage.
 */

/** Puts the NAME=value lines of a file into `process.env` (the same reading as `scripts/seed-demo.mts`). */
export function loadEnvFile(file: string): void {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
}

export interface Source {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  readObject(storagePath: string): Promise<Uint8Array | null>;
  /** what is being read, for the first line the script prints: never a secret */
  where: string;
  close(): Promise<void>;
}

const safeKey = (key: string) => { if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error(`invalid storage key ${JSON.stringify(key)}`); return key; };

export function openSource(env: NodeJS.ProcessEnv = process.env): Source {
  const databaseUrl = env.DATABASE_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/pixelworld";
  const host = new URL(databaseUrl).hostname;
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: shouldUseSsl(databaseUrl, env.DATABASE_SSL) ? { rejectUnauthorized: false } : false, max: 4, connectionTimeoutMillis: 10_000 });
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "", key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const common = { query: async <T,>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[], close: () => pool.end() };
  if (url && key) {
    const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from(env.SUPABASE_PUBLIC_BUCKET ?? "pixel-world-creations");
    return {
      ...common, where: `database ${host}, pictures in the Supabase bucket ${env.SUPABASE_PUBLIC_BUCKET ?? "pixel-world-creations"}`,
      async readObject(p) {
        const { data, error } = await bucket.download(safeKey(p));
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
    };
  }
  const dir = path.resolve(env.LOCAL_STORAGE_DIR ?? ".data/storage");
  return {
    ...common, where: `database ${host}, pictures in the folder ${dir}`,
    async readObject(p) {
      try { return new Uint8Array(await fs.promises.readFile(path.resolve(dir, safeKey(p)))); } catch { return null; }
    },
  };
}

/** The labels of the categories and the legal pages, from the message files (the words the site itself uses). */
export function readMessages(root = path.resolve(process.cwd(), "src/messages")) {
  const load = (lang: "en" | "fr") => JSON.parse(fs.readFileSync(path.join(root, `${lang}.json`), "utf8")) as { archive: { categories: Record<string, string> }; pages: { terms: import("./manifest").LegalPage } };
  const en = load("en"), fr = load("fr");
  return { labels: { en: en.archive.categories, fr: fr.archive.categories }, terms: { en: en.pages.terms, fr: fr.pages.terms } };
}

/** Every file under a folder, as relative paths with `/` (what an export folder looks like to `verifyExport`). */
export function listFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r)); else if (e.isFile()) out.push(r);
  }
  return out.sort();
}
