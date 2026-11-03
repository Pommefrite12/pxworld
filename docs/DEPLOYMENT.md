# Deployment (Vercel + Supabase + Stripe)

Everything below uses **test credentials first**. Nothing here activates real payments.

## 1. Supabase

1. Create a project (choose a region close to your Vercel region).
2. **Database**: `supabase link --project-ref <ref>` then `supabase db push` (applies `supabase/migrations/*`), *or* paste the
   migration files (`supabase/migrations/`, oldest first) in the SQL editor in order.
3. **Storage**: run `supabase/storage.sql` once (creates the private `pixel-world-creations` bucket, no public policies).
4. **Auth** → URL configuration: Site URL = your production URL; add `https://<domain>/auth/callback` to redirect URLs.
   Providers → Google: add OAuth client id/secret (Google Cloud Console → OAuth consent + credentials; authorised redirect URI shown by Supabase).
   Policies: minimum password length 10; enable email confirmations; configure SMTP for production-grade emails.
5. **Grant yourself the admin role** (SQL editor; the only way to create staff — by design):
   ```sql
   insert into public.admin_roles (user_id, role) select id, 'admin' from auth.users where email = 'you@example.com';
   ```
6. Connection string: Project settings → Database → **pooler** (transaction mode, port 6543) → `DATABASE_URL`.
   Keep `DATABASE_SSL` unset (SSL is on by default for non-local hosts).

## 2. Stripe (test mode)

See [`PAYMENTS.md`](PAYMENTS.md): API key, payment methods, webhook endpoint + secret.

## 3. Vercel

1. Import the repository. Framework: Next.js (auto). Node 22.
2. Environment variables (Production *and* Preview): everything in `.env.example` **except** the development block
   (`DEV_AUTH`, `NEXT_PUBLIC_DEV_AUTH`, `DEV_AUTH_SECRET`, `STRIPE_MOCK`, `LOCAL_STORAGE_DIR`). Required:
   `NEXT_PUBLIC_SITE_URL`, `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` (test), `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`, `RATE_LIMIT_SALT`
   (long random), and the `NEXT_PUBLIC_OPERATOR_*` legal identity variables.
3. **Cron**: `vercel.json` schedules `/api/cron/maintenance` every 5 minutes (Vercel sends `Authorization: Bearer $CRON_SECRET`).
   Sub-daily schedules need a Pro plan; on Hobby change the schedule to daily — correctness never depends on it
   (reservations are released lazily at purchase time) but late-payment recovery and refund retries do.
4. Domain, then update the Stripe webhook URL and the Supabase redirect URLs to the final domain.
5. Smoke test: sign up → buy a small parcel with a Stripe test card → see the order *Paid* → approve it in `/admin/moderation`
   → check `/p/<code>` renders its social preview (`/api/og/parcel/<code>`).

## 3b. Before, and right after, the first deployment

1. **Check the environment** (names only, never values): `vercel env pull .env.production.local --environment=production`, then
   `npx tsx scripts/check-env.mts .env.production.local`. Fix every `ERROR`; read every `warn`. (The server runs the same check at
   start-up and logs it as `[config] …`.)
2. **Prove the build** on your machine: `npm run build && npm start`, then `node scripts/smoke.mjs http://localhost:3000` (every page and
   map endpoint, the share images with their font, the security headers, the doors that must be shut: dev sign-in, mock payment,
   admin API, webhook, cron). The same script runs against the deployed address: `node scripts/smoke.mjs https://<domain>`.
3. **Measure**: `node scripts/loadtest.mjs https://<domain>` (read-only endpoints, no write; a few seconds each). Figures from a production
   build on a small container, no CDN: the map endpoints serve 350–540 requests per second per instance (p95 under 170 ms), the home page
   and the share image about 80 (they are rendered; the share image is cached for a day by the CDN).
4. **Alerts**: create an "incoming webhook" in Slack/Discord (or an ntfy topic), set `ALERT_WEBHOOK_URL`, and check that it reaches you:
   `ALERT_WEBHOOK_URL=https://… npx tsx scripts/test-alert.mts`.
5. **Supabase Auth**: enable MFA for the admin accounts (Authentication → Multi-factor) and require a confirmed e-mail.
6. **Vercel Firewall**: add rate/bot rules in front of `/auth/*` and `/api/checkout` (the application's own limits are a second line).
7. **Read the `[csp]` log lines** for a week, signed-in pages included, before enforcing the policy.

## 4. Local development against real services (optional)

Fill `.env.local` with the Supabase and Stripe **test** values and remove `DEV_AUTH`/`STRIPE_MOCK`. Use `stripe listen` for webhooks.

## 5. Operations

* Health: `/api/stats` (200 + JSON when the DB is up). Admin dashboard shows queues (moderation, reports, refunds due).
* Logs: Vercel function logs; business audit in `/admin/audit`.
* Price/limits/sales switch: `/admin/settings` (admin role).
* Backups: [`BACKUP_RESTORE.md`](BACKUP_RESTORE.md).
