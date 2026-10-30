import { expect, test } from "@playwright/test";
import sharp from "sharp";

/** The home page is a 3D globe; zooming in turns it into the flat map, zooming out of the flat map brings it back. */

type GlobeHook = { ready: boolean; handedOff: boolean; set(lon: number, lat: number, zoom: number): void };
type Win = { __pxGlobe?: GlobeHook; __pxEngine?: { cam: { x: number; y: number; scale: number } } };
type Pg = import("@playwright/test").Page;

const waitReady = (page: Pg) => page.waitForFunction(() => (window as unknown as Win).__pxGlobe?.ready === true, undefined, { timeout: 30_000 });

/** Mean colour (and spread) of a patch in the middle of the globe canvas. */
const centrePatch = async (page: Pg, size = 30) => {
  const box = (await page.getByTestId("globe").boundingBox())!;
  const png = await page.screenshot({ clip: { x: box.x + box.width / 2 - size / 2, y: box.y + box.height / 2 - size / 2, width: size, height: size } });
  const { channels } = await sharp(png).stats();
  return { r: channels[0]!.mean, g: channels[1]!.mean, b: channels[2]!.mean, spread: Math.max(...channels.slice(0, 3).map((c) => c.stdev)) };
};

test.describe("3D globe (home page)", () => {
  test("the home page is the globe: sea in the Atlantic, land over the Sahara, no dot field, a drag rotates it", async ({ page }) => {
    await page.goto("/?lon=-30&lat=30");
    await waitReady(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
    await expect.poll(async () => { const c = await centrePatch(page); return c.b - c.r; }, { timeout: 10_000 }).toBeGreaterThan(15); // blue ocean
    // plain sea: the dot matrix that used to cover the globe is gone (it would show as a spread in the colours)
    expect((await centrePatch(page, 60)).spread).toBeLessThan(5);
    await page.evaluate(() => (window as unknown as Win).__pxGlobe!.set(10, 22, 1));
    await expect.poll(async () => { const c = await centrePatch(page); return c.r - c.b; }, { timeout: 10_000 }).toBeGreaterThan(10); // cream land
    // the live counter is on the home page too
    await expect(page.getByTestId("sold-pixels")).toBeVisible();
    // dragging moves the view: the readout changes
    const before = await page.getByTestId("globe-readout").innerText();
    const box = (await page.getByTestId("globe").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.getByTestId("globe-readout").innerText()).not.toBe(before);
  });

  test("zooming in hands over to the flat map at the same place", async ({ page }) => {
    await page.goto("/?lon=2.35&lat=48.85");
    await waitReady(page);
    await page.evaluate(() => (window as unknown as Win).__pxGlobe!.set(2.35, 48.85, 3.1)); // past the hand-off zoom
    await page.waitForURL(/\/map\?x=\d+&y=\d+&z=/, { timeout: 15_000 });
    await page.waitForFunction(() => Boolean((window as unknown as Win).__pxEngine), undefined, { timeout: 20_000 });
    const cam = await page.evaluate(() => ({ ...(window as unknown as Win).__pxEngine!.cam }));
    expect(Math.abs(cam.x - 18984)).toBeLessThan(80); // Paris
    expect(Math.abs(cam.y - 11738)).toBeLessThan(80);
    expect(cam.scale).toBeGreaterThan(0.05);
  });

  test("the flat map has a button to the globe, centred on where you are", async ({ page }) => {
    await page.goto("/map?x=18984&y=11738&z=0.5");
    await page.waitForFunction(() => Boolean((window as unknown as Win).__pxEngine), undefined, { timeout: 20_000 }); // hydrated: the link is a client-side navigation
    await page.getByTestId("open-globe").click();
    await page.waitForURL(/\/\?lon=/);
    const url = new URL(page.url());
    expect(url.pathname).toBe("/");
    expect(Math.abs(Number(url.searchParams.get("lon")) - 2.35)).toBeLessThan(0.5);
    expect(Math.abs(Number(url.searchParams.get("lat")) - 48.85)).toBeLessThan(0.5);
    await waitReady(page);
  });

  test("zooming out of the flat map returns to the globe at the same place; loading and zooming in never do", async ({ page }) => {
    await page.goto("/map?x=18984&y=11738&z=0.25");
    await page.waitForFunction(() => Boolean((window as unknown as Win).__pxEngine), undefined, { timeout: 20_000 });
    const box = (await page.getByRole("application").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
    expect(new URL(page.url()).pathname).toBe("/map"); // nothing happens on its own
    await page.mouse.wheel(0, -300); // zoom in
    await page.waitForTimeout(800);
    expect(new URL(page.url()).pathname).toBe("/map");
    for (let i = 0; i < 12 && new URL(page.url()).pathname === "/map"; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(150); } // zoom out
    await page.waitForURL(/\/\?lon=/, { timeout: 15_000 });
    const url = new URL(page.url());
    expect(Math.abs(Number(url.searchParams.get("lon")) - 2.35)).toBeLessThan(2);
    expect(Math.abs(Number(url.searchParams.get("lat")) - 48.85)).toBeLessThan(2);
    const zoom = Number(url.searchParams.get("zoom"));
    expect(zoom).toBeGreaterThanOrEqual(1);
    expect(zoom).toBeLessThanOrEqual(2.2);
    await waitReady(page);
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe("/"); // no bounce back to the flat map
  });

  test("search turns the globe to the place; Find your spot opens the flat map in buy mode", async ({ page }) => {
    await page.goto("/?lon=100&lat=10");
    await waitReady(page);
    await page.getByRole("combobox").first().fill("Paris");
    await page.getByRole("listbox").getByRole("option").first().click();
    await expect.poll(async () => Number((await page.getByTestId("globe-readout").innerText()).match(/([\d.]+)°N/)?.[1]), { timeout: 10_000 }).toBeGreaterThan(40);
    await expect.poll(async () => Math.abs(Number((await page.getByTestId("globe-readout").innerText()).match(/([\d.]+)°[EW]/)?.[1])), { timeout: 10_000 }).toBeLessThan(10);
    await page.getByTestId("find-your-spot").click();
    await page.waitForURL(/\/map\?x=\d+&y=\d+&z=[\d.]+&buy=1/, { timeout: 15_000 });
    await expect(page.getByTestId("buy-panel")).toBeVisible({ timeout: 20_000 });
  });

  test("addresses from before the globe keep working: the flat map's old home and the prototype address", async ({ page }) => {
    await page.goto("/?x=18984&y=11738&z=2");
    await expect(page).toHaveURL(/\/map\?x=18984&y=11738&z=2/);
    await page.goto("/?bx=30000&by=3000&bw=20&bh=20");
    await expect(page).toHaveURL(/\/map\?bx=30000/);
    await page.goto("/globe?lon=5&lat=40");
    await expect(page).toHaveURL(/\/\?lon=5&lat=40/);
  });
});
