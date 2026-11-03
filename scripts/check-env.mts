// Checks an environment against what a PRODUCTION deployment needs, before it costs anything.
//   vercel env pull .env.production.local --environment=production && npx tsx scripts/check-env.mts .env.production.local
//   npx tsx scripts/check-env.mts            (checks the variables of the current shell)
//   npx tsx scripts/check-env.mts .env.production.local --online     (also asks Supabase and the database whether they accept what is set)
// Prints the name of each variable that is missing or wrong — never a value. Exit code 1 if there is an error.
import fs from "node:fs";
import pg from "pg";
import { configProblems } from "../src/lib/config-check";
import { shouldUseSsl } from "../src/lib/db/ssl";

const args = process.argv.slice(2);
const online = args.includes("--online");
const file = args.find((a) => !a.startsWith("--"));
const vars: Record<string, string | undefined> = { ...process.env };
if (file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) vars[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
}
const problems = configProblems(vars);
for (const p of problems) console.log(`${p.level === "error" ? "ERROR" : "warn "} ${p.key}: ${p.message}`);
let errors = problems.filter((p) => p.level === "error").length;

/** The online checks: what Supabase and the database say about the values that are set. Only names and verdicts are printed. */
async function onlineChecks(): Promise<number> {
  let bad = 0;
  const say = (ok: boolean, text: string) => { console.log(`${ok ? "  ok  " : "ERROR "}${text}`); if (!ok) bad++; };
  const url = (vars.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, ""), anon = (vars.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim(), service = (vars.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const headers = (key: string): Record<string, string> => (key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` });
  console.log("\nAsking Supabase and the database (nothing is written):");
  if (url && anon) {
    try {
      const r = await fetch(`${url}/auth/v1/settings`, { headers: headers(anon) });
      say(r.ok, r.ok ? "NEXT_PUBLIC_SUPABASE_ANON_KEY: Supabase accepts the public key" : `NEXT_PUBLIC_SUPABASE_ANON_KEY: Supabase REFUSES the public key (HTTP ${r.status}) — copy it again, whole, from Project Settings → API Keys`);
      if (r.ok) {
        const j = (await r.json()) as { disable_signup?: boolean; mailer_autoconfirm?: boolean; external?: { email?: boolean } };
        say(j.disable_signup !== true && j.external?.email !== false, j.disable_signup === true ? "sign-ups are DISABLED in Supabase (Authentication → Sign In / Providers)" : "sign-ups with e-mail are open");
        console.log(`  info  e-mail confirmation is ${j.mailer_autoconfirm ? "OFF (accounts are created without an e-mail: fine for a test)" : "ON (an e-mail is sent: the free service sends only a few an hour)"}`);
      }
    } catch (e) { say(false, `NEXT_PUBLIC_SUPABASE_URL: cannot reach ${new URL(url).host} (${(e as Error).message})`); }
  }
  if (url && service) {
    try {
      const r = await fetch(`${url}/storage/v1/bucket/pixel-world-creations`, { headers: headers(service) });
      say(r.ok, r.ok ? "SUPABASE_SERVICE_ROLE_KEY: Supabase accepts the secret key, and the bucket pixel-world-creations exists" : r.status === 404 || r.status === 400 ? "the bucket pixel-world-creations does not exist: run supabase/storage.sql in the SQL editor (step 1E)" : `SUPABASE_SERVICE_ROLE_KEY: Supabase REFUSES the secret key (HTTP ${r.status})`);
    } catch (e) { say(false, `storage: cannot reach Supabase (${(e as Error).message})`); }
  }
  if (vars.DATABASE_URL && !/\[[^\]]*\]/.test(vars.DATABASE_URL)) {
    const client = new pg.Client({ connectionString: vars.DATABASE_URL.trim(), ssl: shouldUseSsl(vars.DATABASE_URL.trim(), vars.DATABASE_SSL) ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 10_000 });
    try {
      await client.connect();
      const r = await client.query("select value from public.app_settings where key = 'price_unit_cents_usd'");
      say(r.rowCount === 1, r.rowCount === 1 ? "DATABASE_URL: the database answers and the 14 migrations are applied" : "DATABASE_URL: the database answers but is not up to date: run `node scripts/migrate.mjs` (step 1F)");
    } catch (e) {
      const m = (e as Error).message;
      say(false, `DATABASE_URL: ${/password authentication/.test(m) ? "the database refuses the password" : /Tenant or user not found/.test(m) ? "wrong user (the address must start with postgresql://postgres.<project id>:)" : /ENOTFOUND|EAI_AGAIN/.test(m) ? "host not found" : /does not exist|relation/.test(m) ? "connected, but the tables are missing: run `node scripts/migrate.mjs` (step 1F)" : m.replace(/\/\/[^@\s]*@/g, "//…@")}`);
    } finally { await client.end().catch(() => undefined); }
  }
  return bad;
}
if (online) errors += await onlineChecks();

console.log(`\n${errors} error(s), ${problems.length - problems.filter((p) => p.level === "error").length} warning(s).${errors ? "" : problems.length ? " Nothing blocks the deployment; read the warnings." : " Nothing to report."}`);
process.exit(errors ? 1 : 0);
