import { afterAll, describe, expect, it } from "vitest";
import { closeDb, pool } from "./helpers";

afterAll(closeDb);

/**
 * The site's own functions (`px_*`) are for the server only: on Supabase, anything in the `public` schema that `anon` or `authenticated` may execute can be
 * called by anybody holding the public key, through the REST API. Migration 2 closes them all; a function added later must close itself (a `revoke all on
 * function … from public, anon, authenticated` in its migration). The one exception is `px_is_staff`, which the row-level security policies call.
 */
describe("the px_* functions", () => {
  it("cannot be run by public, anon or authenticated (except px_is_staff, used by the policies)", async () => {
    const { rows } = await pool.query<{ proname: string }>(`
      select p.proname
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname like 'px\\_%' and p.proname <> 'px_is_staff'
         and (p.proacl is null
              or exists (select 1 from aclexplode(p.proacl) a
                          where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'))))
       order by 1`);
    expect(rows.map((r) => r.proname), "functions anybody can run (revoke them in the migration that creates them)").toEqual([]);
  });

  it("(the check can tell: px_is_staff is the open one)", async () => {
    const { rows } = await pool.query(`
      select 1 from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'px_is_staff'
         and exists (select 1 from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated')))`);
    expect(rows).toHaveLength(1);
  });
});
