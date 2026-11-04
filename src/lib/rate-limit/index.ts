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

/** One bucket of the fixed-window limiter. Throws 429 when exceeded. */
export async function enforceKeyLimit(bucket: string, limit: Limit): Promise<void> {
  const row = await queryOne<{ ok: boolean }>("select public.px_rate_limit($1, $2, $3) as ok", [bucket, limit.windowSeconds, limit.max]);
  if (!row?.ok) throw new HttpError(429, "rate_limited");
}

/** Fixed-window limiter in PostgreSQL (shared by every serverless instance). Throws 429 when exceeded. */
export async function enforceRateLimit(req: Request, limit: Limit, userId?: string | null): Promise<void> {
  await enforceKeyLimit(`${limit.name}:ip:${ipHash(req)}`, limit);
  if (userId) await enforceKeyLimit(`${limit.name}:user:${userId}`, limit);
}

export const LIMITS = {
  checkout: { name: "checkout", windowSeconds: 3600, max: 20 },
  /** Sending a project to moderation (a campaign): failed attempts count too; the abuse is bounded by "one active project per creator". */
  campaign: { name: "campaign", windowSeconds: 3600, max: 20 },
  upload: { name: "upload", windowSeconds: 3600, max: 30 },
  report: { name: "report", windowSeconds: 3600, max: 10 },
  like: { name: "like", windowSeconds: 600, max: 60 },
  availability: { name: "availability", windowSeconds: 60, max: 120 },
  /** Comments under a parcel: reading is public (per address), writing needs an account and is slow on purpose. */
  commentRead: { name: "comment-read", windowSeconds: 60, max: 180 },
  comment: { name: "comment", windowSeconds: 600, max: 10 },
  auth: { name: "auth", windowSeconds: 600, max: 30 },
  /** Reports of what the (report-only) Content-Security-Policy would have blocked: a page can send a handful per view. */
  cspReport: { name: "csp-report", windowSeconds: 60, max: 60 },
  profile: { name: "profile", windowSeconds: 3600, max: 30 },
  /** Drawing together (public links): per address, and per link so one popular link cannot swamp the database. */
  drawRead: { name: "draw-read", windowSeconds: 60, max: 240 },
  drawWrite: { name: "draw-write", windowSeconds: 60, max: 120 },
  drawWriteLink: { name: "draw-write-link", windowSeconds: 60, max: 6000 },
} satisfies Record<string, Limit>;
