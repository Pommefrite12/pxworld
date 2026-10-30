# Pixel World — *One planet. One billion pixels. Your mark.*

A collaborative world map made of **exactly 1 000 000 000 virtual pixels** (40 000 × 25 000). Anyone can claim a
rectangle of the planet (from 100 pixels, €1 per pixel to start), draw or upload a creation on it, and share a permanent
link to its place on the map. Inspired by The Million Dollar Homepage, built for the web of 2026: a real world map,
fluid zoom down to the single pixel, accounts, moderation, secure Stripe payments, and a back office.

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
| `npm run data:world` | rebuild the projected map data (land, borders, départements, cities) in `public/data` from Natural Earth / GeoNames |
| `npm run data:clear -- --yes` | wipe parcels/orders/payments of a **local** development database (refuses anything else) |

## The key decisions (details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md))

* **Grid:** 40 000 × 25 000 = 10⁹ exactly. 10⁹ = 2⁹·5⁹, so a 2:1 grid is impossible; 8:5 is the closest to a world map. It is
  drawn with the **Web Mercator** projection (57°S → 82°N, square pixels of ≈ 1 km at the equator), so countries keep their
  familiar shape. Zoom reveals more detail: borders, départements/states, then cities and towns.
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
docs/                     architecture, database, payments, security, deployment, backup, launch checklist
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

Map data: Natural Earth (public domain; land, countries, départements/states/provinces), GeoNames (CC BY 4.0 — attribution shown in the app and at `/credits`).
Fonts: SIL OFL. Add your own project licence before publishing.
