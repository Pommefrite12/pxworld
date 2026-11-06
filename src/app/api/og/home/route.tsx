import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { GLOBE_ROWS } from "@/components/ui/Logo";

/** The words of the share image of the home page (and of every page that has no image of its own). */
const TEXT = {
  fr: { kicker: "ARCHIVE COLLECTIVE", a: "Dans", hl: "100 ans,", b: "que restera-t-il", c: "de nous ?", foot: "Laissez votre trace." },
  en: { kicker: "COLLECTIVE ARCHIVE", a: "In", hl: "100 years,", b: "what will remain", c: "of us?", foot: "Leave your trace." },
};

// the night palette of the archive (the same as the site's)
const NIGHT = "#190921", VIOLET = "#382050", VIOLET_DEEP = "#2a1640", GOLD = "#d6ab72", CYAN = "#55c7d1", IVORY = "#f1e8df";

let fontData: Promise<ArrayBuffer> | null = null;
/** The site's pixel font (Jersey 10), read once. (`next.config.ts` makes sure serverless bundles carry the file.) */
function pixelFont(): Promise<ArrayBuffer> {
  fontData ??= readFile(path.join(process.cwd(), "node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff")).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  return fontData;
}

/** The pixel globe of the logo, as an image the renderer can draw (cyan sea, gold land). */
const globe = (() => {
  const rects = GLOBE_ROWS.flatMap((row, y) => [...row].map((c, x) => (c === "." ? "" : `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c === "L" ? GOLD : CYAN}"/>`))).join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${rects}</svg>`)}`;
})();

const Wordmark = ({ size }: { size: number }) => (
  <div style={{ display: "flex", alignItems: "center" }}>
    <img src={globe} width={size} height={size} alt="" />
    <div style={{ display: "flex", marginLeft: size * 0.3, fontSize: size * 1.15, lineHeight: 1, letterSpacing: 1 }}>
      <span style={{ color: IVORY }}>pixel</span><span style={{ color: GOLD }}>world</span>
    </div>
  </div>
);

/** A row of pixels, like the product's own motif: a few of them are lit (the traces left by people). Always the same ones. */
function Pixels() {
  const cells = Array.from({ length: 30 }, (_, i) => ({ i, c: i % 7 === 3 ? CYAN : i % 11 === 5 ? GOLD : ((i * 7919) ^ (i >> 2)) % 3 === 0 ? VIOLET : VIOLET_DEEP }));
  return (
    <div style={{ display: "flex", width: 30 * 30 }}>
      {cells.map((c) => <div key={c.i} style={{ display: "flex", width: 26, height: 26, margin: 2, background: c.c }} />)}
    </div>
  );
}

/** Share image for the home page and any page without a specific one: 1200 × 630, in the language asked (`?lang=fr`, otherwise English). */
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") === "fr" ? "fr" : "en", t = TEXT[lang];
  const fonts = [{ name: "Jersey", data: await pixelFont(), weight: 400 as const, style: "normal" as const }];
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: NIGHT, padding: "52px 64px 56px", fontFamily: "Jersey", color: IVORY }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Wordmark size={52} />
          <div style={{ display: "flex", fontSize: 40, letterSpacing: 4, color: GOLD }}>{t.kicker}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 128, lineHeight: 0.92, letterSpacing: 1 }}>
          <div style={{ display: "flex" }}><span>{t.a}&nbsp;</span><span style={{ color: GOLD }}>{t.hl}</span></div>
          <div style={{ display: "flex" }}>{t.b}</div>
          <div style={{ display: "flex" }}>{t.c}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Pixels />
          <div style={{ display: "flex", fontSize: 48, color: CYAN }}>{t.foot}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
