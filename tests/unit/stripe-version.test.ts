import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { STRIPE_API_VERSION } from "@/lib/stripe/version";

describe("the Stripe API version of the payment code", () => {
  it("is the one the installed library was built for (when it is not, the library was upgraded: see lib/stripe/version.ts before moving on)", () => {
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION);
  });

  it("is sent with every request (the client does not follow the library)", () => {
    const client = new Stripe("sk_test_unit", { apiVersion: STRIPE_API_VERSION });
    expect((client as unknown as { getApiField(k: string): string }).getApiField("version")).toBe(STRIPE_API_VERSION);
  });
});
