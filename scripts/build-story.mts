// Prepares the pictures of the story ("Learn more" button) from the owner's originals.
//
//   npx tsx scripts/build-story.mts
//
// Reads `assets/story-source/N.jpg` (1920 × 1080, numbered in the order of the story: 2, 3, 4 …) and writes
// `public/story/panel-1.webp … panel-8.webp` (1280 × 720): lighter to load, still sharp. The originals are NOT in `public/` (they are not served).
// The captions are part of the owner's pictures (in French); the page also writes them as text, translated, under each picture.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve("assets/story-source"), OUT = path.resolve("public/story");
const files = fs.readdirSync(SRC).filter((f) => /^\d+\.(jpe?g|png|webp)$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
if (!files.length) { console.error(`No picture in ${SRC}`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^panel-\d+\.(png|webp)$/.test(f)) fs.rmSync(path.join(OUT, f)); // the old ones go
(async () => {
  let total = 0;
  for (const [i, f] of files.entries()) {
    const out = path.join(OUT, `panel-${i + 1}.webp`);
    const buf = await sharp(path.join(SRC, f)).resize(1280, 720, { fit: "cover", kernel: "lanczos3" }).webp({ quality: 88, effort: 5 }).toBuffer();
    fs.writeFileSync(out, buf);
    total += buf.length;
    console.log(`${f.padEnd(8)} → panel-${i + 1}.webp  ${(buf.length / 1024).toFixed(0)} KB`);
  }
  console.log(`${files.length} pictures, ${(total / 1024).toFixed(0)} KB in all`);
})();
