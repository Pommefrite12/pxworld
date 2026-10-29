"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { lonLatToPixel, type Rect } from "@/lib/grid/geometry";
import { loadPlaces, type Places } from "./geo";

export type SearchTarget =
  | { kind: "rect"; rect: Rect }
  | { kind: "point"; x: number; y: number; scale: number }
  | { kind: "parcel"; code: string };

interface Result { key: string; label: string; sub: string; target: SearchTarget }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Geographic search over an offline index (Natural Earth countries + GeoNames cities), plus x,y / lat,lon / parcel codes. */
export function SearchBox({ onGo, className = "" }: { onGo: (t: SearchTarget) => void; className?: string }) {
  const t = useTranslations("search");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [places, setPlaces] = useState<Places | null>(null);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const regions = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);

  useEffect(() => { if (open && !places) void loadPlaces().then(setPlaces); }, [open, places]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const results = useMemo<Result[]>(() => {
    const raw = q.trim();
    if (!raw) return [];
    if (/^[0-9a-f]{8}$/i.test(raw)) return [{ key: "code", label: raw.toLowerCase(), sub: t("parcelCode"), target: { kind: "parcel", code: raw.toLowerCase() } }];
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
    for (const c of places.cities) {
      if (out.length >= 8) break;
      if (!norm(c.en).includes(n)) continue;
      out.push({ key: `p-${c.en}-${c.cc}-${c.x}`, label: c.en, sub: `${t("city")} · ${regions.of(c.cc) ?? c.cc}`, target: { kind: "point", x: c.x, y: c.y, scale: 3 } });
    }
    return out;
  }, [q, places, locale, regions, t]);

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
