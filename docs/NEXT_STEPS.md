# Next steps (in priority order)

Written at the end of a working day, to start the next one from. Items marked **(owner)** need a decision or an action from the
project owner; **(approval)** ones must never be done without an explicit yes (real money, real users, legal texts). The longer
launch checklist is `LAUNCH_CHECKLIST.md`; this list is what to do *first*.

## 0. The "100 days to save the world" story (art direction Glitch chosen)

Done: the countdown and the interface that goes with it, **off until `NEXT_PUBLIC_WORLD_END_AT` is set**; look at it with `?preview=J-9`, `J-87`, `J-3`, `0`.
Also done: **the corrupted land on the map** (it follows the countdown: nothing destroyed at J-87, about half of the land at J-9, all of it at the end) (acquired parcels stay intact, with **no** frame and **no** marker — removed at the owner's request).
Also done: **a short comic strip** ("Read the story" button under the countdown: six pictures, the hooded figure, ending on "Save the world. And the pizza with it.") and **a computer bug of the destroyed land every 30 seconds** (about a second; the magenta zones change place, six places in rotation, unless the machine struggles; none for visitors who asked for fewer animations); the small multicoloured squares on the destroyed land were removed.
Also done: **the final sequence** at zero (a flash, a hard shake, then a slow 12-second sweep from west to east that corrupts the land and **erases every name** — countries, regions, cities — then the end state for good, without names) and the **"Replay the destruction"** button; try `?preview=T-8` to watch the countdown end live and `?preview=0` for the end state.
Also done: **a chromatic fringe (cyan/magenta) along the coasts of the destroyed land**, a plain progress bar in the counter card, a smaller countdown, and no "D-87" next to the logo any more. Also done: **the share image follows the story** (ordinary, countdown with the real days left, the end with the real number of survivors; pixel font) and a **"Share" button** after the end. Next: a real-device pass on a phone (the sequence draws a few hundred bands of pixels per frame).
For the test site: `NEXT_PUBLIC_STORY_PREVIEW=J-40` shows the story to every visitor without any real date (the shop never closes); remove it for the real launch. Needs the owner: the date and time zone of the end (**owner**), whether the names should come back at close zoom in the end state so that people can still find where to buy (today: none at all), and a read of the English and French wording.

Also for the test site: **demonstration data** (`npm run demo:seed` / `demo:status` / `demo:clear`, step 9 of `DEPLOIEMENT_PAS_A_PAS.md`): 50 marked accounts, one generated picture-parcel each, no order and no payment, refuses anything but a confirmed test site; **`demo:clear` is a launch blocker** (the public counters would show made-up numbers).

Also done: **the oceans and seas can be bought** (water parcels: same customisation, shown in three blues, cut by the coast; the counter is the whole planet; **the destruction touches the seas too**). To decide: the price of water (today the same as land, `water_price_percent`), the first words of the water terms (legal, drafts).

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
1. A **Supabase** project (region near your Vercel one): I give you the migrations 1–15 and `storage.sql` to run, you tell me when it is done.
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
- Comments: an admin view of recent comments, and a notification to the parcel's owner (today they only see them on the card).

## 6. Launch assets

- Share image: check, on the deployed site, that `/api/og/home` has its font (`outputFileTracingIncludes` is set; try `?preview=0`), and what the platforms' debuggers show for the countdown and the end.
- Check the share previews on X, LinkedIn, WhatsApp; seed Discover with real editorial picks (the app never inserts fake data).
- French review of the new wording (comments, palette, tile) by a native reader.

## 7. Going live **(approval)**

Only with an explicit yes: live Stripe keys and webhook secret, `PAYMENTS_LIVE_ENABLED=yes-i-have-approval`, then one real purchase and
refund end to end (invoice, tax lines, `/admin/orders`, audit log).

## Later (not blocking)

- Commune borders for countries other than France; a mobile version of the "Latest creations" tile.
- Tunable thresholds if the feel is not right: grid from ×24 (`GRID_FROM_SCALE`), communes from ×8 (`COMMUNES_FROM_K`), the warm-up of tiles (`warmNow`).
