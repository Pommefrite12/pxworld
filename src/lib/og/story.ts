/**
 * What the share image of the home page says, and when. Pure (no DOM, no image library): the route draws it, the tests check it.
 *
 * Three states: the ordinary site (no end date configured and no preview), the countdown (the number of days left, the real one)
 * and the end ("the world has been deleted", with the real number of parcels that survived). The numbers are always the real
 * ones; the image never invents any.
 */
import { DOOM_DAYS, remaining } from "@/lib/doom/clock";

export type ShareState = { kind: "plain" } | { kind: "countdown"; days: number } | { kind: "end" };

/** The state at `now`, given the instant the countdown ends (`null`: the story is off). */
export function shareState(end: number | null, now: number): ShareState {
  if (end === null) return { kind: "plain" };
  const r = remaining(end, now);
  return r.over ? { kind: "end" } : { kind: "countdown", days: Math.min(DOOM_DAYS, r.days) };
}

/**
 * The address of the home page's share image. The state is part of it (and, while counting down, the day), so that a platform
 * that keeps previews for days still fetches a fresh image when the story moves on. (The route works the state out for itself:
 * these extra parameters only change the address.)
 */
export function homeImagePath(locale: string, state: ShareState): string {
  const lang = locale === "fr" ? "fr" : "en";
  const base = `/api/og/home?lang=${lang}`;
  return state.kind === "end" ? `${base}&s=e` : state.kind === "countdown" ? `${base}&s=c&d=${state.days}` : base;
}

export interface ShareLines {
  /** The small line above the main one (the story's title). */
  kicker: string;
  /** The main line. */
  title: string;
  /** The big figure or sentence under it. */
  figure: string;
  /** The closing line. */
  foot: string;
}

const FR = {
  kicker: "100 JOURS POUR SAUVER LE MONDE",
  left: (n: number) => (n === 0 ? "DERNIER JOUR" : n === 1 ? "PLUS QU'1 JOUR" : `PLUS QUE ${n} JOURS`),
  only: "Seules les parcelles acquises survivront.",
  over: "LE MONDE A ÉTÉ SUPPRIMÉ.",
  survived: (n: number) => (n === 0 ? "AUCUNE PARCELLE N'A SURVÉCU." : n === 1 ? "1 PARCELLE A SURVÉCU." : `${n} PARCELLES ONT SURVÉCU.`),
  onlyOver: "Seules les parcelles acquises ont survécu.",
  join: "Voir les survivants.",
};
const EN = {
  kicker: "100 DAYS TO SAVE THE WORLD",
  left: (n: number) => (n === 0 ? "LAST DAY" : n === 1 ? "1 DAY LEFT" : `${n} DAYS LEFT`),
  only: "Only claimed plots will survive.",
  over: "THE WORLD HAS BEEN DELETED.",
  survived: (n: number) => (n === 0 ? "NO PLOT SURVIVED." : n === 1 ? "1 PLOT SURVIVED." : `${n} PLOTS SURVIVED.`),
  onlyOver: "Only claimed plots survived.",
  join: "Meet the survivors.",
};

/** The words of the image. `survivors` is the real number of parcels (`null`: unknown, then nothing is claimed about it). */
export function shareLines(lang: "fr" | "en", state: ShareState, survivors: number | null): ShareLines | null {
  const L = lang === "fr" ? FR : EN;
  if (state.kind === "plain") return null;
  if (state.kind === "countdown") return { kicker: L.kicker, title: L.left(state.days), figure: L.only, foot: L.kicker };
  return { kicker: L.kicker, title: L.over, figure: survivors === null ? L.onlyOver : L.survived(survivors), foot: L.join };
}

/** Roughly how wide a character of the pixel font is, in ems, for the capitals the images use (a little over the widest measured). */
const EM_PER_CHAR = 0.385;

/** The largest font size, up to `max`, at which `text` still fits on one line of `width` pixels. */
export function fitSize(text: string, width: number, max: number): number {
  return Math.max(12, Math.min(max, Math.floor(width / (Math.max(1, text.length) * EM_PER_CHAR))));
}
