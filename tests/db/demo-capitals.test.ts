import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, fulfill, pool, resetData, startOrder } from "./helpers";
import { seedDemo, type DemoPorts, type Rect } from "@/lib/demo/seed";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { CAPITALS, capitalsPlan, loadCapitalImages } from "@/lib/demo/capitals";
import { CAPITALS_I18N } from "@/lib/demo/capitals-i18n";
import { lonLatToPixel } from "@/lib/grid/geometry";
import { landPixelsIn } from "@/lib/geo/landServer";

afterAll(closeDb);
const DOMAIN = "demo.invalid";
let files = new Map<string, Buffer>();

const ports = (): DemoPorts => ({
  query: async (sql, params) => (await pool.query(sql, params)).rows,
  async createUser(email, username) {
    const { rows } = await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('username', $2::text)) returning id", [email, username]);
    return rows[0].id as string;
  },
  deleteUser: async (id) => { await pool.query("delete from auth.users where id = $1", [id]); },
  putObject: async (key, bytes) => { files.set(key, bytes); },
  removeObject: async (key) => { if (!files.delete(key)) throw new Error("no such file"); },
  landPixels: async (r: Rect) => landPixelsIn(r),
  log: () => undefined,
});

beforeEach(async () => {
  await resetData();
  await pool.query("delete from auth.users where email like '%@demo.invalid'");
  files = new Map();
});

const seed = () => seedDemo(ports(), { count: CAPITALS.length, emailDomain: DOMAIN, plan: capitalsPlan() });

const KNOWN_LANGS = ["en", "es", "zh"] as const;

describe("the illustrations on the biggest capitals", () => {
  it("is 10 to 20 squares of 50 to 200 pixels, one of them the wink at Miami, every one with its sentence in the four languages", () => {
    expect(CAPITALS.length).toBeGreaterThanOrEqual(10);
    expect(CAPITALS.length).toBeLessThanOrEqual(20);
    const sizes = CAPITALS.map((c) => c.size);
    expect(Math.min(...sizes), "the smallest").toBe(50);
    expect(Math.max(...sizes), "the biggest").toBe(200);
    for (const s of sizes) { expect(s).toBeGreaterThanOrEqual(50); expect(s).toBeLessThanOrEqual(200); }
    expect(new Set(sizes).size, "the sizes vary").toBeGreaterThan(8);
    expect(CAPITALS.map((c) => c.id)).toContain("miami");
    expect(new Set(CAPITALS.map((c) => c.id)).size).toBe(CAPITALS.length);
    expect(new Set(CAPITALS.map((c) => c.title)).size, "one title each (the tool tells them apart by it)").toBe(CAPITALS.length);
    for (const c of CAPITALS) {
      expect(c.text.length, c.id).toBeGreaterThan(30);
      for (const l of KNOWN_LANGS) { const t = CAPITALS_I18N[c.id]?.[l]; expect(t, `${c.id} in ${l}`).toBeTruthy(); expect(t![0].length).toBeGreaterThan(2); expect(t![1].length).toBeGreaterThan(10); }
    }
    // the wink is a mood and two letters: no logo, no brand, no character in what is stored
    const miami = CAPITALS.find((c) => c.id === "miami")!;
    expect(`${miami.title} ${miami.text}`).not.toMatch(/rockstar|gta|grand theft|take-two|lucia|jason/i);
  });

  it("places every one on land, near its city, as an illustration parcel with a published picture of the right size", async () => {
    const r = await seed();
    expect(r.failed).toEqual([]);
    expect(r.parcelsCreated).toBe(CAPITALS.length);
    const rows = (await pool.query(
      `select pc.x, pc.y, pc.w, pc.h, pc.land_px, pc.tier, pc.status, pc.kind, a.title, a.status as asset_status, a.width, a.height, a.i18n, a.description, a.bytes
         from public.parcels pc join public.parcel_assets a on a.id = pc.published_asset_id`)).rows;
    expect(rows).toHaveLength(CAPITALS.length);
    for (const x of rows) {
      const c = CAPITALS.find((k) => k.title === x.title)!, p = lonLatToPixel({ lon: c.lon, lat: c.lat });
      expect([x.tier, x.status, x.kind, x.asset_status], c.id).toEqual(["illustration", "active", "land", "approved"]);
      expect([x.w, x.h], c.id).toEqual([c.size, c.size]);
      expect(x.land_px, `${c.id} is on land`).toBeGreaterThanOrEqual(c.size * c.size * 0.85);
      expect(Math.hypot(x.x + x.w / 2 - p.x, x.y + x.h / 2 - p.y), `${c.id} stays near its city`).toBeLessThanOrEqual(70);
      expect([x.width, x.height], `${c.id}: a quarter of a pixel per dot`).toEqual([c.size * 4, c.size * 4]);
      expect(Number(x.bytes), c.id).toBeLessThan(3 * 1024 * 1024);
      expect(Object.keys(x.i18n).filter((k) => k !== "_auto").sort(), c.id).toEqual(["en", "es", "zh"]);
      expect(x.description).toBe(c.text);
    }
    // none over another (the database refuses it), and each picture is a real PNG in the store
    expect([...files.values()].every((b) => b.subarray(1, 4).toString() === "PNG")).toBe(true);
    expect(files.size).toBe(CAPITALS.length);
  });

  it("is decoration: not a sold pixel, not an owner, not a creation in the public counters", async () => {
    await seed();
    const s = (await pool.query("select * from public.px_public_stats()")).rows[0];
    expect([Number(s.sold_pixels), Number(s.parcels), Number(s.owners), Number(s.published_creations)]).toEqual([0, 0, 0, 0]);
  });

  it("is safe to run twice, and a purchase that touches one covers it whole", async () => {
    await seed();
    expect((await seed()).parcelsCreated, "nothing is doubled").toBe(0);
    const paris = (await pool.query(`select pc.id, pc.x, pc.y from public.parcels pc join public.parcel_assets a on a.parcel_id = pc.id where a.title = $1`, [CAPITALS.find((c) => c.id === "paris")!.title])).rows[0];
    const buyer = await createUser("buyer");
    const o = await startOrder(buyer, { x: Number(paris.x) + 70, y: Number(paris.y) + 70, w: 5, h: 5 });
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    expect((await pool.query("select status from public.parcels where id = $1", [paris.id])).rows[0].status, "a 5 × 5 purchase covers the whole 160 × 160 picture").toBe("covered");
    expect((await pool.query("select count(*)::int n from public.parcels where tier = 'illustration' and status = 'active'")).rows[0].n, "the others stay").toBe(CAPITALS.length - 1);
  });

  it("uses the pictures that are supplied instead of the drawings: cut to a square, at the finest scale that fits the limits", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-capitals-"));
    try {
      // a wide picture (paris, 160 px): 900 × 600 gives a square of 600 → 3 dots per pixel; a noisy one (pekin, 200 px) is too heavy at its finest scale
      await sharp({ create: { width: 900, height: 600, channels: 3, background: "#cc7744" } }).png().toFile(path.join(dir, "paris.png"));
      const noise = randomBytes(1000 * 1000 * 3); // incompressible: a PNG of it is as big as the picture itself
      await sharp(noise, { raw: { width: 1000, height: 1000, channels: 3 } }).png().toFile(path.join(dir, "pekin.png"));
      const given = await loadCapitalImages(dir);
      expect([...given.keys()].sort()).toEqual(["paris", "pekin"]);
      expect([given.get("paris")!.w, given.get("paris")!.h], "600 / 160 → 3 dots per pixel").toEqual([480, 480]);
      expect(given.get("pekin")!.w, "5 dots per pixel would not fit 3 MB: 4").toBe(800);
      expect((await loadCapitalImages(path.join(dir, "nothing-here"))).size, "no folder: every capital keeps its drawing").toBe(0);

      const r = await seedDemo(ports(), { count: CAPITALS.length, emailDomain: DOMAIN, plan: capitalsPlan(4, given) });
      expect(r.failed).toEqual([]);
      const rows = (await pool.query(`select a.title, a.width, a.height, a.bytes from public.parcels pc join public.parcel_assets a on a.id = pc.published_asset_id`)).rows;
      const byTitle = (id: string) => rows.find((x) => x.title === CAPITALS.find((c) => c.id === id)!.title);
      expect(byTitle("paris").width).toBe(480);
      expect(byTitle("pekin").width).toBe(800);
      expect(byTitle("berlin").width, "the others stay drawn, a quarter of a pixel per dot").toBe(280);
      for (const x of rows) expect(Number(x.bytes)).toBeLessThan(3 * 1024 * 1024);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("takes the pictures kept in assets/capitals, and every one of them is accepted by the upload pipeline", async () => {
    const given = await loadCapitalImages(path.resolve("assets/capitals"));
    expect(given.size, "a picture was supplied for every capital: none falls back to a drawing").toBe(CAPITALS.length);
    for (const [id, r] of given) { const c = CAPITALS.find((x) => x.id === id)!; expect(r.w % c.size, id).toBe(0); expect(r.w, id).toBe(r.h); }
    const r = await seedDemo(ports(), { count: CAPITALS.length, emailDomain: DOMAIN, plan: capitalsPlan(4, given) });
    expect(r.failed).toEqual([]);
    expect(r.parcelsCreated).toBe(CAPITALS.length);
  }, 120_000);
});
