/**
 * The group projects that are collecting, as the map draws and clicks them ("Fund it together", step 4). Pure functions: the engine
 * (a Canvas renderer) only calls them, so that what matters here can be tested without a browser.
 */
export interface MapProject {
  id: string;
  code: string;
  title: string;
  x: number; y: number; w: number; h: number;
  /** A water project: its zone is sea. */
  water: boolean;
  raisedCents: number;
  goalCents: number;
  currency: string;
  contributors: number;
  /** Seconds left when the list was fetched. */
  secondsLeft: number;
}

/** A project this small on the screen (in CSS px) is drawn as a pin, so that it can still be found when the map is zoomed out. */
export const PROJECT_PIN_BELOW_PX = 14;
/** The area of a project that reacts to a click or a hover is never smaller than this many CSS px across. */
export const PROJECT_HIT_MIN_PX = 22;
/** Above this size on the screen the progress is drawn along the bottom edge of the zone. */
export const PROJECT_BAR_FROM_PX = 70;

export type ProjectLook = "pin" | "zone";

/** How a project looks at this zoom: a pin while it is a speck, its whole zone once it is big enough to be one. */
export function projectLook(widthPx: number, heightPx: number): ProjectLook {
  return Math.min(widthPx, heightPx) < PROJECT_PIN_BELOW_PX ? "pin" : "zone";
}

/**
 * Does a point of the world (in grid pixels) hit this project? A project is a small target on a big map: at low zoom its hit area is
 * grown so that it is at least `PROJECT_HIT_MIN_PX` across on the screen (`scale` = CSS px per grid pixel).
 */
export function projectHit(p: Pick<MapProject, "x" | "y" | "w" | "h">, wx: number, wy: number, scale: number): boolean {
  const growX = Math.max(0, (PROJECT_HIT_MIN_PX / scale - p.w) / 2), growY = Math.max(0, (PROJECT_HIT_MIN_PX / scale - p.h) / 2);
  return wx >= p.x - growX && wx < p.x + p.w + growX && wy >= p.y - growY && wy < p.y + p.h + growY;
}

/** The project under a point; when two overlap (a land one and a water one), the nearest to its own centre wins. */
export function projectAt<T extends Pick<MapProject, "x" | "y" | "w" | "h">>(list: readonly T[], wx: number, wy: number, scale: number): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const p of list) {
    if (!projectHit(p, wx, wy, scale)) continue;
    const d = Math.hypot(wx - (p.x + p.w / 2), wy - (p.y + p.h / 2));
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Share of the goal that is paid, 0 → 1 (for the bar). */
export const projectProgress = (p: Pick<MapProject, "raisedCents" | "goalCents">): number => (p.goalCents > 0 ? Math.max(0, Math.min(1, p.raisedCents / p.goalCents)) : 0);
