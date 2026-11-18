import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

/**
 * The drawing tool: a grid the size of the brush, and a project that can be saved to be taken up again later (24 hours, kept in the visitor's own
 * browser: nothing goes to the server).
 */
const W = 20; // parcels of 20 × 20 pixels: the canvas has 10 dots per pixel, 200 × 200 dots
const DOTS = 200;

async function openEditor(browser: Browser, email: string, bx: number, by: number) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  expect((await ctx.request.post("/api/dev/login", { data: { email } })).ok()).toBeTruthy();
  const page = await ctx.newPage();
  const open = async () => {
    await page.goto(`/map?bx=${bx}&by=${by}&bw=${W}&bh=${W}`);
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();
    const dialog = page.getByRole("dialog");
    const canvas = dialog.locator("canvas").first();
    await expect(canvas).toBeVisible();
    return { dialog, canvas };
  };
  return { ctx, page, open, ...(await open()) };
}

/** The screen size of one dot of the canvas, and a click on the dot (x, y). */
const dotPx = async (canvas: Locator) => (await canvas.boundingBox())!.width / DOTS;
async function clickDot(page: Page, canvas: Locator, x: number, y: number) {
  const box = (await canvas.boundingBox())!, d = box.width / DOTS;
  await page.mouse.click(box.x + (x + 0.5) * d, box.y + (y + 0.5) * d);
}
const colourAt = (canvas: Locator, x: number, y: number) => canvas.evaluate((c: HTMLCanvasElement, [px, py]) => Array.from(c.getContext("2d")!.getImageData(px, py, 1, 1).data.slice(0, 3)), [x, y] as const);
const isPainted = async (canvas: Locator, x: number, y: number) => { const [r, g, b] = await colourAt(canvas, x, y); return !(r === 255 && g === 255 && b === 255); };
const expectPainted = (canvas: Locator, x: number, y: number, painted: boolean, why: string) => expect.poll(() => isPainted(canvas, x, y), { message: why }).toBe(painted);

/** Makes the saved project(s) of this browser `hours` older (what time does to it, without waiting for it). */
const age = (page: Page, hours: number) => page.evaluate(async (ms) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("px-drafts", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const tx = db.transaction("drafts", "readwrite"), store = tx.objectStore("drafts");
  const keys = await new Promise<IDBValidKey[]>((resolve) => { const q = store.getAllKeys(); q.onsuccess = () => resolve(q.result); });
  for (const k of keys) {
    const d = await new Promise<{ savedAt: number }>((resolve) => { const q = store.get(k); q.onsuccess = () => resolve(q.result); });
    d.savedAt -= ms;
    store.put(d, k);
  }
  await new Promise((resolve) => { tx.oncomplete = () => resolve(null); });
  db.close();
}, hours * 3_600_000);
const savedCount = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("px-drafts", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const n = await new Promise<number>((resolve) => { const q = db.transaction("drafts").objectStore("drafts").count(); q.onsuccess = () => resolve(q.result); });
  db.close();
  return n;
});

test.describe("the grid", () => {
  test("squares the size of the brush, hidden when they are too small to see, and the brush paints whole squares while it is on", async ({ browser }) => {
    const { ctx, page, dialog, canvas } = await openEditor(browser, "grid-tool@example.test", 26800, 11000);
    const grid = dialog.getByTestId("editor-grid"), toggle = dialog.getByTestId("editor-grid-toggle"), hint = dialog.getByTestId("editor-grid-hint");
    const d = await dotPx(canvas);
    await expect(grid, "off by default").toHaveCount(0);
    await expect(toggle).not.toBeChecked();

    // on: the squares are as big as the brush (1 px = 10 dots)
    await toggle.check();
    await expect(grid).toBeVisible();
    const cell = async () => parseFloat(await grid.evaluate((e) => getComputedStyle(e).backgroundSize));
    expect(await cell()).toBeCloseTo(10 * d, 0);
    await expect(hint).toContainText("Squares the size of the brush (1 px)");
    // the grid does not catch the pointer: it is only drawn over the canvas
    expect(await grid.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");

    // a bigger brush, bigger squares
    await dialog.getByLabel("Brush size").selectOption({ value: "2" });
    expect(await cell()).toBeCloseTo(20 * d, 0);
    await expect(hint).toContainText("(2 px)");

    // the finest brush (a tenth of a pixel) makes squares too small for the screen: no grid, and the visitor is told why
    await dialog.getByLabel("Brush size").selectOption({ value: "0.1" });
    await expect(grid).toHaveCount(0);
    await expect(hint).toContainText("too small");
    await dialog.getByLabel("Brush size").selectOption({ value: "2" });
    await expect(grid).toBeVisible();

    // with the grid on, one click paints the whole square it falls in (squares of 20 dots, from the top left corner)
    await clickDot(page, canvas, 37, 53);
    await expectPainted(canvas, 20, 40, true, "the square's first dot");
    await expectPainted(canvas, 39, 59, true, "the square's last dot");
    await expectPainted(canvas, 19, 50, false, "nothing left of the square");
    await expectPainted(canvas, 40, 50, false, "nothing right of the square");
    await expectPainted(canvas, 30, 39, false, "nothing above the square");
    await expectPainted(canvas, 30, 60, false, "nothing below the square");

    // off: the brush is centred on the pointer again (a square of 20 dots around the dot clicked)
    await toggle.uncheck();
    await expect(grid).toHaveCount(0);
    await clickDot(page, canvas, 137, 53);
    await expectPainted(canvas, 127, 53, true, "centred: starts 10 dots before the pointer");
    await expectPainted(canvas, 146, 53, true, "centred: ends 9 dots after the pointer");
    await expectPainted(canvas, 126, 53, false, "nothing before it");
    await expectPainted(canvas, 147, 53, false, "nothing after it");
    await ctx.close();
  });
});

test.describe("saving a project", () => {
  test("is kept in this browser, comes back with the drawing and the fields, belongs to one account, and is gone after 24 hours", async ({ browser }) => {
    const { ctx, page, open, dialog, canvas } = await openEditor(browser, "saver@example.test", 26900, 11000);
    await expect(dialog.getByTestId("draft-save"), "nothing to save yet").toBeDisabled();
    await expect(dialog.getByTestId("co-draft-banner")).toHaveCount(0);

    // draw, fill in the fields, save
    await clickDot(page, canvas, 50, 60);
    await expectPainted(canvas, 50, 60, true, "the drawing");
    await dialog.getByTestId("to-review").click();
    await dialog.locator("#co-title-in").fill("A title I saved");
    await dialog.locator("#co-desc").fill("A description that was written before saving");
    await expect(dialog.getByTestId("draft-save")).toHaveText("Save my project");
    await dialog.getByTestId("draft-save").click();
    await expect(dialog.getByTestId("draft-save")).toHaveText(/Project saved/);
    await expect(dialog.getByTestId("draft-status")).toContainText("Kept in this browser for 24 hours");
    expect(await savedCount(page)).toBe(1);

    // a change after the save: the button offers to save again
    await dialog.getByRole("button", { name: /Back to the editor/ }).click();
    await clickDot(page, canvas, 100, 100);
    await expect(dialog.getByTestId("draft-save")).toHaveText("Save my project");

    // later (the page is loaded again): the project is offered, and comes back as it was saved (without the change that was not saved)
    const again = await open();
    await expect(again.dialog.getByTestId("co-draft-banner")).toContainText("20×20 px");
    await expect(again.dialog.getByTestId("co-draft-banner")).toContainText("It is kept until");
    await expectPainted(again.canvas, 50, 60, false, "nothing is restored until the visitor chooses it");
    await again.dialog.getByTestId("co-draft-resume").click();
    await expect(again.dialog.getByTestId("co-draft-banner")).toHaveCount(0);
    await expectPainted(again.canvas, 50, 60, true, "the saved drawing is back");
    await expectPainted(again.canvas, 100, 100, false, "what was drawn after the save was not saved");
    await expect(again.dialog.getByTestId("to-review")).toBeEnabled();
    await again.dialog.getByTestId("to-review").click();
    await expect(again.dialog.locator("#co-title-in")).toHaveValue("A title I saved");
    await expect(again.dialog.locator("#co-desc")).toHaveValue("A description that was written before saving");
    // what came back counts as saved: closing it does not ask anything
    await again.dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // a project can be deleted from the offer
    const third = await open();
    await third.dialog.getByTestId("co-draft-discard").click();
    await expect(third.dialog.getByTestId("co-draft-banner")).toHaveCount(0);
    expect(await savedCount(page)).toBe(0);

    // saved again: 23 hours later it is still there, 25 hours later it is gone (and deleted from the browser)
    await clickDot(page, third.canvas, 70, 70);
    await third.dialog.getByTestId("draft-save").click();
    await expect(third.dialog.getByTestId("draft-status")).toBeVisible();
    await age(page, 23);
    const at23 = await open();
    await expect(at23.dialog.getByTestId("co-draft-banner"), "23 hours: still kept").toBeVisible();
    await age(page, 2);
    await page.reload();
    await expect.poll(() => savedCount(page), { message: "25 hours: deleted when the map opens" }).toBe(0);
    const at25 = await open();
    await expect(at25.dialog.getByTestId("co-draft-banner"), "25 hours: gone").toHaveCount(0);

    // another account on the same browser never sees it
    await clickDot(page, at25.canvas, 80, 80);
    await at25.dialog.getByTestId("draft-save").click();
    await expect(at25.dialog.getByTestId("draft-status")).toBeVisible();
    expect((await ctx.request.post("/api/dev/login", { data: { email: "someone-else@example.test" } })).ok()).toBeTruthy();
    const other = await open();
    await expect(other.dialog.getByTestId("co-draft-banner")).toHaveCount(0);
    await ctx.close();
  });

  test("closing with something not saved offers to save it; once saved, closing asks nothing; the buy panel takes the visitor back to it", async ({ browser }) => {
    const { ctx, page, open, dialog, canvas } = await openEditor(browser, "closer@example.test", 27000, 11000);
    const close = (d: Locator) => d.getByRole("button", { name: "Close", exact: true });

    // nothing drawn: it closes at once
    await close(dialog).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("buy-saved")).toHaveCount(0);

    // something drawn, not saved: the visitor is asked; "keep drawing" goes back to the editor
    const second = await open();
    await clickDot(page, second.canvas, 40, 40);
    await close(second.dialog).click();
    await expect(second.dialog.getByTestId("co-close-prompt")).toBeVisible();
    await second.dialog.getByTestId("co-close-keep").click();
    await expect(second.dialog.getByTestId("co-close-prompt")).toHaveCount(0);
    await expectPainted(second.canvas, 40, 40, true, "the work is still there");

    // Escape asks the same question
    await page.keyboard.press("Escape");
    await expect(second.dialog.getByTestId("co-close-prompt")).toBeVisible();

    // "save and close": the dialog closes, the project is saved, and the panel remembers it
    await second.dialog.getByTestId("co-close-save").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await savedCount(page)).toBe(1);
    await expect(page.getByTestId("buy-saved")).toContainText("20×20 px");
    await expect(page.getByTestId("buy-saved")).toContainText("Saved project");

    // the panel's button goes back to the parcel, and the editor offers the project
    await page.getByTestId("buy-saved-resume").click();
    await expect(page.getByTestId("buy-status")).toContainText(/free/i);
    await page.getByTestId("buy-continue").click();
    await expect(page.getByRole("dialog").getByTestId("co-draft-banner")).toBeVisible();
    await page.getByRole("dialog").getByTestId("co-draft-resume").click();
    await expectPainted(page.getByRole("dialog").locator("canvas").first(), 40, 40, true, "back as it was");

    // "close without saving" on new work: nothing is kept of that work (the earlier project stays as it was)
    await clickDot(page, page.getByRole("dialog").locator("canvas").first(), 150, 150);
    await close(page.getByRole("dialog")).click();
    await page.getByTestId("co-close-discard").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await age(page, 0); // (a no-op that makes sure the store can still be read)
    const last = await open();
    await last.dialog.getByTestId("co-draft-resume").click();
    await expectPainted(last.canvas, 40, 40, true, "the earlier project");
    await expectPainted(last.canvas, 150, 150, false, "the work that was not saved");
    await ctx.close();
  });
});
