import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, closeDb, createUser, expectPgError, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

/** An active parcel (paid) owned by `owner`; returns its id and public code. */
async function activeParcel(owner: string, x = 100) {
  const o = await startOrder(owner, { x, y: 100, w: 10, h: 10 });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  const code = (await pool.query(`select code from public.parcels where id = $1`, [o.parcel_id])).rows[0].code as string;
  return { id: o.parcel_id as string, code };
}
const add = async (user: string, code: string, body: string) =>
  (await pool.query(`select public.px_comment_add($1, $2, $3) as id`, [user, code, body])).rows[0].id as string;
const remove = async (actor: string, comment: string, reason: string | null = null) =>
  (await pool.query(`select public.px_comment_remove($1, $2, $3) as role`, [actor, comment, reason])).rows[0].role as string;
const status = async (comment: string) => (await pool.query(`select status, removed_role from public.parcel_comments where id = $1`, [comment])).rows[0];

describe("comments under a parcel", () => {
  it("any active account can comment on an active, visible parcel; the text is trimmed", async () => {
    const [owner, visitor] = [await createUser("owner"), await createUser("visitor")];
    const p = await activeParcel(owner);
    const id = await add(visitor, p.code, "  Superbe dessin !  ");
    const r = (await pool.query(`select body, status, author_id, parcel_id from public.parcel_comments where id = $1`, [id])).rows[0];
    expect(r).toMatchObject({ body: "Superbe dessin !", status: "visible", author_id: visitor, parcel_id: p.id });
    await add(owner, p.code, "Merci !"); // the owner can answer
  });

  it("refuses empty or over-long text, unknown or hidden parcels, suspended accounts and copy-paste spam", async () => {
    const [owner, visitor, mod] = [await createUser("owner"), await createUser("visitor"), await createUser("mod", { role: "moderator" })];
    const p = await activeParcel(owner);
    await expectPgError(add(visitor, p.code, "   "), "px_comment_invalid");
    await expectPgError(add(visitor, p.code, "x".repeat(501)), "px_comment_invalid");
    await add(visitor, p.code, "x".repeat(500)); // the limit itself is fine
    await expectPgError(add(visitor, "ZZZZZZ", "hello"), "px_not_found");
    // the same words twice in a row are refused, different words are not, and someone else may say the same thing
    await add(visitor, p.code, "first");
    await expectPgError(add(visitor, p.code, "first"), "px_comment_duplicate");
    await add(visitor, p.code, "second");
    await add(owner, p.code, "first");
    // a hidden parcel has no comment area
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'test')`, [mod, p.id]);
    await expectPgError(add(visitor, p.code, "still here?"), "px_not_found");
    await pool.query(`select public.px_set_parcel_hidden($1, $2, false)`, [mod, p.id]);
    // a suspended account cannot comment
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [visitor]);
    await expectPgError(add(visitor, p.code, "let me in"), "px_account_suspended");
  });

  it("a reserved (unpaid) parcel has no comment area", async () => {
    const [owner, visitor] = [await createUser("owner"), await createUser("visitor")];
    const o = await startOrder(owner, { x: 400, y: 100, w: 10, h: 10 });
    const code = (await pool.query(`select code from public.parcels where id = $1`, [o.parcel_id])).rows[0].code as string;
    await expectPgError(add(visitor, code, "hi"), "px_not_found");
  });

  it("the author, the parcel owner and staff can remove a comment; nobody else", async () => {
    const [owner, author, stranger, mod, admin] = [await createUser("owner"), await createUser("author"), await createUser("stranger"), await createUser("mod", { role: "moderator" }), await createUser("admin", { role: "admin" })];
    const p = await activeParcel(owner);
    const c1 = await add(author, p.code, "mine");
    const c2 = await add(author, p.code, "owner removes this");
    const c3 = await add(author, p.code, "moderator removes this");
    const c4 = await add(author, p.code, "admin removes this");
    await expectPgError(remove(stranger, c1), "px_forbidden");
    expect(await status(c1)).toMatchObject({ status: "visible" });
    expect(await remove(author, c1)).toBe("author");
    expect(await remove(owner, c2)).toBe("owner");
    expect(await remove(mod, c3, "insulting")).toBe("moderator");
    expect(await remove(admin, c4)).toBe("admin");
    expect(await status(c3)).toMatchObject({ status: "removed", removed_role: "moderator" });
    // already removed: gone
    await expectPgError(remove(author, c1), "px_not_found");
    await expectPgError(remove(author, "00000000-0000-0000-0000-000000000000"), "px_not_found");
  });

  it("a removal by someone other than the author is journalised; an author taking back their words is not", async () => {
    const [owner, author, mod] = [await createUser("owner"), await createUser("author"), await createUser("mod", { role: "moderator" })];
    const p = await activeParcel(owner);
    const mine = await add(author, p.code, "mine");
    const theirs = await add(author, p.code, "to be moderated");
    await remove(author, mine);
    await remove(mod, theirs, "rule 3");
    const logs = (await pool.query(`select actor_id, actor_role, target_id, metadata from public.audit_logs where action = 'comment.remove'`)).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor_id: mod, actor_role: "moderator", target_id: theirs });
    expect(logs[0].metadata).toMatchObject({ author_id: author, reason: "rule 3" });
  });

  it("comments go with their author's account and are not reachable from the browser roles", async () => {
    const [owner, visitor] = [await createUser("owner"), await createUser("visitor")];
    const p = await activeParcel(owner);
    await add(visitor, p.code, "hello");
    await expectPgError(asRole("authenticated", visitor, (c) => c.query(`select * from public.parcel_comments`)), "42501");
    await expectPgError(asRole("anon", null, (c) => c.query(`select * from public.parcel_comments`)), "42501");
    await expectPgError(asRole("authenticated", visitor, (c) => c.query(`select public.px_comment_add($1, $2, 'x')`, [visitor, p.code])), "42501");
    await expectPgError(asRole("authenticated", visitor, (c) => c.query(`select public.px_comment_remove($1, $2)`, [visitor, "00000000-0000-0000-0000-000000000000"])), "42501");
    await pool.query(`delete from auth.users where id = $1`, [visitor]);
    expect((await pool.query(`select count(*)::int as n from public.parcel_comments`)).rows[0].n).toBe(0);
  });
});
