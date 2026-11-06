import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import sharp from "sharp";

/**
 * "Fund it together", step 4: the group projects that are collecting are on the map — a hatched zone with its progress when it is big
 * enough on the screen, a pin when it is a speck — a click opens a small card that leads to the project, and the drawing stays cheap.
 * Own stretch of land (x 25 600 – 25 700, y 10 400).
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const P = { x: 25_600, y: 10_400, w: 100, h: 100 };
const CENTER = { x: P.x + P.w / 2, y: P.y + P.h / 2 };
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#7a2bd0" } }).png().toBuffer();

type Rect = { code: string; x: number; y: number; w: number; h: number; look: "pin" | "zone" };
type Eng = { projectScreenRects: () => Rect[]; setProjects: (l: unknown[]) => void; invalidate: () => void; cam: { x: number; y: number; scale: number }; drawMs: number; geoPending: boolean; geo: unknown };

async function api(email: string, role?: "moderator"): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  expect((await ctx.post("/api/dev/login", { data: { email, role } })).ok()).toBeTruthy();
  return ctx;
}
const ready = (page: Page) => page.waitForFunction(() => { const e = (window as unknown as { __pxEngine?: Eng }).__pxEngine; return Boolean(e && e.geo && !e.geoPending && e.projectScreenRects().length > 0); }, undefined, { timeout: 30_000 });
const rects = (page: Page) => page.evaluate(() => (window as unknown as { __pxEngine: Eng }).__pxEngine.projectScreenRects());
const mean = async (page: Page, clip: { x: number; y: number; width: number; height: number }) => (await sharp(await page.screenshot({ clip })).stats()).channels.map((c) => c.mean);

test.describe.serial("group projects on the map", () => {
  let maker: APIRequestContext, mod: APIRequestContext, visitor: APIRequestContext;
  let project: { id: string; code: string };

  test.beforeAll(async () => {
    [maker, mod] = await Promise.all([api("maker.map@example.test"), api("mod.map@example.test", "moderator")]);
    visitor = await pwRequest.newContext({ baseURL: BASE });
    const sent = await maker.post("/api/campaigns", { multipart: { x: String(P.x), y: String(P.y), w: String(P.w), h: String(P.h), days: "14", title: "The mural on the map", description: "Seen from the map", image: { name: "c.png", mimeType: "image/png", buffer: await png(P.w, P.h) } } });
    expect(sent.status(), await sent.text()).toBe(201);
    project = await sent.json();
    expect((await mod.post("/api/admin/action", { data: { action: "review_campaign", campaignId: project.id, decision: "approve" } })).status()).toBe(200);
  });
  test.afterAll(async () => { await Promise.all([maker, mod, visitor].map((c) => c.dispose())); });
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1360, height: 860 }); });

  test("the public list: only what is collecting, public data only, cached for a moment", async () => {
    const r = await visitor.get("/api/map/projects");
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toContain("public");
    const list = (await r.json()) as Record<string, unknown>[];
    const mine = list.find((p) => p.code === project.code)!;
    expect(mine).toMatchObject({ title: "The mural on the map", x: P.x, y: P.y, w: 100, h: 100, water: false, raisedCents: 0, contributors: 0 });
    expect(Number(mine.goalCents)).toBeGreaterThan(0);
    expect(Object.keys(mine).sort()).toEqual(["code", "contributors", "currency", "goalCents", "h", "id", "raisedCents", "secondsLeft", "title", "w", "water", "x", "y"]); // nothing about who paid, who made it, or what it says
  });

  test("close up the zone is hatched with its progress bar; far away it is a pin; the pin and the zone are really painted", async ({ page }) => {
    await page.goto(`/map?x=${CENTER.x}&y=${CENTER.y}&z=4`);
    await ready(page);
    await page.waitForTimeout(1200); // tiles and names settle
    const canvas = (await page.getByRole("application").boundingBox())!;
    const [r] = (await rects(page)).filter((x) => x.code === project.code);
    expect(r!.look).toBe("zone");
    expect(r!.w).toBeCloseTo(400, 0);
    // inside the zone the land is tinted orange (R − B grows); the same size of plain land beside it is not
    const inside = await mean(page, { x: canvas.x + r!.x + 40, y: canvas.y + r!.y + 40, width: 200, height: 200 });
    const beside = await mean(page, { x: canvas.x + r!.x - 260, y: canvas.y + r!.y + 40, width: 200, height: 200 });
    expect(inside[0]! - inside[2]!, "the zone is tinted").toBeGreaterThan(beside[0]! - beside[2]! + 12);

    await page.goto(`/map?x=${CENTER.x}&y=${CENTER.y}&z=0.05`);
    await ready(page);
    await page.waitForTimeout(800);
    const [far] = (await rects(page)).filter((x) => x.code === project.code);
    expect(far!.look).toBe("pin");
    const c2 = (await page.getByRole("application").boundingBox())!;
    const dot = await mean(page, { x: c2.x + far!.x + far!.w / 2 - 2, y: c2.y + far!.y + far!.h / 2 - 2, width: 4, height: 4 });
    // the accent of a project that is collecting is the soft gold of the night theme (214, 171, 114): warm, and neither the cyan of a selection nor the ivory of a name
    expect(dot[0]!, "the pin is the accent colour: warm (red high)").toBeGreaterThan(190);
    expect(dot[1]!, "the pin is the accent colour: gold (green in the middle)").toBeGreaterThan(130);
    expect(dot[2]!, "the pin is the accent colour: gold, not ivory (blue low)").toBeLessThan(150);
    expect(dot[0]! - dot[2]!, "the pin is the accent colour: gold").toBeGreaterThan(60);
  });

  test("hovering shows a hand, a click opens the card with its progress, the card leads to the project; a click elsewhere closes it", async ({ page }) => {
    await page.goto(`/map?x=${CENTER.x}&y=${CENTER.y}&z=4`);
    await ready(page);
    const canvasEl = page.getByRole("application");
    const box = (await canvasEl.boundingBox())!;
    const [r] = (await rects(page)).filter((x) => x.code === project.code);
    const cx = box.x + r!.x + r!.w / 2, cy = box.y + r!.y + r!.h / 2;
    await page.mouse.move(cx, cy);
    await expect.poll(() => canvasEl.evaluate((c) => (c as HTMLCanvasElement).style.cursor)).toBe("pointer");
    await page.mouse.move(box.x + 40, box.y + 40);
    await expect.poll(() => canvasEl.evaluate((c) => (c as HTMLCanvasElement).style.cursor)).toBe("grab");

    await page.mouse.click(cx, cy);
    const card = page.getByTestId("project-map-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("project-map-title")).toHaveText("The mural on the map");
    await expect(card).toContainText("No contribution yet");
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    // closing, and a click on empty land
    await card.getByTestId("project-map-close").click();
    await expect(card).toHaveCount(0);
    await page.mouse.click(cx, cy);
    await expect(card).toBeVisible();
    await page.mouse.click(box.x + 250, box.y + 320); // plain land, left of the zone and clear of the cards over the map
    await expect(card).toHaveCount(0);
    // and the way to the project
    await page.mouse.click(cx, cy);
    await card.getByTestId("project-map-open").click();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.code}$`));
    await expect(page.getByTestId("project-heading")).toHaveText("The mural on the map");
  });

  test("a pin can be clicked too, with a generous target", async ({ page }) => {
    await page.goto(`/map?x=${CENTER.x}&y=${CENTER.y}&z=0.05`);
    await ready(page);
    const box = (await page.getByRole("application").boundingBox())!;
    const [r] = (await rects(page)).filter((x) => x.code === project.code);
    await page.mouse.click(box.x + r!.x + r!.w / 2 + 7, box.y + r!.y + r!.h / 2 - 6); // not exactly on it: a finger is bigger than 5 px
    await expect(page.getByTestId("project-map-card")).toBeVisible();
  });

  test("when buying, the zone is still drawn but a click places a parcel (and says the zone is being held); the card stays closed", async ({ page }) => {
    await page.goto(`/map?x=${CENTER.x}&y=${CENTER.y}&z=4`);
    await ready(page);
    await page.getByTestId("find-your-spot").click();
    await expect(page.getByTestId("buy-panel")).toBeVisible();
    await page.waitForTimeout(1800);
    const box = (await page.getByRole("application").boundingBox())!;
    const [r] = (await rects(page)).filter((x) => x.code === project.code);
    await page.mouse.click(box.x + r!.x + r!.w / 2, box.y + r!.y + r!.h / 2);
    await expect(page.getByTestId("project-map-card")).toHaveCount(0);
    await expect(page.getByTestId("buy-status")).toContainText(/reserving|overlaps|reserved/i, { timeout: 15_000 });
  });

  test("the drawing stays cheap: 300 projects in view add next to nothing to the time of a frame", async ({ page }) => {
    await page.goto(`/map?x=${CENTER.x}&y=${CENTER.y}&z=1.2`);
    await ready(page);
    await page.waitForTimeout(1500);
    const run = (n: number) => page.evaluate(async (count) => {
      const e = (window as unknown as { __pxEngine: Eng }).__pxEngine;
      const real = e.projectScreenRects().length;
      // synthetic projects scattered over what the screen shows (and beyond)
      const fake = Array.from({ length: count }, (_, i) => ({ id: `f${i}`, code: `fake${i}`, title: "x", x: e.cam.x - 900 + (i % 20) * 90, y: e.cam.y - 500 + Math.floor(i / 20) * 70, w: i % 3 === 0 ? 20 : 60, h: i % 3 === 0 ? 20 : 45, water: false, raisedCents: i * 100, goalCents: 10_000, currency: "eur", contributors: i % 5, secondsLeft: 100_000 }));
      e.setProjects(count === 0 ? [] : fake);
      const times: number[] = [];
      for (let k = 0; k < 24; k++) { e.cam.x += 3; e.invalidate(); await new Promise((r) => requestAnimationFrame(() => r(null))); times.push(e.drawMs); }
      times.sort((a, b) => a - b);
      return { median: times[Math.floor(times.length / 2)]!, shown: e.projectScreenRects().length, real };
    }, n);
    const base = await run(0);
    const loaded = await run(300);
    expect(loaded.shown).toBe(300);
    expect(loaded.median, `a frame takes ${base.median.toFixed(1)} ms without projects, ${loaded.median.toFixed(1)} ms with 300`).toBeLessThan(base.median + 6);
  });

  test("a project that is withdrawn leaves the map (and its list)", async ({ page }) => {
    expect((await maker.post(`/api/campaigns/${project.id}/cancel`)).status()).toBe(200);
    const list = (await (await visitor.get("/api/map/projects")).json()) as { code: string }[];
    expect(list.map((p) => p.code)).not.toContain(project.code);
    await page.goto(`/map?x=${CENTER.x}&y=${CENTER.y}&z=4`);
    await page.waitForFunction(() => Boolean((window as unknown as { __pxEngine?: Eng }).__pxEngine));
    await page.waitForTimeout(2000);
    expect(await rects(page)).toEqual([]);
  });
});
