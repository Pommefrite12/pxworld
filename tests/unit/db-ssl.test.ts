import { describe, expect, it } from "vitest";
import { shouldUseSsl } from "@/lib/db/ssl";

describe("database TLS choice", () => {
  it("is off for local development databases, including the bare Docker/Codespaces service name", () => {
    for (const u of ["postgres://p:p@127.0.0.1:54329/x", "postgres://p:p@localhost/x", "postgres://p:p@db:5432/pixelworld", "postgres://p:p@[::1]:5432/x"]) {
      expect(shouldUseSsl(u), u).toBe(false);
    }
  });
  it("is on for managed databases reached through a public host name", () => {
    for (const u of ["postgres://p:p@db.abcdef.supabase.co:5432/postgres", "postgres://p:p@aws-0-eu.pooler.supabase.com:6543/postgres"]) {
      expect(shouldUseSsl(u), u).toBe(true);
    }
  });
  it("DATABASE_SSL overrides the guess either way", () => {
    expect(shouldUseSsl("postgres://p:p@db:5432/x", "true")).toBe(true);
    expect(shouldUseSsl("postgres://p:p@db.abc.supabase.co/x", "false")).toBe(false);
  });
});
