# Architecture

## 1. The billion pixels

| | |
|---|---|
| Grid | **50 000 × 20 000 = 1 000 000 000** cells (`src/lib/grid/constants.ts`, mirrored by CHECK constraints in SQL) |
| Why not 2:1 | 10⁹ = 2⁹·5⁹, so width/height = 2ᵃ·5ᵇ with *a, b odd*: 8:5 (40 000 × 25 000) or 5:2 (50 000 × 20 000) are the closest to a world map |
| Projection | equirectangular, lon −180…180, lat 84°N…60°S. 360°/50 000 = 144°/20 000 = **0.0072°** → square pixels of ≈ 800 m at the equator |
| Coverage | all inhabited land (Greenland's tip 83.6°N, Cape Horn 56°S); only Antarctica's interior and polar ocean are cropped |
| Parcel | integer rectangle `(x, y, w, h)`, area ≥ 100, sides ≤ 1000, area ≤ 250 000 by default (admin setting; hard cap 1 000 000) |

The grid is **virtual**. Nothing ever materialises one object per pixel: only purchased rectangles are rows.

## 2. Rendering engine (why a custom Canvas 2D renderer)

The map is a flat 50 000 × 20 000 pixel plane, not a geodesic surface. MapLibre/Leaflet are built around Web Mercator tiles
and would need a custom CRS plus bolt-on code for pixel-exact images; OpenSeadragon needs a pre-rendered deep-zoom pyramid of
the *whole* planet. A purpose-built engine (`src/components/map/engine.ts`) gives one coordinate system for geography, parcels
and overlays, nearest-neighbour pixel-exact zoom, touch/pinch/inertia, and no tile infrastructure.

Layers, by zoom (`scale` = screen px per grid px, 0.029 … 48):

| Layer | Source | Notes |
|---|---|---|
| Ocean, land, borders | static vector data (`public/data/*.json`, Natural Earth) | rasterised **once per tile** into 512-px offscreen canvases, clipped per tile (Sutherland–Hodgman / Liang–Barsky) so a frame is a few `drawImage` calls; 2 levels of detail |
| Pixel field → grid | procedural | dot matrix at world scale, 10-px grid from 0.8×, 1-px grid fading in from 3× to 10× |
| Parcels, scale < 1 | `/api/map/raster/{z}/{x}/{y}?v=` | 256-px PNG tiles composited by `sharp` from parcel images, z = 0…8, **immutable per map version** (CDN) |
| Parcels, scale ≥ 1 | `/api/map/tiles/{x}/{y}?v=` (JSON, 1000×1000 px) + `/api/assets/{id}` | only tiles in view; images loaded lazily, drawn with smoothing **off** so pixels stay razor sharp |
| Hit-testing, collisions | the same JSON tiles | client-side convenience only; the database decides |
| Overlays | selection, preview of the buyer's creation, highlight | |

Frame cost measured in headless Chromium with *software* rendering (no GPU): ≈ 0.4–2 ms per frame at world and deep zoom, ≈ 9 ms at mid zoom (many large tile blits); real GPU-accelerated browsers are considerably faster. `tests/e2e/ui.spec.ts` guards against regressions.

**Cache invalidation:** `map_state.version` is bumped (once per statement) whenever the visible map changes. Clients learn it
from `/api/stats` (15 s cache) and put it in every tile URL, so tiles are `immutable` and never stale.

**Scale-out path:** raster tiles are rendered on demand and cached by the CDN. If very large volumes make cold tiles slow, move
`renderRasterTile` to a background worker writing to storage (each level is derivable from the level below) — the URL scheme
and the client do not change.

## 3. Data flow of a purchase

```
browser                       Next.js (server)                         PostgreSQL                 Stripe
  │ place + design (local)         │                                       │                        │
  │── GET /api/availability ──────▶│ px_is_area_free (read-only)           │                        │
  │── POST /api/checkout ─────────▶│ validate image (content!)             │                        │
  │                                │── px_start_order ────────────────────▶│ tile locks, exclusion  │
  │                                │   reserved parcel + priced order      │ constraint, hold 35min │
  │                                │── checkout.sessions.create ──────────────────────────────────▶│
  │◀── redirect to Stripe ─────────│                                       │                        │
  │                                                                        │          pay           │
  │                                │◀── POST /api/stripe/webhook (signed) ─────────────────────────│
  │                                │── px_fulfill_order (idempotent) ─────▶│ parcel → active        │
  │── /checkout/success (polls) ──▶│ order status (informative only)       │                        │
  │                                      moderator approves ─▶ px_review_asset ─▶ creation public    │
```

The browser's return from Stripe is **never** proof of payment. The only paths that attribute a parcel are the verified
webhook and the server-side reconciliation (which asks Stripe's API).

## 4. Modules

* `lib/grid` — pure geometry/pricing shared by client and server (tested exhaustively).
* `lib/db` — `pg` pool, transactions with deadlock retry. All business writes call `px_*` SQL functions.
* `lib/auth` — Supabase SSR session (production) or a signed dev cookie (development only, impossible in production).
* `lib/stripe` — checkout creation, event handling (idempotency ledger), reconciliation, auto-refund.
* `lib/images` — content sniffing, decompression-bomb guard, canonical PNG re-encode, average colour, hash.
* `lib/storage` — private object store: Supabase Storage in production, local files in development.
* `lib/rate-limit` — PostgreSQL fixed-window counters shared by all serverless instances.
* `lib/data` — read models (tiles, stats with cache + tag invalidation, parcels, discovery, admin).

## 5. Internationalisation

All user-facing text lives in `src/messages/<locale>.json`; a unit test enforces identical keys and placeholders between
languages. English is the default (served at `/`), French at `/fr`. To add a language: create `src/messages/xx.json`, add
`"xx"` to `src/i18n/routing.ts`. Prices and numbers use `Intl` for the active locale; country names use `Intl.DisplayNames`.

## 6. Public statistics

`px_public_stats()` computes sold pixels, parcels, owners and published creations from real rows (reservations are *not*
counted as sales). The result is cached 15 s (`unstable_cache`, tag `stats`) and invalidated after every payment/admin
action. If the database is unreachable the UI says so rather than showing a number.

## 7. Known limits / next steps

* Raster tiles are generated on demand (see scale-out path above).
* Sitemap is capped at 45 000 parcels per file; switch to `generateSitemaps()` beyond that.
* Email notifications (purchase confirmation, moderation outcome) rely on Stripe receipts / Supabase Auth emails for now.
* Parcel transfer/resale is deliberately out of scope for v1.
