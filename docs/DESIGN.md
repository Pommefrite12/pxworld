# Design system

"Pixel-inspired, modern, premium": a warm paper background, a navy ink, one hot orange, and buttons that look like they were
cut out pixel by pixel. Everything lives in `src/app/globals.css` (tokens in `@theme`, components in `@layer components`).
In development, **`/dev/design`** shows every button family in its three states next to the palette (404 in production).

## Palette

| Token | Value | Use |
|---|---|---|
| `paper` | `#fcf9f2` | page background (warm) |
| `paper-2` | `#f5efe2` | panels, chips |
| `line` | `#e6dccb` | borders |
| `ink` | `#1f2540` | main text, dark buttons |
| `ink-soft` / `ink-faint` | `#4a5068` / `#575e77` | secondary text (≥ 5.6:1 on every surface) |
| `signal` | `#f04316` | brand orange: CTA, figures, accents |
| `signal-strong` | `#d93a10` | orange for small text (4.4:1) |
| `sky` / `sky-2` / `sky-line` | `#e6f2ff` / `#cfe6ff` / `#9cc3ec` | hover / pressed-active / their outline |
| `cobalt` | `#2457c5` | links and focus ring (6.2:1) |

## Pixel details

* **Stair-step corners** (two steps of 2 px, `--s`) instead of rounded ones. A button is two stacked layers (`::before` = outline, `::after` = face) clipped with the same stepped polygon; the element itself is not clipped, so the focus ring and the shadow stay clean.
* **Relief**: a 1 px highlight along the top of the face and a darker ledge under it (`--ledge`, 3 px).
* **8-bit shadow** `0 2px 0 rgb(31 37 64 / .12)` as a `drop-shadow`, which follows the stepped outline.
* **States**: hover goes light (sky, or a brighter orange for the CTA, with a soft glow); pressed goes deeper and sinks 2 px; `aria-pressed` / `aria-checked` use the pressed sky; focus is a 3 px ring with a 3 px offset; disabled is 50 % opacity.

## Components

| Class | What | Example |
|---|---|---|
| `btn btn-primary` | main call to action (orange) | *Trouvez votre place* |
| `btn btn-secondary` | support action (cream) | *Connexion* |
| `btn btn-ghost` | discreet action (white) | *Explorer*, most secondary buttons |
| `btn btn-ink` | strong neutral (navy) | *Enregistrer*, *Importer une image* |
| `btn btn-nav` | navigation pill (finer steps) | *Découvrir ›* |
| `btn-icon` (with a variant) | square icon button | close, zoom, search |
| `btn-sm` | smaller | toolbars |
| `badge-px` | small floating label on the map | coordinates, credits |
| `card`, `field`, `chip`, `label` | surfaces, inputs, tags (notched details, soft 8-bit shadow, clear focus) | |

States can be forced for documentation with the helper classes `is-hover` and `is-active`.

## Accessibility

The orange CTA is a gradient from `#ea4211` to `#d63a10` with bold white text and a subtle dark text-shadow (about 4.3–4.6:1 across the face; the pure brand `#f04316` is kept for large figures and accents, where 3.8:1 is enough). Every interactive state is also readable without colour (sinking, outline, ring). Covered by the axe checks in `tests/e2e/ui.spec.ts`.
