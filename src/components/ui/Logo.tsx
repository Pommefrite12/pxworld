/** Pixel globe + wordmark. The globe is drawn on a 12×12 grid: a tiny version of the product itself. */
const ROWS = [
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
      {ROWS.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={c === "L" ? "#e8401f" : "#2b35e0"} />,
        ),
      )}
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <PixelGlobe />
      <span className="font-display text-[1.35rem] font-extrabold leading-none tracking-tight">
        pixel<span className="text-signal">world</span>
      </span>
    </span>
  );
}
