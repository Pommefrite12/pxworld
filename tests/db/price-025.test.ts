import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createUser, openEdition, pool } from "./helpers";

afterAll(closeDb);
beforeAll(openEdition); // a fresh database is in pre-launch; only the edition is opened, the settings stay as the migrations leave them

/**
 * NO `resetData` here, on purpose: the other files force the price to 50 cents to keep their arithmetic round. This one reads the database
 * exactly as the migrations leave it (a fresh site), and checks that the price a buyer is charged is the brief's: €0.25 a pixel.
 */
const TABLE = [
  { w: 5, h: 5, cents: 625 },     // 25 px   €6.25
  { w: 5, h: 10, cents: 1_250 },  // 50 px   €12.50
  { w: 10, h: 10, cents: 2_500 }, // 100 px  €25
  { w: 10, h: 20, cents: 5_000 }, // 200 px  €50
  { w: 20, h: 20, cents: 10_000 },// 400 px  €100
];
const setting = async (key: string) => (await pool.query(`select value from public.app_settings where key = $1`, [key])).rows[0]?.value;
const start = async (x: number, y: number, w: number, h: number, currency: string | null, land: number | null = null, kind = "land") =>
  (await pool.query(`select * from public.px_start_order($1, $2, $3, $4, $5, $6, $7, $8)`, [await createUser("buyer"), x, y, w, h, land, currency, kind])).rows[0] as { order_id: string; amount_cents: string; unit_price_cents: number; currency: string };

describe("the factory price after every migration: 0.25 a pixel", () => {
  it("the unit price is 25 cents, in euros and in dollars, and the water rate is 100 %", async () => {
    expect(await setting("price_unit_cents")).toBe(25);
    expect(await setting("price_unit_cents_usd")).toBe(25);
    expect(await setting("water_price_percent")).toBe(100);
    expect(await setting("min_area")).toBe(25);
    expect(await setting("currency")).toBe("eur");
  });

  it("the server charges 6.25 / 12.50 / 25 / 50 / 100 euros for 25 / 50 / 100 / 200 / 400 pixels", async () => {
    for (const [i, t] of TABLE.entries()) {
      const o = await start(100 + i * 40, 100, t.w, t.h, null);
      expect([o.currency, o.unit_price_cents, Number(o.amount_cents)], `${t.w}×${t.h}`).toEqual(["eur", 25, t.cents]);
      const { rows: [row] } = await pool.query(`select amount_cents, unit_price_cents, currency from public.orders where id = $1`, [o.order_id]);
      expect([row.currency, row.unit_price_cents, Number(row.amount_cents)]).toEqual(["eur", 25, t.cents]); // the order itself keeps it
    }
  });

  it("and the same figures in dollars (outside the euro area)", async () => {
    for (const [i, t] of TABLE.entries()) {
      const o = await start(100 + i * 40, 300, t.w, t.h, "usd");
      expect([o.currency, o.unit_price_cents, Number(o.amount_cents)], `${t.w}×${t.h}`).toEqual(["usd", 25, t.cents]);
    }
  });

  it("a water parcel of the same size costs the same, at the default rate", async () => {
    for (const [i, t] of TABLE.entries()) {
      const o = await start(100 + i * 40, 500, t.w, t.h, null, 0, "water");
      expect(Number(o.amount_cents), `${t.w}×${t.h} water`).toBe(t.cents);
    }
  });

  it("the buyer's price is only ever pixels × the unit price: the price is not a number the client sends", async () => {
    // px_start_order takes a rectangle (and a currency), never an amount: there is no argument through which a price could be proposed
    const { rows } = await pool.query(`select pg_get_function_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'px_start_order'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].args).not.toMatch(/amount|price|cents/i);
  });
});
