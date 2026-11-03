import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createUser, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const setting = async (key: string) => (await pool.query(`select value from public.app_settings where key = $1`, [key])).rows[0]?.value;
const startIn = (user: string, x: number, currency: string | null, w = 10, h = 10) =>
  pool.query(`select * from public.px_start_order($1, $2, 100, $3, $4, null, $5)`, [user, x, w, h, currency]).then((r) => r.rows[0]);

describe("two currencies: euros (the shop's own) and dollars", () => {
  it("has a dollar price of 50 cents by default, next to the euro one", async () => {
    expect(await setting("price_unit_cents_usd")).toBe(50);
    expect(await setting("currency")).toBe("eur");
  });

  it("prices an order in euros by default and when asked for euros, in dollars when asked for dollars", async () => {
    const u = await createUser("buyer");
    await pool.query(`update public.app_settings set value = '70'::jsonb where key = 'price_unit_cents_usd'`);
    const plain = await startIn(u, 0, null), eur = await startIn(u, 20, "eur"), usd = await startIn(u, 40, "usd");
    expect([plain.currency, plain.unit_price_cents, Number(plain.amount_cents)]).toEqual(["eur", 50, 5000]);
    expect([eur.currency, eur.unit_price_cents, Number(eur.amount_cents)]).toEqual(["eur", 50, 5000]);
    expect([usd.currency, usd.unit_price_cents, Number(usd.amount_cents)]).toEqual(["usd", 70, 7000]);
  });

  it("keeps the currency and the unit price an order was made with, whatever the settings become", async () => {
    const u = await createUser("buyer");
    const usd = await startIn(u, 0, "usd");
    await pool.query(`update public.app_settings set value = '999'::jsonb where key = 'price_unit_cents_usd'`);
    const { rows: [o] } = await pool.query(`select currency, unit_price_cents, amount_cents from public.orders where id = $1`, [usd.order_id]);
    expect([o.currency, o.unit_price_cents, Number(o.amount_cents)]).toEqual(["usd", 50, 5000]);
  });

  it("applies the sea discount in dollars as it does in euros", async () => {
    const u = await createUser("buyer");
    await pool.query(`update public.app_settings set value = '10'::jsonb where key = 'sea_price_percent'`);
    const { rows: [o] } = await pool.query(`select * from public.px_start_order($1, 0, 100, 10, 10, 60, 'usd')`, [u]);
    expect(Number(o.amount_cents)).toBe(60 * 50 + Math.floor((40 * 50 * 10) / 100)); // 60 land pixels, 40 sea pixels at 10 %
  });

  it("refuses any other currency, and an empty one means the shop's own", async () => {
    const u = await createUser("buyer");
    for (const c of ["gbp", "jpy", "EURO", "usd; drop"]) await expect(startIn(u, 0, c), c).rejects.toThrow(/px_bad_currency/);
    expect((await startIn(u, 60, "")).currency).toBe("eur");
    expect((await startIn(u, 80, "  USD ")).currency).toBe("usd"); // however it is written
  });

  it("still closes the shop for dollars too", async () => {
    const u = await createUser("buyer");
    await pool.query(`update public.app_settings set value = 'false'::jsonb where key = 'sales_open'`);
    await expect(startIn(u, 0, "usd")).rejects.toThrow(/px_sales_closed/);
  });

  it("lets an admin set the dollar price like the euro one, and nobody else", async () => {
    const admin = await createUser("boss", { role: "admin" }), mod = await createUser("mod", { role: "moderator" });
    await pool.query(`select public.px_set_setting($1, 'price_unit_cents_usd', '65'::jsonb)`, [admin]);
    expect(await setting("price_unit_cents_usd")).toBe(65);
    await expect(pool.query(`select public.px_set_setting($1, 'price_unit_cents_usd', '65'::jsonb)`, [mod])).rejects.toThrow(/px_forbidden|forbidden/);
    for (const bad of ["0", "-1", "1.5", '"x"']) await expect(pool.query(`select public.px_set_setting($1, 'price_unit_cents_usd', $2::jsonb)`, [admin, bad]), bad).rejects.toThrow(/px_bad_setting/);
    const { rows } = await pool.query(`select metadata from public.audit_logs where action = 'setting.update' and target_id = 'price_unit_cents_usd'`);
    expect(rows).toHaveLength(1);
  });
});
