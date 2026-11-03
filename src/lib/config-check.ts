/**
 * What is wrong with the configuration of a PRODUCTION deployment — before it costs anything. Pure (it only reads the variables it is
 * given), so that the server can log it at start-up, `scripts/check-env.mts` can run it on an environment pulled from Vercel, and the
 * tests can check it. An `error` means a feature of the live site will not work (or is unsafe); a `warn` means "look at this".
 * Nothing here ever prints a value of a secret: only the name of the variable.
 */
import { parseEnd } from "@/lib/doom/clock";

export interface ConfigProblem { level: "error" | "warn"; key: string; message: string }
type Vars = Record<string, string | undefined>;

const PLACEHOLDER_SALTS = new Set(["change-me", "pixel-world-dev-salt", "changeme", "secret", "salt"]);
const isLocalHost = (h: string) => /^(localhost|127\.|0\.0\.0\.0|\[::1\]|[^.]+$)/.test(h);

export function configProblems(v: Vars, now: number = Date.now()): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  const add = (level: ConfigProblem["level"], key: string, message: string) => out.push({ level, key, message });
  const has = (k: string) => Boolean(v[k] && v[k]!.trim() !== "");

  // the site's own address
  try {
    const u = new URL(v.NEXT_PUBLIC_SITE_URL ?? "");
    if (u.protocol !== "https:") add("error", "NEXT_PUBLIC_SITE_URL", "must be the public https address of the site (it feeds the share previews, the Stripe return addresses and the origin check)");
    else if (isLocalHost(u.hostname)) add("error", "NEXT_PUBLIC_SITE_URL", "still points to a local machine");
  } catch { add("error", "NEXT_PUBLIC_SITE_URL", "missing or not a URL: set the public https address of the site"); }

  // database, auth, storage
  if (!has("DATABASE_URL")) add("error", "DATABASE_URL", "missing: nothing works without the database (on Vercel use the POOLER connection string)");
  else if (v.DATABASE_SSL === "false") {
    let host = "";
    try { host = new URL(v.DATABASE_URL!).hostname; } catch { /* a malformed address fails elsewhere, loudly */ }
    if (host && !isLocalHost(host)) add("warn", "DATABASE_SSL", "SSL is switched off for a database that is not on this machine");
  }
  if (!has("NEXT_PUBLIC_SUPABASE_URL") || !has("NEXT_PUBLIC_SUPABASE_ANON_KEY")) add("error", "NEXT_PUBLIC_SUPABASE_URL", "Supabase is not configured: nobody can sign in on a production build (the development sign-in is impossible there)");
  if (!has("SUPABASE_SERVICE_ROLE_KEY")) add("error", "SUPABASE_SERVICE_ROLE_KEY", "missing: creations cannot be stored and read (private storage bucket)");

  // secrets that must not be the ones everybody can read in the repository
  const salt = v.RATE_LIMIT_SALT ?? "";
  if (!salt) add("error", "RATE_LIMIT_SALT", "missing: the salt of the address hashes would be the public default; set a long random value");
  else if (PLACEHOLDER_SALTS.has(salt.toLowerCase()) || salt.length < 16) add("error", "RATE_LIMIT_SALT", "is a placeholder or too short: set a long random value (at least 16 characters)");
  if (!has("CRON_SECRET")) add("warn", "CRON_SECRET", "missing: the maintenance job (late payments, refund retries, expired reservations) will refuse to run");

  // payments
  const key = v.STRIPE_SECRET_KEY ?? "";
  if (!key) add("warn", "STRIPE_SECRET_KEY", "missing: nobody can pay (purchases are disabled, with a clear message)");
  else {
    if (!/^(sk|rk)_(test|live)_/.test(key)) add("error", "STRIPE_SECRET_KEY", "does not look like a Stripe secret key (sk_test_… or sk_live_…)");
    if (!has("STRIPE_WEBHOOK_SECRET")) add("error", "STRIPE_WEBHOOK_SECRET", "missing: payments would never turn into parcels (the verified webhook is the only way)");
    if (key.startsWith("sk_live_") && v.PAYMENTS_LIVE_ENABLED !== "yes-i-have-approval") add("error", "STRIPE_SECRET_KEY", "is a LIVE key: the code refuses it until live payments are explicitly approved");
    if (key.startsWith("sk_live_") && v.PAYMENTS_LIVE_ENABLED === "yes-i-have-approval") add("warn", "PAYMENTS_LIVE_ENABLED", "REAL payments are on");
  }

  // development doors, which a production build ignores but which should not be there
  for (const k of ["DEV_AUTH", "NEXT_PUBLIC_DEV_AUTH", "DEV_AUTH_SECRET", "STRIPE_MOCK", "LOCAL_STORAGE_DIR"]) if (has(k)) add("warn", k, "is a development variable: remove it from the production environment");

  // legal identity of the seller
  const operator = [...["NAME", "ADDRESS", "REGISTRATION", "VAT"].filter((k) => !has(`NEXT_PUBLIC_OPERATOR_${k}`)).map((k) => k.toLowerCase()), ...(has("NEXT_PUBLIC_CONTACT_EMAIL") ? [] : ["contact e-mail"])];
  if (operator.length) add("warn", "NEXT_PUBLIC_OPERATOR_*", `the seller's identity is incomplete (${operator.join(", ")}): the legal pages show gaps`);

  // the story: a date in the past closes the shop for good
  if (has("NEXT_PUBLIC_WORLD_END_AT")) {
    const end = parseEnd(v.NEXT_PUBLIC_WORLD_END_AT);
    if (end === null) add("error", "NEXT_PUBLIC_WORLD_END_AT", "is not a date with a time zone (like 2027-02-11T12:00:00+01:00): the story would silently stay off");
    else if (end <= now) add("warn", "NEXT_PUBLIC_WORLD_END_AT", "is in the past: the world is deleted and NOTHING CAN BE BOUGHT");
  }

  if (has("TEST_COUNTRY")) {
    if (key.startsWith("sk_live_")) add("error", "TEST_COUNTRY", "is set next to a LIVE Stripe key (it is ignored there, but remove it: every visitor would otherwise be taken for one from that country in test mode)");
    else add("warn", "TEST_COUNTRY", "makes every visitor 'be' in that country (a way to test the dollar price): remove it when the test is done");
  }
  if (has("ALERT_WEBHOOK_URL") && !/^https:\/\//.test(v.ALERT_WEBHOOK_URL!)) add("error", "ALERT_WEBHOOK_URL", "must be an https address: alerts would never be sent");
  return out;
}
