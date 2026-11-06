/** The three small pixel icons of the home page, drawn on a 12 × 12 grid like the logo's globe (gold = time and heritage, cyan = interaction). */
const ICONS = {
  select: ["............", ".cc.cc.cc.c.", ".c........c.", "............", ".c........c.", "............", ".c........c.", "............", ".c.....gg.c.", "........gggg", ".cc.cc.cggg.", "..........g."],
  archive: ["............", ".gggggggggg.", ".g........g.", ".g.vvvvvv.g.", ".g.v..yyv.g.", ".g.v.yyyv.g.", ".g.vm.yyv.g.", ".g.vmmmmv.g.", ".g.vvvvvv.g.", ".g........g.", ".gggggggggg.", "............"],
  pass: ["............", "..gggggggg..", "..g......g..", "...g....g...", "....g..g....", ".....gg.....", ".....gg.....", "....g..g....", "...g.cc.g...", "..g.cccc.g..", "..gggggggg..", "............"],
} as const;
const FILL: Record<string, string> = { c: "#55c7d1", g: "#d6ab72", y: "#ffd166", m: "#8a5a9a", v: "#46296a" };

export function PixelIcon({ name, size = 56 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {ICONS[name].flatMap((row, y) => [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={FILL[c]} />)))}
    </svg>
  );
}
