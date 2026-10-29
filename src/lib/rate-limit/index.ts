import "server-only";
import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { queryOne } from "@/lib/db/pool";
import { HttpError } from "@/lib/http/errors";

export function clientIp(req: Request): string {
  // Vercel sets x-vercel-forwarded-for / x-real-ip itself; a client-supplied x-forwarded-for is the last resort
  const platform = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip");
  const fwd = req.headers.get("x-forwarded-for");
  return (platform ?? fwd?.split(",")[0] ?? "unknown").trim();
}

/** Salted hash: lets us rate-limit and keep report evidence without storing raw IP addresses. */
export function ipHash(req: Request): string {
  return createHash("sha256").update(`${env().RATE_LIMIT_SALT}:${clientIp(req)}`).digest("hex").slice(0, 32);
}

export interface Limit {
  name: string;
  windowSeconds: number;
  max: number;
}

/** Fixed-window limiter in PostgreSQL (shared by every serverless instance). Throws 429 when exceeded. */
export async function enforceRateLimit(req: Request, limit: Limit, userId?: string | null): Promise<void> {
  const buckets = [`${limit.name}:ip:${ipHash(req)}`];
  if (userId) buckets.push(`${limit.name}:user:${userId}`);
  for (const bucket of buckets) {
    const row = await queryOne<{ ok: boolean }>("select public.px_rate_limit($1, $2, $3) as ok", [bucket, limit.windowSeconds, limit.max]);
    if (!row?.ok) throw new HttpError(429, "rate_limited");
  }
}

export const LIMITS = {
  checkout: { name: "checkout", windowSeconds: 3600, max: 20 },
  upload: { name: "upload", windowSeconds: 3600, max: 30 },
  report: { name: "report", windowSeconds: 3600, max: 10 },
  like: { name: "like", windowSeconds: 600, max: 60 },
  availability: { name: "availability", windowSeconds: 60, max: 120 },
  auth: { name: "auth", windowSeconds: 600, max: 30 },
  profile: { name: "profile", windowSeconds: 3600, max: 30 },
} satisfies Record<string, Limit>;
