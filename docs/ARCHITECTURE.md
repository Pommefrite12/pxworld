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
| Départements / states / provinces | Natural Earth admin-1 | internal borders only (arcs shared by two units of one country; the country outline comes from the country layer). Coarse simplified file `admin-lo.json` for k = −3…−1, 1:10m cells beyond; thin solid line. In metropolitan France the département borders are derived from the commune data instead, so they coincide exactly with the commune lines |
| Communes (France) | Etalab communes (simplified), via `gregoiredavid/france-geojson` | 35 228 communes → topology (shared arcs) → internal borders between communes of the same département, in 250-px cell files `geo/m-{cx}-{cy}.json` (≈ 40 KB each, 33 files), drawn from zoom k ≥ 4 (≈ ×8, when a commune is ~70 px wide; `COMMUNES_FROM_K`) as fine solid lines — and the chunks are only downloaded then. Other countries: add a source in `scripts/build-world-data.mts` (`chunkCommune` is country-agnostic) |
| Place names | countries, big cities (≥ 400 000, always loaded), admin-1 names (`admin-labels.json`, shown once the unit is wide enough to hold its name), cities 15 000+ (zoom ≥ 1.1×) and towns 1 000+ (zoom ≥ 6×) | greedy collision avoidance, most important first; localised (en/fr) for countries and admin-1; zoomed in, names sit under the parcels |
| 1-px grid | procedural, **land only** | the **only** grid: 1-pixel lines, shown in the last stretch of the zoom only (fading in from ×24 to ×30, the maximum being ×48; `gridAlpha` in `src/lib/map/pixelGrid.ts`). No 10 px / 100 px lines and no dot matrix at any zoom. Clipped to the land path of the current level of detail (`landPath`/`onLand` in the engine, cached while the camera stays inside it), so oceans and seas stay clean — they are not for sale |
| Parcels, scale < 1 | `/api/map/raster/{z}/{x}/{y}?v=` | 256-px PNG tiles composited by `sharp` from parcel images, z = 0…8, **immutable per map version** (CDN) |
| Parcels, scale ≥ 1 | `/api/map/tiles/{x}/{y}?v=` (JSON, 1000×1000 px) + `/api/assets/{id}` | only tiles in view; images loaded lazily, drawn with smoothing **off** so pixels stay razor sharp |
| Hit-testing, collisions | the same JSON tiles | client-side convenience only; the database decides |
| Overlays | selection, preview of the buyer's creation, highlight | |

### Price per pixel

The unit of sale is the **pixel** (default **€0.50**, `app_settings.price_unit_cents = 50`, admin-editable; migrations 7 and 8 move the earlier factory defaults of 100 and 10 cents to 50 and leave any other price an admin chose alone). A parcel's surface is its number of pixels, and so is its price: two parcels of the same size cost the same wherever they are.

### Draw order on the map

Geography → (zoomed in) place names → **1-px grid** (land only, last zoom stretch only) → **parcels** (their drawing cut along the coast) → place names when zoomed out → overlays (selection, highlight). The grid is a guide to *free* land, so it sits under the parcels: a taken parcel shows its creation (or, while it awaits moderation, its neutral block) with no grid line across it (`tests/e2e/map-parcels.spec.ts` checks every pixel of a parcel).

### Drawing finer than a pixel (down to 0.1 px)

The grid does not change: a parcel is `w × h` **pixels**, those are what is sold, counted (`available`, `sold`) and priced (€0.50 each). What changes is how finely a creation is **drawn**: every pixel holds `k × k` dots, so the finest brush is `1/k` of a pixel — **0.1 px** when `k = 10`. The editor offers 0.1, 0.2, 0.5, 1, 2, 3, 5 and 8 px (those that are a whole number of dots at the parcel's precision).

* **Precision is capped by the size of the image**: `k` is the largest value ≤ 10 with `k² · w · h ≤ 4 000 000` dots (`creationScale()` in `src/lib/grid/constants.ts`, `px_dot_scale()` in SQL, tested to agree). A 20 × 20 or 200 × 200 parcel gets the full 10 × 10 dots per pixel; a 500 × 500 parcel (the default maximum area) gets 4 × 4 (0.25 px); a 1 000 × 1 000 one gets 2 × 2.
* A creation image is the parcel's size **times any whole scale from 1 to `k`** (`px_add_asset` and `processCreation` check it; anything else is `px_bad_dimensions`). Older creations (1× or 2×) stay valid. The asset rows keep the real image size.
* **The editor** works in dots, with a zoom (so that a tenth of a pixel is reachable) whose **1× always shows the whole parcel in the space available, whatever its size** (`src/lib/editor/zoom.ts`: the fit is measured from the width and the height, the next levels magnify from it, up to a dot of 48 screen pixels; the same on the shared drawing page), a pan tool, a flood fill on typed arrays and an undo whose memory is bounded (every snapshot is a full copy of the canvas). A very detailed picture that would exceed the upload limit (3 MB) is sent at half the precision, then half again.
* **Colours.** The text layer has **its own colour** (a block of its own in the text panel; it starts in the current stroke colour and is never changed by choosing a stroke colour, nor the other way round). The pencil can be a **multicolour brush** (`Palette.tsx`, shared by the editor and the shared canvas): switch it on, click colours to add or remove them (at most 8, never none; each shows its rank), and the stroke runs through them in order, **one brush width of each** and never less than a whole pixel (`strokeRun`, `mixColor` in `src/lib/editor/colors.ts`, unit-tested). The colour of a dot depends only on how far the stroke has travelled, so fast and slow strokes look the same; the eraser and the fill are unaffected (the fill uses the colour last picked). On the shared canvas every dot of a multicolour stroke is sent with its own colour. (`tests/e2e/editor-colours.spec.ts`, `tests/e2e/together.spec.ts`.)
* **Images are served at the size the screen needs.** `/api/assets/:id?max=N` (N in 64, 128, 256, 512, 1024, 2048) returns the creation shrunk (area-averaged, never enlarged) so that its longest side is at most N. The map engine asks for the size a parcel occupies on screen (and shows a smaller variant already in memory meanwhile), cards and thumbnails ask for theirs; the moderation queue and the editor load the original.
* The map shows dots crisply once they are magnified (≥ 1 dot per device pixel); a finer creation drawn smaller is averaged (canvas smoothing in the engine, lanczos in the server's raster tiles and OG images).
* "Draw together" works in dots too: its overlay is `k·w × k·h`, and a published snapshot is composed at that resolution (an older creation underneath is enlarged by nearest-neighbour, so nothing is invented). Migrations 10 and 11 convert overlays drawn at the previous precisions.

### Only land is for sale — coastal parcels pay for their land

Oceans and seas cannot be bought on their own, but a rectangle along a coast may include some sea (otherwise coastal land would stay unsold). Two admin settings (`app_settings`, editable in the back office) define the deal:
* `min_land_percent` (default **50**): at least this share of a parcel's pixels must be land; a parcel entirely at sea is never possible (1 ≤ value ≤ 100; 100 = no sea at all).
* `sea_price_percent` (default **0**): a sea pixel costs this % of a land pixel (0 = offered; 0–100).

Price = `land × unit + ⌊sea × unit × sea% / 100⌋` (`quote()` in `src/lib/grid/pricing.ts`, same integer arithmetic as `px_start_order`). The buyer owns the whole rectangle (the exclusion constraint still works on rectangles) but pays for the land; the buy panel and the order summary show the split ("1 486 px of your parcel are sea, offered: you only pay for the 2 114 px of land").

*Land* means: the pixel's centre is inside the Natural Earth 1:10m land polygons (even-odd) — the same data files the map draws (`public/data/geo/g-*.json`). `src/lib/geo/landmask.ts` scan-converts the polygons for just the window being asked about (no bitmap, no table of cells: a 20×20 parcel is one pass over the edges of ≤ 4 cells, a 1 000×1 000 one is still instant).
* **Server (authoritative):** `landServer.ts` counts the land pixels in `POST /api/checkout` *before* any pixel is held (→ 422 `px_not_on_land` below the minimum share) and passes the count to `px_start_order(…, p_land)`; the availability probe returns `landPixels`, `onLand` and the quote. PostgreSQL range-checks the count (1 ≤ land ≤ area, share ≥ `min_land_percent`), computes the price from `app_settings`, stores `land_px` and `sea_percent` on the order and `land_px` on the parcel, and the `orders_amount_consistent` constraint keeps the amount explainable from the row alone. The cells are cached in memory (24, LRU) and `outputFileTracingIncludes` ships the data files with the serverless functions. The land count itself is trusted from the app server (PostgreSQL has no map); `px_*` functions are not callable by browsers, so the HTTP routes are the only way in.
* **Browser (courtesy):** `Geo.landIn` gives the buy panel an instant answer (`water` state below the minimum share, red selection and dashed ghost, live price); while buying, the sea is hatched under the land tiles.
* **Counters:** `px_public_stats()` sums `coalesce(land_px, area)` — land pixels sold — against `LAND_PIXELS` (308 046 591 = 30.8 % of the grid, generated by `npm run data:world` into `src/lib/geo/landPixels.ts`): *sold / land*, *available = land − sold*. The grid itself stays 40 000 × 25 000 = 10⁹ pixels.
* **The drawing is cut along the coast.** The parcel stays a rectangle (that is what is chosen, bought and priced), but on the map only the part of its drawing that lies on land is shown: the engine clips parcels (and the editor's "Preview on the map") with the same land path as the grid, so the sea stays sea. The parcel's own page, card and share image show the whole drawing. Covered by `tests/e2e/map-parcels.spec.ts` (a coastal parcel shows its drawing on ≈ 53 % of its rectangle, the land share, and the sea elsewhere).
* Parcels bought before the rule existed have `land_px = NULL` (= all land) and are untouched.
* Lakes: only what the 1:10m land layer cuts out is water (the Caspian); ordinary lakes (Victoria, Baikal, the Great Lakes…) are land in this data. Adding Natural Earth's lakes layer would change that.

### The home page is the flat map (2D only)

Routes: `/` and `/map` are the same page (`src/app/[locale]/page.tsx` re-exports `map/page.tsx`): the flat map where pixels are bought and drawn (deep links: `?x&y&z`, `?bx&by&bw&bh`, `?p=code`, `?buy=1`). `/globe` only redirects to `/`. There is **no 3D globe**: it was removed on purpose, so zooming out stops at the whole-world floor (the world fits the screen; the map still wraps horizontally) and nothing switches to another page or renderer. No WebGL is used anywhere.

**The parcel card** (`ParcelCard`, on the map and on `/p/<code>`): share, like, **Comment**, report. (There is no "open page" button: the card is the page.) *Comment* opens the parcel's comment area (`Comments.tsx`): the first page is loaded with the card so the button can show the count; writing needs an account (otherwise a sign-in link), a comment can be deleted by its author, the parcel's owner or a moderator (the API tells each viewer whether `canRemove`), and reported by other signed-in users (`/api/reports` with `commentId`; the admin report shows the words and a *Delete the comment* button → admin action `remove_comment`). `/api/comments`: `GET ?code&before` (keyset cursor `created_at|id`, 20 per page, newest first), `POST {code, body}`, `DELETE {id}`.

**The map's left column** (explore mode): a *latest creations* tile (`LatestTile`: the 4 newest published creations of `latestCreations(4)`, public data only — with none yet it says so instead of showing made-up ones; a click flies to the parcel and opens its card, the arrow opens `/discover`; hidden on phones and on screens shorter than 640 px), then the live counter (`StatsCard`: pixels sold / land total, and the progress bar with the real share sold beside it — two significant digits below 1 %, so it never reads "0 %" once something is sold).

The 1:10m layers are **not** loaded as a whole: `public/data/geo/` holds them cut into 2 500-px cells (`g-{cx}-{cy}.json`: land, country borders, admin-1 borders; `c1-…`: cities 15 000–400 000; `c2-…`: towns 1 000–15 000 in 625-px cells), plus `index.json` listing the non-empty cells. The engine fetches a cell when a tile or label layer needs it (6 requests at a time, newest first, LRU-evicted) and draws the 1:50m level meanwhile; tiles are redrawn when the cells arrive. A cell's polygons are cut exactly at its border and their coastline is derived on the client by skipping the edges that merely lie on the border, so there are no false lines and no seams. `scripts/build-world-data.mts` produces everything (`npm run data:world`, ~10 s; needs the 40 MB Natural Earth admin-1 file, downloaded once into `.data/`).

**Why the map is cheap to move.** Borders are *solid* thin lines (dashes cost 3× more to rasterise and read as noise), made discreet by their opacity, and commune borders only exist from ×8 up. Measured in headless Chromium with software rendering, rasterising every tile of a Paris view from scratch: ×2 38 → 15 ms, ×4 65 → 17 ms, ×8 120 → 11 ms, ×16 67 → 20 ms (before → after). On top of that the engine **prepares tiles in advance**: 220 ms after the camera stops it rasterises, one tile per idle slot (`requestIdleCallback`), the ring of tiles around the view, the middle of the view one zoom step closer and the view one step further (`warmNow`, at most 60 tiles in the cache; less on phones with < 4 GB or in data-saver mode), and requests their geometry too, so a pan or a zoom step finds them ready and only blits. Any change on screen cancels the pending preparation. (`tests/e2e/map-perf.spec.ts`.)

**No blue holes while tiles are made.** At most 4 geography tiles are rasterised per frame (the ones nearest the middle of the view first); a tile that is not ready is shown from the nearest coarser tile (at most 3 levels away, each level doubling the width of its lines), else from a soft **fill-only world base** (6 tiles at level −5, pinned in memory, no lines so that nothing is stretched into a band), with any finer tiles already in memory shrunk over it. So zooming out, zooming in fast or jumping to a place never seen shows blurry land and sea for a few frames instead of the ocean colour showing through over land (`tests/e2e/map-perf.spec.ts` samples every frame of a zoom-out and of jumps: 8 of 76 frames flashed before, none now).

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

### An account is required to buy

Paying needs a signed-in account (`requireActiveViewer` in `POST /api/checkout`; an anonymous visitor who clicks *Sign in to continue* is sent to the sign-in page and brought back to the same spot). The account is what lets an owner manage their parcels afterwards: *My parcels*, editing the creation, the orders, and sharing a drawing link. Suspended accounts cannot buy.

## 3b. Drawing together

The owner of a parcel (in *My parcels → Draw together*) creates a **secret link** `/draw/<token>`. Anybody holding it — no account — paints pixels on that parcel: a streamer lets their community draw, a school class draws one picture, and so on.

* **An overlay, not the creation.** Strokes are stored in `parcel_collab_pixels` (sparse: only painted pixels) on top of the parcel's *approved* creation (white while none is approved). They never appear on the map by themselves. The owner **publishes** the result: the server composes approved creation + overlay into a PNG and submits it as a **new version** (`px_add_asset`), which waits for a moderator like any edit. So everything the map shows is still moderated, whoever held the pen.
* **Live without WebSockets.** The page sends its strokes in small batches (`POST /api/draw/:token/pixels`, ≤ 2 000 pixels) and polls `GET /api/draw/:token?since=N` every 2 s for what changed after version N (a few bytes when nothing did). Painting takes a row lock on `parcel_collab`, so versions are assigned in commit order and "everything after N" can never miss a change. Last write of a pixel wins.
* **The link is the capability** (160-bit random token). The owner can renew it (the old one dies, the drawing is kept), switch it off (the drawing is kept), reset the drawing (connected pages reload it), and publish. A parcel hidden by moderation, revoked, or whose owner is suspended stops accepting strokes at once; unknown, closed and hidden links all answer the same 404.
* **Abuse limits.** Per address: 120 paint requests and 240 reads a minute; per link: 6 000 paint requests a minute; the database refuses anything outside the parcel; owner actions are written to `audit_logs`. The page is `noindex` and sends no referrer, since the URL is a secret.

## 4. Modules

* `lib/grid` — pure geometry/pricing shared by client and server (tested exhaustively).
* `lib/db` — `pg` pool, transactions with deadlock retry. All business writes call `px_*` SQL functions.
* `lib/auth` — Supabase SSR session (production) or a signed dev cookie (development only, impossible in production).
* `lib/stripe` — checkout creation, event handling (idempotency ledger), reconciliation, auto-refund.
* `lib/collab.ts` — drawing together: state/delta reads, validated paint batches, snapshot publishing.
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
