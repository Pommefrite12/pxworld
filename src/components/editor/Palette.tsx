"use client";

import { PALETTE, toggleMix } from "@/lib/editor/colors";

/** The colour swatches. `selected` are outlined; with `order`, each selected colour shows its rank (the order a multicolour stroke uses). */
export function Swatches({ selected, order = false, onPick, label, name = (c) => c, className = "" }: { selected: readonly string[]; order?: boolean; onPick: (c: string) => void; label: string; name?: (c: string) => string; className?: string }) {
  return (
    <div className={`grid grid-cols-8 gap-1.5 ${className}`} role="group" aria-label={label}>
      {PALETTE.map((c) => {
        const i = selected.indexOf(c);
        return (
          <button key={c} type="button" aria-label={name(c)} aria-pressed={i >= 0} onClick={() => onPick(c)}
            className="relative aspect-square rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15),0_2px_0_rgb(31_37_64/0.12)]"
            style={{ background: c, outline: i >= 0 ? "3px solid var(--color-cobalt)" : "none", outlineOffset: 1 }}>
            {order && i >= 0 && (
              <span className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-cobalt px-0.5 text-[0.6rem] font-bold leading-none text-white" aria-hidden data-testid="mix-rank">{i + 1}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The stroke colour(s): the swatches, any colour, and the "multicolour" switch. Single: one colour. Multicolour: the swatches
 * become a selection (click to add or remove, in order) and the stroke runs through them. `children` sit next to the colour
 * picker (the brush size).
 */
export function Palette({ color, onColor, multi, onMulti, mix, onMix, labels, className = "", children }: {
  color: string; onColor: (c: string) => void;
  multi: boolean; onMulti: (on: boolean) => void;
  mix: string[]; onMix: (m: string[]) => void;
  labels: { palette: string; customColor: string; multi: string; multiHint: string };
  className?: string; children?: React.ReactNode;
}) {
  const pick = (c: string) => {
    if (!multi) { onColor(c); return; }
    const next = toggleMix(mix, c);
    onMix(next);
    onColor(next.includes(c) ? c : next[next.length - 1]!); // what "fill" uses: the colour just added, or the last one left
  };
  const toggle = (on: boolean) => { if (on) onMix([color]); onMulti(on); };
  const last = mix[mix.length - 1] ?? color;
  return (
    <div className={className}>
      <Swatches selected={multi ? mix : [color]} order={multi} onPick={pick} label={labels.palette} className="mt-3" />
      <div className="mt-2 flex items-center gap-2">
        <input type="color" aria-label={labels.customColor} value={multi ? last : color} className="h-9 w-12 cursor-pointer rounded-md border-0 bg-transparent p-0"
          onChange={(e) => { const c = e.target.value; if (multi) onMix([...mix.slice(0, -1), c]); onColor(c); }} />
        {children}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={multi} onChange={(e) => toggle(e.target.checked)} data-testid="multi-toggle" /> {labels.multi}
      </label>
      {multi && <p className="mt-1 text-xs text-ink-faint">{labels.multiHint}</p>}
    </div>
  );
}
