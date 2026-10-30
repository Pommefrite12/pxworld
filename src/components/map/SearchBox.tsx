"use client";

import { PARCEL_CODE_RE } from "@/lib/grid/code";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { lonLatToPixel, type Rect } from "@/lib/grid/geometry";
import { loadPlaces, loadSearchIndex, type Places } from "./geo";

export type SearchTarget =
  | { kind: "rect"; rect: Rect }
  | { kind: "point"; x: number; y: number; scale: number }
  | { kind: "parcel"; code: string };

interface Result { key: string; label: string; sub: string; target: SearchTarget }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Geographic search over an offline index (Natural Earth countries and départements/states, GeoNames cities of
 * 15 000+ inhabitants), plus x,y / lat,lon / parcel codes.
 */
export function SearchBox({ onGo, className = "" }: { onGo: (t: SearchTarget) => void; className?: string }) {
  const t = useTranslations("search");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [places, setPlaces] = useState<Places | null>(null);
  const [extra, setExtra] = useState<Awaited<ReturnType<typeof loadSearchIndex>> | null>(null);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const regions = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);

  useEffect(() => {
    if (!open) return;
    if (!places) void loadPlaces().then(setPlaces);
    if (!extra) void loadSearchIndex().then(setExtra);
  }, [open, places, extra]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const results = useMemo<Result[]>(() => {
    const raw = q.trim();
    if (!raw) return [];
    if (PARCEL_CODE_RE.test(raw.toLowerCase())) return [{ key: "code", label: raw.toLowerCase(), sub: t("parcelCode"), target: { kind: "parcel", code: raw.toLowerCase() } }];
    let m = raw.match(/^(-?\d+\.\d+)\s*[,; ]\s*(-?\d+\.\d+)$/);
    if (m) {
      const lat = Number(m[1]), lon = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        const p = lonLatToPixel({ lat, lon });
        if (p.x >= 0 && p.x <= GRID_WIDTH && p.y >= 0 && p.y <= GRID_HEIGHT) return [{ key: "ll", label: `${lat}°, ${lon}°`, sub: t("coordinates"), target: { kind: "point", x: p.x, y: p.y, scale: 6 } }];
      }
      return [];
    }
    m = raw.match(/^(\d{1,5})\s*[,; ]\s*(\d{1,5})$/);
    if (m) {
      const x = Number(m[1]), y = Number(m[2]);
      if (x <= GRID_WIDTH && y <= GRID_HEIGHT) return [{ key: "xy", label: `x ${x} · y ${y}`, sub: t("pixelPosition"), target: { kind: "point", x, y, scale: 14 } }];
      return [];
    }
    if (!places) return [];
    const n = norm(raw);
    const out: Result[] = [];
    const cs = places.countries.map((c) => ({ c, name: locale === "fr" ? c.fr : c.en })).filter(({ name, c }) => norm(name).includes(n) || norm(c.en).includes(n));
    cs.sort((a, b) => Number(norm(b.name).startsWith(n)) - Number(norm(a.name).startsWith(n)) || a.name.localeCompare(b.name));
    for (const { c, name } of cs.slice(0, 4)) {
      const [x0, y0, x1, y1] = c.bbox;
      out.push({ key: `c-${c.code ?? c.en}`, label: name, sub: t("country"), target: { kind: "rect", rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } } });
    }
    // départements/states/provinces and cities, best match first: names starting with the query, then the bigger place
    type Hit = { r: Result; starts: boolean; weight: number };
    const hits: Hit[] = [];
    const cityScale = (pop: number) => (pop >= 1_000_000 ? 3 : pop >= 100_000 ? 5 : 8);
    const city = (name: string, cc: string, pop: number, x: number, y: number) => {
      const nn = norm(name);
      if (nn.includes(n)) hits.push({ starts: nn.startsWith(n), weight: pop, r: { key: `p-${name}-${cc}-${x}`, label: name, sub: `${t("city")} · ${regions.of(cc) ?? cc}`, target: { kind: "point", x, y, scale: cityScale(pop) } } });
    };
    for (const c of places.cities) city(c.en, c.cc, c.pop, c.x, c.y);
    if (extra) {
      for (const l of extra.admin) {
        const name = locale === "fr" && l.fr ? l.fr : l.en;
        const nn = norm(name);
        if (!nn.includes(n) && !norm(l.en).includes(n)) continue;
        hits.push({
          starts: nn.startsWith(n), weight: l.s * 400, // a unit is a "bigger hit" than a town of the same name
          r: { key: `a-${l.en}-${l.cc}-${l.x}`, label: name, sub: `${l.dep ? t("department") : t("region")} · ${regions.of(l.cc) ?? l.cc}`, target: { kind: "point", x: l.x, y: l.y, scale: Math.min(8, Math.max(0.5, 380 / Math.max(l.s, 1))) } },
        });
      }
      for (const c of extra.towns) city(c.name, c.cc, c.pop, c.x, c.y);
    }
    hits.sort((a, b) => Number(b.starts) - Number(a.starts) || b.weight - a.weight);
    for (const h of hits) { if (out.length >= 8) break; if (!out.some((o) => o.key === h.r.key)) out.push(h.r); }
    return out;
  }, [q, places, extra, locale, regions, t]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    setOpen(false);
    setQ("");
    onGo(r.target);
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <div className="relative">
        <svg aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          role="combobox" aria-expanded={open && results.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" aria-label={t("label")}
          aria-activedescendant={results[active] ? `${id}-${active}` : undefined}
          className="field !min-h-10 !rounded-full !pl-10 text-[0.95rem]" placeholder={t("placeholder")} value={q} autoComplete="off" spellCheck={false}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") go(results[active]);
            else if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && q.trim() && (
        <ul id={`${id}-list`} role="listbox" className="card absolute left-0 right-0 top-12 z-40 max-h-80 overflow-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-2.5 text-sm text-ink-soft">{places ? t("none") : t("loading")}</li>}
          {results.map((r, i) => (
            <li key={r.key} id={`${id}-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onPointerDown={(e) => { e.preventDefault(); go(r); }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-paper-2" : ""}`}>
              <span className="truncate font-semibold">{r.label}</span>
              <span className="shrink-0 text-xs text-ink-faint">{r.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
