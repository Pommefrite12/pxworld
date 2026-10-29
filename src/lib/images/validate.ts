import { createHash } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";

/** Hard limits for uploaded creations. The raster is exactly the parcel's size (≤ 1000 × 1000). */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 1_000 * 1_000;

export class ImageError extends Error {
  constructor(public code:
    | "too_large" | "unsupported_type" | "svg_forbidden" | "executable_forbidden" | "corrupt" | "animated"
    | "bad_dimensions" | "too_many_pixels", message?: string) {
    super(message ?? code);
  }
}

export type Sniffed = "png" | "jpeg" | "webp" | "svg" | "executable" | "unknown";

/** Detects the REAL type from the content. File names and client-declared MIME types are ignored. */
export function sniffType(b: Buffer): Sniffed {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  const head = b.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg")) || head.startsWith("<!doctype svg")) return "svg";
  const mz = b[0] === 0x4d && b[1] === 0x5a; // Windows PE
  const elf = b.length > 4 && b[0] === 0x7f && b.toString("ascii", 1, 4) === "ELF";
  const macho = b.length > 4 && [0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcefaedfe, 0xcffaedfe].includes(b.readUInt32BE(0));
  const shebang = b[0] === 0x23 && b[1] === 0x21;
  if (mz || elf || macho || shebang || head.startsWith("<script") || head.startsWith("<html") || head.startsWith("<!doctype html")) return "executable";
  return "unknown";
}

/** APNG (acTL chunk before the first IDAT) and animated WebP (VP8X animation flag / ANIM chunk). */
export function isAnimated(b: Buffer, kind: Sniffed): boolean {
  if (kind === "png") {
    let off = 8;
    while (off + 8 <= b.length) {
      const len = b.readUInt32BE(off);
      const type = b.toString("ascii", off + 4, off + 8);
      if (type === "acTL") return true;
      if (type === "IDAT" || type === "IEND") return false;
      off += 12 + len;
    }
    return false;
  }
  if (kind === "webp") {
    let off = 12;
    while (off + 8 <= b.length) {
      const type = b.toString("ascii", off, off + 4);
      const len = b.readUInt32LE(off + 4);
      if (type === "ANIM" || type === "ANMF") return true;
      if (type === "VP8X" && off + 9 <= b.length && ((b[off + 8] ?? 0) & 0x02) !== 0) return true;
      off += 8 + len + (len % 2);
    }
  }
  return false;
}

export interface ProcessedImage {
  png: Buffer;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  avgColor: string;
}

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

async function averageColor(png: Buffer): Promise<string> {
  const { data } = await sharp(png).flatten({ background: "#d8e6ec" }).resize(1, 1, { kernel: "cubic", fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return `#${hex(data[0] ?? 0)}${hex(data[1] ?? 0)}${hex(data[2] ?? 0)}`;
}

/**
 * Validates an uploaded creation and returns a canonical PNG.
 *  - size cap, content sniffing (SVG and executables are always refused), decompression-bomb guard
 *  - the pixels are decoded and RE-ENCODED: metadata, embedded payloads and trailing bytes are dropped
 *  - dimensions must match the parcel EXACTLY (the client renders at the parcel's resolution)
 */
export async function processCreation(input: Buffer, expected: { w: number; h: number }): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageError("corrupt");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("too_large");
  const kind = sniffType(input);
  if (kind === "svg") throw new ImageError("svg_forbidden");
  if (kind === "executable") throw new ImageError("executable_forbidden");
  if (kind === "unknown") throw new ImageError("unsupported_type");
  if (isAnimated(input, kind)) throw new ImageError("animated");

  let decoded: { data: Buffer; info: OutputInfo };
  try {
    decoded = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (e) {
    if (e instanceof ImageError) throw e;
    if (/pixel limit|exceeds/i.test(String((e as Error).message))) throw new ImageError("too_many_pixels");
    throw new ImageError("corrupt");
  }
  const { width, height } = decoded.info;
  if (width !== expected.w || height !== expected.h) throw new ImageError("bad_dimensions", `${width}x${height} ≠ ${expected.w}x${expected.h}`);

  const png = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return {
    png, width, height, bytes: png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
    avgColor: await averageColor(png),
  };
}

/** Square avatar (256 px, PNG) from any supported image. */
export async function processAvatar(input: Buffer): Promise<{ png: Buffer; sha256: string }> {
  if (input.length === 0 || input.length > MAX_UPLOAD_BYTES) throw new ImageError(input.length ? "too_large" : "corrupt");
  const kind = sniffType(input);
  if (kind === "svg") throw new ImageError("svg_forbidden");
  if (kind === "executable") throw new ImageError("executable_forbidden");
  if (kind === "unknown") throw new ImageError("unsupported_type");
  try {
    const png = await sharp(input, { limitInputPixels: 25_000_000, failOn: "error", animated: false })
      .rotate().resize(256, 256, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer();
    return { png, sha256: createHash("sha256").update(png).digest("hex") };
  } catch {
    throw new ImageError("corrupt");
  }
}
