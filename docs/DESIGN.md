# Design system

**The archive of our time: a night of violet, a thread of gold, a light of cyan** — and the same stair-step pixel buttons the site has always had.
The public side of the site is **night** (`<html data-theme="night">`); the back office (`/admin`) is a work tool and stays **light**
(`data-theme="light"` on its layout). Everything lives in `src/app/globals.css`: tokens in `@theme`, the themes right after it, components in
`@layer components`. In development, **`/dev/design`** shows every button family in its three states next to the palette (404 in production).

## Themes (how a page changes colour)

A theme is a **set of CSS variables**. Components never name a colour: they use the semantic tokens (`bg-paper`, `text-ink`, `border-line`,
`text-signal`, `bg-sky`, `text-cobalt`…) and the variables of the buttons and surfaces (`--btn-face`, `--primary-face`, `--surface`…). So one
attribute re-skins a whole page, and a part that must keep another theme (the back office, inside the night `<html>`) just sets its own
`data-theme` — the variables are re-declared there. To add or adjust a colour, change it in the theme blocks (`:root`, `[data-theme="light"]`,
`:root[data-theme="night"]`), never in a component. Rules: **text colour on an accent is the colour of the page** (`text-paper`), never `white`;
the "ok" green has its own variable (`--color-mint-ink`) because the light and the night greens are not the same.

## Palette — night (public side)

| Token | Value | Use |
|---|---|---|
| `paper` | `#190921` | the page: violet night (dominant) |
| `paper-2`, `--surface` | `#21102f` | panels, cards, chips |
| `--surface-soft` | `#2b1640` | raised surfaces, hover |
| `line` | `#4a3069` | borders (decorative: 1.4:1, never carries text) |
| `ink` | `#f1e8df` | main text: ivory (15.7:1 on `paper`) |
| `ink-soft` / `ink-faint` | `#cdc1c8` / `#b8abc3` | secondary text (≥ 7:1 / ≥ 6:1 on every surface) |
| `signal` | `#d6ab72` | soft gold: time and heritage — figures, the days left, the price, the world of the logo (9:1) |
| `cobalt` | `#55c7d1` | cyan: interaction — links, focus ring, the main button, the active parcel (9.5:1) |
| `sky` / `sky-2` / `sky-line` | `#2d1a47` / `#3d2459` / `#6b4a95` | hover / pressed / their outline (violet tints) |
| `mint`, `danger`, `warn` | `#5fdcb0`, `#ff8a80`, `#f0b94f` | confirmation, error, warning — readable on the night |
| **the map** | ocean `#0d1a3e`, land `#382050`, coasts and borders gold, names ivory with a night halo | **the oceans stay BLUE** (owner's decision), the land is violet |

## Palette — light (the back office)

The previous palette, unchanged: `paper #fcf9f2`, `ink #1f2540`, `signal #f04316` (orange), `sky #e6f2ff`, `cobalt #2457c5`, `line #e6dccb`.

## The home page

`components/home/Home.tsx`: a hero (the night planisphere under a veil, `.hero-veil`, a few `.spark`s), the eyebrow style `.eyebrow` (small, spaced, gold), cards `.px-card` (with `.px-card-gold` and `.px-card-glass` variants), the big day counter `.clock-n` (pixel font, gold) and the 50-segment bar `.seg-bar` (`data-tone="off"` before the opening, `"dim"` after the closing). The four icons of the three gestures are drawn on a pixel grid (`PixelIcon`). One gold word per title at most (`text-signal`): the rest is ivory. Everything uses the theme variables, so nothing here is specific to the night theme.

## Pixel details

* **Stair-step corners** (two steps of 2 px, `--s`) instead of rounded ones. A button is two stacked layers (`::before` = outline, `::after` = face) clipped with the same stepped polygon; the element itself is not clipped, so the focus ring and the shadow stay clean.
* **Relief**: a 1 px highlight along the top of the face and a darker ledge under it (`--ledge`, 3 px).
* **8-bit shadow** `0 2px 0 rgb(31 37 64 / .12)` as a `drop-shadow`, which follows the stepped outline.
* **States**: hover goes light (sky, or a brighter orange for the CTA, with a soft glow); pressed goes deeper and sinks 2 px; `aria-pressed` / `aria-checked` use the pressed sky; focus is a 3 px ring with a 3 px offset; disabled is 50 % opacity.

## Components

| Class | What | Example |
|---|---|---|
| `btn btn-primary` | main call to action: **cyan** by night (orange by day) | *Laisser ma trace* |
| `btn btn-secondary` | support action: violet by night (cream by day) | *Connexion* |
| `btn btn-ghost` | discreet action (the surface colour) | *Explorer*, most secondary buttons |
| `btn btn-ink` | strong neutral: violet by night (navy by day) | *Enregistrer*, *Importer une image* |
| `btn btn-nav` | navigation pill (finer steps) | *Découvrir ›* |
| `btn-icon` (with a variant) | square icon button | close, zoom, search |
| `btn-sm` | smaller | toolbars |
| `badge-px` | small floating label on the map | coordinates, credits |
| `card`, `field`, `chip`, `label` | surfaces, inputs, tags (notched details, soft 8-bit shadow, clear focus) | |

States can be forced for documentation with the helper classes `is-hover` and `is-active`.

## Accessibility

The orange CTA is a gradient from `#ea4211` to `#d63a10` with bold white text and a subtle dark text-shadow (about 4.3–4.6:1 across the face; the pure brand `#f04316` is kept for large figures and accents, where 3.8:1 is enough). Every interactive state is also readable without colour (sinking, outline, ring). Covered by the axe checks in `tests/e2e/ui.spec.ts`.

## Logo and icons

* **Logo** (`src/components/ui/Logo.tsx`): the 12 × 12 pixel globe (**cyan sea, gold land** by night, blue and orange by day: `--logo-sea`, `--logo-land`) and the wordmark — **"pixel" in the site's pixel font** (Jersey 10, one weight, no letter-spacing, 1.3 em so that its x-height matches the display font next to it) and **"world" in the display font** (Bricolage Grotesque 800, orange). The word "world" is in the gold of the theme.
* **Icons** are the globe alone (a wordmark is unreadable at 16 px): `src/app/icon.svg` (transparent corners, reads on light and dark tabs), `icon.png` (512), `favicon.ico` (16, 32, 48) and `apple-icon.png` (180, on the night violet `#190921` because iOS paints transparency black). Next.js links them from every page by file convention. They are generated by `node scripts/build-icons.mjs` from the same grid as the logo and committed. (`tests/e2e/brand.spec.ts`.) They are drawn in the night palette (cyan sea `#55c7d1`, gold land `#d6ab72`).
* The share image (`/api/og/home`) is set in the pixel font (the file is carried into the serverless function by `outputFileTracingIncludes`) and is a single picture in the night palette (see `ARCHITECTURE.md`).

## The header on a phone
One row: logo, call to action, language, account. It must fit from **320 px** up, in both languages (`tests/e2e/mobile.spec.ts` measures it at 320, 360, 390 and 412 px: nothing outside the screen, no sideways scrolling, the header does not overflow itself). Below 440 px the wordmark gives way to the pixel globe (the link keeps its accessible name), and below 640 px "Sign in" becomes a person icon (its words stay for screen readers and come back from 640 px); the buttons are a little tighter. The French call to action ("Trouvez votre place", 150 px) is what sets the limit: a longer label must be tested at 320 px.
