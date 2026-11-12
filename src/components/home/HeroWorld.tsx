"use client";

import { useEffect, useRef } from "react";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { assetUrl } from "@/lib/images/sizes";
import { NIGHT_PALETTE as P } from "@/lib/map/palette";

/** One trace of the archive, placed where it is on the planet. */
export interface HeroMarker { code: string; x: number; y: number; assetId: string }

const COLS = 320, ROWS = 200, K = 5; // the world in 320 × 200 cells (8:5, like the grid), 5 px a cell: a moderate, readable pixelation
const BAND_W = 80 * K, SWEEP_MS = 15_000, SWEEP_SHARE = 0.62; // the band of light: width, a whole round (crossing + pause), the share of the round it crosses
const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/**
 * The planisphere of the home page: the REAL land of the site (the same Natural Earth outlines the map is drawn from), in the night palette, one
 * cell a pixel; the traces of the archive sit on it at their true places. It is a picture, not the map: nothing to drag, so the page scrolls
 * normally; "Explore the archives" opens the interactive map. It is always shown WHOLE (`object-contain`, on a frame of the ocean's colour): no zoom on a zone, on any screen. Without any trace there is only the world: nothing is ever made up.
 */
export function HeroWorld({ markers, label }: { markers: HeroMarker[]; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true, raf = 0, running = false;
    const canvas = ref.current!;
    const W = COLS * K, H = ROWS * K;
    canvas.width = W; canvas.height = H;
    const vg = canvas.getContext("2d")!; // what is seen (and animated)
    vg.imageSmoothingEnabled = false;
    const base = document.createElement("canvas"); base.width = W; base.height = H; // the still picture, built once
    const g = base.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = P.ocean; g.fillRect(0, 0, W, H);
    vg.drawImage(base, 0, 0); // the ocean is there at once, blue
    // two light layers, one pixel a cell (they are shown scaled up, so they keep the pixel look): the coasts, which breathe, and the land, which a band of light sweeps
    const cellLayer = () => { const c = document.createElement("canvas"); c.width = COLS; c.height = ROWS; return c; };
    const glow = cellLayer(), gl = glow.getContext("2d")!;
    const lit = cellLayer(), ll = lit.getContext("2d")!;
    let stop = () => {};
    const band = document.createElement("canvas"); band.width = BAND_W + K; band.height = H; // the strip of land lit by the band of light
    const bandCtx = band.getContext("2d")!; bandCtx.imageSmoothingEnabled = false;
    const dots = markers.map((mk) => ({ x: Math.round((mk.x / GRID_WIDTH) * COLS) * K, y: Math.round((mk.y / GRID_HEIGHT) * ROWS) * K }));

    void (async () => {
      let land: Uint8Array;
      try {
        const f = (await (await fetch("/data/land-110.json")).json()) as { q: number; polygons: number[][][] };
        if (!alive) return;
        // the outlines → one cell each: the land is filled (even-odd, as the map does) on a canvas of COLS × ROWS, then read back
        const mask = document.createElement("canvas"); mask.width = COLS; mask.height = ROWS;
        const m = mask.getContext("2d", { willReadFrequently: true })!;
        const path = new Path2D();
        const sx = COLS / GRID_WIDTH, sy = ROWS / GRID_HEIGHT;
        for (const poly of f.polygons) for (const ring of poly) {
          let x = 0, y = 0;
          for (let i = 0; i < ring.length / 2; i++) {
            if (i === 0) { x = ring[0]!; y = ring[1]!; } else { x += ring[2 * i]!; y += ring[2 * i + 1]!; }
            if (i === 0) path.moveTo((x / f.q) * sx, (y / f.q) * sy); else path.lineTo((x / f.q) * sx, (y / f.q) * sy);
          }
          path.closePath();
        }
        m.fill(path, "evenodd");
        const d = m.getImageData(0, 0, COLS, ROWS).data;
        land = new Uint8Array(COLS * ROWS);
        for (let i = 0; i < land.length; i++) land[i] = d[i * 4 + 3]! > 127 ? 1 : 0;
      } catch {
        return; // no outlines: the blue ocean stays, which is still a coherent picture
      }
      const isLand = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS && land[r * COLS + c] === 1;
      const R = rng(7), cell = (c: number, r: number, color: string) => { g.fillStyle = color; g.fillRect(c * K, r * K, K, K); };

      // the ocean: a few lighter cells (a soft pixel texture), and a graticule of points every 20 cells
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (isLand(c, r)) continue;
        const v = R();
        if (v < 0.07) cell(c, r, "#11214a"); else if (v < 0.095) cell(c, r, "#16295a");
      }
      g.fillStyle = "rgba(110,160,235,0.30)";
      for (let r = 0; r <= ROWS; r += 20) for (let c = 0; c <= COLS; c += 20) g.fillRect(c * K - 1, r * K - 1, 2, 2);
      // a glow of the sea along the coasts
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (isLand(c, r)) continue;
        let near = 9;
        for (let j = -2; j <= 2 && near > 1; j++) for (let i = -2; i <= 2; i++) if (isLand(c + i, r + j)) near = Math.min(near, Math.max(Math.abs(i), Math.abs(j)));
        if (near === 1) { cell(c, r, "#183468"); gl.fillStyle = "rgb(80,150,240)"; gl.fillRect(c, r, 1, 1); }
        else if (near === 2) { cell(c, r, "#122858"); gl.fillStyle = "rgb(45,95,200)"; gl.fillRect(c, r, 1, 1); }
      }
      // the land: violet with a little texture, the coast in soft gold
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (!isLand(c, r)) continue;
        const v = R();
        cell(c, r, v < 0.12 ? "#412660" : v < 0.2 ? "#321b49" : P.land);
        ll.fillStyle = "rgb(175,125,245)"; ll.fillRect(c, r, 1, 1);
        if (!isLand(c - 1, r) || !isLand(c + 1, r) || !isLand(c, r - 1) || !isLand(c, r + 1)) { cell(c, r, `rgba(${P.ink},0.62)`); gl.fillStyle = `rgb(${P.ink})`; gl.fillRect(c, r, 1, 1); }
        else if (!isLand(c - 1, r - 1) || !isLand(c + 1, r + 1) || !isLand(c + 1, r - 1) || !isLand(c - 1, r + 1)) cell(c, r, `rgba(${P.ink},0.18)`);
      }
      // points of light
      const L = rng(21);
      for (let i = 0; i < 90; i++) {
        const x = Math.floor(L() * W), y = Math.floor(L() * H), s = L() < 0.2 ? 3 : 2;
        g.fillStyle = L() < 0.5 ? `rgba(214,171,114,${0.35 + L() * 0.5})` : `rgba(85,199,209,${0.3 + L() * 0.5})`;
        g.fillRect(x, y, s, s);
      }
      // the traces of the archive, at their true places: a glow, a cyan frame, the creation inside
      const box = 3 * K;
      for (const mk of markers) {
        const cx = Math.round((mk.x / GRID_WIDTH) * COLS) * K - box / 2, cy = Math.round((mk.y / GRID_HEIGHT) * ROWS) * K - box / 2;
        g.globalCompositeOperation = "lighter";
        const gr = g.createRadialGradient(cx + box / 2, cy + box / 2, 2, cx + box / 2, cy + box / 2, box * 2.4);
        gr.addColorStop(0, "rgba(85,199,209,0.30)"); gr.addColorStop(1, "rgba(85,199,209,0)");
        g.fillStyle = gr; g.fillRect(cx - box * 2.4, cy - box * 2.4, box * 5.8, box * 5.8);
        g.globalCompositeOperation = "source-over";
        g.fillStyle = "#3a2358"; g.fillRect(cx, cy, box, box);
        g.lineWidth = 2; g.strokeStyle = `rgb(${P.free})`; g.strokeRect(cx - 1, cy - 1, box + 2, box + 2);
        const img = new Image();
        img.onload = () => { if (!alive) return; g.imageSmoothingEnabled = false; g.drawImage(img, cx, cy, box, box); g.strokeRect(cx - 1, cy - 1, box + 2, box + 2); if (!running) paint(0, false); };
        img.src = assetUrl(mk.assetId, 64);
      }
      paint(0, false);

      // ---- the life of the picture: the coasts breathe, a band of light sweeps the land, the traces of the archive send out rings. Nothing moves
      // for a visitor who asked for less motion; the loop sleeps when the picture is off screen or the tab hidden, and gives up on a machine that struggles.
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const t0 = performance.now(), frameMs = 1000 / 30;
      let last = 0, costly = 0, frames = 0, visible = true;
      const tick = (now: number) => {
        raf = 0;
        if (!alive || !running) return;
        if (now - last >= frameMs) {
          last = now;
          const a = performance.now();
          paint(now - t0, true);
          if (++frames <= 90 && performance.now() - a > 12 && ++costly > 25) { running = false; paint(0, false); return; } // too slow here: the still picture is kept
        }
        raf = requestAnimationFrame(tick);
      };
      const go = () => { const should = alive && visible && !document.hidden; if (should && !running && costly <= 25) { running = true; raf = requestAnimationFrame(tick); } else if (!should && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; } };
      const io = new IntersectionObserver((e) => { visible = e[e.length - 1]!.isIntersecting; go(); });
      io.observe(canvas);
      document.addEventListener("visibilitychange", go);
      stop = () => { io.disconnect(); document.removeEventListener("visibilitychange", go); };
      go();
    })();
    return () => { alive = false; running = false; if (raf) cancelAnimationFrame(raf); stop(); };

    // what is seen: the still picture, and (when animated) the light on it
    function paint(t: number, animated: boolean) {
      vg.globalCompositeOperation = "source-over"; vg.globalAlpha = 1;
      vg.drawImage(base, 0, 0);
      if (!animated) return;
      vg.globalCompositeOperation = "lighter";
      vg.globalAlpha = 0.1 + 0.24 * (0.5 + 0.5 * Math.sin((t / 5200) * 2 * Math.PI)); // the coasts breathe
      vg.drawImage(glow, 0, 0, COLS, ROWS, 0, 0, W, H);
      const ph = (t % SWEEP_MS) / SWEEP_MS; // a band of light crosses the land, then a pause
      if (ph < SWEEP_SHARE) {
        const pos = -BAND_W + (W + BAND_W) * (ph / SWEEP_SHARE), x0c = Math.floor(pos / K), frac = pos - x0c * K;
        const s0 = Math.max(0, x0c), s1 = Math.min(COLS, x0c + BAND_W / K + 1);
        if (s1 > s0) {
          bandCtx.globalCompositeOperation = "source-over"; bandCtx.clearRect(0, 0, band.width, H);
          bandCtx.drawImage(lit, s0, 0, s1 - s0, ROWS, (s0 - x0c) * K, 0, (s1 - s0) * K, H);
          bandCtx.globalCompositeOperation = "destination-in";
          const gr = bandCtx.createLinearGradient(frac, 0, frac + BAND_W, 0);
          gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.8, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
          bandCtx.fillStyle = gr; bandCtx.fillRect(0, 0, band.width, H);
          vg.globalAlpha = 0.5;
          vg.drawImage(band, x0c * K, 0);
        }
      }
      vg.globalCompositeOperation = "source-over"; vg.lineWidth = 2; vg.strokeStyle = `rgb(${P.free})`;
      const half = (3 * K) / 2;
      dots.forEach((d, i) => { const p = ((t + i * 830) % 2600) / 2600, r = half + 4 + p * half * 4.4; vg.globalAlpha = (1 - p) * 0.8; vg.strokeRect(d.x - r, d.y - r, 2 * r, 2 * r); });
      vg.globalAlpha = 1;
    }
  }, [markers]);

  return <canvas ref={ref} role="img" aria-label={label} data-testid="hero-world" className="block h-full w-full object-contain object-center [image-rendering:pixelated]" />; // the WHOLE planisphere, never cropped to a zone: it is fitted in its frame (the frame is the colour of the ocean)
}

/** A few points of light over the picture (deterministic: the server and the browser agree). */
export function Sparks({ n = 28, seed = 9 }: { n?: number; seed?: number }) {
  const R = rng(seed);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`spark${R() < 0.45 ? " c" : ""}`} style={{ left: `${(R() * 100).toFixed(1)}%`, top: `${(R() * 100).toFixed(1)}%`, animationDelay: `${(R() * 4).toFixed(2)}s`, animationDuration: `${(2.4 + R() * 3).toFixed(2)}s` }} />
      ))}
    </div>
  );
}
