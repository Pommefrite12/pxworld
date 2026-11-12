/**
 * Free imprints ("empreintes gratuites"): small parcels (1 to 24 pixels) given for nothing at the start of the edition, that a paid parcel
 * covers when it touches them. The rules live in PostgreSQL (migration 23, `px_free_status`); this file is only what the interface needs to know.
 */
import type { ParcelKind } from "@/lib/grid/pricing";

/** What `px_free_status(user)` answers. `reason`: why nobody can place one now; `userReason`: why this account cannot. */
export interface FreeInfo {
  open: boolean;
  reason: "edition" | "off" | "ended" | "full" | null;
  userReason: "standing" | "lifetime" | null;
  endsAt: string | null;
  maxArea: number;
  cap: number;
  placed: number;
  used: number;
  lifetimeMax: number;
}

/** Can THIS account place a free parcel right now? */
export const freeAvailable = (f: FreeInfo | null | undefined): f is FreeInfo => Boolean(f && f.open && f.userReason === null);

/** Is the selection a free one? Land only, from 1 pixel up to the biggest free parcel (always below the smallest paid one). */
export function isFreeSelection(f: FreeInfo | null | undefined, size: { w: number; h: number }, kind: ParcelKind): boolean {
  return freeAvailable(f) && kind === "land" && size.w >= 1 && size.h >= 1 && size.w * size.h <= f.maxArea;
}

/** A few sizes to offer for nothing, whatever the biggest one is: from a single pixel to the biggest that fits. */
export function freePresets(maxArea: number): { w: number; h: number }[] {
  const all = [{ w: 1, h: 1 }, { w: 2, h: 2 }, { w: 3, h: 3 }, { w: 4, h: 4 }, { w: 4, h: 6 }];
  return all.filter((p) => p.w * p.h <= maxArea);
}
