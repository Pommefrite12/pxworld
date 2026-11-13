import "server-only";
import { z } from "zod";

/**
 * Server-side configuration. Everything is optional at import time so the app can boot (and be developed)
 * without external services; features that need a missing variable report a clear error when used.
 * See .env.example for the documented list.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(["true", "false"]).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_PUBLIC_BUCKET: z.string().default("pixel-world-creations"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_AUTOMATIC_TAX: z.enum(["true", "false"]).default("false"),
  STRIPE_INVOICE_CREATION: z.enum(["true", "false"]).default("true"),
  /** Development only: simulate Stripe locally (no network, no real payment). Ignored in production. */
  STRIPE_MOCK: z.enum(["true", "false"]).default("false"),

  /** Development only: sign in without Supabase Auth. Ignored in production. */
  DEV_AUTH: z.enum(["true", "false"]).default("false"),
  DEV_AUTH_SECRET: z.string().default("dev-only-secret-change-me"),

  /**
   * Automatic translation of what visitors write (title and description of a parcel), by Claude, on the first view of the parcel and kept in the
   * database. Off until a key is given; `TRANSLATE_USER_CONTENT=false` switches it off again. See `lib/i18n/autotranslate.ts`.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  TRANSLATE_USER_CONTENT: z.enum(["true", "false"]).default("true"),
  TRANSLATE_MODEL: z.string().default("claude-opus-5-5"),
  /** At most this many parcels are translated per rolling day (a ceiling on the bill, whatever the traffic). */
  TRANSLATE_DAILY_LIMIT: z.coerce.number().int().min(0).default(2000),
  /** How long a visitor may wait, once per parcel, for its translation. */
  TRANSLATE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),

  CRON_SECRET: z.string().optional(),
  RATE_LIMIT_SALT: z.string().default("pixel-world-dev-salt"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;
export function env(): ServerEnv {
  if (!cached) {
    // `KEY=` in a .env file yields "": treat empty values as unset
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";

export const supabaseConfigured = () =>
  Boolean(env().NEXT_PUBLIC_SUPABASE_URL && env().NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** Dev auth can never be enabled in production, nor next to a real Supabase project. */
export const devAuthEnabled = () => !isProduction() && env().DEV_AUTH === "true" && !supabaseConfigured();

/** Mock Stripe can never be enabled in production, nor with a real Stripe key. */
export const stripeMockEnabled = () => !isProduction() && env().STRIPE_MOCK === "true" && !env().STRIPE_SECRET_KEY;

/** Automatic translation is on when a key is set and it has not been switched off. */
export const autoTranslateEnabled = () => env().TRANSLATE_USER_CONTENT === "true" && Boolean(env().ANTHROPIC_API_KEY);

export const siteUrl = () => env().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
