/** Pixel globe + wordmark ("pixel" in the pixel font, "world" in the display font). The globe is drawn on a 12×12 grid: a tiny version of the product itself. */
export const GLOBE_ROWS = [
  "...oooooo...",
  "..oooLLooLo.",
  ".ooLLLoooLLo",
  ".oLLLLLooLLo",
  "oooLLLoooooo",
  "ooooLLLoooLo",
  "oooooLLLooLo",
  "ooooooLLLooo",
  ".oooooLLoooo",
  ".ooLooLooooo",
  "..oooooooLo.",
  "...oooooo...",
];

export function PixelGlobe({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {GLOBE_ROWS.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={c === "L" ? "#f04316" : "#2b35e0"} />,
        ),
      )}
    </svg>
  );
}

/** `wordClassName` lets a place that is short of room hide the name and keep the globe (the link around the logo carries the name for screen readers). */
export function Logo({ className = "", wordClassName = "" }: { className?: string; wordClassName?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <PixelGlobe />
      <span className={`font-display text-[1.35rem] font-extrabold leading-none tracking-tight ${wordClassName}`}>
        {/* "pixel" is set in the site's pixel font (one weight, no letter-spacing: its letters sit on a pixel grid); a little larger,
            because a pixel font has a smaller x-height than the display font next to it */}
        <span className="font-pixel text-[1.3em] font-normal tracking-normal">pixel</span><span className="text-signal">world</span>
      </span>
    </span>
  );
}
