"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { GEO, GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { lonLatToPixel, MERCATOR_BOTTOM, MERCATOR_TOP, LON_MIN, pixelToLonLat } from "@/lib/grid/projection";
import { flatScaleForRadius, GLOBE_BASE_FRACTION, GLOBE_HANDOFF_ZOOM, GLOBE_MAX_LAT, GLOBE_MIN_ZOOM, project } from "@/lib/globe/orthographic";
import { loadPlaces, type Places } from "@/components/map/geo";
import { TEXTURE_WIDTH, worldTexture } from "./worldTexture";

/**
 * PROTOTYPE — the planet as a 3D globe. Pure WebGL 2, no library: one full-screen triangle whose fragment shader
 * inverts the orthographic projection for every pixel and reads the flat world (ocean, land, borders — the very same
 * vector data as the flat map, drawn once into a texture). Zoom in and the flat map takes over at the same place.
 */

const INK = "23,21,31";
const FONT = `"Instrument Sans Variable", system-ui, sans-serif`;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uCenter;      // centre of the globe, device px (origin bottom-left)
uniform float uRadius;     // device px
uniform vec2 uView;        // lon0, lat0 (radians)
uniform sampler2D uTex;    // the flat world (grid space)
uniform vec4 uBand;        // west edge (rad), Mercator top, Mercator bottom, grid width
uniform vec3 uGrid;        // grid width, grid height, texture width
uniform vec2 uLat;         // lat min, lat max of the grid (rad)
out vec4 o;
const float PI = 3.14159265358979;
void main() {
  vec2 p = (gl_FragCoord.xy - uCenter) / uRadius;
  float d = length(p);
  float aa = 1.5 / uRadius;
  float h = (1.0 - smoothstep(1.0, 1.16, d)) * 0.5;
  vec4 halo = vec4(vec3(0.55, 0.75, 0.9) * h, h);
  if (d > 1.0 + aa) { o = halo; return; }
  float z = sqrt(max(0.0, 1.0 - d * d));
  vec3 n = vec3(p, z);
  float arcPx = max(length(dFdx(n)), length(dFdy(n)));      // sphere arc covered by one screen pixel
  float sl = sin(uView.y), cl = cos(uView.y);
  float lat = asin(clamp(z * sl + p.y * cl, -1.0, 1.0));
  float lon = uView.x + atan(p.x, z * cl - p.y * sl);
  float cosLat = max(cos(lat), 0.04);
  vec3 col;
  if (lat > uLat.y || lat < uLat.x) {
    // polar caps are outside the pixel grid: sea that fades to ice towards the pole (and Antarctica's ice, roughly)
    vec3 sea = vec3(0.788, 0.875, 0.91), ice = vec3(0.9, 0.94, 0.965);
    float toIce = lat > 0.0 ? smoothstep(uLat.y, uLat.y + 0.1, lat) : smoothstep(-1.08, -1.2, lat);
    col = mix(sea, ice, toIce);
  } else {
    float u = fract((lon - uBand.x) / (2.0 * PI));
    float v = (uBand.y - asinh(tan(lat))) / (uBand.y - uBand.z);
    float lod = log2(max(1.0, uGrid.z / (2.0 * PI) * arcPx / cosLat));
    col = textureLod(uTex, vec2(u, v), lod).rgb;
    // the "pixel field": a dot every 250 grid pixels, fading out when the dots get too small to read
    float spacing = 250.0 * 2.0 * PI / uGrid.x * uRadius * cosLat * z;
    vec2 cell = fract(vec2(u * uGrid.x, v * uGrid.y) / 250.0) - 0.5;
    float dotA = (1.0 - smoothstep(0.07, 0.11, length(cell))) * smoothstep(7.0, 13.0, spacing) * 0.3;
    col = mix(col, vec3(0.09, 0.08, 0.12), dotA);
  }
  col *= 0.78 + 0.22 * pow(z, 0.7);
  col = mix(col, vec3(0.45, 0.6, 0.72), smoothstep(0.9, 1.0, d) * 0.3);
  float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  o = vec4(col, 1.0) * cover + halo * (1.0 - cover);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
  return s;
}

interface State { lon: number; lat: number; zoom: number }
declare global { interface Window { __pxGlobe?: { ready: boolean; state: State; set(lon: number, lat: number, zoom: number): void; handedOff: boolean } } }

export function GlobeView({ initial }: { initial: { lon: number; lat: number; spin: boolean; zoom?: number } }) {
  const t = useTranslations("globe");
  const locale = useLocale();
  const router = useRouter();
  const glRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const api = useRef<{ zoomBy(f: number): void; openFlat(): void } | null>(null);
  const [supported, setSupported] = useState(true);
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<State>({ lon: initial.lon, lat: initial.lat, zoom: initial.zoom ?? 1 });

  const flatHref = useCallback((s: State, r: number) => {
    const p = lonLatToPixel({ lon: s.lon, lat: s.lat });
    return `/?x=${Math.round(p.x)}&y=${Math.round(p.y)}&z=${Number(flatScaleForRadius(r, s.lat).toPrecision(3))}`;
  }, []);

  useEffect(() => {
    const canvas = glRef.current!, labels = labelsRef.current!, wrap = wrapRef.current!;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true, premultipliedAlpha: true });
    if (!gl) { setSupported(false); return; }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link error");
    gl.useProgram(prog);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uCenter = U("uCenter"), uRadius = U("uRadius"), uView = U("uView"), uBand = U("uBand"), uGrid = U("uGrid"), uLat = U("uLat");

    const tex = gl.createTexture();
    const texWidth = Math.min(TEXTURE_WIDTH, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // until the real texture is ready: plain ocean
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([201, 223, 232, 255]));
    gl.uniform1i(U("uTex"), 0);

    const view: State = { lon: initial.lon, lat: initial.lat, zoom: Math.max(GLOBE_MIN_ZOOM, Math.min(GLOBE_HANDOFF_ZOOM - 0.2, initial.zoom ?? GLOBE_MIN_ZOOM)) };
    let spin = initial.spin && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let w = 1, h = 1, dpr = 1, glDpr = 1, r0 = 300;
    let dirty = true, raf = 0, last = 0, velocity = { x: 0, y: 0 }, destroyed = false, handed = false;
    let places: Places | null = null;
    let countries: { name: { en: string; fr: string }; lon: number; lat: number; angW: number }[] = [];
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const radius = () => r0 * view.zoom; // css px

    const setSize = () => {
      const rect = wrap.getBoundingClientRect();
      w = Math.max(1, rect.width); h = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      glDpr = Math.min(dpr, 1.5); // the shader runs once per pixel: cap it on very dense screens (the text stays sharp)
      canvas.width = Math.round(w * glDpr); canvas.height = Math.round(h * glDpr);
      labels.width = Math.round(w * dpr); labels.height = Math.round(h * dpr);
      r0 = GLOBE_BASE_FRACTION * Math.min(w, h);
      dirty = true;
    };

    const handOff = () => {
      if (handed) return;
      handed = true;
      if (window.__pxGlobe) window.__pxGlobe.handedOff = true;
      router.push(flatHref(view, radius())); // no fade-out wait: the globe stays on screen until the flat map is ready
    };

    const clampView = () => {
      view.lat = Math.max(-GLOBE_MAX_LAT, Math.min(GLOBE_MAX_LAT, view.lat));
      view.lon = ((((view.lon + 180) % 360) + 360) % 360) - 180;
      view.zoom = Math.max(GLOBE_MIN_ZOOM, Math.min(GLOBE_HANDOFF_ZOOM + 0.2, view.zoom));
    };

    const zoomBy = (f: number) => { spin = false; view.zoom *= f; clampView(); dirty = true; if (view.zoom >= GLOBE_HANDOFF_ZOOM) handOff(); };
    api.current = { zoomBy, openFlat: handOff };

    /* ------------------------------------------------------------------ drawing */

    const drawGl = () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uCenter, canvas.width / 2, canvas.height / 2);
      gl.uniform1f(uRadius, radius() * glDpr);
      gl.uniform2f(uView, (view.lon * Math.PI) / 180, (view.lat * Math.PI) / 180);
      gl.uniform4f(uBand, (LON_MIN * Math.PI) / 180, MERCATOR_TOP, MERCATOR_BOTTOM, GRID_WIDTH);
      gl.uniform3f(uGrid, GRID_WIDTH, GRID_HEIGHT, texWidth);
      gl.uniform2f(uLat, (GEO.latMin * Math.PI) / 180, (GEO.latMax * Math.PI) / 180);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const drawLabels = () => {
      const g = labels.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!places) return;
      const r = radius(), cx = w / 2, cy = h / 2;
      const lang = locale === "fr" ? "fr" : "en";
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const put = (text: string, x: number, y: number, a: number, align: CanvasTextAlign, ink: number) => {
        const tw = g.measureText(text).width;
        const x0 = align === "left" ? x : x - tw / 2;
        const box = { x0: x0 - 3, y0: y - 9, x1: x0 + tw + 3, y1: y + 9 };
        if (placed.some((b) => box.x0 < b.x1 && b.x0 < box.x1 && box.y0 < b.y1 && b.y0 < box.y1)) return false;
        placed.push(box);
        g.textAlign = align;
        g.strokeStyle = `rgba(251,245,230,${0.85 * a})`; g.lineWidth = 3; g.lineJoin = "round";
        g.strokeText(text, x, y);
        g.fillStyle = `rgba(${INK},${ink * a})`;
        g.fillText(text, x, y);
        return true;
      };
      g.textBaseline = "middle";
      g.font = `600 ${view.zoom > 1.6 ? 13 : 11}px ${FONT}`;
      const big = [...countries].sort((a, b) => b.angW - a.angW);
      for (const c of big) {
        const p = project(c.lon, c.lat, view.lon, view.lat);
        if (p.z < 0.3) continue;
        const name = (c.name[lang] || c.name.en).toUpperCase();
        if (c.angW * r * Math.cos((c.lat * Math.PI) / 180) * p.z < g.measureText(name).width * 0.95) continue;
        put(name, cx + p.x * r, cy - p.y * r, Math.min(1, (p.z - 0.3) / 0.25) * Math.min(1, Math.max(0, (2.4 - view.zoom) / 0.8)), "center", 0.55);
      }
      if (view.zoom >= 1.5) {
        g.font = `600 12px ${FONT}`;
        const minPop = view.zoom > 2.4 ? 400_000 : view.zoom > 1.9 ? 1_000_000 : 2_500_000;
        for (const c of places.cities) {
          if (c.pop < minPop) break;
          const ll = pixelToLonLat(c.x, c.y);
          const p = project(ll.lon, ll.lat, view.lon, view.lat);
          if (p.z < 0.35) continue;
          const x = cx + p.x * r, y = cy - p.y * r, a = Math.min(1, (p.z - 0.35) / 0.2);
          if (put(c.en, x + 7, y, a, "left", 0.7)) { g.fillStyle = `rgba(${INK},${0.7 * a})`; g.fillRect(x - 2, y - 2, 4, 4); }
        }
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (destroyed) return;
      const dt = last ? Math.min(48, now - last) : 16;
      last = now;
      let again = false;
      const r = radius();
      if (spin) { view.lon += dt * 0.004; dirty = true; again = true; } // ≈ 4° per second
      if (velocity.x || velocity.y) {
        view.lon -= (velocity.x * dt) / (r * Math.max(0.35, Math.cos((view.lat * Math.PI) / 180))) * (180 / Math.PI);
        view.lat += ((velocity.y * dt) / r) * (180 / Math.PI);
        clampView();
        const decay = Math.exp(-dt / 380);
        velocity = { x: velocity.x * decay, y: velocity.y * decay };
        if (Math.hypot(velocity.x, velocity.y) < 0.01) velocity = { x: 0, y: 0 }; else again = true;
        dirty = true;
      }
      if (dirty) {
        dirty = false;
        drawGl();
        drawLabels();
        setInfo((p) => (Math.abs(p.lon - view.lon) > 0.05 || Math.abs(p.lat - view.lat) > 0.05 || Math.abs(p.zoom - view.zoom) > 0.01 ? { ...view } : p));
      }
      if (again) schedule();
    };
    const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(frame); };
    const invalidate = () => { dirty = true; schedule(); };

    /* ------------------------------------------------------------------ input */

    const trail: { t: number; x: number; y: number }[] = [];
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      spin = false; velocity = { x: 0, y: 0 };
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y); }
      trail.length = 0;
    };
    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const nx = e.clientX, ny = e.clientY;
      if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: nx, y: ny });
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchDist > 0) zoomBy(dist / pinchDist);
        pinchDist = dist;
        return;
      }
      const dx = nx - p.x, dy = ny - p.y;
      p.x = nx; p.y = ny;
      const r = radius();
      view.lon -= (dx / (r * Math.max(0.35, Math.cos((view.lat * Math.PI) / 180)))) * (180 / Math.PI);
      view.lat += (dy / r) * (180 / Math.PI);
      clampView();
      trail.push({ t: performance.now(), x: dx, y: dy });
      if (trail.length > 6) trail.shift();
      invalidate();
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
      const now = performance.now();
      const recent = trail.filter((s) => now - s.t < 90);
      if (pointers.size === 0 && recent.length >= 2) {
        const span = Math.max(1, recent[recent.length - 1]!.t - recent[0]!.t);
        velocity = { x: recent.reduce((s, v) => s + v.x, 0) / span, y: recent.reduce((s, v) => s + v.y, 0) / span };
        schedule();
      }
    };
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0016)); schedule(); };
    const onKey = (e: KeyboardEvent) => {
      const step = 6 / view.zoom;
      spin = false;
      if (e.key === "ArrowLeft") view.lon -= step; else if (e.key === "ArrowRight") view.lon += step;
      else if (e.key === "ArrowUp") view.lat += step; else if (e.key === "ArrowDown") view.lat -= step;
      else if (e.key === "+" || e.key === "=") zoomBy(1.4); else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.4);
      else if (e.key === "0" || e.key === "Home") { view.zoom = 1; view.lat = Math.max(-40, Math.min(40, view.lat)); }
      else if (e.key === "Enter") handOff();
      else return;
      e.preventDefault(); clampView(); invalidate();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(() => { setSize(); schedule(); });
    ro.observe(wrap);
    setSize();

    /* ------------------------------------------------------------------ data */

    void worldTexture(texWidth).then((img) => {
      if (destroyed) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      setReady(true);
      if (window.__pxGlobe) window.__pxGlobe.ready = true;
      invalidate();
    });
    void loadPlaces().then((p) => {
      if (destroyed) return;
      places = p;
      countries = p.countries.map((c) => {
        const ll = pixelToLonLat((c.bbox[0] + c.bbox[2]) / 2, (c.bbox[1] + c.bbox[3]) / 2);
        return { name: { en: c.en, fr: c.fr }, lon: ll.lon, lat: ll.lat, angW: ((c.bbox[2] - c.bbox[0]) / GRID_WIDTH) * 2 * Math.PI };
      });
      invalidate();
    });

    if (process.env.NODE_ENV !== "production") {
      window.__pxGlobe = {
        ready: false, handedOff: false, state: view,
        set(lon, lat, zoom) { view.lon = lon; view.lat = lat; view.zoom = zoom; spin = false; clampView(); invalidate(); if (view.zoom >= GLOBE_HANDOFF_ZOOM) handOff(); },
      };
    }
    schedule();
    // dev server only: compile the flat map's route in the background so the way back is not a cold start
    if (process.env.NODE_ENV !== "production" && !navigator.webdriver) void fetch("/", { priority: "low" } as RequestInit).catch(() => undefined);
    router.prefetch("/");

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      // no loseContext(): React strict mode remounts onto the same <canvas>, which must keep a usable context
      gl.deleteProgram(prog);
      gl.deleteTexture(tex);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the renderer is created once per mount
  }, []);

  const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;

  if (!supported) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="max-w-sm text-ink-soft">{t("unsupported")}</p>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={`absolute inset-0 overflow-hidden bg-paper transition-opacity duration-150 ${ready ? "opacity-100" : "opacity-0"}`} data-testid="globe">
      <canvas ref={glRef} role="application" aria-label={t("canvasLabel")} tabIndex={0} className="absolute inset-0 block h-full w-full touch-none select-none outline-offset-[-3px]" style={{ cursor: "grab" }} />
      <canvas ref={labelsRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />

      <div className="pointer-events-none absolute left-3 top-3 sm:left-5 sm:top-5">
        <p className="inline-block rounded-full bg-signal-strong px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">{t("prototype")}</p>
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col items-start gap-2 sm:inset-x-5 sm:bottom-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col items-start gap-2">
          <p className="pixel-num pointer-events-auto rounded-full bg-white/90 px-3 py-1 text-[0.7rem] shadow-float" data-testid="globe-readout">
            {fmt(info.lat, "N", "S")} {fmt(info.lon, "E", "W")} · {info.zoom.toFixed(1)}×
          </p>
          <p className="max-w-xs rounded-2xl bg-white/85 px-3 py-2 text-xs text-ink-soft shadow-float">{t("hint")}</p>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button className="btn btn-ghost !bg-white !min-h-11 !w-11 !px-0 text-lg shadow-float" onClick={() => api.current?.zoomBy(1 / 1.5)} aria-label={t("zoomOut")} title={t("zoomOut")}>−</button>
          <button className="btn btn-ghost !bg-white !min-h-11 !w-11 !px-0 text-lg shadow-float" onClick={() => api.current?.zoomBy(1.5)} aria-label={t("zoomIn")} title={t("zoomIn")}>+</button>
          <button className="btn btn-primary" onClick={() => api.current?.openFlat()} data-testid="globe-open-flat" disabled={!ready}>{t("openFlat")}</button>
        </div>
      </div>
    </div>
  );
}
