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

export const siteUrl = () => env().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
