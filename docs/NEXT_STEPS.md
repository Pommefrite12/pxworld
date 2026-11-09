# Next steps (in priority order)

Written at the end of a working day, to start the next one from. Items marked **(owner)** need a decision or an action from the
project owner; **(approval)** ones must never be done without an explicit yes (real money, real users, legal texts). The longer
launch checklist is `LAUNCH_CHECKLIST.md`; this list is what to do *first*.

## 00. The edition (the 100 days) — done in the database, to open by hand **(owner)**

Migration 19 puts the 100 days in the database (`docs/ARCHITECTURE.md` §3f). A site is in **pre-launch** (nothing for sale, no date) until an administrator opens the edition in `/admin/edition` (type its name, click). On the test site, after applying the migration: open it, then try "close the sales now" to see the closing. `NEXT_PUBLIC_WORLD_END_AT` no longer sells or refuses anything (it only drives the old countdown's look, which the redesign removes: `PLAN_REFONTE_ARCHIVE.md`, steps D5–D6).

## 00000. The story of the eras — done (November 2026) **(owner: look at the home page and tell me what to change)**

The home page now opens on the slogan "Every era leaves a trace. Here is ours." with the hook "In 100 years, what will remain of us?", then a timeline: cave wall → hieroglyphs → illuminated manuscripts → photography → Pixel World, with the owner's four pictures (`public/eras/`) and the site's own planisphere. The 100 days read as "the time left to take part in the founding edition". Open points that are the owner's call: the wording of the era titles and of the last sentence (`home.eras.*` in `src/messages/*.json`; the sentences under the first four stations were removed at the owner's request), the order and size of the pictures, whether the timeline should come before the hero's buttons or after, and whether the legal text should say anything about the story.

## 0000. "Premiers Gardiens" badges — studied, **not built** (`docs/BADGES_PREMIERS_GARDIENS.md`) **(owner: the 12 decisions of §9)**

A design study only: no table, no migration, no screen, no public text (the site does not mention badges). A badge is symbolic, awarded **by a human moderator** to the author of the first *validated* trace on a subject the moderators name, per edition; never automatic; nothing public before the decision; one active holder per subject guaranteed by the database. The round gold-on-violet medallion exists as three SVG files in `docs/img/`. To build it later: five phases (§11), after the owner's decisions and a lawyer's look at the wording.

## 000. Preserving the archive — done (migration 21, step 9c of `DEPLOIEMENT_PAS_A_PAS.md`) **(owner: run the rehearsal on the test site)**

`npm run archive:export -- --env .env.production.local --preview --zip` makes a rehearsal of the export (a folder readable without our software + a ZIP), `npm run archive:verify -- --dir …` checks it, and after the closing the same two commands without `--preview` make and check the real archive; `npm run archive:verify -- --env …` checks the live site's pictures against the closing snapshot. **Before the real launch:** the real export, copied to a second place (another provider), and the yearly drill (`BACKUP_RESTORE.md`). Needs the owner: where the second copy lives, and what is promised about keeping the archive (the wording is for a lawyer).

## 0. The old "100 days to save the world" story: removed (step D6)

The countdown, the corrupted land, the bug every 30 seconds, the final sequence, the picture book and the share image that followed them are **gone** from the site, with their texts, styles, pictures and the variables `NEXT_PUBLIC_WORLD_END_AT` / `NEXT_PUBLIC_STORY_PREVIEW` (git keeps the old code). If either variable is still set in Vercel, remove it (step 8 of `DEPLOIEMENT_PAS_A_PAS.md`; until then the site only logs a warning). The share image of the site is now a single one in the night palette (`/api/og/home?lang=en|fr`).

Also for the test site: **demonstration data** (`npm run demo:seed` / `demo:status` / `demo:clear`, step 9 of `DEPLOIEMENT_PAS_A_PAS.md`): 50 marked accounts, one generated picture-parcel each, no order and no payment, refuses anything but a confirmed test site; **`demo:clear` is a launch blocker** (the public counters would show made-up numbers).

Also done: **the oceans and seas can be bought** (water parcels: same customisation, shown in three blues, cut by the coast; the counter is the whole planet; **the destruction touches the seas too**). To decide: the price of water (today the same as land, `water_price_percent`), the first words of the water terms (legal, drafts).

Also done: **"Fund it together", step 1** (group projects; plan and decisions in `PLAN_FINANCEMENT_COLLECTIF.md`): the creator designs a big parcel and sends it to moderation, a moderator approves (the zone is held for 7/14/30 days) or refuses with a reason, the creator can withdraw. **Steps 2 and 3 are built too**: public pages `/projects`, contributions (simulated payments), the parcel bought at the goal, automatic refunds. **A ranking by likes is there too** (`/ranking`: creations and creators, all time / month / week; the owner's own like and suspended accounts' likes do not count). **Step 4 is built too**: the projects that are collecting are on the map (hatched zone with its progress, a pin when far away, a click opens a card), with the drawing kept cheap (measured with a 6× slower CPU; still worth a look on the real slow PC with `?hud` some day). Left: the real Stripe test. Needs **migrations 17 and 18** on the test site (`node scripts/migrate.mjs --env .env.production.local`) before the button is used.

## 1. Look at what changed today (owner, ~20 min, before anything else)

A lot went in on one day. Pull the branch, restart (`npm run dev`: the comments migration 13 applies by itself) and go through:

- Map: no globe any more (home = the map); zoom in and out quickly — no blue flashes; the grid only shows at the very last zoom stretch (×24–×48); communes only from ×8.
- Counter card: the % sold next to the bar; the "Latest creations" tile (needs at least one published creation; empty message otherwise).
- Parcel card: "Comment" button (sign in, write, delete, report from a second account); no "Open page" button.
- Editor and shared drawing page: text colour independent of the stroke colour; multicolour brush (is that what "plusieurs couleurs" meant?).
- Logo: "pixel" in the pixel font; favicon in the browser tab (hard-refresh: tabs cache icons).

Anything that is not as you wanted goes to the top of the list.

## 2. Decisions that block the launch (owner)

1. **Price**: decided — euros in the euro area, dollars elsewhere. dollar price **now $0.25** (owner's decision; was $0.50) (`price_unit_cents_usd`, editable in `/admin/settings`); the euro-using micro-states pay in euros (confirmed). Only the final launch prices remain to be re-read.
2. **Operator identity**: the legal entity that sells the pixels (name, address, registration number) → `NEXT_PUBLIC_OPERATOR_*`.
3. **Legal texts** (terms, privacy, community rules, refund/withdrawal policy, VAT treatment): the texts in `src/messages/*.json → pages.*` are drafts with `[bracketed]` gaps. They need a lawyer. **(approval)**
4. **Moderation**: who reviews creations and reports, and how fast (a new creation or a report waits for a human).
5. **Domain name** and the e-mail address the site sends from.

## 3. Prove the production build — DONE

`npm run build` and `npm start` work; `node scripts/smoke.mjs` passes 50 checks on the production build (pages, map endpoints, share images with their font, headers, doors that must be shut); `node scripts/loadtest.mjs` shows no error (map endpoints 350–540 requests/s per instance, p95 < 170 ms; the home page and the share image ~80/s). Real-browser check of the Content-Security-Policy (report-only): no violation on the public pages. Also done in code: the CSP + its report endpoint, `[alert]` lines and an optional alert webhook (`ALERT_WEBHOOK_URL`) for payment failures and server errors, a production configuration check (`scripts/check-env.mts`, logged at start-up). CI (`.github/workflows/ci.yml`) already runs lint, types, unit/db tests, the production build and the e2e tests.

## 4. Deploy in TEST mode (me with you, ~half a day) — **needs your accounts; I never invent keys**

What I need from you, in this order (each one is yours to create; paste nothing secret in the chat — set them in the dashboards, I will tell you where):
1. A **Supabase** project (region near your Vercel one): I give you the migrations 1–17 and `storage.sql` to run, you tell me when it is done.
2. A **Vercel** project linked to this repository (branch `claude/funny-bell-k7v5xf` or `main`), with the environment variables of `.env.example` (production block only). `scripts/check-env.mts` tells you what is missing.
3. A **Stripe account in test mode**: the test secret key, and the webhook endpoint pointing at `https://<domain>/api/stripe/webhook` with its signing secret.
4. Then, together: one full purchase with a test card (in euros, then — with a VPN or by asking Stripe's test mode — in dollars), a parcel at sea refused (`422 px_not_on_land`), one on land accepted, `node scripts/smoke.mjs https://<domain>`.
5. CI on GitHub is already in place (`ci.yml`); enable branch protection once it is green.

## 5. Harden before real users

Done in code: Content-Security-Policy (report-only) with a collection point, `[alert]` lines + optional webhook, configuration check.
Left, because each needs the deployed site or a dashboard:
- Read the `[csp]` reports for a week (signed-in pages included), then enforce the policy with a nonce (`docs/SECURITY.md`).
- MFA for admins (Supabase Auth setting); Vercel Firewall rules on sign-up and checkout.
- A restore drill from a backup (`BACKUP_RESTORE.md`) and the alert webhook tested for real.
- Load test **against the deployed site behind its CDN** (`scripts/loadtest.mjs <url>`); try the map on a real mid-range phone (my timings come from a headless browser without a GPU).
- Comments: **done** — an admin view of the latest comments (`/admin/comments`, removal with a reason) and a "Recent news" card on the account page (new comments on one's parcels this week; the decisions on one's group projects, 14 days). Time-based, nothing to mark as read. There is still **no e-mail** sent by the site itself (a sender account and a domain are needed first).

## 6. Launch assets

- Share image: check, on the deployed site, that `/api/og/home` has its font (`outputFileTracingIncludes` is set; open `/api/og/home?lang=fr`), and what the platforms' debuggers show for the home page.
- Check the share previews on X, LinkedIn, WhatsApp; look at Discover once real creations and comments exist (its lists are computed from real data; the app never inserts fake data; the editorial selection and the top contributors were removed).
- French review of the new wording (comments, palette, tile) by a native reader.

## 7. Going live **(approval)**

Only with an explicit yes: live Stripe keys and webhook secret, `PAYMENTS_LIVE_ENABLED=yes-i-have-approval`, then one real purchase and
refund end to end (invoice, tax lines, `/admin/orders`, audit log).

## Later (not blocking)

- Commune borders for countries other than France; a mobile version of the "Latest creations" tile.
- Tunable thresholds if the feel is not right: grid from ×24 (`GRID_FROM_SCALE`), communes from ×8 (`COMMUNES_FROM_K`), the warm-up of tiles (`warmNow`).
