import { describe, expect, it } from "vitest";
import { configProblems } from "@/lib/config-check";

const NOW = Date.UTC(2026, 10, 3);
const GOOD = {
  NEXT_PUBLIC_SITE_URL: "https://pixelworld.example", DATABASE_URL: "postgres://u:p@db.example:6543/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  RATE_LIMIT_SALT: "a-long-random-value-that-nobody-guesses", CRON_SECRET: "cron", STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: "whsec_1",
  NEXT_PUBLIC_OPERATOR_NAME: "X", NEXT_PUBLIC_OPERATOR_ADDRESS: "Y", NEXT_PUBLIC_OPERATOR_REGISTRATION: "Z", NEXT_PUBLIC_OPERATOR_VAT: "V", NEXT_PUBLIC_CONTACT_EMAIL: "a@b.example",
};
const keys = (v: Record<string, string | undefined>, level?: "error" | "warn") => configProblems(v, NOW).filter((p) => !level || p.level === level).map((p) => p.key);

describe("the production configuration check", () => {
  it("has nothing to say about a complete, test-mode configuration", () => {
    expect(configProblems(GOOD, NOW)).toEqual([]);
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
    expect(configProblems({ ...GOOD, CRON_SECRET: undefined }, NOW).map((p) => [p.level, p.key])).toEqual([["warn", "CRON_SECRET"]]);
  });
  it("checks the payment keys: shape, webhook secret, and the approval needed for live keys", () => {
    expect(keys({ ...GOOD, STRIPE_SECRET_KEY: "nope" }, "error")).toEqual(["STRIPE_SECRET_KEY"]);
    expect(keys({ ...GOOD, STRIPE_WEBHOOK_SECRET: undefined }, "error")).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(keys({ ...GOOD, STRIPE_SECRET_KEY: "sk_live_1" }, "error")).toEqual(["STRIPE_SECRET_KEY"]);
    const live = configProblems({ ...GOOD, STRIPE_SECRET_KEY: "sk_live_1", PAYMENTS_LIVE_ENABLED: "yes-i-have-approval" }, NOW);
    expect(live.map((p) => [p.level, p.key])).toEqual([["warn", "PAYMENTS_LIVE_ENABLED"]]); // real payments are never silent
    expect(configProblems({ ...GOOD, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined }, NOW).map((p) => [p.level, p.key])).toEqual([["warn", "STRIPE_SECRET_KEY"]]);
  });
  it("warns about development variables left in production", () => {
    expect(keys({ ...GOOD, DEV_AUTH: "true", STRIPE_MOCK: "true", LOCAL_STORAGE_DIR: ".data" }, "warn").sort()).toEqual(["DEV_AUTH", "LOCAL_STORAGE_DIR", "STRIPE_MOCK"]);
  });
  it("warns about an incomplete seller identity, naming what is missing", () => {
    const w = configProblems({ ...GOOD, NEXT_PUBLIC_OPERATOR_VAT: undefined, NEXT_PUBLIC_CONTACT_EMAIL: undefined }, NOW);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain("vat");
    expect(w[0]!.message).toContain("contact e-mail");
  });
  it("catches an end date that is not a date, and one that is already past (the shop would be closed for good)", () => {
    expect(keys({ ...GOOD, NEXT_PUBLIC_WORLD_END_AT: "next spring" }, "error")).toEqual(["NEXT_PUBLIC_WORLD_END_AT"]);
    expect(keys({ ...GOOD, NEXT_PUBLIC_WORLD_END_AT: "2026-01-01T00:00:00Z" }, "warn")).toEqual(["NEXT_PUBLIC_WORLD_END_AT"]);
    expect(configProblems({ ...GOOD, NEXT_PUBLIC_WORLD_END_AT: "2027-02-11T12:00:00+01:00" }, NOW)).toEqual([]);
    expect(configProblems({ ...GOOD, NEXT_PUBLIC_WORLD_END_AT: "" }, NOW)).toEqual([]);
  });
  it("needs an https address for the alerts", () => {
    expect(keys({ ...GOOD, ALERT_WEBHOOK_URL: "http://hook.example" }, "error")).toEqual(["ALERT_WEBHOOK_URL"]);
    expect(configProblems({ ...GOOD, ALERT_WEBHOOK_URL: "https://hooks.example/x" }, NOW)).toEqual([]);
  });
  it("warns when SSL is off for a database that is not local, and not for one that is", () => {
    expect(keys({ ...GOOD, DATABASE_SSL: "false" }, "warn")).toEqual(["DATABASE_SSL"]);
    expect(keys({ ...GOOD, DATABASE_SSL: "false", DATABASE_URL: "postgres://u:p@localhost:5432/x" }, "warn")).toEqual([]);
    expect(keys({ ...GOOD, DATABASE_SSL: "false", DATABASE_URL: "postgres://u:p@db:5432/x" }, "warn")).toEqual([]); // a bare Docker service name
  });
  it("never repeats a value, only names", () => {
    const text = JSON.stringify(configProblems({ ...GOOD, RATE_LIMIT_SALT: "change-me", STRIPE_SECRET_KEY: "sk_live_SECRETVALUE" }, NOW));
    expect(text).not.toContain("SECRETVALUE");
    expect(text).not.toContain("postgres://");
  });
});
