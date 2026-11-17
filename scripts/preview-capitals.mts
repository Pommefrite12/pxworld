// Draws the illustrations of the capitals (src/lib/demo/capitals.ts) to PNG files and contact sheets, to LOOK at them before seeding a site:
//   NODE_OPTIONS=--conditions=react-server npx tsx scripts/preview-capitals.mts <folder> [paris,miami,…]
// Writes <id>.png (as stored: a quarter of a grid pixel per dot) and sheet-1.png, sheet-2.png… (six pictures each). Touches no database, no site.
import fs from "node:fs";
import sharp from "sharp";
import { CAPITALS } from "../src/lib/demo/capitals";
import { Photo } from "../src/lib/demo/photo";

const out = process.argv[2]!, only = process.argv[3]?.split(",");
const sheet: { id: string; png: Buffer; size: number }[] = [];
for (const e of CAPITALS) {
  if (only && !only.includes(e.id)) continue;
  const t0 = performance.now();
  const k = new Photo(e.size, 9000, 4); e.draw(k); const r = k.finishPhoto();
  const png = await sharp(Buffer.from(r.data), { raw: { width: r.w, height: r.h, channels: 3 } }).png().toBuffer();
  fs.writeFileSync(`${out}/${e.id}.png`, png);
  console.log(e.id.padEnd(10), e.size, `${Math.round(performance.now() - t0)} ms`, `${Math.round(png.length / 1024)} kB`);
  sheet.push({ id: e.id, png, size: e.size });
}
// contact sheets of 6 pictures (3 × 2) at 420 px each
const T = 420;
for (let n = 0; n * 6 < sheet.length; n++) {
  const part = sheet.slice(n * 6, n * 6 + 6), cols = Math.min(3, part.length), rows = Math.ceil(part.length / cols);
  const comps = await Promise.all(part.map(async (s, i) => ({ input: await sharp(s.png).resize(T, T, { kernel: "nearest" }).png().toBuffer(), left: (i % cols) * T, top: Math.floor(i / cols) * T })));
  await sharp({ create: { width: cols * T, height: rows * T, channels: 3, background: "#111" } }).composite(comps).png().toFile(`${out}/sheet-${n + 1}.png`);
}
process.exit(0);
