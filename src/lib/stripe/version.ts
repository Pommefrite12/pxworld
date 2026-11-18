/**
 * The Stripe API version the payment code was written and tested against, fixed here so that it does NOT follow the library.
 *
 * Left alone, the library sends the API version it was built for: upgrading the `stripe` package would then silently change the version of the
 * API that creates our payments and reads their events (field names, defaults, behaviours can differ between versions). Fixed, an upgrade of the
 * package changes nothing for the payments until somebody chooses to move on. `tests/unit/stripe-version.test.ts` fails when the library's own
 * version is no longer this one: that is the moment to read Stripe's changelog (https://docs.stripe.com/changelog), run the payment tests
 * (`npm run test:db`, `npm run test:e2e`), then either move this constant to the new version or keep it (a cast is then needed: see the test).
 */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;
