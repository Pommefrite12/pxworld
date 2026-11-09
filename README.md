# Pixel World — *Every era leaves a trace. Here is ours.*

*In 100 years, what will remain of us?* Humanity has always looked for a way to leave a trace of its passage — cave paintings, hieroglyphs, manuscripts, photographs — and every era found its own. Pixel World is a **worldwide collective archive of our time**, drawn on a map made of **exactly 1 000 000 000 virtual pixels** (40 000 × 25 000). Anyone can leave a trace:
choose a rectangle of the planet (from 25 pixels; one-time payment of €0.25 per pixel in the euro area, $0.25 elsewhere, so €6.25 for the smallest),
put a creation on it (an image, a drawing, a text) with a title, a category and, if wanted, the place it is about, and share its page. The archive is
organised in **editions**: the founding edition lasts 100 days, is opened and closed by an administrator and enforced by the database; when it closes, its
creations are frozen and stay explorable. A parcel can be shared with a secret link so that a community (a stream, a class, friends) draws on it
together, moderated before it reaches the map. Inspired by The Million Dollar Homepage, built for the web of 2026: a real world map with fluid zoom
down to the single pixel, accounts, moderation, secure Stripe payments, and a back office.

> **Status:** production-grade first version, developed against Stripe **test mode**. Nothing in this repository starts
> real payments: live keys are refused by the code until you explicitly opt in (see [`docs/PAYMENTS.md`](docs/PAYMENTS.md)
> and [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md)).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · PostgreSQL / Supabase (Auth, Storage, RLS) ·
Stripe Checkout + webhooks · `next-intl` (English, French; add a language by adding one JSON file) · `sharp` for image
validation and tiles · Vitest · Playwright · deployable on Vercel.

## Try it without installing anything: GitHub Codespaces

On GitHub, open the repository → **Code** → **Codespaces** → **Create codespace on branch `claude/funny-bell-k7v5xf`**
(free accounts get monthly hours). A virtual machine with Node 22 and PostgreSQL is built from `.devcontainer/`, the tables
are created and the site starts by itself; open the **PORTS** tab and click the globe next to port 3000. Sign-in is the
development form and Stripe is simulated, exactly like the local setup below.

## Quick start on your computer (no external account needed)

```bash
npm install
npm run db:setup          # local PostgreSQL 16 (no Docker) + all migrations   → needs the postgres binaries
cp .env.example .env.local   # already configured for local development: dev sign-in + mocked Stripe
npm run dev               # http://localhost:3000
```

In this local mode sign-in needs only an email (a clearly-labelled development form that cannot exist in production) and
payments are simulated through the *same* handler that processes real Stripe webhooks. Use an email starting with
`admin` (e.g. `admin@example.test`) to get the admin role.

**After a `git pull`** just restart the site (`npm run dev`): it first brings a local database up to date (`scripts/dev-migrate.mjs`, local databases only; a remote one is never touched).

To run against real services, fill the variables documented in [`.env.example`](.env.example):
Supabase (Auth + Storage), Stripe **test** keys, and `CRON_SECRET`. Step-by-step: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | unit + **database** tests (real PostgreSQL: overlap protection, concurrency, expiry, RLS, Stripe webhooks, raster tiles, 200 000-parcel scale test) |
| `npm run test:e2e` | Playwright: full buy → pay → moderate → publish journey, moderation, uploads, permissions |
| `npm run lint` / `typecheck` | ESLint, `tsc --noEmit` |
| `npm run db:setup` / `db:reset` | local PostgreSQL + migrations |
| `npm run archive:export -- --env <file> [--preview] [--zip]` / `archive:verify -- --dir <folder>` | export the archive of the closed edition as a folder readable without our software (page, pictures, JSON, CSV, checksums), and check its integrity (or the live site's); see `docs/BACKUP_RESTORE.md` |
| `npm run data:world` | rebuild the projected map data (land, borders, départements, cities) in `public/data` from Natural Earth / GeoNames |
| `npm run data:clear -- --yes` | wipe parcels/orders/payments of a **local** development database (refuses anything else) |

## The key decisions (details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md))

* **Grid:** 40 000 × 25 000 = 10⁹ exactly. 10⁹ = 2⁹·5⁹, so a 2:1 grid is impossible; 8:5 is the closest to a world map. It is
  drawn with the **Web Mercator** projection (56.7°S → 83.8°N, ≈ 1 km per pixel at the equator), so countries keep their
  familiar shape and none is cut (the map's edge is in the Bering Strait). Zoom reveals more detail: borders,
  départements/states, commune boundaries (France), then cities and towns. The map wraps around horizontally. The home page presents the archive (planisphere, three gestures, the state of the edition); the flat map (2D only, no globe), where pixels are bought and drawn, is at `/map`, and the old `/?x=…` links still open it.
* **Land and water are for sale**, as two categories (the whole 10⁹-pixel planet): a land parcel owns the land pixels of its rectangle, a water parcel its water pixels; the rest is cut away (free or discounted, admin settings), and a land and a water parcel may share a rectangle. A creation on water is shown in three tints of blue. The server counts the land; the counters count every pixel owned.
* **Editions (the 100 days):** the database alone decides whether anything can be bought (`editions`, state computed from its own clock: pre-launch → open → closed). Nothing starts by itself: an administrator opens the founding edition in `/admin/edition`. At the closing, purchases stop, creations are frozen and a snapshot (with a hash) is taken. See `docs/ARCHITECTURE.md` §3f.
* **A trace, not just a parcel:** each creation carries a category (a closed list), the place it is about (text and optional country, never coordinates) and its archiving date; it has a public page (`/archive/<code>`) that can be read and shared without the map. See §3g.
* **Look:** a night theme for the public side (violet night, gold, cyan, ivory; the oceans stay blue) and a light one for the back office, both made of the same CSS variables (`docs/DESIGN.md`).
* **Nothing scales with a billion.** Only purchased rectangles exist (rows in PostgreSQL). The map renders from a static
  vector layer + server-composited raster tiles when zoomed out + per-viewport JSON tiles and the parcels' own PNGs when
  zoomed in. A custom Canvas 2D engine (≈ 700 lines) gives pixel-exact zoom, touch support and 60 fps.
* **No overlap, ever:** a PostgreSQL **GiST exclusion constraint** on the parcel rectangle, plus tile-level advisory locks
  and transactional functions. Tested with 300 concurrent buyers racing for overlapping rectangles.
* **Payments:** prices computed in the database; reservation (35 min) → Stripe Checkout → **only a verified webhook**
  attributes a parcel; idempotent events; automatic refund when pixels can't be attributed; reconciliation job for lost
  webhooks; refunds/disputes handled.
* **Safety:** RLS on every table, roles in a separate table, server-side validation of image *content*, SVG refused,
  rate limiting, append-only audit log, evidence snapshots for reports.

## Repository map

```
src/app/[locale]/…        pages (map, discover, parcel permalink, account, admin, legal)
src/app/api/…             route handlers (map tiles, checkout, webhook, admin actions, uploads, cron)
src/components/map        the map engine (engine.ts) and its HUD
src/components/editor     parcel editor (upload, crop, draw, text)
src/lib/grid              grid constants, geometry, pricing (pure, shared by client and server)
src/lib/stripe            checkout, webhook processing, reconciliation
src/messages              en.json, fr.json
supabase/migrations       schema, business functions, RLS, admin extras
tests/{unit,db,e2e}       test suites
docs/                     architecture, design system, database, payments, security, deployment, backup, launch checklist, the refonte plan (`PLAN_REFONTE_ARCHIVE.md`), the badges design study (`BADGES_PREMIERS_GARDIENS.md`)
```

## What is verified, and what needs your credentials

Verified automatically here (see the test suites): the grid and pricing maths; overlap protection and reservation
concurrency on a real PostgreSQL; expiry and recovery; payment attribution, idempotency, refunds and disputes through the
real webhook route with correctly signed events; RLS permissions; image/URL validation; raster and metadata tiles; the full
browser journey (buy → pay → moderate → publish → share), admin actions, accessibility (axe), keyboard and touch use.

**Not verifiable without your accounts** (written against the official SDKs and typechecked, but never run against the live
services in this environment): Supabase Auth flows (email confirmation, Google OAuth, password reset), the Supabase Storage
driver, the Stripe-hosted Checkout page and real Stripe event delivery, Vercel deployment and cron. The first test-mode
smoke test in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) covers them in about ten minutes.

## Licence & data

Map data: Natural Earth (public domain; land, countries, départements/states/provinces), Etalab commune boundaries (Licence Ouverte 2.0), GeoNames (CC BY 4.0 — attribution shown in the app and at `/credits`).
Fonts: SIL OFL. Add your own project licence before publishing.
