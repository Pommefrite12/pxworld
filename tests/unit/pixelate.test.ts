import { describe, expect, it } from "vitest";
import { CAPITALS } from "@/lib/demo/capitals";
import { alignedBlocks, blockColours, blocksAcross, enlarge, toPalette } from "@/lib/demo/pixelate";
import type { Raster } from "@/lib/demo/art";

const raster = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Raster => {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 3);
  return { w, h, data };
};
const px = (r: Raster, x: number, y: number) => [...r.data.subarray((y * r.w + x) * 3, (y * r.w + x) * 3 + 3)];

describe("pixel art out of a soft picture", () => {
  it("a block takes the colour most of its dots have, never an average of two", () => {
    // one 4 × 4 block: 11 dots red, 5 dots blue → red (an average would be a purple that is nowhere in the picture)
    const r = raster(4, 4, (x, y) => (y * 4 + x < 11 ? [200, 0, 0] : [0, 0, 200]));
    expect(px(blockColours(r, 1, 1), 0, 0)).toEqual([200, 0, 0]);
  });

  it("cuts the picture into the blocks asked for, each a flat square once enlarged", () => {
    const r = raster(8, 8, (x, y) => [x * 30, y * 30, 0]);
    const blocks = blockColours(r, 2);
    expect([blocks.w, blocks.h]).toEqual([2, 2]);
    const big = enlarge(blocks, 8, 8);
    for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
      const first = px(big, bx * 4, by * 4);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(px(big, bx * 4 + x, by * 4 + y)).toEqual(first);
    }
  });

  it("brings the colours down to the palette asked for (no dithering: the same colour stays the same colour)", async () => {
    const r = raster(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2]);
    const q = await toPalette(r, 16);
    const colours = new Set<number>();
    for (let o = 0; o < q.data.length; o += 3) colours.add((q.data[o]! << 16) | (q.data[o + 1]! << 8) | q.data[o + 2]!);
    expect(colours.size).toBeLessThanOrEqual(16);
    expect(await toPalette(r, 16)).toEqual(q); // deterministic
  });

  it("how many blocks across: the art's own count divided by the factor, never finer than 140 (a painting next to pixel art), never under 24", () => {
    expect(blocksAcross(200, 1.5)).toBe(133);
    expect(blocksAcross(114, 1.5)).toBe(76);
    expect(blocksAcross(360, 1.5), "fine art: capped").toBe(140);
    expect(blocksAcross(30, 2), "tiny: at least 24").toBe(24);
    expect(blocksAcross(200, 1)).toBe(140);
  });

  it("finds blocks of a whole number of dots near the number wanted, at the smallest scale that allows it", () => {
    expect(alignedBlocks(160, 133)).toEqual({ k: 3, cols: 120, dots: 4 }); // 480 dots = 120 blocks of 4
    const a = alignedBlocks(140, 140)!;
    expect(a).toEqual({ k: 1, cols: 140, dots: 1 }); // a block is exactly one pixel of the grid
    expect(alignedBlocks(7, 1000, 2, 0)).toBeNull();
  });

  it("every capital gets such an alignment at the default setting, within the 10 scales and the 4-million-dot cap the site accepts", () => {
    for (const c of CAPITALS) {
      const target = blocksAcross({ paris: 200, miami: 209, londres: 157, tokyo: 209, pekin: 250, delhi: 114, lecaire: 105, moscou: 209, mexico: 360, buenosaires: 209, seoul: 209, bangkok: 250, jakarta: 180, washington: 313, berlin: 360 }[c.id]!, 1.5);
      const a = alignedBlocks(c.size, target);
      expect(a, c.id).not.toBeNull();
      expect(a!.k, c.id).toBeLessThanOrEqual(10);
      expect((c.size * a!.k) ** 2, c.id).toBeLessThanOrEqual(4_000_000);
      expect(Math.abs(a!.cols - target) / target, c.id).toBeLessThanOrEqual(0.1);
    }
  });
});
