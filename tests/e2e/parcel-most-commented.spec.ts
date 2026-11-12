import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * The Discover page ends with ONE ranking besides the likes: the most commented traces. (The "editorial selection" and the
 * "top contributors" are gone.) Only what is honest counts: the owner's own comments, removed comments and comments of suspended
 * accounts do not. Own piece of the map, and named so that it runs after the journey spec, which asserts exact global counters before any sale.
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");
const SPOTS = {
  quiet: { x: 27_600, y: 11_200, w: 30, h: 30, title: "Ranking quiet", owner: "mc-owner-quiet@example.test" },
  middle: { x: 27_600, y: 11_300, w: 30, h: 30, title: "Ranking middle", owner: "mc-owner-middle@example.test" },
  top: { x: 27_600, y: 11_400, w: 30, h: 30, title: "Ranking top", owner: "mc-owner-top@example.test" },
};
let ip = 0;
const contexts: APIRequestContext[] = [];
const as = async (email: string, role?: "admin") => {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${120 + ++ip}` } });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  contexts.push(ctx);
  return ctx;
};
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.dispose())); });

async function publish(spot: (typeof SPOTS)[keyof typeof SPOTS], admin: APIRequestContext) {
  const owner = await as(spot.owner);
  const image = await sharp({ create: { width: spot.w, height: spot.h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
  const r = await owner.post("/api/checkout", { multipart: { x: String(spot.x), y: String(spot.y), w: String(spot.w), h: String(spot.h), description: "A short description", title: spot.title, image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await owner.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const asset = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [spot.x, spot.y]);
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: asset.rows[0]!.id, decision: "approve" } })).status()).toBe(200);
  const code = (await db.query(`select code from public.parcels where x = $1 and y = $2`, [spot.x, spot.y])).rows[0].code as string;
  await db.end();
  return { owner, code };
}

test("Discover: no editorial selection, no top contributors; a ranking of the most commented, counting honest comments only", async ({ page }) => {
  const admin = await as("admin.mostcommented@example.test", "admin");
  const quiet = await publish(SPOTS.quiet, admin), middle = await publish(SPOTS.middle, admin), top = await publish(SPOTS.top, admin);
  const say = async (who: APIRequestContext, code: string, body: string) => {
    const r = await who.post("/api/comments", { data: { code, body } });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).comment.id as string;
  };
  const [ann, bob, cleo] = [await as("mc-ann@example.test"), await as("mc-bob@example.test"), await as("mc-cleo@example.test")];

  // before any comment the section says so (and shows none of the three)
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Most commented", level: 2 })).toBeVisible();
  await expect(page.locator('section[aria-labelledby="commented"]').getByRole("link", { name: /Ranking/ })).toHaveCount(0);

  // top: three comments from others, one from its owner (does not count) and one removed by its author (does not count) → 3
  await say(ann, top.code, "first!"); await say(bob, top.code, "lovely"); await say(cleo, top.code, "how long did it take?");
  await say(top.owner, top.code, "thanks everyone");
  const removed = await say(ann, top.code, "oops, wrong parcel");
  expect((await ann.delete("/api/comments", { data: { id: removed } })).status()).toBe(200);
  // middle: two from others → 2
  await say(ann, middle.code, "nice"); await say(bob, middle.code, "I like it");
  // quiet: only its owner talks → not in the ranking at all
  await say(quiet.owner, quiet.code, "talking to myself");

  await page.goto("/discover");
  const section = page.locator('section[aria-labelledby="commented"]');
  const links = section.getByRole("link", { name: /Ranking/ });
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toContainText("Ranking top");
  await expect(links.nth(0)).toContainText("3 comments");
  await expect(links.nth(1)).toContainText("Ranking middle");
  await expect(links.nth(1)).toContainText("2 comments");

  // the comments of a suspended account stop counting
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const bobId = (await db.query(`select id from auth.users where email = 'mc-bob@example.test'`)).rows[0].id as string;
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "suspend_user", userId: bobId, suspended: true, reason: "test" } })).status()).toBe(200);
  await page.goto("/discover");
  await expect(section.getByRole("link", { name: /Ranking top/ })).toContainText("2 comments"); // 3 − Bob's
  await expect(section.getByRole("link", { name: /Ranking middle/ })).toContainText("1 comment"); // singular: 2 − Bob's
  expect((await admin.post("/api/admin/action", { data: { action: "suspend_user", userId: bobId, suspended: false } })).status()).toBe(200);

  // the two old rankings are gone, in both languages; the French title is the owner's
  for (const [path, gone, here] of [["/discover", ["Editorial selection", "Top contributors"], "Most commented"], ["/fr/discover", ["Sélection éditoriale", "Contributeurs remarquables"], "Les plus commentées"]] as const) {
    await page.goto(path);
    for (const title of gone) await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: here, level: 2 })).toBeVisible();
  }
});
