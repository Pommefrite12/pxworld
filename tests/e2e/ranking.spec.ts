import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * The ranking by likes (/ranking): creations and creators, all time / this month / this week. Honest by construction: the owner's own
 * like does not count, a creation hidden by moderation leaves the list, ties share a rank. Own stretch of land (x 27 900 – 28 000, y 11 400);
 * named so that it runs after the journey spec, which asserts exact global counters before any sale.
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOTS = [0, 1, 2].map((i) => ({ x: 27_900 + i * 40, y: 11_400, w: 20, h: 20 }));
const TITLES = ["Alpha wall", "Beta wall", "Gamma wall"];
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");

test.describe.configure({ mode: "serial" });

let ip = 0;
const contexts: APIRequestContext[] = [];
/** An API client signed in as `email`, from its own (fake) address so that per-address limits never mix tests up. */
async function as(email: string, role?: "moderator" | "admin") {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${100 + ++ip}` } });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  contexts.push(ctx);
  return ctx;
}
async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB_URL });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

const codes: string[] = [];
let owners: APIRequestContext[], fans: APIRequestContext[], mod: APIRequestContext;
const like = (ctx: APIRequestContext, i: number) => ctx.post("/api/likes", { data: { code: codes[i] } });
const unlike = (ctx: APIRequestContext, i: number) => ctx.delete("/api/likes", { data: { code: codes[i] } });

test.beforeAll(async () => {
  mod = await as("mod.rank@example.test", "moderator");
  owners = [await as("alpha.rank@example.test"), await as("beta.rank@example.test"), await as("gamma.rank@example.test")];
  fans = [await as("fan1.rank@example.test"), await as("fan2.rank@example.test"), await as("fan3.rank@example.test"), await as("fan4.rank@example.test")];
  for (let i = 0; i < 3; i++) {
    const s = SPOTS[i]!;
    const image = await sharp({ create: { width: s.w, height: s.h, channels: 3, background: ["#d02a8a", "#1f7a8c", "#e0a020"][i]! }, }).png().toBuffer();
    const r = await owners[i]!.post("/api/checkout", { multipart: { x: String(s.x), y: String(s.y), w: String(s.w), h: String(s.h), description: "A short description", title: TITLES[i]!, image: { name: "c.png", mimeType: "image/png", buffer: image } } });
    expect(r.status(), await r.text()).toBe(200);
    const { orderId } = await r.json();
    expect((await (await owners[i]!.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
    const [asset] = await sql<{ id: string }>("select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'", [s.x, s.y]);
    expect((await mod.post("/api/admin/action", { data: { action: "review_asset", assetId: asset!.id, decision: "approve" } })).status()).toBe(200);
    codes.push((await sql<{ code: string }>("select code from public.parcels where x = $1 and y = $2", [s.x, s.y]))[0]!.code);
  }
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.dispose())); });

test("nothing is ranked before anybody is liked: a clear empty state, in both languages", async ({ page }) => {
  await page.goto("/ranking");
  await expect(page.getByRole("heading", { name: "Ranking", level: 1 })).toBeVisible();
  await expect(page.getByTestId("ranking-empty")).toContainText("Nobody has been liked");
  await page.goto("/fr/ranking");
  await expect(page.getByRole("heading", { name: "Classement", level: 1 })).toBeVisible();
  await expect(page.getByTestId("ranking-empty")).toContainText("Personne n'a encore reçu");
});

test("creations are ranked by likes; the owner's own like does not count", async ({ page }) => {
  // Alpha: three fans and its owner; Beta: two fans; Gamma: one fan
  for (const f of fans.slice(0, 3)) expect((await like(f, 0)).status()).toBe(200);
  expect((await like(owners[0]!, 0)).status()).toBe(200); // the owner likes their own creation: allowed, but it will not count
  for (const f of fans.slice(0, 2)) expect((await like(f, 1)).status()).toBe(200);
  expect((await like(fans[0]!, 2)).status()).toBe(200);

  await page.goto("/ranking");
  const rows = page.getByTestId("ranking-row");
  await expect(rows).toHaveCount(3);
  expect(await rows.getByTestId("ranking-title").allTextContents()).toEqual(TITLES);
  expect(await rows.getByTestId("ranking-rank").allTextContents()).toEqual(["1", "2", "3"]);
  expect((await rows.getByTestId("ranking-likes").allTextContents()).map((t) => t.replace(/\D/g, ""))).toEqual(["3", "2", "1"]); // Alpha is 3, not 4
  await expect(rows.first()).toHaveAttribute("href", new RegExp(`/p/${codes[0]}$`));
  await expect(rows.first()).toContainText("by alpha.rank");
  // …and with real rows it is still accessible (the colours of the first three ranks included)
  for (const path of ["/ranking", "/ranking?board=creators", "/fr/ranking"]) {
    await page.goto(path);
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${path} (axe)`).toEqual([]);
  }
});

test("ties share a rank; liking and unliking move the ranking", async ({ page }) => {
  expect((await like(fans[3]!, 2)).status()).toBe(200); // Gamma: 2, like Beta
  await page.goto("/ranking");
  expect(await page.getByTestId("ranking-rank").allTextContents()).toEqual(["1", "2", "2"]);
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(["Alpha wall", "Beta wall", "Gamma wall"]); // the earlier published first among the equals
  expect((await unlike(fans[3]!, 2)).status()).toBe(200);
  await page.reload();
  expect(await page.getByTestId("ranking-rank").allTextContents()).toEqual(["1", "2", "3"]);
});

test("the creators' board adds up their creations; the periods are tabs that keep the board", async ({ page }) => {
  await page.goto("/ranking");
  await page.getByTestId("board-creators").click();
  await expect(page).toHaveURL(/board=creators/);
  const list = page.getByTestId("ranking-list");
  await expect(list).toHaveAttribute("data-board", "creators");
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(["alpha.rank", "beta.rank", "gamma.rank"]);
  await expect(page.getByTestId("ranking-row").first()).toHaveAttribute("href", "/u/alpha.rank");
  // the tabs keep the other choice
  await page.getByTestId("period-month").click();
  await expect(page).toHaveURL(/board=creators/);
  await expect(page).toHaveURL(/period=month/);
  await expect(page.getByTestId("period-month")).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("ranking-list")).toHaveAttribute("data-period", "month");
  // fresh likes count in the week too
  await page.getByTestId("period-week").click();
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(["alpha.rank", "beta.rank", "gamma.rank"]);
  // old likes drop out of the week and the month, not out of all time
  await sql("update public.parcel_likes set created_at = now() - interval '40 days' where parcel_id = (select id from public.parcels where code = $1)", [codes[0]]);
  await page.goto("/ranking?board=creations&period=week");
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(["Beta wall", "Gamma wall"]);
  await page.goto("/ranking?board=creations&period=month");
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(["Beta wall", "Gamma wall"]);
  await page.goto("/ranking?board=creations&period=all");
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(TITLES);
  // anything that is not a board or a period falls back to the defaults
  await page.goto("/ranking?board=nonsense&period=forever");
  await expect(page.getByTestId("ranking-list")).toHaveAttribute("data-board", "creations");
  await expect(page.getByTestId("ranking-list")).toHaveAttribute("data-period", "all");
});

test("a creation hidden by moderation, or whose likers are suspended, leaves the ranking", async ({ page }) => {
  const [parcel] = await sql<{ id: string }>("select id from public.parcels where code = $1", [codes[1]]);
  expect((await mod.post("/api/admin/action", { data: { action: "hide_parcel", parcelId: parcel!.id, hidden: true, reason: "test" } })).status()).toBe(200);
  await page.goto("/ranking?period=all");
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(["Alpha wall", "Gamma wall"]);
  expect((await mod.post("/api/admin/action", { data: { action: "hide_parcel", parcelId: parcel!.id, hidden: false } })).status()).toBe(200);
  // a suspended account's likes stop counting
  await sql("update public.profiles set status = 'suspended' where id in (select id from auth.users where email in ('fan1.rank@example.test', 'fan2.rank@example.test'))");
  await page.goto("/ranking?period=all");
  const likes = (await page.getByTestId("ranking-likes").allTextContents()).map((t) => Number(t.replace(/\D/g, "")));
  expect(await page.getByTestId("ranking-title").allTextContents()).toEqual(["Alpha wall"]); // only fan3 is left, and he liked Alpha
  expect(likes).toEqual([1]);
  await sql("update public.profiles set status = 'active' where id in (select id from auth.users where email in ('fan1.rank@example.test', 'fan2.rank@example.test'))");
});

test("the page is linked from the footer and from Discover", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByTestId("discover-ranking")).toHaveAttribute("href", "/ranking");
  await page.getByRole("contentinfo").getByRole("link", { name: "Ranking" }).click();
  await expect(page).toHaveURL(/\/ranking$/);
});
