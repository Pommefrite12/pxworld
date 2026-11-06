import { crc32 } from "node:zlib";

/**
 * A minimal ZIP writer, with no dependency: every file is STORED (the pictures are PNG, already compressed), one file is held in memory at a
 * time, and the output goes to a sink as it is made — so an archive of thousands of creations is written in a flat, small amount of memory.
 *
 * A plain ZIP (not ZIP64) holds at most 65 535 files and 4 GiB: beyond that `add`/`finish` refuse, with a message that points to the folder
 * (which has no limit and is what `npm run archive:export` always produces first). Names are UTF-8.
 */
export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

export class ZipTooLargeError extends Error {
  constructor(what: string) { super(`${what}: too large for a plain ZIP file (at most ${ZIP_MAX_ENTRIES} files and 4 GiB). Use the folder, which has no limit.`); }
}

/** MS-DOS time and date, which is all a ZIP header can say (years 1980–2107, two-second steps). */
function dosDateTime(d: Date): { time: number; date: number } {
  const y = Math.min(2107, Math.max(1980, d.getUTCFullYear()));
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}

interface Entry { name: Buffer; crc: number; size: number; offset: number }

export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private stamp: { time: number; date: number };

  /** `sink` receives the bytes in order; `when` is the date every file is stamped with (a fixed one makes the same input give the same bytes). */
  constructor(private sink: (chunk: Buffer) => Promise<void>, when: Date) { this.stamp = dosDateTime(when); }

  private async emit(b: Buffer) { await this.sink(b); this.offset += b.length; }

  async add(name: string, data: Uint8Array): Promise<void> {
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) throw new Error(`bad name in a ZIP: ${JSON.stringify(name)}`);
    if (this.entries.length >= ZIP_MAX_ENTRIES) throw new ZipTooLargeError(`${this.entries.length + 1} files`);
    if (data.length > ZIP_MAX_BYTES || this.offset + data.length + 1024 > ZIP_MAX_BYTES) throw new ZipTooLargeError("the total size");
    const nm = Buffer.from(name, "utf8"), crc = crc32(data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); // version 2.0, UTF-8 names, stored
    h.writeUInt16LE(this.stamp.time, 10); h.writeUInt16LE(this.stamp.date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
    this.entries.push({ name: nm, crc, size: data.length, offset: this.offset });
    await this.emit(h); await this.emit(nm); await this.emit(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }

  /** Writes the central directory and the end record. Nothing may be added afterwards. */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
      c.writeUInt16LE(this.stamp.time, 12); c.writeUInt16LE(this.stamp.date, 14);
      c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38);
      c.writeUInt32LE(e.offset, 42);
      await this.emit(c); await this.emit(e.name);
    }
    const size = this.offset - start;
    if (this.offset + 22 > ZIP_MAX_BYTES) throw new ZipTooLargeError("the total size");
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(start, 16); end.writeUInt16LE(0, 20);
    await this.emit(end);
  }
}

/** Reads a (plain, stored) ZIP back: the names and the bytes of its files, checking every CRC. For tests and for `verify` on a ZIP made here. */
export function readZip(zip: Uint8Array): Map<string, Uint8Array> {
  const b = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a ZIP file (no end record)");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("damaged central directory");
    const method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), size = b.readUInt32LE(p + 24), nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    if (method !== 0) throw new Error("only stored entries are supported");
    const name = b.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = b.readUInt16LE(off + 26), lxlen = b.readUInt16LE(off + 28), dataStart = off + 30 + lnlen + lxlen;
    const data = b.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    out.set(name, new Uint8Array(data));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
