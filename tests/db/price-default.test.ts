import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, pool, resetData } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8");
const m7 = read("20261029000007_price_10_cents.sql");
const m8 = read("20261029000008_price_50_cents.sql");
const m16 = read("20261029000016_price_25_cents.sql");
const usd = async () => (await pool.query(`select value from public.app_settings where key = 'price_unit_cents_usd'`)).rows[0].value as number;
const setUsd = (v: number) => pool.query(`update public.app_settings set value = $1::jsonb where key = 'price_unit_cents_usd'`, [JSON.stringify(v)]);
const price = async () => (await pool.query(`select value from public.app_settings where key = 'price_unit_cents'`)).rows[0].value as number;
const setPrice = (v: number) => pool.query(`update public.app_settings set value = $1::jsonb where key = 'price_unit_cents'`, [JSON.stringify(v)]);

describe("migrations 7 and 8: the default price moves to €0.50 per pixel", () => {
  it("a database that never ran migration 7 (100 cents) ends at 50 cents after both", async () => {
    await setPrice(100);
    await pool.query(m7);
    expect(await price()).toBe(10);
    await pool.query(m8);
    expect(await price()).toBe(50);
  });

  it("a database that already ran migration 7 (10 cents) goes to 50 cents", async () => {
    await setPrice(10);
    await pool.query(m8);
    expect(await price()).toBe(50);
  });

  it("a price an admin chose on purpose is never touched, and re-running is harmless", async () => {
    for (const chosen of [75, 250]) {
      await setPrice(chosen);
      await pool.query(m7);
      await pool.query(m8);
      expect(await price()).toBe(chosen);
    }
    await setPrice(50);
    await pool.query(m8);
    expect(await price()).toBe(50);
  });
});

describe("migration 16: the default price moves to 0.25 per pixel, in euros and in dollars", () => {
  it("an untouched 0.50 goes to 0.25 in both currencies", async () => {
    await setPrice(50); await setUsd(50);
    await pool.query(m16);
    expect([await price(), await usd()]).toEqual([25, 25]);
  });
  it("a price an admin chose on purpose is never touched, each currency on its own, and re-running is harmless", async () => {
    await setPrice(75); await setUsd(50);
    await pool.query(m16);
    expect([await price(), await usd()]).toEqual([75, 25]);
    await setPrice(50); await setUsd(60);
    await pool.query(m16);
    expect([await price(), await usd()]).toEqual([25, 60]);
    await pool.query(m16);
    expect([await price(), await usd()]).toEqual([25, 60]);
  });
  it("an order made before keeps the price it was made with", async () => {
    const { createUser, startOrder } = await import("./helpers");
    await setPrice(50);
    const o = await startOrder(await createUser(), { x: 100, y: 100, w: 20, h: 20 });
    await pool.query(m16);
    expect(Number((await pool.query(`select unit_price_cents from public.orders where id = $1`, [o.order_id])).rows[0].unit_price_cents)).toBe(50);
    expect(await price()).toBe(25);
  });
});
