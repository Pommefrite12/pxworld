import { readFile } from "node:fs/promises";
import path from "node:path";
import { GLOBE_ROWS } from "@/components/ui/Logo";

/** What the share images have in common: the night palette of the site, its pixel font, its logo. */
export const NIGHT = "#190921", VIOLET = "#382050", VIOLET_DEEP = "#2a1640", GOLD = "#d6ab72", CYAN = "#55c7d1", IVORY = "#f1e8df";

let fontData: Promise<ArrayBuffer> | null = null;
/** The site's pixel font (Jersey 10), read once. (`next.config.ts` makes sure serverless bundles carry the file, for every route that calls this.) */
export function pixelFont(): Promise<ArrayBuffer> {
  fontData ??= readFile(path.join(process.cwd(), "node_modules/@fontsource/jersey-10/files/jersey-10-latin-400-normal.woff")).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  return fontData;
}

/** What the pixel font can draw (its "latin" file): a text outside of it (Japanese, Cyrillic, emoji…) must be set in the renderer's default font instead. */
export const fitsPixelFont = (text: string) => /^[ -~ -ÿ–—‘’“”…€]*$/.test(text);

/** The pixel globe of the logo, as an image the renderer can draw (cyan sea, gold land). */
const globe = (() => {
  const rects = GLOBE_ROWS.flatMap((row, y) => [...row].map((c, x) => (c === "." ? "" : `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c === "L" ? GOLD : CYAN}"/>`))).join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${rects}</svg>`)}`;
})();

/** The logo: the globe and the name, in the font of the parent. */
export const Wordmark = ({ size }: { size: number }) => (
  <div style={{ display: "flex", alignItems: "center" }}>
    <img src={globe} width={size} height={size} alt="" />
    <div style={{ display: "flex", marginLeft: size * 0.3, fontSize: size * 1.15, lineHeight: 1, letterSpacing: 1 }}>
      <span style={{ color: IVORY }}>pixel</span><span style={{ color: GOLD }}>world</span>
    </div>
  </div>
);
