#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order to DATABASE_URL, recording them in public.schema_migrations.
// For Supabase projects you can equally use `supabase db push`; this runner exists for local/CI Postgres.
//   DATABASE_URL=postgres://… node scripts/migrate.mjs [--shim]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const useShim = process.argv.includes("--shim");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (useShim) await client.query(fs.readFileSync(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
  await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(root, "supabase/migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await client.query("select 1 from public.schema_migrations where name = $1", [file]);
    if (done.rowCount) continue;
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
} finally {
  await client.end();
}
