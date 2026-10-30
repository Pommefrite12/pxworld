"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { MapEngine, type EngineCallbacks } from "./engine";

export interface MapViewHandle { engine: MapEngine | null }

interface Props extends EngineCallbacks {
  label: string;
  initialCamera?: { x: number; y: number; scale: number } | null;
  mapVersion: number;
  onReady?: (engine: MapEngine) => void;
}

/** Owns the <canvas> and the engine's lifecycle. All map behaviour lives in engine.ts. */
export const MapView = forwardRef<MapViewHandle, Props>(function MapView({ label, initialCamera, mapVersion, onReady, ...callbacks }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useImperativeHandle(ref, () => ({ get engine() { return engineRef.current; } }), []);

  useEffect(() => {
    const canvas = canvasRef.current!, wrap = wrapRef.current!;
    // Stable proxies so React re-renders never rebuild the engine.
    const engine = new MapEngine(canvas, {
      onCamera: (c) => cbRef.current.onCamera?.(c),
      onHover: (p) => cbRef.current.onHover?.(p),
      onSelectParcel: (p, s) => cbRef.current.onSelectParcel?.(p, s),
      onCursor: (x, y) => cbRef.current.onCursor?.(x, y),
      onPlace: (r) => cbRef.current.onPlace?.(r),
      onSelectionState: (s) => cbRef.current.onSelectionState?.(s),
      onZoomOutToGlobe: (c) => cbRef.current.onZoomOutToGlobe?.(c),
    });
    engineRef.current = engine;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __pxEngine?: MapEngine }).__pxEngine = engine; // debugging / e2e hook (dev only)
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      engine.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2.5));
    };
    fit();
    engine.setVersion(mapVersion);
    if (initialCamera) engine.flyTo(initialCamera, 0);
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    readyRef.current?.(engine);
    return () => { ro.disconnect(); engine.destroy(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { engineRef.current?.setVersion(mapVersion); }, [mapVersion]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-paper">
      <canvas ref={canvasRef} role="application" aria-label={label} tabIndex={0} className="block h-full w-full touch-none select-none outline-offset-[-3px]" style={{ cursor: "grab" }} />
    </div>
  );
});
