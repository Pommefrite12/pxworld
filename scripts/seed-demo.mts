// Fills a TEST site with made-up accounts and parcels, so that it does not look empty — and takes them away again.
//
//   npm run demo:seed   -- --env .env.production.local --i-know-this-is-a-test-site --project <supabase project id> [--count 50] [--water 20]
//     --water N adds N MORE accounts, each with a parcel on the sea (what is already there is left alone: running it again completes, never doubles)
//     --set heritage instead makes the 100 hand-drawn "world heritage" ILLUSTRATION parcels (historic places, cultures, food, music, science, today's world),
//     each on its real place, 50 × 50 pixels at most. They belong to ONE technical account, are shown as "Illustration image" (no author), are covered by any
//     purchase that touches them, and are KEPT by `clear` (they are meant to stay when the site opens). --count and --water are then ignored.
//   npm run demo:seed   -- --env .env.production.local --i-know-this-is-a-test-site --project <supabase project id> --volume 5000 [--owners 40]
//     VOLUME mode, to see the site with a world FULL of parcels: --volume N makes sure that N parcels exist (1 to 50000; running it again with a bigger number
//     completes it), owned by --owners accounts (40 by default), 25 to 900 pixels each, around the big cities and anywhere on land, already published.
//     Quick (a few dozen accounts, a small stock of pictures shared by all the parcels, rows inserted by batches). `clear` removes all of it.
//   npm run demo:status -- --env .env.production.local --i-know-this-is-a-test-site --project <supabase project id>
//   npm run demo:clear  -- --env .env.production.local --i-know-this-is-a-test-site --project <supabase project id> --yes [--illustrations]
//     removes the demonstration accounts and their parcels; the illustration parcels stay, unless --illustrations is added
//   npm run demo:clear  -- --env .env.production.local --i-know-this-is-a-test-site --project <supabase project id> --yes --everything
//     removes EVERY parcel of the site: the demonstration ones, the illustrations, and everybody's own (purchases, free imprints) with their creations, files,
//     comments, likes and purchases. The accounts of real people stay, and so do the audit log and the moderation history (the database refuses to change them).
//
// What it makes: `demo_…` accounts (e-mail demo-001@demo.invalid…), a big parcel each on land around the big cities, a generated picture each.
// What it does NOT make: any order, payment or moderation action (so no fake revenue, no fake audit trail). `clear` deletes all of it.
// The public counters of the site WILL show these numbers while they exist: remove them (`demo:clear`) before a real launch.
//
// It refuses to run unless: you say it is a test site, the environment holds no live Stripe key and the database no live payment, and
// (with Supabase) you give the project id the environment points to. On a local development database no project id is needed.
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { shouldUseSsl } from "../src/lib/db/ssl";
import { demoGuard } from "../src/lib/demo/plan";
import { clearDemo, clearIllustrations, demoStatus, seedDemo, wipeEverything, wipePreview, type DemoPorts } from "../src/lib/demo/seed";
import { heritagePlan } from "../src/lib/demo/heritage";
import { seedVolume } from "../src/lib/demo/volume";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
/** Accounts the database would not let go: said plainly, and the exit code says it too (the parcels are gone all the same). */
const reportFailures = (failed: string[]) => {
  if (!failed.length) return;
  console.log(`\n${failed.length} account(s) could not be removed (their parcels are gone; the accounts are harmless, and running the command again retries them):`);
  for (const f of failed.slice(0, 20)) console.log(`  - ${f}`);
  if (failed.length > 20) console.log(`  … and ${failed.length - 20} more`);
  process.exitCode = 1;
};
const die = (message: string, code = 1): never => { console.error(message); process.exit(code); };

if (!["seed", "clear", "status"].includes(command ?? "")) die("Usage: seed | clear | status  (see the top of scripts/seed-demo.mts)", 2);

// the environment of the site to fill: a file of NAME=value lines (never printed)
const envFile = opt("env");
if (envFile) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
}
const env = process.env;
const databaseUrl = env.DATABASE_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/pixelworld";
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? "", serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const mode: "supabase" | "local" = supabaseUrl && serviceKey ? "supabase" : "local";
const emailDomain = opt("email-domain") ?? "demo.invalid";

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: shouldUseSsl(databaseUrl, env.DATABASE_SSL) ? { rejectUnauthorized: false } : false, max: 4, connectionTimeoutMillis: 10_000 });
const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

try {
  // 1. the guards, before anything else happens: first the ones that need no connection (nothing is contacted if one refuses)…
  const guardInput = {
    mode, dbHost: new URL(databaseUrl).hostname, stripeKey: env.STRIPE_SECRET_KEY, paymentsLive: env.PAYMENTS_LIVE_ENABLED, confirmed: flag("i-know-this-is-a-test-site"),
    supabaseUrl, project: opt("project"), liveEvents: 0,
  };
  const ask = (reasons: string[]) => {
    if (command === "clear" && !flag("yes")) reasons.push(flag("everything") ? "add --yes to confirm the deletion of EVERY parcel of the site, the ones of real people included" : "add --yes to confirm the deletion of every demonstration account and parcel");
    if (command !== "clear" && flag("everything")) reasons.push("--everything only goes with clear");
    if (reasons.length) die(`Refused (nothing was touched):\n${reasons.map((w) => `  - ${w}`).join("\n")}`);
  };
  ask(demoGuard(guardInput));
  // …then the one that looks at the database: has real money ever moved through it?
  const liveEvents = Number((await query<{ n: string }>("select count(*) as n from public.stripe_events where payload->>'livemode' = 'true'"))[0]?.n ?? 0);
  ask(demoGuard({ ...guardInput, liveEvents }));

  // 2. the doors to the outside: accounts, files, the land map
  const [{ objectStore }, { landPixelsIn }] = await Promise.all([import("../src/lib/storage"), import("../src/lib/geo/landServer")]);
  const admin = mode === "supabase" ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }) : null;
  const bucket = admin ? admin.storage.from(env.SUPABASE_PUBLIC_BUCKET || "pixel-world-creations") : null;
  const ports: DemoPorts = {
    query,
    async createUser(email, username) {
      if (admin) {
        const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: randomBytes(24).toString("base64url"), user_metadata: { username } });
        if (error || !data.user) throw new Error(`Supabase refused the account ${email}: ${error?.message ?? "no user"}${/invalid/i.test(error?.message ?? "") ? " (try --email-domain with another address)" : ""}`);
        return data.user.id;
      }
      const [row] = await query<{ id: string }>("insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('username', $2::text)) returning id", [email, username]);
      return row!.id;
    },
    async deleteUser(id) {
      if (admin) { const { error } = await admin.auth.admin.deleteUser(id); if (error) throw new Error(`Supabase refused to delete ${id}: ${error.message}`); }
      else await query("delete from auth.users where id = $1", [id]);
    },
    // with Supabase the files go to the bucket of the project whatever else is in the environment (the site's own store would fall back to
    // the local disk when the public key is missing from the file, and the pictures would never reach the site)
    async putObject(key, bytes) {
      if (!bucket) return objectStore().put(key, bytes, "image/png");
      const { error } = await bucket.upload(key, bytes, { contentType: "image/png", upsert: false });
      if (error) throw new Error(`storage upload failed: ${error.message}`);
    },
    async removeObject(key) {
      if (!bucket) return objectStore().remove(key);
      const { error } = await bucket.remove([key]);
      if (error) throw new Error(`storage removal failed: ${error.message}`);
    },
    landPixels: (r) => landPixelsIn(r),
    log: (m) => console.log(m),
  };

  const target = mode === "supabase" ? `Supabase project ${new URL(supabaseUrl).hostname.split(".")[0]}` : `local database ${new URL(databaseUrl).hostname}`;
  // the keys are tried BEFORE anything is changed: a refused key must never leave a half-done job (parcels deleted, accounts still there)
  if (admin && bucket && command !== "status") {
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (users.error) die(`Refused (nothing was touched): Supabase does not accept SUPABASE_SERVICE_ROLE_KEY from this environment file (${users.error.message}).\n  Copy the CURRENT secret key from Supabase > Project Settings > API Keys (it starts with sb_secret_), with no space and no quotes. A key that was deleted or rotated is "unregistered".`);
    const files = await bucket.list("", { limit: 1 });
    if (files.error) die(`Refused (nothing was touched): the storage bucket "${env.SUPABASE_PUBLIC_BUCKET || "pixel-world-creations"}" cannot be read with this key (${files.error.message}).`);
  }
  if (command === "seed") {
    const set = opt("set");
    if (set !== undefined && set !== "heritage") die('--set must be "heritage"');
    const plan = set === "heritage" ? heritagePlan() : undefined;
    if (plan) {
      // the illustration parcels need migration 24 (the third tier): say so before anything is written, not through a constraint error
      const ok = await query("select 1 from pg_constraint where conname = 'parcels_tier_check' and pg_get_constraintdef(oid) like '%illustration%'");
      if (!ok.length) die("Refused (nothing was touched): the database does not have migration 24 yet (the illustration parcels).\n  Apply it first:  node scripts/migrate.mjs --env .env.production.local");
      // ... and the translations of their title and sentence need migration 25
      const col = await query("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'parcel_assets' and column_name = 'i18n'");
      if (!col.length) die("Refused (nothing was touched): the database does not have migration 25 yet (the translations of the illustration parcels).\n  Apply it first:  node scripts/migrate.mjs --env .env.production.local");
    }
    const volume = opt("volume");
    if (volume !== undefined) {
      // VOLUME mode: thousands of parcels, a few dozen accounts, a small stock of pictures, inserted by batches (see src/lib/demo/volume.ts)
      const n = Number(volume), owners = Number(opt("owners") ?? 40);
      if (plan || opt("count") !== undefined || opt("water") !== undefined) die("--volume cannot be combined with --set, --count or --water");
      if (!Number.isInteger(n) || n < 1 || n > 50_000) die("--volume must be a whole number from 1 to 50000");
      if (!Number.isInteger(owners) || owners < 1 || owners > 300) die("--owners must be a whole number from 1 to 300");
      console.log(`Filling ${target} with ${n} parcels (${owners} accounts, a small stock of pictures, inserted by batches; about ${Math.round(n * 1.6 / 1024 * 10) / 10} MB of database)…`);
      const t0 = Date.now();
      const r = await seedVolume(ports, { count: n, owners, seed: Number(opt("seed") ?? 1), emailDomain });
      console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s: ${r.created} parcels created (${r.existing} already there), ${r.ownersCreated} accounts created, ${r.pictures} pictures stored.${r.short ? ` ${r.short} could not be placed (no free land found).` : ""}`);
      await query("update public.map_state set version = version + 1, updated_at = now() where id = 1");
    } else {
    const count = plan ? plan.length : Number(opt("count") ?? 50);
    if (!Number.isInteger(count) || count < 1 || count > 500) die("--count must be a whole number from 1 to 500");
    const water = plan ? 0 : Number(opt("water") ?? 0);
    if (!Number.isInteger(water) || water < 0 || water > 200) die("--water must be a whole number from 0 to 200");
    console.log(`Filling ${target} with ${plan ? `${count} illustration parcels (one technical account, shown as "Illustration image")` : `${count} demonstration accounts and parcels${water ? `, then ${water} more on the sea` : ""}`} (pictures: ${bucket ? `Supabase bucket ${env.SUPABASE_PUBLIC_BUCKET || "pixel-world-creations"}` : "local folder"})…`);
    const r = await seedDemo(ports, { count, water, seed: Number(opt("seed") ?? 1), emailDomain, plan });
    console.log(`\nDone: ${r.usersCreated} accounts created (${r.usersFound} already there), ${r.parcelsCreated} parcels created (${r.parcelsSkipped} already there).`);
    if (r.failed.length) { console.log(`${r.failed.length} could not be made:\n${r.failed.map((f) => `  - ${f}`).join("\n")}`); process.exitCode = 1; }
    }
  } else if (command === "clear" && flag("everything")) {
    const before = await wipePreview(ports, { emailDomain });
    console.log(`About to remove from ${target}: ${before.parcels} parcels (all of them, whoever owns them), ${before.orders} purchases (${before.paidOrders} paid, in TEST mode: no real money has ever moved here) with ${before.payments} payments, ${before.projects} fundraising projects in progress or funded (with ${before.contributions} contributions), ${before.files} picture files, ${before.accounts} demonstration accounts.`);
    console.log("Accounts of real people, settings, editions, the audit log and the moderation history stay.\n");
    const t0 = Date.now();
    const r = await wipeEverything(ports, { emailDomain });
    console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s: ${r.parcels} parcels, ${r.orders} purchases, ${r.payments} payments, ${r.projects} fundraising projects, ${r.contributions} contributions, ${r.files} files and ${r.demoAccounts} demonstration accounts removed.`);
    reportFailures(r.failed);
  } else if (command === "clear") {
    console.log(`Removing every demonstration account from ${target}…`);
    const r = await clearDemo(ports, { emailDomain });
    console.log(`Done: ${r.users} accounts, ${r.parcels} parcels and ${r.files} files removed.`);
    reportFailures(r.failed);
    if (flag("illustrations")) {
      const i = await clearIllustrations(ports, { emailDomain });
      console.log(`Illustrations: ${i.parcels} parcels, ${i.files} files and ${i.accounts} technical account removed.`);
      reportFailures(i.failed);
    }
  }
  const s = await demoStatus(ports, { emailDomain });
  console.log(`\n${target}: ${s.users} demonstration accounts, ${s.parcels} demonstration parcels, ${s.illustrations} illustration parcels (these stay when the site opens), ${s.allParcels} parcels in all.`);
  console.log(`Public counters now: ${s.publicCounters.soldPixels.toLocaleString("en")} pixels sold, ${s.publicCounters.parcels} parcels, ${s.publicCounters.owners} owners, ${s.publicCounters.creations} creations.`);
  if (command === "seed") console.log("The site shows them within a minute (reload with Ctrl+Shift+R). Before a real launch: npm run demo:clear removes the demonstration accounts (the illustration parcels stay).");
} finally {
  await pool.end();
}
