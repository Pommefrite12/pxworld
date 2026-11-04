import { hash2 } from "./corruption";

/**
 * The "computer bug" of the destroyed land. Every `GLITCH_EVERY_MS`, for about a second and a half, a few ZONES of the world map —
 * rectangles that cover a part of the world, drawn at random anywhere on the planisphere each time — are "bugged": the land inside
 * them slides from right to left in jerks, band by band at different speeds, leaving an echo behind, while the zones themselves
 * jump leftwards across the map. Then everything snaps back to where it was. It is drawn over the tiles, never baked into them.
 */
export const GLITCH_EVERY_MS = 30_000;
export const GLITCH_FOR_MS = 1_400;
/** The picture changes at about 11 images a second: a stutter, not a smooth movement. */
export const GLITCH_FRAME_MS = 90;
/** The content of a zone, and the zone itself, move leftwards in this many jerks over the burst. */
export const GLITCH_JERKS = 7;
/** The most a band of land slides to the left by the end of the burst, in tile pixels (device pixels of the rendering level). */
export const GLITCH_MAX_PX = 80;
/** How far a zone itself travels to the left during the burst, as a share of its own width. */
export const GLITCH_TRAVEL = 0.9;
/** How many zones are bugged at a time. */
export const GLITCH_ZONES = 4;

export interface GlitchFrame {
  /** Which still picture of the burst this is. */
  n: number;
  /** How far the burst has gone, 0 → 1. */
  progress: number;
  /** Which burst this is: every burst is drawn from its own number, so that it does not bug the same places as the one before (0 when not given). */
  seed?: number;
}

/** The picture of the burst `elapsed` ms after it began, or `null` once it is over (or before it began). */
export function glitchFrame(elapsed: number, seed = 0): GlitchFrame | null {
  if (!(elapsed >= 0) || elapsed >= GLITCH_FOR_MS) return null;
  return { n: Math.floor(elapsed / GLITCH_FRAME_MS), progress: elapsed / GLITCH_FOR_MS, seed };
}

/**
 * Progress in jerks: it stays on a value, then jumps to the next (`GLITCH_JERKS` jumps in all), a jump now and then held back one
 * beat. Never goes back: the later, the further. `salt` gives each zone and each band its own rhythm.
 */
export function jerk(progress: number, salt: number, seed = 0): number {
  const k = Math.max(0, Math.min(GLITCH_JERKS, Math.floor(progress * (GLITCH_JERKS + 1))));
  const held = k > 0 && hash2(k, Math.imul(seed, 31) + salt, 61) < 0.25 ? 1 : 0;
  return (k - held) / GLITCH_JERKS;
}

/** How far (tile px, always to the LEFT, so zero or negative) a band of two lattice rows has slid in this picture. `reach` is 0 outside the bugged zones. */
export function glitchShift(band: number, frame: GlitchFrame, reach = 1): number {
  if (reach <= 0) return 0;
  const seed = frame.seed ?? 0, salt = Math.imul(seed, 7919);
  if (hash2(band, 0, 71 + salt) >= 0.6) return 0; // most of the bands move, not all
  if (hash2(band, frame.n, 74 + salt) < 0.12) return 0; // and now and then one blinks back to its place
  const speed = 0.3 + 0.7 * hash2(band, 0, 73 + salt); // each band at its own speed…
  const late = 0.8 + 0.4 * hash2(band, 0, 75 + salt); // …and its own moment
  const at = jerk(Math.min(1, frame.progress * late), band, seed);
  return -Math.round(speed * GLITCH_MAX_PX * Math.max(0.1, at));
}

/* ------------------------------------------------------------------ the bugged zones, anywhere on the planisphere */
/** A rectangle of the world, in grid pixels. `x` may be any value (the world wraps round at its width). */
export interface GlitchZone { x: number; y: number; w: number; h: number }

const wrap = (x: number, worldWidth: number) => ((x % worldWidth) + worldWidth) % worldWidth;

/**
 * The zones of the burst `seed`, anywhere on the world map: `GLITCH_ZONES` rectangles, each 16 to 32 % of the world's width and 14 to
 * 26 % of its height, at random places (a different set for each seed). The first one is always put where the visitor is looking
 * (inside `view`, a little to the right, since the zones travel leftwards), so that a burst is never lost off screen when the map is zoomed in.
 */
export function pickZones(seed: number, view: { x0: number; y0: number; x1: number; y1: number }, worldWidth = 40_000, worldHeight = 25_000, count = GLITCH_ZONES): GlitchZone[] {
  const zones: GlitchZone[] = [];
  const seeing = view.x1 - view.x0 < 0.85 * worldWidth && view.y1 - view.y0 < 0.85 * worldHeight;
  for (let i = 0; i < count; i++) {
    const w = (0.16 + 0.16 * hash2(seed, i, 501)) * worldWidth, h = (0.14 + 0.12 * hash2(seed, i, 502)) * worldHeight;
    if (i === 0 && seeing) {
      const cx = view.x0 + hash2(seed, i, 503) * (view.x1 - view.x0), cy = view.y0 + hash2(seed, i, 504) * (view.y1 - view.y0);
      zones.push({ x: wrap(cx - w / 2 + (GLITCH_TRAVEL * w) / 2, worldWidth), y: Math.max(0, Math.min(worldHeight - h, cy - h / 2)), w, h });
    } else zones.push({ x: wrap(hash2(seed, i, 505) * worldWidth, worldWidth), y: hash2(seed, i, 506) * (worldHeight - h), w, h });
  }
  return zones;
}

/** Where a zone is in this picture of the burst: it has jumped leftwards (in jerks of its own) by up to `GLITCH_TRAVEL` of its width. */
export function zoneNow(zone: GlitchZone, index: number, frame: GlitchFrame, worldWidth = 40_000): GlitchZone {
  const travel = zone.w * GLITCH_TRAVEL * jerk(frame.progress, 100 + index, frame.seed ?? 0);
  return { ...zone, x: wrap(zone.x - travel, worldWidth) };
}

/* ------------------------------------------------------------------ what a bugged zone looks like on the screen */
/** How far a band of a zone has scrolled by the end of the burst, at most, as a share of the zone's width. */
export const GLITCH_SCROLL = 0.4;
export interface BugBand {
  /** Top of the band and its height, in pixels, from the top of the zone. */
  y: number;
  h: number;
  /** How far the band has scrolled to the LEFT, in pixels (0 or more): its content goes out at the left and comes back in at the right. */
  shift: number;
  /** Every other band is a little lighter, like the lines of a screen. */
  light: boolean;
}

/**
 * The bands of a bugged zone `rect` (`w` × `h` pixels on the screen) in this picture: horizontal strips of 5 to 28 px, most of them
 * scrolling to the left, each at its own speed and its own moment, a few blinking back to their place now and then.
 */
export function bugBands(zoneIndex: number, rect: { w: number; h: number }, frame: GlitchFrame): BugBand[] {
  const bh = Math.max(5, Math.min(28, Math.round(rect.h / 16))), out: BugBand[] = [];
  for (let y = 0, b = 0; y < rect.h; y += bh, b++) {
    const dx = glitchShift(zoneIndex * 997 + b, frame, 1);
    out.push({ y, h: Math.min(bh, rect.h - y), shift: Math.round((-dx / GLITCH_MAX_PX) * GLITCH_SCROLL * rect.w), light: b % 2 === 0 });
  }
  return out;
}
