import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, pool, resetData } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261029000007_price_10_cents.sql"), "utf8");
const price = async () => (await pool.query(`select value from public.app_settings where key = 'price_unit_cents'`)).rows[0].value as number;
const setPrice = (v: number) => pool.query(`update public.app_settings set value = $1::jsonb where key = 'price_unit_cents'`, [JSON.stringify(v)]);

describe("migration 7: the default price is €0.10 per pixel", () => {
  it("lowers the untouched factory default (100 cents) to 10 cents", async () => {
    await setPrice(100);
    await pool.query(migration);
    expect(await price()).toBe(10);
  });

  it("leaves a price an admin chose on purpose alone, and is idempotent", async () => {
    await setPrice(250);
    await pool.query(migration);
    expect(await price()).toBe(250);
    await setPrice(10);
    await pool.query(migration);
    expect(await price()).toBe(10);
  });
});
