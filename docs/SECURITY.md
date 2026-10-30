# Security model

| Area | Measures |
|---|---|
| **Integrity of the map** | exclusion constraint, CHECKs, advisory locks, transactional functions (see DATABASE.md); server is the only authority |
| **Authentication** | Supabase Auth (email+password ≥ 10 chars, Google, reset). Server code always re-verifies the JWT with `auth.getUser()`; sessions refreshed in `src/proxy.ts` |
| **Authorisation** | roles in `admin_roles` (never a client-editable flag), re-read from the DB on every admin request, **and** re-checked inside every staff SQL function; admin pages and `/api/admin/action` both enforce it; suspended users are blocked in SQL |
| **RLS** | enabled everywhere, grants revoked then re-granted per column; tested (`permissions.test.ts`) |
| **Payments** | server-priced, verified webhooks (raw-body signature), idempotency ledger, amount/currency verification, live keys refused by default |
| **Uploads** | size cap, **content sniffing** (names/MIME ignored), SVG & executables refused, decompression-bomb limit, animation refused, dimensions must match the parcel exactly, decoded and **re-encoded to a canonical PNG** (metadata/trailing payloads dropped), served with `nosniff` + `CSP: sandbox`, private storage bucket |
| **Output encoding** | React escapes everything; user text is plain text (control/bidi characters stripped); no `dangerouslySetInnerHTML` |
| **External links** | https only, no credentials/IP literals/localhost/odd ports, ≤ 500 chars; shown with their domain, `rel="noopener noreferrer nofollow ugc"` (+`sponsored` for ads) |
| **CSRF** | cookie-authenticated mutations check `Origin` against the host (`assertSameOrigin`); cookies are `SameSite=Lax` |
| **Rate limiting** | PostgreSQL fixed windows, per IP-hash and per user: checkout, uploads, reports, likes, availability probes, profile edits; anti-hoarding cap on unpaid reservations |
| **Privacy** | IPs are only stored as salted hashes (set `RATE_LIMIT_SALT`); no tracking cookies |
| **Audit** | append-only `audit_logs` + `moderation_actions` (triggers forbid UPDATE/DELETE); every staff action and payment event is journalised atomically with its effect |
| **Reports / evidence** | snapshot (asset version, SHA-256, texts, link, owner) taken at report time; rejected/removed files are kept in storage |
| **HTTP** | HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; `poweredByHeader` off |
| **Secrets** | only in server env; service-role key and Stripe secrets never reach the client; `.env*` ignored by git |
| **Dev-only features** | dev sign-in and mock Stripe are impossible when `NODE_ENV=production` or when real Supabase/Stripe credentials are configured |

## Recommended before launch

* Add a `Content-Security-Policy` (report-only first) once your final third-party origins are known (Stripe redirects away; Google OAuth redirects away).
* Enable MFA for admin accounts in Supabase Auth and restrict the admin routes by IP if possible.
* Put a WAF/bot protection (Vercel Firewall) in front of sign-up and `/api/checkout`.
* Optional: automated image moderation (e.g. a vendor API) in front of the human queue.
* Account deletion (GDPR erasure) is an operator procedure for now: anonymise the profile (`deleted_at`, random username) — parcels intentionally use `ON DELETE RESTRICT`.
