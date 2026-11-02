"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { clampLevel, fitScale, formatLevel, levelsFor } from "@/lib/editor/zoom";

/**
 * The shared canvas of a parcel. Everything the people holding the link paint is sent to the server in small batches and
 * everyone else's strokes are fetched back by polling ("what changed after version N"), so any number of browsers see the
 * same drawing a moment later. No account, no WebSocket: plain requests, easy to scale and to limit.
 */
const PALETTE = ["#17151f", "#ffffff", "#ff4d2e", "#ff9f1c", "#ffd23f", "#12b886", "#0b7a5a", "#2b35e0", "#5bc0eb", "#9b5de5", "#f15bb5", "#8d6e63", "#c9c1ae", "#6b6b78", "#fbf5e6", "#c9dfe8"];
const POLL_MS = 2000;
const FLUSH_MS = 350;
const BATCH = 2000;
/** Brush thickness in PIXELS, among the sizes that are a whole number of dots at this precision (0.1 px is one dot at 10 dots per pixel). */
const BRUSH_PX = [0.1, 0.2, 0.5, 1, 2, 3, 5, 8];
const brushesFor = (k: number) => BRUSH_PX.filter((b) => Math.abs(b * k - Math.round(b * k)) < 1e-9 && b * k >= 1);

type Tool = "pencil" | "hand";

/** `w` × `h` are the parcel's pixels; the canvas is `scale` times finer: every pixel holds scale × scale dots (up to 10 × 10), the finest brush paints one. */
export function DrawBoard({ token, w: parcelW, h: parcelH, scale, baseAssetId }: { token: string; w: number; h: number; scale: number; baseAssetId: string | null }) {
  const t = useTranslations("draw");
  const f = useFormatter();
  const w = parcelW * scale, h = parcelH * scale; // everything below is counted in dots
  const view = useRef<HTMLCanvasElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  /** What is on screen: the approved creation (or white) with every stroke on top. */
  const image = useRef<ImageData | null>(null);
  /** The creation alone, to go back to when the owner resets the drawing. */
  const base = useRef<Uint8ClampedArray | null>(null);
  /** Which pixels carry a stroke (for the counter only). */
  const painted = useRef<Uint8Array>(new Uint8Array(w * h));
  const count = useRef(0);
  /** Strokes not yet acknowledged by the server: pixel index → colour. They stay on top of whatever arrives meanwhile. */
  const pending = useRef(new Map<number, number>());
  const version = useRef(0);
  const [ready, setReady] = useState(false);
  const [closed, setClosed] = useState(false);
  const [online, setOnline] = useState(true);
  const [slow, setSlow] = useState(false);
  const [n, setN] = useState(0);
  const [color, setColor] = useState(PALETTE[2]!);
  const [brush, setBrush] = useState(1); // px
  const [tool, setTool] = useState<Tool>("pencil");
  // View zoom: 1× = the whole canvas in the available space; `fit` is the size of a dot (screen px) at 1×, `level` the multiple
  const [fit, setFit] = useState(() => 720 / Math.max(w, h));
  const [level, setLevel] = useState(1);
  const levels = useMemo(() => levelsFor(fit), [fit]);
  const zoom = clampLevel(level, levels);
  const dotPx = fit * zoom;
  const keepCentre = useRef<{ fx: number; fy: number } | null>(null);
  const drag = useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);

  const draw = useCallback((x: number, y: number, w1 = 1, h1 = 1) => {
    const c = view.current?.getContext("2d");
    if (c && image.current) c.putImageData(image.current, 0, 0, x, y, w1, h1);
  }, []);
  const redrawAll = useCallback(() => draw(0, 0, w, h), [draw, w, h]);

  const setPixel = useCallback((i: number, rgb: number, countIt: boolean) => {
    const d = image.current!.data, o = i * 4;
    d[o] = (rgb >> 16) & 255; d[o + 1] = (rgb >> 8) & 255; d[o + 2] = rgb & 255; d[o + 3] = 255;
    if (countIt && !painted.current[i]) { painted.current[i] = 1; count.current++; }
  }, []);

  /* ---------- start: the approved creation underneath, then every stroke so far ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const data = new ImageData(w, h);
      data.data.fill(255); // white until (and unless) a creation is loaded
      if (baseAssetId) {
        try {
          const bmp = await createImageBitmap(await (await fetch(`/api/assets/${baseAssetId}`)).blob());
          const c = Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d")!;
          c.imageSmoothingEnabled = false; // a creation at the parcel's own resolution is enlarged without blur
          c.drawImage(bmp, 0, 0, w, h);
          data.data.set(c.getImageData(0, 0, w, h).data);
        } catch { /* the creation could not be loaded: draw on white */ }
      }
      if (!alive) return;
      image.current = data;
      base.current = new Uint8ClampedArray(data.data);
      redrawAll();
      setReady(true);
    })();
    return () => { alive = false; };
  }, [w, h, baseAssetId, redrawAll]);

  /* ---------- everyone else's strokes ---------- */
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = (p: number[]) => {
      for (let k = 0; k < p.length; k += 3) setPixel(p[k + 1]! * w + p[k]!, p[k + 2]!, true);
      for (const [i, rgb] of pending.current) setPixel(i, rgb, false); // my own unsent strokes stay on top
      redrawAll();
      setN(count.current);
    };
    const poll = async () => {
      let wait = POLL_MS;
      try {
        const r = await fetch(`/api/draw/${token}?since=${version.current}`, { cache: "no-store" });
        if (!alive) return;
        if (r.status === 404) { setClosed(true); return; }
        if (r.status === 429) { setSlow(true); wait = 5000; }
        else if (r.ok) {
          const j = (await r.json()) as { p: number[]; version: number; more: boolean; reset: boolean };
          if (j.reset) { image.current!.data.set(base.current!); painted.current.fill(0); count.current = 0; }
          apply(j.p);
          version.current = j.version;
          setOnline(true); setSlow(false);
          if (j.more) wait = 0;
        } else setOnline(false);
      } catch { if (alive) setOnline(false); }
      if (alive) timer = setTimeout(poll, document.hidden ? 8000 : wait);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [ready, token, w, setPixel, redrawAll]);

  /* ---------- my strokes, sent in small batches ---------- */
  useEffect(() => {
    if (!ready) return;
    let busy = false;
    let pause = 0;
    const id = setInterval(async () => {
      if (busy || Date.now() < pause || pending.current.size === 0) return;
      busy = true;
      const sent = [...pending.current].slice(0, BATCH);
      const body = JSON.stringify({ p: sent.flatMap(([i, rgb]) => [i % w, Math.floor(i / w), rgb]) });
      try {
        const r = await fetch(`/api/draw/${token}/pixels`, { method: "POST", headers: { "content-type": "application/json" }, body });
        if (r.status === 404) setClosed(true);
        else if (r.status === 429) { setSlow(true); pause = Date.now() + 4000; }
        else {
          if (r.ok) setSlow(false);
          for (const [i, rgb] of sent) if (pending.current.get(i) === rgb) pending.current.delete(i); // unless painted again meanwhile
        }
      } catch { setOnline(false); pause = Date.now() + 3000; }
      busy = false;
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, [ready, token, w]);

  /* ---------- painting ---------- */
  const rgbInt = useMemo(() => parseInt(color.slice(1), 16), [color]);
  const at = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * w), y: Math.floor(((e.clientY - r.top) / r.height) * h) };
  };
  const stamp = (cx: number, cy: number) => {
    const size = Math.max(1, Math.round(brush * scale)); // dots
    const o = Math.floor(size / 2);
    const x0 = Math.max(0, cx - o), y0 = Math.max(0, cy - o), x1 = Math.min(w, cx - o + size), y1 = Math.min(h, cy - o + size);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { setPixel(y * w + x, rgbInt, true); pending.current.set(y * w + x, rgbInt); }
    if (x1 > x0 && y1 > y0) draw(x0, y0, x1 - x0, y1 - y0);
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => { // Bresenham: no gaps in a fast stroke
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      stamp(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const onDown = (e: React.PointerEvent) => {
    if (!ready || closed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "hand") { drag.current = { x: e.clientX, y: e.clientY, sx: holder.current!.scrollLeft, sy: holder.current!.scrollTop }; return; }
    const p = at(e);
    stamp(p.x, p.y);
    setN(count.current);
    drag.current = { x: p.x, y: p.y, sx: 0, sy: 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (tool === "hand") { holder.current!.scrollLeft = d.sx - (e.clientX - d.x); holder.current!.scrollTop = d.sy - (e.clientY - d.y); return; }
    const p = at(e);
    line(d.x, d.y, p.x, p.y);
    d.x = p.x; d.y = p.y;
    setN(count.current);
  };
  const onUp = () => { drag.current = null; };

  /* 1× shows the whole canvas, whatever the parcel's size; the space is measured again when it changes */
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth > 0) setFit(fitScale(w, h, Math.min(el.clientWidth, 720), Math.min(600, window.innerHeight * 0.65))); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [w, h]);
  const zi = levels.indexOf(zoom);
  const zoomTo = (l: number) => {
    const hd = holder.current;
    if (hd) keepCentre.current = { fx: (hd.scrollLeft + hd.clientWidth / 2) / (w * dotPx), fy: (hd.scrollTop + hd.clientHeight / 2) / (h * dotPx) };
    setLevel(l);
  };
  useLayoutEffect(() => { // after a zoom, keep looking at the same spot
    const hd = holder.current, c = keepCentre.current;
    if (!hd || !c) return;
    hd.scrollLeft = c.fx * w * dotPx - hd.clientWidth / 2;
    hd.scrollTop = c.fy * h * dotPx - hd.clientHeight / 2;
    keepCentre.current = null;
  }, [dotPx, w, h]);

  if (closed) return <p role="alert" className="card p-6 text-center font-semibold" data-testid="draw-closed-live">{t("closedTitle")}</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div ref={outer}>
        <div ref={holder} className="mx-auto max-h-[70vh] overflow-auto rounded-xl bg-white shadow-[0_0_0_1.5px_var(--color-line)]" style={{ maxWidth: Math.max(w * dotPx, 120) }} data-testid="draw-holder">
          <canvas ref={view} width={w} height={h} aria-label={t("canvas", { w: parcelW, h: parcelH })} data-testid="draw-canvas" data-ready={ready}
            className="pixelated block touch-none" style={{ width: w * dotPx, height: h * dotPx, imageRendering: dotPx < 1 ? "auto" : "pixelated", cursor: tool === "hand" ? "grab" : "crosshair" }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-xs text-ink-soft" aria-live="polite">
          <span className="pixel-num">{parcelW} × {parcelH}</span>
          <span data-testid="draw-count">{t("painted", { n: f.number(n) })}</span>
          <span className={online ? "text-[#0b7a5a]" : "text-danger"} data-testid="draw-status">{online ? `● ${t("live")}` : t("reconnecting")}</span>
        </p>
        {slow && <p role="status" className="mt-2 text-center text-xs font-semibold text-warn">{t("slow")}</p>}
      </div>

      <div className="space-y-4 text-sm">
        <section aria-label={t("palette")}>
          <div className="grid grid-cols-8 gap-1.5 lg:grid-cols-4" role="group">
            {PALETTE.map((c) => (
              <button key={c} aria-label={c} aria-pressed={color === c} onClick={() => { setColor(c); setTool("pencil"); }}
                className="aspect-square rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15),0_2px_0_rgb(31_37_64/0.12)]" style={{ background: c, outline: color === c ? "3px solid var(--color-cobalt)" : "none", outlineOffset: 1 }} />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="color" aria-label={t("customColor")} value={color} onChange={(e) => { setColor(e.target.value); setTool("pencil"); }} className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0" />
            <label className="label !mb-0 flex-1" htmlFor="dr-brush">{t("brush")}</label>
            <select id="dr-brush" className="field !min-h-9 !w-28 !py-1" value={brush} onChange={(e) => setBrush(Number(e.target.value))}>
              {brushesFor(scale).map((b) => <option key={b} value={b}>{f.number(b)} px</option>)}
            </select>
          </div>
        </section>

        <section className="space-y-2">
          <div role="radiogroup" aria-label="tool" className="grid grid-cols-2 gap-1">
            <button role="radio" aria-checked={tool === "pencil"} onClick={() => setTool("pencil")} className={`btn btn-sm btn-ghost`}>✎ {t("pencil")}</button>
            <button role="radio" aria-checked={tool === "hand"} onClick={() => setTool("hand")} className={`btn btn-sm btn-ghost`}>✥ {t("hand")}</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="label !mb-0 flex-1">{t("zoom")}</span>
            <button className="btn btn-ghost btn-sm !w-9 !px-0" aria-label={t("zoomOut")} disabled={zi <= 0} onClick={() => zoomTo(levels[zi - 1]!)}>−</button>
            <span className="pixel-num w-10 text-center" data-testid="draw-zoom" title={t("zoomHint")}>{formatLevel(zoom)}</span>
            <button className="btn btn-ghost btn-sm !w-9 !px-0" aria-label={t("zoomIn")} disabled={zi >= levels.length - 1} onClick={() => zoomTo(levels[zi + 1]!)}>+</button>
          </div>
        </section>
      </div>
    </div>
  );
}
