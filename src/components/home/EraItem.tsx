"use client";

import { useEffect, useRef } from "react";

/**
 * One station of the story (`Eras`). It comes into view as the visitor scrolls down to it: its picture slides in from its own side and its
 * words follow (the CSS is `.era[data-reveal]` in `globals.css`).
 *
 * Nothing is ever hidden unless this script runs: without JavaScript, or with "reduce motion" on, or in a browser without
 * `IntersectionObserver`, the station is plain markup, shown. A station already on screen when the page opens (or above it, after a reload
 * halfway down) is never hidden either, so there is no flash. The data attribute is set on the element directly, not through state: React
 * never renders it, so there is nothing to re-render.
 */
export function EraItem({ era, children }: { era: string; children: React.ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top <= window.innerHeight * 0.9) return; // already visible (or behind us): leave it alone
    el.dataset.reveal = "wait";
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      el.dataset.reveal = "in";
      io.disconnect();
    }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => { io.disconnect(); delete el.dataset.reveal; };
  }, []);
  return <li ref={ref} className="era" data-era={era} data-testid="era">{children}</li>;
}
