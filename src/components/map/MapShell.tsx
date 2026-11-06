"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { SiteHeader, type HeaderViewer } from "@/components/layout/SiteHeader";
import { BuyPanel, type ServerFree } from "@/components/buy/BuyPanel";
import type { ParcelKind, Pricing } from "@/lib/grid/pricing";
import { CheckoutDialog } from "@/components/buy/CheckoutDialog";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { centeredRect, clampToGrid, type Rect } from "@/lib/grid/geometry";
import type { PublicStats } from "@/lib/data/map";
import { MapView, type MapViewHandle } from "./MapView";
import type { Camera, MapParcel, Mode, SelectionState } from "./engine";
import { LatestTile, MapControls, StatsCard, type LatestCreation } from "./Hud";
import { ParcelCard } from "./ParcelCard";
import { ProjectMapCard } from "./ProjectMapCard";
import type { MapProject } from "@/lib/map/projects";
import { DoomActions, DoomMessage, DoomPlate } from "@/components/doom/Doom";
import { endFinale, finaleInfo, useFinaleDuring } from "@/components/doom/finaleStore";
import { useDoom } from "@/components/doom/useDoom";
import { ComicButton } from "@/components/doom/Comic";
import { PRE_END_INTENSITY, infection } from "@/lib/doom/clock";
import { SearchBox, type SearchTarget } from "./SearchBox";

export interface MapShellProps {
  stats: PublicStats | null;
  /** The newest published creations (public data), for the tile next to the counter. */
  latest?: LatestCreation[];
  pricing: Pricing;
  viewer: HeaderViewer | null;
  initial: { camera: Camera | null; parcelCode: string | null; buy: Rect | null; startBuy?: boolean; /** Land or water, when a purchase is resumed after signing in. */ kind?: ParcelKind };
}

const DEFAULT_SIZE = { w: 20, h: 20 };

export function MapShell({ stats: initialStats, latest = [], pricing, viewer, initial }: MapShellProps) {
  const t = useTranslations("map");
  const tc = useTranslations("common");
  const td = useTranslations("doom");
  const doom = useDoom(); // "100 days to save the world": null while the countdown is off
  const during = useFinaleDuring(); // the final sequence is playing
  // how much of the land the story has corrupted, in 0.5 % steps; while the final sequence plays, the world as it was just before the end
  // (the sweep then turns it into the end state)
  const storyStep = doom ? Math.round((doom.remaining.over && during ? PRE_END_INTENSITY : infection(doom.remaining)) * 200) : null;
  const arming = Boolean(doom && !doom.remaining.over && doom.remaining.ms <= 60_000);
  const ended = Boolean(doom?.remaining.over); // the countdown has reached zero: the shop is closed
  const locale = useLocale();
  const router = useRouter();
  const mapRef = useRef<MapViewHandle>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [stats, setStats] = useState(initialStats);
  const [cam, setCam] = useState<Camera>(initial.camera ?? { x: GRID_WIDTH / 2, y: GRID_HEIGHT / 2, scale: 0.03 });
  const [mode, setMode] = useState<Mode>("explore");
  const [size, setSize] = useState(initial.buy ? { w: initial.buy.w, h: initial.buy.h } : DEFAULT_SIZE);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [selState, setSelState] = useState<SelectionState | null>(null);
  const [selLand, setSelLand] = useState<number | null>(null);
  const [serverFree, setServerFree] = useState<ServerFree>(null);
  const [kind, setKind] = useState<ParcelKind>(initial.kind ?? "land"); // what the buyer is acquiring: land, or water (the sea)
  const [parcelCode, setParcelCode] = useState<string | null>(initial.parcelCode);
  const [dialog, setDialog] = useState(false);
  const [collective, setCollective] = useState(false); // the dialog sends a project to moderation (funded by several people) instead of paying
  const [toast, setToast] = useState<string | null>(null);
  // the group projects that are collecting: drawn on the map (hatched zones and pins); a click opens their card
  const [projects, setProjects] = useState<MapProject[]>([]);
  const [projectCode, setProjectCode] = useState<string | null>(null);
  const project = projectCode ? projects.find((p) => p.code === projectCode) ?? null : null;
  const engine = () => mapRef.current?.engine ?? null;

  /* ---------- live stats (real numbers, refreshed; a purchase bumps mapVersion and the map reloads its tiles) ---------- */
  useEffect(() => {
    const tick = () => fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then((s: PublicStats | null) => s && setStats(s)).catch(() => undefined);
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  /* ---------- the group projects on the map (public list, refreshed every minute; an empty list on any trouble) ---------- */
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/map/projects").then((r) => (r.ok ? r.json() : [])).then((l: MapProject[]) => { if (alive && Array.isArray(l)) setProjects(l); }).catch(() => undefined);
    void load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => { if (engineReady) engine()?.setProjects(projects); }, [engineReady, projects]);
  useEffect(() => { if (engineReady) engine()?.setProjectHighlight(project?.code ?? null); }, [engineReady, project]);

  /* ---------- keep the URL shareable: ?x=…&y=…&z=… ---------- */
  const urlTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const u = new URL(window.location.href);
      // only on the map's own addresses (home and /map): permalink pages keep their canonical URL, and a navigation to another
      // page must never be overwritten by a late timer
      const base = locale === "en" ? "" : `/${locale}`;
      if (![`${base}`, `${base}/`, `${base}/map`, `${base}/map/`].includes(u.pathname)) return;
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
    if (!e || ended) return; // the story is over: nothing can be bought any more
    setParcelCode(null); e.setHighlight(null); setProjectCode(null);
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
  }, [size, applySelection, ended]);

  const stopBuy = useCallback(() => {
    const e = engine();
    setMode("explore"); e?.setMode("explore"); e?.setBrush(null); e?.setPreviewImage(null);
    applySelection(null); setServerFree(null); setSelState(null); setDialog(false);
  }, [applySelection]);

  // the countdown reaches zero while somebody is choosing a spot: the shop closes under their feet
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leaves the buy mode when the story ends
    if (ended && mode === "buy") stopBuy();
  }, [ended, mode, stopBuy]);

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
      fetch(`/api/availability?x=${selection.x}&y=${selection.y}&w=${selection.w}&h=${selection.h}&kind=${kind}`, { signal: ctl.signal })
        .then((r) => r.json()).then((j: { free?: boolean }) => setServerFree(j.free === true ? true : j.free === false ? false : null)).catch(() => undefined);
    }, 300);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [selection, selState, kind]);

  const buyUrl = (r: Rect) => `/map?bx=${r.x}&by=${r.y}&bw=${r.w}&bh=${r.h}${kind === "water" ? "&bk=water" : ""}`;
  const continueBuy = (asProject = false) => {
    if (!selection) return;
    if (!viewer) { window.location.assign(`/auth/sign-in?next=${encodeURIComponent(buyUrl(selection))}`); return; }
    setCollective(asProject);
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
  useEffect(() => { if (engineReady) engine()?.setLandRule(pricing.minLandPercent); }, [engineReady, pricing.minLandPercent]);
  useEffect(() => { if (engineReady) engine()?.setWaterRule(pricing.minWaterPercent); }, [engineReady, pricing.minWaterPercent]);
  useEffect(() => { if (engineReady) engine()?.setBuyKind(kind); }, [engineReady, kind]);
  // the last minute: the end state of the visible land is drawn ahead, so that nothing has to be made while the sequence plays
  useEffect(() => { if (engineReady && arming) engine()?.armFinale(); }, [engineReady, arming]);
  // the sequence starts (the countdown reached zero, or "Replay"): the map plays it. BEFORE the story's step is set below, because a
  // replay keeps the end-state tiles it is showing and goes back to the world as it was before the end
  useEffect(() => {
    if (!engineReady || !during) return;
    const info = finaleInfo();
    engine()?.startFinale(info.startedAt, window.matchMedia("(prefers-reduced-motion: reduce)").matches, info.replay);
  }, [engineReady, during]);
  useEffect(() => { if (engineReady) engine()?.setStory(storyStep === null ? null : storyStep / 200); }, [engineReady, storyStep]);

  useEffect(() => {
    if (!engineReady || started.current) return;
    started.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off initialisation from the deep link, once the engine exists
    if (initial.buy) startBuy(initial.buy);
    else if (initial.startBuy) startBuy(null); // "Find your spot" link (?buy=1)
    if (initial.parcelCode) engine()?.setHighlight(initial.parcelCode);
  }, [engineReady, initial, startBuy]);

  const onSelectParcel = useCallback((p: MapParcel | null) => {
    setProjectCode(null); // a click elsewhere closes the card of a project (the engine calls onSelectProject right after, when it was a project that was clicked)
    setParcelCode(p?.code ?? null);
    engine()?.setHighlight(p?.code ?? null);
  }, []);

  // a click on a creation of the "latest" tile: fly to its parcel and open its card
  const pickLatest = useCallback((c: LatestCreation) => {
    const e = engine();
    if (!e) return;
    e.fitRect({ x: c.x, y: c.y, w: c.w, h: c.h }, { padding: 130, maxScale: 12 });
    setParcelCode(c.code);
    e.setHighlight(c.code);
  }, []);

  const zoomed = cam.scale >= 0.25;
  const fullStats = mode === "explore" && !parcelCode && !zoomed; // full counter card when zoomed out, compact one when zoomed in

  return (
    <div className="flex h-dvh flex-col" data-testid="map-shell">
      <SiteHeader
        viewer={viewer}
        center={<SearchBox onGo={goTo} />}
        cta={mode === "explore" ? (ended
          // the world has ended and nothing can be bought any more: the button now leads to the ones who saved a piece of it
          ? <Link href="/discover" className="btn btn-primary btn-sm doom-cta max-sm:!px-3 sm:!min-h-10 sm:!px-5" data-testid="find-your-spot">{td("ctaOver")}</Link>
          : <button className={`btn btn-primary btn-sm max-sm:!px-3 sm:!min-h-10 sm:!px-5${doom ? " doom-cta" : ""}`} onClick={() => startBuy()} data-testid="find-your-spot">{doom ? td("cta") : t("findYourSpot")}</button>
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
          onSelectParcel={onSelectParcel}
          onSelectProject={(p) => setProjectCode(p.code)}
          onPlace={(r) => setSelection(r)}
          onSelectionState={setSelState}
          onSelectionLand={setSelLand}
          onFinaleEnd={endFinale}
        />

        {/* the page title stays for search engines and screen readers; the map itself is the hero */}
        <h1 className="sr-only">{t("sloganA")} {t("sloganB")} {t("sloganC")}</h1>

        {/* the countdown of the story, top of the map (not over a parcel card or the buy panel) */}
        {doom && mode === "explore" && !parcelCode && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-3 sm:top-4">
            <DoomPlate heading={!ended}>
              {!ended && <button type="button" className="btn btn-primary btn-sm doom-cta" onClick={() => startBuy()} data-testid="doom-save">{td("cta")}</button>}
              <ComicButton ended={ended} onSave={() => startBuy()} />
            </DoomPlate>
            <DoomMessage survivors={stats?.parcels ?? 0} className="hidden sm:block" />
            <DoomActions survivors={stats?.parcels ?? 0} className="hidden sm:flex" />
          </div>
        )}

        {/* live counter (bottom) */}
        <div className="pointer-events-none absolute inset-3 z-10 flex flex-col justify-end sm:inset-5">
          <div className="flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-2 sm:max-w-none">
            {mode === "explore" && <LatestTile items={latest} onPick={pickLatest} />}
            {stats ? <StatsCard stats={stats} compact={!fullStats} /> : <p className="card pointer-events-auto px-4 py-3 text-sm text-ink-soft">{t("statsUnavailable")}</p>}
            <p className="pointer-events-auto badge-px px-3 py-1 text-[0.65rem] text-ink-faint">
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
            state={selState} kind={kind} onKind={(k) => { setServerFree(null); setKind(k); }} landPixels={selLand} serverFree={serverFree} signedIn={Boolean(viewer)} onContinue={() => continueBuy(false)} onCollective={() => continueBuy(true)} onClose={stopBuy}
          />
        )}

        {parcelCode && mode === "explore" && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:block">
            <ParcelCard code={parcelCode} signedIn={Boolean(viewer)} onClose={() => { setParcelCode(null); engine()?.setHighlight(null); }} />
          </div>
        )}

        {project && mode === "explore" && !parcelCode && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:block">
            <ProjectMapCard p={project} onClose={() => setProjectCode(null)} />
          </div>
        )}

        {toast && (
          <div role="status" className="pointer-events-auto absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-[8px] bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-float">
            {toast}
            <button className="ml-3 underline" onClick={() => setToast(null)}>{tc("ok")}</button>
          </div>
        )}
      </div>

      {dialog && selection && (
        <CheckoutDialog
          rect={selection} kind={kind} pricing={pricing} landPixels={selLand} mode={collective ? "collective" : "buy"}
          onClose={() => { engine()?.setPreviewImage(null); setDialog(false); }}
          onSent={() => { engine()?.setPreviewImage(null); stopBuy(); }}
          onPreviewOnMap={(img) => { const e = engine(); e?.setPreviewImage(img); if (img && e) e.fitRect(selection, { padding: 110, maxScale: 14 }); }}
          onUnavailable={() => { setDialog(false); setToast(t("spotTaken")); engine()?.setPreviewImage(null); setSelState(null); applySelection({ ...selection }); }}
        />
      )}
    </div>
  );
}
