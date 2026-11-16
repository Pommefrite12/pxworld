import fs from "node:fs";
import path from "node:path";
import { expect, request as pwRequest, test, type Locator } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * Previews must stay inside their frame, however big the creation is (a 40 × 60 parcel can be drawn at a tenth of a pixel: 400 × 600 dots). A bug
 * showed them overflowing the card in the moderation queue. (Named so that it runs after the journey spec, which counts what is sold; what it creates
 * is removed at the end.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
const sql = async <T,>(text: string, params: unknown[] = []) => {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try { return (await db.query(text, params)).rows as T[]; } finally { await db.end(); }
};

/** The picture is entirely inside its frame (a pixel of tolerance). */
async function expectInside(inner: Locator, frame: Locator, what: string) {
  const [a, b] = [await inner.boundingBox(), await frame.boundingBox()];
  expect(a, `${what}: picture`).toBeTruthy(); expect(b, `${what}: frame`).toBeTruthy();
  expect(a!.x, `${what}: left`).toBeGreaterThanOrEqual(b!.x - 1);
  expect(a!.y, `${what}: top`).toBeGreaterThanOrEqual(b!.y - 1);
  expect(a!.x + a!.width, `${what}: right`).toBeLessThanOrEqual(b!.x + b!.width + 1);
  expect(a!.y + a!.height, `${what}: bottom`).toBeLessThanOrEqual(b!.y + b!.height + 1);
}

test("the previews of big creations stay inside their frame: the moderation queue and the list of my parcels", async ({ page }) => {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.230" } });
  expect((await ctx.post("/api/dev/login", { data: { email: "layout-admin@example.test", role: "admin" } })).ok()).toBeTruthy();
  const owner = (await sql<{ id: string }>(`select id from auth.users where email = 'layout-admin@example.test'`))[0]!.id;
  const key = "creations/layout-big/big.png";
  const file = path.resolve(process.cwd(), ".data/e2e-storage", key);
  try {
    // a 400 × 600 picture (a 40 × 60 parcel at a tenth of a pixel), kept as the published version and as a new version waiting for moderation
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await sharp({ create: { width: 400, height: 600, channels: 3, background: "#ff4d2e" } }).png().toBuffer());
    const parcel = (await sql<{ id: string }>(
      `insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at) values ($1, 27700, 11300, 40, 60, 'active', 'paid', 'land', 2400, now()) returning id`, [owner]))[0]!.id;
    const asset = async (version: number, status: string) => (await sql<{ id: string }>(
      `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at)
       values ($1, $2, $3, $4, $5, 400, 600, 100, '#ff4d2e', $6, 'A big one', $7, now(), now(), now()) returning id`, [parcel, owner, version, key, `layout${version}`, `Big picture v${version}`, status]))[0]!.id;
    const published = await asset(1, "approved");
    await sql(`update public.parcels set published_asset_id = $1 where id = $2`, [published, parcel]);
    await asset(2, "pending");

    await page.context().addCookies((await ctx.storageState()).cookies);
    await page.setViewportSize({ width: 1360, height: 860 });

    // the moderation queue: the picture in its 176-pixel frame, the frame in its card
    await page.goto("/admin/moderation");
    const item = page.getByTestId("queue-item").filter({ hasText: "Big picture v2" });
    await expect(item).toBeVisible();
    const frame = item.locator(".checker").first(), img = frame.locator("img");
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expectInside(img, frame, "moderation: the picture in its frame");
    await expectInside(frame, item, "moderation: the frame in its card");

    // the list of my parcels: same thing, in its own (smaller) frame
    await page.goto("/account/parcels");
    const mine = page.getByTestId("my-parcel").filter({ hasText: "Big picture v1" });
    await expect(mine).toBeVisible();
    const f2 = mine.locator(".checker").first(), i2 = f2.locator("img");
    await expect.poll(() => i2.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expectInside(i2, f2, "my parcels: the picture in its frame");
    await expectInside(f2, mine, "my parcels: the frame in its card");

    // Discover: the square frame stays square and holds the picture
    await page.goto("/discover");
    const tile = page.getByRole("link").filter({ hasText: "Big picture v1" }).first();
    await expect(tile).toBeVisible();
    const f3 = tile.locator(".checker").first(), i3 = f3.locator("img");
    await expect.poll(() => i3.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expectInside(i3, f3, "discover: the picture in its frame");
    const sq = (await f3.boundingBox())!;
    expect(Math.abs(sq.width - sq.height), "discover: the frame is square").toBeLessThanOrEqual(2);

    // the ranking: a like from another account puts it in the list; the 64-pixel frame holds the picture
    const liker = (await sql<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ('layout-liker@example.test', jsonb_build_object('username', 'layoutliker')) returning id`))[0]!.id;
    await sql(`insert into public.parcel_likes (user_id, parcel_id) values ($1, $2)`, [liker, parcel]);
    await page.goto("/ranking");
    const row = page.getByTestId("ranking-row").filter({ hasText: "Big picture v1" });
    await expect(row).toBeVisible();
    const f4 = row.locator(".checker").first(), i4 = f4.locator("img");
    await expect.poll(() => i4.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expectInside(i4, f4, "ranking: the picture in its frame");
    await expectInside(f4, row, "ranking: the frame in its row");
  } finally {
    await sql(`delete from public.parcels where owner_id = $1`, [owner]);
    await sql(`delete from auth.users where email = 'layout-liker@example.test'`);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
    await ctx.dispose();
  }
});
