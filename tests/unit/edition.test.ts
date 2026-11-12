import { describe, expect, it } from "vitest";
import { daysLeft, timeLeft, toPublicEdition, type EditionInfo } from "@/lib/edition";
import { assertSalesOpen } from "@/lib/data/edition";
import { statusForPx } from "@/lib/http/errors";
import { DEFAULT_PRICING } from "@/lib/grid/pricing";

const info = (over: Partial<EditionInfo> = {}): EditionInfo => ({
  id: "00000000-0000-0000-0000-000000000001", slug: "fondatrice", name: "Édition fondatrice", status: "open", state: "open", frozen: false, durationDays: 365,
  opensAt: "2026-11-01T10:00:00Z", closesAt: "2027-11-01T10:00:00Z", closedAt: null, settlesAt: "2027-11-01T10:35:00Z", serverNow: "2026-11-11T10:00:00Z", snapshot: null, ...over,
});

describe("the edition as the interface sees it", () => {
  it("splits the time left for a clock (days, hours, minutes, seconds) on the SERVER's moment, and never goes below zero", () => {
    expect(timeLeft("2027-11-01T10:00:00Z", Date.parse("2026-11-11T10:00:00Z"))).toEqual({ d: 355, h: 0, m: 0, s: 0 });
    expect(timeLeft("2027-11-01T10:00:00Z", Date.parse("2027-10-31T08:58:57Z"))).toEqual({ d: 1, h: 1, m: 1, s: 3 });
    expect(timeLeft("2027-11-01T10:00:00Z", Date.parse("2027-11-01T09:59:59.500Z"))).toEqual({ d: 0, h: 0, m: 0, s: 0 }); // under a second: zero
    expect(timeLeft("2027-11-01T10:00:00Z", Date.parse("2027-11-02T00:00:00Z"))).toEqual({ d: 0, h: 0, m: 0, s: 0 }); // past the closing
  });

  it("counts the days left on the SERVER's clock, never on the browser's", () => {
    expect(daysLeft(info())).toBe(355); // 10 days into the 365
    expect(daysLeft(info({ serverNow: "2027-11-01T09:59:00Z" }))).toBe(1); // a started last day still counts
    expect(daysLeft(info({ serverNow: "2027-11-01T10:00:00Z", state: "closed" }))).toBe(0);
  });

  it("has no count before the opening (no date, nothing to count) and none once closed", () => {
    expect(daysLeft(info({ state: "prelaunch", status: "prelaunch", opensAt: null, closesAt: null }))).toBeNull();
    expect(daysLeft(info({ state: "closed", status: "closed" }))).toBe(0);
  });

  it("gives the public only what a visitor may know: no identifier, no snapshot, no recorded status", () => {
    const withSnapshot = info({ snapshot: { revision: 2, takenAt: "2027-02-10T00:00:00Z", parcelCount: 5, hash: "a".repeat(64) } });
    const p = toPublicEdition(withSnapshot);
    expect(Object.keys(p).sort()).toEqual(["closedAt", "closesAt", "frozen", "name", "opensAt", "serverNow", "slug", "state"]);
    expect(JSON.stringify(p)).not.toContain("aaaa");
  });
});

describe("the refusals of the sale routes", () => {
  const p = (editionState: "prelaunch" | "open" | "closed", salesOpen = editionState === "open") => ({ ...DEFAULT_PRICING, editionState, salesOpen });
  const code = (f: () => void) => { try { f(); } catch (e) { return [(e as { status: number }).status, (e as { code: string }).code]; } return null; };

  it("says why: not open yet, closed, or the shop switched off by hand", () => {
    expect(code(() => assertSalesOpen(p("prelaunch")))).toEqual([503, "px_edition_not_open"]);
    expect(code(() => assertSalesOpen(p("closed")))).toEqual([403, "px_edition_closed"]);
    expect(code(() => assertSalesOpen(p("open", false)))).toEqual([503, "px_sales_closed"]);
    expect(code(() => assertSalesOpen(p("open")))).toBeNull();
  });

  it("maps the codes of the database to the same HTTP statuses", () => {
    expect(statusForPx("px_edition_not_open")).toBe(503);
    expect(statusForPx("px_edition_closed")).toBe(403);
    expect(statusForPx("px_edition_frozen")).toBe(423);
    for (const c of ["px_edition_bad_state", "px_edition_not_empty"]) expect(statusForPx(c)).toBe(409);
    for (const c of ["px_edition_bad_date", "px_edition_confirm_mismatch"]) expect(statusForPx(c)).toBe(400);
  });

  it("the fallback pricing (the database cannot be read) sells nothing", () => {
    expect(DEFAULT_PRICING.salesOpen).toBe(false);
    expect(DEFAULT_PRICING.editionState).toBe("prelaunch");
  });
});
