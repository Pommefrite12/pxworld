import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, closeDb, createUser, expectPgError, fulfill, overlappingPairs, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);

const NAME = "Édition fondatrice";
const info = async () => (await pool.query(`select public.px_edition_info() as i`)).rows[0].i as Record<string, any>;
const edition = async () => (await pool.query(`select * from public.editions`)).rows[0];
const audit = async (action: string) => (await pool.query(`select * from public.audit_logs where action = $1 order by created_at`, [action])).rows;
/** The clock cannot be set, so the edition is moved instead: it was opened 101 days ago and closed `minutes` ago. */
const closedAgo = (minutes: number) => pool.query(`update public.editions set status = 'open', opens_at = now() - interval '101 days', closes_at = now() - make_interval(mins => $1), closed_at = null`, [minutes]);
const sweep = async () => (await pool.query(`select public.px_edition_sweep() as r`)).rows[0].r as string;
const snapshots = async () => (await pool.query(`select * from public.edition_snapshots order by revision`)).rows;
const mod = () => createUser("mod", { role: "moderator" });
const admin = () => createUser("boss", { role: "admin" });

/** A paid 5 × 5 parcel with a creation that a moderator approved. */
async function published(owner: string, moderator: string, x: number, title = "Mine") {
  const o = await startOrder(owner, { x, y: 100, w: 5, h: 5 });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  const { rows: [a] } = await pool.query(`select * from public.px_add_asset($1, $2, $3, 'abcdef', 5, 5, 10, '#112233', $4, null, null, false)`, [owner, o.parcel_id, `creations/${o.parcel_id}-${x}.png`, title]);
  await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [moderator, a.id]);
  const { rows: [p] } = await pool.query(`select code from public.parcels where id = $1`, [o.parcel_id]);
  return { id: o.parcel_id as string, code: p.code as string, asset: a.id as string };
}
const addAsset = (owner: string, parcel: string, tag = "v2") =>
  pool.query(`select * from public.px_add_asset($1, $2, $3, 'abcdef', 5, 5, 10, '#112233', 'Again', null, null, false)`, [owner, parcel, `creations/${parcel}-${tag}.png`]);

/* ------------------------------------------------------------------------------------------------------------------ pre-launch */

describe("a fresh database is in pre-launch: no date, nothing for sale, and the 100 days never start by themselves", () => {
  it("has the founding edition, with no date at all", async () => {
    const e = await edition();
    expect(e).toMatchObject({ slug: "fondatrice", name: NAME, status: "prelaunch", duration_days: 100, opens_at: null, closes_at: null, closed_at: null });
    const i = await info();
    expect(i).toMatchObject({ status: "prelaunch", state: "prelaunch", frozen: false, opensAt: null, closesAt: null, settlesAt: null, snapshot: null });
    expect(Date.parse(i.serverNow)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("refuses every purchase, reservation and project until an administrator opens it", async () => {
    const u = await createUser("buyer");
    await expectPgError(startOrder(u, { x: 100, y: 100, w: 10, h: 10 }), "px_edition_not_open");
    await expectPgError(pool.query(`select * from public.px_create_campaign($1, 1000, 1000, 100, 100, null, 'eur', 'land', 14, 'c/x.png', 'abc', 100, 100, 1, '#112233', 't', 'd', null, false)`, [u]), "px_edition_not_open");
    expect((await pool.query(`select count(*)::int n from public.parcels`)).rows[0].n).toBe(0);
  });

  it("is opened by an administrator only, who must type the name of the edition", async () => {
    const [boss, moderator, user] = [await admin(), await mod(), await createUser("user")];
    for (const who of [moderator, user]) await expectPgError(pool.query(`select public.px_edition_open($1, $2)`, [who, NAME]), "px_forbidden");
    for (const typed of ["", "ouvrir", "Édition", null]) await expectPgError(pool.query(`select public.px_edition_open($1, $2)`, [boss, typed]), "px_edition_confirm_mismatch");
    expect((await edition()).status).toBe("prelaunch"); // none of that opened anything
    expect(await audit("edition.open")).toHaveLength(0);
  });

  it("opens for 100 days from the moment of the click, and writes it to the audit log", async () => {
    const boss = await admin();
    const before = Date.now();
    const { rows: [r] } = await pool.query(`select public.px_edition_open($1, '  édition FONDATRICE ') as i`, [boss]); // case and spaces do not matter
    expect(r.i).toMatchObject({ status: "open", state: "open", frozen: false });
    const e = await edition();
    expect(e.status).toBe("open");
    expect(e.opens_at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(e.opens_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(e.closes_at.getTime() - e.opens_at.getTime()).toBe(100 * 86_400_000);
    const log = await audit("edition.open");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_id: boss, actor_role: "admin", target_type: "edition" });
    // opening twice is refused; and now the shop sells
    await expectPgError(pool.query(`select public.px_edition_open($1, $2)`, [boss, NAME]), "px_edition_bad_state");
    const o = await startOrder(await createUser("first"), { x: 100, y: 100, w: 10, h: 10 });
    expect(o.order_id).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------------------------------------------------ the clock decides */

describe("the closing is decided by the clock, not by anything that has to run", () => {
  beforeEach(resetData);

  it("refuses purchases and projects from the second the closing date passes, though no job ever ran", async () => {
    const [buyer, maker] = [await createUser("buyer"), await createUser("maker")];
    await startOrder(buyer, { x: 100, y: 100, w: 10, h: 10 }); // open: fine
    await closedAgo(1);
    expect(await edition()).toMatchObject({ status: "open" }); // the row still says open: nothing recorded it
    expect((await info()).state).toBe("closed");
    await expectPgError(startOrder(await createUser("late"), { x: 300, y: 100, w: 10, h: 10 }), "px_edition_closed");
    await expectPgError(pool.query(`select * from public.px_create_campaign($1, 1000, 1000, 100, 100, null, 'eur', 'land', 14, 'c/x.png', 'abc', 100, 100, 1, '#112233', 't', 'd', null, false)`, [maker]), "px_edition_closed");
    // postponed: it sells again (the check reads the date, nothing is cached)
    await pool.query(`update public.editions set closes_at = now() + interval '1 day'`);
    expect((await startOrder(await createUser("again"), { x: 300, y: 100, w: 10, h: 10 })).order_id).toBeTruthy();
  });

  it("is still the shop's own switch too: closing the shop by hand closes it whatever the edition says", async () => {
    await pool.query(`update public.app_settings set value = 'false'::jsonb where key = 'sales_open'`);
    await expectPgError(startOrder(await createUser("b"), { x: 100, y: 100, w: 10, h: 10 }), "px_sales_closed");
  });

  it("lets a payment that was under way finish during the reservation delay, and refunds it after", async () => {
    const [a, b] = [await createUser("a"), await createUser("b")];
    const oa = await startOrder(a, { x: 100, y: 100, w: 10, h: 10 });
    const ob = await startOrder(b, { x: 300, y: 100, w: 10, h: 10 });
    await closedAgo(5); // closed 5 minutes ago; the delay is the reservation time (35 minutes)
    expect(await fulfill(oa.order_id)).toBe("fulfilled");
    expect((await pool.query(`select status from public.parcels where id = $1`, [oa.parcel_id])).rows[0].status).toBe("active");
    await closedAgo(40); // the delay is over: the edition is frozen
    expect((await info()).frozen).toBe(true);
    expect(await fulfill(ob.order_id)).toBe("refund_required");
    expect((await pool.query(`select status from public.orders where id = $1`, [ob.order_id])).rows[0].status).toBe("refund_required");
    expect((await pool.query(`select status from public.parcels where id = $1`, [ob.parcel_id])).rows[0].status).toBe("released");
    const log = await audit("order.refund_required");
    expect(log.map((l) => l.metadata.reason)).toContain("edition_closed");
  });
});

/* ------------------------------------------------------------------------------------------------------------------ the freeze */

describe("once frozen, nothing a participant does changes the archive", () => {
  beforeEach(resetData);

  it("creations: a new version is accepted until the delay is over, then refused; moderation still works", async () => {
    const [owner, moderator] = [await createUser("owner"), await mod()];
    const p = await published(owner, moderator, 100);
    const pending = (await addAsset(owner, p.id, "pending")).rows[0]; // a version waiting for a moderator
    await closedAgo(5);
    expect((await addAsset(owner, p.id, "grace")).rows[0].id).toBeTruthy(); // a buyer who paid just before the end can still finish
    await closedAgo(40);
    await expectPgError(addAsset(owner, p.id, "late"), "px_edition_frozen");
    // moderators are not participants: they can still approve a late review, hide, and remove
    const { rows: [last] } = await pool.query(`select id from public.parcel_assets where parcel_id = $1 and status = 'pending'`, [p.id]);
    expect(pending.id).toBeTruthy();
    await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [moderator, last.id]);
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'test')`, [moderator, p.id]);
  });

  it("collaborative drawing: painting, resetting and re-opening the link are refused; cutting the link still works", async () => {
    const [owner, moderator] = [await createUser("owner"), await mod()];
    const p = await published(owner, moderator, 100);
    const token = (await pool.query(`select public.px_collab_enable($1, $2, false) as t`, [owner, p.id])).rows[0].t as string;
    const paint = () => pool.query(`select public.px_collab_paint($1, '{1}', '{1}', '{16711680}')`, [token]);
    await paint(); // open: fine
    await closedAgo(40);
    await expectPgError(paint(), "px_edition_frozen");
    await expectPgError(pool.query(`select public.px_collab_reset($1, $2)`, [owner, p.id]), "px_edition_frozen");
    await expectPgError(pool.query(`select public.px_collab_enable($1, $2, true)`, [owner, p.id]), "px_edition_frozen");
    await pool.query(`select public.px_collab_disable($1, $2)`, [owner, p.id]); // switching a link OFF is always allowed
  });

  it("comments and likes are closed; a like that was given is kept; deleting an account still works", async () => {
    const [owner, moderator, fan] = [await createUser("owner"), await mod(), await createUser("fan")];
    const p = await published(owner, moderator, 100);
    await pool.query(`select public.px_comment_add($1, $2, 'lovely')`, [fan, p.code]);
    await pool.query(`insert into public.parcel_likes (user_id, parcel_id) values ($1, $2)`, [fan, p.id]);
    await closedAgo(40);
    await expectPgError(pool.query(`select public.px_comment_add($1, $2, 'one more')`, [fan, p.code]), "px_edition_frozen");
    const other = await createUser("other");
    await expectPgError(pool.query(`insert into public.parcel_likes (user_id, parcel_id) values ($1, $2)`, [other, p.id]), "px_edition_frozen");
    await expectPgError(pool.query(`delete from public.parcel_likes where user_id = $1`, [fan]), "px_edition_frozen"); // an "unlike" changes the ranking
    // the same through the browser's own role (row-level security lets a user manage their likes directly)
    await expectPgError(asRole("authenticated", other, (c) => c.query(`insert into public.parcel_likes (user_id, parcel_id) values ('${other}', '${p.id}')`)), "px_edition_frozen");
    expect((await pool.query(`select count(*)::int n from public.parcel_likes`)).rows[0].n).toBe(1);
    // removing the account of the person who liked goes through (a cascade is not an unlike)
    await pool.query(`delete from auth.users where id = $1`, [fan]);
    expect((await pool.query(`select count(*)::int n from public.parcel_likes`)).rows[0].n).toBe(0);
    // reports and moderation of comments are not participants' edits
    await pool.query(`select public.px_comment_remove($1, c.id, 'x') from public.parcel_comments c`, [moderator]);
  });

  it("is not frozen before the closing, nor in pre-launch", async () => {
    expect((await info()).frozen).toBe(false);
    await pool.query(`update public.editions set status = 'prelaunch', opens_at = null, closes_at = null, closed_at = null`);
    expect((await info()).frozen).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------------------ the snapshot */

describe("the closing job: the snapshot of what the public could see, once", () => {
  beforeEach(resetData);

  it("waits for the payments under way, then takes the snapshot and marks the edition closed; a second run does nothing", async () => {
    const [moderator, a, b, c, d] = [await mod(), await createUser("a"), await createUser("b"), await createUser("c"), await createUser("d")];
    const pa = await published(a, moderator, 100, "Alpha");
    const nocreation = await startOrder(b, { x: 300, y: 100, w: 5, h: 5 });
    expect(await fulfill(nocreation.order_id)).toBe("fulfilled"); // paid, no creation yet
    const hidden = await published(c, moderator, 500, "Hidden");
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'x')`, [moderator, hidden.id]);
    const suspended = await published(d, moderator, 700, "Suspended owner");
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [d]);

    expect(await sweep()).toBe("idle"); // not closed yet
    await closedAgo(10);
    expect(await sweep()).toBe("closing"); // the payments under way are still settling
    expect(await snapshots()).toHaveLength(0);
    expect((await edition()).status).toBe("open");
    await closedAgo(40);
    expect(await sweep()).toBe("finalized");
    expect((await edition()).status).toBe("closed");
    expect((await edition()).closed_at).not.toBeNull();

    const s = await snapshots();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ revision: 1, parcel_count: 2, taken_by: null });
    const manifest = s[0].manifest as { code: string; author: string; creation: null | { content_hash: string; title: string } }[];
    expect(manifest.map((m) => m.code)).toEqual([...manifest.map((m) => m.code)].sort()); // ordered by code
    expect(manifest.find((m) => m.code === pa.code)).toMatchObject({ creation: { content_hash: "abcdef", title: "Alpha" } });
    expect(manifest.some((m) => m.code === hidden.code || m.code === suspended.code)).toBe(false);
    expect(manifest.find((m) => m.creation === null)).toBeTruthy(); // a paid parcel without a creation is part of the map
    const { rows: [h] } = await pool.query(`select encode(sha256(convert_to(manifest::text, 'UTF8')), 'hex') as h from public.edition_snapshots where revision = 1`);
    expect(h.h).toBe(s[0].manifest_hash); // the hash is the hash of what is stored
    expect((await audit("edition.close"))[0].metadata).toMatchObject({ snapshot_revision: 1, parcels: 2 });
    expect(await info()).toMatchObject({ status: "closed", state: "closed", frozen: true, snapshot: { revision: 1, parcelCount: 2 } });

    expect(await sweep()).toBe("idle");
    expect(await snapshots()).toHaveLength(1);
  });

  it("is idempotent under pressure: six jobs at once make exactly one snapshot", async () => {
    const [moderator, a] = [await mod(), await createUser("a")];
    await published(a, moderator, 100);
    await closedAgo(40);
    const results = await Promise.all(Array.from({ length: 6 }, () => sweep()));
    expect(results.filter((r) => r === "finalized")).toHaveLength(1);
    expect(results.filter((r) => r === "idle")).toHaveLength(5);
    expect(await snapshots()).toHaveLength(1);
  });

  it("never rewrites a snapshot: a retraction after the closing makes a NEW revision, by an administrator", async () => {
    const [moderator, boss, a, b] = [await mod(), await admin(), await createUser("a"), await createUser("b")];
    const pa = await published(a, moderator, 100);
    await published(b, moderator, 300);
    await closedAgo(40);
    await sweep();
    await expectPgError(pool.query(`update public.edition_snapshots set parcel_count = 99`), "append-only");
    await expectPgError(pool.query(`delete from public.edition_snapshots`), "append-only");
    await pool.query(`select public.px_set_parcel_hidden($1, $2, true, 'takedown')`, [moderator, pa.id]);
    await expectPgError(pool.query(`select public.px_edition_take_snapshot($1)`, [moderator]), "px_forbidden");
    await pool.query(`select public.px_edition_take_snapshot($1)`, [boss]);
    const s = await snapshots();
    expect(s.map((x) => [x.revision, x.parcel_count])).toEqual([[1, 2], [2, 1]]);
    expect(s[0].manifest).not.toEqual(s[1].manifest);
    expect((await audit("edition.snapshot"))[0]).toMatchObject({ actor_id: boss });
  });

  it("is a closed door: after the closing nothing can be opened, postponed, reset or bought", async () => {
    const boss = await admin();
    await closedAgo(40);
    await sweep();
    await expectPgError(pool.query(`select public.px_edition_open($1, $2)`, [boss, NAME]), "px_edition_bad_state");
    await expectPgError(pool.query(`select public.px_edition_extend($1, now() + interval '30 days', 'x')`, [boss]), "px_edition_bad_state");
    await expectPgError(pool.query(`select public.px_edition_reset($1, $2)`, [boss, NAME]), "px_edition_bad_state");
    await expectPgError(pool.query(`select public.px_edition_close_now($1, $2)`, [boss, NAME]), "px_edition_bad_state");
    await expectPgError(startOrder(await createUser("b"), { x: 100, y: 100, w: 10, h: 10 }), "px_edition_closed");
  });

  it("cannot take a snapshot while the edition is still open", async () => {
    const boss = await admin();
    await expectPgError(pool.query(`select public.px_edition_take_snapshot($1)`, [boss]), "px_edition_bad_state");
  });
});

/* ------------------------------------------------------------------------------------------------------------------ group projects */

describe("group projects end with the edition (a contribution is a purchase)", () => {
  beforeEach(async () => {
    await resetData();
    await pool.query(`truncate public.campaigns cascade`);
    await pool.query(`update public.app_settings set value = '10000'::jsonb where key = 'campaign_min_area'`);
  });
  const create = async (user: string, x: number) =>
    (await pool.query(`select * from public.px_create_campaign($1, $2, 1000, 100, 100, null, 'eur', 'land', 14, $3, 'abc123', 100, 100, 1234, '#112233', 'Our wall', 'for all', null, false)`, [user, x, `campaigns/${user}-${x}.png`])).rows[0] as { id: string };
  const review = (actor: string, id: string, d: "approve" | "reject") => pool.query(`select public.px_review_campaign($1, $2, $3, null)`, [actor, id, d]);
  const start = async (user: string, campaign: string, amount = 5000) => (await pool.query(`select * from public.px_start_contribution($1, $2, $3)`, [user, campaign, amount])).rows[0] as { contribution_id: string };
  const pay = async (k: string, amount = 5000) => (await pool.query(`select public.px_fulfill_contribution($1, null, $2, $3, 0, $3, 'eur', 'x@example.test', 'FR') as r`, [k, `pi_${k}`, amount])).rows[0].r as string;
  const status = async (table: string, id: string) => (await pool.query(`select status from public.${table} where id = $1`, [id])).rows[0].status as string;

  it("closes the contributions, ends the open projects with a refund for everybody, and closes the ones nobody reviewed", async () => {
    const [moderator, maker1, maker2, a, b, late] = [await mod(), await createUser("m1"), await createUser("m2"), await createUser("a"), await createUser("b"), await createUser("late")];
    const c1 = await create(maker1, 1000), c2 = await create(maker2, 3000);
    await review(moderator, c1.id, "approve");
    const kA = await start(a, c1.id);          // a payment under way
    const kB = await start(b, c1.id);
    expect(await pay(kB.contribution_id)).toBe("fulfilled"); // paid
    await closedAgo(1);
    await expectPgError(start(late, c1.id), "px_edition_closed");
    await expectPgError(review(moderator, c2.id, "approve"), "px_edition_closed"); // approving would reserve a zone
    expect(await pay(kA.contribution_id)).toBe("refund_required"); // the payment under way arrives after the closing: refunded
    expect(await sweep()).toBe("closing");
    expect(await status("campaigns", c1.id)).toBe("expired");
    expect(await status("contributions", kB.contribution_id)).toBe("refund_required"); // the paid contribution is due back
    expect(await status("campaigns", c2.id)).toBe("rejected");
    expect((await pool.query(`select rejection_reason r from public.campaigns where id = $1`, [c2.id])).rows[0].r).toMatch(/edition closed/i);
    expect((await pool.query(`select count(*)::int n from public.parcels where status in ('reserved','active')`)).rows[0].n).toBe(0); // the zone is free again
  });

  it("still lets a moderator turn a project down after the closing", async () => {
    const [moderator, maker] = [await mod(), await createUser("m")];
    const c = await create(maker, 1000);
    await closedAgo(1);
    await review(moderator, c.id, "reject");
    expect(await status("campaigns", c.id)).toBe("rejected");
  });
});

/* ------------------------------------------------------------------------------------------------------------------ the administrator's tools */

describe("what an administrator can do with the edition, all of it audited", () => {
  beforeEach(resetData);

  it("postpones the closing, never brings it forward, never beyond 366 days, only while open", async () => {
    const [boss, moderator] = [await admin(), await mod()];
    const e0 = await edition();
    const plus = (days: number) => new Date(e0.closes_at.getTime() + days * 86_400_000).toISOString();
    await expectPgError(pool.query(`select public.px_edition_extend($1, $2, 'x')`, [moderator, plus(10)]), "px_forbidden");
    await expectPgError(pool.query(`select public.px_edition_extend($1, $2, 'x')`, [boss, plus(-1)]), "px_edition_bad_date"); // earlier
    await expectPgError(pool.query(`select public.px_edition_extend($1, $2, 'x')`, [boss, e0.closes_at.toISOString()]), "px_edition_bad_date"); // the same
    await expectPgError(pool.query(`select public.px_edition_extend($1, $2, 'x')`, [boss, plus(400)]), "px_edition_bad_date"); // too far
    await expectPgError(pool.query(`select public.px_edition_extend($1, null, 'x')`, [boss]), "px_edition_bad_date");
    await pool.query(`select public.px_edition_extend($1, $2, 'a storm took the servers down')`, [boss, plus(14)]);
    expect((await edition()).closes_at.getTime()).toBe(e0.closes_at.getTime() + 14 * 86_400_000);
    const log = await audit("edition.extend");
    expect(log).toHaveLength(1);
    expect(log[0].metadata).toMatchObject({ note: "a storm took the servers down" });
    await closedAgo(1); // too late to postpone: the sales are already over
    await expectPgError(pool.query(`select public.px_edition_extend($1, now() + interval '30 days', 'x')`, [boss]), "px_edition_bad_state");
  });

  it("closes the sales now, after a typed confirmation; the freeze and the snapshot follow by the clock", async () => {
    const [boss, moderator] = [await admin(), await mod()];
    await expectPgError(pool.query(`select public.px_edition_close_now($1, $2)`, [moderator, NAME]), "px_forbidden");
    await expectPgError(pool.query(`select public.px_edition_close_now($1, 'yes')`, [boss]), "px_edition_confirm_mismatch");
    await startOrder(await createUser("a"), { x: 100, y: 100, w: 10, h: 10 });
    await pool.query(`select public.px_edition_close_now($1, $2)`, [boss, NAME]);
    expect((await info()).state).toBe("closed");
    expect((await info()).frozen).toBe(false); // the payments under way still have their delay
    await expectPgError(startOrder(await createUser("b"), { x: 300, y: 100, w: 10, h: 10 }), "px_edition_closed");
    expect(await audit("edition.close_now")).toHaveLength(1);
    expect(await sweep()).toBe("closing");
  });

  it("goes back to pre-launch only to rehearse: refused as soon as anything was reserved, sold or paid", async () => {
    const [boss, moderator] = [await admin(), await mod()];
    await expectPgError(pool.query(`select public.px_edition_reset($1, 'no')`, [boss]), "px_edition_confirm_mismatch");
    await expectPgError(pool.query(`select public.px_edition_reset($1, $2)`, [moderator, NAME]), "px_forbidden");
    const o = await startOrder(await createUser("a"), { x: 100, y: 100, w: 10, h: 10 });
    await expectPgError(pool.query(`select public.px_edition_reset($1, $2)`, [boss, NAME]), "px_edition_not_empty"); // a hold
    await pool.query(`select public.px_cancel_order($1, null, 'canceled')`, [o.order_id]);
    await pool.query(`truncate public.parcels cascade`);
    await pool.query(`select public.px_edition_reset($1, $2)`, [boss, NAME]);
    expect(await edition()).toMatchObject({ status: "prelaunch", opens_at: null, closes_at: null });
    expect(await audit("edition.reset")).toHaveLength(1);
    await expectPgError(startOrder(await createUser("b"), { x: 100, y: 100, w: 10, h: 10 }), "px_edition_not_open");
  });

  it("refuses to reset after a payment, even if the parcel was revoked since (the money is still owed or kept)", async () => {
    const boss = await admin();
    const o = await startOrder(await createUser("a"), { x: 100, y: 100, w: 10, h: 10 });
    expect(await fulfill(o.order_id)).toBe("fulfilled");
    await pool.query(`update public.parcels set status = 'revoked' where id = $1`, [o.parcel_id]); // no longer reserved or active
    await expectPgError(pool.query(`select public.px_edition_reset($1, $2)`, [boss, NAME]), "px_edition_not_empty");
  });
});

/* ------------------------------------------------------------------------------------------------------------------ structure & rights */

describe("the structure keeps the rules even when the application is bypassed", () => {
  beforeEach(resetData);

  it("allows ONE edition for now: nothing can create a second one", async () => {
    await expectPgError(pool.query(`insert into public.editions (slug, name) values ('second', 'Second edition')`), /unique|editions_only_one/);
  });

  it("refuses an inconsistent row: dates without a state, an open edition without dates, a closing before the opening", async () => {
    await expectPgError(pool.query(`update public.editions set opens_at = null, closes_at = null`), "editions_dates"); // 'open' needs both
    await expectPgError(pool.query(`update public.editions set closes_at = opens_at - interval '1 day'`), "editions_dates");
    await expectPgError(pool.query(`update public.editions set status = 'prelaunch'`), "editions_dates"); // pre-launch has no dates
    await expectPgError(pool.query(`update public.editions set status = 'closed'`), "editions_dates"); // closed needs closed_at
  });

  it("gives every parcel its edition, whoever inserts it", async () => {
    const o = await startOrder(await createUser("a"), { x: 100, y: 100, w: 10, h: 10 });
    const e = await edition();
    expect((await pool.query(`select edition_id from public.parcels where id = $1`, [o.parcel_id])).rows[0].edition_id).toBe(e.id);
    const owner = await createUser("b");
    const { rows: [p] } = await pool.query(`insert into public.parcels (owner_id, x, y, w, h, status) values ($1, 500, 500, 10, 10, 'reserved') returning edition_id`, [owner]);
    expect(p.edition_id).toBe(e.id);
  });

  it("a purchase racing the closing: each one either succeeds or is refused as closed, never overlaps, and nothing is bought afterwards", async () => {
    const boss = await admin();
    const buyers = await Promise.all(Array.from({ length: 24 }, (_, i) => createUser(`racer${i}`)));
    const results = await Promise.allSettled([
      ...buyers.map((u, i) => startOrder(u, { x: 100 + i * 20, y: 100, w: 10, h: 10 })),
      (async () => { await new Promise((r) => setTimeout(r, 15)); await pool.query(`select public.px_edition_close_now($1, $2)`, [boss, NAME]); })(),
    ]);
    const started = results.slice(0, 24);
    for (const r of started) if (r.status === "rejected") expect(String((r.reason as Error).message)).toContain("px_edition_closed");
    const ok = started.filter((r) => r.status === "fulfilled").length;
    expect((await pool.query(`select count(*)::int n from public.orders`)).rows[0].n).toBe(ok);
    expect(await overlappingPairs()).toBe(0);
    await expectPgError(startOrder(await createUser("after"), { x: 3000, y: 100, w: 10, h: 10 }), "px_edition_closed");
    // the orders that did start can still be paid during the delay
    for (const r of started) if (r.status === "fulfilled") expect(await fulfill((r.value as { order_id: string }).order_id)).toBe("fulfilled");
  });

  it("is reachable from the server only: the browser roles can neither read the tables nor run the functions", async () => {
    const u = await createUser("visitor");
    for (const role of ["anon", "authenticated"] as const) {
      const id = role === "anon" ? null : u;
      await expectPgError(asRole(role, id, (c) => c.query(`select * from public.editions`)), "42501");
      await expectPgError(asRole(role, id, (c) => c.query(`select * from public.edition_snapshots`)), "42501");
      await expectPgError(asRole(role, id, (c) => c.query(`select public.px_edition_info()`)), "42501");
      await expectPgError(asRole(role, id, (c) => c.query(`select public.px_edition_open($1, 'x')`, [u])), "42501");
      await expectPgError(asRole(role, id, (c) => c.query(`select public.px_edition_sweep()`)), "42501");
    }
  });
});
