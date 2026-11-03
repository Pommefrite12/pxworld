import { describe, expect, it } from "vitest";
import { ART_STYLES } from "@/lib/demo/art";
import { ANCHORS, demoGuard, demoPlan, type GuardInput } from "@/lib/demo/plan";
import { USERNAME_RE, TITLE_MAX, isValidTitle } from "@/lib/security/text";

describe("the plan of the demonstration data", () => {
  const plan = demoPlan(50, 1);
  it("has the number of accounts asked for, each clearly marked as a demonstration one", () => {
    expect(plan).toHaveLength(50);
    for (const p of plan) { expect(p.username).toMatch(/^demo_/); expect(p.username).toMatch(USERNAME_RE); expect(p.emailLocal).toMatch(/^demo-\d{3}$/); }
    expect(new Set(plan.map((p) => p.username)).size).toBe(50);
    expect(new Set(plan.map((p) => p.emailLocal)).size).toBe(50);
  });
  it("keeps names unique and valid even for a very large plan", () => {
    const big = demoPlan(500, 3);
    expect(new Set(big.map((p) => p.username)).size).toBe(500);
    for (const p of big) { expect(p.username).toMatch(USERNAME_RE); expect(isValidTitle(p.title)).toBe(true); expect([...p.title].length).toBeLessThanOrEqual(TITLE_MAX); }
  });
  it("gives every creation a valid title and says in its description that it is a demonstration", () => {
    for (const p of plan) { expect(isValidTitle(p.title)).toBe(true); expect(p.description.length).toBeLessThanOrEqual(280); expect(p.description.toLowerCase()).toMatch(/d[ée]mo|exemple/); }
  });
  it("makes big parcels, within what a parcel can be, so that they show on a world map", () => {
    for (const p of plan) { expect(p.w).toBeGreaterThanOrEqual(60); expect(p.h).toBeGreaterThanOrEqual(60); expect(p.w).toBeLessThanOrEqual(400); expect(p.h).toBeLessThanOrEqual(400); expect(p.w * p.h).toBeLessThanOrEqual(250_000); }
    const mean = plan.reduce((s, p) => s + p.w * p.h, 0) / plan.length;
    expect(mean).toBeGreaterThan(20_000);
  });
  it("uses every style and spreads over the world", () => {
    expect(new Set(plan.map((p) => p.style))).toEqual(new Set(ART_STYLES));
    expect(new Set(plan.map((p) => p.anchor.country)).size).toBeGreaterThan(15);
    expect(ANCHORS.every((a) => Math.abs(a.lat) < 80 && Math.abs(a.lon) <= 180 && /^[A-Z]{2}$/.test(a.country))).toBe(true);
  });
  it("is deterministic, and another seed gives another plan", () => {
    expect(demoPlan(50, 1)).toEqual(plan);
    expect(demoPlan(50, 2).map((p) => p.title)).not.toEqual(plan.map((p) => p.title));
  });
});

describe("the guards: when the tool must refuse", () => {
  const ok: GuardInput = { mode: "local", dbHost: "127.0.0.1", confirmed: true, liveEvents: 0 };
  const supa: GuardInput = { mode: "supabase", dbHost: "aws-0-eu.pooler.supabase.com", confirmed: true, liveEvents: 0, supabaseUrl: "https://abcd1234.supabase.co", project: "abcd1234" };
  it("lets a confirmed local test database and a confirmed Supabase test project through", () => {
    expect(demoGuard(ok)).toEqual([]);
    expect(demoGuard(supa)).toEqual([]);
    expect(demoGuard({ ...ok, dbHost: "db" })).toEqual([]); // the bare Docker / Codespaces service name
  });
  it("refuses without the explicit confirmation", () => {
    expect(demoGuard({ ...ok, confirmed: false }).join(" ")).toContain("--i-know-this-is-a-test-site");
  });
  it("refuses next to real payments: a live key, a restricted live key, the live-payments switch, or real-money events in the database", () => {
    for (const stripeKey of ["sk_live_123", "rk_live_123"]) expect(demoGuard({ ...supa, stripeKey }).join(" ")).toContain("real payments");
    expect(demoGuard({ ...supa, paymentsLive: "yes-i-have-approval" }).join(" ")).toContain("real payments");
    expect(demoGuard({ ...supa, stripeKey: "sk_test_123" })).toEqual([]);
    expect(demoGuard({ ...supa, liveEvents: 3 }).join(" ")).toContain("3 payment event");
  });
  it("refuses a database that is not on this machine when no Supabase project is configured to check it against", () => {
    expect(demoGuard({ ...ok, dbHost: "db.somewhere.example" }).join(" ")).toContain("not on this machine");
  });
  it("needs the id of the Supabase project, and the right one", () => {
    expect(demoGuard({ ...supa, project: undefined }).join(" ")).toContain("--project abcd1234");
    expect(demoGuard({ ...supa, project: "zzzz" }).join(" ")).toContain("not the project this environment points to");
    expect(demoGuard({ ...supa, supabaseUrl: "not a url" }).join(" ")).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });
  it("lists every reason at once", () => {
    expect(demoGuard({ ...supa, confirmed: false, stripeKey: "sk_live_1", project: "zzzz", liveEvents: 1 }).length).toBe(4);
  });
});
