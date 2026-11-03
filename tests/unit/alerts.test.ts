import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAlert, raiseAlert, resetAlertThrottle } from "@/lib/alerts";

beforeEach(() => { resetAlertThrottle(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

const ok = () => vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

describe("alerts", () => {
  it("is always written to the log, and posted when an https address is configured", async () => {
    const f = ok();
    expect(await raiseAlert("stripe-webhook-failed", { event: "evt_1", error: "boom" }, { url: "https://hooks.example/x", fetcher: f })).toBe("sent");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[alert] stripe-webhook-failed — event=evt_1 error=boom"));
    const [, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toEqual({ text: expect.stringContaining("evt_1"), content: expect.stringContaining("evt_1") });
  });
  it("only logs when nothing is configured, or when the address is not https", async () => {
    const f = ok();
    expect(await raiseAlert("a", {}, { url: null, fetcher: f })).toBe("logged");
    resetAlertThrottle();
    expect(await raiseAlert("a", {}, { url: "http://insecure.example", fetcher: f })).toBe("logged");
    expect(f).not.toHaveBeenCalled();
  });
  it("never throws, whatever goes wrong while sending", async () => {
    const boom = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    expect(await raiseAlert("a", {}, { url: "https://hooks.example/x", fetcher: boom })).toBe("logged");
    resetAlertThrottle();
    const bad = vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    expect(await raiseAlert("a", {}, { url: "https://hooks.example/x", fetcher: bad })).toBe("logged");
  });
  it("sends one alert of a kind per window and counts the ones it held back", async () => {
    const f = ok(), url = "https://hooks.example/x", t0 = 1_000_000;
    expect(await raiseAlert("server-error", { n: 1 }, { url, fetcher: f, now: t0 })).toBe("sent");
    for (let i = 0; i < 40; i++) expect(await raiseAlert("server-error", { n: 2 }, { url, fetcher: f, now: t0 + 1000 + i })).toBe("throttled");
    expect(await raiseAlert("other-kind", {}, { url, fetcher: f, now: t0 + 2000 })).toBe("sent"); // another kind is another alert
    expect(await raiseAlert("server-error", { n: 3 }, { url, fetcher: f, now: t0 + 6 * 60_000 })).toBe("sent");
    expect(f).toHaveBeenCalledTimes(3);
    const last = JSON.parse(String(((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[2]![1]).body)).text as string;
    expect(last).toContain("and 40 more");
  });
  it("cleans and clips what it writes (an error message is untrusted text)", () => {
    const text = formatAlert("k\nforged", { error: "line1\n[alert] fake\u0000" + "x".repeat(1000), empty: "", missing: undefined });
    expect(text).not.toMatch(/[\n\u0000]/);
    expect(text.length).toBeLessThan(400);
    expect(text).not.toContain("empty=");
    expect(text).not.toContain("missing=");
  });
});
