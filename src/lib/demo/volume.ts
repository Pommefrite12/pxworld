/**
 * VOLUME mode of the demonstration tool: fills a TEST site with a LOT of parcels (thousands), to see how the map, the lists, the counters and the
 * server behave when the world is full. Where the normal mode makes one account per parcel (slow: an account is a call to Supabase), this one:
 *  - makes a few dozen accounts only (`demo-vol-001@…`), who own the parcels at random;
 *  - draws a small stock of pictures (8 sizes × 6 pictures) and lets every parcel use one of them (a file per parcel would be 20 000 uploads);
 *  - inserts the parcels and their creations by batches of a thousand, straight in the database, already approved and published;
 *  - puts a marker in each creation's translations so that the automatic translation never spends anything on them.
 * Like the rest of the tool: no order, no payment, no fake revenue; everything is removed by `clearDemo` (the accounts match `demo-%@<domain>`).
 * Running it again with a bigger number completes (it counts what is there), it never doubles.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { processCreation } from "@/lib/images/validate";
import { lonLatToPixel } from "@/lib/grid/geometry";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { CATEGORIES } from "@/lib/archive";
import { ART_STYLES, renderArt, rng } from "./art";
import { ANCHORS, DESCRIPTIONS, TITLES } from "./plan";
import type { DemoPorts, Rect } from "./seed";

/** The sizes of the parcels (all at least 25 pixels: a paid parcel's minimum) and how common each one is. Mostly small, like a real map. */
export const VOLUME_SIZES: readonly { w: number; h: number; weight: number }[] = [
  { w: 5, h: 5, weight: 25 }, { w: 6, h: 6, weight: 20 }, { w: 8, h: 8, weight: 20 }, { w: 10, h: 10, weight: 15 },
  { w: 12, h: 12, weight: 8 }, { w: 16, h: 16, weight: 6 }, { w: 20, h: 20, weight: 4 }, { w: 30, h: 30, weight: 2 },
];
/** Pictures drawn per size. */
export const VOLUME_PICTURES_PER_SIZE = 6;
const MIN_LAND_SHARE = 0.85;
const CELL = 64; // the side of the squares of the occupancy index

export interface VolumeOptions { count: number; /** Accounts that own the parcels (1 to 300, 40 by default). */ owners?: number; emailDomain: string; seed?: number; now?: number; batch?: number }
export interface VolumeReport { owners: number; ownersCreated: number; existing: number; created: number; /** Parcels it could not place (no free land found). */ short: number; pictures: number }

const sqlLikeVol = (domain: string) => `demo-vol-%@${domain}`;

/** The number of parcels, over the whole world, that nothing prevents from being placed: a cheap occupancy index (squares of 64 pixels). */
class Occupancy {
  private cells = new Map<number, Rect[]>();
  private key = (cx: number, cy: number) => cx * 4096 + cy;
  add(r: Rect) { for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w - 1) / CELL); cx++) for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h - 1) / CELL); cy++) { const k = this.key(cx, cy), a = this.cells.get(k); if (a) a.push(r); else this.cells.set(k, [r]); } }
  hits(r: Rect): boolean {
    for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w - 1) / CELL); cx++) for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h - 1) / CELL); cy++)
      for (const o of this.cells.get(this.key(cx, cy)) ?? []) if (r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h) return true;
    return false;
  }
}

/** A picture of the stock: drawn at the start, uploaded only when a parcel first uses it (so that no file is left unreferenced, and `clear` leaves none behind). */
interface Picture { path: string; hash: string; bytes: number; avg: string; w: number; h: number; png: Buffer; stored: boolean }

export async function seedVolume(p: DemoPorts, opts: VolumeOptions): Promise<VolumeReport> {
  const owners = Math.max(1, Math.min(300, Math.floor(opts.owners ?? 40))), now = opts.now ?? Date.now(), batch = opts.batch ?? 1000, R = rng((opts.seed ?? 1) * 7919 + 13), g = () => R.next();
  const report: VolumeReport = { owners, ownersCreated: 0, existing: 0, created: 0, short: 0, pictures: 0 };

  // 1. the accounts (found when they are there already)
  const known = new Map((await p.query<{ id: string; email: string }>("select id, email from auth.users where email like $1", [sqlLikeVol(opts.emailDomain)])).map((r) => [r.email, r.id]));
  const ids: string[] = [];
  for (let i = 1; i <= owners; i++) {
    const email = `demo-vol-${String(i).padStart(3, "0")}@${opts.emailDomain}`;
    let id = known.get(email);
    if (!id) {
      id = await p.createUser(email, `demo_vol_${String(i).padStart(3, "0")}`);
      await p.query("update public.profiles set country = $2, bio = $3 where id = $1", [id, ANCHORS[i % ANCHORS.length]!.country, "Compte de démonstration (volume, site de test)."]);
      report.ownersCreated++;
    }
    ids.push(id);
  }
  // 2. what is there already
  const [have] = await p.query<{ n: number }>("select count(*)::int as n from public.parcels where owner_id = any($1::uuid[]) and status = 'active'", [ids]);
  report.existing = Number(have?.n ?? 0);
  const toMake = Math.max(0, opts.count - report.existing);
  if (toMake === 0) return report;

  // 3. the stock of pictures: drawn, checked by the pipeline of real uploads, stored once
  const pictures = new Map<string, Picture[]>();
  for (const s of VOLUME_SIZES) {
    const list: Picture[] = [];
    for (let k = 0; k < VOLUME_PICTURES_PER_SIZE; k++) {
      const style = ART_STYLES[(k + s.w) % ART_STYLES.length]!, title = TITLES[(k * 7 + s.w) % TITLES.length]!;
      const r = renderArt(style, s.w, s.h, 5000 + s.w * 31 + k, title);
      const png = await sharp(Buffer.from(r.data), { raw: { width: r.w, height: r.h, channels: 3 } }).png().toBuffer();
      const img = await processCreation(png, { w: s.w, h: s.h });
      const path = `creations/demo-volume/${now}-${s.w}x${s.h}-${k}-${img.sha256.slice(0, 10)}.png`;
      list.push({ path, hash: img.sha256, bytes: img.bytes, avg: img.avgColor, w: s.w, h: s.h, png: img.png, stored: false });
    }
    pictures.set(`${s.w}x${s.h}`, list);
  }

  // 4. the places: around the big cities (the clusters grow outward as they fill), a tenth anywhere on land; never over another parcel, nearly all land
  const occ = new Occupancy();
  for (const r of await p.query<Rect>("select x, y, w, h from public.parcels where status in ('reserved', 'active')")) occ.add({ x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) });
  const cityWeight = ANCHORS.map(() => 0.4 + g() * 1.6), cityTotal = cityWeight.reduce((a, b) => a + b, 0), cursor = ANCHORS.map(() => 0);
  const centres = ANCHORS.map((a) => lonLatToPixel({ lon: a.lon, lat: a.lat }));
  const sizeTotal = VOLUME_SIZES.reduce((a, s) => a + s.weight, 0);
  const pick = <T,>(list: readonly T[], weights: (t: T, i: number) => number, total: number): { item: T; index: number } => { let x = g() * total; for (let i = 0; i < list.length; i++) { x -= weights(list[i]!, i); if (x <= 0) return { item: list[i]!, index: i }; } return { item: list[list.length - 1]!, index: list.length - 1 }; };

  type Row = { id: string; owner: string; r: Rect; land: number; at: string; pic: Picture; title: string; descr: string; cat: string };
  let rows: Row[] = [];
  const flush = async () => {
    if (!rows.length) return;
    const col = <T,>(f: (r: Row) => T) => rows.map(f);
    await p.query(
      `with np as (
         insert into public.parcels (id, owner_id, x, y, w, h, status, land_px, created_at, activated_at, updated_at, kind, tier)
         select t.id, t.owner, t.x, t.y, t.w, t.h, 'active', t.land, t.at, t.at, t.at, 'land', 'paid'
           from unnest($1::uuid[], $2::uuid[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::timestamptz[]) as t(id, owner, x, y, w, h, land, at)
         returning id)
       insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at, category, i18n)
       select t.id, t.owner, 1, t.path, t.hash, t.pw, t.ph, t.bytes, t.avg, t.title, t.descr, 'approved', t.at, t.at, t.at, t.cat, '{"_auto": {"src": "und", "demo": true}}'::jsonb
         from unnest($1::uuid[], $2::uuid[], $9::text[], $10::text[], $5::int[], $6::int[], $11::int[], $12::text[], $13::text[], $14::text[], $8::timestamptz[], $15::text[]) as t(id, owner, path, hash, pw, ph, bytes, avg, title, descr, at, cat)`,
      [col((r) => r.id), col((r) => r.owner), col((r) => r.r.x), col((r) => r.r.y), col((r) => r.r.w), col((r) => r.r.h), col((r) => r.land), col((r) => r.at),
       col((r) => r.pic.path), col((r) => r.pic.hash), col((r) => r.pic.bytes), col((r) => r.pic.avg), col((r) => r.title), col((r) => r.descr), col((r) => r.cat)],
    );
    // the published version (the parcel and its creation exist at this point)
    await p.query("update public.parcels pc set published_asset_id = a.id from public.parcel_assets a where a.parcel_id = pc.id and pc.id = any($1::uuid[])", [col((r) => r.id)]);
    report.created += rows.length;
    rows = [];
    p.log(`  ${report.created} / ${toMake} parcels`);
  };

  const t0 = now;
  for (let n = 0; n < toMake; n++) {
    const size = pick(VOLUME_SIZES, (s) => s.weight, sizeTotal).item;
    let placed: { r: Rect; land: number } | null = null;
    const anywhere = g() < 0.1;
    const city = anywhere ? -1 : pick(ANCHORS, (_, i) => cityWeight[i]!, cityTotal).index;
    for (let attempt = 0; attempt < 70 && !placed; attempt++) {
      let cx: number, cy: number;
      if (city >= 0 && attempt < 55) {
        const k = cursor[city]!++, angle = k * 2.399963, radius = 6 * Math.sqrt(k) + (g() - 0.5) * 8;
        cx = centres[city]!.x + Math.cos(angle) * radius; cy = centres[city]!.y + Math.sin(angle) * radius;
      } else { cx = g() * GRID_WIDTH; cy = (0.08 + g() * 0.8) * GRID_HEIGHT; }
      const r: Rect = { x: Math.max(0, Math.min(GRID_WIDTH - size.w, Math.round(cx - size.w / 2))), y: Math.max(0, Math.min(GRID_HEIGHT - size.h, Math.round(cy - size.h / 2))), w: size.w, h: size.h };
      if (occ.hits(r)) continue;
      const land = await p.landPixels(r);
      if (land < MIN_LAND_SHARE * size.w * size.h) continue;
      placed = { r, land };
    }
    if (!placed) { report.short++; continue; }
    occ.add(placed.r);
    const list = pictures.get(`${size.w}x${size.h}`)!, pic = list[Math.floor(g() * list.length)]!;
    if (!pic.stored) { await p.putObject(pic.path, pic.png); pic.stored = true; report.pictures++; }
    rows.push({
      id: randomUUID(), owner: ids[Math.floor(g() * ids.length)]!, r: placed.r, land: placed.land,
      at: new Date(t0 - Math.floor(g() * 60 * 24 * 3_600_000)).toISOString(), pic,
      title: `${TITLES[Math.floor(g() * TITLES.length)]!} ${100 + Math.floor(g() * 900)}`, descr: DESCRIPTIONS[Math.floor(g() * DESCRIPTIONS.length)]!, cat: CATEGORIES[Math.floor(g() * CATEGORIES.length)]!,
    });
    if (rows.length >= batch) await flush();
  }
  await flush();
  await p.query("update public.map_state set version = version + 1, updated_at = now() where id = 1");
  return report;
}
