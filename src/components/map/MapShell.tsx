"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { SiteHeader, type HeaderViewer } from "@/components/layout/SiteHeader";
import { BuyPanel, type Pricing, type ServerFree } from "@/components/buy/BuyPanel";
import { CheckoutDialog } from "@/components/buy/CheckoutDialog";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { centeredRect, clampToGrid, pixelToLonLat, type Rect } from "@/lib/grid/geometry";
import { globeZoomForFlatScale } from "@/lib/globe/orthographic";
import { prebuildWorldTexture } from "@/components/globe/worldTexture";
import type { PublicStats } from "@/lib/data/map";
import { MapView, type MapViewHandle } from "./MapView";
import type { Camera, MapParcel, Mode, SelectionState } from "./engine";
import { CursorReadout, MapControls, StatsCard } from "./Hud";
import { ParcelCard } from "./ParcelCard";
import { SearchBox, type SearchTarget } from "./SearchBox";

export interface MapShellProps {
  stats: PublicStats | null;
  pricing: Pricing;
  viewer: HeaderViewer | null;
  initial: { camera: Camera | null; parcelCode: string | null; buy: Rect | null };
}

const DEFAULT_SIZE = { w: 20, h: 20 };

export function MapShell({ stats: initialStats, pricing, viewer, initial }: MapShellProps) {
  const t = useTranslations("map");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const mapRef = useRef<MapViewHandle>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [cam, setCam] = useState<Camera>(initial.camera ?? { x: GRID_WIDTH / 2, y: GRID_HEIGHT / 2, scale: 0.03 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>("explore");
  const [size, setSize] = useState(initial.buy ? { w: initial.buy.w, h: initial.buy.h } : DEFAULT_SIZE);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [selState, setSelState] = useState<SelectionState | null>(null);
  const [serverFree, setServerFree] = useState<ServerFree>(null);
  const [parcelCode, setParcelCode] = useState<string | null>(initial.parcelCode);
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const engine = () => mapRef.current?.engine ?? null;

  /* ---------- zooming out far enough turns the map into the 3D globe, at the same place ---------- */
  const toGlobe = useCallback((c: Camera) => {
    const ll = pixelToLonLat(c.x, c.y);
    const vp = engine()?.viewport ?? { w: 1200, h: 800 };
    const zoom = globeZoomForFlatScale(c.scale, ll.lat, vp.w, vp.h);
    router.push(`/globe?lon=${ll.lon.toFixed(2)}&lat=${ll.lat.toFixed(2)}&zoom=${zoom.toFixed(2)}`); // the map stays on screen until the globe is ready
  }, [router]);

  /* ---------- get the globe ready while the map is idle, so zooming out switches without a wait ---------- */
  useEffect(() => {
    if (!engineReady) return;
    router.prefetch("/globe");
    prebuildWorldTexture();
    // Skipped under browser automation (navigator.webdriver), where background requests would only keep the network
    // busy while tests wait for it to go quiet.
    if (navigator.webdriver) return;
    void import("@/components/globe/GlobeView"); // fetch the globe's code now, so the switch does not wait for it
    // dev server only: compile the globe route in the background (the first compile takes many seconds)
    if (process.env.NODE_ENV !== "production") void fetch("/globe", { priority: "low" } as RequestInit).catch(() => undefined);
  }, [engineReady, router]);

  /* ---------- live stats (real numbers, refreshed; a purchase bumps mapVersion and the map reloads its tiles) ---------- */
  useEffect(() => {
    const tick = () => fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then((s: PublicStats | null) => s && setStats(s)).catch(() => undefined);
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  /* ---------- keep the URL shareable: ?x=…&y=…&z=… ---------- */
  const urlTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const u = new URL(window.location.href);
      // only on the map's own address: permalink pages keep their canonical URL, and a navigation to another page
      // (the globe, say) must never be overwritten by a late timer
      const home = locale === "en" ? "/" : `/${locale}`;
      if (u.pathname !== home && u.pathname !== `${home}/`) return;
      u.searchParams.set("x", String(Math.round(cam.x))); u.searchParams.set("y", String(Math.round(cam.y)));
      u.searchParams.set("z", String(Number(cam.scale.toPrecision(3))));
      history.replaceState(history.state, "", u); // keep the router's own history state intact
    }, 500);
    return () => clearTimeout(urlTimer.current);
  }, [cam, locale]);

  /* ---------- buy mode ---------- */
  const applySelection = useCallback((r: Rect | null) => {
    setSelection(r);
    engine()?.setSelection(r);
  }, []);

  const startBuy = useCallback((preset?: Rect | null) => {
    const e = engine();
    if (!e) return;
    setParcelCode(null); e.setHighlight(null);
    setMode("buy"); e.setMode("buy");
    const sz = preset ? { w: preset.w, h: preset.h } : size;
    setSize(sz); e.setBrush(sz);
    if (preset) {
      const r = clampToGrid(preset);
      applySelection(r);
      e.fitRect(r, { padding: 140, maxScale: 8, offsetX: -190 });
    } else if (e.cam.scale < 0.35) {
      e.flyTo({ x: e.cam.x, y: e.cam.y, scale: 0.6 }, 700);
    }
  }, [size, applySelection]);

  const stopBuy = useCallback(() => {
    const e = engine();
    setMode("explore"); e?.setMode("explore"); e?.setBrush(null); e?.setPreviewImage(null);
    applySelection(null); setServerFree(null); setSelState(null); setDialog(false);
  }, [applySelection]);

  const changeSize = (w: number, h: number) => {
    setSize({ w, h });
    const e = engine();
    if (w < 1 || h < 1) return;
    e?.setBrush({ w, h });
    if (selection) applySelection(centeredRect(selection.x + selection.w / 2, selection.y + selection.h / 2, w, h));
  };

  // authoritative availability (includes live reservations of other buyers) once the local check says "ok"
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronises UI state with the (async) server availability check
    if (!selection || selState !== "ok") { setServerFree(null); return; }
    setServerFree("checking");
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/availability?x=${selection.x}&y=${selection.y}&w=${selection.w}&h=${selection.h}`, { signal: ctl.signal })
        .then((r) => r.json()).then((j: { free?: boolean }) => setServerFree(j.free === true ? true : j.free === false ? false : null)).catch(() => undefined);
    }, 300);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [selection, selState]);

  const buyUrl = (r: Rect) => `/?bx=${r.x}&by=${r.y}&bw=${r.w}&bh=${r.h}`;
  const continueBuy = () => {
    if (!selection) return;
    if (!viewer) { window.location.assign(`/auth/sign-in?next=${encodeURIComponent(buyUrl(selection))}`); return; }
    setDialog(true);
  };

  /* ---------- navigation ---------- */
  const goTo = (target: SearchTarget) => {
    const e = engine();
    if (!e) return;
    if (target.kind === "rect") e.fitRect(target.rect, { padding: 60, maxScale: 1.2 });
    else if (target.kind === "point") e.flyTo({ x: target.x, y: target.y, scale: target.scale }, 1100);
    else window.location.assign(`${locale === "en" ? "" : `/${locale}`}/p/${target.code}`);
  };

  // deep links: open the buy flow / focus a parcel once the engine exists
  const started = useRef(false);
  useEffect(() => {
    if (!engineReady || started.current) return;
    started.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off initialisation from the deep link, once the engine exists
    if (initial.buy) startBuy(initial.buy);
    if (initial.parcelCode) engine()?.setHighlight(initial.parcelCode);
  }, [engineReady, initial, startBuy]);

  const onSelectParcel = useCallback((p: MapParcel | null) => {
    setParcelCode(p?.code ?? null);
    engine()?.setHighlight(p?.code ?? null);
  }, []);

  const zoomed = cam.scale >= 0.25;
  const fullStats = mode === "explore" && !parcelCode && !zoomed; // full counter card when zoomed out, compact one when zoomed in

  return (
    <div className="flex h-dvh flex-col" data-testid="map-shell">
      <SiteHeader
        viewer={viewer}
        center={<SearchBox onGo={goTo} />}
        cta={mode === "explore" ? (
          <button className="btn btn-primary btn-sm sm:!min-h-10 sm:!px-5" onClick={() => startBuy()} data-testid="find-your-spot">{t("findYourSpot")}</button>
        ) : null}
      />
      <div className="relative min-h-0 flex-1">
        <MapView
          ref={mapRef}
          label={t("canvasLabel")}
          initialCamera={initial.camera}
          mapVersion={stats?.mapVersion ?? 1}
          onReady={() => setEngineReady(true)}
          onCamera={setCam}
          onCursor={(x, y) => setCursor({ x, y })}
          onSelectParcel={onSelectParcel}
          onPlace={(r) => setSelection(r)}
          onSelectionState={setSelState}
          onZoomOutToGlobe={toGlobe}
        />

        {/* the page title stays for search engines and screen readers; the map itself is the hero */}
        <h1 className="sr-only">{t("sloganA")} {t("sloganB")} {t("sloganC")}</h1>

        {/* live counter (bottom) */}
        <div className="pointer-events-none absolute inset-3 z-10 flex flex-col justify-end sm:inset-5">
          <div className="flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-2 sm:max-w-none">
            {stats ? <StatsCard stats={stats} compact={!fullStats} /> : <p className="card pointer-events-auto px-4 py-3 text-sm text-ink-soft">{t("statsUnavailable")}</p>}
            {cursor && <CursorReadout x={cursor.x} y={cursor.y} />}
            <p className="pointer-events-auto rounded-full bg-white/85 px-3 py-1 text-[0.65rem] text-ink-faint shadow-float">
              © Natural Earth · GeoNames · <Link href="/credits" className="underline">{t("credits")}</Link>
            </p>
          </div>
        </div>
        <MapControls
          cam={cam}
          className={`absolute z-10 ${mode === "buy" ? "bottom-[calc(60vh+1rem)] right-3 md:bottom-5 md:right-[25rem]" : "bottom-3 right-3 sm:bottom-5 sm:right-5"}`}
          onZoomIn={() => engine()?.zoomBy(1.8)} onZoomOut={() => engine()?.zoomBy(1 / 1.8)} onFit={() => engine()?.fitWorld()}
        />

        {mode === "buy" && (
          <BuyPanel
            pricing={pricing} locale={locale} size={size} onSize={changeSize} selection={selection}
            onMoveSelection={(r) => { const c = clampToGrid(r); applySelection(c); }}
            state={selState} serverFree={serverFree} signedIn={Boolean(viewer)} onContinue={continueBuy} onClose={stopBuy}
          />
        )}

        {parcelCode && mode === "explore" && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:block">
            <ParcelCard code={parcelCode} signedIn={Boolean(viewer)} onClose={() => { setParcelCode(null); engine()?.setHighlight(null); }} />
          </div>
        )}

        {toast && (
          <div role="status" className="pointer-events-auto absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-float">
            {toast}
            <button className="ml-3 underline" onClick={() => setToast(null)}>{tc("ok")}</button>
          </div>
        )}
      </div>

      {dialog && selection && (
        <CheckoutDialog
          rect={selection} pricing={pricing}
          onClose={() => { engine()?.setPreviewImage(null); setDialog(false); }}
          onPreviewOnMap={(img) => { const e = engine(); e?.setPreviewImage(img); if (img && e) e.fitRect(selection, { padding: 110, maxScale: 14 }); }}
          onUnavailable={() => { setDialog(false); setToast(t("spotTaken")); engine()?.setPreviewImage(null); setSelState(null); applySelection({ ...selection }); }}
        />
      )}
    </div>
  );
}
