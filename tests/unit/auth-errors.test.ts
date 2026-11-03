import { describe, expect, it } from "vitest";
import { classifyAuthError } from "@/lib/auth/errors";

describe("what Supabase Auth refused, in words a visitor can act on", () => {
  it("recognises an account that already exists", () => {
    for (const e of [{ code: "user_already_exists" }, { code: "email_exists" }, { message: "User already registered" }]) expect(classifyAuthError(e).key).toBe("exists");
  });
  it("tells a visitor who tried too often to wait (the free e-mail service sends only a few messages an hour)", () => {
    for (const e of [{ code: "over_email_send_rate_limit", status: 429 }, { code: "over_request_rate_limit" }, { status: 429 }, { message: "email rate limit exceeded" }]) expect(classifyAuthError(e).key).toBe("rateLimit");
  });
  it("tells apart an unusable e-mail, a weak password, an unconfirmed e-mail, closed sign-ups and wrong credentials", () => {
    expect(classifyAuthError({ code: "email_address_invalid" }).key).toBe("invalidEmail");
    expect(classifyAuthError({ code: "weak_password" }).key).toBe("weakPassword");
    expect(classifyAuthError({ code: "email_not_confirmed" }).key).toBe("notConfirmed");
    expect(classifyAuthError({ code: "signup_disabled" }).key).toBe("signupDisabled");
    expect(classifyAuthError({ code: "email_provider_disabled" }).key).toBe("signupDisabled");
    expect(classifyAuthError({ code: "invalid_credentials", status: 400 }).key).toBe("invalidCredentials");
  });
  it("recognises a network failure", () => {
    expect(classifyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }).key).toBe("network");
    expect(classifyAuthError({ message: "fetch failed", status: 0 }).key).toBe("network");
  });
  it("keeps the code of an error nobody anticipated, so that it can be reported", () => {
    expect(classifyAuthError({ code: "unexpected_failure", message: "Database error saving new user", status: 500 })).toEqual({ key: "generic", detail: "unexpected_failure" });
    expect(classifyAuthError({ status: 500 })).toEqual({ key: "generic", detail: "HTTP 500" });
    expect(classifyAuthError({})).toEqual({ key: "generic", detail: null });
  });
});
