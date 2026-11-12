import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { lonLatToPixel } from "../../src/lib/grid/geometry";

/**
 * Water parcels: the sea is bought like the land, shown in three blues whatever the buyer sent, and cut by the coast. (Named so that it
 * runs after the journey spec, which asserts exact global counters before any sale.)
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const TINTS = ["127,200,240", "47,143,216", "27,79,156"];
/** A water parcel is drawn a little see-through (the engine's WATER_ALPHA), so that the land stands out: what is on the canvas is the blue blended with what is under it. */
const WATER_ALPHA = 0.62, OCEAN = [13, 26, 62]; // the night ocean
const blend = (rgb: number[], under: number[]) => rgb.map((v, i) => v * WATER_ALPHA + under[i]! * (1 - WATER_ALPHA));
/** Is the canvas pixel `px` ("r,g,b") the blue `rgb` seen through `WATER_ALPHA` over `under`? (a few levels of rounding allowed) */
const seenAs = (px: string, rgb: number[], under: number[]) => { const want = blend(rgb, under); return px.split(",").map(Number).every((v, i) => Math.abs(v - want[i]!) <= 3); };
const isWater = (px: string, under: number[][] = [OCEAN]) => TINTS.some((t) => under.some((u) => seenAs(px, t.split(",").map(Number), u)));

type Eng = { geoPending: boolean; geo: unknown; worldToScreen(x: number, y: number): { x: number; y: number } };
const ready = (page: Page) => page.waitForFunction(() => { const e = (window as unknown as { __pxEngine?: Eng }).__pxEngine; return Boolean(e && e.geo && !e.geoPending); }, undefined, { timeout: 60_000 });

const SEA = (() => { const c = lonLatToPixel({ lon: -25, lat: 34 }); return { x: Math.round(c.x) - 10, y: Math.round(c.y) - 10, w: 20, h: 20 }; })(); // open Atlantic

async function buy(api: APIRequestContext, admin: APIRequestContext, rect: { x: number; y: number; w: number; h: number }, kind: "land" | "water", title: string, colour: string) {
  const image = await sharp({ create: { width: rect.w, height: rect.h, channels: 3, background: colour } }).png().toBuffer();
  const r = await api.post("/api/checkout", { multipart: { x: String(rect.x), y: String(rect.y), w: String(rect.w), h: String(rect.h), kind, description: "A short description", title, image: { name: "c.png", mimeType: "image/png", buffer: image } } });
  expect(r.status(), await r.text()).toBe(200);
  const { orderId } = await r.json();
  expect((await (await api.post("/api/dev/pay", { data: { orderId, outcome: "paid" } })).json()).outcome).toBe("processed");
  const db = new pg.Client({ connectionString: (process.env.TEST_PG_ADMIN_URL ?? "postgres://pixel:pixel@127.0.0.1:54329/postgres").replace(/\/[^/]*$/, "/pixelworld_e2e") });
  await db.connect();
  const { rows } = await db.query(`select a.id, p.kind from public.parcel_assets a join public.parcels p on p.id = a.parcel_id where p.x = $1 and p.y = $2 and a.status = 'pending'`, [rect.x, rect.y]);
  await db.end();
  expect(rows[0]!.kind).toBe(kind);
  expect((await admin.post("/api/admin/action", { data: { action: "review_asset", assetId: rows[0]!.id, decision: "approve" } })).status()).toBe(200);
  return rows[0]!.id as string;
}

const pixelAt = (page: Page, x: number, y: number) => page.getByRole("application").evaluate((c: HTMLCanvasElement, [x, y]) => {
  const e = (window as unknown as { __pxEngine: Eng }).__pxEngine, a = e.worldToScreen(x!, y!), k = c.width / c.clientWidth;
  const d = c.getContext("2d")!.getImageData(Math.round(a.x * k), Math.round(a.y * k), 1, 1).data;
  return `${d[0]},${d[1]},${d[2]}`;
}, [x, y]);

test("water is bought like land: priced for its water, refused on land, shown in three blues", async ({ page }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.240" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.241" } });
  const anon = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.242" } });
  expect((await api.post("/api/dev/login", { data: { email: "sailor@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.sailor@example.test", role: "admin" } })).ok()).toBeTruthy();

  // the open sea is not for land; it is for water, at the land price by default
  const q = (kind: string, r = SEA) => api.get(`/api/availability?x=${r.x}&y=${r.y}&w=${r.w}&h=${r.h}&kind=${kind}`).then((x) => x.json());
  expect(await q("land")).toMatchObject({ kind: "land", enough: false, free: false });
  expect(await q("water")).toMatchObject({ kind: "water", enough: true, free: true, landPixels: 0, price: { ownedPixels: 400, cutPixels: 0, totalCents: 400 * 25 } });
  expect((await api.get(`/api/availability?x=${SEA.x}&y=${SEA.y}&w=20&h=20&kind=lava`)).status()).toBe(400);
  // and the wrong kind is refused when buying
  const red = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const wrong = await api.post("/api/checkout", { multipart: { x: String(SEA.x), y: String(SEA.y), w: "20", h: "20", kind: "land", description: "A short description", title: "Nope", image: { name: "c.png", mimeType: "image/png", buffer: red } } });
  expect([wrong.status(), (await wrong.json()).error]).toEqual([422, "px_not_on_land"]);

  const assetId = await buy(api, admin, SEA, "water", "Sailor", "#ff0000");

  // what the public gets is blue; the owner can still get what was sent
  const pub = await sharp(await (await anon.get(`/api/assets/${assetId}`)).body()).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set<string>();
  for (let i = 0; i < pub.data.length; i += pub.info.channels) colours.add(`${pub.data[i]},${pub.data[i + 1]},${pub.data[i + 2]}`);
  expect([...colours], "the public sees a water creation in the blues of the palette only").toEqual(["27,79,156"]); // red is dark: deep blue
  const raw = await sharp(await (await api.get(`/api/assets/${assetId}?raw=1`)).body()).raw().toBuffer();
  expect([raw[0], raw[1], raw[2]], "the owner gets the original").toEqual([255, 0, 0]);
  const rawByAnon = await sharp(await (await anon.get(`/api/assets/${assetId}?raw=1`)).body()).raw().toBuffer();
  expect([rawByAnon[0], rawByAnon[1], rawByAnon[2]], "a stranger asking for the original gets the blue one").toEqual([27, 79, 156]);

  // the map: the water parcel is blue, and the same rectangle is no longer free for water — but it is still free for… nothing on the sea (no land there)
  expect(await q("water")).toMatchObject({ free: false });
  const mid = { x: SEA.x + 10, y: SEA.y + 10 };
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/?x=${mid.x}&y=${mid.y}&z=14`);
  await ready(page);
  await expect.poll(async () => seenAs(await pixelAt(page, mid.x, mid.y), [27, 79, 156], OCEAN), { timeout: 30_000 }).toBe(true);
  expect(isWater(await pixelAt(page, mid.x, mid.y)), "one of the three blues, seen through the sea").toBe(true);
  expect(await pixelAt(page, mid.x, mid.y), "see-through: it is not the raw blue").not.toBe("27,79,156");
  const ocean = await pixelAt(page, SEA.x - 20, mid.y);
  expect(ocean, "the free sea around it is the ocean colour: a deep night BLUE").toBe("13,26,62");

  // the server says where the water parcels are, and the world view asks for the water layer only there
  const cells = (await (await anon.get("/api/map/water")).json()) as { cell: number; c: number[] };
  expect(cells.cell).toBe(512);
  expect(cells.c).toEqual(expect.arrayContaining([Math.floor(mid.x / 512), Math.floor(mid.y / 512)]));
  const asked: string[] = [];
  page.on("request", (r) => { if (/\/api\/map\/raster\/.*[?&]k=w/.test(r.url())) asked.push(r.url()); });
  await page.goto("/map");
  await ready(page);
  await expect.poll(() => asked.length, { timeout: 30_000 }).toBeGreaterThan(0); // the water parcel is on the world view
  await page.waitForTimeout(1500);
  expect(asked.length, "only the few tiles that can hold the water parcel").toBeLessThanOrEqual(6);
  await page.goto(`/?x=${mid.x}&y=${mid.y}&z=14`);
  await ready(page);

  await Promise.all([api.dispose(), admin.dispose(), anon.dispose()]);
});

test("a water parcel on a coast: the land inside is cut away, free, and still for sale as land", async ({ page }) => {
  const api = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.243" } });
  const admin = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { "x-forwarded-for": "203.0.113.244" } });
  expect((await api.post("/api/dev/login", { data: { email: "coast@example.test" } })).ok()).toBeTruthy();
  expect((await admin.post("/api/dev/login", { data: { email: "admin.coast@example.test", role: "admin" } })).ok()).toBeTruthy();
  // slide a 20×20 rectangle east along 38.7°N from the Atlantic until the coast of Portugal covers a quarter of it
  const start = lonLatToPixel({ lon: -11, lat: 38.7 });
  let coast: { x: number; y: number; w: number; h: number; landPixels: number } | null = null;
  for (let dx = 0; dx < 400 && !coast; dx += 2) {
    const r = { x: Math.round(start.x) + dx, y: Math.round(start.y), w: 20, h: 20 };
    const j = await api.get(`/api/availability?x=${r.x}&y=${r.y}&w=20&h=20&kind=water`).then((x) => x.json());
    if (j.landPixels >= 80 && j.landPixels <= 160) coast = { ...r, landPixels: j.landPixels };
  }
  expect(coast, "a rectangle on the coast of Portugal").not.toBeNull();
  const c = coast!;
  const water = await api.get(`/api/availability?x=${c.x}&y=${c.y}&w=20&h=20&kind=water`).then((x) => x.json());
  expect(water).toMatchObject({ enough: true, price: { ownedPixels: 400 - c.landPixels, cutPixels: c.landPixels, totalCents: (400 - c.landPixels) * 25 } });
  await buy(api, admin, c, "water", "Coast", "#ff0000");
  // the land part is still the land's: free for a land parcel when there is enough of it (here a quarter: not enough), and the map shows land there
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/?x=${c.x + 10}&y=${c.y + 10}&z=14`);
  await ready(page);
  await expect.poll(async () => { // somewhere in the rectangle there is blue, and somewhere there is the violet of the land
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(await pixelAt(page, c.x + i + 0.5, c.y + 10.5));
    return [[...seen].some((px) => seenAs(px, [27, 79, 156], OCEAN)), seen.has("56,32,80")];
  }, { timeout: 30_000 }).toEqual([true, true]);
  // who owns the pixel under a point: the water parcel on its water, nobody on the land that was cut away from it (the land stays free)
  const owners = await page.evaluate(([x0, y]) => {
    const e = (window as unknown as { __pxEngine: { landAt(x: number, y: number): boolean | null; parcelAt(x: number, y: number): { water: boolean } | null } }).__pxEngine;
    const out: [boolean | null, boolean | null][] = [];
    for (let i = 0; i < 20; i++) { const x = x0! + i + 0.5, p = e.parcelAt(x, y! + 0.5); out.push([e.landAt(x, y! + 0.5), p ? p.water : null]); }
    return out;
  }, [c.x, c.y + 10]);
  expect(owners.some(([land]) => land === true) && owners.some(([land]) => land === false), "the row crosses the coast").toBe(true);
  for (const [land, owner] of owners) expect(owner, land ? "land: no water parcel there" : "water: the water parcel").toBe(land ? null : true);
  await Promise.all([api.dispose(), admin.dispose()]);
});

test("the buy panel offers Land and Water: the same spot at sea is refused as land and free as water, at the water price", async ({ page }) => {
  const sea = { x: SEA.x + 400, y: SEA.y + 200, w: 20, h: 20 }; // another bit of the open Atlantic
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.goto(`/map?bx=${sea.x}&by=${sea.y}&bw=${sea.w}&bh=${sea.h}`);
  await expect(page.getByTestId("buy-panel")).toBeVisible();
  await expect(page.getByTestId("buy-kind-land")).toHaveAttribute("aria-pressed", "true"); // land is the default
  await expect(page.getByTestId("buy-status")).toContainText(/on land/i); // "at least 50 % of your parcel must be on land"
  await expect(page.getByTestId("buy-continue")).toBeDisabled();
  await page.getByTestId("buy-kind-water").click();
  await expect(page.getByTestId("buy-kind-water")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("buy-status")).toContainText(/free/i);
  await expect(page.getByTestId("buy-price")).toHaveText("€100"); // 400 water pixels at the land price (default)
  await page.getByTestId("buy-kind-land").click();
  await expect(page.getByTestId("buy-status")).toContainText(/on land/i); // back: the sea is not land
  // a purchase resumed after signing in keeps its kind (?bk=water), and the editor says what the sea does to a creation
  await page.request.post("/api/dev/login", { data: { email: "navigator@example.test" } });
  await page.goto(`/map?bx=${sea.x}&by=${sea.y}&bw=${sea.w}&bh=${sea.h}&bk=water`);
  await expect(page.getByTestId("buy-kind-water")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("buy-status")).toContainText(/free/i);
  await page.getByTestId("buy-continue").click();
  await expect(page.getByTestId("co-water-note")).toContainText(/blue/i);
});
