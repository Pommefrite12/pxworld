import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * Comments under a parcel: the "Comment" button of the map card (it replaced "Open page"). Reading is public, writing needs an
 * account; the author, the parcel's owner and moderators can remove a comment; a comment can be reported. (Own piece of the
 * map, and named so that it runs after the journey spec, which asserts exact global counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 27_400, y: 11_200, w: 30, h: 30 };
const TITLE = "Comment wall";
const DB_URL = (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e");

test.describe.configure({ mode: "serial" });

let code = "";
let ip = 0;
const contexts: APIRequestContext[] = [];

/** An API client signed in as `email`, from its own (fake) address so that per-address limits never mix tests up. */
async function as(email: string, role?: "moderator" | "admin") {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${60 + ++ip}` } });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  contexts.push(ctx);
  return ctx;
}
const comments = async (ctx: APIRequestContext, query = "") => (await ctx.get(`/api/comments?code=${code}${query}`)).json() as Promise<{ total: number; comments: { id: string; body: string; canRemove: boolean; author: { username: string } }[]; next: string | null }>;
const say = (ctx: APIRequestContext, body: string) => ctx.post("/api/comments", { data: { code, body } });

test.beforeAll(async () => {
  const owner = await as("wallowner@example.test");
  const admin = await as("admin.wall@example.test", "admin");
  const image = await sharp({ create: { width: SPOT.w, height: SPOT.h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
  const r = await owner.post("/api/checkout", { multipart: { x: String(SPOT.x), y: String(SPOT.y), w: String(SPOT.w), h: String(SPOT.h), description: "A short description", title: TITLE, image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await owner.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const asset = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [SPOT.x, SPOT.y]);
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: asset.rows[0]!.id, decision: "approve" } })).status()).toBe(200);
  code = (await db.query(`select code from public.parcels where x = $1 and y = $2`, [SPOT.x, SPOT.y])).rows[0].code;
  await db.end();
});
test.afterAll(async () => { await Promise.all(contexts.map((c) => c.dispose())); });

test("the card has a Comment button instead of Open page; a visitor who is not signed in can read, and is sent to sign in to write", async ({ page }) => {
  await page.goto(`/p/${code}`);
  const card = page.locator("article.card");
  await expect(card.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(card.getByRole("link", { name: "Open page" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Open page" })).toHaveCount(0);
  await expect(card.getByTestId("comment-button")).toHaveText("Comment");
  await card.getByTestId("comment-button").click();
  await expect(card.getByTestId("comments-empty")).toBeVisible();
  await expect(card.getByTestId("comment-input")).toHaveCount(0);
  await expect(card.getByTestId("comment-signin")).toHaveAttribute("href", `/auth/sign-in?next=${encodeURIComponent(`/p/${code}`)}`);
  // …and the API refuses writing without an account
  const anon = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.58" } });
  expect((await say(anon, "hello")).status()).toBe(401);
  expect((await anon.delete("/api/comments", { data: { id: "00000000-0000-0000-0000-000000000000" } })).status()).toBe(401);
  await anon.dispose();
});

test("a signed-in visitor writes a comment that stays after a reload, and can delete it", async ({ page }) => {
  const me = await as("commenter@example.test");
  // share the sign-in with the browser (same cookie as the API client)
  expect((await page.context().request.post("/api/dev/login", { data: { email: "commenter@example.test" } })).ok()).toBeTruthy();
  await page.goto(`/p/${code}`);
  const card = page.locator("article.card");
  await card.getByTestId("comment-button").click();
  await card.getByTestId("comment-input").fill("Superbe dessin !");
  await card.getByTestId("comment-send").click();
  await expect(card.getByTestId("comment")).toHaveCount(1);
  await expect(card.getByTestId("comment")).toContainText("Superbe dessin !");
  await expect(card.getByTestId("comment-input")).toHaveValue("");
  await expect(card.getByTestId("comment-count")).toHaveText("· 1");
  // the very same words again are refused with a clear message
  await card.getByTestId("comment-input").fill("Superbe dessin !");
  await card.getByTestId("comment-send").click();
  await expect(card.getByRole("alert")).toHaveText("You already said exactly that a moment ago.");
  await expect(card.getByTestId("comment")).toHaveCount(1);

  await page.reload();
  await page.locator("article.card").getByTestId("comment-button").click();
  await expect(page.locator("article.card").getByTestId("comment")).toHaveCount(1);
  expect((await comments(me)).total).toBe(1);

  await page.locator("article.card").getByTestId("comment-remove").click();
  await expect(page.locator("article.card").getByTestId("comment")).toHaveCount(0);
  await expect(page.locator("article.card").getByTestId("comments-empty")).toBeVisible();
  expect((await comments(me)).total).toBe(0);
});

test("who can remove a comment: its author, the parcel's owner and moderators — nobody else", async () => {
  const [owner, author, stranger, mod] = [await as("wallowner@example.test"), await as("author@example.test"), await as("stranger@example.test"), await as("mod.wall@example.test", "moderator")];
  const ids: string[] = [];
  for (const body of ["by the author", "owner will delete this", "moderator will delete this"]) {
    const r = await say(author, body);
    expect(r.status(), await r.text()).toBe(201);
    ids.push((await r.json()).comment.id);
  }
  // what each viewer is offered
  const flags = async (c: APIRequestContext) => (await comments(c)).comments.map((x) => x.canRemove);
  expect(await flags(author)).toEqual([true, true, true]);
  expect(await flags(owner)).toEqual([true, true, true]);
  expect(await flags(mod)).toEqual([true, true, true]);
  expect(await flags(stranger)).toEqual([false, false, false]);
  const anon = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.59" } });
  expect(await flags(anon)).toEqual([false, false, false]);
  await anon.dispose();
  // and what is allowed
  const del = (c: APIRequestContext, id: string) => c.delete("/api/comments", { data: { id } });
  expect((await del(stranger, ids[0]!)).status()).toBe(403);
  expect((await del(owner, ids[1]!)).status()).toBe(200);
  expect((await del(mod, ids[2]!)).status()).toBe(200);
  expect((await del(author, ids[0]!)).status()).toBe(200);
  expect((await del(author, ids[0]!)).status(), "already gone").toBe(404);
  expect((await comments(stranger)).total).toBe(0);
  // the owner's and the moderator's removals are journalised (the author's own is not)
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const logs = (await db.query(`select actor_role from public.audit_logs where action = 'comment.remove' order by id`)).rows.map((r) => r.actor_role);
  await db.end();
  expect(logs).toEqual(["owner", "moderator"]);
});

test("a comment can be reported: the moderator sees the words and removes them from the report", async ({ page }) => {
  const [author, reporter] = [await as("rude@example.test"), await as("reporter@example.test")];
  const said = await say(author, "something nasty");
  const id = (await said.json()).comment.id as string;
  const report = (reason: string, commentId = id) => reporter.post("/api/reports", { data: { code, reason, commentId } });
  expect((await report("hate")).status()).toBe(201);
  expect((await (await report("hate")).json()).duplicate, "the same report twice is one report").toBe(true);
  expect((await report("hate", "00000000-0000-0000-0000-000000000000")).status(), "not a comment of this parcel").toBe(404);
  expect((await report("nonsense")).status()).toBe(400);

  expect((await page.context().request.post("/api/dev/login", { data: { email: "admin.wall@example.test", role: "admin" } })).ok()).toBeTruthy();
  await page.goto("/admin/reports");
  const item = page.getByTestId("report-item").filter({ hasText: "something nasty" });
  await expect(item).toBeVisible();
  await expect(item).toContainText("Reported comment");
  await item.getByTestId("report-remove-comment").click(); // asks for a reason first
  await item.getByLabel("Reason").fill("insulting");
  await item.getByTestId("report-remove-comment").click();
  await expect.poll(async () => (await comments(reporter)).comments.some((c) => c.body === "something nasty")).toBe(false);
});

test("limits: empty or too long comments, bad cursors, a slow-down, and the list is paged", async () => {
  const user = await as("spammer@example.test");
  expect((await say(user, "   ")).status()).toBe(400);
  expect((await say(user, "x".repeat(501))).status()).toBe(400);
  expect((await say(user, "x".repeat(500))).status(), "500 is fine").toBe(201);
  expect((await user.post("/api/comments", { data: { code: "not-a-code", body: "hi" } })).status()).toBe(400);
  expect((await user.post("/api/comments", { data: { code: "0000000000", body: "hi" } })).status()).toBe(404);
  expect((await user.get(`/api/comments?code=${code}&before=garbage`)).status()).toBe(400);
  // markup is text: it comes back as typed, to be rendered by React as text
  expect((await say(user, "<img src=x onerror=alert(1)>")).status()).toBe(201);
  expect((await comments(user)).comments.map((c) => c.body)).toContain("<img src=x onerror=alert(1)>");
  // ten attempts per ten minutes and per account — refused ones count too — and six are used: four more get through, then it slows down
  const statuses: number[] = [];
  for (let i = 0; i < 9; i++) statuses.push((await say(user, `message ${i}`)).status());
  expect(statuses).toEqual([201, 201, 201, 201, 429, 429, 429, 429, 429]);

  // paging: three more people write eight comments each → more than one page, newest first, no overlap, nothing lost
  for (const who of ["p1@example.test", "p2@example.test", "p3@example.test"]) {
    const c = await as(who);
    for (let i = 0; i < 8; i++) expect((await say(c, `${who} #${i}`)).status()).toBe(201);
  }
  const first = await comments(user);
  expect(first.comments).toHaveLength(20);
  expect(first.next).toBeTruthy();
  const second = await comments(user, `&before=${encodeURIComponent(first.next!)}`);
  const all = [...first.comments, ...second.comments];
  expect(new Set(all.map((c) => c.id)).size, "no overlap between pages").toBe(all.length);
  expect(all.length).toBe(first.total);
  expect(second.next).toBeNull();
});

test("the owner is told about new comments on their account page; the admin sees all comments and removes one", async ({ page }) => {
  const [author, admin] = [await as("newsauthor@example.test"), await as("admin.wall@example.test", "admin")];
  const said = await say(author, "a comment for the news and the back office");
  const id = (await said.json()).comment.id as string;
  expect((await say(author, "a second one, so that it says two")).status()).toBe(201);

  // the owner finds it on the account page (and the author of a comment is not "told" about their own words)
  expect((await page.context().request.post("/api/dev/login", { data: { email: "wallowner@example.test" } })).ok()).toBeTruthy();
  await page.goto("/account");
  const news = page.getByTestId("news-comments");
  await expect(news).toBeVisible();
  await expect(news).toContainText("new comments");
  await expect(news).toContainText(TITLE);
  await news.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/p/${code}$`));
  await page.context().clearCookies();
  expect((await page.context().request.post("/api/dev/login", { data: { email: "newsauthor@example.test" } })).ok()).toBeTruthy();
  await page.goto("/account");
  await expect(page.getByTestId("news-comments")).toHaveCount(0);

  // the back office lists the comments and can remove one
  await page.context().clearCookies();
  expect((await page.context().request.post("/api/dev/login", { data: { email: "admin.wall@example.test", role: "admin" } })).ok()).toBeTruthy();
  await page.goto("/admin/comments");
  const row = page.getByTestId("admin-comment").filter({ hasText: "a comment for the news and the back office" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("newsauthor");
  await expect(row).toContainText(TITLE);
  await row.getByTestId("remove-comment").click();
  await row.getByRole("textbox").fill("off topic");
  await row.getByTestId("remove-comment").click();
  await expect(page.getByTestId("admin-comment").filter({ hasText: "a comment for the news and the back office" })).toHaveCount(0);
  await page.getByTestId("comments-removed").click();
  const gone = page.getByTestId("admin-comment").filter({ hasText: "a comment for the news and the back office" });
  await expect(gone).toBeVisible();
  await expect(gone).toContainText("removed by an administrator");
  expect((await comments(admin)).comments.map((c) => c.id)).not.toContain(id);
});
