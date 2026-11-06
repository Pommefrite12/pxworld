import { describe, expect, it } from "vitest";
import { configProblems, vercelRegionOfDatabase } from "@/lib/config-check";

const GOOD = {
  NEXT_PUBLIC_SITE_URL: "https://pixelworld.example", DATABASE_URL: "postgres://u:p@db.example:6543/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  RATE_LIMIT_SALT: "a-long-random-value-that-nobody-guesses", CRON_SECRET: "cron", STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_1",
  NEXT_PUBLIC_OPERATOR_NAME: "X", NEXT_PUBLIC_OPERATOR_ADDRESS: "Y", NEXT_PUBLIC_OPERATOR_REGISTRATION: "Z", NEXT_PUBLIC_OPERATOR_VAT: "V", NEXT_PUBLIC_CONTACT_EMAIL: "a@b.example",
};
const keys = (v: Record<string, string | undefined>, level?: "error" | "warn") => configProblems(v).filter((p) => !level || p.level === level).map((p) => p.key);

describe("the production configuration check", () => {
  it("has nothing to say about a complete, test-mode configuration", () => {
    expect(configProblems(GOOD)).toEqual([]);
  });
  it("stops a deployment that still points to a local machine or is not https", () => {
    expect(keys({ ...GOOD, NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, "error")).toEqual(["NEXT_PUBLIC_SITE_URL"]);
    expect(keys({ ...GOOD, NEXT_PUBLIC_SITE_URL: "http://pixelworld.example" }, "error")).toEqual(["NEXT_PUBLIC_SITE_URL"]);
    expect(keys({ ...GOOD, NEXT_PUBLIC_SITE_URL: undefined }, "error")).toEqual(["NEXT_PUBLIC_SITE_URL"]);
  });
  it("requires the database, Supabase auth and storage", () => {
    expect(keys({ ...GOOD, DATABASE_URL: undefined }, "error")).toEqual(["DATABASE_URL"]);
    expect(keys({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }, "error")).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(keys({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: undefined }, "error")).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
  });
  it("refuses the salt of the address hashes when it is the public default, a placeholder or short", () => {
    for (const bad of [undefined, "", "change-me", "pixel-world-dev-salt", "CHANGE-ME", "short"]) expect(keys({ ...GOOD, RATE_LIMIT_SALT: bad }, "error"), String(bad)).toEqual(["RATE_LIMIT_SALT"]);
  });
  it("warns, without blocking, when the maintenance secret is missing", () => {
    expect(configProblems({ ...GOOD, CRON_SECRET: undefined }).map((p) => [p.level, p.key])).toEqual([["warn", "CRON_SECRET"]]);
  });
  it("checks the payment keys: shape, webhook secret, and the approval needed for live keys", () => {
    expect(keys({ ...GOOD, STRIPE_SECRET_KEY: "nope" }, "error")).toEqual(["STRIPE_SECRET_KEY"]);
    expect(keys({ ...GOOD, STRIPE_WEBHOOK_SECRET: undefined }, "error")).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(keys({ ...GOOD, STRIPE_SECRET_KEY: "sk_live_1" }, "error")).toEqual(["STRIPE_SECRET_KEY"]);
    const live = configProblems({ ...GOOD, STRIPE_SECRET_KEY: "sk_live_1", PAYMENTS_LIVE_ENABLED: "yes-i-have-approval" });
    expect(live.map((p) => [p.level, p.key])).toEqual([["warn", "PAYMENTS_LIVE_ENABLED"]]); // real payments are never silent
    expect(configProblems({ ...GOOD, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }).map((p) => [p.level, p.key])).toEqual([["warn", "STRIPE_SECRET_KEY"]]);
  });
  it("warns about development variables left in production", () => {
    expect(keys({ ...GOOD, DEV_AUTH: "true", STRIPE_MOCK: "true", LOCAL_STORAGE_DIR: ".data" }, "warn").sort()).toEqual(["DEV_AUTH", "LOCAL_STORAGE_DIR", "STRIPE_MOCK"]);
  });
  it("warns about an incomplete seller identity, naming what is missing", () => {
    const w = configProblems({ ...GOOD, NEXT_PUBLIC_OPERATOR_VAT: undefined, NEXT_PUBLIC_CONTACT_EMAIL: undefined });
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain("vat");
    expect(w[0]!.message).toContain("contact e-mail");
  });
  it("needs an https address for the alerts", () => {
    expect(keys({ ...GOOD, ALERT_WEBHOOK_URL: "http://hook.example" }, "error")).toEqual(["ALERT_WEBHOOK_URL"]);
    expect(configProblems({ ...GOOD, ALERT_WEBHOOK_URL: "https://hooks.example/x" })).toEqual([]);
  });
  it("warns when SSL is off for a database that is not local, and not for one that is", () => {
    expect(keys({ ...GOOD, DATABASE_SSL: "false" }, "warn")).toEqual(["DATABASE_SSL"]);
    expect(keys({ ...GOOD, DATABASE_SSL: "false", DATABASE_URL: "postgres://u:p@localhost:5432/x" }, "warn")).toEqual([]);
    expect(keys({ ...GOOD, DATABASE_SSL: "false", DATABASE_URL: "postgres://u:p@db:5432/x" }, "warn")).toEqual([]); // a bare Docker service name
  });
  it("never repeats a value, only names", () => {
    const text = JSON.stringify(configProblems({ ...GOOD, RATE_LIMIT_SALT: "change-me", STRIPE_SECRET_KEY: "sk_live_SECRETVALUE" }));
    expect(text).not.toContain("SECRETVALUE");
    expect(text).not.toContain("postgres://");
  });
  it("reminds that a test country is set, and refuses it next to a live key", () => {
    expect(configProblems({ ...GOOD, TEST_COUNTRY: "US" }).map((p) => [p.level, p.key])).toEqual([["warn", "TEST_COUNTRY"]]);
    const live = configProblems({ ...GOOD, TEST_COUNTRY: "US", STRIPE_SECRET_KEY: "sk_live_1", PAYMENTS_LIVE_ENABLED: "yes-i-have-approval" });
    expect(live.map((p) => [p.level, p.key])).toContainEqual(["error", "TEST_COUNTRY"]);
  });
  it("catches the mistakes people make when pasting a value into a dashboard", () => {
    const e = (over: Record<string, string>) => configProblems({ ...GOOD, ...over }).filter((p) => p.level === "error");
    // the name pasted with the value (what the Supabase "Connect" box shows)
    expect(e({ NEXT_PUBLIC_SUPABASE_URL: "NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co" }).map((p) => p.key)).toContain("NEXT_PUBLIC_SUPABASE_URL");
    // quotes, a trailing space, a line break
    expect(e({ NEXT_PUBLIC_SUPABASE_URL: '"https://abc.supabase.co"' })[0]!.message).toContain("quotation");
    expect(e({ CRON_SECRET: "abc " })[0]!.message).toContain("space");
    expect(e({ STRIPE_SECRET_KEY: "sk_test_123\n" })[0]!.key).toBe("STRIPE_SECRET_KEY");
    // a value that is not a URL at all, or not https
    expect(e({ NEXT_PUBLIC_SUPABASE_URL: "abc.supabase.co" })[0]!.message).toContain("not a valid URL");
    expect(e({ NEXT_PUBLIC_SUPABASE_URL: "http://abc.supabase.co" })[0]!.message).toContain("https://");
  });
  it("catches a database address that still holds its placeholder, or is not an address", () => {
    expect(configProblems({ ...GOOD, DATABASE_URL: "postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-eu.pooler.supabase.com:6543/postgres" }).map((p) => [p.level, p.key, p.message.includes("YOUR-PASSWORD")])).toEqual([["error", "DATABASE_URL", true]]);
    expect(configProblems({ ...GOOD, DATABASE_URL: "aws-0-eu.pooler.supabase.com" }).map((p) => p.key)).toEqual(["DATABASE_URL"]);
    expect(configProblems({ ...GOOD, DATABASE_URL: "postgresql://postgres.abc:pw@aws-0-eu.pooler.supabase.com:5432/postgres" }).map((p) => [p.level, p.message.includes("6543")])).toEqual([["warn", true]]);
    expect(configProblems({ ...GOOD, DATABASE_URL: "postgresql://postgres.abc:pw@aws-0-eu.pooler.supabase.com:6543/postgres" })).toEqual([]);
  });
  it("catches the two Supabase keys swapped, above all a secret key sent to every browser", () => {
    expect(configProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc" }).map((p) => [p.level, p.key])).toEqual([["error", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]]);
    expect(configProblems({ ...GOOD, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_abc" }).map((p) => [p.level, p.key])).toEqual([["error", "SUPABASE_SERVICE_ROLE_KEY"]]);
    expect(configProblems({ ...GOOD, NEXT_PUBLIC_SUPABASE_URL: "https://shop.example.com" }).map((p) => [p.level, p.key])).toEqual([["warn", "NEXT_PUBLIC_SUPABASE_URL"]]);
  });
  it("tells that the variables of the old countdown story do nothing any more, whatever their value", () => {
    for (const k of ["NEXT_PUBLIC_WORLD_END_AT", "NEXT_PUBLIC_STORY_PREVIEW"]) {
      for (const value of ["2027-02-11T12:00:00+01:00", "J-40", "next spring"]) {
        const p = configProblems({ ...GOOD, [k]: value });
        expect(p.map((x) => [x.level, x.key]), `${k}=${value}`).toEqual([["warn", k]]);
        expect(p[0]!.message).toContain("no longer used");
      }
      expect(configProblems({ ...GOOD, [k]: "" })).toEqual([]); // empty: not there
    }
  });
});

describe("the region of the functions", () => {
  const db = "postgresql://postgres.abcd:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres";
  it("knows the Vercel region that sits next to a Supabase region", () => {
    expect(vercelRegionOfDatabase(db)).toEqual({ aws: "eu-central-1", vercel: "fra1" });
    expect(vercelRegionOfDatabase("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres")?.vercel).toBe("iad1");
    expect(vercelRegionOfDatabase("postgres://u:p@db.example:6543/postgres")).toBeNull();
    expect(vercelRegionOfDatabase(undefined)).toBeNull();
  });
  it("warns when the functions run far from the database, and says what to do", () => {
    const far = configProblems({ ...GOOD, DATABASE_URL: db, VERCEL_REGION: "iad1" }).find((p) => p.key === "VERCEL_REGION");
    expect(far?.level).toBe("warn");
    expect(far?.message).toContain('"regions": ["fra1"]');
  });
  it("says nothing when they are next to it, when the region is unknown (a local machine) or the database is elsewhere", () => {
    expect(configProblems({ ...GOOD, DATABASE_URL: db, VERCEL_REGION: "fra1" }).some((p) => p.key === "VERCEL_REGION")).toBe(false);
    expect(configProblems({ ...GOOD, DATABASE_URL: db }).some((p) => p.key === "VERCEL_REGION")).toBe(false);
    expect(configProblems({ ...GOOD, VERCEL_REGION: "iad1" }).some((p) => p.key === "VERCEL_REGION")).toBe(false);
  });
});
