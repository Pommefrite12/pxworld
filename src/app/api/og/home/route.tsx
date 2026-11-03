import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GLOBE_ROWS } from "@/components/ui/Logo";
import { parseEnd, previewEnd } from "@/lib/doom/clock";
import { getPublicStats } from "@/lib/data/map";
import { fitSize, shareLines, shareState, type ShareLines, type ShareState } from "@/lib/og/story";

const FR = { a: "Une planète.", b: "Un milliard de pixels.", c: "Votre empreinte." };
const EN = { a: "One planet.", b: "One billion pixels.", c: "Your mark." };

const INK = "#1f2540", ORANGE = "#f04316", CYAN = "#19d3ff", MAGENTA = "#ff2e93", LAV = "#e9e5ff", LAV2 = "#dcd6ff", PAPER = "#fbf5e6", OCEAN = "#c9dfe8";
/** The same hazard stripes as the countdown plate and the strip above the header. */
const HAZARD = `repeating-linear-gradient(-45deg, ${ORANGE} 0px, ${ORANGE} 14px, ${PAPER} 14px, ${PAPER} 28px)`;

let fontData: Promise<ArrayBuffer> | null = null;
/** The site's pixel font (Jersey 10), read once. (`next.config.ts` makes sure serverless bundles carry the file.) */
function pixelFont(): Promise<ArrayBuffer> {
  fontData ??= readFile(path.join(process.cwd(), "node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff")).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  return fontData;
}

/** The pixel globe of the logo, as an image the renderer can draw. */
const globe = (() => {
  const rects = GLOBE_ROWS.flatMap((row, y) => [...row].map((c, x) => (c === "." ? "" : `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c === "L" ? ORANGE : "#2b35e0"}"/>`))).join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${rects}</svg>`)}`;
})();

/** Text with the story's fringes: a cyan copy slipped to the left and a magenta one to the right, under the text itself. */
const Glitch = ({ children, size, color, slip, style }: { children: string; size: number; color: string; slip: number; style?: Record<string, string | number> }) => (
  <div style={{ display: "flex", position: "relative", fontSize: size, lineHeight: 0.95, whiteSpace: "nowrap", ...style }}>
    <div style={{ display: "flex", position: "absolute", left: -slip, top: 0, color: CYAN }}>{children}</div>
    <div style={{ display: "flex", position: "absolute", left: slip, top: 0, color: MAGENTA }}>{children}</div>
    <div style={{ display: "flex", position: "relative", color }}>{children}</div>
  </div>
);

const Wordmark = ({ size, ink = INK }: { size: number; ink?: string }) => (
  <div style={{ display: "flex", alignItems: "center" }}>
    <img src={globe} width={size} height={size} alt="" />
    <div style={{ display: "flex", marginLeft: size * 0.3, fontSize: size * 1.15, lineHeight: 1, letterSpacing: 1 }}>
      <span style={{ color: ink }}>pixel</span><span style={{ color: ORANGE }}>world</span>
    </div>
  </div>
);

/** The ordinary image: the product's own motif, a field of pixels. */
function Plain({ lang }: { lang: typeof FR }) {
  const cells = Array.from({ length: 12 * 3 }, (_, i) => ({ i, on: ((i * 7919) ^ (i >> 2)) % 5 === 0 }));
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: OCEAN, padding: "52px 64px 56px", fontFamily: "Jersey", color: INK }}>
      <Wordmark size={52} />
      <div style={{ display: "flex", flexDirection: "column", fontSize: 112, lineHeight: 0.92, letterSpacing: 1 }}>
        <div style={{ display: "flex" }}>{lang.a}</div>
        <div style={{ display: "flex", color: ORANGE }}>{lang.b}</div>
        <div style={{ display: "flex" }}>{lang.c}</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", width: 12 * 40 }}>
        {cells.map((c) => <div key={c.i} style={{ display: "flex", width: 36, height: 36, margin: 2, background: c.on ? ORANGE : PAPER }} />)}
      </div>
    </div>
  );
}

/** The countdown: how many days are left (the real number), on the plate of the story. */
function Countdown({ lines }: { lines: ShareLines }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: OCEAN, fontFamily: "Jersey", color: INK }}>
      <div style={{ display: "flex", height: 34, background: HAZARD, borderBottom: `4px solid ${INK}` }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "34px 64px 44px" }}>
        <Wordmark size={46} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "#fffdf8", border: `6px solid ${INK}`, borderRadius: 24, padding: "22px 40px 30px", boxShadow: `10px 10px 0 rgba(31,37,64,0.2)` }}>
          <div style={{ display: "flex", fontSize: 44, letterSpacing: 3, color: INK }}>{lines.kicker}</div>
          <Glitch size={fitSize(lines.title, 980, 190)} color={INK} slip={6}>{lines.title}</Glitch>
        </div>
        <div style={{ display: "flex", justifyContent: "center", fontSize: fitSize(lines.figure, 1072, 50), color: INK, whiteSpace: "nowrap" }}>{lines.figure}</div>
      </div>
    </div>
  );
}

/** The end: the world has been deleted, and the real number of plots that survived it. */
function TheEnd({ lines }: { lines: ShareLines }) {
  // a few stray blocks of error colour on the lavender field, always at the same places
  const sparks = Array.from({ length: 26 }, (_, i) => ({ i, x: (i * 467) % 1150, y: (i * 233 + 40) % 580, c: [MAGENTA, CYAN, ORANGE, INK, "#ffffff"][i % 5]! }));
  return (
    <div style={{ display: "flex", position: "relative", flexDirection: "column", width: "100%", height: "100%", background: `repeating-linear-gradient(0deg, ${LAV} 0px, ${LAV} 4px, ${LAV2} 4px, ${LAV2} 8px)`, fontFamily: "Jersey", color: INK }}>
      {sparks.map((s) => <div key={s.i} style={{ position: "absolute", left: s.x, top: s.y, width: 16, height: 16, background: s.c }} />)}
      <div style={{ display: "flex", height: 34, background: HAZARD, borderBottom: `4px solid ${INK}` }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, padding: "34px 64px 44px" }}>
        <Wordmark size={46} />
        <div style={{ display: "flex", flexDirection: "column", background: INK, borderRadius: 18, padding: "34px 48px 40px", boxShadow: `10px 10px 0 ${MAGENTA}` }}>
          <Glitch size={fitSize(lines.title, 976, 108)} color="#ffffff" slip={4}>{lines.title}</Glitch>
          <div style={{ display: "flex", fontSize: fitSize(lines.figure, 976, 92), lineHeight: 1, marginTop: 18, color: ORANGE, whiteSpace: "nowrap" }}>{lines.figure}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 54, letterSpacing: 1 }}>
          <div style={{ display: "flex" }}>{lines.foot}</div>
          <div style={{ display: "flex", fontSize: 34, color: INK, opacity: 0.7 }}>{lines.kicker}</div>
        </div>
      </div>
    </div>
  );
}

/** Share image for the home page and any page without a specific one. It follows the story: ordinary, countdown, or the end. */
export async function GET(req: Request) {
  const url = new URL(req.url), lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
  const now = Date.now();
  // the real end date; `?preview=` shows a moment of the story (the same words as the site's own preview), with real figures
  const end = url.searchParams.has("preview") ? previewEnd(url.searchParams.get("preview"), now) : parseEnd(process.env.NEXT_PUBLIC_WORLD_END_AT);
  const state: ShareState = shareState(end, now);
  const survivors = state.kind === "end" ? await getPublicStats().then((s) => s.parcels).catch(() => null) : null;
  const lines = shareLines(lang, state, survivors);
  const fonts = [{ name: "Jersey", data: await pixelFont(), weight: 400 as const, style: "normal" as const }];
  // the plain image keeps for a day; the countdown changes with the day; the end changes with every plot that is claimed
  const cache = state.kind === "end" ? "public, max-age=300, s-maxage=900, stale-while-revalidate=3600" : state.kind === "countdown" ? "public, max-age=900, s-maxage=3600" : "public, max-age=3600, s-maxage=86400";
  return new ImageResponse(
    state.kind === "plain" || !lines ? <Plain lang={lang === "fr" ? FR : EN} /> : state.kind === "countdown" ? <Countdown lines={lines} /> : <TheEnd lines={lines} />,
    { width: 1200, height: 630, fonts, headers: { "Cache-Control": cache } },
  );
}
