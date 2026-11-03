#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order to DATABASE_URL, recording them in public.schema_migrations.
// For Supabase projects you can equally use `supabase db push`; this runner exists for local/CI Postgres.
//   DATABASE_URL=postgres://… node scripts/migrate.mjs [--shim]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const useShim = process.argv.includes("--shim");
// --env FILE: the environment of the site to migrate (NAME=value lines). It OVERRIDES what the shell already has (a Codespace has its own
// DATABASE_URL, for the local development database): node's --env-file does not, and the migrations would silently go to the wrong database.
const envAt = process.argv.indexOf("--env");
if (envAt >= 0) {
  const file = process.argv[envAt + 1];
  if (!file) throw new Error("--env needs a file name");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
// --shim is for plain PostgreSQL only, so it can safely default to the local development database
const url = process.env.DATABASE_URL ?? (useShim ? "postgres://pixel:pixel@127.0.0.1:54329/pixelworld" : undefined);
if (!url) throw new Error("DATABASE_URL is required");

// Same rule as the application (src/lib/db/ssl.ts): a managed database (Supabase…) is reached through a public host name and speaks TLS;
// a local one does not. `DATABASE_SSL=true|false` always wins. Do not put `?sslmode=` in the address.
const host = new URL(url).hostname;
const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || !host.includes(".");
const useSslForUrl = process.env.DATABASE_SSL === "true" ? true : process.env.DATABASE_SSL === "false" ? false : !local;
console.log(`Database: ${host} ${local ? "(on this machine)" : "(managed, over TLS)"}`); // never the password
const client = new pg.Client({ connectionString: url, ssl: useSslForUrl ? { rejectUnauthorized: false } : false });
await client.connect();
try {
  if (useShim) await client.query(fs.readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
  await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(root, "supabase/migrations");
  let applied = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await client.query("select 1 from public.schema_migrations where name = $1", [file]);
    if (done.rowCount) continue;
    applied++;
    process.stdout.write(`applying ${file} … `);
    await client.query("begin");
    try {
      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log("ok");
    } catch (e) {
      await client.query("rollback");
      console.log("FAILED");
      throw e;
    }
  }
  if (!applied) console.log("Nothing to apply: this database is up to date.");
} finally {
  await client.end();
}
