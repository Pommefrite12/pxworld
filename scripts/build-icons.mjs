// Builds the site icons (src/app/icon.svg, icon.png, favicon.ico, apple-icon.png) from the logo's globe — the same 12×12 grid as
// src/components/ui/Logo.tsx. Run: node scripts/build-icons.mjs   (the generated files are committed).
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../src/app");
const ROWS = ["...oooooo...", "..oooLLooLo.", ".ooLLLoooLLo", ".oLLLLLooLLo", "oooLLLoooooo", "ooooLLLoooLo", "oooooLLLooLo", "ooooooLLLooo", ".oooooLLoooo", ".ooLooLooooo", "..oooooooLo.", "...oooooo..."];
const BLUE = "#55c7d1", ORANGE = "#d6ab72", CREAM = "#190921"; // the globe in the archive's palette: cyan sea, gold land, on the violet night (the names are those of the old palette)
const cells = (ox = 0, oy = 0) => ROWS.flatMap((row, y) => [...row].map((c, x) => c === "." ? "" : `<rect x="${x + ox}" y="${y + oy}" width="1.02" height="1.02" fill="${c === "L" ? ORANGE : BLUE}"/>`)).join("");

// icon.svg: the globe alone, transparent corners (reads on light and dark tabs)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">${cells()}</svg>\n`;
fs.writeFileSync(`${OUT}/icon.svg`, svg);

(async () => {
  const big = await sharp(Buffer.from(svg), { density: 4800 }).resize(1200, 1200).png().toBuffer(); // 100 px per cell: exact, then reduced with a good filter
  const at = (n) => sharp(big).resize(n, n, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();

  // favicon.ico: 16, 32 and 48 px, PNG-compressed entries
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map(at));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((n, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(n, 0); e.writeUInt8(n, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += pngs[i].length; return e;
  });
  fs.writeFileSync(`${OUT}/favicon.ico`, Buffer.concat([head, ...dir, ...pngs]));

  // apple-icon.png: iOS fills transparency with black, so the globe sits on the site's night violet, 11 px per cell
  const globe = await sharp(big).resize(132, 132, { kernel: "nearest" }).png().toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: CREAM } }).composite([{ input: globe, left: 24, top: 24 }]).png({ compressionLevel: 9 }).toFile(`${OUT}/apple-icon.png`);

  // icon.png 512: for browsers/stores that want a bitmap (transparent)
  fs.writeFileSync(`${OUT}/icon.png`, await at(512));
  console.log("icons written to", OUT);
})();
