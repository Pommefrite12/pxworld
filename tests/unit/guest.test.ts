import { describe, expect, it } from "vitest";
import { maskEmail, normalizeEmail } from "@/lib/auth/guest";
import { orderToken, verifyOrderToken } from "@/lib/stripe/orderToken";

describe("e-mail of a buyer without an account", () => {
  it("is trimmed and lower-cased, so the same person always lands on the same account", () => {
    expect(normalizeEmail("  Guest.Buyer@Example.TEST ")).toBe("guest.buyer@example.test");
    expect(normalizeEmail("a+tag@example.co.uk")).toBe("a+tag@example.co.uk");
  });

  it("refuses what is not an address, and anything absurdly long", () => {
    for (const bad of [undefined, null, 42, "", " ", "nobody", "a@b", "@example.test", "a@", "x y@example.test", "a@@example.test", `${"a".repeat(250)}@example.test`]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull();
    }
  });

  it("is masked before it is shown or logged: enough to recognise, not to read", () => {
    expect(maskEmail("guest.buyer@example.test")).toBe("gu•••@ex•••.test");
    expect(maskEmail("a@b.io")).toBe("a•••@b•••.io");
    expect(maskEmail("weird")).not.toContain("weird@");
  });
});

describe("the signed link of an order", () => {
  const id = "3f2b8c1e-8d0a-4f4e-9d52-6a1f3c0b7e11";

  it("is a stable 32-hex token per order", () => {
    expect(orderToken(id)).toMatch(/^[0-9a-f]{32}$/);
    expect(orderToken(id)).toBe(orderToken(id));
    expect(orderToken(id)).not.toBe(orderToken("3f2b8c1e-8d0a-4f4e-9d52-6a1f3c0b7e12"));
  });

  it("verifies only its own order, and nothing malformed", () => {
    const t = orderToken(id);
    expect(verifyOrderToken(id, t)).toBe(true);
    expect(verifyOrderToken("3f2b8c1e-8d0a-4f4e-9d52-6a1f3c0b7e12", t)).toBe(false); // another order
    for (const bad of [undefined, null, "", "0".repeat(32), t.slice(1), `${t}0`, t.toUpperCase(), "not a token"]) {
      expect(verifyOrderToken(id, bad), String(bad)).toBe(false);
    }
  });
});
