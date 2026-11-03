import { parseCspReports } from "@/lib/security/csp";
import { LIMITS, enforceRateLimit } from "@/lib/rate-limit";
import { route } from "@/lib/http/route";

/**
 * Where browsers report what the (report-only) Content-Security-Policy would have blocked. Nothing is stored: each violation is one
 * line in the server log (`[csp]`), to be read before the policy is enforced. Public, so: small bodies only, rate limited, answers 204.
 */
export const POST = route(async (req) => {
  await enforceRateLimit(req, LIMITS.cspReport);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 8 * 1024) return new Response(null, { status: 413 });
  const text = await req.text();
  if (text.length > 8 * 1024) return new Response(null, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  for (const v of parseCspReports(body)) {
    console.warn(`[csp] ${v.violatedDirective} blocked ${v.blockedUri || "(inline)"} on ${v.documentUri}${v.sourceFile ? ` (${v.sourceFile}${v.line ? `:${v.line}` : ""})` : ""}`);
  }
  return new Response(null, { status: 204 });
});
