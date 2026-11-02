"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { clampLevel, fitScale, formatLevel, levelsFor } from "@/lib/editor/zoom";
import { creationScale } from "@/lib/grid/constants";
import { PALETTE, mixColor, strokeRun } from "@/lib/editor/colors";
import { Palette, Swatches } from "./Palette";

export interface ParcelEditorHandle {
  /** Final raster at the editor's full precision (w·k × h·k, every pixel = k × k dots) — what the server stores, after canonical re-encoding. */
  exportPng(): Promise<Blob>;
  hasContent(): boolean;
}

interface Props {
  /** The parcel's size in PIXELS. The drawing itself is k × finer (k dots per pixel, up to 10: a tenth of a pixel): `exportPng` returns w·k × h·k. */
  w: number;
  h: number;
  /** Existing creation to start from (editing an owned parcel). */
  initialImageUrl?: string | null;
  onChange?: (hasContent: boolean) => void;
}

type Tool = "move" | "pencil" | "eraser" | "fill" | "text" | "hand";
type Fit = "cover" | "contain" | "stretch";

const MAX_FILE = 10 * 1024 * 1024;
/** Brush thickness in PIXELS, among the sizes that are a whole number of dots at this precision (0.1 px is one dot when k = 10). */
const BRUSH_PX = [0.1, 0.2, 0.5, 1, 2, 3, 5, 8];
const brushesFor = (k: number) => BRUSH_PX.filter((b) => Math.abs(b * k - Math.round(b * k)) < 1e-9 && b * k >= 1);
/** A very detailed picture can outgrow the upload limit at full precision: it is then sent at a lower precision. */
const MAX_PNG_BYTES = 2.8 * 1024 * 1024;
/** Undo snapshots are full copies of the canvas: keep their total memory bounded whatever the precision. */
const UNDO_BUDGET_BYTES = 96 * 1024 * 1024;
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png"));

interface Photo { bitmap: ImageBitmap; fit: Fit; zoom: number; ox: number; oy: number; smooth: boolean }
interface TextLayer { value: string; size: number; color: string; x: number; y: number; bold: boolean }

const hexToRgba = (hex: string): [number, number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

export const ParcelEditor = forwardRef<ParcelEditorHandle, Props>(function ParcelEditor({ w: pw, h: ph, initialImageUrl, onChange }, ref) {
  const t = useTranslations("editor");
  const f = useFormatter();
  const S = creationScale(pw, ph); // dots per pixel side
  const w = pw * S, h = ph * S; // everything below works in dots
  const brushes = useMemo(() => brushesFor(S), [S]);
  const outer = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  // View zoom: 1× = the whole parcel in the available space; `fit` is the size of a dot (screen px) at 1×, `level` the multiple
  const [fit, setFit] = useState(() => 640 / Math.max(w, h));
  const [level, setLevel] = useState(1);
  const levels = useMemo(() => levelsFor(fit), [fit]);
  const zoom = clampLevel(level, levels); // the level actually shown
  const dotPx = fit * zoom;
  const keepCentre = useRef<{ fx: number; fy: number } | null>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const paint = useRef<HTMLCanvasElement | null>(null);
  const undo = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(PALETTE[2]!);
  // multicolour brush: the stroke runs through `mix`, one brush width of each colour at a time (the text has its own colour)
  const [multi, setMulti] = useState(false);
  const [mix, setMix] = useState<string[]>([PALETTE[2]!]);
  const [brush, setBrush] = useState(1); // px (1 px is a whole number of dots at every precision)
  const [bg, setBg] = useState("#ffffff"); // always an opaque colour: a creation has no transparent pixel
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [text, setText] = useState<TextLayer | null>(null);
  const [painted, setPainted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const drag = useRef<{ kind: "paint" | "photo" | "text" | "pan"; lx: number; ly: number; sx: number; sy: number; base: { ox: number; oy: number }; /** dots painted so far in this stroke (decides the colour of a multicolour one) */ n?: number } | null>(null);

  const hasContent = Boolean(photo || painted || text?.value);
  useEffect(() => onChange?.(hasContent), [hasContent, onChange]);

  // the canvas needs the pixel font loaded before it can draw text with it
  useEffect(() => { void document.fonts?.load('16px "Jersey 10"').then(() => setUndoCount((n) => n)); }, []);

  const ensurePaint = useCallback(() => {
    if (!paint.current) { const c = document.createElement("canvas"); c.width = w; c.height = h; paint.current = c; }
    return paint.current;
  }, [w, h]);

  /** Composite = background → photo → drawing → text. Pure function of the editor state. */
  const compose = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (photo) {
      const { bitmap: b, fit, zoom, ox, oy, smooth } = photo;
      const base = fit === "cover" ? Math.max(w / b.width, h / b.height) : fit === "contain" ? Math.min(w / b.width, h / b.height) : 0;
      const sx = fit === "stretch" ? (w / b.width) * zoom : base * zoom, sy = fit === "stretch" ? (h / b.height) * zoom : base * zoom;
      const dw = b.width * sx, dh = b.height * sy;
      ctx.imageSmoothingEnabled = smooth;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(b, (w - dw) / 2 + ox, (h - dh) / 2 + oy, dw, dh);
    }
    if (paint.current) { ctx.imageSmoothingEnabled = false; ctx.drawImage(paint.current, 0, 0); }
    if (text?.value) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = text.color;
      ctx.textBaseline = "top";
      ctx.font = `${text.bold ? 600 : 500} ${text.size}px "Jersey 10", ui-monospace, monospace`;
      ctx.fillText(text.value, text.x, text.y);
    }
  }, [w, h, bg, photo, text]);

  useEffect(() => {
    const c = view.current;
    const ctx = c?.getContext("2d");
    if (ctx) compose(ctx);
  }, [compose, painted, undoCount]);

  // Start from an existing creation when editing.
  useEffect(() => {
    if (!initialImageUrl) return;
    let alive = true;
    fetch(initialImageUrl).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((bmp) => {
      if (!alive) return;
      const p = ensurePaint(); const pc = p.getContext("2d")!;
      pc.imageSmoothingEnabled = false; // an older creation (1 pixel = 1 dot) is enlarged without blur
      pc.drawImage(bmp, 0, 0, w, h);
      setPainted(true); setUndoCount((n) => n + 1); // pixels the old image left empty show the (white) background
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [initialImageUrl, ensurePaint, w, h]);

  useImperativeHandle(ref, () => ({
    hasContent: () => hasContent,
    exportPng: async () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      compose(c.getContext("2d")!);
      let blob = await toBlob(c);
      // a very detailed picture can outgrow the upload limit: send it at a lower precision (half the dots, then half again…)
      for (let k = Math.floor(S / 2); blob.size > MAX_PNG_BYTES && k >= 1; k = Math.floor(k / 2)) {
        const small = document.createElement("canvas"); small.width = pw * k; small.height = ph * k;
        const sc = small.getContext("2d")!; sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = "high";
        sc.drawImage(c, 0, 0, small.width, small.height);
        blob = await toBlob(small);
        if (k === 1) break;
      }
      return blob;
    },
  }), [compose, hasContent, w, h, pw, ph, S]);

  const pushUndo = () => {
    const p = ensurePaint();
    undo.current.push(p.getContext("2d")!.getImageData(0, 0, w, h));
    const keep = Math.max(3, Math.min(30, Math.floor(UNDO_BUDGET_BYTES / (w * h * 4)))); // every snapshot is a full copy of the canvas
    while (undo.current.length > keep) undo.current.shift();
    setUndoCount(undo.current.length);
  };
  const doUndo = () => {
    const snap = undo.current.pop();
    if (!snap) return;
    ensurePaint().getContext("2d")!.putImageData(snap, 0, 0);
    setUndoCount(undo.current.length);
    setPainted(undo.current.length > 0 || false);
  };

  const pos = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * w), y: Math.floor(((e.clientY - r.top) / r.height) * h) };
  };

  const brushDots = Math.max(1, Math.round(brush * S));
  /** Colour of the n-th dot of a stroke: the colour, or the next one of the mix every brush width. */
  const colourAt = (n: number) => (multi ? mixColor(mix, n, strokeRun(brushDots, S)) : color);
  const stamp = (x: number, y: number, colour: string) => {
    const ctx = ensurePaint().getContext("2d")!;
    const size = brushDots; // dots
    const o = Math.floor(size / 2);
    if (tool === "eraser") ctx.clearRect(x - o, y - o, size, size);
    else { ctx.fillStyle = colour; ctx.fillRect(x - o, y - o, size, size); }
  };
  /** Bresenham: no gaps in fast strokes. The start point was painted already; every further dot counts towards the colour. */
  const line = (x0: number, y0: number, x1: number, y1: number, d: { n?: number }) => {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (x0 !== x1 || y0 !== y1) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      stamp(x0, y0, colourAt(d.n ?? 0));
      d.n = (d.n ?? 0) + 1;
    }
  };

  const floodFill = (x: number, y: number) => {
    const ctx = ensurePaint().getContext("2d")!;
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const i0 = (y * w + x) * 4;
    const t0 = d[i0]!, t1 = d[i0 + 1]!, t2 = d[i0 + 2]!, t3 = d[i0 + 3]!;
    const [f0, f1, f2] = hexToRgba(color);
    if (t0 === f0 && t1 === f1 && t2 === f2 && t3 === 255) return;
    // typed arrays: a canvas can hold millions of dots, an array of [x, y] pairs would not survive that
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    stack[top++] = y * w + x; seen[y * w + x] = 1;
    while (top > 0) {
      const p = stack[--top]!;
      const o = p * 4;
      if (d[o] !== t0 || d[o + 1] !== t1 || d[o + 2] !== t2 || d[o + 3] !== t3) continue;
      d[o] = f0; d[o + 1] = f1; d[o + 2] = f2; d[o + 3] = 255;
      const px = p % w, py = (p - px) / w;
      if (px + 1 < w && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (px > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (py + 1 < h && !seen[p + w]) { seen[p + w] = 1; stack[top++] = p + w; }
      if (py > 0 && !seen[p - w]) { seen[p - w] = 1; stack[top++] = p - w; }
    }
    ctx.putImageData(img, 0, 0);
  };

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "hand") { drag.current = { kind: "pan", lx: e.clientX, ly: e.clientY, sx: holder.current!.scrollLeft, sy: holder.current!.scrollTop, base: { ox: 0, oy: 0 } }; return; }
    const { x, y } = pos(e);
    if (tool === "pencil" || tool === "eraser") {
      pushUndo(); stamp(x, y, colourAt(0)); setPainted(true); setUndoCount(undo.current.length);
      drag.current = { kind: "paint", lx: x, ly: y, sx: x, sy: y, base: { ox: 0, oy: 0 }, n: 1 };
    } else if (tool === "fill") {
      pushUndo(); floodFill(x, y); setPainted(true);
    } else if (tool === "move" && photo) {
      drag.current = { kind: "photo", lx: x, ly: y, sx: x, sy: y, base: { ox: photo.ox, oy: photo.oy } };
    } else if (tool === "text" && text) {
      drag.current = { kind: "text", lx: x, ly: y, sx: x, sy: y, base: { ox: text.x, oy: text.y } };
      setText({ ...text, x, y });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") { holder.current!.scrollLeft = d.sx - (e.clientX - d.lx); holder.current!.scrollTop = d.sy - (e.clientY - d.ly); return; }
    const { x, y } = pos(e);
    if (d.kind === "paint") { line(d.lx, d.ly, x, y, d); d.lx = x; d.ly = y; setUndoCount((n) => n); const ctx = view.current!.getContext("2d")!; compose(ctx); }
    else if (d.kind === "photo" && photo) setPhoto({ ...photo, ox: d.base.ox + (x - d.sx), oy: d.base.oy + (y - d.sy) });
    else if (d.kind === "text" && text) setText({ ...text, x: d.base.ox + (x - d.sx), y: d.base.oy + (y - d.sy) });
  };
  const onUp = () => { drag.current = null; };

  const loadFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError(t("errors.type")); return; }
    if (file.size > MAX_FILE) { setError(t("errors.size")); return; }
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      setPhoto({ bitmap, fit: "cover", zoom: 1, ox: 0, oy: 0, smooth: bitmap.width * bitmap.height > w * h * 1.5 });
      setTool("move");
    } catch { setError(t("errors.read")); }
  };

  const clearAll = () => {
    pushUndo();
    ensurePaint().getContext("2d")!.clearRect(0, 0, w, h);
    setPhoto(null); setText(null); setPainted(false); setBg("#ffffff");
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // The space is measured, and measured again when it changes (the editor often opens inside a dialog that is not displayed
  // yet): the whole parcel must be visible at 1×, so a fit is computed from the width and the height available.
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth === 0) return;
      setFit(fitScale(w, h, Math.min(el.clientWidth, 640), Math.min(560, window.innerHeight * 0.62)));
    };
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
  // after a zoom, keep looking at the same spot of the canvas
  useLayoutEffect(() => {
    const hd = holder.current, c = keepCentre.current;
    if (!hd || !c) return;
    hd.scrollLeft = c.fx * w * dotPx - hd.clientWidth / 2;
    hd.scrollTop = c.fy * h * dotPx - hd.clientHeight / 2;
    keepCentre.current = null;
  }, [dotPx, w, h]);

  const tools: { id: Tool; label: string; icon: string; disabled?: boolean }[] = [
    { id: "pencil", label: t("tools.pencil"), icon: "✎" },
    { id: "eraser", label: t("tools.eraser"), icon: "⌫" },
    { id: "fill", label: t("tools.fill"), icon: "▨" },
    { id: "move", label: t("tools.move"), icon: "✥", disabled: !photo },
    { id: "text", label: t("tools.text"), icon: "T", disabled: !text },
    { id: "hand", label: t("tools.hand"), icon: "✋" },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div ref={outer}>
        <div ref={holder} className="mx-auto max-h-[70vh] overflow-auto rounded-xl bg-white shadow-[0_0_0_1.5px_var(--color-line)]" style={{ maxWidth: w * dotPx }} data-testid="editor-holder">
          <canvas
            ref={view} width={w} height={h} aria-label={t("canvasLabel", { w: pw, h: ph })}
            className="pixelated block touch-none"
            style={{ width: w * dotPx, height: h * dotPx, imageRendering: dotPx < 1 ? "auto" : "pixelated", cursor: tool === "hand" || tool === "text" ? "grab" : tool === "move" ? "move" : "crosshair" }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          />
        </div>
        <div className="mt-2 flex items-center justify-center gap-2">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t("zoomOut")} disabled={zi <= 0} onClick={() => zoomTo(levels[zi - 1]!)}>−</button>
          <span className="pixel-num w-12 text-center text-sm" data-testid="editor-zoom" aria-label={t("viewZoom")} title={t("viewZoomHint")}>{formatLevel(zoom)}</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t("zoomIn")} disabled={zi >= levels.length - 1} onClick={() => zoomTo(levels[zi + 1]!)}>+</button>
        </div>
      </div>

      <div className="space-y-4 text-sm">
        <section aria-label={t("image")}>
          <label className="btn btn-ink w-full cursor-pointer">
            {t("upload")}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <p className="mt-1.5 text-xs text-ink-faint">{t("uploadHint")}</p>
          {error && <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">{error}</p>}
          {photo && (
            <div className="mt-3 space-y-2 rounded-xl bg-paper-2 p-3">
              <div role="radiogroup" aria-label={t("fit.label")} className="flex gap-1">
                {(["cover", "contain", "stretch"] as Fit[]).map((f) => (
                  <button key={f} role="radio" aria-checked={photo.fit === f} onClick={() => setPhoto({ ...photo, fit: f, ox: 0, oy: 0, zoom: 1 })}
                    className={`btn btn-sm flex-1 btn-ghost`}>{t(`fit.${f}`)}</button>
                ))}
              </div>
              <label className="label" htmlFor="ed-zoom">{t("zoom")}</label>
              <input id="ed-zoom" type="range" min={0.2} max={6} step={0.05} value={photo.zoom} onChange={(e) => setPhoto({ ...photo, zoom: Number(e.target.value) })} className="w-full accent-signal" />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={photo.smooth} onChange={(e) => setPhoto({ ...photo, smooth: e.target.checked })} /> {t("smooth")}</label>
              <button className="text-xs font-semibold text-danger underline" onClick={() => setPhoto(null)}>{t("removeImage")}</button>
            </div>
          )}
        </section>

        <section aria-label={t("tools.label")}>
          <div role="radiogroup" aria-label={t("tools.label")} className="grid grid-cols-6 gap-1">
            {tools.map((x) => (
              <button key={x.id} role="radio" aria-checked={tool === x.id} disabled={x.disabled} title={x.label} aria-label={x.label} onClick={() => setTool(x.id)}
                className={`btn btn-sm !px-0 text-base btn-ghost`}>{x.icon}</button>
            ))}
          </div>
          <Palette
            color={color} onColor={(c) => { setColor(c); if (tool === "eraser" || tool === "move" || tool === "text") setTool("pencil"); }}
            multi={multi} onMulti={setMulti} mix={mix} onMix={setMix}
            labels={{ palette: t("palette"), customColor: t("customColor"), multi: t("multi"), multiHint: t("multiHint") }}
          >
            <label className="label !mb-0 flex-1" htmlFor="ed-brush">{t("brush")}</label>
            <select id="ed-brush" className="field !min-h-9 !w-28 !py-1" value={brush} onChange={(e) => setBrush(Number(e.target.value))}>
              {brushes.map((b) => <option key={b} value={b}>{f.number(b)} px</option>)}
            </select>
          </Palette>
        </section>

        <section aria-label={t("text.label")}>
          {text ? (
            <div className="space-y-2 rounded-xl bg-paper-2 p-3">
              <input className="field" value={text.value} maxLength={40} aria-label={t("text.label")} onChange={(e) => setText({ ...text, value: e.target.value })} placeholder={t("text.placeholder")} />
              <div className="flex items-center gap-2">
                <label className="label !mb-0" htmlFor="ed-ts">{t("text.size")}</label>
                <input id="ed-ts" type="range" min={Math.max(6, S)} max={Math.max(12, Math.min(400, h))} value={text.size} onChange={(e) => setText({ ...text, size: Number(e.target.value) })} className="flex-1 accent-signal" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={text.bold} onChange={(e) => setText({ ...text, bold: e.target.checked })} />B</label>
              </div>
              <div>
                <p className="label">{t("text.color")}</p>
                <Swatches selected={[text.color]} onPick={(c) => setText({ ...text, color: c })} label={t("text.color")} name={(c) => `${t("text.color")} ${c}`} />
                <input type="color" aria-label={t("text.customColor")} value={text.color} onChange={(e) => setText({ ...text, color: e.target.value })} className="mt-2 h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0" />
              </div>
              <p className="text-xs text-ink-faint">{t("text.hint")}</p>
              <button className="text-xs font-semibold text-danger underline" onClick={() => setText(null)}>{t("text.remove")}</button>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm w-full" onClick={() => { setText({ value: "", size: Math.max(8, Math.round(h / 5)), color, x: 2, y: 2, bold: true }); setTool("text"); }}>{t("text.add")}</button>
          )}
        </section>

        <section aria-label={t("background")} className="flex items-center gap-2">
          <span className="label !mb-0 flex-1">{t("background")}</span>
          <input type="color" aria-label={t("background")} value={bg} onChange={(e) => setBg(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0" />
        </section>

        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm flex-1" onClick={doUndo} disabled={undoCount === 0}>{t("undo")}</button>
          <button className="btn btn-ghost btn-sm flex-1" onClick={clearAll} disabled={!hasContent && bg === "#ffffff"}>{t("clear")}</button>
        </div>
      </div>
    </div>
  );
});
