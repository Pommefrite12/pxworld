import { ImageResponse } from "next/og";

const FR = { a: "Une planète.", b: "Un milliard de pixels.", c: "Votre empreinte." };
const EN = { a: "One planet.", b: "One billion pixels.", c: "Your mark." };

/** Generic share image for the home page and any page without a specific one. */
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") === "fr" ? FR : EN;
  // a deterministic pixel field: the product's own motif
  const cells = Array.from({ length: 12 * 5 }, (_, i) => ({ i, on: ((i * 7919) ^ (i >> 2)) % 5 === 0 }));
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: "#c9dfe8", padding: 64, fontFamily: "sans-serif", color: "#17151f" }}>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 800, letterSpacing: -2 }}>pixel<span style={{ color: "#e8401f" }}>world</span></div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 96, fontWeight: 800, lineHeight: 1, letterSpacing: -4 }}>
          <div style={{ display: "flex" }}>{lang.a}</div>
          <div style={{ display: "flex", color: "#e8401f" }}>{lang.b}</div>
          <div style={{ display: "flex" }}>{lang.c}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", width: 12 * 40 }}>
          {cells.map((c) => <div key={c.i} style={{ display: "flex", width: 36, height: 36, margin: 2, background: c.on ? "#e8401f" : "#fbf5e6" }} />)}
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
