/**
 * Fills a TEST site with made-up accounts and parcels, and takes them away again. The orchestration only: everything that touches the outside
 * (database, accounts, files, the land map) comes in through `DemoPorts`, so that the tests can run it on a scratch database and
 * `scripts/seed-demo.mts` can run it on the real one. Guards are in `plan.ts` and the script applies them BEFORE anything happens.
 *
 * What it makes, and does not make:
 *  - accounts `demo_…` (e-mail `demo-001@demo.invalid`, bio "demo account"); a parcel each, on land, big and clustered around big cities
 *  - a published creation per parcel, generated (`art.ts`) and checked by the very pipeline of real uploads (`processCreation`)
 *  - NO order, NO payment, NO moderation action: no fake revenue, no fake audit trail
 *  - everything can be removed with `clearDemo`
 */
import sharp from "sharp";
import { processCreation } from "@/lib/images/validate";
import { lonLatToPixel } from "@/lib/grid/geometry";
import { GRID_HEIGHT, GRID_WIDTH } from "@/lib/grid/constants";
import { renderArt } from "./art";
import { ILLUSTRATION_USERNAME, illustrationEmail } from "@/lib/illustration";
import { demoPlan, type DemoItem } from "./plan";

export interface Rect { x: number; y: number; w: number; h: number }

export interface DemoPorts {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Creates an account and returns its id. */
  createUser(email: string, username: string): Promise<string>;
  deleteUser(id: string): Promise<void>;
  putObject(key: string, bytes: Buffer): Promise<void>;
  removeObject(key: string): Promise<void>;
  /** How many pixels of the rectangle are land (the very count that purchases use). */
  landPixels(rect: Rect): Promise<number>;
  log(message: string): void;
}

export interface SeedOptions { /** A ready-made plan (the curated "heritage" set): `count` and `water` are then ignored. */ plan?: DemoItem[]; count: number; /** MORE accounts, each with a parcel on the sea, after the `count` first ones. */ water?: number; seed?: number; emailDomain: string; now?: number }
export interface SeedReport { usersCreated: number; usersFound: number; parcelsCreated: number; parcelsSkipped: number; failed: string[] }

const MIN_LAND_SHARE = 0.85;
const overlaps = (a: Rect, b: Rect, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sqlLike = (domain: string) => `demo-%@${domain}`;

export async function seedDemo(p: DemoPorts, opts: SeedOptions): Promise<SeedReport> {
  const now = opts.now ?? Date.now(), plan = opts.plan ?? demoPlan(opts.count, opts.seed ?? 1, opts.water ?? 0);
  const report: SeedReport = { usersCreated: 0, usersFound: 0, parcelsCreated: 0, parcelsSkipped: 0, failed: [] };
  const known = new Map((await p.query<{ id: string; email: string }>("select id, email from auth.users where email like $1", [sqlLike(opts.emailDomain)])).map((r) => [r.email, r.id]));
  const placed: Rect[] = (await p.query<Rect>("select x, y, w, h from public.parcels where status in ('reserved', 'active')")).map((r) => ({ x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }));

  // the ONE technical account that owns every illustration parcel (made the first time one is needed)
  let illustrationOwner: string | null = null;
  const systemAccount = async (): Promise<string> => {
    if (illustrationOwner) return illustrationOwner;
    const email = illustrationEmail(opts.emailDomain);
    const [found] = await p.query<{ id: string }>("select id from auth.users where email = $1", [email]);
    if (found) { report.usersFound++; return (illustrationOwner = found.id); }
    const id = await p.createUser(email, ILLUSTRATION_USERNAME);
    report.usersCreated++;
    await p.query("update public.profiles set bio = $2 where id = $1", [id, "Compte technique des images d'illustration : personne ne s'y connecte."]);
    return (illustrationOwner = id);
  };

  for (const item of plan) {
    const email = `${item.emailLocal}@${opts.emailDomain}`;
    try {
      let userId: string;
      if (item.illustration) {
        userId = await systemAccount();
        // done already (also when a purchase has covered it since): one illustration per title
        if ((await p.query("select 1 from public.parcels pc join public.parcel_assets a on a.parcel_id = pc.id where pc.owner_id = $1 and pc.tier = 'illustration' and a.title = $2 limit 1", [userId, item.title])).length) { report.parcelsSkipped++; continue; }
      } else {
        const known_ = known.get(email);
        if (known_) report.usersFound++;
        else { userId = await p.createUser(email, item.username); report.usersCreated++; }
        userId = known_ ?? userId!;
        await p.query("update public.profiles set country = $2, bio = $3 where id = $1", [userId, item.anchor.country, "Compte de démonstration (site de test)."]);
        if ((await p.query("select 1 from public.parcels where owner_id = $1 and status = 'active' limit 1", [userId])).length) { report.parcelsSkipped++; continue; }
      }

      // a place: around the anchor city, mostly on land, clear of every other parcel; the circle grows (and the parcel shrinks) when it is crowded
      const c = lonLatToPixel({ lon: item.spot.lon, lat: item.spot.lat });
      let done = false;
      for (let attempt = 0; attempt < (item.exact ? 400 : 160) && !done; attempt++) {
        const shrink = item.exact || attempt < 60 ? 1 : attempt < 110 ? 0.75 : 0.5;
        const w = item.exact ? item.w : Math.max(40, Math.round(item.w * shrink)), h = item.exact ? item.h : Math.max(40, Math.round(item.h * shrink));
        let r: Rect;
        if (item.exact) {
          // a curated parcel goes right on its place; when that is taken or half in the sea, it moves outwards in a spiral, as little as it can
          const angle = attempt * 2.399963, radius = attempt === 0 ? 0 : 2.2 * Math.sqrt(attempt) * 3;
          r = { x: clamp(Math.round(c.x + Math.cos(angle) * radius - w / 2), 0, GRID_WIDTH - w), y: clamp(Math.round(c.y + Math.sin(angle) * radius - h / 2), 0, GRID_HEIGHT - h), w, h };
          if (placed.some((o) => overlaps(r, o, 2))) continue;
        } else {
          const angle = ((item.seed * 97 + attempt * 137) % 360) * (Math.PI / 180), radius = 80 + attempt * 14 + ((item.seed * 31 + attempt * 17) % 220);
          r = { x: clamp(Math.round(c.x + Math.cos(angle) * radius - w / 2), 0, GRID_WIDTH - w), y: clamp(Math.round(c.y + Math.sin(angle) * radius * 0.7 - h / 2), 0, GRID_HEIGHT - h), w, h };
          if (placed.some((o) => overlaps(r, o, 6))) continue;
        }
        const land = await p.landPixels(r), water = item.kind === "water";
        if ((water ? w * h - land : land) < MIN_LAND_SHARE * w * h) continue; // a parcel is placed where it owns (nearly) all its rectangle

        const at = new Date(now - item.ageHours * 3_600_000).toISOString();
        let parcel: { id: string };
        try {
          [parcel] = await p.query<{ id: string }>(
            "insert into public.parcels (owner_id, x, y, w, h, status, land_px, created_at, activated_at, updated_at, kind, tier) values ($1, $2, $3, $4, $5, 'active', $6, $7, $7, $7, $8, $9) returning id",
            [userId, r.x, r.y, w, h, land, at, item.kind, item.illustration ? "illustration" : "paid"],
          ) as [{ id: string }];
        } catch (e) {
          if ((e as { code?: string }).code === "23P01") { placed.push(r); continue; } // somebody else's parcel is there: try elsewhere
          throw e;
        }
        const raster = item.render ? item.render(w, h, item.seed) : renderArt(item.style, w, h, item.seed, item.title);
        const png = await sharp(Buffer.from(raster.data), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
        const img = await processCreation(png, { w, h }); // the pipeline of a real upload: canonical PNG, hash, average colour
        const key = `creations/${parcel.id}/${now}-${img.sha256.slice(0, 12)}.png`;
        await p.putObject(key, img.png);
        const [asset] = await p.query<{ id: string }>(
          `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at, category)
           values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, 'approved', $11, $11, $11, $12) returning id`,
          [parcel.id, userId, key, img.sha256, img.width, img.height, img.bytes, img.avgColor, item.title, item.description, at, item.category ?? null],
        ) as [{ id: string }];
        await p.query("update public.parcels set published_asset_id = $1 where id = $2", [asset.id, parcel.id]);
        placed.push(r);
        report.parcelsCreated++;
        done = true;
        p.log(`  ${item.username.padEnd(16)} ${String(w).padStart(3)}×${String(h).padEnd(3)} ${item.kind === "water" ? "on" : "near"} ${item.spot.name.padEnd(12)} "${item.title}"`);
      }
      if (!done) { report.failed.push(`${item.username}: no free place found near ${item.spot.name}`); }
    } catch (e) {
      report.failed.push(`${item.username}: ${(e as Error).message}`);
    }
  }
  await p.query("update public.map_state set version = version + 1, updated_at = now() where id = 1");
  return report;
}

export interface ClearReport { users: number; parcels: number; files: number }

/** Deletes every demonstration account, with its parcels, creations and files. Never touches anything else. */
export async function clearDemo(p: DemoPorts, opts: { emailDomain: string }): Promise<ClearReport> {
  const ids = (await p.query<{ id: string }>("select id from auth.users where email like $1", [sqlLike(opts.emailDomain)])).map((r) => r.id);
  if (!ids.length) return { users: 0, parcels: 0, files: 0 };
  const paths = (await p.query<{ storage_path: string }>(
    "select a.storage_path from public.parcel_assets a join public.parcels pc on pc.id = a.parcel_id where pc.owner_id = any($1::uuid[])", [ids])).map((r) => r.storage_path);
  const gone = await p.query<{ id: string }>("delete from public.parcels where owner_id = any($1::uuid[]) returning id", [ids]);
  let files = 0;
  for (const key of paths) { try { await p.removeObject(key); files++; } catch { p.log(`  (could not remove the file ${key})`); } }
  for (const id of ids) await p.deleteUser(id);
  await p.query("update public.map_state set version = version + 1, updated_at = now() where id = 1");
  return { users: ids.length, parcels: gone.length, files };
}

/** Removes the illustration parcels (covered ones too), their files and the technical account. Only when asked for: `clearDemo` leaves them. */
export async function clearIllustrations(p: DemoPorts, opts: { emailDomain: string }): Promise<{ parcels: number; files: number; accounts: number }> {
  const paths = (await p.query<{ storage_path: string }>(
    "select a.storage_path from public.parcel_assets a join public.parcels pc on pc.id = a.parcel_id where pc.tier = 'illustration'")).map((r) => r.storage_path);
  const gone = await p.query<{ id: string }>("delete from public.parcels where tier = 'illustration' returning id");
  let files = 0;
  for (const key of paths) { try { await p.removeObject(key); files++; } catch { p.log(`  (could not remove the file ${key})`); } }
  const [acc] = await p.query<{ id: string }>("select id from auth.users where email = $1", [illustrationEmail(opts.emailDomain)]);
  if (acc) await p.deleteUser(acc.id);
  await p.query("update public.map_state set version = version + 1, updated_at = now() where id = 1");
  return { parcels: gone.length, files, accounts: acc ? 1 : 0 };
}

export interface DemoStatus { users: number; parcels: number; illustrations: number; publicCounters: { soldPixels: number; parcels: number; owners: number; creations: number } }

export async function demoStatus(p: DemoPorts, opts: { emailDomain: string }): Promise<DemoStatus> {
  const [u] = await p.query<{ n: number }>("select count(*)::int as n from auth.users where email like $1", [sqlLike(opts.emailDomain)]);
  const [pc] = await p.query<{ n: number }>("select count(*)::int as n from public.parcels pc join auth.users u on u.id = pc.owner_id where u.email like $1 and pc.status = 'active'", [sqlLike(opts.emailDomain)]);
  const [s] = await p.query<{ sold_pixels: number; parcels: number; owners: number; published_creations: number }>("select * from public.px_public_stats()");
  const [il] = await p.query<{ n: number }>("select count(*)::int as n from public.parcels where tier = 'illustration' and status in ('active', 'covered')");
  return { users: Number(u?.n ?? 0), parcels: Number(pc?.n ?? 0), illustrations: Number(il?.n ?? 0), publicCounters: { soldPixels: Number(s?.sold_pixels ?? 0), parcels: Number(s?.parcels ?? 0), owners: Number(s?.owners ?? 0), creations: Number(s?.published_creations ?? 0) } };
}
