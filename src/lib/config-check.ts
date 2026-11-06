/**
 * What is wrong with the configuration of a PRODUCTION deployment — before it costs anything. Pure (it only reads the variables it is
 * given), so that the server can log it at start-up, `scripts/check-env.mts` can run it on an environment pulled from Vercel, and the
 * tests can check it. An `error` means a feature of the live site will not work (or is unsafe); a `warn` means "look at this".
 * Nothing here ever prints a value of a secret: only the name of the variable.
 */
export interface ConfigProblem { level: "error" | "warn"; key: string; message: string }
type Vars = Record<string, string | undefined>;

const PLACEHOLDER_SALTS = new Set(["change-me", "pixel-world-dev-salt", "changeme", "secret", "salt"]);
const isLocalHost = (h: string) => /^(localhost|127\.|0\.0\.0\.0|\[::1\]|[^.]+$)/.test(h);

/** The AWS region a Supabase pooler address says (`aws-1-eu-central-1.pooler.supabase.com`) and the Vercel region next to it, when known. */
export function vercelRegionOfDatabase(url: string | undefined): { aws: string; vercel: string } | null {
  const m = /@aws-\d+-([a-z]+-[a-z]+-\d)\.pooler\.supabase\.com/.exec(url ?? "");
  if (!m) return null;
  const NEXT_TO: Record<string, string> = {
    "eu-central-1": "fra1", "eu-west-1": "dub1", "eu-west-2": "lhr1", "eu-west-3": "cdg1", "eu-north-1": "arn1",
    "us-east-1": "iad1", "us-east-2": "cle1", "us-west-1": "sfo1", "us-west-2": "pdx1",
    "ap-southeast-1": "sin1", "ap-southeast-2": "syd1", "ap-northeast-1": "hnd1", "ap-northeast-2": "icn1", "ap-south-1": "bom1", "sa-east-1": "gru1",
  };
  const vercel = NEXT_TO[m[1]!];
  return vercel ? { aws: m[1]!, vercel } : null;
}

export function configProblems(v: Vars): ConfigProblem[] {
  const out: ConfigProblem[] = [];
  const add = (level: ConfigProblem["level"], key: string, message: string) => out.push({ level, key, message });
  const has = (k: string) => Boolean(v[k] && v[k]!.trim() !== "");

  // The commonest mistakes when pasting a value into a dashboard: the name of the variable pasted with it, quotes, a stray space or line break.
  for (const k of ["NEXT_PUBLIC_SITE_URL", "DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "RATE_LIMIT_SALT", "CRON_SECRET", "ALERT_WEBHOOK_URL"]) {
    const raw = v[k];
    if (raw === undefined || raw === "") continue;
    if (raw.trim().startsWith(`${k}=`)) add("error", k, `the name of the variable is part of its value (\`${k}=…\`): paste only what comes after the "="`);
    else if (/^(["']).*\1$/s.test(raw.trim())) add("error", k, "the value is wrapped in quotation marks: paste it without them");
    else if (raw !== raw.trim()) add("error", k, "the value has a space or a line break before or after it: paste it without");
  }

  // the site's own address
  try {
    const u = new URL(v.NEXT_PUBLIC_SITE_URL ?? "");
    if (u.protocol !== "https:") add("error", "NEXT_PUBLIC_SITE_URL", "must be the public https address of the site (it feeds the share previews, the Stripe return addresses and the origin check)");
    else if (isLocalHost(u.hostname)) add("error", "NEXT_PUBLIC_SITE_URL", "still points to a local machine");
  } catch { add("error", "NEXT_PUBLIC_SITE_URL", "missing or not a URL: set the public https address of the site"); }

  // database, auth, storage
  if (!has("DATABASE_URL")) add("error", "DATABASE_URL", "missing: nothing works without the database (on Vercel use the POOLER connection string)");
  else if (!/^postgres(ql)?:\/\//.test(v.DATABASE_URL!.trim())) add("error", "DATABASE_URL", "must start with postgresql:// (copy the whole connection string)");
  else if (/\[[^\]]*\]/.test(v.DATABASE_URL!)) add("error", "DATABASE_URL", "still contains [YOUR-PASSWORD] (or another [bracketed] placeholder): replace it, brackets included, by the real database password");
  else if (v.DATABASE_SSL === "false") {
    let host = "";
    try { host = new URL(v.DATABASE_URL!).hostname; } catch { /* a malformed address fails elsewhere, loudly */ }
    if (host && !isLocalHost(host)) add("warn", "DATABASE_SSL", "SSL is switched off for a database that is not on this machine");
  }
  if (has("NEXT_PUBLIC_SUPABASE_URL")) {
    try {
      const u = new URL(v.NEXT_PUBLIC_SUPABASE_URL!.trim());
      if (u.protocol !== "https:") add("error", "NEXT_PUBLIC_SUPABASE_URL", "must start with https:// (it looks like https://<project>.supabase.co)");
      else if (!u.hostname.endsWith(".supabase.co") && !u.hostname.endsWith(".supabase.in")) add("warn", "NEXT_PUBLIC_SUPABASE_URL", "is not a *.supabase.co address: fine for a custom domain, but check it is the Project URL of your Supabase project");
    } catch { add("error", "NEXT_PUBLIC_SUPABASE_URL", "is not a valid URL: it must look like https://<project>.supabase.co (the Project URL, copied whole)"); }
  }
  if (has("NEXT_PUBLIC_SUPABASE_ANON_KEY") && /^(sb_secret_|eyJ.*service)/.test(v.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim())) add("error", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "holds a SECRET key: this one is sent to every browser. Use the publishable (anon) key here");
  if (has("SUPABASE_SERVICE_ROLE_KEY") && v.SUPABASE_SERVICE_ROLE_KEY!.trim().startsWith("sb_publishable_")) add("error", "SUPABASE_SERVICE_ROLE_KEY", "holds the PUBLISHABLE key: the server needs the secret key here (sb_secret_…)");
  if (has("DATABASE_URL") && /pooler\.supabase\.com:5432\//.test(v.DATABASE_URL!)) add("warn", "DATABASE_URL", "uses the Session pooler (port 5432): on Vercel use the Transaction pooler (port 6543), which copes with many short-lived server instances");
  // Every request of the map is a trip to the database: a function in Washington and a database in Frankfurt lose ~100 ms per trip.
  const region = vercelRegionOfDatabase(v.DATABASE_URL);
  if (region && has("VERCEL_REGION") && v.VERCEL_REGION!.trim() !== region.vercel) add("warn", "VERCEL_REGION", `the functions run in ${v.VERCEL_REGION!.trim()} but the database is in ${region.aws}, next to ${region.vercel}: set "regions": ["${region.vercel}"] in vercel.json (or Settings → Functions → Region) — every map request loses ~100 ms otherwise`);
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

  // variables of the countdown story, which the site no longer has: they do nothing, and a site that still carries them is confusing to read
  for (const k of ["NEXT_PUBLIC_WORLD_END_AT", "NEXT_PUBLIC_STORY_PREVIEW"]) if (has(k)) add("warn", k, "is no longer used (the countdown story has been removed; the opening and the closing of the edition are decided in the back office): remove it from the environment");
  if (has("TEST_COUNTRY")) {
    if (key.startsWith("sk_live_")) add("error", "TEST_COUNTRY", "is set next to a LIVE Stripe key (it is ignored there, but remove it: every visitor would otherwise be taken for one from that country in test mode)");
    else add("warn", "TEST_COUNTRY", "makes every visitor 'be' in that country (a way to test the dollar price): remove it when the test is done");
  }
  if (has("ALERT_WEBHOOK_URL") && !/^https:\/\//.test(v.ALERT_WEBHOOK_URL!)) add("error", "ALERT_WEBHOOK_URL", "must be an https address: alerts would never be sent");
  return out;
}
