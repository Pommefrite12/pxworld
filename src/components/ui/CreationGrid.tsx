import { getFormatter, getLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { Card } from "@/lib/data/parcels";

export async function CreationGrid({ items, empty }: { items: Card[]; empty: string }) {
  const f = await getFormatter();
  const locale = await getLocale();
  if (items.length === 0) return <p className="card p-6 text-sm text-ink-soft">{empty}</p>;
  const region = new Intl.DisplayNames([locale], { type: "region" });
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((c) => (
        <li key={c.code}>
          <Link href={`/p/${c.code}`} className="card group block overflow-hidden transition hover:-translate-y-0.5">
            <div className="checker grid aspect-square place-items-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/assets/${c.asset_id}`} alt={c.title ?? ""} width={c.w} height={c.h} loading="lazy" className="pixelated max-h-full max-w-full object-contain" style={{ imageRendering: "pixelated" }} />
            </div>
            <div className="p-3">
              <p className="truncate text-sm font-bold">{c.title ?? "—"}</p>
              <p className="truncate text-xs text-ink-soft">{c.username}{c.country ? ` · ${region.of(c.country) ?? c.country}` : ""}</p>
              <p className="pixel-num mt-0.5 text-xs text-ink-faint">{c.w}×{c.h} · {f.number(c.area)} px{c.score ? ` · ♥ ${c.score}` : ""}</p>
              {c.note && <p className="mt-1 text-xs italic text-ink-soft">“{c.note}”</p>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
