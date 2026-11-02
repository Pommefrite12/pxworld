import { expect, test, type Locator } from "@playwright/test";

/**
 * The editor's colours: the text has a colour of its own (changing the stroke colour never recolours it, and the other way
 * round), and a multicolour brush runs through the chosen colours, one brush width of each at a time.
 */
const RED = "#ff4d2e", BLUE = "#2b35e0", GREEN = "#12b886", PURPLE = "#9b5de5";
const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** How many dots of the canvas have (nearly) each colour. */
const counts = (canvas: Locator, hexes: string[]) => canvas.evaluate((c: HTMLCanvasElement, wanted: number[][]) => {
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  const n = wanted.map(() => 0);
  for (let i = 0; i < d.length; i += 4) wanted.forEach((w, j) => { if (Math.abs(d[i]! - w[0]!) < 24 && Math.abs(d[i + 1]! - w[1]!) < 24 && Math.abs(d[i + 2]! - w[2]!) < 24) n[j]!++; });
  return n;
}, hexes.map(rgb));

/** The runs of the given colours along one row of the canvas, in order: [{ colour, length }…]. */
export const runsOnRow = (canvas: Locator, row: number, hexes: string[]) => canvas.evaluate((c: HTMLCanvasElement, args: { row: number; wanted: number[][] }) => {
  const d = c.getContext("2d")!.getImageData(0, args.row, c.width, 1).data;
  const runs: { colour: number; length: number }[] = [];
  for (let x = 0; x < c.width; x++) {
    const j = args.wanted.findIndex((w) => d[x * 4] === w[0] && d[x * 4 + 1] === w[1] && d[x * 4 + 2] === w[2]);
    if (j < 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.colour === j) last.length++; else runs.push({ colour: j, length: 1 });
  }
  return runs;
}, { row, wanted: hexes.map(rgb) });

test("the text keeps its own colour: choosing a stroke colour never recolours it, and the strokes keep theirs", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.request.post("/api/dev/login", { data: { email: "textcolour@example.test" } });
  const page = await ctx.newPage();
  await page.goto("/map?bx=26500&by=11000&bw=30&bh=30");
  await expect(page.getByTestId("buy-status")).toContainText(/free/i);
  await page.getByTestId("buy-continue").click();
  const dialog = page.getByRole("dialog");
  const canvas = dialog.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const tool = (name: string) => dialog.getByRole("radio", { name });

  // a text starts in the current stroke colour (red) …
  await dialog.getByRole("button", { name: "Add text" }).click();
  await dialog.getByRole("textbox", { name: "Text", exact: true }).fill("HI");
  await expect.poll(async () => (await counts(canvas, [RED]))[0]).toBeGreaterThan(200);
  // … then gets a colour of its own: blue
  await dialog.getByRole("button", { name: `Text colour ${BLUE}`, exact: true }).click();
  await expect.poll(async () => (await counts(canvas, [BLUE]))[0]).toBeGreaterThan(200);
  expect((await counts(canvas, [RED]))[0], "the text is no longer red").toBe(0);
  const blue = (await counts(canvas, [BLUE]))[0]!;

  // a stroke colour is chosen: the text stays blue, and the pencil is back in hand (it was on the text)
  await expect(tool("Move text")).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: GREEN, exact: true }).click();
  await expect(tool("Pencil")).toHaveAttribute("aria-checked", "true");
  expect(await counts(canvas, [BLUE, GREEN])).toEqual([blue, 0]);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8);
  const [blueAfter, green] = await counts(canvas, [BLUE, GREEN]);
  expect(blueAfter, "the text is untouched by a green stroke").toBe(blue);
  expect(green, "the stroke is green").toBeGreaterThan(50);

  // the text colour changes again: the green stroke stays green
  await dialog.getByRole("button", { name: `Text colour ${PURPLE}`, exact: true }).click();
  await expect.poll(async () => (await counts(canvas, [PURPLE]))[0]).toBeGreaterThan(200);
  expect(await counts(canvas, [BLUE, GREEN])).toEqual([0, green]);
  await ctx.close();
});

test("a multicolour brush runs through the chosen colours, one brush width of each, in the order they were chosen", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.request.post("/api/dev/login", { data: { email: "multicolour@example.test" } });
  const page = await ctx.newPage();
  await page.goto("/map?bx=26600&by=11000&bw=30&bh=30");
  await expect(page.getByTestId("buy-status")).toContainText(/free/i);
  await page.getByTestId("buy-continue").click();
  const dialog = page.getByRole("dialog");
  const canvas = dialog.locator("canvas").first();

  // red is the colour in hand: it is the first of the mix; blue and green follow
  await dialog.getByTestId("multi-toggle").check();
  await dialog.getByRole("button", { name: BLUE, exact: true }).click();
  await dialog.getByRole("button", { name: GREEN, exact: true }).click();
  // each selected colour shows its rank in the mix (the badges sit on the swatches, in palette order): red 1, blue 2, green 3
  await expect(dialog.getByTestId("mix-rank")).toHaveCount(3);
  expect((await dialog.getByTestId("mix-rank").allInnerTexts()).sort()).toEqual(["1", "2", "3"]);
  await expect(dialog.getByRole("button", { name: BLUE, exact: true }).getByTestId("mix-rank")).toHaveText("2");
  await expect(dialog.getByRole("button", { name: GREEN, exact: true }).getByTestId("mix-rank")).toHaveText("3");
  await dialog.locator("#ed-brush").selectOption("1"); // 1 px = 10 dots: each colour runs for 10 dots
  const box = (await canvas.boundingBox())!;
  const dot = box.width / 300; // the canvas is 300 dots wide (ten per pixel)
  const y = box.y + 150.5 * dot;
  await page.mouse.move(box.x + 40 * dot, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 200 * dot, y, { steps: 10 });
  await page.mouse.up();

  const runs = await runsOnRow(canvas, 150, [RED, BLUE, GREEN]);
  expect(runs.length, "a long stroke goes through the colours several times").toBeGreaterThanOrEqual(12);
  expect(runs.map((r) => r.colour).slice(0, 7), "in the order of the mix, then around again").toEqual([0, 1, 2, 0, 1, 2, 0]);
  expect(runs.slice(1, -1).every((r) => r.length === 10), `each colour for one brush width: ${JSON.stringify(runs.map((r) => r.length))}`).toBe(true);

  // clicking a colour of the mix again takes it out (blue): red and green alternate; the last colour cannot be removed
  await dialog.getByRole("button", { name: BLUE, exact: true }).click();
  await expect(dialog.getByTestId("mix-rank")).toHaveCount(2);
  const y2 = box.y + 250.5 * dot;
  await page.mouse.move(box.x + 40 * dot, y2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160 * dot, y2, { steps: 8 });
  await page.mouse.up();
  const runs2 = await runsOnRow(canvas, 250, [RED, BLUE, GREEN]);
  expect(runs2.map((r) => r.colour).slice(0, 6)).toEqual([0, 2, 0, 2, 0, 2]);
  expect(runs2.some((r) => r.colour === 1)).toBe(false);

  // back to a single colour: an ordinary stroke
  await dialog.getByTestId("multi-toggle").uncheck();
  await page.mouse.move(box.x + 40 * dot, box.y + 60.5 * dot);
  await page.mouse.down();
  await page.mouse.move(box.x + 160 * dot, box.y + 60.5 * dot, { steps: 6 });
  await page.mouse.up();
  const runs3 = await runsOnRow(canvas, 60, [RED, BLUE, GREEN]);
  expect(runs3).toHaveLength(1); // one colour, one run
  await ctx.close();
});
