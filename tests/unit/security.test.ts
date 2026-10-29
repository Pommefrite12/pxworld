import { describe, expect, it } from "vitest";
import { cleanText } from "@/lib/security/text";
import { sanitizeExternalUrl } from "@/lib/security/url";

describe("sanitizeExternalUrl", () => {
  it("accepts plain https URLs", () => {
    expect(sanitizeExternalUrl("https://example.com/path?q=1#frag")).toBe("https://example.com/path?q=1");
    expect(sanitizeExternalUrl("  https://sub.example.org  ")).toBe("https://sub.example.org/");
  });
  it.each([
    "http://example.com", "javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://example.com", "//example.com",
    "https://user:pass@example.com", "https://127.0.0.1/", "https://[::1]/", "https://192.168.0.1/", "https://localhost/",
    "https://intranet/", "https://example.com:8443/", "https://printer.local/", "", "not a url",
    "https://example.com/" + "a".repeat(600),
  ])("rejects %s", (u) => expect(sanitizeExternalUrl(u)).toBeNull());
  it("rejects non-strings", () => expect(sanitizeExternalUrl(42)).toBeNull());
});

describe("cleanText", () => {
  it("strips control and bidi characters and collapses whitespace", () => {
    expect(cleanText("  hello‮   wor\u0000ld \n x ", 50)).toBe("hello wor ld x");
  });
  it("truncates and returns null for empty", () => {
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText("   ", 10)).toBeNull();
    expect(cleanText(12, 10)).toBeNull();
  });
  it("leaves markup as inert text (React escapes at render time)", () => {
    expect(cleanText("<script>alert(1)</script>", 100)).toBe("<script>alert(1)</script>");
  });
});
