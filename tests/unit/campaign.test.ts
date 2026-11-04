import { describe, expect, it } from "vitest";
import { CAMPAIGN_DAYS, MIN_CARD_CENTS, contributionProblem, fundedPercent, isCampaignDays, parseAmountToCents, quickAmounts, timeLeft } from "@/lib/campaign";

describe("group projects: the rules the page applies before asking the database", () => {
  const o = { remaining: 500_000, min: 200 };

  it("accepts a normal amount, the exact rest, and refuses nonsense", () => {
    expect(contributionProblem(2_500, o)).toBeNull();
    expect(contributionProblem(200, o)).toBeNull();
    expect(contributionProblem(500_000, o)).toBeNull();
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(contributionProblem(bad, o)).toBe("invalid");
    expect(contributionProblem(500_001, o)).toBe("too_high");
    expect(contributionProblem(199, o)).toBe("too_low");
    expect(contributionProblem(100, { remaining: 0, min: 200 })).toBe("full");
  });

  it("never leaves less than a card can pay to fund", () => {
    expect(contributionProblem(500_000 - MIN_CARD_CENTS, o)).toBeNull(); // exactly 50 cents remain
    expect(contributionProblem(500_000 - MIN_CARD_CENTS + 1, o)).toBe("dust");
    expect(contributionProblem(499_999, o)).toBe("dust");
  });

  it("lets the very last bit be smaller than the minimum, and only the exact bit", () => {
    const last = { remaining: 150, min: 200 };
    expect(contributionProblem(150, last)).toBeNull();
    expect(contributionProblem(149, last)).toBe("too_low");
    expect(contributionProblem(100, last)).toBe("too_low");
  });

  it("offers one-click amounts that are acceptable, and the exact rest", () => {
    expect(quickAmounts(o)).toEqual({ amounts: [500, 1000, 2500, 5000, 10000], rest: 500_000 });
    // little is missing: the big buttons disappear, the rest stays
    expect(quickAmounts({ remaining: 3_000, min: 200 })).toEqual({ amounts: [500, 1000, 2500], rest: 3_000 });
    // 26 € missing: 25 € would leave 1 €: fine; 26 € remaining but a 25.80 step would not be offered anyway
    expect(quickAmounts({ remaining: 2_540, min: 200 }).amounts).not.toContain(2_500); // 40 cents would remain: dust
    expect(quickAmounts({ remaining: 0, min: 200 })).toEqual({ amounts: [], rest: null });
    expect(quickAmounts({ remaining: 150, min: 200 })).toEqual({ amounts: [], rest: 150 });
  });

  it("reads amounts the way people write them", () => {
    expect(parseAmountToCents("12")).toBe(1200);
    expect(parseAmountToCents("12.5")).toBe(1250);
    expect(parseAmountToCents("12,50")).toBe(1250);
    expect(parseAmountToCents(" 7,05 ")).toBe(705);
    expect(parseAmountToCents("0.99")).toBe(99);
    for (const bad of ["", "abc", "-5", "1.234", "1,2,3", "1e3", "12 €", "9999999999"]) expect(parseAmountToCents(bad)).toBeNull();
  });

  it("knows the durations, the time left and the share funded", () => {
    expect([...CAMPAIGN_DAYS]).toEqual([7, 14, 30]);
    expect(isCampaignDays(14)).toBe(true);
    expect(isCampaignDays(10)).toBe(false);
    expect(isCampaignDays("14")).toBe(false);
    expect(timeLeft(90_061)).toEqual({ days: 1, hours: 1, minutes: 1, over: false });
    expect(timeLeft(-5)).toEqual({ days: 0, hours: 0, minutes: 0, over: true });
    expect(fundedPercent(0, 1000)).toBe(0);
    expect(fundedPercent(999, 1000)).toBe(99); // never says 100 % before it is
    expect(fundedPercent(1000, 1000)).toBe(100);
    expect(fundedPercent(5000, 1000)).toBe(100);
    expect(fundedPercent(10, 0)).toBe(0);
  });
});
