import "server-only";
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

/** Same-origin check for state-changing requests authenticated by cookies (CSRF defence in depth). */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients / same-origin GET-like navigations
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host; // "null" (sandboxed/opaque origins) and garbage throw → rejected below
  } catch { /* rejected below */ }
  if (!host || originHost !== host) throw new HttpError(403, "bad_origin");
}
