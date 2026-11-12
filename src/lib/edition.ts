/**
 * The edition (the 365 days) as the interface sees it. Pure types and helpers, no database: the state itself is decided by PostgreSQL
 * (`px_edition_info()`, computed from the clock at every call), this file only describes what comes back.
 *
 *   prelaunch  no date, nothing is sold (the 365 days start only when an administrator opens the edition)
 *   open       opens_at … closes_at: purchases, projects and creations are open
 *   closed     from closes_at on: nothing can be bought; the creations freeze once the payments under way have settled (`frozen`)
 */
export type EditionState = "prelaunch" | "open" | "closed";

export interface EditionSnapshotInfo { revision: number; takenAt: string; parcelCount: number; hash: string }

/** Everything the back office sees. Dates are ISO strings (or null while the edition has not been opened). */
export interface EditionInfo {
  id: string;
  slug: string;
  name: string;
  /** What is recorded (`prelaunch` | `open` | `closed`); `state` is what the clock says right now. */
  status: EditionState;
  state: EditionState;
  frozen: boolean;
  durationDays: number;
  opensAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  /** When the payments under way have had their delay to finish: the creations freeze, the snapshot follows. */
  settlesAt: string | null;
  /** The server's clock when this was read: a browser shows a countdown from THIS, never from its own clock. */
  serverNow: string;
  snapshot: EditionSnapshotInfo | null;
}

/** What anybody may read (no snapshot hash, no identifiers). */
export interface PublicEdition {
  slug: string;
  name: string;
  state: EditionState;
  frozen: boolean;
  opensAt: string | null;
  closesAt: string | null;
  closedAt: string | null;
  serverNow: string;
  /** How long the edition lasts once an administrator opens it (365): what the map announces before the opening. */
  durationDays: number;
}

export function toPublicEdition(i: EditionInfo): PublicEdition {
  return { slug: i.slug, name: i.name, state: i.state, frozen: i.frozen, opensAt: i.opensAt, closesAt: i.closesAt, closedAt: i.closedAt, serverNow: i.serverNow, durationDays: i.durationDays };
}

/** Share of the edition already gone: 0 before the opening, 1 once closed, on the SERVER's clock in between. */
export function editionProgress(e: Pick<PublicEdition, "state" | "opensAt" | "closesAt" | "serverNow">): number {
  if (e.state === "prelaunch" || !e.opensAt || !e.closesAt) return 0;
  if (e.state === "closed") return 1;
  const a = Date.parse(e.opensAt), b = Date.parse(e.closesAt), n = Date.parse(e.serverNow);
  return b <= a ? 1 : Math.max(0, Math.min(1, (n - a) / (b - a)));
}

/** Whole days left until the closing, counted on the SERVER's clock (null before the opening, 0 once closed). */
export function daysLeft(e: Pick<PublicEdition, "state" | "closesAt" | "serverNow">): number | null {
  if (e.state === "prelaunch" || !e.closesAt) return null;
  if (e.state === "closed") return 0;
  return Math.max(0, Math.ceil((Date.parse(e.closesAt) - Date.parse(e.serverNow)) / 86_400_000));
}

/**
 * The time left until the closing, split for a clock. `nowMs` is the SERVER's moment (the page ticks on the server's clock as measured once in
 * the browser, never on the browser's own). All zeros once the closing has passed.
 */
export function timeLeft(closesAt: string, nowMs: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor((Date.parse(closesAt) - nowMs) / 1000));
  return { d: Math.floor(total / 86_400), h: Math.floor((total % 86_400) / 3_600), m: Math.floor((total % 3_600) / 60), s: total % 60 };
}
