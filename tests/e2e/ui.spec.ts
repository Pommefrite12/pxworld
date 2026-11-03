import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

/** Interface-level checks: accessibility, keyboard, search, touch/mobile. Independent of the other specs' data. */

declare global {
  interface Window { __pxEngine?: { cam: { x: number; y: number; scale: number }; fitScale: number; geoPending: boolean } }
}

const camera = async (page: import("@playwright/test").Page) => {
  await page.waitForFunction(() => Boolean(window.__pxEngine), undefined, { timeout: 20_000 }); // the engine exists once the canvas is mounted
  return page.evaluate(() => ({ ...window.__pxEngine!.cam }));
};

test.describe("accessibility (axe, WCAG 2.1 A/AA)", () => {
  for (const path of ["/", "/fr", "/map", "/discover", "/rules", "/terms", "/auth/sign-in", "/auth/sign-up"]) {
    test(`no serious violation on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
});

test.describe("map interaction", () => {
  test("geography is fully drawn at every zoom (no missing tiles) and a frame is cheap", async ({ page }) => {
    for (const [x, y, z] of [[19000, 11700, 2.5], [18984, 11738, 12], [10000, 8000, 0.4], [18000, 12000, 40], [18844, 11643, 5], [18984, 11738, 0.7], [10500, 12957, 1.5], [15322, 300, 3], [39000, 8272, 6]] as const) {
      await page.goto(`/map?x=${x}&y=${y}&z=${z}`);
      await page.waitForFunction(() => window.__pxEngine && (window.__pxEngine as unknown as { geo: unknown }).geo && !window.__pxEngine.geoPending, undefined, { timeout: 20_000 });
      const ms = await page.evaluate(async () => {
        const e = window.__pxEngine as unknown as { cam: { x: number; scale: number }; invalidate(): void; draw(): void };
        const t0 = performance.now();
        for (let i = 0; i < 20; i++) { e.cam.x += 2 / e.cam.scale; e.draw(); }
        return (performance.now() - t0) / 20;
      });
      expect(ms, `avg draw ms at scale ${z}`).toBeLessThan(40); // generous: CI runners use software rendering
    }
  });

  test("zooming in reveals more detail: départements, cities of 15 000+, then towns of 1 000+", async ({ page }) => {
    type View = { x0: number; y0: number; x1: number; y1: number };
    type GeoApi = { adminLabels(): { en: string; dep: boolean }[] | null; townsIn(tier: 1 | 2, v: View): { name: string }[] };
    await page.goto("/map?x=18984&y=11738&z=2");
    await page.waitForFunction(() => window.__pxEngine && (window.__pxEngine as unknown as { geo: unknown }).geo && !window.__pxEngine.geoPending, undefined, { timeout: 20_000 });
    const names = (tier: 1 | 2, v: View) => page.evaluate(([t, view]) => ((window.__pxEngine as unknown as { geo: GeoApi }).geo.townsIn(t, view)).map((x) => x.name), [tier, v] as const);
    // départements (admin-1 names, loaded on demand)
    await expect.poll(() => page.evaluate(() => (window.__pxEngine as unknown as { geo: GeoApi }).geo.adminLabels()?.some((l) => l.en === "Seine-Maritime" && l.dep) ?? false), { timeout: 15_000 }).toBe(true);
    // cities of 15 000+ around Paris (cells fetched when asked for, then served from memory)
    await expect.poll(async () => (await names(1, { x0: 18400, y0: 11400, x1: 19300, y1: 12000 })).includes("Rouen"), { timeout: 15_000 }).toBe(true);
    // towns of 1 000+: dozens in a 100×100 px window around Paris, none of which belongs to the coarser tier
    await expect.poll(async () => (await names(2, { x0: 18920, y0: 11680, x1: 19040, y1: 11800 })).length, { timeout: 15_000 }).toBeGreaterThan(25);
    // the 1:10m land of this region is cached: the geography tiles drawn here are complete (not the 1:50m stand-in)
    const incomplete = await page.evaluate(() => [...(window.__pxEngine as unknown as { geoTiles: Map<string, { complete: boolean }> }).geoTiles.values()].filter((t) => !t.complete).length);
    expect(incomplete).toBe(0);
  });

  test("the map wraps around: panning past the Bering Strait continues on the other side, positions stay real", async ({ page }) => {
    await page.goto("/map?x=39000&y=8300&z=1");
    await page.waitForFunction(() => Boolean(window.__pxEngine), undefined, { timeout: 20_000 });
    const r = await page.evaluate(() => {
      const e = window.__pxEngine as unknown as {
        cam: { x: number; scale: number }; flyTo(c: { x: number; y: number; scale: number }, d: number): void;
        screenToWorld(x: number, y: number): { x: number; y: number }; viewport: { w: number; h: number };
      };
      e.flyTo({ x: 39990, y: 8300, scale: 1 }, 0);
      const v = e.viewport;
      const right = e.screenToWorld(v.w / 2 + 400, v.h / 2).x; // 400 px right of the centre = 10 px past the east edge
      e.flyTo({ x: 40_300, y: 8300, scale: 1 }, 0); // beyond the edge: the camera comes back in range
      return { right, camX: e.cam.x };
    });
    expect(r.right).toBeGreaterThan(300);
    expect(r.right).toBeLessThan(420); // the real position on the west side of the map, not x > 40 000
    expect(r.camX).toBeGreaterThan(250);
    expect(r.camX).toBeLessThan(350);
  });

  test("keyboard: arrows pan, plus/minus zoom, 0 recentres", async ({ page }) => {
    await page.goto("/map?x=20000&y=8000&z=1");
    const canvas = page.getByRole("application");
    await canvas.focus();
    const before = await camera(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await camera(page)).x).toBeGreaterThan(before.x + 50);
    await page.keyboard.press("+");
    await expect.poll(async () => (await camera(page)).scale).toBeGreaterThan(before.scale * 1.3);
    await page.keyboard.press("0");
    await expect.poll(async () => (await camera(page)).scale, { timeout: 5000 }).toBeLessThan(0.05);
  });

  test("wheel zoom is anchored under the cursor and is capped at the maximum zoom", async ({ page }) => {
    await page.goto("/map");
    await page.waitForTimeout(800);
    const c = await camera(page);
    const box = (await page.getByRole("application").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.4);
    for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    const z = await camera(page);
    expect(z.scale).toBeLessThanOrEqual(48);
    expect(z.scale).toBeGreaterThan(c.scale * 20);
    expect(z.x).toBeGreaterThan(c.x); // zoomed towards the right half
    // zooming out is bounded by the whole-world view: the map stays a flat map, there is no globe to fall into
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    expect((await camera(page)).scale).toBeGreaterThanOrEqual(c.scale * 0.99);
  });

  test("the planet is 2D only: the home page is the map, zooming all the way out stays on it, and there is no globe button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("application")).toBeVisible();
    await expect(page.getByTestId("zoom-level")).toBeVisible(); // the map's own controls are on the home page
    await expect(page.getByTestId("open-globe")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /globe|globe 3D/i })).toHaveCount(0);
    await page.waitForFunction(() => Boolean((window as unknown as { __pxEngine?: unknown }).__pxEngine));
    const url0 = page.url();
    // zoom out as far as possible, by wheel and by the button: still the same page, same map
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 400);
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe(new URL(url0).pathname);
    await expect(page.getByRole("application")).toBeVisible();
    expect((await camera(page)).scale).toBeGreaterThan(0);
    // old addresses: the globe route and the home page with a camera land on the map
    await page.goto("/globe?lon=2&lat=48&zoom=2");
    await expect(page).toHaveURL(/localhost:\d+\/?$/);
    await expect(page.getByRole("application")).toBeVisible();
    await page.goto("/fr/globe");
    await expect(page).toHaveURL(/\/fr\/?$/);
    await page.goto("/?x=19000&y=11700&z=6");
    expect((await camera(page)).scale).toBeCloseTo(6, 0);
  });

  test("drag pans the map", async ({ page }) => {
    await page.goto("/map?x=25000&y=10000&z=2");
    await page.waitForTimeout(500);
    const before = await camera(page);
    const box = (await page.getByRole("application").boundingBox())!;
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 300, { steps: 8 });
    await page.mouse.up();
    const after = await camera(page);
    expect(after.x).toBeGreaterThan(before.x + 50); // content followed the pointer to the left → camera moved right
    expect(Math.abs(after.y - before.y)).toBeLessThan(5);
  });

  test("geographic search flies to a country and a city, and understands coordinates", async ({ page }) => {
    await page.goto("/map");
    const search = page.getByRole("combobox").first();
    await search.fill("Paris");
    await page.getByRole("listbox").getByRole("option").first().click();
    await expect.poll(async () => (await camera(page)).scale, { timeout: 8000 }).toBeGreaterThan(1);
    const c = await camera(page);
    expect(Math.abs(c.x - 18984)).toBeLessThan(40); // 2.35°E
    expect(Math.abs(c.y - 11738)).toBeLessThan(40); // 48.85°N (Mercator)
    await search.fill("48.85, 2.35");
    await page.getByRole("listbox").getByRole("option").first().click();
    await expect.poll(async () => Math.round((await camera(page)).scale)).toBe(6);
    await page.goto("/fr");
    await page.getByRole("combobox").first().fill("Japon");
    await expect(page.getByRole("listbox").getByRole("option").first()).toContainText("Japon"); // country names follow the interface language
  });

  test("buy mode: clicking the map places a parcel, collisions and bounds are reported", async ({ page }) => {
    await page.goto("/map?x=26000&y=11000&z=0.6"); // Kazakhstan: dry land all around
    // the button works once the page is interactive: a click before hydration does nothing
    await page.waitForFunction(() => Boolean((window as unknown as { __pxEngine?: unknown }).__pxEngine));
    await page.getByTestId("find-your-spot").click();
    await expect(page.getByTestId("buy-panel")).toBeVisible();
    await page.waitForTimeout(1800); // let the camera finish its flight before clicking the map
    const box = (await page.getByRole("application").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i, { timeout: 10_000 });
    // a size below the minimum is refused with an explanation, no parcel can be bought
    await page.getByLabel("Width (px)").fill("4");
    await page.getByLabel("Height (px)").fill("6");
    await expect(page.getByTestId("buy-status")).toContainText(/minimum surface is 25/i); // 24 pixels
    await expect(page.getByTestId("buy-continue")).toBeDisabled();
    // the smallest parcel: 5 × 5 pixels = 25, €12.50
    await page.getByLabel("Width (px)").fill("5");
    await page.getByLabel("Height (px)").fill("5");
    await expect(page.getByTestId("buy-price")).toHaveText("€12.50");
    await expect(page.getByTestId("buy-continue")).toBeEnabled();
    // the price follows the size immediately
    await page.getByLabel("Width (px)").fill("30");
    await page.getByLabel("Height (px)").fill("40");
    await expect(page.getByTestId("buy-price")).toHaveText("€600"); // 1 200 pixels at €0.50
    await expect(page.getByTestId("buy-area")).toContainText("1,200");
  });
});

test.describe("language switch", () => {
  test("the language menu is in the site's own look, opens from a click or the keyboard, and choosing a language changes the page and keeps the place", async ({ page }) => {
    await page.goto("/discover");
    const button = page.getByTestId("locale-switch");
    await expect(button).toContainText("EN");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("header select"), "no native list: the menu is the site's own").toHaveCount(0);
    // a click opens a card with both languages, the current one marked
    await button.click();
    const menu = page.getByRole("menu", { name: "Language" });
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("locale-option-en")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("locale-option-fr")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("locale-option-fr")).toHaveText(/Français/);
    expect(await menu.evaluate((e) => getComputedStyle(e).backgroundColor), "a white card like the account menu").toBe("rgb(255, 255, 255)");
    // Escape closes it and gives the focus back; so does a click elsewhere
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await page.mouse.click(5, 400);
    await expect(menu).toBeHidden();
    // from the keyboard: the arrow opens it, the arrows move, Enter chooses
    await button.focus();
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("locale-option-en")).toBeFocused(); // the focus starts on the current language
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("locale-option-fr")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/fr\/discover/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Découvrir");
    await expect(page.getByTestId("locale-switch")).toContainText("FR");
    await expect(page.getByRole("menu")).toHaveCount(0); // it closed by itself
    // and with the mouse, back to English
    await page.getByTestId("locale-switch").click();
    await page.getByTestId("locale-option-en").click();
    await expect(page).toHaveURL(/\/discover$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Discover");
  });
});

test.describe("editor", () => {
  test("preview on the map shows the creation pixel-exact inside the selection, and returning keeps the work", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    expect((await ctx.request.post("/api/dev/login", { data: { email: "preview@example.test" } })).ok()).toBeTruthy();
    const page = await ctx.newPage();
    await page.goto("/map?bx=26000&by=11000&bw=20&bh=20");
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();
    const dialog = page.getByRole("dialog");
    const canvas = dialog.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    // the canvas has ten dots per pixel of the parcel (a tenth of a pixel), scaled up for editing
    expect(await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([200, 200]);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await dialog.getByRole("button", { name: "Preview on the map" }).click();
    await expect(page.getByText("Previewing on the map")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((window.__pxEngine as unknown as { previewImage: unknown }).previewImage))).toBe(true);
    await page.getByRole("button", { name: "Back to the editor" }).click();
    await expect(dialog.getByTestId("to-review")).toBeEnabled(); // the drawing survived the round trip
    // the exported image has the parcel's dimensions × 10 (the parcel itself stays 20 × 20 pixels)
    await dialog.getByTestId("to-review").click();
    const img = dialog.getByRole("img", { name: "Final render, pixel for pixel" });
    await expect(img).toBeVisible();
    expect(await img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([200, 200]);
    await ctx.close();
  });

  test("the finest brush paints a tenth of a pixel, a bigger one paints what it says, and the view can be zoomed to reach them", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    await ctx.request.post("/api/dev/login", { data: { email: "fine@example.test" } });
    const page = await ctx.newPage();
    await page.goto("/map?bx=26300&by=11000&bw=20&bh=20");
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();
    const dialog = page.getByRole("dialog");
    const canvas = dialog.locator("canvas").first();
    const dots = () => canvas.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) n++;
      return n;
    });
    expect(await dots()).toBe(0);
    // zoom in/out changes the size of the view, not the drawing
    const zoomText = dialog.getByTestId("editor-zoom");
    const z0 = Number((await zoomText.innerText()).replace("×", ""));
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    expect(Number((await zoomText.innerText()).replace("×", ""))).toBeGreaterThan(z0);
    expect(await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([200, 200]);
    // 0.1 px = exactly one dot
    await dialog.locator("#ed-brush").selectOption("0.1");
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    expect(await dots()).toBe(1);
    // 0.5 px = 5 × 5 dots, 1 px = 10 × 10 dots (away from the first dot and from each other)
    await dialog.locator("#ed-brush").selectOption("0.5");
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
    expect(await dots()).toBe(1 + 25);
    await dialog.locator("#ed-brush").selectOption("1");
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
    expect(await dots()).toBe(1 + 25 + 100);
    await ctx.close();
  });

  test("zoom 1× shows the WHOLE parcel in the editor, whatever its size; zooming in magnifies from there", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    await ctx.request.post("/api/dev/login", { data: { email: "wholeparcel@example.test" } });
    const page = await ctx.newPage();
    // a tiny parcel (50 dots), a big one (2 000 × 2 000 dots) and the widest one (4 000 × 1 000 dots)
    for (const [bx, by, bw, bh, dots] of [[27_000, 9_000, 5, 5, [50, 50]], [27_000, 9_000, 200, 200, [2000, 2000]], [28_000, 9_000, 1000, 250, [4000, 1000]]] as const) {
      await page.goto(`/map?bx=${bx}&by=${by}&bw=${bw}&bh=${bh}`);
      await expect(page.getByTestId("buy-status")).toContainText(/free/i, { timeout: 20_000 });
      await page.getByTestId("buy-continue").click();
      const dialog = page.getByRole("dialog");
      const canvas = dialog.locator("canvas").first();
      const holder = dialog.getByTestId("editor-holder");
      expect(await canvas.evaluate((c: HTMLCanvasElement) => [c.width, c.height]), `${bw}x${bh} dots`).toEqual(dots);
      await expect(dialog.getByTestId("editor-zoom")).toHaveText("1×");
      const view = async () => holder.evaluate((h: HTMLElement) => {
        const c = h.querySelector("canvas")!.getBoundingClientRect(), r = h.getBoundingClientRect();
        return { cw: c.width, ch: c.height, hw: r.width, hh: r.height, scrollsX: h.scrollWidth > h.clientWidth + 1, scrollsY: h.scrollHeight > h.clientHeight + 1, inside: c.left >= r.left - 1 && c.right <= r.right + 1 && c.top >= r.top - 1 && c.bottom <= r.bottom + 1 };
      });
      const one = await view();
      expect(one.scrollsX || one.scrollsY, `${bw}x${bh}: nothing to scroll at 1×`).toBe(false);
      expect(one.inside, `${bw}x${bh}: all of it is inside the view`).toBe(true);
      expect(one.cw / one.ch, `${bw}x${bh}: same shape as the parcel`).toBeCloseTo(bw / bh, 1);
      expect(Math.max(one.cw, one.ch), `${bw}x${bh}: as big as the space allows`).toBeGreaterThan(400);
      // zooming in magnifies (and then there is something to scroll), zooming back out shows it all again
      await dialog.getByRole("button", { name: "Zoom in" }).click();
      await dialog.getByRole("button", { name: "Zoom in" }).click();
      const zoomed = await view();
      expect(zoomed.cw).toBeGreaterThan(one.cw * 1.9);
      expect(zoomed.scrollsX || zoomed.scrollsY).toBe(true);
      await dialog.getByRole("button", { name: "Zoom out" }).click();
      await dialog.getByRole("button", { name: "Zoom out" }).click();
      expect(Math.round((await view()).cw)).toBe(Math.round(one.cw));
      await dialog.getByRole("button", { name: "Close" }).click();
    }
    await ctx.close();
  });

  test("an uploaded photo is cropped to the parcel; unsupported files are refused client-side", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    await ctx.request.post("/api/dev/login", { data: { email: "uploader@example.test" } });
    const page = await ctx.newPage();
    await page.goto("/map?bx=26100&by=11000&bw=30&bh=30");
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();
    const dialog = page.getByRole("dialog");
    const photo = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#12b886" } }).png().toBuffer();
    await dialog.locator('input[type="file"]').setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: photo });
    await expect(dialog.getByTestId("to-review")).toBeEnabled();
    await expect(dialog.getByRole("radiogroup", { name: "Fit" }).getByRole("radio", { name: "Fill" })).toBeVisible();
    // the editing canvas keeps the parcel's resolution × 10 whatever the photo size
    expect(await dialog.locator("canvas").first().evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([300, 300]);
    // the pixels of the composed result come from the photo (cover fit → fully green)
    const centre = await dialog.locator("canvas").first().evaluate((c: HTMLCanvasElement) => Array.from(c.getContext("2d")!.getImageData(150, 150, 1, 1).data));
    expect(centre).toEqual([18, 184, 134, 255]);
    // a disguised SVG is refused before any upload happens
    await dialog.locator('input[type="file"]').setInputFiles({ name: "evil.png", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
    await expect(dialog.getByRole("alert")).toContainText(/PNG, JPEG and WebP/);
    await ctx.close();
  });
});

test.describe("coastal parcels: land is paid, sea is offered, a parcel is never mostly sea", () => {
  const SEA = { x: 15389, y: 14350, w: 20, h: 20 }; // mid-Atlantic: no land at all
  const COAST_LOW = { x: 18167, y: 11839, w: 60, h: 60 }; // Pointe du Raz: 8.8 % land
  const COAST_OK = { x: 18207, y: 11839, w: 60, h: 60 }; // same coast, a bit inland: 2 114 land pixels of 3 600 (58.7 %)
  const LAND = { x: 26000, y: 11000, w: 20, h: 20 }; // Kazakhstan
  const url = (r: { x: number; y: number; w: number; h: number }) => `/map?bx=${r.x}&by=${r.y}&bw=${r.w}&bh=${r.h}`;

  test("the buy panel refuses open sea and a mostly-sea parcel, prices a coastal one by its land, and a land one in full", async ({ page }) => {
    for (const r of [SEA, COAST_LOW]) {
      await page.goto(url(r));
      await expect(page.getByTestId("buy-status")).toContainText(/at least 50% of your parcel must be on land/i, { timeout: 15_000 });
      await expect(page.getByTestId("buy-continue")).toBeDisabled();
    }
    await page.goto(url(COAST_OK));
    await expect(page.getByTestId("buy-status")).toContainText(/free/i, { timeout: 15_000 });
    await expect(page.getByTestId("buy-sea-note")).toContainText(/1,486 px of your parcel are sea, offered.*2,114 px of land/i);
    await expect(page.getByTestId("buy-price")).toHaveText("€1,057"); // the land only: 2 114 pixels at €0.50
    await expect(page.getByTestId("buy-area")).toContainText("3,600"); // the whole rectangle is theirs
    await expect(page.getByTestId("buy-continue")).toBeEnabled();
    await page.goto(url(LAND));
    await expect(page.getByTestId("buy-status")).toContainText(/free/i, { timeout: 15_000 });
    await expect(page.getByTestId("buy-sea-note")).toHaveCount(0);
    await expect(page.getByTestId("buy-price")).toHaveText("€200");
  });

  test("the server decides on its own: it refuses sea and mostly-sea parcels, and prices a coastal order by its land", async ({ browser }) => {
    const ctx = await browser.newContext();
    expect((await ctx.request.post("/api/dev/login", { data: { email: "coast@example.test" } })).ok()).toBeTruthy();
    const png = await sharp({ create: { width: 60, height: 60, channels: 3, background: "#12b886" } }).png().toBuffer();
    const post = (r: { x: number; y: number; w: number; h: number }) => ctx.request.post("/api/checkout", { multipart: { x: String(r.x), y: String(r.y), w: String(r.w), h: String(r.h), title: "Coast test", image: { name: "c.png", mimeType: "image/png", buffer: png } } });
    for (const r of [SEA, COAST_LOW]) {
      const res = await post(r);
      expect(res.status()).toBe(422);
      expect((await res.json()).error).toBe("px_not_on_land");
    }
    // the availability probe agrees and quotes the same price
    const probe = async (r: { x: number; y: number; w: number; h: number }) => (await ctx.request.get(`/api/availability?x=${r.x}&y=${r.y}&w=${r.w}&h=${r.h}`)).json();
    expect(await probe(SEA)).toMatchObject({ free: false, onLand: false, landPixels: 0 });
    expect(await probe(COAST_OK)).toMatchObject({ free: true, onLand: true, landPixels: 2114, price: { landPixels: 2114, seaPixels: 1486, totalCents: 105_700 } });
    expect(await probe(LAND)).toMatchObject({ free: true, onLand: true, landPixels: 400 });
    // an order for the coastal parcel is created at the land price (the mock checkout page shows the server's amount)
    const ok = await post(COAST_OK);
    expect(ok.ok()).toBeTruthy();
    const { url: checkoutUrl } = await ok.json();
    expect((await (await ctx.request.get(checkoutUrl)).text()).replace(/<!--.*?-->/g, "")).toContain("1057.00 EUR");
    await ctx.close();
  });
});
