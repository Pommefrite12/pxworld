import { describe, expect, it } from "vitest";
import { isAllowedOrigin, type OriginContext } from "@/lib/http/route";

const ctx = (over: Partial<OriginContext> = {}): OriginContext => ({ host: "pixelworld.example", forwardedHost: null, siteUrl: "https://pixelworld.example", ...over });

describe("same-origin check (CSRF defence)", () => {
  it("accepts the site's own address, however the request reached the server", () => {
    expect(isAllowedOrigin("https://pixelworld.example", ctx())).toBe(true);
    expect(isAllowedOrigin("https://PixelWorld.Example", ctx())).toBe(true); // host names are case-insensitive
    expect(isAllowedOrigin("https://pixelworld.example:443", ctx())).toBe(true); // the default port is implicit
    expect(isAllowedOrigin("http://localhost:3000", ctx({ host: "localhost:3000", siteUrl: "http://localhost:3000" }))).toBe(true);
  });

  it("follows the proxy: the host the browser used is the one the proxy forwards, even if the server itself sees another", () => {
    const behindProxy = ctx({ host: "localhost:3000", forwardedHost: "pixelworld.example", siteUrl: "http://localhost:3000" });
    expect(isAllowedOrigin("https://pixelworld.example", behindProxy)).toBe(true);
    expect(isAllowedOrigin("https://pixelworld.example", ctx({ host: "internal-7:3000", forwardedHost: "pixelworld.example, edge.proxy" }))).toBe(true); // a chain of proxies: the first is the browser's
    expect(isAllowedOrigin("https://pixelworld.example", ctx({ host: "internal-7:3000", forwardedHost: "pixelworld.example:443", siteUrl: "http://localhost:3000" }))).toBe(true);
  });

  it("accepts the configured public URL (a proxy that rewrites the host header)", () => {
    expect(isAllowedOrigin("https://pixelworld.example", ctx({ host: "10.0.0.5:3000", forwardedHost: null }))).toBe(true);
  });

  it("refuses any other website, in every shape an attacker's page can take", () => {
    for (const origin of ["https://evil.example", "https://pixelworld.example.evil.example", "https://evil.example/pixelworld.example", "https://notpixelworld.example",
      "http://pixelworld.example:8080", "null", "", "pixelworld.example", "javascript:alert(1)", "https://user@evil.example"]) {
      expect(isAllowedOrigin(origin, ctx()), origin).toBe(false);
    }
  });

  it("lets a development Codespace's forwarded ports through, and only its own", () => {
    const cs = ctx({ host: "localhost:3000", siteUrl: "http://localhost:3000", codespace: { name: "my-codespace-abc", domain: "app.github.dev" } });
    expect(isAllowedOrigin("https://my-codespace-abc-3000.app.github.dev", cs)).toBe(true);
    expect(isAllowedOrigin("https://my-codespace-abc-8080.app.github.dev", cs)).toBe(true);
    for (const origin of ["https://other-codespace-3000.app.github.dev", "https://my-codespace-abc.app.github.dev", "https://my-codespace-abc-3000.app.github.dev.evil.example",
      "https://x-my-codespace-abc-3000.app.github.dev", "https://my-codespace-abc-3000.evil.dev", "https://my-codespace-abc-3000xapp.github.dev"]) {
      expect(isAllowedOrigin(origin, cs), origin).toBe(false);
    }
    // outside a Codespace the same address means nothing
    expect(isAllowedOrigin("https://my-codespace-abc-3000.app.github.dev", ctx({ host: "localhost:3000", siteUrl: "http://localhost:3000" }))).toBe(false);
  });

  it("is not fooled by a malformed site URL", () => {
    expect(isAllowedOrigin("https://pixelworld.example", ctx({ siteUrl: "not a url" }))).toBe(true); // the host header still matches
    expect(isAllowedOrigin("https://evil.example", ctx({ siteUrl: "not a url" }))).toBe(false);
  });
});
