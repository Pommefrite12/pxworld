# Launch checklist

Items marked **(approval)** need an explicit decision from the project owner before anyone does them.

## Legal & business
- [ ] **(approval)** Terms, privacy policy and community rules reviewed and completed by legal counsel (the texts in `src/messages/*.json → pages.*` are working drafts with `[bracketed]` gaps: tax treatment, withdrawal/refund policy, minimum duration of a parcel, liability, retention periods, governing law).
- [ ] Operator identity configured (`NEXT_PUBLIC_OPERATOR_*`) — shown in the Terms/Privacy.
- [ ] Stripe account activated for the operator entity; Stripe Tax configured if applicable (`STRIPE_AUTOMATIC_TAX=true`).
- [ ] Moderation staffing plan and response time for reports (illegal content, copyright notices).

## Technical
- [ ] Supabase project (PITR on), migrations applied, bucket created, admin role granted, SMTP configured, Google OAuth configured.
- [ ] Vercel env vars set (no dev variables), cron running, domain + HTTPS, Stripe webhook pointing at production.
- [ ] CI green: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`.
- [ ] Restore drill performed once (docs/BACKUP_RESTORE.md).
- [ ] CSP added in report-only mode, then enforced; MFA for admins; WAF rules on sign-up/checkout.
- [ ] Load test of the map endpoints behind the CDN (tiles are immutable per version).
- [ ] Review the initial price in `/admin/settings` (default €1/pixel = 100 cents).

## Payments — go live
- [ ] **(approval)** Switch Stripe to live keys and live webhook secret; set `PAYMENTS_LIVE_ENABLED=yes-i-have-approval`.
- [ ] One real purchase + refund end to end; check invoice, tax lines, the order in `/admin/orders`, and the audit log.

## Launch assets
- [ ] Share image and copy for the home page checked on X / LinkedIn / WhatsApp debuggers (`/api/og/home`, `/api/og/parcel/<code>`).
- [ ] Seed the Discover page with genuine editorial picks from real creations (no fake data is ever inserted by the app).
