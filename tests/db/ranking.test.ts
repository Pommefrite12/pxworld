import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CREATIONS_RANKING_SQL, CREATORS_RANKING_SQL, RANKING_SIZE, type RankedCreation, type RankedCreator } from "@/lib/ranking";
import { closeDb, createUser, fulfill, pool, resetData, startOrder } from "./helpers";

afterAll(closeDb);
beforeEach(resetData);

let mod = "";
let n = 0;
/** A published creation: a paid 5 × 5 parcel whose creation a moderator approved. Returns the parcel id and its public code. */
async function published(owner: string) {
  if (!mod) mod = await createUser("ranker-mod", { role: "moderator" });
  const o = await startOrder(owner, { x: 100 + (n++ % 200) * 10, y: 100 + Math.floor(n / 200) * 10, w: 5, h: 5 });
  expect(await fulfill(o.order_id)).toBe("fulfilled");
  const { rows: [a] } = await pool.query(`select * from public.px_add_asset($1, $2, $3, 'abcdef', 5, 5, 10, '#112233', $4, null, null, false)`, [owner, o.parcel_id, `creations/${o.parcel_id}.png`, `Creation ${n}`]);
  await pool.query(`select public.px_review_asset($1, $2, 'approve')`, [mod, a.id]);
  const { rows: [p] } = await pool.query(`select code from public.parcels where id = $1`, [o.parcel_id]);
  return { id: o.parcel_id as string, code: p.code as string };
}
const like = (user: string, parcel: string, daysAgo = 0) =>
  pool.query(`insert into public.parcel_likes (user_id, parcel_id, created_at) values ($1, $2, now() - make_interval(days => $3))`, [user, parcel, daysAgo]);
const fans = async (count: number) => Promise.all(Array.from({ length: count }, (_, i) => createUser(`fan${i}`)));
const creations = async (days: number | null = null) => (await pool.query(CREATIONS_RANKING_SQL, [days])).rows as RankedCreation[];
const creators = async (days: number | null = null) => (await pool.query(CREATORS_RANKING_SQL, [days])).rows as RankedCreator[];

describe("the ranking of the creations", () => {
  it("is ordered by the number of likes; ties share a rank (1, 2, 2, 4) and the earlier published comes first; nothing without a like", async () => {
    const [a, b, c, d, e] = [await createUser("a"), await createUser("b"), await createUser("c"), await createUser("d"), await createUser("e")];
    const [pa, pb, pc, pd] = [await published(a), await published(b), await published(c), await published(d)];
    await published(e); // no like at all: not in the ranking
    const f = await fans(5);
    for (const u of f.slice(0, 5)) await like(u, pa.id);   // 5
    for (const u of f.slice(0, 3)) await like(u, pb.id);   // 3
    for (const u of f.slice(0, 3)) await like(u, pc.id);   // 3 (tie with b)
    await like(f[0]!, pd.id);                              // 1
    const r = await creations();
    expect(r.map((x) => [x.code, x.likes, x.rank])).toEqual([[pa.code, 5, 1], [pb.code, 3, 2], [pc.code, 3, 2], [pd.code, 1, 4]]);
    expect(r[1]!.username).toBe(await name(b)); // b published before c: first among the equals
    expect(r[0]).toMatchObject({ w: 5, h: 5, area: 25 });
    expect(r[0]!.asset_id).toBeTruthy();
  });

  it("does not count the owner's own like, nor a like from a suspended or deleted account", async () => {
    const [owner, other] = [await createUser("owner"), await createUser("other")];
    const mine = await published(owner), theirs = await published(other);
    const f = await fans(4);
    await like(owner, mine.id);                                   // self-like: ignored
    await like(f[0]!, mine.id);                                   // counts
    await like(f[1]!, mine.id);                                   // suspended below
    await like(f[2]!, mine.id);                                   // deleted below
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [f[1]]);
    await pool.query(`update public.profiles set deleted_at = now() where id = $1`, [f[2]]);
    await like(f[3]!, theirs.id);
    await like(f[0]!, theirs.id);
    const r = await creations();
    expect(r.map((x) => [x.code, x.likes])).toEqual([[theirs.code, 2], [mine.code, 1]]);
    // a creation that only has its owner's like is not ranked at all
    const lonely = await published(await createUser("lonely"));
    await like((await pool.query(`select owner_id from public.parcels where id = $1`, [lonely.id])).rows[0].owner_id, lonely.id);
    expect((await creations()).map((x) => x.code)).not.toContain(lonely.code);
  });

  it("shows only what the public can see: not a hidden parcel, not a revoked one, not an owner who is suspended", async () => {
    const [a, b, c, d] = [await createUser("a2"), await createUser("b2"), await createUser("c2"), await createUser("d2")];
    const [pa, pb, pc, pd] = [await published(a), await published(b), await published(c), await published(d)];
    const f = await fans(2);
    for (const p of [pa, pb, pc, pd]) for (const u of f) await like(u, p.id);
    await pool.query(`update public.parcels set hidden_at = now() where id = $1`, [pa.id]);
    await pool.query(`update public.parcels set status = 'revoked' where id = $1`, [pb.id]);
    await pool.query(`update public.profiles set status = 'suspended' where id = $1`, [c]);
    expect((await creations()).map((x) => x.code)).toEqual([pd.code]);
    expect((await creators()).map((x) => x.username)).toEqual([await name(d)]);
  });

  it("counts the likes of the last week, the last month, or all of them", async () => {
    const [a, b] = [await createUser("a3"), await createUser("b3")];
    const [pa, pb] = [await published(a), await published(b)];
    const f = await fans(6);
    // a: 4 old likes (60 days ago) ; b: 2 recent likes (2 days ago) and one from 20 days ago
    for (const u of f.slice(0, 4)) await like(u, pa.id, 60);
    for (const u of f.slice(0, 2)) await like(u, pb.id, 2);
    await like(f[2]!, pb.id, 20);
    expect((await creations()).map((x) => [x.code, x.likes])).toEqual([[pa.code, 4], [pb.code, 3]]);       // all time: a leads
    expect((await creations(30)).map((x) => [x.code, x.likes])).toEqual([[pb.code, 3]]);                   // this month: only b, with 3
    expect((await creations(7)).map((x) => [x.code, x.likes])).toEqual([[pb.code, 2]]);                    // this week: b, with 2
    expect(await creations(1)).toEqual([]);
  });

  it("keeps the first 50 only", async () => {
    const f = await fans(1);
    for (let i = 0; i < RANKING_SIZE + 5; i++) await like(f[0]!, (await published(await createUser(`bulk${i}`))).id);
    expect(await creations()).toHaveLength(RANKING_SIZE);
  }, 120_000);
});

describe("the ranking of the creators", () => {
  it("adds up the likes of all their creations, shows their best one, and ranks ties together", async () => {
    const [prolific, star, twin] = [await createUser("prolific"), await createUser("star"), await createUser("twin")];
    const [p1, p2, p3] = [await published(prolific), await published(prolific), await published(prolific)];
    const s1 = await published(star);
    const t1 = await published(twin);
    const f = await fans(5);
    for (const u of f.slice(0, 2)) await like(u, p1.id);          // 2
    for (const u of f.slice(0, 3)) await like(u, p2.id);          // 3
    await like(f[0]!, p3.id);                                     // 1   → prolific: 6 likes on 3 creations
    for (const u of f.slice(0, 5)) await like(u, s1.id);          // star: 5 likes on 1 creation
    for (const u of f.slice(0, 5)) await like(u, t1.id);          // twin: 5 as well
    await like(prolific, p1.id);                                  // the owner's own like: ignored
    const r = await creators();
    expect(r.map((x) => [x.username, x.likes, x.parcels, x.rank])).toEqual([
      [await name(prolific), 6, 3, 1],
      [await name(star), 5, 1, 2],
      [await name(twin), 5, 1, 2],
    ]);
    expect(r[0]!.top_code).toBe(p2.code); // the best creation of the leader
    expect(r[1]!.top_code).toBe(s1.code);
    expect(r[0]!.top_asset_id).toBeTruthy();
  });

  it("follows the period too", async () => {
    const [a, b] = [await createUser("a4"), await createUser("b4")];
    const [pa, pb] = [await published(a), await published(b)];
    const f = await fans(3);
    for (const u of f) await like(u, pa.id, 90);
    await like(f[0]!, pb.id, 1);
    expect((await creators()).map((x) => x.likes)).toEqual([3, 1]);
    expect((await creators(7)).map((x) => [x.username, x.likes])).toEqual([[await name(b), 1]]);
  });
});

const name = async (id: string) => (await pool.query(`select username from public.profiles where id = $1`, [id])).rows[0].username as string;
