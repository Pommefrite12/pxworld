import { describe, expect, it } from "vitest";
import { isLocalDatabase } from "../../scripts/db-local.mjs";
import { shouldUseSsl } from "@/lib/db/ssl";

describe("which databases the dev start-up may migrate", () => {
  it("only the developer's own: localhost, loopback, a bare compose service name", () => {
    for (const url of [
      "postgres://pixel:pixel@127.0.0.1:54329/pixelworld",
      "postgres://pixel:pixel@localhost:5432/pixelworld",
      "postgres://pixel:pixel@db:5432/pixelworld", // the Codespace / Docker Compose database
      "postgres://pixel:pixel@[::1]:5432/pixelworld",
    ]) expect(isLocalDatabase(url), url).toBe(true);
  });

  it("never a remote one, whatever its name looks like", () => {
    for (const url of [
      "postgres://postgres:secret@db.abcdefghij.supabase.co:5432/postgres",
      "postgres://postgres.abcdefghij:secret@aws-0-eu-west-3.pooler.supabase.com:6543/postgres",
      "postgres://u:p@203.0.113.7:5432/x",
      "postgres://u:p@example.org/x",
    ]) expect(isLocalDatabase(url), url).toBe(false);
  });

  it("is not fooled by something that is not a URL", () => {
    expect(isLocalDatabase("")).toBe(false);
    expect(isLocalDatabase("not a url")).toBe(false);
  });

  it("agrees with the rule that decides whether the app talks TLS to the database (one definition of 'local')", () => {
    for (const url of ["postgres://a:b@127.0.0.1/x", "postgres://a:b@db/x", "postgres://a:b@db.xyz.supabase.co/x", "postgres://a:b@203.0.113.7/x"]) {
      expect(isLocalDatabase(url), url).toBe(!shouldUseSsl(url));
    }
  });
});
