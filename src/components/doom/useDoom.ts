"use client";

import { useEffect, useSyncExternalStore } from "react";
import { parseEnd, phaseOf, previewEnd, remaining, type DoomPhase, type Remaining } from "@/lib/doom/clock";
import { startFinale } from "./finaleStore";

/**
 * The end of the (fictional) digital world configured for this deployment: `NEXT_PUBLIC_WORLD_END_AT`, an ISO date.
 * Without it the whole "100 days" story is off and the site is exactly what it was.
 */
const CONFIGURED_END = parseEnd(process.env.NEXT_PUBLIC_WORLD_END_AT);
const STORE_KEY = "pw-doom-preview";

/* ---- ?preview=J-9 : look at a chapter of the story without touching the real date (kept for the tab, `?preview=off` forgets it) ---- */
const readPreview = (): string => {
  try {
    const q = new URLSearchParams(window.location.search).get("preview");
    if (q !== null) return q;
    return sessionStorage.getItem(STORE_KEY) ?? "";
  } catch { return ""; }
};
const subscribePreview = (cb: () => void) => { window.addEventListener("popstate", cb); return () => window.removeEventListener("popstate", cb); };
// a preview counts down in real time from where it was first opened: the anchor is fixed per value
const anchors = new Map<string, number>();
const previewEndFor = (value: string): number | null => {
  if (!anchors.has(value)) anchors.set(value, Date.now());
  return previewEnd(value, anchors.get(value)!);
};

/** The end the page is counting to right now: the preview if there is one, else the configured date, else none. */
function currentEnd(): number | null {
  const preview = readPreview();
  return (preview && preview.toLowerCase() !== "off" ? previewEndFor(preview) : null) ?? CONFIGURED_END;
}

/* ---- one shared clock for every piece of the countdown; it also notices the moment the countdown reaches zero ---- */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let wasOver: boolean | null = null; // null: not known yet (the sequence only plays for someone who sees the countdown reach zero)
const tickNow = () => {
  const end = currentEnd();
  const over = end === null ? null : Date.now() >= end;
  if (wasOver === false && over === true) startFinale(); // started before anything re-renders, so the interface never shows the end state first
  wasOver = over;
  listeners.forEach((l) => l());
};
const subscribeClock = (cb: () => void) => {
  listeners.add(cb);
  if (!timer) {
    const end = currentEnd();
    wasOver = end === null ? null : Date.now() >= end;
    timer = setInterval(tickNow, 1000);
    document.addEventListener("visibilitychange", tickNow);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; wasOver = null; document.removeEventListener("visibilitychange", tickNow); }
  };
};
const nowSecond = () => Math.floor(Date.now() / 1000);

export interface Doom {
  /** The instant the countdown reads zero. */
  end: number;
  /** Shown from `?preview=…` (a simulation), not from the real date. */
  preview: boolean;
  remaining: Remaining;
  phase: DoomPhase;
}

/** The countdown, or `null` when it is off (no date configured, no preview) or not mounted yet. */
export function useDoom(): Doom | null {
  const preview = useSyncExternalStore(subscribePreview, readPreview, () => "");
  const nowS = useSyncExternalStore(subscribeClock, nowSecond, () => 0);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("preview");
      if (q === null) return;
      if (q === "" || q.toLowerCase() === "off") sessionStorage.removeItem(STORE_KEY); else sessionStorage.setItem(STORE_KEY, q);
    } catch { /* private mode: the preview just lasts for this page */ }
  }, [preview]);
  if (nowS === 0) return null; // server render and first paint: nothing until the clock is mounted
  const previewed = preview && preview.toLowerCase() !== "off" ? previewEndFor(preview) : null;
  const end = previewed ?? CONFIGURED_END;
  if (end === null) return null;
  const r = remaining(end, nowS * 1000);
  return { end, preview: previewed !== null, remaining: r, phase: phaseOf(r) };
}
