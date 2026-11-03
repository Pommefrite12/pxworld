/**
 * The Content-Security-Policy of the site, sent in REPORT-ONLY mode first: the browser tells `/api/csp-report` what the policy
 * would have blocked, nothing is blocked, and the policy is tightened (then enforced) once the reports are clean.
 * Pure (no environment access), so that `next.config.ts` can use it and the tests can check it.
 *
 * What the site loads, and so what it allows: its own scripts, styles, fonts, images and data (the pixel font and the map data are
 * self-hosted); images may also be `data:`/`blob:` (the editor and the map draw into canvases); API calls go to the site itself and,
 * when Supabase is configured, to its project (auth). Nothing is embedded in a frame, and the site cannot be framed. Stripe and
 * Google sign-in are reached by a full-page navigation, which a CSP does not restrict.
 *
 * Inline scripts and styles are allowed for now: Next.js writes small inline scripts, and enforcing without them needs a nonce
 * per request (a step for the day the policy is enforced). Everything else is already strict, and no `unsafe-eval`.
 */
export interface CspOptions {
  /** The Supabase project URL (`NEXT_PUBLIC_SUPABASE_URL`), when auth/storage run on Supabase. */
  supabaseUrl?: string | null;
  /** Where the browser sends its reports. */
  reportUri: string;
}

/** `https://abc.supabase.co` → `["https://abc.supabase.co", "wss://abc.supabase.co"]`; anything that is not an https URL → `[]`. */
export function supabaseOrigins(url: string | null | undefined): string[] {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" ? [u.origin, `wss://${u.host}`] : [];
  } catch {
    return [];
  }
}

export function contentSecurityPolicy(opts: CspOptions): string {
  const [http, ws] = supabaseOrigins(opts.supabaseUrl);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...(http ? [http] : [])]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(http ? [http, ws!] : [])]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["report-uri", [opts.reportUri]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export interface CspViolation {
  documentUri: string;
  violatedDirective: string;
  blockedUri: string;
  sourceFile: string;
  line: number | null;
}

const clip = (v: unknown, n = 200): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, n) : "");

/**
 * Reads what a browser sends: the classic `{ "csp-report": { … } }` (`application/csp-report`) or the Reporting API's list
 * (`application/reports+json`). Returns the violations, cleaned and clipped (a report is untrusted input that ends up in the logs).
 */
export function parseCspReports(body: unknown): CspViolation[] {
  const items: unknown[] = Array.isArray(body) ? body : [body];
  const out: CspViolation[] = [];
  for (const it of items.slice(0, 10)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const r = (o["csp-report"] ?? (o.type === "csp-violation" ? o.body : null)) as Record<string, unknown> | null;
    if (!r || typeof r !== "object") continue;
    out.push({
      documentUri: clip(r["document-uri"] ?? r.documentURL),
      violatedDirective: clip(r["violated-directive"] ?? r.effectiveDirective ?? r["effective-directive"], 80),
      blockedUri: clip(r["blocked-uri"] ?? r.blockedURL),
      sourceFile: clip(r["source-file"] ?? r.sourceFile),
      line: Number.isFinite(Number(r["line-number"] ?? r.lineNumber)) ? Number(r["line-number"] ?? r.lineNumber) : null,
    });
  }
  return out;
}
