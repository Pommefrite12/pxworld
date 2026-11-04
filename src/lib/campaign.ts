/**
 * "Fund it together": a parcel that several people pay for. This file holds what both the server and the browser need to know
 * (the durations and the states of a project); everything that touches the database is in `lib/data/campaigns.ts`.
 */
export const CAMPAIGN_DAYS = [7, 14, 30] as const;
export type CampaignDays = (typeof CAMPAIGN_DAYS)[number];

/**
 * pending: waits for a moderator · open: the zone is held, contributions are welcome · funded: the goal was reached, the parcel is bought
 * expired: the deadline passed without the goal · cancelled: withdrawn by its creator · rejected: refused by moderation
 */
export type CampaignStatus = "pending" | "open" | "funded" | "expired" | "cancelled" | "rejected";

export const isCampaignDays = (n: unknown): n is CampaignDays => (CAMPAIGN_DAYS as readonly unknown[]).includes(n);
export const DEFAULT_CAMPAIGN_DAYS: CampaignDays = 14;

/* ------------------------------------------------------------------ contributions: the rules, as the database applies them */

/** The smallest payment a card accepts: a contribution may never leave less than this to fund (the database applies the same rule). */
export const MIN_CARD_CENTS = 50;

export type ContributionProblem = "invalid" | "full" | "too_high" | "too_low" | "dust";

/**
 * Is this amount (in cents) acceptable, given what is still missing and the minimum contribution? The same rules as `px_start_contribution`
 * in PostgreSQL, which is the one that decides: this is only so that the page can say it before asking. `null` = acceptable.
 */
export function contributionProblem(amount: number, o: { remaining: number; min: number }): ContributionProblem | null {
  if (!Number.isInteger(amount) || amount < 1) return "invalid";
  if (o.remaining < 1) return "full";
  if (amount > o.remaining) return "too_high";
  if (amount < o.min && amount !== o.remaining) return "too_low";
  if (amount !== o.remaining && o.remaining - amount < MIN_CARD_CENTS) return "dust";
  return null;
}

/** "12", "12.5", "12,50" → cents. Anything else (letters, a third decimal, a minus sign…) → null. */
export function parseAmountToCents(text: string): number | null {
  const m = text.trim().replace(/\s/g, "").match(/^(\d{1,7})(?:[.,](\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** The one-click amounts offered (whole units of the currency), the ones that are acceptable, and the exact rest when it is worth a button. */
export function quickAmounts(o: { remaining: number; min: number }, steps: readonly number[] = [5, 10, 25, 50, 100]): { amounts: number[]; rest: number | null } {
  const amounts = steps.map((s) => s * 100).filter((a) => contributionProblem(a, o) === null && a !== o.remaining);
  const rest = o.remaining >= 1 && contributionProblem(o.remaining, o) === null ? o.remaining : null;
  return { amounts, rest };
}

/** Days, hours and minutes left, for a label (never negative). */
export function timeLeft(seconds: number): { days: number; hours: number; minutes: number; over: boolean } {
  const s = Math.max(0, Math.floor(seconds));
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), over: s === 0 };
}

/** Share of the goal that is paid, 0 → 100 (the bar of a project). */
export const fundedPercent = (raisedCents: number, goalCents: number): number => (goalCents > 0 ? Math.min(100, Math.floor((raisedCents / goalCents) * 100)) : 0);
