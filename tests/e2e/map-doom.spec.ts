import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";

/**
 * "100 days to save the world" on the map itself: the unacquired land is corrupted as the countdown runs down (lavender field with
 * error colours), the acquired parcels stay intact and are marked from afar. Preview only (`?preview=`): no date is configured.
 * (Named so that it runs after the journey spec, which asserts exact global counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const SPOT = { x: 27_600, y: 11_300, w: 20, h: 20 };
const BLUE = [0x2b, 0x35, 0xe0];
const ORANGE = [240, 67, 22];

type Eng = { geoPending: boolean; geo: unknown; story: { step: number } | null; worldToScreen(x: number, y: number): { x: number; y: number } };
const ready = (page: Page) => page.waitForFunction(() => { const e = (window as unknown as { __pxEngine?: Eng }).__pxEngine; return Boolean(e && e.geo && !e.geoPending); }, undefined, { timeout: 60_000 });

/** Of the land pixels of the map (intact cream, corrupted lavender), which share is corrupted? */
const corruptedShare = (page: Page) => page.getByRole("application").evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let cream = 0, lav = 0, sparks = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    if (r === 251 && g === 245 && b === 230) cream++;
    else if ((r === 233 && g === 229 && b === 255) || (r === 220 && g === 214 && b === 255)) lav++;
    else if ((r === 25 && g === 211 && b === 255) || (r === 255 && g === 46 && b === 147)) sparks++; // cyan, magenta: the errors
  }
  return { share: cream + lav === 0 ? 0 : lav / (cream + lav), lav, sparks };
});

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1360, height: 860 }); });

test("without the story the land is never corrupted; with it, more and more of it as the days pass, all of it at the end", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await page.waitForTimeout(1500);
  expect((await corruptedShare(page)).lav, "the ordinary map has no lavender at all").toBe(0);

  const at = async (preview: string) => { await page.goto(`/?preview=${preview}`); await ready(page); await expect(page.getByTestId("doom-plate")).toBeVisible(); };
  await at("J-87");
  await expect.poll(async () => (await corruptedShare(page)).sparks, { timeout: 30_000 }).toBeGreaterThan(20); // the first errors: sparks of cyan and magenta
  await page.waitForTimeout(800);
  expect((await corruptedShare(page)).share, "J-87: nothing destroyed yet").toBeLessThan(0.05);
  await at("J-9");
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.3);
  expect((await corruptedShare(page)).share, "J-9: about half").toBeLessThan(0.62);
  await at("0");
  await expect.poll(async () => (await corruptedShare(page)).share, { timeout: 30_000 }).toBeGreaterThan(0.9);
});

test("the survivors: a parcel stays intact and framed among the corrupted land, and is marked from afar", async ({ page }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.230" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.231" } });
  expect((await api.post("/api/dev/login", { data: { email: "survivor@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.survivor@example.test", role: "admin" } })).ok()).toBeTruthy();
  const image = await sharp({ create: { width: SPOT.w, height: SPOT.h, channels: 3, background: "#2b35e0" } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(SPOT.x), y: String(SPOT.y), w: String(SPOT.w), h: String(SPOT.h), title: "Survivor", image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [SPOT.x, SPOT.y]);
  await db.end();
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);

  // the beacons list: where the parcels are, by 128-pixel cell, the centre of this one among them
  await expect.poll(async () => (await (await api.get("/api/map/beacons")).json()).c as number[], { timeout: 45_000 }).toEqual(expect.arrayContaining([SPOT.x + 10, SPOT.y + 10, 1]));
  const beacons = await api.get("/api/map/beacons?v=1");
  expect(beacons.headers()["cache-control"]).toContain("immutable");
  expect((await beacons.json()).cell).toBe(128);

  // at the scale of the world the parcel is a speck: with the story it gets an orange beacon, without it nothing
  const orangeAround = (p: Page) => p.getByRole("application").evaluate((c: HTMLCanvasElement, [x, y]) => {
    const e = (window as unknown as { __pxEngine: Eng }).__pxEngine, a = e.worldToScreen(x!, y!), k = c.width / c.clientWidth;
    const px = c.getContext("2d")!.getImageData(Math.max(0, Math.round((a.x - 12) * k)), Math.max(0, Math.round((a.y - 12) * k)), Math.round(24 * k), Math.round(24 * k)).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] === 240 && px[i + 1] === 67 && px[i + 2] === 22) n++;
    return n;
  }, [SPOT.x + 10, SPOT.y + 10]);
  await page.goto("/");
  await ready(page);
  await page.waitForTimeout(1500);
  expect(await orangeAround(page), "no story, no beacon").toBe(0);
  await page.goto("/?preview=0");
  await ready(page);
  await expect.poll(() => orangeAround(page), { timeout: 30_000 }).toBeGreaterThan(8);

  // zoomed right in, in the middle of the corrupted land: the creation is untouched, framed, and the land around it is corrupted
  await page.goto(`/?preview=0&x=${SPOT.x + 10}&y=${SPOT.y + 10}&z=14`);
  await ready(page);
  const scan = (inside: boolean) => page.getByRole("application").evaluate((c: HTMLCanvasElement, inside) => {
    const k = c.width / c.clientWidth, cx = c.width / 2, cy = c.height / 2, half = 10 * 14 * k; // the parcel is 20 px × 14 = 280 css px wide
    const [x0, y0, w, h] = inside ? [cx - half + 8, cy - half + 8, 2 * half - 16, 2 * half - 16] : [Math.max(0, cx - half - 150 * k), cy - 60 * k, 100 * k, 120 * k];
    const d = c.getContext("2d")!.getImageData(Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)).data;
    const colours = new Map<string, number>();
    let lavender = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const key = `${d[i]},${d[i + 1]},${d[i + 2]}`; colours.set(key, (colours.get(key) ?? 0) + 1); n++; if (d[i + 2]! > d[i]! + 5 && d[i + 2]! > d[i + 1]!) lavender++; }
    return { colours: [...colours.keys()], lavender: lavender / n };
  }, inside);
  await expect.poll(async () => (await scan(true)).colours, { timeout: 30_000 }).toEqual([BLUE.join(",")]);
  expect((await scan(false)).lavender, "the land around the parcel is corrupted").toBeGreaterThan(0.8);
  const ring = await page.getByRole("application").evaluate((c: HTMLCanvasElement, o) => { // the orange frame, just outside the parcel
    const k = c.width / c.clientWidth, cx = c.width / 2, cy = c.height / 2, half = 10 * 14 * k;
    const d = c.getContext("2d")!.getImageData(Math.round(cx - half - 4 * k), Math.round(cy), Math.round(4 * k), 1).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] === o[0] && d[i + 1] === o[1] && d[i + 2] === o[2]) return true;
    return false;
  }, ORANGE);
  expect(ring, "the survivor is framed in orange").toBe(true);
  await Promise.all([api.dispose(), admin.dispose()]);
});
