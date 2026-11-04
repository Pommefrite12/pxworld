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
