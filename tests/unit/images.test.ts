import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageError, MAX_UPLOAD_BYTES, processAvatar, processCreation, sniffType } from "@/lib/images/validate";

const solid = (w: number, h: number, c = { r: 255, g: 0, b: 0 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } });

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
  await expect(p).rejects.toBeInstanceOf(ImageError);
}

describe("processCreation", () => {
  it("accepts PNG, JPEG and WebP at the exact parcel size and re-encodes to canonical PNG", async () => {
    for (const buf of [await solid(20, 10).png().toBuffer(), await solid(20, 10).jpeg().toBuffer(), await solid(20, 10).webp().toBuffer()]) {
      const out = await processCreation(buf, { w: 20, h: 10 });
      expect(sniffType(out.png)).toBe("png");
      expect(out).toMatchObject({ width: 20, height: 10 });
      expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(out.avgColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("is deterministic: identical input → identical bytes and hash", async () => {
    const buf = await solid(20, 20, { r: 10, g: 200, b: 90 }).png().toBuffer();
    const a = await processCreation(buf, { w: 20, h: 20 });
    const b = await processCreation(buf, { w: 20, h: 20 });
    expect(a.sha256).toBe(b.sha256);
    expect(a.avgColor).toBe("#0ac85a");
  });
  it("rejects the wrong dimensions (pixel count must be exact)", async () => {
    await expectCode(processCreation(await solid(20, 10).png().toBuffer(), { w: 10, h: 20 }), "bad_dimensions");
    await expectCode(processCreation(await solid(21, 10).png().toBuffer(), { w: 20, h: 10 }), "bad_dimensions");
  });
  it("refuses SVG, even well-formed ones with scripts", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expectCode(processCreation(svg, { w: 10, h: 10 }), "svg_forbidden");
    await expectCode(processCreation(Buffer.from('<?xml version="1.0"?><svg></svg>'), { w: 10, h: 10 }), "svg_forbidden");
  });
  it("refuses executables and scripts, whatever the extension claims", async () => {
    await expectCode(processCreation(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]), { w: 10, h: 10 }), "executable_forbidden");
    await expectCode(processCreation(Buffer.concat([Buffer.from([0x7f]), Buffer.from("ELF"), Buffer.alloc(200)]), { w: 10, h: 10 }), "executable_forbidden");
    await expectCode(processCreation(Buffer.from("#!/bin/sh\nrm -rf /\n"), { w: 10, h: 10 }), "executable_forbidden");
    await expectCode(processCreation(Buffer.from("<html><script>1</script></html>"), { w: 10, h: 10 }), "executable_forbidden");
  });
  it("refuses unknown formats (GIF, BMP, random bytes)", async () => {
    await expectCode(processCreation(Buffer.from("GIF89a" + "x".repeat(50)), { w: 10, h: 10 }), "unsupported_type");
    await expectCode(processCreation(Buffer.from("BM" + "x".repeat(50)), { w: 10, h: 10 }), "unsupported_type");
  });
  it("refuses corrupt images that merely carry a valid signature", async () => {
    const png = await solid(20, 20).png().toBuffer();
    await expectCode(processCreation(png.subarray(0, 40), { w: 20, h: 20 }), "corrupt");
    await expectCode(processCreation(Buffer.alloc(0), { w: 20, h: 20 }), "corrupt");
  });
  it("refuses files over the size limit", async () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    await expectCode(processCreation(big, { w: 10, h: 10 }), "too_large");
  });
  it("refuses animated images (APNG and animated WebP)", async () => {
    const png = await solid(10, 10).png().toBuffer();
    const actl = Buffer.alloc(20);
    actl.writeUInt32BE(8, 0);
    actl.write("acTL", 4, "ascii");
    const apng = Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]); // right after IHDR
    await expectCode(processCreation(apng, { w: 10, h: 10 }), "animated");

    const riff = Buffer.alloc(30);
    riff.write("RIFF", 0, "ascii"); riff.writeUInt32LE(22, 4); riff.write("WEBP", 8, "ascii");
    riff.write("VP8X", 12, "ascii"); riff.writeUInt32LE(10, 16); riff[20] = 0x02; // animation flag
    await expectCode(processCreation(riff, { w: 10, h: 10 }), "animated");
  });
  it("drops metadata and trailing payloads", async () => {
    const png = await solid(20, 20).withMetadata({ exif: { IFD0: { Copyright: "secret-exif-marker" } } }).png().toBuffer();
    const tampered = Buffer.concat([png, Buffer.from("<script>trailing-payload</script>")]);
    const out = await processCreation(tampered, { w: 20, h: 20 });
    expect(out.png.includes("trailing-payload")).toBe(false);
    expect(out.png.includes("secret-exif-marker")).toBe(false);
  });
  describe("has no transparency: everything is flattened onto white", () => {
    const pixels = async (png: Buffer) => {
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data, channels: info.channels };
    };
    const px = (d: Buffer, i: number) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]];

    it("a fully transparent PNG becomes plain white", async () => {
      const buf = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
      const out = await processCreation(buf, { w: 10, h: 10 });
      const { data } = await pixels(out.png);
      for (let i = 0; i < 100; i++) expect(px(data, i), `pixel ${i}`).toEqual([255, 255, 255, 255]);
      expect((await sharp(out.png).metadata()).hasAlpha).toBe(false); // the stored file does not even carry an alpha channel
    });

    it("a cut-out keeps its opaque part and loses its transparent part", async () => {
      const raw = Buffer.alloc(10 * 10 * 4);
      for (let i = 0; i < 100; i++) raw.set(i < 50 ? [200, 30, 30, 255] : [0, 0, 0, 0], i * 4); // top half red, bottom half empty
      const out = await processCreation(await sharp(raw, { raw: { width: 10, height: 10, channels: 4 } }).png().toBuffer(), { w: 10, h: 10 });
      const { data } = await pixels(out.png);
      expect(px(data, 10)).toEqual([200, 30, 30, 255]);
      expect(px(data, 90)).toEqual([255, 255, 255, 255]);
    });

    it("semi-transparent pixels are blended with white, WebP included", async () => {
      const half = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer();
      const out = await processCreation(half, { w: 10, h: 10 });
      const { data } = await pixels(out.png);
      const [r, g, b, a] = px(data, 0) as number[];
      expect(a).toBe(255);
      expect(r).toBeGreaterThan(120); expect(r).toBeLessThan(135); // black at 50 % over white ≈ mid grey
      expect([r, g]).toEqual([g, b]);
    });
  });
});

describe("processAvatar", () => {
  it("returns a 256×256 PNG", async () => {
    const { png } = await processAvatar(await solid(500, 300).jpeg().toBuffer());
    const m = await sharp(png).metadata();
    expect([m.width, m.height, m.format]).toEqual([256, 256, "png"]);
  });
  it("refuses SVG", async () => {
    await expect(processAvatar(Buffer.from("<svg></svg>"))).rejects.toMatchObject({ code: "svg_forbidden" });
  });
});
