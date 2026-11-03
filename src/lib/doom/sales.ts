/**
 * The story closes the shop: once the countdown has reached zero, nothing can be bought any more (the owner's decision).
 * Pure, and used on the server (the checkout route refuses) as well as in the tests; the interface follows the same clock.
 */
import { HttpError } from "@/lib/http/errors";
import { parseEnd } from "./clock";

/** Has the end of the world been reached? `endValue` is `NEXT_PUBLIC_WORLD_END_AT` (an ISO date with its time zone; empty: the story is off). */
export function salesClosedByStory(endValue: string | null | undefined, now: number): boolean {
  const end = parseEnd(endValue);
  return end !== null && now >= end;
}

/** Refuses a new purchase once the world has ended. (A payment already under way is not touched: only starting an order is.) */
export function assertStoryAllowsSales(endValue: string | null | undefined = process.env.NEXT_PUBLIC_WORLD_END_AT, now: number = Date.now()): void {
  if (salesClosedByStory(endValue, now)) throw new HttpError(403, "px_world_ended");
}
