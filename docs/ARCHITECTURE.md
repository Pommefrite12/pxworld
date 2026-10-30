# Architecture

## 1. The billion pixels

| | |
|---|---|
| Grid | **40 000 × 25 000 = 1 000 000 000** cells (`src/lib/grid/constants.ts`, mirrored by CHECK constraints in SQL) |
| Why not 2:1 | 10⁹ = 2⁹·5⁹, so width/height = 2ᵃ·5ᵇ with *a, b odd*: 8:5 (40 000 × 25 000) or 5:2 (50 000 × 20 000) are the closest to a world map; 8:5 is used |
| Projection | **Web Mercator** (`src/lib/grid/projection.ts`): x linear in longitude, y = `(M(latMax) − M(φ))·Ry` with `M(φ) = asinh(tan φ)`. Conformal: countries keep their familiar shape at every latitude (an equirectangular map looks stretched near the poles). `Ry` fits the latitude band exactly into the 25 000 rows, ≈ 5 % below the horizontal scale `R = W/2π` (a Mercator 5 % flatter than a pure one, invisible). One pixel ≈ 1 002 m wide at the equator, ×cos(latitude) elsewhere |
| Coverage | lat **56.7°S → 83.8°N**: all of Greenland (83.67°N) and Chile's Diego Ramírez islands (56.5°S) fit; only Antarctica is cropped. Longitude **168.5°W → 191.5°E**: the map's edge lies in the Bering Strait, the one meridian that slices no country (only the Aleutian island of Umnak straddles it): Russia is whole at the east edge, Alaska starts at the west edge. **The world wraps horizontally** in the engine: the scene is drawn once per visible copy of the world (`offX = c·W`, used by `worldToScreen`/`visibleWorld`), the camera's x is taken modulo W, `screenToWorld` maps any point of a copy back to its real grid position (so hit-testing, selection and purchases are unaffected), and `flyTo` takes the short way round. On a window wider than the planet the continuation shows at the sides; the world is never closed by a frame on the left or right. Rings that straddle the map's own edge are emitted on both sides by the build script; polygons that the source data cut along the antimeridian (Chukotka, Fiji…) now meet in the middle of the map and their shared edge is never stroked (`outlineWithoutClipEdges(…, seamX)`) |
| Parcel | integer rectangle `(x, y, w, h)`, area ≥ 100, sides ≤ 1000, area ≤ 250 000 by default (admin setting; hard cap 1 000 000) |

The grid is **virtual**. Nothing ever materialises one object per pixel: only purchased rectangles are rows.

## 2. Rendering engine (why a custom Canvas 2D renderer)

The map is a flat 40 000 × 25 000 pixel plane (Mercator-projected geography on top of an integer grid). MapLibre/Leaflet are built
around tile pyramids of that same projection but would need bolt-on code for pixel-exact images and a grid of exactly 10⁹ cells; OpenSeadragon needs a pre-rendered deep-zoom pyramid of
the *whole* planet. A purpose-built engine (`src/components/map/engine.ts`) gives one coordinate system for geography, parcels
and overlays, nearest-neighbour pixel-exact zoom, touch/pinch/inertia, and no tile infrastructure.

Layers, by zoom (`scale` = screen px per grid px, 0.029 … 48):

| Layer | Source | Notes |
|---|---|---|
| Ocean, land, country borders | static vector data (`public/data`, Natural Earth) | rasterised **once per tile** into 512-px offscreen canvases, clipped per tile (Sutherland–Hodgman / Liang–Barsky) so a frame is a few `drawImage` calls. **Three levels of detail** picked from the zoom `k = ⌈log₂(scale·dpr)⌉`: 1:110m (k ≤ −2), 1:50m (k = −1), 1:10m (k ≥ 0) |
| Départements / states / provinces | Natural Earth admin-1 | internal borders only (arcs shared by two units of one country; the country outline comes from the country layer). Coarse simplified file `admin-lo.json` for k = −3…−1, 1:10m cells beyond; dotted line style. In metropolitan France the département borders are derived from the commune data instead, so they coincide exactly with the commune lines |
| Communes (France) | Etalab communes (simplified), via `gregoiredavid/france-geojson` | 35 228 communes → topology (shared arcs) → internal borders between communes of the same département, in 250-px cell files `geo/m-{cx}-{cy}.json` (≈ 40 KB each, 33 files), drawn from zoom k ≥ 2 (≈ 2×) as fine dotted lines. Other countries: add a source in `scripts/build-world-data.mts` (`chunkCommune` is country-agnostic) |
| Place names | countries, big cities (≥ 400 000, always loaded), admin-1 names (`admin-labels.json`, shown once the unit is wide enough to hold its name), cities 15 000+ (zoom ≥ 1.1×) and towns 1 000+ (zoom ≥ 6×) | greedy collision avoidance, most important first; localised (en/fr) for countries and admin-1; zoomed in, names sit under the parcels |
| Pixel field → grid | procedural | dot matrix at world scale, 10-px grid from 0.8×, 1-px grid fading in from 3× to 10× |
| Parcels, scale < 1 | `/api/map/raster/{z}/{x}/{y}?v=` | 256-px PNG tiles composited by `sharp` from parcel images, z = 0…8, **immutable per map version** (CDN) |
| Parcels, scale ≥ 1 | `/api/map/tiles/{x}/{y}?v=` (JSON, 1000×1000 px) + `/api/assets/{id}` | only tiles in view; images loaded lazily, drawn with smoothing **off** so pixels stay razor sharp |
| Hit-testing, collisions | the same JSON tiles | client-side convenience only; the database decides |
| Overlays | selection, preview of the buyer's creation, highlight | |

The 1:10m layers are **not** loaded as a whole: `public/data/geo/` holds them cut into 2 500-px cells (`g-{cx}-{cy}.json`: land, country borders, admin-1 borders; `c1-…`: cities 15 000–400 000; `c2-…`: towns 1 000–15 000 in 625-px cells), plus `index.json` listing the non-empty cells. The engine fetches a cell when a tile or label layer needs it (6 requests at a time, newest first, LRU-evicted) and draws the 1:50m level meanwhile; tiles are redrawn when the cells arrive. A cell's polygons are cut exactly at its border and their coastline is derived on the client by skipping the edges that merely lie on the border, so there are no false lines and no seams. `scripts/build-world-data.mts` produces everything (`npm run data:world`, ~10 s; needs the 40 MB Natural Earth admin-1 file, downloaded once into `.data/`).

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
