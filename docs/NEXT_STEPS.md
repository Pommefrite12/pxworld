# Next steps (in priority order)

Written at the end of a working day, to start the next one from. Items marked **(owner)** need a decision or an action from the
project owner; **(approval)** ones must never be done without an explicit yes (real money, real users, legal texts). The longer
launch checklist is `LAUNCH_CHECKLIST.md`; this list is what to do *first*.

## 0. The "100 days to save the world" story (art direction Glitch chosen)

Done: the countdown and the interface that goes with it, **off until `NEXT_PUBLIC_WORLD_END_AT` is set**; look at it with `?preview=J-9`, `J-87`, `J-3`, `0`.
Also done: **the corrupted land on the map** (it follows the countdown: nothing destroyed at J-87, about half of the land at J-9, all of it at the end) and **survivor beacons** (acquired parcels stay intact, framed, and are marked from afar).
Also done: **the final sequence** at zero (flash, shake, a sweep from west to east that corrupts the land, then the end state for good) and the **"Replay the destruction"** button; try `?preview=T-8` to watch the countdown end live and `?preview=0` for the end state.
Next, in this order: (1) a chromatic fringe (cyan/magenta) along the coasts of the destroyed land; (2) the share image with the new look (and a way to share the end state); (3) a real-device pass on a phone (the sequence draws a few hundred bands of pixels per frame).
Needs the owner: the date and time zone of the end (**owner**), whether buying stays open in destroyed zones after zero (proposed: yes, shown as "restored"), and a read of the English and French wording.

## 1. Look at what changed today (owner, ~20 min, before anything else)

A lot went in on one day. Pull the branch, restart (`npm run dev`: the comments migration 13 applies by itself) and go through:

- Map: no globe any more (home = the map); zoom in and out quickly — no blue flashes; the grid only shows at the very last zoom stretch (×24–×48); communes only from ×8.
- Counter card: the % sold next to the bar; the "Latest creations" tile (needs at least one published creation; empty message otherwise).
- Parcel card: "Comment" button (sign in, write, delete, report from a second account); no "Open page" button.
- Editor and shared drawing page: text colour independent of the stroke colour; multicolour brush (is that what "plusieurs couleurs" meant?).
- Logo: "pixel" in the pixel font; favicon in the browser tab (hard-refresh: tabs cache icons).

Anything that is not as you wanted goes to the top of the list.

## 2. Decisions that block the launch (owner)

1. **Currency and price**: the price is €0.50 per pixel in euros — confirm it is euros (the "$" was ambiguous) and the final price.
2. **Operator identity**: the legal entity that sells the pixels (name, address, registration number) → `NEXT_PUBLIC_OPERATOR_*`.
3. **Legal texts** (terms, privacy, community rules, refund/withdrawal policy, VAT treatment): the texts in `src/messages/*.json → pages.*` are drafts with `[bracketed]` gaps. They need a lawyer. **(approval)**
4. **Moderation**: who reviews creations and reports, and how fast (a new creation or a report waits for a human).
5. **Domain name** and the e-mail address the site sends from.

## 3. Prove the production build (me, first thing tomorrow, ~30 min)

Everything so far was tested against the dev server. Before deploying anything: `npm run build` and `npm start` locally with production
settings, the whole test suite, then fix whatever only a production build shows (route exports, file tracing of `public/data/geo`
for the checkout/availability functions, image/font assets).

## 4. Deploy in TEST mode (me with you, ~half a day)

1. Supabase project (PITR on), migrations 1–13, storage bucket, admin role, SMTP, Google OAuth.
2. Vercel project, environment variables (no dev variables), domain + HTTPS, cron.
3. Stripe in **test mode** only, webhook pointing at the deployed site; one full purchase with a test card end to end on the real site.
4. On the deployed site: a parcel at sea is refused (`422 px_not_on_land`), one on land is accepted.
5. CI on GitHub (lint, typecheck, unit/db tests, build, e2e).

## 5. Harden before real users

- Content-Security-Policy in report-only mode, then enforced; MFA for admins; WAF/rate rules on sign-up and checkout.
- Error monitoring and alerts (payments webhook failures above all); restore drill from a backup (`BACKUP_RESTORE.md`).
- Load test of the map endpoints behind the CDN; try the map on a real mid-range phone (my timings come from a headless browser without a GPU).
- Comments: an admin view of recent comments, and a notification to the parcel's owner (today they only see them on the card).

## 6. Launch assets

- Share image: the wordmark of `/api/og/home` is still plain sans text — bundle the pixel font file into the function.
- Check the share previews on X, LinkedIn, WhatsApp; seed Discover with real editorial picks (the app never inserts fake data).
- French review of the new wording (comments, palette, tile) by a native reader.

## 7. Going live **(approval)**

Only with an explicit yes: live Stripe keys and webhook secret, `PAYMENTS_LIVE_ENABLED=yes-i-have-approval`, then one real purchase and
refund end to end (invoice, tax lines, `/admin/orders`, audit log).

## Later (not blocking)

- Commune borders for countries other than France; a mobile version of the "Latest creations" tile.
- Tunable thresholds if the feel is not right: grid from ×24 (`GRID_FROM_SCALE`), communes from ×8 (`COMMUNES_FROM_K`), the warm-up of tiles (`warmNow`).
