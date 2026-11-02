import "server-only";
import { isProduction, siteUrl } from "@/lib/env";
import { HttpError, errorResponse } from "./errors";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler so thrown HttpErrors / px_* errors become clean JSON responses. */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export const intParam = (v: string | null | undefined, min: number, max: number): number | null => {
  if (v == null || !/^-?\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};

/** Lower-case host without a default port, first entry of a proxy chain ("a.example, b.internal" → "a.example"). */
const normHost = (h: string | null | undefined): string | null => (h?.split(",")[0]?.trim().toLowerCase().replace(/:(80|443)$/, "")) || null;

export interface OriginContext {
  /** `Host` and `X-Forwarded-Host` of the request. */
  host?: string | null;
  forwardedHost?: string | null;
  /** NEXT_PUBLIC_SITE_URL: the site's own public address. */
  siteUrl: string;
  /** Set only when running inside a GitHub Codespace (development): its forwarded addresses are ours too. */
  codespace?: { name: string; domain: string } | null;
}

/**
 * Is this `Origin` one of the site's own addresses? Yes if it is the host the request arrived on (as seen by the proxy
 * that forwarded it, or directly), the configured public URL, or — in a development Codespace only — one of that
 * Codespace's forwarded ports (`<name>-3000.app.github.dev`), which a browser sees but the dev server may not.
 * A page of another website never matches, which is what the check is for.
 */
export function isAllowedOrigin(origin: string, ctx: OriginContext): boolean {
  let originHost: string | null;
  try {
    originHost = normHost(new URL(origin).host); // "null" (sandboxed/opaque origins) and garbage throw → not allowed
  } catch { return false; }
  if (!originHost) return false;
  const own = new Set<string>();
  for (const h of [ctx.forwardedHost, ctx.host]) { const n = normHost(h); if (n) own.add(n); }
  try { const n = normHost(new URL(ctx.siteUrl).host); if (n) own.add(n); } catch { /* ignore a malformed site URL */ }
  if (own.has(originHost)) return true;
  if (ctx.codespace) {
    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${esc(ctx.codespace.name.toLowerCase())}-\\d{2,5}\\.${esc(ctx.codespace.domain.toLowerCase())}$`).test(originHost);
  }
  return false;
}

/** Same-origin check for state-changing requests authenticated by cookies (CSRF defence in depth). */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients / same-origin GET-like navigations
  const ctx: OriginContext = {
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    siteUrl: siteUrl(),
    codespace: !isProduction() && process.env.CODESPACE_NAME ? { name: process.env.CODESPACE_NAME, domain: process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev" } : null,
  };
  if (!isAllowedOrigin(origin, ctx)) {
    if (!isProduction()) console.warn(`bad_origin: Origin ${origin} is not this site (Host ${ctx.host}, X-Forwarded-Host ${ctx.forwardedHost}, NEXT_PUBLIC_SITE_URL ${ctx.siteUrl})`);
    throw new HttpError(403, "bad_origin");
  }
}
