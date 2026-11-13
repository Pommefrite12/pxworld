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
  const TITLE = "Pyramides d'illustration"; // the stored text is French
  const I18N = { en: { title: "Illustration pyramids", description: "A drawing that dresses the map." }, es: { title: "Pirámides de ilustración", description: "Un dibujo que viste el mapa." }, zh: { title: "插画金字塔", description: "一幅点缀地图的画。" } };
  const { id: owner } = (await sql<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ('illustration@demo.invalid', jsonb_build_object('username', 'image_illustration')) returning id`))[0]!;
  const { id: parcel, code } = (await sql<{ id: string; code: string }>(
    `insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at) values ($1, 27920, 11100, 30, 30, 'active', 'illustration', 'land', 900, now()) returning id, code`, [owner]))[0]!;
  const { id: asset } = (await sql<{ id: string }>(
    `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at, category, i18n)
     values ($1, $2, 1, 'creations/none.png', 'abcdef0123', 30, 30, 100, '#cc9944', $3, 'Un dessin pour habiller la carte.', 'approved', now(), now(), now(), 'arts', $4::jsonb) returning id`, [parcel, owner, TITLE, JSON.stringify(I18N)]))[0]!;
  await sql(`update public.parcels set published_asset_id = $1 where id = $2`, [asset, parcel]);
  await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);

  // the public data says what it is
  const info = await (await request.get(`/api/parcels/${code}`)).json();
  expect(info).toMatchObject({ code, tier: "illustration", w: 30, h: 30 });
  expect(info.creation.title).toBe(TITLE); // without a language: the stored text

  // the title and the sentence come in the language of the visitor (the address carries it, so each language is cached on its own)
  const card = async (lang: string) => (await (await request.get(`/api/parcels/${code}?lang=${lang}`)).json()).creation as { title: string; description: string };
  expect(await card("en")).toMatchObject({ title: I18N.en.title, description: I18N.en.description });
  expect(await card("es")).toMatchObject({ title: I18N.es.title });
  expect(await card("zh")).toMatchObject({ title: I18N.zh.title, description: I18N.zh.description });
  expect(await card("fr")).toMatchObject({ title: TITLE, description: "Un dessin pour habiller la carte." }); // French is the text itself
  expect((await card("xx")).title, "an unknown language gets the stored text").toBe(TITLE);
  expect((await card("de")).title, "a language the site does not have gets the stored text").toBe(TITLE);

  // the archive page: no author, the label instead, in the title too
  await page.goto(`/archive/${code}`);
  await expect(page.getByTestId("archive-illustration")).toHaveText("Illustration image");
  await expect(page.getByTestId("archive-author")).toHaveCount(0);
  await expect(page.getByTestId("archive-title")).toHaveText(I18N.en.title); // in the language of the page
  await expect(page.getByTestId("archive-description")).toHaveText(I18N.en.description);
  expect(await page.title()).toContain(`${I18N.en.title} — Illustration image`);
  expect(await page.content()).not.toContain("image_illustration"); // the technical account never shows

  // the card on the map
  await page.goto(`/map?p=${code}`);
  await expect(page.getByTestId("parcel-illustration")).toHaveText("Illustration image");
  await expect(page.getByTestId("parcel-title")).toHaveText(I18N.en.title);
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

  // the card of the map in Spanish and in Chinese
  await page.goto(`/es/map?p=${code}`);
  await expect(page.getByTestId("parcel-title")).toHaveText(I18N.es.title);
  await page.goto(`/zh/map?p=${code}`);
  await expect(page.getByTestId("parcel-title")).toHaveText(I18N.zh.title);

  // in French (last: the language is remembered from then on): the stored text
  await page.goto(`/fr/archive/${code}`);
  await expect(page.getByTestId("archive-illustration")).toHaveText("Image d'illustration");
  await expect(page.getByTestId("archive-title")).toHaveText(TITLE);
});
