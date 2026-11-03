/**
 * "100 days to save the world": the clock behind the countdown. Pure functions, no React, no browser: given the instant the
 * (fictional) end of the digital world and "now", what does the countdown read, and which chapter of the story are we in?
 * Nothing here touches buying, parcels or any real figure; it only decides what the interface says and looks like.
 */
export const DOOM_DAYS = 100;
const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** The chapters of the story: 1 J100→J76, 2 J75→J31, 3 J30→J8, 4 J7→J0 (last week), 5 the world is gone. */
export type DoomPhase = 1 | 2 | 3 | 4 | 5;

export interface Remaining {
  /** Milliseconds left (never negative). */
  ms: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** The countdown has reached zero. */
  over: boolean;
}

/** The end of the world as an instant (ms since the epoch) from an ISO date; `null` when absent or not a date. */
export function parseEnd(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function remaining(end: number, now: number): Remaining {
  const ms = Math.max(0, end - now);
  return {
    ms,
    days: Math.floor(ms / DAY),
    hours: Math.floor((ms % DAY) / HOUR),
    minutes: Math.floor((ms % HOUR) / MINUTE),
    seconds: Math.floor((ms % MINUTE) / SECOND),
    over: ms === 0,
  };
}

export function phaseOf(r: Remaining): DoomPhase {
  if (r.over) return 5;
  if (r.days >= 76) return 1;
  if (r.days >= 31) return 2;
  if (r.days >= 8) return 3;
  return 4;
}

/**
 * A preview of the countdown at a chosen moment, for looking at each chapter without touching the real date:
 * `J-9` or `9` → nine days (and a fixed 6 h 41 min 27 s so that the digits are lively); `0`, `J0`, `fin` or `over` → the end;
 * `T-5` → the end in five seconds, to watch the final sequence play live.
 * Returns the instant the clock should be counting to, or `null` when the value means nothing.
 */
export function previewEnd(value: string | null | undefined, now: number): number | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["0", "j0", "fin", "over", "end"].includes(v)) return 0; // long since over, whatever the clock reads: never "a second left"
  const t = /^t-?(\d{1,3})$/.exec(v);
  if (t) return now + Number(t[1]) * SECOND;
  const m = /^(?:j-?)?(\d{1,3})$/.exec(v);
  if (!m) return null;
  const days = Math.min(DOOM_DAYS, Number(m[1]));
  return now + days * DAY + 6 * HOUR + 41 * MINUTE + 27 * SECOND;
}

/** Two digits for the countdown ("07"); three or more are left whole. */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The corruption just before the end (the world as it is when the final sequence starts). */
export const PRE_END_INTENSITY = 0.58;

/**
 * How much of the unacquired land the story has already corrupted at this moment, 0 to 1 (before the end; at the end the
 * whole of it is). Slow at first, then faster: about 4 % at J-87, 48 % at J-9 — the pace the map layer will follow.
 */
export function infection(r: Remaining): number {
  if (r.over) return 1;
  const days = r.ms / DAY;
  const p = Math.min(1, Math.max(0, (DOOM_DAYS - days) / DOOM_DAYS));
  return 0.03 + 0.55 * p ** 2.2;
}
