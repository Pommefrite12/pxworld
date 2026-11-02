#!/usr/bin/env node
// Runs before `npm run dev` (npm "predev"): brings a LOCAL development database up to date.
//
// Why: a Codespace creates its tables once, when it is created. After a `git pull` that brings new migrations the site
// would run against an older database and fail in confusing ways (for example, a purchase refused because the database
// does not know the new image sizes yet). This applies what is missing, so that pulling and restarting is enough.
//
// It only ever touches a LOCAL database (localhost, 127.0.0.1, or a bare Docker service name such as `db`). A remote
// database (Supabase…) is never changed from here: use `supabase db push` there. If the database is not reachable the
// site still starts; the reason is printed.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalDatabase } from "./db-local.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try { // `next dev` reads .env.local by itself; this script has to do it by hand
    const m = fs.readFileSync(path.join(root, ".env.local"), "utf8").match(/^DATABASE_URL=(.+)$/m);
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch { return undefined; }
}

const url = databaseUrl();
if (!url) {
  console.log("▶ No DATABASE_URL: skipping the database update.");
} else if (!isLocalDatabase(url)) {
  console.log("▶ Remote database: not updated from here (apply supabase/migrations with `supabase db push`).");
} else {
  const r = spawnSync("node", [path.join(root, "scripts/migrate.mjs"), "--shim"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status === 0) {
    console.log(out.includes("applying") ? `▶ Database updated:\n${out.split("\n").filter((l) => l.startsWith("applying")).map((l) => `  ${l}`).join("\n")}` : "▶ Database is up to date.");
  } else {
    console.log(`▶ The database could not be updated (the site starts anyway): ${out.split("\n").find((l) => /error|ECONN|refused|FAILED/i.test(l)) ?? out.split("\n")[0]}`);
    console.log("  If purchases fail, start PostgreSQL and run: npm run db:setup");
  }
}
