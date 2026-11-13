import { expect, test } from "@playwright/test";
import pg from "pg";

/**
 * Illustration parcels (decorative pictures placed with the demonstration tool): shown as "Illustration image" instead of an author, absent from
 * the lists of people's creations, no page for their technical account. (Named so that it runs after the journey spec, which counts what is sold.)
 */
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
const sql = async <T,>(text: string, params: unknown[] = []) => {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try { return (await db.query(text, params)).rows as T[]; } finally { await db.end(); }
};

test("an illustration parcel says \"Illustration image\" instead of an author, on the card, the archive page and the share title; its account has no page; it is in no list of creations", async ({ page, request }) => {
  const TITLE = "Pyramides d'illustration";
  const { id: owner } = (await sql<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ('illustration@demo.invalid', jsonb_build_object('username', 'image_illustration')) returning id`))[0]!;
  const { id: parcel, code } = (await sql<{ id: string; code: string }>(
    `insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at) values ($1, 27920, 11100, 30, 30, 'active', 'illustration', 'land', 900, now()) returning id, code`, [owner]))[0]!;
  const { id: asset } = (await sql<{ id: string }>(
    `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at, category)
     values ($1, $2, 1, 'creations/none.png', 'abcdef0123', 30, 30, 100, '#cc9944', $3, 'Un dessin pour habiller la carte.', 'approved', now(), now(), now(), 'arts') returning id`, [parcel, owner, TITLE]))[0]!;
  await sql(`update public.parcels set published_asset_id = $1 where id = $2`, [asset, parcel]);
  await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);

  // the public data says what it is
  const info = await (await request.get(`/api/parcels/${code}`)).json();
  expect(info).toMatchObject({ code, tier: "illustration", w: 30, h: 30 });

  // the archive page: no author, the label instead, in the title too
  await page.goto(`/archive/${code}`);
  await expect(page.getByTestId("archive-illustration")).toHaveText("Illustration image");
  await expect(page.getByTestId("archive-author")).toHaveCount(0);
  expect(await page.title()).toContain(`${TITLE} — Illustration image`);
  expect(await page.content()).not.toContain("image_illustration"); // the technical account never shows

  // the card on the map
  await page.goto(`/map?p=${code}`);
  await expect(page.getByTestId("parcel-illustration")).toHaveText("Illustration image");
  await expect(page.getByTestId("parcel-card-slot")).not.toContainText("image_illustration");

  // the permanent address
  await page.goto(`/p/${code}`);
  expect(await page.content()).not.toContain("image_illustration");

  // its account has no page
  expect((await request.get("/u/image_illustration")).status()).toBe(404);

  // it is decoration, not a contribution: in no list of creations, and the counters of sold space do not see it
  for (const path of ["/discover", "/"]) expect(await (await request.get(path)).text(), path).not.toContain(TITLE);
  const stats = await (await request.get("/api/stats")).json();
  expect(stats.publishedCreations).toBeGreaterThanOrEqual(0);
  expect((await sql<{ n: number }>(`select count(*)::int as n from public.parcels where tier = 'illustration'`))[0]!.n).toBe(1);

  // in French (last: the language is remembered from then on)
  await page.goto(`/fr/archive/${code}`);
  await expect(page.getByTestId("archive-illustration")).toHaveText("Image d'illustration");
});
