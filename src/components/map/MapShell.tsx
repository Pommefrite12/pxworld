"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SiteHeader, type HeaderViewer } from "@/components/layout/SiteHeader";
import { BuyPanel, type Pricing, type ServerFree } from "@/components/buy/BuyPanel";
import { CheckoutDialog } from "@/components/buy/CheckoutDialog";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { centeredRect, clampToGrid, type Rect } from "@/lib/grid/geometry";
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
  const locale = useLocale();
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
      if (u.pathname.includes("/p/")) return; // permalink pages keep their canonical URL
      u.searchParams.set("x", String(Math.round(cam.x))); u.searchParams.set("y", String(Math.round(cam.y)));
      u.searchParams.set("z", String(Number(cam.scale.toPrecision(3))));
      history.replaceState(null, "", u);
    }, 500);
    return () => clearTimeout(urlTimer.current);
  }, [cam]);

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
    if (initial.buy) startBuy(initial.buy);
    if (initial.parcelCode) engine()?.setHighlight(initial.parcelCode);
  }, [engineReady, initial, startBuy]);

  const onSelectParcel = useCallback((p: MapParcel | null) => {
    setParcelCode(p?.code ?? null);
    engine()?.setHighlight(p?.code ?? null);
  }, []);

  const zoomed = cam.scale >= 0.25;
  const showHero = mode === "explore" && !parcelCode && !zoomed;

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
        />

        {/* hero (top) + live counter (bottom): the Pacific corner of the map is empty ocean, so the card hides nothing */}
        <div className="pointer-events-none absolute inset-3 z-10 flex flex-col justify-between sm:inset-5">
          <div>
            {showHero && (
              <div className="animate-rise pointer-events-auto max-w-md rounded-3xl bg-paper/80 p-3 backdrop-blur-sm sm:-m-3">
                <h1 className="font-display text-[1.65rem] font-extrabold leading-[1.05] tracking-tight sm:text-[2.3rem]">
                  {t("sloganA")} <span className="text-signal">{t("sloganB")}</span> <span className="block sm:inline">{t("sloganC")}</span>
                </h1>
                <p className="mt-2 max-w-sm text-sm text-ink-soft sm:text-base">{t("pitch")}</p>
              </div>
            )}
          </div>
          <div className="flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-2 sm:max-w-none">
            {stats ? <StatsCard stats={stats} compact={!showHero} /> : <p className="card pointer-events-auto px-4 py-3 text-sm text-ink-soft">{t("statsUnavailable")}</p>}
            {cursor && <CursorReadout x={cursor.x} y={cursor.y} />}
            <p className="pointer-events-auto rounded-full bg-white/85 px-3 py-1 text-[0.65rem] text-ink-faint shadow-float">
              © Natural Earth · GeoNames · <Link href="/credits" className="underline">{t("credits")}</Link>
            </p>
          </div>
        </div>
        <MapControls
          cam={cam}
          className={`absolute z-10 ${mode === "buy" ? "bottom-[calc(62vh+1rem)] right-3 md:bottom-5 md:right-[25rem]" : "bottom-3 right-3 sm:bottom-5 sm:right-5"}`}
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
            <button className="ml-3 underline" onClick={() => setToast(null)}>OK</button>
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
