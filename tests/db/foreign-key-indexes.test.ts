import { afterAll, describe, expect, it } from "vitest";
import { closeDb, pool } from "./helpers";

afterAll(closeDb);

/**
 * Every foreign key of the public schema has an index that starts with its columns. Without one, each delete of a referenced row makes PostgreSQL read
 * the whole referencing table (20 000 parcels: wiping them took 53 s, then 2 s with the indexes — migration 28), and so does every `where fk = …` lookup.
 * A new foreign key must come with its index in the same migration.
 */
describe("foreign keys", () => {
  it("all have an index on their columns", async () => {
    const { rows } = await pool.query<{ tbl: string; con: string }>(`
      select c.conrelid::regclass::text as tbl, c.conname as con
        from pg_constraint c
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace
         and not exists (
           select 1 from pg_index i
            where i.indrelid = c.conrelid and i.indisvalid
              and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
       order by 1, 2`);
    expect(rows.map((r) => `${r.tbl}: ${r.con}`), "foreign keys without an index (add one in a migration)").toEqual([]);
  });

  it("(the check itself can see a missing index)", async () => {
    // a throw-away pair of tables in a temporary schema is not covered by the check above; here the same query is run against one, to prove it finds a gap
    await pool.query("create temp table fk_parent (id int primary key)");
    await pool.query("create temp table fk_child (id int primary key, parent_id int references fk_parent (id))");
    const { rows } = await pool.query(`
      select c.conname from pg_constraint c
       where c.contype = 'f' and c.conrelid = 'fk_child'::regclass
         and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)`);
    expect(rows).toHaveLength(1);
    await pool.query("create index on fk_child (parent_id)");
    const after = await pool.query(`
      select c.conname from pg_constraint c
       where c.contype = 'f' and c.conrelid = 'fk_child'::regclass
         and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)`);
    expect(after.rows).toHaveLength(0);
  });
});
