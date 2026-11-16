import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * A crowded view. Each picture is a request to the server (and, there, a read of the database and of the storage): a dense city seen at ×1 holds more than a
 * thousand parcels, and asking for a picture each took minutes on a real site. Only the biggest parcels of a view fetch their own picture; the others are their colour,
 * with the server-composed tile of their place standing in. (Named so that it runs after the journey spec, which counts what is sold; it cleans up after itself.)
 */
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
const sql = async <T,>(text: string, params: unknown[] = []) => {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try { return (await db.query(text, params)).rows as T[]; } finally { await db.end(); }
};
const STORAGE = path.resolve(".data/e2e-storage");

test("a crowded view asks for the pictures of its biggest parcels only, not one picture per parcel", async ({ page }) => {
  fs.mkdirSync(path.join(STORAGE, "creations/crowded"), { recursive: true });
  fs.writeFileSync(path.join(STORAGE, "creations/crowded/pic.png"), await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc9944" } }).png().toBuffer());
  const { id: owner } = (await sql<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ('crowded@demo.invalid', jsonb_build_object('username', 'crowded_view')) returning id`))[0]!;
  try {
    // 20 columns × 35 rows of parcels, five sizes (15 to 31 pixels) in turn, each on its own 36-pixel cell
    await sql(
      `insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at)
       select $1, 30000 + (i % 20) * 36, 9000 + (i / 20) * 36, 15 + (i % 5) * 4, 15 + (i % 5) * 4, 'active', 'paid', 'land', (15 + (i % 5) * 4) ^ 2, now() from generate_series(0, 699) i`, [owner]);
    await sql(
      `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at, category)
       select p.id, p.owner_id, 1, 'creations/crowded/pic.png', 'crowded' || p.id, p.w, p.h, 100, '#cc9944', 'Crowded', 'A parcel of a crowded view.', 'approved', now(), now(), now(), 'arts' from public.parcels p where p.owner_id = $1`, [owner]);
    await sql(`update public.parcels p set published_asset_id = a.id from public.parcel_assets a where a.parcel_id = p.id and p.owner_id = $1`, [owner]);
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);

    const pictures = new Set<string>();
    page.on("request", (r) => { const m = /\/api\/assets\/([0-9a-f-]{36})/.exec(r.url()); if (m) pictures.add(m[1]!); });
    await page.setViewportSize({ width: 1360, height: 860 });
    await page.goto("/map?x=30360&y=9430&z=1");
    // settled: no new picture asked for during a second and a half
    let last = -1, quiet = 0;
    for (let i = 0; i < 40 && quiet < 3; i++) { await page.waitForTimeout(500); if (pictures.size === last) quiet++; else { quiet = 0; last = pictures.size; } }

    // ≈ 480 parcels are in the view: far fewer pictures than that are asked for, and the biggest ones' are
    expect(pictures.size, "pictures asked for").toBeGreaterThan(20);
    expect(pictures.size, "pictures asked for").toBeLessThanOrEqual(150);
    const shown = await page.evaluate(() => {
      const e = (window as unknown as { __pxEngine?: { tiles: Map<string, { state: string; parcels: unknown[] }> } }).__pxEngine;
      return [...(e?.tiles.values() ?? [])].reduce((n, t) => n + (t.state === "ready" ? t.parcels.length : 0), 0);
    });
    expect(shown, "parcels known to the map").toBeGreaterThanOrEqual(480);
  } finally {
    await sql(`update public.parcels set published_asset_id = null where owner_id = $1`, [owner]);
    await sql(`delete from public.parcel_assets where uploader_id = $1`, [owner]);
    await sql(`delete from public.parcels where owner_id = $1`, [owner]);
    await sql(`delete from auth.users where id = $1`, [owner]);
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
  }
});
