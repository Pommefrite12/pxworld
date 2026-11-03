"use client";

import { useSyncExternalStore } from "react";
import { FINALE_SECONDS } from "@/lib/doom/finale";

/**
 * The final sequence's state, shared by the interface and the map: is it playing, since when, and is it a replay. It starts
 * when the countdown reaches zero while the visitor is looking (`useDoom`'s clock), or when they press "Replay the destruction".
 */
let during = false, startedAt = 0, replay = false, token = 0;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
const subscribe = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };

export function startFinale(isReplay = false): void {
  const mine = ++token;
  during = true; replay = isReplay; startedAt = performance.now();
  notify();
  // the map announces the end of the sequence (`endFinale`); this is only for a page without a map (it never plays one) or a stalled tab
  setTimeout(() => { if (token === mine && during) { during = false; notify(); } }, (FINALE_SECONDS + 5) * 1000);
}

/** The map has finished playing the sequence: the interface may now say what happened. */
export function endFinale(): void {
  if (!during) return;
  during = false;
  notify();
}

/** The sequence in progress, for the map: when it started (`performance.now()`), and whether it replays an end state already shown. */
export const finaleInfo = () => ({ during, startedAt, replay });

/** True from the start of the sequence until its message appears (about 8 s). */
export function useFinaleDuring(): boolean {
  return useSyncExternalStore(subscribe, () => during, () => false);
}
