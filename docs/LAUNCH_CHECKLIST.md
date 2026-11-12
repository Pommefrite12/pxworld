# Launch checklist

Items marked **(approval)** need an explicit decision from the project owner before anyone does them.

## Legal & business
- [ ] **(approval)** Terms, privacy policy and community rules reviewed and completed by legal counsel (the texts in `src/messages/*.json → pages.*` are working drafts with `[bracketed]` gaps: tax treatment, withdrawal/refund policy, minimum duration of a trace and what is promised about keeping the archive, the closing date of an edition as a term of the contract and a purchase made shortly before it, the wording "contribution / digital right to use" (without misleading a consumer about what is bought), the handling of an erasure request against a public archive and its preservation copy, liability, retention periods, governing law). The vocabulary of the whole site is the archive's (trace, edition, author — in French **empreinte**, édition, auteur: the owner's choice of November 2026, the English word is unchanged for now); the payment button and the summary stay explicit ("Pay €6.25").
- [ ] **(approval)** The "Premiers Gardiens" badges are **not mentioned anywhere public** (site, previews, newsletters, terms) until the mechanism exists AND the decisions of `docs/BADGES_PREMIERS_GARDIENS.md` §9 are taken AND a lawyer has seen the wording (symbolic badge, "first" that can be checked and contested).
- [ ] Operator identity configured (`NEXT_PUBLIC_OPERATOR_*`) — shown in the Terms/Privacy.
- [ ] Stripe account activated for the operator entity; Stripe Tax configured if applicable (`STRIPE_AUTOMATIC_TAX=true`).
- [ ] Moderation staffing plan and response time for reports (illegal content, copyright notices).

## Technical
- [ ] Supabase project (PITR on), migrations applied, bucket created, admin role granted, SMTP configured, Google OAuth configured.
- [ ] Vercel env vars set (no dev variables), cron running, domain + HTTPS, Stripe webhook pointing at production.
- [ ] **Preservation of the archive** (`BACKUP_RESTORE.md`, "The archive: export, integrity check, second copy"): the rehearsal `npm run archive:export -- --preview` and `npm run archive:verify -- --dir …` were run on the test site and the exported `index.html` was opened offline; the **real** export after the closing is verified, copied to a **second place that is not the same provider or account** (read-only if possible) and verified there; `npm run archive:verify` against the live site says `OK`; the date of the yearly restore drill is written down here: ______
- [ ] CI green: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`.
- [ ] Restore drill performed once (docs/BACKUP_RESTORE.md).
- [ ] CSP added in report-only mode, then enforced; MFA for admins; WAF rules on sign-up/checkout.
- [ ] Load test of the map endpoints behind the CDN (tiles are immutable per version).
- [ ] Review the initial prices in `/admin/settings` (default €0.25/pixel = 25 cents in the euro area, $0.25 elsewhere = `price_unit_cents_usd`, set by the owner).

## The edition (the 365 days)

- [ ] Migration 19 applied on the production database; the site is in **pre-launch** (no date, nothing for sale) — check in `/admin/edition`.
- [ ] **Migration 22 applied** (`node scripts/migrate.mjs --env .env.production.local`): the founding edition lasts **365 days** (it was 100), and the closing can be postponed up to twice that. Check in `/admin/edition`: *Duration: 365 days*. **Apply it BEFORE opening the edition**: an edition that is already open keeps the length it was opened with.
- [ ] **Migration 23 applied** (free imprints): `node scripts/migrate.mjs --env .env.production.local`. Look at `/admin/settings` (the five *free* settings: open, 60 days, cap 5 000, 24 px, 3 placements) and decide whether the free period starts open. **(approval)** The free period is a product and legal decision: the terms carry a draft section "Free traces" with `[brackets]` for the lawyer (nature of a precarious, revocable right; the mention before the placing; length and cap; no consideration). The moderation queue will receive free creations too: plan for it. Supabase must send the confirmation e-mail (a free imprint needs a **confirmed** address).
- [ ] `CRON_SECRET` is set and the maintenance job runs (it records the closing, ends the open group projects, takes the snapshot). On the Vercel free plan the job runs once a day: the **closing itself is exact** (decided by the database clock), only the recording of the snapshot may lag by up to a day (it is also recorded as soon as somebody opens `/admin/edition` or `/api/edition`).
- [ ] The **moment of the opening is decided by the owner**: sign in as an administrator, `/admin/edition`, type the name of the edition, click. The 365 days start then, to the minute. Write the closing date shown in the announcement; there is no way to bring it forward, only to postpone it (audited).
- [ ] The creations frozen after the closing and the **snapshot** (`edition_snapshots`) are the archive's reference: the export and the integrity check are step D8 of `PLAN_REFONTE_ARCHIVE.md`, to be done **before** the opening.

## Payments — go live
- [ ] **(approval)** Switch Stripe to live keys and live webhook secret; set `PAYMENTS_LIVE_ENABLED=yes-i-have-approval`.
- [ ] One real purchase + refund end to end; check invoice, tax lines, the order in `/admin/orders`, and the audit log.

## Launch assets
- [ ] Share image and copy for the home page checked on X / LinkedIn / WhatsApp debuggers (`/api/og/home`, `/api/og/parcel/<code>`).
- [ ] Check the Discover page once real creations exist (latest, biggest, most liked, most commented): the lists are computed from real data only; no fake data is ever inserted by the app.
- [ ] On the deployed site, try buying a parcel at sea (expect the red "not entirely on land" message and, via curl, `422 px_not_on_land`) and one on land: confirms `outputFileTracingIncludes` shipped `public/data/geo` to the checkout/availability functions.
