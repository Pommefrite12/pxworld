import { expect, test } from "@playwright/test";
import pg from "pg";

/**
 * What a visitor writes is translated by Claude on the first view of the parcel (once, for all the languages) and shown in the language of whoever looks at it,
 * with the mention "automatic translation" and a way back to the original. The service is a stand-in (tests/support/fake-anthropic.mjs, started by
 * scripts/e2e-server.mjs): a text tagged "[de]" is German, and its translation into xx is the text followed by " (xx)".
 * (Named so that it runs after the journey spec, which counts what is sold; the parcel it makes is removed at the end.)
 */
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
const FAKE = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? "3100") + 2}`;
const sql = async <T,>(text: string, params: unknown[] = []) => {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try { return (await db.query(text, params)).rows as T[]; } finally { await db.end(); }
};

test("the card, the archive page and the share image show a visitor's text in the visitor's language, translated once", async ({ page, request }) => {
  const { id: owner } = (await sql<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ('writer-de@example.test', jsonb_build_object('username', 'schreiber')) returning id`))[0]!;
  try {
    const { id: parcel, code } = (await sql<{ id: string; code: string }>(
      `insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at) values ($1, 27960, 11200, 6, 6, 'active', 'paid', 'land', 36, now()) returning id, code`, [owner]))[0]!;
    const { id: asset } = (await sql<{ id: string }>(
      `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at)
       values ($1, $2, 1, 'creations/none.png', 'translate0123', 6, 6, 100, '#3366cc', '[de] Hallo Welt', '[de] Eine schöne Aussicht', 'approved', now(), now(), now()) returning id`, [parcel, owner]))[0]!;
    await sql(`update public.parcels set published_asset_id = $1 where id = $2`, [asset, parcel]);
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
    await request.delete(`${FAKE}/__calls`);

    // English: the first view makes the translation (the visitor waits for it, once), with the mention and a way back
    await page.goto(`/map?p=${code}`);
    await expect(page.getByTestId("parcel-title")).toHaveText("Hallo Welt (en)");
    await expect(page.getByTestId("parcel-description")).toHaveText("Eine schöne Aussicht (en)");
    await expect(page.getByTestId("parcel-translation")).toContainText("Automatic translation (original language: German)");
    await page.getByTestId("parcel-translation-toggle").click();
    await expect(page.getByTestId("parcel-title")).toHaveText("[de] Hallo Welt");
    await expect(page.getByTestId("parcel-description")).toHaveText("[de] Eine schöne Aussicht");
    await expect(page.getByTestId("parcel-translation-toggle")).toHaveText("Show translation");
    await page.getByTestId("parcel-translation-toggle").click();
    await expect(page.getByTestId("parcel-title")).toHaveText("Hallo Welt (en)");

    // Spanish and Chinese: already translated, no new request; the mention in their own words
    await page.goto(`/es/map?p=${code}`);
    await expect(page.getByTestId("parcel-title")).toHaveText("Hallo Welt (es)");
    await expect(page.getByTestId("parcel-translation")).toContainText("Traducción automática (idioma original: alemán)");
    await page.goto(`/zh/map?p=${code}`);
    await expect(page.getByTestId("parcel-title")).toHaveText("Hallo Welt (zh)");
    await expect(page.getByTestId("parcel-translation")).toContainText("自动翻译");

    // the archive page: the translation, the mention, the original one click away, and the title of the page
    await page.context().clearCookies(); // the language of the last page is remembered: back to English
    await page.goto(`/archive/${code}`);
    await expect(page.getByTestId("archive-title")).toHaveText("Hallo Welt (en)");
    await expect(page.getByTestId("archive-description")).toHaveText("Eine schöne Aussicht (en)");
    await expect(page.getByTestId("archive-original")).toBeHidden(); // closed until asked
    await page.getByTestId("archive-translation").locator("summary").click();
    await expect(page.getByTestId("archive-original")).toContainText("[de] Hallo Welt");
    expect(await page.title()).toContain("Hallo Welt (en)");

    // French: the text is in German, so French gets a translation too
    await page.goto(`/fr/archive/${code}`);
    await expect(page.getByTestId("archive-title")).toHaveText("Hallo Welt (fr)");
    await expect(page.getByTestId("archive-translation")).toContainText("Traduction automatique (langue d'origine : allemand)");

    // the share image is made in the language of the page (and the permanent address too)
    expect((await request.get(`/api/og/parcel/${code}?lang=es`)).status()).toBe(200);
    await page.context().clearCookies();
    await page.goto(`/p/${code}`);
    expect(await page.content()).toContain("Hallo Welt (en)");

    // the data of the card: asked with a language it is translated, without one it is as written
    const card = async (q: string) => (await (await request.get(`/api/parcels/${code}${q}`)).json()).creation as { title: string; translation: { from: string; original: { title: string } } | null };
    expect((await card("?lang=es")).translation).toMatchObject({ from: "de", original: { title: "[de] Hallo Welt" } });
    expect(await card("")).toMatchObject({ title: "[de] Hallo Welt", translation: null });
    expect((await card("?lang=xx")).title).toBe("[de] Hallo Welt");

    // all that, and ONE request to the service for this parcel
    const calls = (await (await request.get(`${FAKE}/__calls`)).json()) as { user: string }[];
    expect(calls.filter((c) => c.user.includes("Hallo Welt"))).toHaveLength(1);
  } finally {
    await sql(`delete from public.parcels where owner_id = $1`, [owner]);
    await sql(`delete from auth.users where id = $1`, [owner]);
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
  }
});

test("the lists (home, Discover) show titles in the language of the page; a title that has no translation yet is translated after the response and is there on the next visit", async ({ page, request }) => {
  const { id: owner } = (await sql<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ('lister-de@example.test', jsonb_build_object('username', 'listenmacher')) returning id`))[0]!;
  try {
    const make = async (x: number, title: string) => {
      const { id: parcel, code } = (await sql<{ id: string; code: string }>(
        `insert into public.parcels (owner_id, x, y, w, h, status, tier, kind, land_px, activated_at) values ($1, $2, 11200, 6, 6, 'active', 'paid', 'land', 36, now()) returning id, code`, [owner, x]))[0]!;
      const { id: asset } = (await sql<{ id: string }>(
        `insert into public.parcel_assets (parcel_id, uploader_id, version, storage_path, content_hash, width, height, bytes, avg_color, title, description, status, reviewed_at, published_at, created_at)
         values ($1, $2, 1, 'creations/none.png', $3, 6, 6, 100, '#3366cc', $4, '[de] Eine kurze Beschreibung', 'approved', now(), now(), now()) returning id`, [parcel, owner, `list${x}`, title]))[0]!;
      await sql(`update public.parcels set published_asset_id = $1 where id = $2`, [asset, parcel]);
      return code;
    };
    const first = await make(27970, "[de] Erste Stadt"), second = await make(27980, "[de] Zweite Stadt");
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
    await request.delete(`${FAKE}/__calls`);
    const asked = async (what: string) => ((await (await request.get(`${FAKE}/__calls`)).json()) as { user: string }[]).filter((c) => c.user.includes(what)).length;

    // a visitor opens the first parcel's card: it is translated (the visitor waits for it, once). (Through the data of the card, not the map page:
    // the map page shows the latest creations too, and would send the second one for translation as well, see below.)
    expect((await (await request.get(`/api/parcels/${first}?lang=en`)).json()).creation.title).toBe("Erste Stadt (en)");
    expect(await asked("Erste Stadt")).toBe(1);
    expect(await asked("Zweite Stadt")).toBe(0);

    // Discover in English: the translated title where there is one, the title as written where there is none yet — and the list did not wait for Claude
    await page.context().clearCookies();
    await page.goto("/discover");
    await expect(page.getByText("Erste Stadt (en)").first()).toBeVisible();
    await expect(page.getByText("[de] Zweite Stadt").first()).toBeVisible();
    // …the translation of the second one is started after the response, and is there on the next visit
    await expect.poll(() => asked("Zweite Stadt"), { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => { await page.reload(); return await page.getByText("Zweite Stadt (en)").count(); }, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(await asked("Erste Stadt")).toBe(1); // asked for once, ever

    // the same lists in the other languages (both are translated for all the languages at once): the home page and Discover
    await page.goto("/es");
    expect(await page.content()).toContain("Zweite Stadt (es)");
    await page.goto("/fr/discover");
    await expect(page.getByText("Erste Stadt (fr)").first()).toBeVisible();
    await page.goto("/zh/discover");
    await expect(page.getByText("Zweite Stadt (zh)").first()).toBeVisible();
    expect(await asked("Zweite Stadt")).toBe(1);
    void second;
  } finally {
    await sql(`delete from public.parcels where owner_id = $1`, [owner]);
    await sql(`delete from auth.users where id = $1`, [owner]);
    await sql(`update public.map_state set version = version + 1, updated_at = now() where id = 1`);
  }
});
