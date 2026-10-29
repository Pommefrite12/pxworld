# Payments (Stripe)

**Test mode only until you decide otherwise.** `src/lib/stripe/client.ts` throws if `STRIPE_SECRET_KEY` starts with `sk_live_`
unless `PAYMENTS_LIVE_ENABLED=yes-i-have-approval` is set. Do not set it before the go-live checklist is complete.

## Rules implemented

| Rule | Where |
|---|---|
| Prices computed server-side, from the surface and `app_settings.price_unit_cents` | `px_start_order` (SQL); the client quote is display-only |
| Unique order id, snapshot of the rectangle and price | `orders` (`amount_cents = area × unit_price` is a CHECK) |
| Reservation verified in the database | parcel `reserved` + `parcel_reservations` + exclusion constraint |
| One order can never attribute the same area twice | `px_fulfill_order` locks the order, is idempotent, and relies on the exclusion constraint |
| Browser return ≠ proof of payment | `/checkout/success` only polls `/api/orders/:id`, which reflects the DB |
| Attribution depends on a **verified webhook** | `/api/stripe/webhook` verifies the signature on the raw body, then `handleStripeEvent` |
| Idempotent webhooks | `stripe_events.id` primary key + idempotent SQL effects; concurrent duplicates tested |
| Failed / abandoned / expired | `payment_intent.payment_failed` (recorded, order stays payable), `checkout.session.expired` and `/checkout/cancel` (pixels released) |
| Refunds, disputes | `charge.refunded` (full → parcel revoked, pixels free; partial → flagged), `charge.dispute.created/closed` (hide → restore / revoke) |
| Delayed or lost webhook | `reconcileOrder` (called by the success page and the cron) retrieves the Checkout Session **from Stripe** |
| Paid for pixels we can't attribute (hold lapsed + sold to someone else; amount mismatch) | order `refund_required` + **automatic refund** (idempotency key `auto_refund_<order>`), retried by the cron, visible in the admin |
| Asynchronous payment methods | completion with `payment_status=unpaid` extends the hold (`px_extend_reservation`, 5 days); success/failure events finish the job |
| Secret keys never in the browser | only `NEXT_PUBLIC_*` variables reach the client |

Amount check: `px_fulfill_order` compares Stripe's `amount_subtotal` (price × quantity, excluding added tax) and the currency to
the server's price; any difference means *no attribution + refund*.

## Tax and invoicing (no fiscal rules are invented)

* `STRIPE_AUTOMATIC_TAX=true` turns on Stripe Tax for Checkout (you must configure Stripe Tax and your registrations in
  the Stripe Dashboard). Billing address is always collected and **tax ID collection is enabled**.
* `STRIPE_INVOICE_CREATION=true` (default) asks Stripe to create an invoice per payment.
* `orders` stores what Stripe reports: `amount_subtotal_cents`, `amount_tax_cents`, `amount_total_cents`, billing country/name,
  `tax_ids`, customer email. The admin dashboard shows revenue excluding tax and tax collected.
* Operator identity for the legal pages (`NEXT_PUBLIC_OPERATOR_NAME/ADDRESS/EMAIL/REGISTRATION/VAT`) and consumer-law
  questions (withdrawal right for digital content, refund policy) are placeholders to be settled with legal counsel.

## Setting up the test environment

1. Stripe Dashboard (test mode) → Developers → API keys → `STRIPE_SECRET_KEY=sk_test_…`
2. Payment methods: enable **cards and wallets** (asynchronous methods are supported but not needed).
3. Webhook endpoint `https://<your-host>/api/stripe/webhook` with events: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
   → copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints a `whsec_…` for `.env.local`
   (and remove `STRIPE_MOCK`).
5. Test cards: `4242 4242 4242 4242` (success), `4000 0000 0000 9995` (declined). Dispute/refund flows can be triggered from the Dashboard.

## Going live

Requires **your explicit approval** and the [launch checklist](LAUNCH_CHECKLIST.md): switch to live keys + a live webhook
secret, then set `PAYMENTS_LIVE_ENABLED=yes-i-have-approval`. Run one real low-value purchase and refund before announcing.
