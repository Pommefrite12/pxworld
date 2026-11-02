import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, pool, resetData } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "supabase/migrations", name), "utf8");
const m7 = read("20261029000007_price_10_cents.sql");
const m8 = read("20261029000008_price_50_cents.sql");
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
