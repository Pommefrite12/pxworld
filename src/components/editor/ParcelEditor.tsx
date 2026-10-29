"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export interface ParcelEditorHandle {
  /** Final raster at the parcel's EXACT resolution (w × h) — what the server stores, byte for byte after canonical re-encoding. */
  exportPng(): Promise<Blob>;
  hasContent(): boolean;
}

interface Props {
  w: number;
  h: number;
  /** Existing creation to start from (editing an owned parcel). */
  initialImageUrl?: string | null;
  onChange?: (hasContent: boolean) => void;
}

type Tool = "move" | "pencil" | "eraser" | "fill" | "text";
type Fit = "cover" | "contain" | "stretch";

const PALETTE = ["#17151f", "#ffffff", "#ff4d2e", "#ff9f1c", "#ffd23f", "#12b886", "#0b7a5a", "#2b35e0", "#5bc0eb", "#9b5de5", "#f15bb5", "#8d6e63", "#c9c1ae", "#6b6b78", "#fbf5e6", "#c9dfe8"];
const MAX_FILE = 10 * 1024 * 1024;

interface Photo { bitmap: ImageBitmap; fit: Fit; zoom: number; ox: number; oy: number; smooth: boolean }
interface TextLayer { value: string; size: number; color: string; x: number; y: number; bold: boolean }

const hexToRgba = (hex: string): [number, number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];

export const ParcelEditor = forwardRef<ParcelEditorHandle, Props>(function ParcelEditor({ w, h, initialImageUrl, onChange }, ref) {
  const t = useTranslations("editor");
  const view = useRef<HTMLCanvasElement>(null);
  const paint = useRef<HTMLCanvasElement | null>(null);
  const undo = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(PALETTE[2]!);
  const [brush, setBrush] = useState(1);
  const [bg, setBg] = useState<string | null>("#ffffff");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [text, setText] = useState<TextLayer | null>(null);
  const [painted, setPainted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoCount, setUndoCount] = useState(0);
  const drag = useRef<{ kind: "paint" | "photo" | "text"; lx: number; ly: number; sx: number; sy: number; base: { ox: number; oy: number } } | null>(null);

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
    ctx.clearRect(0, 0, w, h);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
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
      const p = ensurePaint(); p.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      setBg(null); setPainted(true); setUndoCount((n) => n + 1);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [initialImageUrl, ensurePaint, w, h]);

  useImperativeHandle(ref, () => ({
    hasContent: () => hasContent,
    exportPng: () => new Promise<Blob>((resolve, reject) => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      compose(c.getContext("2d")!);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png");
    }),
  }), [compose, hasContent, w, h]);

  const pushUndo = () => {
    const p = ensurePaint();
    undo.current.push(p.getContext("2d")!.getImageData(0, 0, w, h));
    if (undo.current.length > 30) undo.current.shift();
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

  const stamp = (x: number, y: number) => {
    const ctx = ensurePaint().getContext("2d")!;
    const o = Math.floor(brush / 2);
    if (tool === "eraser") ctx.clearRect(x - o, y - o, brush, brush);
    else { ctx.fillStyle = color; ctx.fillRect(x - o, y - o, brush, brush); }
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => { // Bresenham: no gaps in fast strokes
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

  const floodFill = (x: number, y: number) => {
    const ctx = ensurePaint().getContext("2d")!;
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const idx = (px: number, py: number) => (py * w + px) * 4;
    const i0 = idx(x, y);
    const target = [d[i0]!, d[i0 + 1]!, d[i0 + 2]!, d[i0 + 3]!];
    const fill = hexToRgba(color);
    if (target.every((v, i) => v === fill[i])) return;
    const same = (i: number) => d[i] === target[0] && d[i + 1] === target[1] && d[i + 2] === target[2] && d[i + 3] === target[3];
    const stack = [[x, y]] as [number, number][];
    while (stack.length) {
      const [px, py] = stack.pop()!;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = idx(px, py);
      if (!same(i)) continue;
      d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    ctx.putImageData(img, 0, 0);
  };

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    if (tool === "pencil" || tool === "eraser") {
      pushUndo(); stamp(x, y); setPainted(true); setUndoCount(undo.current.length);
      drag.current = { kind: "paint", lx: x, ly: y, sx: x, sy: y, base: { ox: 0, oy: 0 } };
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
    const { x, y } = pos(e);
    if (d.kind === "paint") { line(d.lx, d.ly, x, y); d.lx = x; d.ly = y; setUndoCount((n) => n); const ctx = view.current!.getContext("2d")!; compose(ctx); }
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

  const zoomPx = useMemo(() => Math.max(1, Math.min(16, Math.floor(480 / Math.max(w, h)))), [w, h]);
  const tools: { id: Tool; label: string; icon: string; disabled?: boolean }[] = [
    { id: "pencil", label: t("tools.pencil"), icon: "✎" },
    { id: "eraser", label: t("tools.eraser"), icon: "⌫" },
    { id: "fill", label: t("tools.fill"), icon: "▨" },
    { id: "move", label: t("tools.move"), icon: "✥", disabled: !photo },
    { id: "text", label: t("tools.text"), icon: "T", disabled: !text },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div className="checker relative mx-auto overflow-hidden rounded-xl shadow-[0_0_0_1.5px_var(--color-line)]" style={{ width: "100%", maxWidth: w * zoomPx, aspectRatio: `${w} / ${h}` }}>
          <canvas
            ref={view} width={w} height={h} aria-label={t("canvasLabel", { w, h })}
            className="pixelated block h-full w-full touch-none"
            style={{ cursor: tool === "move" ? "move" : tool === "text" ? "grab" : "crosshair" }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          />
        </div>
        <p className="mt-2 text-center text-xs text-ink-soft"><span className="pixel-num">{w} × {h}</span> — {t("exactRes")}</p>
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
                    className={`btn btn-sm flex-1 ${photo.fit === f ? "btn-ink" : "btn-ghost"}`}>{t(`fit.${f}`)}</button>
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
          <div role="radiogroup" aria-label={t("tools.label")} className="grid grid-cols-5 gap-1">
            {tools.map((x) => (
              <button key={x.id} role="radio" aria-checked={tool === x.id} disabled={x.disabled} title={x.label} aria-label={x.label} onClick={() => setTool(x.id)}
                className={`btn btn-sm !px-0 text-base ${tool === x.id ? "btn-ink" : "btn-ghost"}`}>{x.icon}</button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-8 gap-1.5" role="group" aria-label={t("palette")}>
            {PALETTE.map((c) => (
              <button key={c} aria-label={c} aria-pressed={color === c} onClick={() => { setColor(c); if (tool === "eraser" || tool === "move") setTool("pencil"); if (text) setText({ ...text, color: c }); }}
                className="aspect-square rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: c, outline: color === c ? "3px solid var(--color-cobalt)" : "none", outlineOffset: 1 }} />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="color" aria-label={t("customColor")} value={color} onChange={(e) => { setColor(e.target.value); if (text) setText({ ...text, color: e.target.value }); }} className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0" />
            <label className="label !mb-0 flex-1" htmlFor="ed-brush">{t("brush")}</label>
            <select id="ed-brush" className="field !min-h-9 !w-20 !py-1" value={brush} onChange={(e) => setBrush(Number(e.target.value))}>
              {[1, 2, 3, 5, 8].map((b) => <option key={b} value={b}>{b} px</option>)}
            </select>
          </div>
        </section>

        <section aria-label={t("text.label")}>
          {text ? (
            <div className="space-y-2 rounded-xl bg-paper-2 p-3">
              <input className="field" value={text.value} maxLength={40} aria-label={t("text.label")} onChange={(e) => setText({ ...text, value: e.target.value })} placeholder={t("text.placeholder")} />
              <div className="flex items-center gap-2">
                <label className="label !mb-0" htmlFor="ed-ts">{t("text.size")}</label>
                <input id="ed-ts" type="range" min={6} max={Math.max(12, Math.min(96, h))} value={text.size} onChange={(e) => setText({ ...text, size: Number(e.target.value) })} className="flex-1 accent-signal" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={text.bold} onChange={(e) => setText({ ...text, bold: e.target.checked })} />B</label>
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
          <button className={`btn btn-sm ${bg === null ? "btn-ink" : "btn-ghost"}`} onClick={() => setBg(null)}>{t("transparent")}</button>
          <input type="color" aria-label={t("background")} value={bg ?? "#ffffff"} onChange={(e) => setBg(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0" />
        </section>

        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm flex-1" onClick={doUndo} disabled={undoCount === 0}>{t("undo")}</button>
          <button className="btn btn-ghost btn-sm flex-1" onClick={clearAll} disabled={!hasContent && bg === "#ffffff"}>{t("clear")}</button>
        </div>
      </div>
    </div>
  );
});
