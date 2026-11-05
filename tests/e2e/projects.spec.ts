import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * "Fund it together", steps 2 and 3: the public list and page of a project, contributions (simulated payment, the same handler as the
 * real webhook), the goal reached (the parcel is bought), a project withdrawn or out of time (everybody refunded), anonymity.
 * Self-contained: its own users, in a stretch of land no other spec uses (x 24 900 – 25 400, y 10 400).
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const png = (w: number, h: number, c = "#1f7a8c") => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();

async function api(email: string, role?: "admin" | "moderator"): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  return ctx;
}
const signIn = async (page: Page, email: string, role?: "admin" | "moderator") => { expect((await page.request.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy(); };
async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const admin = process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres";
  const c = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await c.connect();
  try { return (await c.query(text, params)).rows as T[]; } finally { await c.end(); }
}

type R = { x: number; y: number; w: number; h: number };
const E: R = { x: 24_900, y: 10_400, w: 100, h: 100 };
const F: R = { x: 25_100, y: 10_400, w: 100, h: 100 };
const G: R = { x: 25_300, y: 10_400, w: 100, h: 100 };

/** A project sent by `ctx` and approved by `mod`: returns its id and public code. */
async function openProject(ctx: APIRequestContext, mod: APIRequestContext, r: R, title: string, days = 14) {
  const sent = await ctx.post("/api/campaigns", { multipart: { x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h), days: String(days), title, description: `${title}: a parcel for everybody`, image: { name: "c.png", mimeType: "image/png", buffer: await png(r.w, r.h) } } });
  expect(sent.status(), await sent.text()).toBe(201);
  const { id, code, goalCents } = await sent.json();
  const ok = await mod.post("/api/admin/action", { data: { action: "review_campaign", campaignId: id, decision: "approve" } });
  expect(ok.status(), await ok.text()).toBe(200);
  return { id: id as string, code: code as string, goal: goalCents as number };
}
/** Starts a contribution through the real API and pays it through the simulated payment page's handler. */
async function contribute(ctx: APIRequestContext, projectId: string, amountCents: number, outcome: "paid" | "expired" = "paid") {
  const r = await ctx.post(`/api/campaigns/${projectId}/contribute`, { data: { amountCents, locale: "en" } });
  expect(r.status(), await r.text()).toBe(200);
  const { contributionId, url } = await r.json();
  expect(url).toBe(`/dev/checkout/${contributionId}`);
  const pay = await ctx.post("/api/dev/pay", { data: { orderId: contributionId, outcome } });
  expect((await pay.json()).outcome).toBe("processed");
  return contributionId as string;
}
const status = async (id: string) => (await sql<{ status: string }>("select status from public.contributions where id = $1", [id]))[0]!.status;
const free = async (ctx: APIRequestContext, r: R) => ((await (await ctx.get(`/api/availability?x=${r.x}&y=${r.y}&w=${r.w}&h=${r.h}`)).json()) as { free: boolean }).free;
/** Contributions are anonymous: whoever looks at the page signed out never finds who contributed (nor in the data the page is made of). */
const expectAnonymous = async () => {
  const visitor = await pwRequest.newContext({ baseURL: BASE });
  for (const path of ["/projects", `/projects/${currentCode}`, `/fr/projects/${currentCode}`]) {
    const html = await (await visitor.get(path)).text();
    for (const name of ["anon.zebra", "anon.walrus", "anon.otter"]) expect(html, `${path} must not name ${name}`).not.toContain(name);
  }
  await visitor.dispose();
};
let currentCode = "";
const maintenance = async () => {
  const c = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { authorization: "Bearer e2e-cron-secret" } });
  const r = await c.get("/api/cron/maintenance");
  expect(r.status()).toBe(200);
  const j = await r.json();
  await c.dispose();
  return j as { expiredCampaigns: number; contributionRefunds: number };
};

test.describe.serial("group projects: contribute, fund, refund", () => {
  let maker: APIRequestContext, ann: APIRequestContext, ben: APIRequestContext, cat: APIRequestContext, mod: APIRequestContext, visitor: APIRequestContext;
  let project: { id: string; code: string; goal: number };
  const NAMES = ["anon.zebra", "anon.walrus", "anon.otter"]; // distinctive names: none of them may ever appear on a public page

  test.beforeAll(async () => {
    [maker, ann, ben, cat, mod] = await Promise.all([api("maker.fund@example.test"), api("anon.zebra@example.test"), api("anon.walrus@example.test"), api("anon.otter@example.test"), api("mod.fund@example.test", "moderator")]);
    visitor = await pwRequest.newContext({ baseURL: BASE });
    project = await openProject(maker, mod, E, "The big blue wall", 14);
    currentCode = project.code;
  });
  test.afterAll(async () => { await Promise.all([maker, ann, ben, cat, mod, visitor].map((c) => c.dispose())); });

  test("the project is public: in the list, with its picture, in English and in French; empty counters say so", async ({ page }) => {
    await page.goto("/projects");
    const card = page.getByTestId("project-card").filter({ hasText: "The big blue wall" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("by maker.fund");
    await expect(card).toContainText("No contribution yet");
    await expect(card).toContainText(/days? left/);
    await expect(page.getByTestId("sort-ending")).toHaveAttribute("aria-current", "true");
    await page.getByTestId("sort-funded").click();
    await expect(page).toHaveURL(/sort=funded/);
    await expect(page.getByTestId("project-card").filter({ hasText: "The big blue wall" })).toBeVisible();
    const img = await visitor.get(`/api/campaigns/${project.id}/image?max=512`);
    expect(img.status()).toBe(200);
    expect(img.headers()["cache-control"]).toContain("public");
    await page.goto("/fr/projects");
    await expect(page.getByRole("heading", { name: "Projets collectifs", level: 1 })).toBeVisible();
    await expect(page.getByTestId("project-card").filter({ hasText: "The big blue wall" })).toContainText("Aucune participation pour l'instant");
  });

  test("the page of the project: goal, progress, no way to pay without an account", async ({ page }) => {
    await page.goto(`/projects/${project.code}`);
    await expect(page.getByTestId("project-heading")).toHaveText("The big blue wall");
    await expect(page.getByTestId("project-status")).toHaveText("Collecting");
    await expect(page.getByTestId("project-description")).toContainText("a parcel for everybody");
    await expect(page.getByTestId("project-image")).toBeVisible();
    await expect(page.getByTestId("project-contributors")).toHaveText("No contribution yet");
    await expect(page.getByTestId("contribute-signin")).toBeVisible();
    await expect(page.getByTestId("contribute-form")).toHaveCount(0);
    // a project that does not exist, or that nobody opened, is a 404
    const scan = () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect((await scan()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), "the project page is accessible (axe)").toEqual([]);
    await page.goto("/projects");
    expect((await scan()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), "the list is accessible (axe)").toEqual([]);
    expect((await page.goto("/projects/0123456789"))!.status()).toBe(404);
    expect((await page.goto("/projects/not-a-code"))!.status()).toBe(404);
  });

  test("the server decides what an amount may be", async () => {
    const post = (ctx: APIRequestContext, amount: unknown) => ctx.post(`/api/campaigns/${project.id}/contribute`, { data: { amountCents: amount } });
    expect((await post(visitor, 5000)).status()).toBe(401);
    for (const [amount, code, http] of [[100, "px_amount_too_low", 422], [project.goal + 1, "px_amount_too_high", 422], [project.goal - 10, "px_amount_leaves_dust", 422], [0, "px_invalid_amount", 400], [12.5, "px_invalid_amount", 400], ["50", "px_invalid_amount", 400]] as const) {
      const r = await post(ann, amount);
      expect(r.status(), `${amount}`).toBe(http);
      expect((await r.json()).error).toBe(code);
    }
    expect((await ann.post("/api/campaigns/00000000-0000-0000-0000-000000000000/contribute", { data: { amountCents: 5000 } })).status()).toBe(404);
    expect((await sql("select 1 from public.contributions")).length).toBe(0); // nothing was held by any of these
  });

  test("ann contributes through the page: quick amount, simulated payment, thank-you page; the total goes up, her name never shows", async ({ page }) => {
    await signIn(page, "anon.zebra@example.test");
    await page.goto(`/projects/${project.code}`);
    await expect(page.getByTestId("contribute-submit")).toBeDisabled();
    await page.getByTestId("contribute-amount").fill("1");
    await expect(page.getByTestId("contribute-problem")).toContainText("minimum");
    await page.getByTestId("quick-25").click();
    await expect(page.getByTestId("contribute-submit")).toContainText("25");
    await page.getByTestId("contribute-submit").click();
    await page.waitForURL(/\/dev\/checkout\//);
    await expect(page.getByTestId("dev-contribution")).toContainText("The big blue wall");
    await page.getByTestId("dev-pay").click();
    await page.waitForURL(/\/checkout\/success\?contribution=/);
    await expect(page.getByTestId("contribution-result")).toHaveAttribute("data-state", "paid", { timeout: 20_000 });
    await page.getByTestId("view-project").click();
    await expect(page.getByTestId("project-raised")).toContainText("25");
    await expect(page.getByTestId("project-contributors")).toHaveText("1 contributor");
    await expectAnonymous();
    expect((await sql("select count(*)::int n from public.contributions where status = 'paid'"))[0]).toMatchObject({ n: 1 });
  });

  test("ben starts a payment and walks away: his share is given back at once", async ({ page }) => {
    await signIn(page, "anon.walrus@example.test");
    await page.goto(`/projects/${project.code}`);
    await page.getByTestId("quick-50").click();
    await page.getByTestId("contribute-submit").click();
    await page.waitForURL(/\/dev\/checkout\//);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    expect(await status(id)).toBe("pending");
    await page.getByTestId("dev-cancel").click();
    await expect(page.getByTestId("contribution-cancel")).toHaveAttribute("data-done", "true");
    expect(["expired", "canceled"]).toContain(await status(id)); // the simulated page's "Abandon" is Stripe's session-expired event
    // two payments in progress by the same person are refused
    const first = await ben.post(`/api/campaigns/${project.id}/contribute`, { data: { amountCents: 1000 } });
    expect(first.status()).toBe(200);
    const second = await ben.post(`/api/campaigns/${project.id}/contribute`, { data: { amountCents: 1000 } });
    expect(second.status()).toBe(409);
    expect((await second.json()).error).toBe("px_contribution_in_progress");
    // he gives up this one too, the way the return page does: it is "canceled", and he can start again right away
    const firstId = (await first.json()).contributionId as string;
    expect((await ben.delete(`/api/contributions/${firstId}`)).status()).toBe(200);
    expect(await status(firstId)).toBe("canceled");
    expect((await cat.delete(`/api/contributions/${firstId}`)).status()).toBe(404); // and it was never cat's
    await ben.delete(`/api/contributions/${(await (await ben.post(`/api/campaigns/${project.id}/contribute`, { data: { amountCents: 1000 } })).json()).contributionId}`);
  });

  test("the goal is reached: the parcel is the creator's, published, on the map; nothing more can be contributed", async ({ page }) => {
    const unit = Number((await sql<{ value: number }>("select value from public.app_settings where key = 'price_unit_cents'"))[0]!.value);
    expect(project.goal).toBe(100 * 100 * unit);
    const rest = project.goal - 2500;
    // cat pays most of what is missing…
    await contribute(cat, project.id, rest - 10_000);
    // …and ben, through the page, takes exactly the rest
    await signIn(page, "anon.walrus@example.test");
    await page.goto(`/projects/${project.code}`);
    await expect(page.getByTestId("project-raised")).toBeVisible();
    await page.getByTestId("quick-rest").click();
    await page.getByTestId("contribute-submit").click();
    await page.waitForURL(/\/dev\/checkout\//);
    await page.getByTestId("dev-pay").click();
    await page.waitForURL(/\/checkout\/success\?contribution=/);
    await expect(page.getByTestId("contribution-result")).toHaveAttribute("data-state", "paid", { timeout: 20_000 });
    await expect(page.getByTestId("contribution-result")).toContainText("completed the goal");
    await page.getByTestId("view-project").click();

    await expect(page.getByTestId("project-status")).toHaveText("Funded");
    await expect(page.getByTestId("project-funded")).toBeVisible();
    await expect(page.getByTestId("project-contributors")).toHaveText("3 contributors");
    await expect(page.getByTestId("contribute-form")).toHaveCount(0);
    await expectAnonymous();
    const camp = (await sql<{ status: string; parcel_id: string }>("select status, parcel_id from public.campaigns where id = $1", [project.id]))[0]!;
    expect(camp.status).toBe("funded");
    const parcel = (await sql<{ code: string; status: string; owner: string; published: string | null }>(
      "select p.code, p.status, u.username as owner, p.published_asset_id as published from public.parcels p join public.profiles u on u.id = p.owner_id where p.id = $1", [camp.parcel_id]))[0]!;
    expect(parcel).toMatchObject({ status: "active", owner: "maker.fund" });
    expect(parcel.published).toBeTruthy();
    await page.getByTestId("project-parcel").click();
    await expect(page).toHaveURL(new RegExp(`/p/${parcel.code}$`));
    // it is on the map (the tile lists active parcels), and the counters count it
    const tile = (await (await visitor.get(`/api/map/tiles/${Math.floor(E.x / 1000)}/${Math.floor(E.y / 1000)}`)).json()) as [string, number, number, number, number][];
    expect(tile.find((p) => p[0] === parcel.code)?.slice(1, 5)).toEqual([E.x, E.y, 100, 100]);
    // later contributions are refused, and the payment of a person who was still paying is refunded, not kept
    const late = await ann.post(`/api/campaigns/${project.id}/contribute`, { data: { amountCents: 500 } });
    expect(late.status()).toBe(409);
    expect((await late.json()).error).toBe("px_campaign_closed");
    expect((await sql<{ s: string }>("select coalesce(sum(amount_cents), 0)::text s from public.contributions where campaign_id = $1 and status = 'paid'", [project.id]))[0]!.s).toBe(String(project.goal));
    // the creator sees it in her account
    await signIn(page, "maker.fund@example.test");
    await page.goto("/account/campaigns");
    const item = page.getByTestId("campaign-item").filter({ hasText: "The big blue wall" });
    await expect(item.getByTestId("campaign-status")).toHaveText("Funded");
    await expect(item.getByTestId("campaign-raised")).toContainText("3 contributors");
    await expect(item.getByTestId("campaign-public")).toBeVisible();
    await expect(item.getByTestId("campaign-withdraw")).toHaveCount(0); // a bought parcel cannot be withdrawn
    await page.goto("/account");
    await expect(page.getByTestId("news-project_funded")).toContainText("The big blue wall");
    await expect(page.getByTestId("news-project_funded")).toContainText("the parcel is yours");
  });

  test("the creator withdraws a project that has money: everybody is refunded at once and the zone is free", async ({ page }) => {
    const p = await openProject(maker, mod, F, "A wall that will not happen");
    const k1 = await contribute(ann, p.id, 5000);
    const k2 = await contribute(cat, p.id, 20_000);
    expect(await free(visitor, F)).toBe(false);
    await signIn(page, "maker.fund@example.test");
    await page.goto("/account/campaigns");
    const item = page.getByTestId("campaign-item").filter({ hasText: "A wall that will not happen" });
    await expect(item.getByTestId("campaign-raised")).toContainText("2 contributors");
    page.once("dialog", (d) => void d.accept());
    await item.getByTestId("campaign-withdraw").click();
    await expect(item.getByTestId("campaign-status")).toHaveText("Withdrawn");
    for (const k of [k1, k2]) expect(await status(k)).toBe("refunded");
    const [r] = await sql<{ n: string }>("select sum(amount_refunded_cents)::text n from public.contributions where campaign_id = $1", [p.id]);
    expect(r!.n).toBe("25000");
    expect(await free(visitor, F)).toBe(true);
    await page.goto(`/projects/${p.code}`);
    await expect(page.getByTestId("project-ended")).toContainText("refunded");
    await expect(page.getByTestId("contribute-form")).toHaveCount(0);
  });

  test("a project out of time: the maintenance job closes it and refunds everybody, once", async ({ page }) => {
    const other = await api("maker2.fund@example.test");
    const p = await openProject(other, mod, G, "Out of time");
    const k = await contribute(ann, p.id, 7500);
    expect(await status(k)).toBe("paid");
    await sql("update public.campaigns set deadline = now() - interval '1 minute' where id = $1", [p.id]);
    await sql("update public.parcel_reservations set expires_at = now() - interval '1 minute' where parcel_id = (select parcel_id from public.campaigns where id = $1)", [p.id]);
    const first = await maintenance();
    expect(first.expiredCampaigns).toBeGreaterThanOrEqual(1);
    expect(first.contributionRefunds).toBeGreaterThanOrEqual(1);
    expect(await status(k)).toBe("refunded");
    expect(await maintenance()).toMatchObject({ expiredCampaigns: 0, contributionRefunds: 0 }); // nothing more to do: it is not done twice
    expect(await free(visitor, G)).toBe(true);
    await page.goto(`/projects/${p.code}`);
    await expect(page.getByTestId("project-status")).toHaveText("Ended without its goal");
    await expect(page.getByTestId("project-ended")).toContainText("refunded");
    await signIn(page, "maker2.fund@example.test");
    await page.goto("/account");
    await expect(page.getByTestId("news-project_expired")).toContainText("Out of time");
    const audit = await sql<{ action: string }>("select action from public.audit_logs where target_id = $1 or target_id = $2 order by id", [p.id, k]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["campaign.expired", "contribution.paid", "contribution.refunded"]));
    await other.dispose();
  });

  test("the maintenance job refuses a call without its secret", async () => {
    expect((await visitor.get("/api/cron/maintenance")).status()).toBe(401);
  });

  test("the list shows the funded project, not the ended ones; the admin sees the money", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByTestId("project-card").filter({ hasText: "The big blue wall" })).toContainText("Funded");
    await expect(page.getByTestId("project-card").filter({ hasText: "Out of time" })).toHaveCount(0);
    await expect(page.getByTestId("project-card").filter({ hasText: "A wall that will not happen" })).toHaveCount(0);
    await signIn(page, "mod.fund@example.test", "moderator");
    await page.goto("/admin/campaigns");
    const row = page.getByTestId("campaign-handled").locator("tr").filter({ hasText: "The big blue wall" });
    await expect(row.getByTestId("campaign-money")).toContainText("3 contributors");
    await expect(row.getByTestId("campaign-status")).toHaveText("Funded");
    // the dashboard counts the projects, and the money of the funded ones (not in the order revenue)
    await page.goto("/admin");
    const stats = page.getByTestId("campaign-stats");
    await expect(stats).toBeVisible();
    await expect(stats).toContainText("Projects to review");
    await expect(stats).toContainText("Funded projects: raised (EUR)");
    await expect(stats).toContainText("Contribution refunds due");
  });
});
