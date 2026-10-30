import { expect, test } from "@playwright/test";
import sharp from "sharp";

/** The 3D globe prototype: renders, turns into the flat map when you get close, and the flat map links back to it. */

type GlobeHook = { ready: boolean; handedOff: boolean; set(lon: number, lat: number, zoom: number): void };
type Win = { __pxGlobe?: GlobeHook; __pxEngine?: { cam: { x: number; y: number; scale: number } } };

const waitReady = (page: import("@playwright/test").Page) =>
  page.waitForFunction(() => (window as unknown as Win).__pxGlobe?.ready === true, undefined, { timeout: 30_000 });

/** Mean colour of the middle of the globe canvas. */
const centreColour = async (page: import("@playwright/test").Page) => {
  const box = (await page.getByTestId("globe").boundingBox())!;
  const png = await page.screenshot({ clip: { x: box.x + box.width / 2 - 15, y: box.y + box.height / 2 - 15, width: 30, height: 30 } });
  const { channels } = await sharp(png).stats();
  return { r: channels[0]!.mean, g: channels[1]!.mean, b: channels[2]!.mean };
};

test.describe("3D globe (prototype)", () => {
  test("draws the planet: sea in the Atlantic, land over the Sahara, a drag rotates it", async ({ page }) => {
    await page.goto("/globe?lon=-30&lat=30");
    await waitReady(page);
    await expect.poll(async () => { const c = await centreColour(page); return c.b - c.r; }, { timeout: 10_000 }).toBeGreaterThan(15); // blue ocean
    await page.evaluate(() => (window as unknown as Win).__pxGlobe!.set(10, 22, 1));
    await expect.poll(async () => { const c = await centreColour(page); return c.r - c.b; }, { timeout: 10_000 }).toBeGreaterThan(10); // cream land
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
    await page.goto("/globe?lon=2.35&lat=48.85");
    await waitReady(page);
    await page.evaluate(() => (window as unknown as Win).__pxGlobe!.set(2.35, 48.85, 3.1)); // past the hand-off zoom
    await page.waitForURL(/\/\?x=\d+&y=\d+&z=/, { timeout: 15_000 });
    await page.waitForFunction(() => Boolean((window as unknown as Win).__pxEngine), undefined, { timeout: 20_000 });
    const cam = await page.evaluate(() => ({ ...(window as unknown as Win).__pxEngine!.cam }));
    expect(Math.abs(cam.x - 18984)).toBeLessThan(80); // Paris
    expect(Math.abs(cam.y - 11738)).toBeLessThan(80);
    expect(cam.scale).toBeGreaterThan(0.05);
  });

  test("the flat map has a button to the globe, centred on where you are", async ({ page }) => {
    await page.goto("/?x=18984&y=11738&z=0.5");
    await page.waitForFunction(() => Boolean((window as unknown as Win).__pxEngine), undefined, { timeout: 20_000 }); // hydrated: the link is a client-side navigation
    await page.getByTestId("open-globe").click();
    await page.waitForURL(/\/globe\?lon=/);
    const url = new URL(page.url());
    expect(Math.abs(Number(url.searchParams.get("lon")) - 2.35)).toBeLessThan(0.5);
    expect(Math.abs(Number(url.searchParams.get("lat")) - 48.85)).toBeLessThan(0.5);
    await waitReady(page);
  });
});
